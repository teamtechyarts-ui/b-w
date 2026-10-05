ALTER TABLE public.checkout_pricing_policies ADD COLUMN minimum_order_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0);

CREATE FUNCTION public.admin_set_checkout_policy_atomic(p_actor_profile_id uuid,p_fee numeric,p_free_threshold numeric,
  p_gst_rate numeric,p_minimum_order numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_actor_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF p_fee IS NULL OR p_fee<0 OR p_free_threshold IS NULL OR p_free_threshold<0 OR
    p_gst_rate IS NULL OR p_gst_rate<0 OR p_gst_rate>100 OR p_minimum_order IS NULL OR p_minimum_order<0 THEN
    RAISE EXCEPTION 'Invalid checkout policy' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(p) INTO v_before FROM public.checkout_pricing_policies p ORDER BY effective_from DESC LIMIT 1;
  INSERT INTO public.checkout_pricing_policies AS p(pickup_delivery_fee,free_delivery_threshold,gst_rate_percent,minimum_order_amount,created_by)
    VALUES(p_fee,p_free_threshold,p_gst_rate,p_minimum_order,p_actor_profile_id)
    RETURNING p.id,to_jsonb(p) INTO v_id,v_after;
  INSERT INTO public.admin_catalogue_audit(actor_profile_id,action,entity_id,before_value,after_value)
    VALUES(p_actor_profile_id,'set_policy',v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_checkout_policy_atomic(uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_checkout_policy_atomic(uuid,numeric,numeric,numeric,numeric) TO service_role;

-- Existing subscriptions keep their package service contract; edit only unsold package templates.
CREATE FUNCTION public.admin_set_package_service_atomic(p_actor_profile_id uuid,p_package_id uuid,p_service_id uuid,
  p_usage_limit integer,p_eligible boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_actor_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.package_subscriptions WHERE package_id=p_package_id) THEN
    RAISE EXCEPTION 'Sold package eligibility is locked' USING ERRCODE='23514'; END IF;
  IF p_eligible AND NOT EXISTS (SELECT 1 FROM public.services s LEFT JOIN public.service_categories c ON c.id=s.category_id
    WHERE s.id=p_service_id AND s.is_active AND (s.category_id IS NULL OR c.is_active)) THEN
    RAISE EXCEPTION 'Active service required' USING ERRCODE='23514'; END IF;
  IF p_usage_limit IS NOT NULL AND p_usage_limit<0 THEN RAISE EXCEPTION 'Invalid usage limit' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(ps),ps.id INTO v_before,v_id FROM public.package_services ps
    WHERE ps.package_id=p_package_id AND ps.service_id=p_service_id FOR UPDATE;
  IF p_eligible THEN
    INSERT INTO public.package_services AS ps(package_id,service_id,usage_limit)
      VALUES(p_package_id,p_service_id,p_usage_limit)
      ON CONFLICT(package_id,service_id) DO UPDATE SET usage_limit=EXCLUDED.usage_limit
      RETURNING ps.id,to_jsonb(ps) INTO v_id,v_after;
  ELSE
    IF v_id IS NULL THEN RAISE EXCEPTION 'Package service not found' USING ERRCODE='P0002'; END IF;
    DELETE FROM public.package_services WHERE id=v_id;
    v_after:=jsonb_build_object('id',v_id,'eligible',false);
  END IF;
  INSERT INTO public.admin_catalogue_audit(actor_profile_id,action,entity_id,before_value,after_value)
    VALUES(p_actor_profile_id,'set_package_eligibility',v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_package_service_atomic(uuid,uuid,uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_package_service_atomic(uuid,uuid,uuid,integer,boolean) TO service_role;
