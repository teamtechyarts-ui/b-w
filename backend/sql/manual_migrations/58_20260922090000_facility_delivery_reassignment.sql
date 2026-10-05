-- Facility Staff may replace a rejected delivery assignment for an order at
-- their own active facility. Existing assignment rows remain immutable audit
-- history; the standard assignment function creates the replacement.
CREATE OR REPLACE FUNCTION public.facility_reassign_delivery_atomic(
    p_profile_id uuid,
    p_order_id uuid,
    p_new_driver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_facility_id uuid;
    v_order public.orders%ROWTYPE;
    v_rejected public.driver_assignments%ROWTYPE;
    v_result jsonb;
BEGIN
    IF p_profile_id IS NULL OR p_order_id IS NULL OR p_new_driver_id IS NULL THEN
        RAISE EXCEPTION 'Facility employee, order, and replacement Driver are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT employee.facility_id INTO v_facility_id
    FROM public.facility_employees AS employee
    JOIN public.facilities AS facility ON facility.id = employee.facility_id
    JOIN public.profiles AS profile ON profile.id = employee.profile_id
    WHERE employee.profile_id = p_profile_id
      AND employee.is_active = true
      AND facility.is_active = true
      AND profile.is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active facility employee access required'
            USING ERRCODE = '42501';
    END IF;

    SELECT o.* INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_order.facility_id IS DISTINCT FROM v_facility_id THEN
        RAISE EXCEPTION 'Order belongs to another facility'
            USING ERRCODE = '42501';
    END IF;
    IF v_order.current_status <> 'delivery_failed'::public.order_status THEN
        RAISE EXCEPTION 'A rejected delivery assignment is required before reassignment'
            USING ERRCODE = '23514';
    END IF;

    SELECT assignment.* INTO v_rejected
    FROM public.driver_assignments AS assignment
    WHERE assignment.order_id = p_order_id
      AND assignment.assignment_type = 'delivery'::public.assignment_type
      AND assignment.status = 'rejected'::public.assignment_status
    ORDER BY assignment.assigned_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rejected delivery assignment not found'
            USING ERRCODE = 'P0002';
    END IF;
    IF v_rejected.driver_id = p_new_driver_id THEN
        RAISE EXCEPTION 'Select a different Driver'
            USING ERRCODE = '23514';
    END IF;

    v_result := public.create_driver_assignment_atomic(
        p_order_id,
        p_new_driver_id,
        'delivery'::public.assignment_type,
        NULL
    );
    RETURN v_result || jsonb_build_object(
        'previousAssignmentId', v_rejected.id,
        'reassignedBy', p_profile_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.facility_reassign_delivery_atomic(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facility_reassign_delivery_atomic(uuid, uuid, uuid)
TO service_role;
