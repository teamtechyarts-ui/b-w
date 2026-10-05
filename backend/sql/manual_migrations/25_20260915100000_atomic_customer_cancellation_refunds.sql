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
