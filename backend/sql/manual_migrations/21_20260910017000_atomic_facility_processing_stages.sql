-- Keep processing-stage authorization, sequence validation, and mutations in
-- one database transaction. The existing facility sequence trigger remains
-- the authority for stage ordering and delegates order transitions to C2.

CREATE OR REPLACE FUNCTION public.start_facility_processing_atomic(
    p_order_id uuid,
    p_performed_by uuid,
    p_process_type text,
    p_machine_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_previous public.facility_order_operations%ROWTYPE;
    v_machine public.facility_machines%ROWTYPE;
    v_operation public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Order and facility operator are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_process_type IS NULL
       OR p_process_type NOT IN (
            'washing',
            'drying',
            'ironing',
            'folding',
            'packaging'
       ) THEN
        RAISE EXCEPTION 'Unsupported facility processing stage: %',
            coalesce(p_process_type, '<null>')
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

    IF v_order.facility_id IS NULL THEN
        RAISE EXCEPTION 'Order has no assigned facility'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status NOT IN (
        'verification'::public.order_status,
        'processing'::public.order_status,
        'rework_required'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Processing is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_performed_by
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT operation.*
    INTO v_previous
    FROM public.facility_order_operations AS operation
    WHERE operation.order_id = p_order_id
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility operation not found for order %', p_order_id
            USING ERRCODE = '23514';
    END IF;

    IF p_machine_id IS NOT NULL THEN
        SELECT machine.*
        INTO v_machine
        FROM public.facility_machines AS machine
        WHERE machine.id = p_machine_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Machine % not found', p_machine_id
                USING ERRCODE = 'P0002';
        END IF;

        IF v_machine.facility_id IS DISTINCT FROM v_order.facility_id THEN
            RAISE EXCEPTION 'Machine belongs to another facility'
                USING ERRCODE = '42501';
        END IF;

        IF v_machine.status NOT IN (
            'active'::public.machine_status,
            'idle'::public.machine_status
        ) THEN
            RAISE EXCEPTION 'Machine is not available: %', v_machine.status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        machine_id,
        started_at,
        completed_at
    )
    VALUES (
        p_order_id,
        v_order.facility_id,
        p_process_type::public.facility_operation_status,
        p_process_type,
        p_performed_by,
        p_machine_id,
        v_now,
        NULL
    )
    RETURNING * INTO v_operation;

    RETURN to_jsonb(v_operation) || jsonb_build_object(
        'operationId', v_operation.id,
        'previousFacilityStatus', v_previous.current_status::text,
        'facilityStatus', p_process_type,
        'orderStatus', 'processing'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_facility_processing_atomic(
    p_operation_id uuid,
    p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_operation public.facility_order_operations%ROWTYPE;
    v_completed public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_operation_id IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Facility operation and operator are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    JOIN public.facility_order_operations AS target
      ON target.order_id = o.id
    WHERE target.id = p_operation_id
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility operation % not found', p_operation_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.current_status <> 'processing'::public.order_status THEN
        RAISE EXCEPTION 'Processing completion is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_performed_by
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT operation.*
    INTO v_operation
    FROM public.facility_order_operations AS operation
    WHERE operation.order_id = v_order.id
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_operation.id IS DISTINCT FROM p_operation_id THEN
        RAISE EXCEPTION 'Only the current facility stage can be completed'
            USING ERRCODE = '23514';
    END IF;

    IF v_operation.operation_type NOT IN (
        'washing',
        'drying',
        'ironing',
        'folding',
        'packaging'
    )
       OR v_operation.current_status::text IS DISTINCT FROM
          v_operation.operation_type THEN
        RAISE EXCEPTION 'Facility status % is not an active processing stage',
            v_operation.current_status
            USING ERRCODE = '23514';
    END IF;

    IF v_operation.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Processing stage is already completed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.facility_order_operations
    SET
        performed_by = p_performed_by,
        completed_at = v_now
    WHERE id = p_operation_id
      AND completed_at IS NULL
    RETURNING * INTO v_completed;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility processing stage changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    RETURN to_jsonb(v_completed) || jsonb_build_object(
        'processingCompleted', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.start_facility_processing_atomic(
    uuid,
    uuid,
    text,
    uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_facility_processing_atomic(
    uuid,
    uuid,
    text,
    uuid
)
TO service_role;

REVOKE ALL ON FUNCTION public.complete_facility_processing_atomic(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_facility_processing_atomic(uuid, uuid)
TO service_role;

COMMENT ON FUNCTION public.start_facility_processing_atomic(
    uuid,
    uuid,
    text,
    uuid
)
IS 'Atomically validates and starts the next facility processing stage; the facility sequence trigger remains the C2 transition authority.';

COMMENT ON FUNCTION public.complete_facility_processing_atomic(uuid, uuid)
IS 'Atomically marks the current facility processing stage complete using completed_at.';
