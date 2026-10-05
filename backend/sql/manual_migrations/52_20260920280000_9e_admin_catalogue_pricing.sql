-- Versioned commercial policy. Order rows already snapshot charge, taxable amount and GST.
CREATE TABLE public.checkout_pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_delivery_fee numeric(12,2) NOT NULL CHECK (pickup_delivery_fee >= 0),
  free_delivery_threshold numeric(12,2) NOT NULL CHECK (free_delivery_threshold >= 0),
  gst_rate_percent numeric(5,2) NOT NULL CHECK (gst_rate_percent >= 0 AND gst_rate_percent <= 100),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);
INSERT INTO public.checkout_pricing_policies(pickup_delivery_fee,free_delivery_threshold,gst_rate_percent)
VALUES (50,500,5);
ALTER TABLE public.checkout_pricing_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_pricing_policies FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.checkout_pricing_policies TO service_role;

CREATE TABLE public.admin_catalogue_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_id uuid NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_catalogue_audit_entity_time ON public.admin_catalogue_audit(entity_id,created_at DESC);
ALTER TABLE public.admin_catalogue_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_catalogue_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_catalogue_audit TO service_role;
CREATE TRIGGER admin_catalogue_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_catalogue_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE FUNCTION public.admin_catalogue_change_atomic(p_actor_profile_id uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_before jsonb; v_after jsonb; v_amount numeric; v_facility uuid; v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_actor_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501';
  END IF;
  IF p_action='create_category' THEN
    IF length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Valid category name required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.service_categories(name,description) VALUES (trim(p_payload->>'name'),nullif(trim(p_payload->>'description'),''))
      RETURNING id,to_jsonb(public.service_categories.*) INTO v_id,v_after;
  ELSIF p_action='update_category' THEN
    v_id := (p_payload->>'id')::uuid;
    SELECT to_jsonb(c) INTO v_before FROM public.service_categories c WHERE c.id=v_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='P0002'; END IF;
    IF p_payload ? 'name' AND length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Valid category name required' USING ERRCODE='22023'; END IF;
    UPDATE public.service_categories SET name=COALESCE(nullif(trim(p_payload->>'name'),''),name),
      description=CASE WHEN p_payload ? 'description' THEN nullif(trim(p_payload->>'description'),'') ELSE description END,
      is_active=COALESCE((p_payload->>'isActive')::boolean,is_active)
      WHERE id=v_id RETURNING to_jsonb(public.service_categories.*) INTO v_after;
  ELSIF p_action='create_service' THEN
    IF length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Valid service name required' USING ERRCODE='22023'; END IF;
    IF length(trim(p_payload->>'pricingUnit')) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Pricing unit required' USING ERRCODE='22023'; END IF;
    IF p_payload->>'categoryId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.service_categories WHERE id=(p_payload->>'categoryId')::uuid AND is_active) THEN
      RAISE EXCEPTION 'Active category required' USING ERRCODE='23514'; END IF;
    INSERT INTO public.services(category_id,name,description,pricing_unit)
      VALUES ((p_payload->>'categoryId')::uuid,trim(p_payload->>'name'),nullif(trim(p_payload->>'description'),''),trim(p_payload->>'pricingUnit'))
      RETURNING id,to_jsonb(public.services.*) INTO v_id,v_after;
  ELSIF p_action='update_service' THEN
    v_id := (p_payload->>'id')::uuid;
    SELECT to_jsonb(s) INTO v_before FROM public.services s WHERE s.id=v_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='P0002'; END IF;
    IF p_payload ? 'name' AND length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Valid service name required' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'pricingUnit' AND length(trim(p_payload->>'pricingUnit')) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Pricing unit required' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'categoryId' AND p_payload->>'categoryId' IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.service_categories WHERE id=(p_payload->>'categoryId')::uuid AND is_active) THEN
      RAISE EXCEPTION 'Active category required' USING ERRCODE='23514'; END IF;
    UPDATE public.services SET name=COALESCE(nullif(trim(p_payload->>'name'),''),name),
      description=CASE WHEN p_payload ? 'description' THEN nullif(trim(p_payload->>'description'),'') ELSE description END,
      pricing_unit=COALESCE(nullif(trim(p_payload->>'pricingUnit'),''),pricing_unit),
      category_id=CASE WHEN p_payload ? 'categoryId' THEN (p_payload->>'categoryId')::uuid ELSE category_id END,
      is_active=COALESCE((p_payload->>'isActive')::boolean,is_active)
      WHERE id=v_id RETURNING to_jsonb(public.services.*) INTO v_after;
  ELSIF p_action='set_price' THEN
    v_id := (p_payload->>'serviceId')::uuid;
    v_amount := (p_payload->>'price')::numeric;
    v_facility := (p_payload->>'facilityId')::uuid;
    IF v_amount IS NULL OR v_amount < 0 OR v_amount > 9999999999.99 OR v_amount <> round(v_amount,2) THEN
      RAISE EXCEPTION 'Invalid service price' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.services WHERE id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='P0002'; END IF;
    IF v_facility IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facilities WHERE id=v_facility AND is_active) THEN
      RAISE EXCEPTION 'Active facility required' USING ERRCODE='23514'; END IF;
    SELECT to_jsonb(sp) INTO v_before FROM public.service_prices sp WHERE sp.service_id=v_id AND sp.facility_id IS NOT DISTINCT FROM v_facility
      AND sp.effective_from<=v_now AND (sp.effective_to IS NULL OR sp.effective_to>v_now)
      ORDER BY sp.effective_from DESC LIMIT 1;
    UPDATE public.service_prices SET effective_to=v_now WHERE service_id=v_id AND facility_id IS NOT DISTINCT FROM v_facility
      AND effective_from<=v_now AND (effective_to IS NULL OR effective_to>v_now);
    INSERT INTO public.service_prices(service_id,facility_id,price,effective_from) VALUES(v_id,v_facility,v_amount,v_now)
      RETURNING to_jsonb(public.service_prices.*) INTO v_after;
    v_id := (v_after->>'id')::uuid;
  ELSIF p_action='set_policy' THEN
    IF (p_payload->>'pickupDeliveryFee')::numeric < 0 OR (p_payload->>'freeDeliveryThreshold')::numeric < 0 OR
      (p_payload->>'gstRatePercent')::numeric < 0 OR (p_payload->>'gstRatePercent')::numeric > 100 OR
      (p_payload->>'pickupDeliveryFee')::numeric IS NULL OR (p_payload->>'freeDeliveryThreshold')::numeric IS NULL OR
      (p_payload->>'gstRatePercent')::numeric IS NULL THEN RAISE EXCEPTION 'Invalid pricing policy' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(p) INTO v_before FROM public.checkout_pricing_policies p ORDER BY effective_from DESC LIMIT 1;
    INSERT INTO public.checkout_pricing_policies(pickup_delivery_fee,free_delivery_threshold,gst_rate_percent,effective_from,created_by)
      VALUES((p_payload->>'pickupDeliveryFee')::numeric,(p_payload->>'freeDeliveryThreshold')::numeric,
        (p_payload->>'gstRatePercent')::numeric,v_now,p_actor_profile_id)
      RETURNING id,to_jsonb(public.checkout_pricing_policies.*) INTO v_id,v_after;
  ELSE RAISE EXCEPTION 'Unsupported catalogue action' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.admin_catalogue_audit(actor_profile_id,action,entity_id,before_value,after_value)
    VALUES(p_actor_profile_id,p_action,v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_catalogue_change_atomic(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_catalogue_change_atomic(uuid,text,jsonb) TO service_role;
