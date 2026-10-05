-- Keep the three multi-row facility decisions transactionally complete.
--
-- The existing facility-sequence trigger remains the authority for order
-- transitions and delegates every transition to the C2 change_order_status
-- function. These service-role-only RPCs group the associated writes so a
-- receipt, inspection, or final quality verdict cannot be half committed.

CREATE OR REPLACE FUNCTION public.receive_facility_order_atomic(
    p_secure_token uuid,
    p_scanner_profile_id uuid,
    p_latitude numeric,
    p_longitude numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_qr public.order_qr_codes%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_assignment_id uuid;
    v_operation public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
BEGIN
    IF p_secure_token IS NULL OR p_scanner_profile_id IS NULL THEN
        RAISE EXCEPTION 'QR token and facility scanner are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT qr.*
    INTO v_qr
    FROM public.order_qr_codes AS qr
    WHERE qr.secure_token = p_secure_token
    FOR UPDATE;

    IF NOT FOUND OR NOT v_qr.is_active THEN
        RAISE EXCEPTION 'Invalid QR code'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = v_qr.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_qr.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.facility_id IS NULL THEN
        RAISE EXCEPTION 'Order has no assigned facility'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status <> 'in_transit_to_facility'::public.order_status THEN
        RAISE EXCEPTION 'Facility receipt is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_scanner_profile_id
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT assignment.id
    INTO v_assignment_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.order_id = v_order.id
      AND assignment.assignment_type = 'pickup'::public.assignment_type
      AND assignment.status = 'arrived'::public.assignment_status
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No arrived pickup assignment found for this order'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.qr_scan_logs (
        qr_code_id,
        scanner_profile_id,
        scan_action,
        latitude,
        longitude,
        scanned_at
    )
    VALUES (
        v_qr.id,
        p_scanner_profile_id,
        'facility_received',
        p_latitude,
        p_longitude,
        v_now
    );

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        received_at,
        started_at,
        completed_at
    )
    VALUES (
        v_order.id,
        v_order.facility_id,
        'received'::public.facility_operation_status,
        'facility_workflow',
        p_scanner_profile_id,
        v_now,
        v_now,
        v_now
    )
    RETURNING * INTO v_operation;

    UPDATE public.driver_assignments
    SET
        status = 'completed'::public.assignment_status,
        completed_at = v_now
    WHERE id = v_assignment_id
      AND status = 'arrived'::public.assignment_status;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Pickup assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'orderId', v_order.id,
        'operationId', v_operation.id,
        'assignmentId', v_assignment_id,
        'received', true,
        'facilityStatus', 'received',
        'orderStatus', 'received_at_facility',
        'pickupAssignmentStatus', 'completed'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_facility_verification_atomic(
    p_order_id uuid,
    p_performed_by uuid,
    p_item_count integer,
    p_weight_kg numeric,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_previous public.facility_order_operations%ROWTYPE;
    v_verification public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Order and facility operator are required'
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

    IF v_order.current_status <> 'received_at_facility'::public.order_status THEN
        RAISE EXCEPTION 'Verification is not allowed while order is %',
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
    LIMIT 1;

    IF NOT FOUND
       OR v_previous.operation_type <> 'facility_workflow'
       OR v_previous.current_status <> 'received'::public.facility_operation_status
       OR v_previous.completed_at IS NULL THEN
        RAISE EXCEPTION 'Facility verification requires a completed receipt'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        started_at,
        completed_at,
        notes
    )
    VALUES (
        p_order_id,
        v_order.facility_id,
        'verification'::public.facility_operation_status,
        'verification',
        p_performed_by,
        v_now,
        v_now,
        p_notes
    )
    RETURNING * INTO v_verification;

    INSERT INTO public.garment_inspections (
        operation_id,
        order_id,
        inspected_by,
        verified_by,
        item_count,
        counted_quantity,
        weight_kg,
        condition_notes,
        inspection_status
    )
    VALUES (
        v_verification.id,
        p_order_id,
        p_performed_by,
        p_performed_by,
        p_item_count,
        coalesce(p_item_count, 0),
        p_weight_kg,
        p_notes,
        'verified'
    );

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'operationId', v_verification.id,
        'verified', true,
        'facilityStatus', 'verification',
        'orderStatus', 'verification'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_facility_quality_check_atomic(
    p_order_id uuid,
    p_performed_by uuid,
    p_approved boolean,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_previous public.facility_order_operations%ROWTYPE;
    v_quality public.facility_order_operations%ROWTYPE;
    v_target_status public.facility_operation_status;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL
       OR p_performed_by IS NULL
       OR p_approved IS NULL THEN
        RAISE EXCEPTION 'Order, facility operator, and quality verdict are required'
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

    IF v_order.current_status <> 'processing'::public.order_status THEN
        RAISE EXCEPTION 'Quality check is not allowed while order is %',
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
    LIMIT 1;

    IF NOT FOUND
       OR v_previous.operation_type <> 'packaging'
       OR v_previous.current_status <> 'packaging'::public.facility_operation_status
       OR v_previous.completed_at IS NULL THEN
        RAISE EXCEPTION 'Quality check requires completed packaging'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        machine_id,
        started_at,
        completed_at,
        notes
    )
    VALUES (
        p_order_id,
        v_order.facility_id,
        'quality_check'::public.facility_operation_status,
        'quality_check',
        p_performed_by,
        NULL,
        v_now,
        v_now,
        p_notes
    )
    RETURNING * INTO v_quality;

    v_target_status := CASE p_approved
        WHEN true THEN 'ready_for_delivery'::public.facility_operation_status
        ELSE 'rework_required'::public.facility_operation_status
    END;

    UPDATE public.facility_order_operations
    SET
        current_status = v_target_status,
        ready_for_delivery_at = CASE p_approved WHEN true THEN v_now ELSE NULL END,
        performed_by = p_performed_by,
        notes = CASE
            WHEN p_approved THEN p_notes
            ELSE coalesce(p_notes, 'Quality control rejected')
        END
    WHERE id = v_quality.id
      AND current_status = 'quality_check'::public.facility_operation_status
    RETURNING * INTO v_quality;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quality operation changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'operationId', v_quality.id,
        'approved', p_approved,
        'facilityStatus', v_target_status::text,
        'orderStatus', v_target_status::text
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_facility_verification_atomic(
    uuid,
    uuid,
    integer,
    numeric,
    text
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.receive_facility_order_atomic(
    uuid,
    uuid,
    numeric,
    numeric
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.receive_facility_order_atomic(
    uuid,
    uuid,
    numeric,
    numeric
)
TO service_role;

GRANT EXECUTE ON FUNCTION public.record_facility_verification_atomic(
    uuid,
    uuid,
    integer,
    numeric,
    text
)
TO service_role;

REVOKE ALL ON FUNCTION public.complete_facility_quality_check_atomic(
    uuid,
    uuid,
    boolean,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_facility_quality_check_atomic(
    uuid,
    uuid,
    boolean,
    text
)
TO service_role;

COMMENT ON FUNCTION public.record_facility_verification_atomic(
    uuid,
    uuid,
    integer,
    numeric,
    text
)
IS 'Atomically records facility verification and its garment inspection.';

COMMENT ON FUNCTION public.receive_facility_order_atomic(
    uuid,
    uuid,
    numeric,
    numeric
)
IS 'Atomically records a facility QR receipt and completes its arrived pickup assignment.';

COMMENT ON FUNCTION public.complete_facility_quality_check_atomic(
    uuid,
    uuid,
    boolean,
    text
)
IS 'Atomically records a quality check and commits its ready or rework verdict.';
