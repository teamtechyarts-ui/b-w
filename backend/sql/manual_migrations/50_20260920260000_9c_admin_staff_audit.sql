-- Append-only audit for Admin-managed operational account changes.
CREATE TABLE IF NOT EXISTS public.admin_staff_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('provision','activate','deactivate','revoke_access','reassign_facility')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_staff_action_audit_target_time
  ON public.admin_staff_action_audit(target_profile_id, created_at DESC);
ALTER TABLE public.admin_staff_action_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_staff_action_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_staff_action_audit TO service_role;
-- Audits are immutable, including when accessed through the service role.
CREATE OR REPLACE FUNCTION public.reject_admin_staff_audit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Admin staff audit is immutable' USING ERRCODE = '42501'; END;
$$;
DROP TRIGGER IF EXISTS admin_staff_audit_immutable ON public.admin_staff_action_audit;
CREATE TRIGGER admin_staff_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_staff_action_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();
