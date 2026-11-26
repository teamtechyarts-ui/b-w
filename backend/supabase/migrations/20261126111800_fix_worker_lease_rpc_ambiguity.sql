-- Migration: Fix PL/pgSQL 42702 ambiguous column reference ("lease_name") in
-- public.acquire_or_renew_worker_lease by targeting the primary key constraint
-- explicitly (ON CONFLICT ON CONSTRAINT worker_leases_pkey).
--
-- IMPORTANT: Review carefully and execute manually in the Supabase Dashboard
-- SQL Editor. Do not run automatically without review.

CREATE OR REPLACE FUNCTION public.acquire_or_renew_worker_lease(
  p_lease_name text,
  p_holder_id uuid,
  p_ttl_seconds integer DEFAULT 360
)
RETURNS TABLE (
  lease_name text,
  holder_id uuid,
  leased_until timestamptz,
  updated_at timestamptz,
  acquired boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := NOW();
  v_ttl integer := GREATEST(30, LEAST(COALESCE(p_ttl_seconds, 360), 3600));
  v_expires_at timestamptz := v_now + make_interval(secs => v_ttl);
BEGIN
  IF p_lease_name IS NULL OR length(trim(p_lease_name)) = 0 OR length(trim(p_lease_name)) > 120 THEN
    RAISE EXCEPTION 'Invalid lease name' USING ERRCODE = '22023';
  END IF;
  IF p_holder_id IS NULL THEN
    RAISE EXCEPTION 'Holder ID is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.worker_leases AS wl (lease_name, holder_id, leased_until, updated_at)
  VALUES (trim(p_lease_name), p_holder_id, v_expires_at, v_now)
  ON CONFLICT ON CONSTRAINT worker_leases_pkey DO UPDATE
    SET holder_id = EXCLUDED.holder_id,
        leased_until = EXCLUDED.leased_until,
        updated_at = v_now
    WHERE wl.holder_id = EXCLUDED.holder_id
       OR wl.leased_until <= v_now;

  RETURN QUERY
  SELECT
    wl.lease_name,
    wl.holder_id,
    wl.leased_until,
    wl.updated_at,
    (wl.holder_id = p_holder_id AND wl.leased_until > v_now) AS acquired
  FROM public.worker_leases wl
  WHERE wl.lease_name = trim(p_lease_name);
END;
$$;

COMMENT ON FUNCTION public.acquire_or_renew_worker_lease(text, uuid, integer) IS
  'Atomically acquires an unclaimed/expired lease or renews an existing lease held by p_holder_id using PostgreSQL NOW().';

REVOKE ALL ON FUNCTION public.acquire_or_renew_worker_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_or_renew_worker_lease(text, uuid, integer) TO service_role;
