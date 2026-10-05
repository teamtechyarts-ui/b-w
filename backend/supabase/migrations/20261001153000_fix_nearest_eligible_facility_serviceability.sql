-- Migration: 20261001153000_fix_nearest_eligible_facility_serviceability.sql
-- Description: Correct check_location_serviceability to select the nearest ELIGIBLE active facility within its radius before fallback.

CREATE OR REPLACE FUNCTION public.check_location_serviceability(
    p_latitude numeric,
    p_longitude numeric
)
RETURNS TABLE (
    serviceable boolean,
    facility_id uuid,
    facility_name text,
    facility_address text,
    facility_latitude numeric,
    facility_longitude numeric,
    service_radius_meters integer,
    distance_meters numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH target_point AS (
        SELECT ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography AS geog
    ),
    active_facilities AS (
        SELECT 
            f.id,
            f.name,
            f.address,
            f.latitude::numeric AS lat,
            f.longitude::numeric AS lng,
            COALESCE(f.service_radius_meters, 10000)::integer AS radius,
            ROUND(ST_Distance(f.location, tp.geog)::numeric, 1) AS dist
        FROM public.facilities f
        CROSS JOIN target_point tp
        WHERE f.is_active = true
          AND f.location IS NOT NULL
    ),
    eligible AS (
        SELECT *
        FROM active_facilities
        WHERE dist <= radius
        ORDER BY dist ASC
        LIMIT 1
    ),
    nearest_fallback AS (
        SELECT *
        FROM active_facilities
        ORDER BY dist ASC
        LIMIT 1
    )
    SELECT 
        (e.id IS NOT NULL) AS serviceable,
        COALESCE(e.id, n.id) AS facility_id,
        COALESCE(e.name, n.name) AS facility_name,
        COALESCE(e.address, n.address) AS facility_address,
        COALESCE(e.lat, n.lat) AS facility_latitude,
        COALESCE(e.lng, n.lng) AS facility_longitude,
        COALESCE(e.radius, n.radius) AS service_radius_meters,
        COALESCE(e.dist, n.dist) AS distance_meters
    FROM nearest_fallback n
    LEFT JOIN eligible e ON true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_location_serviceability(numeric, numeric) TO authenticated, service_role, anon;
