-- 20261003140000_availability_driver_job_dispatch.sql
-- Allow direct transition from confirmed/ready_for_delivery to accepted states on atomic driver claim
INSERT INTO public.order_status_transitions (from_status, to_status)
VALUES
    ('confirmed', 'pickup_accepted'),
    ('pickup_failed', 'pickup_accepted'),
    ('ready_for_delivery', 'delivery_accepted'),
    ('delivery_failed', 'delivery_accepted')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- Atomic Claim Driver Job RPC
CREATE OR REPLACE FUNCTION public.claim_driver_job_atomic(
    p_order_id uuid,
    p_driver_id uuid,
    p_job_type public.assignment_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_order_facility_id uuid;
    v_driver public.drivers%ROWTYPE;
    v_assignment public.driver_assignments%ROWTYPE;
    v_expected_status public.order_status;
    v_retry_status public.order_status;
    v_target_status public.order_status;
    v_active_jobs integer;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_driver_id IS NULL OR p_job_type IS NULL THEN
        RAISE EXCEPTION 'Order, driver, and job type are required'
            USING ERRCODE = '22023';
    END IF;

    -- Lock order row
    SELECT o.current_status, o.facility_id
    INTO v_order_status, v_order_facility_id
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF p_job_type = 'pickup'::public.assignment_type THEN
        v_expected_status := 'confirmed'::public.order_status;
        v_retry_status := 'pickup_failed'::public.order_status;
        v_target_status := 'pickup_accepted'::public.order_status;
    ELSE
        v_expected_status := 'ready_for_delivery'::public.order_status;
        v_retry_status := 'delivery_failed'::public.order_status;
        v_target_status := 'delivery_accepted'::public.order_status;
    END IF;

    IF v_order_status NOT IN (v_expected_status, v_retry_status) THEN
        RAISE EXCEPTION 'Job is no longer available (order is %)', v_order_status
            USING ERRCODE = '23514';
    END IF;

    -- Lock driver row
    SELECT d.*
    INTO v_driver
    FROM public.drivers AS d
    WHERE d.id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND OR NOT v_driver.is_active OR NOT v_driver.is_available THEN
        RAISE EXCEPTION 'Driver is not active and available'
            USING ERRCODE = '23514';
    END IF;


    -- Check active workload capacity
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
        RAISE EXCEPTION 'Driver has reached the maximum concurrent jobs limit'
            USING ERRCODE = '23514';
    END IF;

    -- Check if another active assignment exists for this order
    IF EXISTS (
        SELECT 1
        FROM public.driver_assignments AS assignment
        WHERE assignment.order_id = p_order_id
          AND assignment.assignment_type = p_job_type
          AND assignment.status IN (
              'assigned'::public.assignment_status,
              'accepted'::public.assignment_status,
              'en_route'::public.assignment_status,
              'arrived'::public.assignment_status
          )
    ) THEN
        RAISE EXCEPTION 'Job has already been claimed by another driver'
            USING ERRCODE = '23505';
    END IF;

    -- Insert accepted assignment
    INSERT INTO public.driver_assignments (
        order_id,
        driver_id,
        assignment_type,
        assignment_score,
        status,
        assigned_at,
        accepted_at
    )
    VALUES (
        p_order_id,
        p_driver_id,
        p_job_type,
        1.0,
        'accepted'::public.assignment_status,
        v_now,
        v_now
    )
    RETURNING * INTO v_assignment;

    PERFORM public.change_order_status(
        p_order_id,
        v_target_status,
        format('%s driver accepted job', p_job_type)
    );

    RETURN jsonb_build_object(
        'assignment', to_jsonb(v_assignment),
        'orderStatus', v_target_status::text
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_driver_job_atomic(uuid, uuid, public.assignment_type) TO service_role;
