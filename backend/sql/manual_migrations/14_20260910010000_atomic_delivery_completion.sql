-- Runtime Gate 6: finish delivery in one transaction.
--
-- Nest verifies the repository's scrypt OTP hash before calling this
-- service-role-only function. PostgreSQL locks and rechecks that exact OTP
-- record, then commits the proof, assignment, and two existing C2 order
-- transitions together. The change_order_status function and its grants are
-- intentionally unchanged.

CREATE OR REPLACE FUNCTION public.complete_delivery_atomic(
    p_order_id uuid,
    p_driver_profile_id uuid,
    p_otp_id uuid,
    p_validated_otp_hash text,
    p_photo_path text,
    p_latitude numeric,
    p_longitude numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver_id uuid;
    v_assignment_id uuid;
    v_otp public.order_otps%ROWTYPE;
    v_object_name text;
    v_claim_deadline_at timestamptz;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
    v_delivery_reason text;
    v_claim_reason text;
BEGIN
    IF p_order_id IS NULL
       OR p_driver_profile_id IS NULL
       OR p_otp_id IS NULL THEN
        RAISE EXCEPTION 'Order, driver profile, and OTP are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_validated_otp_hash IS NULL OR p_validated_otp_hash = '' THEN
        RAISE EXCEPTION 'Validated OTP hash is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_photo_path IS NULL
       OR length(p_photo_path) > 1024
       OR p_photo_path !~ (
            '^' || p_order_id::text ||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
       ) THEN
        RAISE EXCEPTION 'Invalid delivery proof path'
            USING ERRCODE = '22023';
    END IF;

    IF (p_latitude IS NULL) <> (p_longitude IS NULL)
       OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'Invalid delivery coordinates'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'delivery_otp_pending'::public.order_status THEN
        RAISE EXCEPTION
            'Delivery completion is not allowed while order is %',
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    SELECT d.id
    INTO v_driver_id
    FROM public.drivers AS d
    WHERE d.profile_id = p_driver_profile_id
      AND d.is_active
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active driver profile not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT da.id
    INTO v_assignment_id
    FROM public.driver_assignments AS da
    WHERE da.order_id = p_order_id
      AND da.driver_id = v_driver_id
      AND da.assignment_type = 'delivery'::public.assignment_type
      AND da.status = 'arrived'::public.assignment_status
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'No arrived delivery assignment found for this driver'
            USING ERRCODE = '23514';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'delivery'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Delivery OTP has already been used'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.expires_at <= v_now THEN
        RAISE EXCEPTION 'Delivery OTP expired'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Delivery OTP attempts exceeded'
            USING ERRCODE = '23514';
    END IF;

    -- Confirm that the locked row is the same version Nest validated.
    IF v_otp.otp_hash IS DISTINCT FROM p_validated_otp_hash THEN
        RAISE EXCEPTION 'Delivery OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    -- Lock Storage metadata so object deletion cannot race this transaction.
    SELECT so.name
    INTO v_object_name
    FROM storage.objects AS so
    WHERE so.bucket_id = 'delivery-proofs'
      AND so.name = p_photo_path
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery photograph has not been uploaded'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.delivery_proofs (
        order_id,
        driver_id,
        photo_path,
        latitude,
        longitude,
        delivered_at
    )
    VALUES (
        p_order_id,
        v_driver_id,
        p_photo_path,
        p_latitude,
        p_longitude,
        v_now
    );

    UPDATE public.order_otps
    SET
        verified_at = v_now,
        verified_by = p_driver_profile_id
    WHERE id = p_otp_id
      AND verified_at IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Delivery OTP was consumed concurrently'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.driver_assignments
    SET
        status = 'completed'::public.assignment_status,
        completed_at = v_now
    WHERE id = v_assignment_id
      AND status = 'arrived'::public.assignment_status;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Delivery assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    v_delivery_reason := format(
        'Delivery OTP and mandatory photograph verified (assignment %s)',
        v_assignment_id
    );

    PERFORM public.change_order_status(
        p_order_id,
        'delivered'::public.order_status,
        v_delivery_reason
    );

    UPDATE public.order_status_history AS history
    SET changed_by = p_driver_profile_id
    WHERE history.order_id = p_order_id
      AND history.from_status = 'delivery_otp_pending'::public.order_status
      AND history.to_status = 'delivered'::public.order_status
      AND history.reason = v_delivery_reason;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Delivered status history was not recorded'
            USING ERRCODE = '40001';
    END IF;

    v_claim_reason := format(
        'Seven-day delivery claim period started (assignment %s)',
        v_assignment_id
    );

    PERFORM public.change_order_status(
        p_order_id,
        'claim_period_active'::public.order_status,
        v_claim_reason
    );

    UPDATE public.order_status_history AS history
    SET changed_by = p_driver_profile_id
    WHERE history.order_id = p_order_id
      AND history.from_status = 'delivered'::public.order_status
      AND history.to_status = 'claim_period_active'::public.order_status
      AND history.reason = v_claim_reason;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Claim-period status history was not recorded'
            USING ERRCODE = '40001';
    END IF;

    SELECT o.claim_deadline_at
    INTO v_claim_deadline_at
    FROM public.orders AS o
    WHERE o.id = p_order_id;

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'assignmentId', v_assignment_id,
        'delivered', true,
        'orderStatus', 'claim_period_active',
        'assignmentStatus', 'completed',
        'claimPeriodDays', 7,
        'claimDeadlineAt', v_claim_deadline_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_delivery_atomic(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_delivery_atomic(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric
)
TO service_role;

COMMENT ON FUNCTION public.complete_delivery_atomic(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric
)
IS 'Atomically records delivery proof, consumes the OTP, completes the assignment, and starts the claim period.';
