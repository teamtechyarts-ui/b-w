-- PART 2c — Continue AFTER fixed catalog seed (migrations 24-37)
-- Run AFTER 02b_FIXED_customer_catalog_seed.sql


-- SOURCE: 24_20260912113000_add_order_pickup_schedule.sql

BEGIN;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS pickup_scheduled_at timestamptz;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS pickup_slot_label text;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_scheduled_at
ON public.orders(pickup_scheduled_at)
WHERE pickup_scheduled_at IS NOT NULL;

COMMIT;

-- SOURCE: 25_20260915100000_atomic_customer_cancellation_refunds.sql

-- Keep customer cancellation and refund requests transactionally consistent.
-- Provider calls remain in Nest; these service-role-only functions own the
-- Bright & White database effects and preserve change_order_status as the
-- canonical order lifecycle transition mechanism.

ALTER TABLE public.refund_requests
ADD COLUMN IF NOT EXISTS is_cancellation_refund boolean NOT NULL DEFAULT false;

ALTER TABLE public.refund_requests
DROP CONSTRAINT IF EXISTS refund_requests_cancellation_payment_required;

ALTER TABLE public.refund_requests
ADD CONSTRAINT refund_requests_cancellation_payment_required
CHECK (NOT is_cancellation_refund OR payment_order_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_requests_one_cancellation_per_payment
ON public.refund_requests (payment_order_id)
WHERE is_cancellation_refund;

-- A provider order may only be registered while its application order is
-- awaiting payment. Locking the order on insert closes the race where a
-- customer cancellation commits while provider order creation is in flight.
CREATE OR REPLACE FUNCTION public.validate_payment_order_insert_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
BEGIN
    SELECT orders.current_status
    INTO v_order_status
    FROM public.orders
    WHERE orders.id = NEW.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', NEW.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'pending_payment'::public.order_status THEN
        RAISE EXCEPTION 'Order is not awaiting payment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_order_insert_lifecycle
ON public.payment_orders;

CREATE TRIGGER trg_validate_payment_order_insert_lifecycle
BEFORE INSERT ON public.payment_orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_payment_order_insert_lifecycle();

CREATE OR REPLACE FUNCTION public.request_refund_atomic(
    p_payment_order_id uuid,
    p_requested_by uuid,
    p_amount numeric,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_refund public.refund_requests%ROWTYPE;
    v_committed numeric(12,2);
    v_reason text;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));

    IF p_payment_order_id IS NULL OR p_requested_by IS NULL THEN
        RAISE EXCEPTION 'Payment and requester are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount is invalid'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Refund reason must contain between 3 and 500 characters'
            USING ERRCODE = '22023';
    END IF;

    -- Every refund request for a payment serializes on this row. This makes
    -- the remaining-balance calculation safe under concurrent requests.
    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT orders.*
    INTO v_order
    FROM public.orders
    WHERE orders.id = v_payment.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_payment.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customers AS customer
        WHERE customer.id = v_order.customer_id
          AND customer.profile_id = p_requested_by
    ) THEN
        RAISE EXCEPTION 'Payment belongs to another customer'
            USING ERRCODE = '42501';
    END IF;

    IF v_payment.status NOT IN ('paid', 'partially_refunded')
       OR v_payment.provider_payment_id IS NULL THEN
        RAISE EXCEPTION 'Only a captured payment can be refunded'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status NOT IN (
        'cancelled'::public.order_status,
        'claim_period_active'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Order is not eligible for a refund request'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(sum(refund.amount), 0)
    INTO v_committed
    FROM public.refund_requests AS refund
    WHERE refund.payment_order_id = v_payment.id
      AND refund.status IN (
          'requested'::public.refund_status,
          'under_review'::public.refund_status,
          'approved'::public.refund_status,
          'processing'::public.refund_status,
          'completed'::public.refund_status
      );

    IF p_amount + v_committed > v_payment.amount THEN
        RAISE EXCEPTION 'Refund exceeds the remaining captured amount'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.refund_requests (
        payment_order_id,
        requested_by,
        amount,
        reason,
        status,
        is_cancellation_refund
    )
    VALUES (
        v_payment.id,
        p_requested_by,
        p_amount,
        v_reason,
        'requested'::public.refund_status,
        false
    )
    RETURNING * INTO v_refund;

    RETURN to_jsonb(v_refund);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_customer_order_atomic(
    p_order_id uuid,
    p_profile_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_payment public.payment_orders%ROWTYPE;
    v_refund public.refund_requests%ROWTYPE;
    v_payment_id uuid;
    v_committed numeric(12,2) := 0;
    v_remaining numeric(12,2) := 0;
    v_reason text;
    v_history_reason text;
    v_duplicate boolean;
    v_refund_created boolean := false;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));

    IF p_order_id IS NULL OR p_profile_id IS NULL THEN
        RAISE EXCEPTION 'Order and customer profile are required'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Cancellation reason must contain between 3 and 500 characters'
            USING ERRCODE = '22023';
    END IF;

    -- Match payment capture/refund lock order whenever an existing payment is
    -- present: payment first, then order. A non-locking lookup is safe because
    -- the insert trigger above serializes a new provider order on the order row.
    SELECT payment.id
    INTO v_payment_id
    FROM public.payment_orders AS payment
    WHERE payment.order_id = p_order_id
    ORDER BY
        CASE payment.status
            WHEN 'paid' THEN 1
            WHEN 'partially_refunded' THEN 2
            WHEN 'refunded' THEN 3
            WHEN 'authorized' THEN 4
            WHEN 'created' THEN 5
            WHEN 'failed' THEN 6
            WHEN 'cancelled' THEN 7
            ELSE 8
        END,
        payment.created_at DESC
    LIMIT 1;

    IF v_payment_id IS NOT NULL THEN
        SELECT payment.*
        INTO v_payment
        FROM public.payment_orders AS payment
        WHERE payment.id = v_payment_id
        FOR UPDATE;
    END IF;

    SELECT orders.*
    INTO v_order
    FROM public.orders
    WHERE orders.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customers AS customer
        WHERE customer.id = v_order.customer_id
          AND customer.profile_id = p_profile_id
    ) THEN
        RAISE EXCEPTION 'Order belongs to another customer'
            USING ERRCODE = '42501';
    END IF;

    v_duplicate := v_order.current_status = 'cancelled'::public.order_status;

    IF NOT v_duplicate THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.order_status_transitions AS transition
            WHERE transition.from_status = v_order.current_status
              AND transition.to_status = 'cancelled'::public.order_status
        ) THEN
            RAISE EXCEPTION 'Order cannot be cancelled while it is %', v_order.current_status
                USING ERRCODE = '23514';
        END IF;

        v_history_reason := format('Customer cancellation: %s', v_reason);

        PERFORM public.change_order_status(
            p_order_id,
            'cancelled'::public.order_status,
            v_history_reason
        );

        UPDATE public.order_status_history AS history
        SET changed_by = p_profile_id
        WHERE history.id = (
            SELECT candidate.id
            FROM public.order_status_history AS candidate
            WHERE candidate.order_id = p_order_id
              AND candidate.from_status = v_order.current_status
              AND candidate.to_status = 'cancelled'::public.order_status
              AND candidate.reason = v_history_reason
            ORDER BY candidate.created_at DESC, candidate.id DESC
            LIMIT 1
        );
    END IF;

    -- Catch a provider-order insert that committed before the order lock was
    -- obtained but after the initial lookup.
    IF v_payment_id IS NULL THEN
        SELECT payment.*
        INTO v_payment
        FROM public.payment_orders AS payment
        WHERE payment.order_id = p_order_id
        ORDER BY
            CASE payment.status
                WHEN 'paid' THEN 1
                WHEN 'partially_refunded' THEN 2
                WHEN 'refunded' THEN 3
                WHEN 'authorized' THEN 4
                WHEN 'created' THEN 5
                WHEN 'failed' THEN 6
                WHEN 'cancelled' THEN 7
                ELSE 8
            END,
            payment.created_at DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF v_payment.id IS NULL THEN
        RETURN jsonb_build_object(
            'orderId', p_order_id,
            'orderStatus', 'cancelled',
            'duplicate', v_duplicate,
            'paymentOrderId', NULL,
            'refundRequestId', NULL,
            'refundStatus', NULL,
            'refundAmount', 0,
            'refundCreated', false
        );
    END IF;

    IF v_payment.status IN ('created', 'authorized', 'failed') THEN
        UPDATE public.payment_orders
        SET
            status = 'cancelled',
            updated_at = transaction_timestamp()
        WHERE id = v_payment.id;
    ELSIF v_payment.status IN ('paid', 'partially_refunded', 'refunded')
          AND v_payment.provider_payment_id IS NOT NULL THEN
        SELECT refund.*
        INTO v_refund
        FROM public.refund_requests AS refund
        WHERE refund.payment_order_id = v_payment.id
          AND refund.is_cancellation_refund
        LIMIT 1;

        IF v_refund.id IS NULL THEN
            SELECT COALESCE(sum(refund.amount), 0)
            INTO v_committed
            FROM public.refund_requests AS refund
            WHERE refund.payment_order_id = v_payment.id
              AND refund.status IN (
                  'requested'::public.refund_status,
                  'under_review'::public.refund_status,
                  'approved'::public.refund_status,
                  'processing'::public.refund_status,
                  'completed'::public.refund_status
              );

            v_remaining := GREATEST(v_payment.amount - v_committed, 0);

            IF v_remaining > 0 THEN
                INSERT INTO public.refund_requests (
                    payment_order_id,
                    requested_by,
                    amount,
                    reason,
                    status,
                    is_cancellation_refund
                )
                VALUES (
                    v_payment.id,
                    p_profile_id,
                    v_remaining,
                    v_reason,
                    'requested'::public.refund_status,
                    true
                )
                ON CONFLICT (payment_order_id)
                    WHERE is_cancellation_refund
                DO NOTHING
                RETURNING * INTO v_refund;

                IF v_refund.id IS NULL THEN
                    SELECT refund.*
                    INTO v_refund
                    FROM public.refund_requests AS refund
                    WHERE refund.payment_order_id = v_payment.id
                      AND refund.is_cancellation_refund
                    LIMIT 1;
                ELSE
                    v_refund_created := true;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'orderStatus', 'cancelled',
        'duplicate', v_duplicate,
        'paymentOrderId', v_payment.id,
        'refundRequestId', v_refund.id,
        'refundStatus', v_refund.status,
        'refundAmount', COALESCE(v_refund.amount, 0),
        'refundCreated', v_refund_created
    );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_payment_order_insert_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_customer_order_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_customer_order_atomic(uuid, uuid, text) TO service_role;


