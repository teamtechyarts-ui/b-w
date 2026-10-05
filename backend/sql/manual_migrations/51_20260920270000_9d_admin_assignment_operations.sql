-- Admin operations reuse the existing atomic assignment and lifecycle procedures.
CREATE TABLE public.admin_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  previous_assignment_id uuid REFERENCES public.driver_assignments(id),
  new_assignment_id uuid NOT NULL REFERENCES public.driver_assignments(id),
  action text NOT NULL CHECK (action IN ('assign', 'reassign')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_assignment_audit_order_time ON public.admin_assignment_audit(order_id, created_at DESC);
ALTER TABLE public.admin_assignment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_assignment_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_assignment_audit TO service_role;
CREATE TRIGGER admin_assignment_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_assignment_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE FUNCTION public.admin_assign_driver_atomic(p_admin_profile_id uuid, p_order_id uuid,
  p_driver_id uuid, p_assignment_type public.assignment_type) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_admin_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501';
  END IF;
  v_result := public.create_driver_assignment_atomic(p_order_id,p_driver_id,p_assignment_type,NULL);
  INSERT INTO public.admin_assignment_audit(actor_profile_id,order_id,new_assignment_id,action)
  VALUES (p_admin_profile_id,p_order_id,(v_result->'assignment'->>'id')::uuid,'assign');
  RETURN v_result;
END; $$;

CREATE FUNCTION public.admin_reassign_driver_atomic(p_admin_profile_id uuid, p_assignment_id uuid,
  p_new_driver_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_order_id uuid;
BEGIN
  SELECT order_id INTO v_order_id FROM public.driver_assignments WHERE id=p_assignment_id;
  v_result := public.reassign_driver_assignment_atomic(p_assignment_id,p_admin_profile_id,p_new_driver_id);
  INSERT INTO public.admin_assignment_audit(actor_profile_id,order_id,previous_assignment_id,new_assignment_id,action)
  VALUES (p_admin_profile_id,v_order_id,p_assignment_id,(v_result->'assignment'->>'id')::uuid,'reassign');
  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.admin_assign_driver_atomic(uuid,uuid,uuid,public.assignment_type) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_reassign_driver_atomic(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver_atomic(uuid,uuid,uuid,public.assignment_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reassign_driver_atomic(uuid,uuid,uuid) TO service_role;
