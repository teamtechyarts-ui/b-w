-- ============================================================
-- BRIGHT & WHITE
-- HARDEN CUSTOMER CLAIM PHOTOS STORAGE & WEBP ATTACHMENT
-- ============================================================

-- Ensure customer-claim-photos bucket is private and strictly constrained to WebP <= 80 KB
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
    81920, -- 80 KB maximum limit
    ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
    public = false,
    file_size_limit = 81920,
    allowed_mime_types = ARRAY['image/webp']::text[];

-- Update attachment function to support WebP claim photos
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

REVOKE ALL ON FUNCTION public.attach_customer_claim_photo_atomic(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.attach_customer_claim_photo_atomic(uuid, uuid, text)
TO service_role;
