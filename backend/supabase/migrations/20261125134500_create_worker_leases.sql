-- Migration: Create worker_leases table and atomic lease RPCs for distributed
-- background worker coordination across multi-instance deployments.
--
-- IMPORTANT: Review carefully and execute manually in the Supabase Dashboard
-- SQL Editor. Do not run automatically without review.

CREATE TABLE IF NOT EXISTS public.worker_leases (
  lease_name text PRIMARY KEY CHECK (length(trim(lease_name)) BETWEEN 1 AND 120),
  holder_id uuid NOT NULL,
  leased_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.worker_leases IS
  'Distributed coordination leases for singleton background workers (no business data).';
COMMENT ON COLUMN public.worker_leases.lease_name IS
  'Unique identifier of the coordinated background job (e.g., notification_queue_sweep).';
COMMENT ON COLUMN public.worker_leases.holder_id IS
  'Unique per-process UUID of the worker currently holding the lease.';
COMMENT ON COLUMN public.worker_leases.leased_until IS
  'PostgreSQL server timestamp after which the lease expires and may be claimed by another worker.';
COMMENT ON COLUMN public.worker_leases.updated_at IS
  'PostgreSQL server timestamp of the most recent lease acquisition, renewal, or release.';

CREATE INDEX IF NOT EXISTS idx_worker_leases_leased_until
  ON public.worker_leases (leased_until);

ALTER TABLE public.worker_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_leases FROM PUBLIC, anon, authenticated;

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
  ON CONFLICT (lease_name) DO UPDATE
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

CREATE OR REPLACE FUNCTION public.verify_worker_lease(
  p_lease_name text,
  p_holder_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.worker_leases wl
    WHERE wl.lease_name = trim(p_lease_name)
      AND wl.holder_id = p_holder_id
      AND wl.leased_until > NOW()
  );
$$;

COMMENT ON FUNCTION public.verify_worker_lease(text, uuid) IS
  'Verifies whether p_holder_id currently holds an unexpired lease for p_lease_name.';

CREATE OR REPLACE FUNCTION public.release_worker_lease(
  p_lease_name text,
  p_holder_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released_name text;
BEGIN
  UPDATE public.worker_leases wl
  SET leased_until = NOW(),
      updated_at = NOW()
  WHERE wl.lease_name = trim(p_lease_name)
    AND wl.holder_id = p_holder_id
  RETURNING wl.lease_name INTO v_released_name;

  RETURN v_released_name IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.release_worker_lease(text, uuid) IS
  'Safely expires a lease on graceful shutdown only if held by p_holder_id.';

REVOKE ALL ON FUNCTION public.acquire_or_renew_worker_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_worker_lease(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_worker_lease(text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_or_renew_worker_lease(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_worker_lease(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_worker_lease(text, uuid) TO service_role;
