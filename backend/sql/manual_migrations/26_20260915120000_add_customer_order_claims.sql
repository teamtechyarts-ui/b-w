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
