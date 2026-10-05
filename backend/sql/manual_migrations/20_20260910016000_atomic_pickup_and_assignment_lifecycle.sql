-- Runtime Gates 4 and 6: keep assignment, navigation, and pickup OTP
-- transitions consistent with the C2 order lifecycle.
--
-- All functions are callable only by the backend service role. They lock the
-- order before related rows, revalidate current state inside the transaction,
-- and delegate every order transition to the unchanged change_order_status().

CREATE OR REPLACE FUNCTION public.create_driver_assignment_atomic(
    p_order_id uuid,
    p_driver_id uuid,
    p_assignment_type public.assignment_type,
    p_assignment_score numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver public.drivers%ROWTYPE;
    v_assignment public.driver_assignments%ROWTYPE;
    v_expected_status public.order_status;
    v_retry_status public.order_status;
    v_target_status public.order_status;
    v_active_jobs integer;
BEGIN
    IF p_order_id IS NULL OR p_driver_id IS NULL OR p_assignment_type IS NULL THEN
        RAISE EXCEPTION 'Order, driver, and assignment type are required'
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

    IF p_assignment_type = 'pickup'::public.assignment_type THEN
        v_expected_status := 'confirmed'::public.order_status;
        v_retry_status := 'pickup_failed'::public.order_status;
        v_target_status := 'pickup_assigned'::public.order_status;
    ELSE
        v_expected_status := 'ready_for_delivery'::public.order_status;
        v_retry_status := 'delivery_failed'::public.order_status;
        v_target_status := 'delivery_assigned'::public.order_status;
    END IF;

    IF v_order_status NOT IN (v_expected_status, v_retry_status) THEN
        RAISE EXCEPTION '% assignment is not allowed while order is %',
            p_assignment_type,
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    SELECT d.*
    INTO v_driver
    FROM public.drivers AS d
    WHERE d.id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND OR NOT v_driver.is_active OR NOT v_driver.is_available THEN
        RAISE EXCEPTION 'Selected driver is not active and available'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
    INTO v_active_jobs
    FROM public.driver_assignments AS assignment
    WHERE assignment.driver_id = p_driver_id
      AND assignment.status IN (
          'assigned'::public.assignment_status,
          'accepted'::public.assignment_status,
          'en_route'::public.assignment_status,
          'arrived'::public.assignment_status
      );

    IF v_active_jobs >= v_driver.max_concurrent_jobs THEN
        RAISE EXCEPTION 'Selected driver has reached the active-job limit'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.driver_assignments AS assignment
        WHERE assignment.order_id = p_order_id
          AND assignment.assignment_type = p_assignment_type
          AND assignment.status IN (
              'assigned'::public.assignment_status,
              'accepted'::public.assignment_status,
              'en_route'::public.assignment_status,
              'arrived'::public.assignment_status
          )
    ) THEN
        RAISE EXCEPTION 'An active assignment already exists'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.driver_assignments (
        order_id,
        driver_id,
        assignment_type,
        assignment_score,
        status
    )
    VALUES (
        p_order_id,
        p_driver_id,
        p_assignment_type,
        p_assignment_score,
        'assigned'::public.assignment_status
    )
    RETURNING * INTO v_assignment;

    PERFORM public.change_order_status(
        p_order_id,
        v_target_status,
        format('%s driver assigned', p_assignment_type)
    );

    RETURN jsonb_build_object(
        'assignment', to_jsonb(v_assignment),
        'orderStatus', v_target_status::text
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_driver_assignment_atomic(
    p_assignment_id uuid,
    p_driver_id uuid,
    p_action text,
    p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id uuid;
    v_order_status public.order_status;
    v_assignment public.driver_assignments%ROWTYPE;
    v_expected_order_status public.order_status;
    v_target_order_status public.order_status;
    v_target_assignment_status public.assignment_status;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
BEGIN
    IF p_assignment_id IS NULL OR p_driver_id IS NULL OR p_action IS NULL THEN
        RAISE EXCEPTION 'Assignment, driver, and action are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT assignment.order_id
    INTO v_order_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT assignment.*
    INTO v_assignment
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    IF p_action IN ('accept', 'reject') THEN
        IF v_assignment.status <> 'assigned'::public.assignment_status THEN
            RAISE EXCEPTION 'Assignment can no longer be responded to'
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment.assignment_type = 'pickup'::public.assignment_type THEN
            v_expected_order_status := 'pickup_assigned'::public.order_status;
            v_target_order_status := CASE p_action
                WHEN 'accept' THEN 'pickup_accepted'::public.order_status
                ELSE 'pickup_failed'::public.order_status
            END;
        ELSE
            v_expected_order_status := 'delivery_assigned'::public.order_status;
            v_target_order_status := CASE p_action
                WHEN 'accept' THEN 'delivery_accepted'::public.order_status
                ELSE 'delivery_failed'::public.order_status
            END;
        END IF;

        v_target_assignment_status := CASE p_action
            WHEN 'accept' THEN 'accepted'::public.assignment_status
            ELSE 'rejected'::public.assignment_status
        END;

        UPDATE public.driver_assignments
        SET
            status = v_target_assignment_status,
            accepted_at = CASE p_action WHEN 'accept' THEN v_now ELSE accepted_at END,
            rejection_reason = CASE
                WHEN p_action = 'reject' THEN coalesce(nullif(p_rejection_reason, ''), 'Rejected by driver')
                ELSE rejection_reason
            END
        WHERE id = p_assignment_id
          AND status = 'assigned'::public.assignment_status
        RETURNING * INTO v_assignment;

    ELSIF p_action = 'start_navigation' THEN
        IF v_assignment.status <> 'accepted'::public.assignment_status THEN
            RAISE EXCEPTION 'Only an accepted assignment can start navigation'
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment.assignment_type = 'pickup'::public.assignment_type THEN
            v_expected_order_status := 'pickup_accepted'::public.order_status;
            v_target_order_status := 'en_route_pickup'::public.order_status;
        ELSE
            v_expected_order_status := 'delivery_accepted'::public.order_status;
            v_target_order_status := 'en_route_delivery'::public.order_status;
        END IF;

        v_target_assignment_status := 'en_route'::public.assignment_status;

        UPDATE public.driver_assignments
        SET status = v_target_assignment_status
        WHERE id = p_assignment_id
          AND status = 'accepted'::public.assignment_status
        RETURNING * INTO v_assignment;

    ELSIF p_action = 'arrive' THEN
        IF v_assignment.status <> 'en_route'::public.assignment_status THEN
            RAISE EXCEPTION 'Only an en-route assignment can be marked arrived'
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment.assignment_type = 'pickup'::public.assignment_type THEN
            v_expected_order_status := 'en_route_pickup'::public.order_status;
            v_target_order_status := 'pickup_otp_pending'::public.order_status;
        ELSE
            v_expected_order_status := 'en_route_delivery'::public.order_status;
            v_target_order_status := 'delivery_otp_pending'::public.order_status;
        END IF;

        v_target_assignment_status := 'arrived'::public.assignment_status;

        UPDATE public.driver_assignments
        SET status = v_target_assignment_status
        WHERE id = p_assignment_id
          AND status = 'en_route'::public.assignment_status
        RETURNING * INTO v_assignment;

    ELSE
        RAISE EXCEPTION 'Unsupported assignment action: %', p_action
            USING ERRCODE = '22023';
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    IF v_order_status <> v_expected_order_status THEN
        RAISE EXCEPTION 'Order is not in the expected assignment state'
            USING ERRCODE = '23514';
    END IF;

    PERFORM public.change_order_status(
        v_order_id,
        v_target_order_status,
        CASE p_action
            WHEN 'accept' THEN format('%s assignment accepted', v_assignment.assignment_type)
            WHEN 'reject' THEN format('%s assignment rejected', v_assignment.assignment_type)
            WHEN 'start_navigation' THEN format('%s driver started navigation', v_assignment.assignment_type)
            ELSE format('%s driver arrived', v_assignment.assignment_type)
        END
    );

    IF p_action = 'start_navigation' THEN
        INSERT INTO public.driver_navigation_events (
            driver_id,
            order_id,
            event_type
        )
        VALUES (
            p_driver_id,
            v_order_id,
            format('navigate_%s', v_assignment.assignment_type)
        );
    END IF;

    RETURN jsonb_build_object(
        'assignment', to_jsonb(v_assignment),
        'assignmentId', p_assignment_id,
        'orderId', v_order_id,
        'assignmentStatus', v_target_assignment_status::text,
        'orderStatus', v_target_order_status::text
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_facility_transit_atomic(
    p_assignment_id uuid,
    p_driver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id uuid;
    v_order public.orders%ROWTYPE;
    v_assignment public.driver_assignments%ROWTYPE;
    v_facility public.facilities%ROWTYPE;
BEGIN
    IF p_assignment_id IS NULL OR p_driver_id IS NULL THEN
        RAISE EXCEPTION 'Assignment and driver are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT assignment.order_id
    INTO v_order_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT assignment.*
    INTO v_assignment
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_assignment.assignment_type <> 'pickup'::public.assignment_type
       OR v_assignment.status <> 'arrived'::public.assignment_status THEN
        RAISE EXCEPTION 'An arrived pickup assignment is required'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status <> 'picked_up'::public.order_status THEN
        RAISE EXCEPTION 'Facility transit is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF v_order.facility_id IS NULL THEN
        RAISE EXCEPTION 'Order has no assigned facility'
            USING ERRCODE = '23514';
    END IF;

    SELECT facility.*
    INTO v_facility
    FROM public.facilities AS facility
    WHERE facility.id = v_order.facility_id
    FOR SHARE;

    IF NOT FOUND
       OR NOT v_facility.is_active
       OR v_facility.latitude IS NULL
       OR v_facility.longitude IS NULL THEN
        RAISE EXCEPTION 'Assigned facility has no active route destination'
            USING ERRCODE = '23514';
    END IF;

    PERFORM public.change_order_status(
        v_order.id,
        'in_transit_to_facility'::public.order_status,
        'Pickup driver started transit to facility'
    );

    INSERT INTO public.driver_navigation_events (
        driver_id,
        order_id,
        event_type,
        destination_latitude,
        destination_longitude
    )
    VALUES (
        p_driver_id,
        v_order.id,
        'navigate_facility',
        v_facility.latitude,
        v_facility.longitude
    );

    RETURN jsonb_build_object(
        'assignmentId', p_assignment_id,
        'orderId', v_order.id,
        'assignmentStatus', 'arrived',
        'orderStatus', 'in_transit_to_facility'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_order_otp_atomic(
    p_order_id uuid,
    p_otp_type text,
    p_otp_hash text,
    p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_expected_status public.order_status;
    v_otp public.order_otps%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL
       OR p_otp_type IS NULL
       OR p_otp_type NOT IN ('pickup', 'delivery')
       OR p_otp_hash IS NULL
       OR p_otp_hash = ''
       OR p_expires_at IS NULL
       OR p_expires_at <= v_now THEN
        RAISE EXCEPTION 'Valid order, OTP type, hash, and future expiry are required'
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

    v_expected_status := CASE p_otp_type
        WHEN 'pickup' THEN 'pickup_otp_pending'::public.order_status
        ELSE 'delivery_otp_pending'::public.order_status
    END;

    IF v_order_status <> v_expected_status THEN
        RAISE EXCEPTION 'OTP cannot be created while order is %', v_order_status
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.order_otps
    SET expires_at = least(expires_at, v_now)
    WHERE order_id = p_order_id
      AND otp_type = p_otp_type
      AND verified_at IS NULL
      AND expires_at > v_now;

    INSERT INTO public.order_otps (
        order_id,
        otp_type,
        otp_hash,
        expires_at
    )
    VALUES (
        p_order_id,
        p_otp_type,
        p_otp_hash,
        p_expires_at
    )
    RETURNING * INTO v_otp;

    RETURN jsonb_build_object(
        'id', v_otp.id,
        'otpType', v_otp.otp_type,
        'expiresAt', v_otp.expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pickup_otp_failure_attempt(
    p_order_id uuid,
    p_driver_profile_id uuid,
    p_otp_id uuid,
    p_expected_otp_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver_id uuid;
    v_otp public.order_otps%ROWTYPE;
    v_attempt_count integer;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL
       OR p_driver_profile_id IS NULL
       OR p_otp_id IS NULL
       OR p_expected_otp_hash IS NULL
       OR p_expected_otp_hash = '' THEN
        RAISE EXCEPTION 'Order, driver, OTP, and expected hash are required'
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

    IF v_order_status <> 'pickup_otp_pending'::public.order_status THEN
        RAISE EXCEPTION 'Pickup OTP is not pending'
            USING ERRCODE = '23514';
    END IF;

    SELECT d.id
    INTO v_driver_id
    FROM public.drivers AS d
    WHERE d.profile_id = p_driver_profile_id
      AND d.is_active
    FOR SHARE;

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.driver_assignments AS assignment
        WHERE assignment.order_id = p_order_id
          AND assignment.driver_id = v_driver_id
          AND assignment.assignment_type = 'pickup'::public.assignment_type
          AND assignment.status = 'arrived'::public.assignment_status
    ) THEN
        RAISE EXCEPTION 'Arrived pickup driver access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'pickup'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.otp_hash IS DISTINCT FROM p_expected_otp_hash THEN
        RAISE EXCEPTION 'Pickup OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    IF v_otp.verified_at IS NOT NULL OR v_otp.expires_at <= v_now THEN
        RAISE EXCEPTION 'Pickup OTP is expired or already used'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Pickup OTP attempts exceeded'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.order_otps
    SET attempt_count = attempt_count + 1
    WHERE id = p_otp_id
    RETURNING attempt_count INTO v_attempt_count;

    RETURN v_attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pickup_otp_verification(
    p_order_id uuid,
    p_driver_profile_id uuid,
    p_otp_id uuid,
    p_validated_otp_hash text
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
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
    v_reason text;
BEGIN
    IF p_order_id IS NULL
       OR p_driver_profile_id IS NULL
       OR p_otp_id IS NULL
       OR p_validated_otp_hash IS NULL
       OR p_validated_otp_hash = '' THEN
        RAISE EXCEPTION 'Order, driver, OTP, and validated hash are required'
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

    IF v_order_status <> 'pickup_otp_pending'::public.order_status THEN
        RAISE EXCEPTION 'Pickup verification is not allowed while order is %',
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

    SELECT assignment.id
    INTO v_assignment_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.order_id = p_order_id
      AND assignment.driver_id = v_driver_id
      AND assignment.assignment_type = 'pickup'::public.assignment_type
      AND assignment.status = 'arrived'::public.assignment_status
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No arrived pickup assignment found for this driver'
            USING ERRCODE = '23514';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'pickup'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.verified_at IS NOT NULL
       OR v_otp.expires_at <= v_now
       OR v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Pickup OTP is expired, used, or attempt-limited'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.otp_hash IS DISTINCT FROM p_validated_otp_hash THEN
        RAISE EXCEPTION 'Pickup OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.order_otps
    SET
        verified_at = v_now,
        verified_by = p_driver_profile_id
    WHERE id = p_otp_id
      AND verified_at IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Pickup OTP was consumed concurrently'
            USING ERRCODE = '40001';
    END IF;

    v_reason := format('Pickup OTP verified (assignment %s)', v_assignment_id);

    PERFORM public.change_order_status(
        p_order_id,
        'picked_up'::public.order_status,
        v_reason
    );

    UPDATE public.order_status_history AS history
    SET changed_by = p_driver_profile_id
    WHERE history.order_id = p_order_id
      AND history.from_status = 'pickup_otp_pending'::public.order_status
      AND history.to_status = 'picked_up'::public.order_status
      AND history.reason = v_reason;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Pickup status history was not recorded'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'verified', true,
        'orderId', p_order_id,
        'otpType', 'pickup',
        'orderStatus', 'picked_up'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_driver_assignment_atomic(
    uuid,
    uuid,
    public.assignment_type,
    numeric
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_driver_assignment_atomic(
    uuid,
    uuid,
    public.assignment_type,
    numeric
)
TO service_role;

REVOKE ALL ON FUNCTION public.transition_driver_assignment_atomic(
    uuid,
    uuid,
    text,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.transition_driver_assignment_atomic(
    uuid,
    uuid,
    text,
    text
)
TO service_role;

REVOKE ALL ON FUNCTION public.start_facility_transit_atomic(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_facility_transit_atomic(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.create_order_otp_atomic(
    uuid,
    text,
    text,
    timestamptz
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order_otp_atomic(
    uuid,
    text,
    text,
    timestamptz
)
TO service_role;

REVOKE ALL ON FUNCTION public.record_pickup_otp_failure_attempt(
    uuid,
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_pickup_otp_failure_attempt(
    uuid,
    uuid,
    uuid,
    text
)
TO service_role;

REVOKE ALL ON FUNCTION public.complete_pickup_otp_verification(
    uuid,
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_pickup_otp_verification(
    uuid,
    uuid,
    uuid,
    text
)
TO service_role;

COMMENT ON FUNCTION public.create_driver_assignment_atomic(
    uuid,
    uuid,
    public.assignment_type,
    numeric
)
IS 'Atomically creates an active driver assignment and advances the C2 order state.';

COMMENT ON FUNCTION public.transition_driver_assignment_atomic(
    uuid,
    uuid,
    text,
    text
)
IS 'Atomically accepts, rejects, starts, or arrives a driver assignment with its C2 transition.';

COMMENT ON FUNCTION public.start_facility_transit_atomic(uuid, uuid)
IS 'Atomically starts pickup transit to the assigned facility and records its navigation event.';

COMMENT ON FUNCTION public.create_order_otp_atomic(uuid, text, text, timestamptz)
IS 'Serializes OTP replacement so one unexpired code remains active per order and type.';

COMMENT ON FUNCTION public.record_pickup_otp_failure_attempt(uuid, uuid, uuid, text)
IS 'Locks a pickup OTP and records exactly one failed verification attempt.';

COMMENT ON FUNCTION public.complete_pickup_otp_verification(uuid, uuid, uuid, text)
IS 'Atomically consumes the assigned driver pickup OTP and advances the order to picked up.';