-- SOURCE: 26_20260915120000_add_customer_order_claims.sql

-- Customer claims are separate from facility-authored damage/missing-item
-- reports. The backend creates claims and signed Storage upload URLs with the
-- service role; no direct anonymous or authenticated table access is granted.

CREATE TABLE IF NOT EXISTS public.customer_order_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
    submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    client_request_id uuid NOT NULL,
    claim_type text NOT NULL CHECK (
        claim_type IN ('damage', 'missing_item', 'quality', 'delivery', 'other')
    ),
    description text NOT NULL CHECK (
        length(btrim(description)) BETWEEN 10 AND 4000
    ),
    status text NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('submitted', 'under_review', 'approved', 'rejected', 'resolved')
    ),
    resolution_notes text,
    reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (customer_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS public.customer_claim_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid NOT NULL REFERENCES public.customer_order_claims(id) ON DELETE CASCADE,
    storage_path text NOT NULL UNIQUE,
    uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_order_claims_order
ON public.customer_order_claims(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_order_claims_customer
ON public.customer_order_claims(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_claim_photos_claim
ON public.customer_claim_photos(claim_id, created_at);

ALTER TABLE public.customer_order_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_claim_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_order_claims
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.customer_claim_photos
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_order_claims
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_claim_photos
TO service_role;

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'customer-claim-photos',
    'customer-claim-photos',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.create_customer_order_claim_atomic(
    p_order_id uuid,
    p_profile_id uuid,
    p_claim_type text,
    p_description text,
    p_order_item_id uuid,
    p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_customer_profile_id uuid;
    v_claim public.customer_order_claims%ROWTYPE;
    v_item_order_id uuid;
    v_duplicate boolean := false;
BEGIN
    IF p_order_id IS NULL
       OR p_profile_id IS NULL
       OR p_client_request_id IS NULL THEN
        RAISE EXCEPTION 'Order, profile, and client request ID are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_claim_type IS NULL
       OR p_claim_type NOT IN (
            'damage',
            'missing_item',
            'quality',
            'delivery',
            'other'
       ) THEN
        RAISE EXCEPTION 'Invalid claim type'
            USING ERRCODE = '22023';
    END IF;

    IF p_description IS NULL
       OR length(btrim(p_description)) NOT BETWEEN 10 AND 4000 THEN
        RAISE EXCEPTION 'Claim description must be between 10 and 4000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT c.profile_id
    INTO v_customer_profile_id
    FROM public.customers AS c
    WHERE c.id = v_order.customer_id;

    IF v_customer_profile_id IS DISTINCT FROM p_profile_id THEN
        RAISE EXCEPTION 'Order is not owned by this customer'
            USING ERRCODE = '42501';
    END IF;

    SELECT claims.*
    INTO v_claim
    FROM public.customer_order_claims AS claims
    WHERE claims.customer_id = v_order.customer_id
      AND claims.client_request_id = p_client_request_id;

    IF FOUND THEN
        IF v_claim.order_id IS DISTINCT FROM p_order_id
           OR v_claim.order_item_id IS DISTINCT FROM p_order_item_id
           OR v_claim.claim_type IS DISTINCT FROM p_claim_type
           OR v_claim.description IS DISTINCT FROM btrim(p_description) THEN
            RAISE EXCEPTION 'Client request ID was already used for another claim'
                USING ERRCODE = '23505';
        END IF;

        RETURN to_jsonb(v_claim) || jsonb_build_object('duplicate', true);
    END IF;

    IF v_order.current_status <> 'claim_period_active'::public.order_status THEN
        RAISE EXCEPTION 'Claims are not accepted while order is %', v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF v_order.claim_deadline_at IS NULL
       OR v_order.claim_deadline_at <= transaction_timestamp() THEN
        RAISE EXCEPTION 'The order claim period has expired'
            USING ERRCODE = '23514';
    END IF;

    IF p_order_item_id IS NOT NULL THEN
        SELECT items.order_id
        INTO v_item_order_id
        FROM public.order_items AS items
        WHERE items.id = p_order_item_id;

        IF NOT FOUND OR v_item_order_id IS DISTINCT FROM p_order_id THEN
            RAISE EXCEPTION 'Claim item does not belong to this order'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    INSERT INTO public.customer_order_claims (
        order_id,
        customer_id,
        order_item_id,
        submitted_by,
        client_request_id,
        claim_type,
        description
    )
    VALUES (
        p_order_id,
        v_order.customer_id,
        p_order_item_id,
        p_profile_id,
        p_client_request_id,
        p_claim_type,
        btrim(p_description)
    )
    ON CONFLICT (customer_id, client_request_id) DO NOTHING
    RETURNING * INTO v_claim;

    IF NOT FOUND THEN
        SELECT claims.*
        INTO v_claim
        FROM public.customer_order_claims AS claims
        WHERE claims.customer_id = v_order.customer_id
          AND claims.client_request_id = p_client_request_id;

        IF NOT FOUND
           OR v_claim.order_id IS DISTINCT FROM p_order_id
           OR v_claim.order_item_id IS DISTINCT FROM p_order_item_id
           OR v_claim.claim_type IS DISTINCT FROM p_claim_type
           OR v_claim.description IS DISTINCT FROM btrim(p_description) THEN
            RAISE EXCEPTION 'Unable to resolve concurrent claim submission'
                USING ERRCODE = '40001';
        END IF;

        v_duplicate := true;
    END IF;

    RETURN to_jsonb(v_claim) || jsonb_build_object('duplicate', v_duplicate);
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_customer_claim_photo_atomic(
    p_claim_id uuid,
    p_profile_id uuid,
    p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_claim public.customer_order_claims%ROWTYPE;
    v_customer_profile_id uuid;
    v_object_name text;
    v_photo public.customer_claim_photos%ROWTYPE;
    v_duplicate boolean := false;
BEGIN
    IF p_claim_id IS NULL
       OR p_profile_id IS NULL
       OR p_storage_path IS NULL THEN
        RAISE EXCEPTION 'Claim, profile, and photo path are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT claims.*
    INTO v_claim
    FROM public.customer_order_claims AS claims
    WHERE claims.id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim % not found', p_claim_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT customers.profile_id
    INTO v_customer_profile_id
    FROM public.customers AS customers
    WHERE customers.id = v_claim.customer_id;

    IF v_customer_profile_id IS DISTINCT FROM p_profile_id THEN
        RAISE EXCEPTION 'Claim is not owned by this customer'
            USING ERRCODE = '42501';
    END IF;

    IF v_claim.status NOT IN ('submitted', 'under_review') THEN
        RAISE EXCEPTION 'Photos cannot be added while claim is %', v_claim.status
            USING ERRCODE = '23514';
    END IF;

    IF length(p_storage_path) > 1024
       OR p_storage_path !~ (
            '^' || p_profile_id::text || '/' || p_claim_id::text ||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
       ) THEN
        RAISE EXCEPTION 'Invalid claim photo path'
            USING ERRCODE = '22023';
    END IF;

    SELECT objects.name
    INTO v_object_name
    FROM storage.objects AS objects
    WHERE objects.bucket_id = 'customer-claim-photos'
      AND objects.name = p_storage_path
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim photograph has not been uploaded'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.customer_claim_photos (
        claim_id,
        storage_path,
        uploaded_by
    )
    VALUES (
        p_claim_id,
        p_storage_path,
        p_profile_id
    )
    ON CONFLICT (storage_path) DO NOTHING
    RETURNING * INTO v_photo;

    IF NOT FOUND THEN
        SELECT photos.*
        INTO v_photo
        FROM public.customer_claim_photos AS photos
        WHERE photos.storage_path = p_storage_path;

        IF NOT FOUND
           OR v_photo.claim_id IS DISTINCT FROM p_claim_id
           OR v_photo.uploaded_by IS DISTINCT FROM p_profile_id THEN
            RAISE EXCEPTION 'Claim photograph is already attached elsewhere'
                USING ERRCODE = '23505';
        END IF;

        v_duplicate := true;
    END IF;

    RETURN to_jsonb(v_photo) || jsonb_build_object('duplicate', v_duplicate);
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order_claim_atomic(
    uuid,
    uuid,
    text,
    text,
    uuid,
    uuid
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.attach_customer_claim_photo_atomic(
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_customer_order_claim_atomic(
    uuid,
    uuid,
    text,
    text,
    uuid,
    uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION public.attach_customer_claim_photo_atomic(
    uuid,
    uuid,
    text
)
TO service_role;

COMMENT ON TABLE public.customer_order_claims IS
'Customer-submitted claims created during the existing post-delivery claim period.';

COMMENT ON TABLE public.customer_claim_photos IS
'Private Storage objects attached to customer-submitted order claims.';


-- SOURCE: 27_20260916010000_add_order_pricing_consent.sql

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_delivery_charge numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terms_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

UPDATE public.orders
SET
  pickup_delivery_charge = COALESCE(pickup_delivery_charge, 0),
  taxable_amount = GREATEST(subtotal - discount_amount, 0),
  gst_rate = COALESCE(gst_rate, 0),
  gst_amount = COALESCE(gst_amount, 0),
  terms_accepted = COALESCE(terms_accepted, false)
WHERE taxable_amount = 0;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_delivery_charge_nonnegative;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_delivery_charge_nonnegative
  CHECK (pickup_delivery_charge >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_taxable_amount_nonnegative;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_taxable_amount_nonnegative
  CHECK (taxable_amount >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_gst_rate_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_gst_rate_valid
  CHECK (gst_rate >= 0 AND gst_rate <= 100);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_gst_amount_nonnegative;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_gst_amount_nonnegative
  CHECK (gst_amount >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_timestamp_consistency;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_timestamp_consistency
  CHECK (
    (
      terms_accepted = false
      AND terms_accepted_at IS NULL
    )
    OR
    (
      terms_accepted = true
      AND terms_accepted_at IS NOT NULL
    )
  );

COMMIT;


-- SOURCE: 28_20260917090000_add_order_terms_version.sql

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS terms_version text;

UPDATE public.orders
SET terms_version = 'legacy-pre-2026.09.17'
WHERE terms_accepted = true
  AND terms_version IS NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_acceptance_version_consistency;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_acceptance_version_consistency
  CHECK (
    terms_accepted = false
    OR (
      terms_accepted = true
      AND terms_accepted_at IS NOT NULL
      AND terms_version IS NOT NULL
      AND length(btrim(terms_version)) > 0
    )
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_version_not_blank;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_version_not_blank
  CHECK (
    terms_version IS NULL
    OR length(btrim(terms_version)) > 0
  );

COMMENT ON COLUMN public.orders.terms_version IS
'Version identifier of the customer Terms & Conditions accepted for this order. Historical accepted orders created before version tracking use legacy-pre-2026.09.17.';

COMMIT;


-- SOURCE: 29_20260918010000_6r_atomic_loyalty_redemption.sql

-- 6R: serialize redemptions for each customer against the canonical points ledger.
CREATE OR REPLACE FUNCTION public.redeem_customer_loyalty_points(
  p_customer_id uuid, p_points integer, p_reason text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_balance integer;
BEGIN
  IF p_points IS NULL OR p_points <= 0 OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Positive points and reason required';
  END IF;
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  SELECT COALESCE(SUM(points), 0)::integer INTO current_balance
    FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
  IF current_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
  INSERT INTO public.loyalty_point_transactions
    (customer_id, points, transaction_type, reason)
    VALUES (p_customer_id, -p_points, 'redemption', btrim(p_reason));
  RETURN current_balance - p_points;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text) FROM PUBLIC;
-- Checkout redemption uses the atomic order creation function below instead.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_loyalty_points_redeemed_nonnegative;
ALTER TABLE public.orders ADD CONSTRAINT orders_loyalty_points_redeemed_nonnegative
  CHECK (loyalty_points_redeemed >= 0);

CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid; v_balance integer;
BEGIN
  IF p_points IS NULL OR p_points < 0 OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid order rewards or items';
  END IF;
  IF p_points > 0 THEN
    PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT COALESCE(SUM(points), 0)::integer INTO v_balance
      FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
    IF v_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
    IF (p_order->>'loyalty_discount_amount')::numeric <> p_points::numeric / 100 THEN
      RAISE EXCEPTION 'Invalid loyalty discount';
    END IF;
  END IF;
  INSERT INTO public.orders (
    customer_id, facility_id, current_status, pickup_address_id, delivery_address_id,
    pickup_scheduled_at, pickup_slot_label, subtotal, discount_amount,
    pickup_delivery_charge, taxable_amount, gst_rate, gst_amount, total_amount,
    payment_method, terms_accepted, terms_accepted_at, terms_version, loyalty_points_redeemed
  ) VALUES (
    p_customer_id, (p_order->>'facility_id')::uuid, 'draft',
    (p_order->>'pickup_address_id')::uuid, (p_order->>'delivery_address_id')::uuid,
    (p_order->>'pickup_scheduled_at')::timestamptz, p_order->>'pickup_slot_label',
    (p_order->>'subtotal')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric, (p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric, (p_order->>'gst_amount')::numeric,
    (p_order->>'total_amount')::numeric, (p_order->>'payment_method')::public.payment_method,
    true, now(), p_order->>'terms_version', p_points
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items
    (order_id, service_id, item_name, quantity, weight_kg, unit_price, line_total, customer_notes)
  SELECT v_order_id, i.service_id, i.item_name, i.quantity, i.weight_kg,
    i.unit_price, i.line_total, i.customer_notes
  FROM jsonb_to_recordset(p_items) AS i(
    service_id uuid, item_name text, quantity integer, weight_kg numeric,
    unit_price numeric, line_total numeric, customer_notes text
  );
  INSERT INTO public.order_qr_codes(order_id) VALUES (v_order_id);
  IF p_points > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    VALUES (p_customer_id, -p_points, 'redemption', 'Checkout discount', 'order', v_order_id);
  END IF;
  PERFORM public.change_order_status(v_order_id, p_target_status, 'Order created');
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) TO service_role;


-- SOURCE: 30_20260918120000_customer_order_lifecycle_notifications.sql

-- Customer lifecycle notifications are persisted locally by the database.
-- FCM dispatch remains opt-in and credential-gated by the backend dispatcher.
CREATE OR REPLACE FUNCTION public.create_customer_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_title text;
  v_body text;
BEGIN
  IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    RETURN NEW;
  END IF;

  SELECT c.profile_id INTO v_profile_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id;
  IF v_profile_id IS NULL THEN RETURN NEW; END IF;

  SELECT CASE NEW.current_status
    WHEN 'pickup_assigned' THEN 'Pickup driver assigned'
    WHEN 'pickup_otp_pending' THEN 'Driver arriving for pickup'
    WHEN 'picked_up' THEN 'Pickup completed'
    WHEN 'received_at_facility' THEN 'Laundry received at facility'
    WHEN 'processing' THEN 'Laundry processing update'
    WHEN 'ready_for_delivery' THEN 'Ready for delivery'
    WHEN 'en_route_delivery' THEN 'Driver is on the way'
    WHEN 'delivered' THEN 'Order delivered'
    WHEN 'claim_period_active' THEN 'Claim period is active'
    ELSE NULL
  END INTO v_title;
  IF v_title IS NULL THEN RETURN NEW; END IF;

  v_body := format('Order %s: %s', coalesce(NEW.order_number, NEW.id::text), v_title);
  INSERT INTO public.notifications(profile_id, order_id, notification_type, title, body, data, status)
  VALUES (v_profile_id, NEW.id, concat('order.', NEW.current_status), v_title, v_body,
    jsonb_build_object('orderId', NEW.id::text, 'status', NEW.current_status::text), 'queued');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_order_status_notification ON public.orders;
CREATE TRIGGER trg_customer_order_status_notification
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_customer_order_status_notification();


-- SOURCE: 31_20260918130000_6r_restore_cancelled_loyalty.sql

-- Return points once when an order is cancelled through the approved status procedure.
CREATE OR REPLACE FUNCTION public.restore_cancelled_order_loyalty_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status
     AND NEW.loyalty_points_redeemed > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    SELECT NEW.customer_id, NEW.loyalty_points_redeemed, 'restoration',
      'Cancelled order', 'order', NEW.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.loyalty_point_transactions
      WHERE reference_type = 'order' AND reference_id = NEW.id
        AND transaction_type = 'restoration'
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restore_cancelled_order_loyalty_points ON public.orders;
CREATE TRIGGER trg_restore_cancelled_order_loyalty_points
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_order_loyalty_points();


-- SOURCE: 32_20260918140000_6r_minimum_loyalty_redemption.sql

-- Enforce the approved ₹10 checkout minimum at the database boundary.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_loyalty_redemption_minimum;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_loyalty_redemption_minimum
  CHECK (loyalty_points_redeemed = 0 OR loyalty_points_redeemed >= 1000);


-- SOURCE: 33_20260918150000_6r_loyalty_earning.sql

-- Approved earning rate: 0.01 point per ₹1 paid (one whole point per ₹100).
-- Credit once after delivery and payment; COD is treated as collected on delivery.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_order_earned_once
ON public.loyalty_point_transactions(reference_id)
WHERE reference_type = 'order' AND transaction_type = 'earned';

CREATE OR REPLACE FUNCTION public.award_customer_order_loyalty_points(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders%ROWTYPE; v_points integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.current_status NOT IN ('delivered', 'claim_period_active', 'completed') THEN
    RETURN 0;
  END IF;
  IF v_order.payment_method = 'razorpay' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_orders
                   WHERE order_id = p_order_id AND status = 'paid') THEN
      RETURN 0;
    END IF;
  ELSIF v_order.payment_method <> 'cash_on_delivery' THEN
    RETURN 0;
  END IF;
  v_points := floor(GREATEST(v_order.total_amount, 0) / 100)::integer;
  IF v_points < 1 THEN RETURN 0; END IF;
  INSERT INTO public.loyalty_point_transactions
    (customer_id, points, transaction_type, reason, reference_type, reference_id)
  VALUES (v_order.customer_id, v_points, 'earned', 'Order delivered and paid', 'order', p_order_id)
  ON CONFLICT DO NOTHING;
  RETURN v_points;
END;
$$;
REVOKE ALL ON FUNCTION public.award_customer_order_loyalty_points(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_customer_order_loyalty_points(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.award_loyalty_after_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'delivered' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    PERFORM public.award_customer_order_loyalty_points(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_loyalty_after_delivery ON public.orders;
CREATE TRIGGER trg_award_loyalty_after_delivery
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_after_delivery();

CREATE OR REPLACE FUNCTION public.award_loyalty_after_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.award_customer_order_loyalty_points(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_loyalty_after_payment ON public.payment_orders;
CREATE TRIGGER trg_award_loyalty_after_payment
AFTER INSERT OR UPDATE OF status ON public.payment_orders
FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_after_payment();


-- SOURCE: 34_20260918160000_6r_disable_standalone_redemption.sql

-- Preserve the old function for compatibility, but prevent service-role use.
-- Customer redemption is only available in atomic checkout order creation.
REVOKE EXECUTE ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text)
FROM service_role;


-- SOURCE: 35_20260918170000_6s_package_purchase_usage.sql

-- 6S package purchase audit and reversible, order-linked usage.
ALTER TABLE public.package_subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_subscription_payment_reference
  ON public.package_subscriptions(payment_reference)
  WHERE payment_reference IS NOT NULL;

ALTER TABLE public.package_usage
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_usage_order_service
  ON public.package_usage(subscription_id, order_id, service_id)
  WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.restore_cancelled_order_package_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    UPDATE public.package_usage SET reversed_at = now()
    WHERE order_id = NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restore_cancelled_order_package_usage ON public.orders;
CREATE TRIGGER trg_restore_cancelled_order_package_usage
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_order_package_usage();


-- SOURCE: 36_20260918180000_6s_atomic_package_order.sql

-- Serialise consumption per subscription and create the order in one transaction.
CREATE OR REPLACE FUNCTION public.create_customer_order_with_package_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer,
  p_subscription_id uuid, p_coverages jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_subscription public.package_subscriptions%ROWTYPE;
  v_coverage record; v_item record; v_limit record;
  v_used integer; v_package_discount numeric(12,2) := 0; v_order_id uuid;
BEGIN
  SELECT * INTO v_subscription FROM public.package_subscriptions
  WHERE id = p_subscription_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_subscription.status <> 'active'
     OR v_subscription.starts_at > now() OR v_subscription.expires_at <= now() THEN
    RAISE EXCEPTION 'Package is unavailable or expired';
  END IF;
  IF p_coverages IS NULL OR jsonb_array_length(p_coverages) = 0 THEN
    RAISE EXCEPTION 'No eligible package credits selected';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_coverages)
    AS c(service_id uuid, quantity integer)
    GROUP BY service_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate package service';
  END IF;
  FOR v_coverage IN SELECT * FROM jsonb_to_recordset(p_coverages)
    AS c(service_id uuid, quantity integer) LOOP
    SELECT * INTO v_item FROM jsonb_to_recordset(p_items)
      AS i(service_id uuid, quantity integer, unit_price numeric)
      WHERE service_id = v_coverage.service_id;
    SELECT * INTO v_limit FROM public.package_services
      WHERE package_id = v_subscription.package_id
        AND service_id = v_coverage.service_id;
    IF NOT FOUND OR v_coverage.quantity IS NULL OR v_coverage.quantity <= 0
       OR v_item.service_id IS NULL OR v_item.quantity < v_coverage.quantity THEN
      RAISE EXCEPTION 'Package service is not eligible for this order';
    END IF;
    SELECT COALESCE(SUM(usage_quantity), 0)::integer INTO v_used
      FROM public.package_usage
      WHERE subscription_id = p_subscription_id
        AND service_id = v_coverage.service_id AND reversed_at IS NULL;
    IF v_limit.usage_limit IS NOT NULL
       AND v_used + v_coverage.quantity > v_limit.usage_limit THEN
      RAISE EXCEPTION 'Package balance is insufficient';
    END IF;
    v_package_discount := v_package_discount + v_coverage.quantity * v_item.unit_price;
  END LOOP;
  IF v_package_discount <= 0
     OR v_package_discount <> (p_order->>'package_discount_amount')::numeric
     OR v_package_discount > (p_order->>'discount_amount')::numeric THEN
    RAISE EXCEPTION 'Package discount is invalid';
  END IF;
  v_order_id := public.create_customer_order_with_rewards_atomic(
    p_customer_id, p_order, p_items, p_target_status, p_points);
  INSERT INTO public.package_usage
    (subscription_id, service_id, order_id, usage_quantity, customer_id, package_service_id)
  SELECT p_subscription_id, c.service_id, v_order_id, c.quantity,
    p_customer_id, ps.id
  FROM jsonb_to_recordset(p_coverages) AS c(service_id uuid, quantity integer)
  JOIN public.package_services ps ON ps.package_id = v_subscription.package_id
    AND ps.service_id = c.service_id;
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_package_atomic(uuid, jsonb, jsonb, public.order_status, integer, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_package_atomic(uuid, jsonb, jsonb, public.order_status, integer, uuid, jsonb) TO service_role;


-- SOURCE: 37_20260918190000_6u2_order_create_idempotency.sql

-- 6U.2: the client keeps the same key for retries; the unique index serializes concurrent inserts.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_idempotency_key_unique
  ON public.orders(customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid; v_balance integer;
BEGIN
  IF p_points IS NULL OR p_points < 0 OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid order rewards or items';
  END IF;
  IF p_points > 0 THEN
    PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT COALESCE(SUM(points), 0)::integer INTO v_balance
      FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
    IF v_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
    IF (p_order->>'loyalty_discount_amount')::numeric <> p_points::numeric / 100 THEN
      RAISE EXCEPTION 'Invalid loyalty discount';
    END IF;
  END IF;
  INSERT INTO public.orders (
    customer_id, facility_id, current_status, pickup_address_id, delivery_address_id,
    pickup_scheduled_at, pickup_slot_label, subtotal, discount_amount,
    pickup_delivery_charge, taxable_amount, gst_rate, gst_amount, total_amount,
    payment_method, terms_accepted, terms_accepted_at, terms_version, loyalty_points_redeemed,
    idempotency_key, idempotency_request_hash
  ) VALUES (
    p_customer_id, (p_order->>'facility_id')::uuid, 'draft',
    (p_order->>'pickup_address_id')::uuid, (p_order->>'delivery_address_id')::uuid,
    (p_order->>'pickup_scheduled_at')::timestamptz, p_order->>'pickup_slot_label',
    (p_order->>'subtotal')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric, (p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric, (p_order->>'gst_amount')::numeric,
    (p_order->>'total_amount')::numeric, (p_order->>'payment_method')::public.payment_method,
    true, now(), p_order->>'terms_version', p_points,
    (p_order->>'idempotency_key')::uuid, p_order->>'idempotency_request_hash'
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items
    (order_id, service_id, item_name, quantity, weight_kg, unit_price, line_total, customer_notes)
  SELECT v_order_id, i.service_id, i.item_name, i.quantity, i.weight_kg,
    i.unit_price, i.line_total, i.customer_notes
  FROM jsonb_to_recordset(p_items) AS i(
    service_id uuid, item_name text, quantity integer, weight_kg numeric,
    unit_price numeric, line_total numeric, customer_notes text
  );
  INSERT INTO public.order_qr_codes(order_id) VALUES (v_order_id);
  IF p_points > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    VALUES (p_customer_id, -p_points, 'redemption', 'Checkout discount', 'order', v_order_id);
  END IF;
  PERFORM public.change_order_status(v_order_id, p_target_status, 'Order created');
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) TO service_role;

