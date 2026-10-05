-- Add service_radius_meters to facilities table for configurable customer order geofencing
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS service_radius_meters integer NOT NULL DEFAULT 10000;

-- Ensure comment clarifies unit in meters
COMMENT ON COLUMN public.facilities.service_radius_meters IS 'Service coverage radius in meters (default 10,000m = 10km)';
