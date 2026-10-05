-- Migration: 65_20261001160000_pincode_based_serviceability.sql
-- Description: Create facility_service_pincodes table for pincode-based laundry serviceability

CREATE TABLE IF NOT EXISTS public.facility_service_pincodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  pincode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, pincode)
);

CREATE INDEX IF NOT EXISTS idx_facility_service_pincodes_pincode 
  ON public.facility_service_pincodes (pincode);

CREATE INDEX IF NOT EXISTS idx_facility_service_pincodes_facility_pincode 
  ON public.facility_service_pincodes (facility_id, pincode);

ALTER TABLE public.facility_service_pincodes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'facility_service_pincodes' 
      AND policyname = 'facility_service_pincodes_read'
  ) THEN
    CREATE POLICY facility_service_pincodes_read 
      ON public.facility_service_pincodes FOR SELECT 
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'facility_service_pincodes' 
      AND policyname = 'facility_service_pincodes_admin_manage'
  ) THEN
    CREATE POLICY facility_service_pincodes_admin_manage 
      ON public.facility_service_pincodes FOR ALL 
      USING (
        auth.role() = 'service_role' OR public.is_admin(auth.uid())
      )
      WITH CHECK (
        auth.role() = 'service_role' OR public.is_admin(auth.uid())
      );
  END IF;
END;
$$;
