-- Migration: 20261001150000_customer_location_serviceability.sql
-- Description: Phase 2 customer location serviceability RPC and GIST index verification

-- 1. Ensure service_radius_meters on facilities table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'facilities' 
      AND column_name = 'service_radius_meters'
  ) THEN
    ALTER TABLE public.facilities 
      ADD COLUMN service_radius_meters integer NOT NULL DEFAULT 10000;
  END IF;
END;
$$;

-- 2. Ensure spatial GIST index on facilities.location and customer_addresses.location
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'facilities' 
      AND column_name = 'location'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_facilities_location_gist 
      ON public.facilities USING GIST (location);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'customer_addresses' 
      AND column_name = 'location'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_location_gist 
      ON public.customer_addresses USING GIST (location);
  END IF;
END;
$$;

-- 3. PostGIS Function: check_location_serviceability
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
    nearest AS (
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
        ORDER BY dist ASC
        LIMIT 1
    )
    SELECT 
        (n.dist <= n.radius) AS serviceable,
        n.id AS facility_id,
        n.name AS facility_name,
        n.address AS facility_address,
        n.lat AS facility_latitude,
        n.lng AS facility_longitude,
        n.radius AS service_radius_meters,
        n.dist AS distance_meters
    FROM nearest n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_location_serviceability(numeric, numeric) TO authenticated, service_role, anon;
