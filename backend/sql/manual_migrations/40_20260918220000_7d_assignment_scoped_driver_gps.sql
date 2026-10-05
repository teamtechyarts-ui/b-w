-- 7D: a location belongs to one active trip, not merely to a Driver.
CREATE TABLE IF NOT EXISTS public.driver_trip_locations (
    assignment_id uuid PRIMARY KEY REFERENCES public.driver_assignments(id) ON DELETE CASCADE,
    driver_id uuid NOT NULL REFERENCES public.drivers(id),
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    accuracy_m numeric(10,2),
    recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_trip_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_trip_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.driver_trip_locations TO service_role;

CREATE OR REPLACE FUNCTION public.publish_driver_trip_location_atomic(
    p_assignment_id uuid,
    p_driver_id uuid,
    p_latitude numeric,
    p_longitude numeric,
    p_accuracy_m numeric DEFAULT NULL
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
    v_last timestamptz;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF p_assignment_id IS NULL OR p_driver_id IS NULL OR p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
       OR (p_accuracy_m IS NOT NULL AND p_accuracy_m NOT BETWEEN 0 AND 100000) THEN
        RAISE EXCEPTION 'Invalid trip location' USING ERRCODE = '22023';
    END IF;
    SELECT a.order_id INTO v_order_id FROM public.driver_assignments AS a
    WHERE a.id = p_assignment_id AND a.driver_id = p_driver_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'P0002'; END IF;
    SELECT o.current_status INTO v_order_status FROM public.orders AS o
    WHERE o.id = v_order_id FOR UPDATE;
    SELECT a.* INTO v_assignment FROM public.driver_assignments AS a
    WHERE a.id = p_assignment_id AND a.driver_id = p_driver_id FOR UPDATE;
    IF NOT FOUND OR v_assignment.status <> 'en_route' OR
       (v_assignment.assignment_type = 'pickup' AND v_order_status <> 'en_route_pickup') OR
       (v_assignment.assignment_type = 'delivery' AND v_order_status <> 'en_route_delivery') THEN
        RAISE EXCEPTION 'Trip is not active' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.drivers AS d WHERE d.id = p_driver_id AND d.is_active) THEN
        RAISE EXCEPTION 'Driver is inactive' USING ERRCODE = '23514';
    END IF;
    SELECT recorded_at INTO v_last FROM public.driver_trip_locations
    WHERE assignment_id = p_assignment_id FOR UPDATE;
    IF v_last IS NOT NULL AND v_now - v_last < interval '15 seconds' THEN
        RETURN jsonb_build_object('published', false, 'recordedAt', v_last);
    END IF;
    INSERT INTO public.driver_trip_locations (assignment_id, driver_id, latitude, longitude, accuracy_m, recorded_at)
    VALUES (p_assignment_id, p_driver_id, p_latitude, p_longitude, p_accuracy_m, v_now)
    ON CONFLICT (assignment_id) DO UPDATE SET
        latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
        accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at;
    PERFORM public.upsert_driver_live_location(p_driver_id, p_latitude, p_longitude, p_accuracy_m);
    RETURN jsonb_build_object('published', true, 'recordedAt', v_now);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_driver_trip_location_atomic(uuid,uuid,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_driver_trip_location_atomic(uuid,uuid,numeric,numeric,numeric) TO service_role;
