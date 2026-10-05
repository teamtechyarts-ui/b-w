-- 7C: replace an active assignment without exposing an intermediate state.
-- Historical rows retain their original driver for audit attribution.
CREATE OR REPLACE FUNCTION public.reassign_driver_assignment_atomic(
    p_assignment_id uuid,
    p_admin_profile_id uuid,
    p_new_driver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old public.driver_assignments%ROWTYPE;
    v_order_status public.order_status;
    v_expected public.order_status;
    v_failed public.order_status;
    v_new jsonb;
BEGIN
    IF p_assignment_id IS NULL OR p_admin_profile_id IS NULL OR p_new_driver_id IS NULL THEN
        RAISE EXCEPTION 'Assignment, Admin, and replacement Driver are required' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profile_roles AS pr
        JOIN public.roles AS role ON role.id = pr.role_id
        WHERE pr.profile_id = p_admin_profile_id AND role.code = 'admin'
    ) THEN
        RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
    END IF;

    -- Lock order first, matching the established assignment transaction order.
    SELECT assignment.* INTO v_old
    FROM public.driver_assignments AS assignment WHERE assignment.id = p_assignment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT o.current_status INTO v_order_status
    FROM public.orders AS o WHERE o.id = v_old.order_id FOR UPDATE;
    SELECT assignment.* INTO v_old
    FROM public.driver_assignments AS assignment WHERE assignment.id = p_assignment_id FOR UPDATE;
    IF v_old.status NOT IN ('assigned', 'accepted', 'en_route', 'arrived') THEN
        RAISE EXCEPTION 'Assignment can no longer be reassigned' USING ERRCODE = '23514';
    END IF;
    IF v_old.driver_id = p_new_driver_id THEN
        RAISE EXCEPTION 'Replacement Driver must be different' USING ERRCODE = '23514';
    END IF;

    IF v_old.assignment_type = 'pickup' THEN
        v_failed := 'pickup_failed';
        v_expected := CASE v_old.status
            WHEN 'assigned' THEN 'pickup_assigned'::public.order_status
            WHEN 'accepted' THEN 'pickup_accepted'::public.order_status
            WHEN 'en_route' THEN 'en_route_pickup'::public.order_status
            ELSE 'pickup_otp_pending'::public.order_status END;
    ELSE
        v_failed := 'delivery_failed';
        v_expected := CASE v_old.status
            WHEN 'assigned' THEN 'delivery_assigned'::public.order_status
            WHEN 'accepted' THEN 'delivery_accepted'::public.order_status
            WHEN 'en_route' THEN 'en_route_delivery'::public.order_status
            ELSE 'delivery_otp_pending'::public.order_status END;
    END IF;
    IF v_order_status IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'Order is not in the expected assignment state' USING ERRCODE = '23514';
    END IF;

    UPDATE public.driver_assignments SET status = 'reassignment_required'
    WHERE id = p_assignment_id;
    PERFORM public.change_order_status(v_old.order_id, v_failed, 'Admin reassigned Driver');
    v_new := public.create_driver_assignment_atomic(
        v_old.order_id, p_new_driver_id, v_old.assignment_type, NULL
    );
    RETURN jsonb_build_object(
        'previousAssignmentId', p_assignment_id,
        'assignment', v_new->'assignment',
        'orderStatus', v_new->'orderStatus'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_driver_assignment_atomic(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_driver_assignment_atomic(uuid, uuid, uuid) TO service_role;
