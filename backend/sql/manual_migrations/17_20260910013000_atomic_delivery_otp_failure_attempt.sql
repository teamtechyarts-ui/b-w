-- Serialize failed delivery OTP attempts so concurrent guesses cannot collapse
-- into one counter update. The OTP plaintext never crosses this boundary; Nest
-- compares the scrypt hash and supplies the exact row version it inspected.

CREATE OR REPLACE FUNCTION public.record_delivery_otp_failure_attempt(
    p_order_id uuid,
    p_otp_id uuid,
    p_expected_otp_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_otp public.order_otps%ROWTYPE;
    v_attempt_count integer;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_otp_id IS NULL THEN
        RAISE EXCEPTION 'Order and OTP are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_expected_otp_hash IS NULL OR p_expected_otp_hash = '' THEN
        RAISE EXCEPTION 'Expected OTP hash is required'
            USING ERRCODE = '22023';
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

    IF v_otp.otp_hash IS DISTINCT FROM p_expected_otp_hash THEN
        RAISE EXCEPTION 'Delivery OTP changed during verification'
            USING ERRCODE = '40001';
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

    UPDATE public.order_otps
    SET attempt_count = attempt_count + 1
    WHERE id = p_otp_id
    RETURNING attempt_count
    INTO v_attempt_count;

    RETURN v_attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_delivery_otp_failure_attempt(
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_delivery_otp_failure_attempt(
    uuid,
    uuid,
    text
)
TO service_role;

COMMENT ON FUNCTION public.record_delivery_otp_failure_attempt(
    uuid,
    uuid,
    text
)
IS 'Locks one delivery OTP and records exactly one failed verification attempt.';
