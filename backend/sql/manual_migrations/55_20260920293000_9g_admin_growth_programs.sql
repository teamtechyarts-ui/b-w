-- 9G commercial templates. Customer history, subscription contracts and redemptions stay append-only.
ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS validity_days integer CHECK (validity_days BETWEEN 1 AND 3650);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS eligibility_note text;

CREATE TABLE public.admin_growth_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  referral_enabled boolean NOT NULL DEFAULT true,
  referral_reward_points integer NOT NULL DEFAULT 0 CHECK (referral_reward_points BETWEEN 0 AND 1000000),
  loyalty_earn_points_per_rupee numeric(10,4) NOT NULL DEFAULT 0.01 CHECK (loyalty_earn_points_per_rupee BETWEEN 0 AND 100),
  loyalty_points_per_rupee integer NOT NULL DEFAULT 10 CHECK (loyalty_points_per_rupee BETWEEN 1 AND 1000000),
  loyalty_minimum_redemption_rupees numeric(12,2) NOT NULL DEFAULT 100 CHECK (loyalty_minimum_redemption_rupees BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admin_growth_settings(id) VALUES(true);
ALTER TABLE public.admin_growth_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_growth_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.admin_growth_settings TO service_role;

CREATE TABLE public.offer_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  coupon_code text NOT NULL,
  discount_amount numeric(12,2) NOT NULL CHECK(discount_amount > 0),
  offer_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz
);
CREATE INDEX offer_redemptions_active ON public.offer_redemptions(offer_id) WHERE reversed_at IS NULL;
ALTER TABLE public.offer_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_redemptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.offer_redemptions TO service_role;

CREATE TABLE public.admin_growth_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_growth_audit_time ON public.admin_growth_audit(created_at DESC);
ALTER TABLE public.admin_growth_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_growth_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_growth_audit TO service_role;
CREATE TRIGGER admin_growth_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_growth_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE FUNCTION public.admin_growth_change_atomic(p_actor uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_before jsonb; v_after jsonb; v_code text; v_start timestamptz; v_end timestamptz;
  v_amount numeric; v_limit integer; v_name text; v_locked boolean; v_settings public.admin_growth_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin(p_actor) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF p_action IN ('create_offer','update_offer') THEN
    v_code:=upper(btrim(coalesce(p_payload->>'couponCode','')));
    v_name:=btrim(coalesce(p_payload->>'name',''));
    v_start:=(p_payload->>'startsAt')::timestamptz; v_end:=(p_payload->>'expiresAt')::timestamptz;
    v_amount:=(p_payload->>'discountValue')::numeric; v_limit:=(p_payload->>'usageLimit')::integer;
    IF v_code !~ '^[A-Z0-9-]{1,64}$' OR length(v_name) NOT BETWEEN 2 AND 120 OR
      p_payload->>'discountType' NOT IN ('fixed','percentage') OR v_amount IS NULL OR v_amount<=0 OR
      (p_payload->>'discountType'='percentage' AND v_amount>100) OR
      (p_payload->>'minimumOrderAmount')::numeric<0 OR (p_payload->>'maximumDiscount')::numeric<0 OR
      (v_start IS NOT NULL AND v_end IS NOT NULL AND v_end<=v_start) OR
      (v_limit IS NOT NULL AND v_limit<1) THEN RAISE EXCEPTION 'Invalid offer' USING ERRCODE='22023'; END IF;
    IF p_action='update_offer' THEN
      v_id:=(p_payload->>'id')::uuid;
      SELECT to_jsonb(o) INTO v_before FROM public.offers o WHERE o.id=v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.offer_redemptions WHERE offer_id=v_id) THEN
        RAISE EXCEPTION 'Redeemed offer terms are locked; activation may still change' USING ERRCODE='23514'; END IF;
      UPDATE public.offers o SET code=v_code,coupon_code=v_code,name=v_name,
        discount_type=p_payload->>'discountType',discount_value=v_amount,
        minimum_order_amount=(p_payload->>'minimumOrderAmount')::numeric,
        maximum_discount=(p_payload->>'maximumDiscount')::numeric,
        starts_at=v_start,expires_at=v_end,usage_limit=v_limit,
        eligibility_note=nullif(btrim(p_payload->>'eligibilityNote'),'')
        WHERE o.id=v_id RETURNING to_jsonb(o) INTO v_after;
    ELSE
      INSERT INTO public.offers AS o(code,coupon_code,name,discount_type,discount_value,minimum_order_amount,
        maximum_discount,starts_at,expires_at,usage_limit,eligibility_note,is_active)
      VALUES(v_code,v_code,v_name,p_payload->>'discountType',v_amount,
        (p_payload->>'minimumOrderAmount')::numeric,(p_payload->>'maximumDiscount')::numeric,
        v_start,v_end,v_limit,nullif(btrim(p_payload->>'eligibilityNote'),''),false)
      RETURNING o.id,to_jsonb(o) INTO v_id,v_after;
    END IF;
  ELSIF p_action='set_offer_active' THEN
    v_id:=(p_payload->>'id')::uuid;
    SELECT to_jsonb(o) INTO v_before FROM public.offers o WHERE o.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE='P0002'; END IF;
    UPDATE public.offers o SET is_active=(p_payload->>'isActive')::boolean WHERE o.id=v_id RETURNING to_jsonb(o) INTO v_after;
  ELSIF p_action IN ('create_package','update_package') THEN
    v_name:=btrim(coalesce(p_payload->>'name',''));
    v_amount:=(p_payload->>'price')::numeric;
    IF length(v_name) NOT BETWEEN 2 AND 120 OR v_amount IS NULL OR v_amount<=0 OR
      (p_payload->>'validityDays')::integer NOT BETWEEN 1 AND 3650 THEN
      RAISE EXCEPTION 'Invalid package' USING ERRCODE='22023'; END IF;
    IF p_action='update_package' THEN
      v_id:=(p_payload->>'id')::uuid;
      SELECT to_jsonb(p) INTO v_before FROM public.packages p WHERE p.id=v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.package_subscriptions WHERE package_id=v_id) THEN
        RAISE EXCEPTION 'Sold package terms are locked' USING ERRCODE='23514'; END IF;
      UPDATE public.packages p SET name=v_name,description=p_payload->>'description',monthly_price=v_amount,
        price=v_amount,validity_days=(p_payload->>'validityDays')::integer WHERE p.id=v_id
        RETURNING to_jsonb(p) INTO v_after;
    ELSE
      INSERT INTO public.packages AS p(name,description,monthly_price,price,validity_days,is_active)
        VALUES(v_name,p_payload->>'description',v_amount,v_amount,(p_payload->>'validityDays')::integer,false)
        RETURNING p.id,to_jsonb(p) INTO v_id,v_after;
    END IF;
  ELSIF p_action='set_package_active' THEN
    v_id:=(p_payload->>'id')::uuid;
    SELECT to_jsonb(p) INTO v_before FROM public.packages p WHERE p.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='P0002'; END IF;
    UPDATE public.packages p SET is_active=(p_payload->>'isActive')::boolean WHERE p.id=v_id RETURNING to_jsonb(p) INTO v_after;
  ELSIF p_action='set_program_settings' THEN
    SELECT * INTO v_settings FROM public.admin_growth_settings WHERE id=true FOR UPDATE;
    v_before:=to_jsonb(v_settings);
    UPDATE public.admin_growth_settings s SET
      referral_enabled=(p_payload->>'referralEnabled')::boolean,
      referral_reward_points=(p_payload->>'referralRewardPoints')::integer,
      loyalty_earn_points_per_rupee=(p_payload->>'loyaltyEarnPointsPerRupee')::numeric,
      loyalty_points_per_rupee=(p_payload->>'loyaltyPointsPerRupee')::integer,
      loyalty_minimum_redemption_rupees=(p_payload->>'loyaltyMinimumRedemptionRupees')::numeric,
      updated_at=now() WHERE id=true RETURNING to_jsonb(s) INTO v_after;
  ELSE RAISE EXCEPTION 'Unsupported growth action' USING ERRCODE='22023'; END IF;
  INSERT INTO public.admin_growth_audit(actor_profile_id,action,entity_type,entity_id,before_value,after_value)
    VALUES(p_actor,p_action,CASE WHEN p_action LIKE '%offer%' THEN 'offer' WHEN p_action LIKE '%package%' THEN 'package' ELSE 'settings' END,v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_growth_change_atomic(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_growth_change_atomic(uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.reserve_offer_for_order_atomic(p_offer_id uuid,p_order_id uuid,p_customer_id uuid,
  p_subtotal numeric,p_package_discount numeric,p_coupon_discount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_offer public.offers%ROWTYPE; v_used integer; v_expected numeric;
BEGIN
  SELECT * INTO v_offer FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  IF NOT FOUND OR NOT v_offer.is_active OR v_offer.coupon_code IS NULL OR
    (v_offer.starts_at IS NOT NULL AND v_offer.starts_at>now()) OR
    (v_offer.expires_at IS NOT NULL AND v_offer.expires_at<=now()) OR
    p_subtotal<v_offer.minimum_order_amount THEN
    RAISE EXCEPTION 'Coupon is unavailable' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO v_used FROM public.offer_redemptions WHERE offer_id=p_offer_id AND reversed_at IS NULL;
  IF v_offer.usage_limit IS NOT NULL AND v_used>=v_offer.usage_limit THEN
    RAISE EXCEPTION 'Coupon usage limit reached' USING ERRCODE='23514'; END IF;
  v_expected:=CASE WHEN v_offer.discount_type='percentage' THEN p_subtotal*v_offer.discount_value/100
    ELSE v_offer.discount_value END;
  v_expected:=round(least(greatest(v_expected,0),coalesce(v_offer.maximum_discount,p_subtotal),
    p_subtotal,greatest(0,p_subtotal-p_package_discount)),2);
  IF p_coupon_discount IS NULL OR p_coupon_discount<=0 OR p_coupon_discount<>v_expected THEN
    RAISE EXCEPTION 'Coupon discount changed; review checkout' USING ERRCODE='23514'; END IF;
  INSERT INTO public.offer_redemptions(offer_id,order_id,customer_id,coupon_code,discount_amount,offer_snapshot)
    VALUES(p_offer_id,p_order_id,p_customer_id,v_offer.coupon_code,p_coupon_discount,to_jsonb(v_offer));
END; $$;
REVOKE ALL ON FUNCTION public.reserve_offer_for_order_atomic(uuid,uuid,uuid,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_offer_for_order_atomic(uuid,uuid,uuid,numeric,numeric,numeric) TO service_role;

CREATE FUNCTION public.reverse_offer_after_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.current_status='cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    UPDATE public.offer_redemptions SET reversed_at=now() WHERE order_id=NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER reverse_offer_after_cancellation AFTER UPDATE OF current_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.reverse_offer_after_cancellation();

-- Keep the existing customer order procedure; add locked coupon reservation and dynamic redemption policy.
CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid,p_order jsonb,p_items jsonb,p_target_status public.order_status,p_points integer DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order_id uuid; v_balance integer; v_settings public.admin_growth_settings%ROWTYPE;
  v_coupon uuid; v_coupon_discount numeric; v_package_discount numeric; v_loyalty_discount numeric;
BEGIN
  SELECT * INTO v_settings FROM public.admin_growth_settings WHERE id=true;
  IF p_points IS NULL OR p_points<0 OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Invalid order rewards or items'; END IF;
  v_coupon:=nullif(p_order->>'coupon_offer_id','')::uuid;
  v_coupon_discount:=coalesce((p_order->>'coupon_discount_amount')::numeric,0);
  v_package_discount:=coalesce((p_order->>'package_discount_amount')::numeric,0);
  v_loyalty_discount:=coalesce((p_order->>'loyalty_discount_amount')::numeric,0);
  IF v_coupon IS NULL AND v_coupon_discount<>0 OR
    v_coupon_discount<0 OR v_package_discount<0 OR v_loyalty_discount<0 OR
    (p_order->>'discount_amount')::numeric <> v_coupon_discount+v_package_discount+v_loyalty_discount THEN
    RAISE EXCEPTION 'Invalid discount breakdown'; END IF;
  IF p_points>0 THEN
    PERFORM 1 FROM public.customers WHERE id=p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT coalesce(sum(points),0)::integer INTO v_balance FROM public.loyalty_point_transactions WHERE customer_id=p_customer_id;
    IF v_balance<p_points OR p_points < ceil(v_settings.loyalty_minimum_redemption_rupees*v_settings.loyalty_points_per_rupee) OR
      v_loyalty_discount<>p_points::numeric/v_settings.loyalty_points_per_rupee THEN RAISE EXCEPTION 'Invalid loyalty discount'; END IF;
  ELSIF v_loyalty_discount<>0 THEN RAISE EXCEPTION 'Invalid loyalty discount'; END IF;
  INSERT INTO public.orders(customer_id,facility_id,current_status,pickup_address_id,delivery_address_id,
    pickup_scheduled_at,pickup_slot_label,subtotal,discount_amount,pickup_delivery_charge,taxable_amount,
    gst_rate,gst_amount,total_amount,payment_method,terms_accepted,terms_accepted_at,terms_version,
    loyalty_points_redeemed,idempotency_key,idempotency_request_hash)
  VALUES(p_customer_id,(p_order->>'facility_id')::uuid,'draft',(p_order->>'pickup_address_id')::uuid,
    (p_order->>'delivery_address_id')::uuid,(p_order->>'pickup_scheduled_at')::timestamptz,
    p_order->>'pickup_slot_label',(p_order->>'subtotal')::numeric,(p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric,(p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric,(p_order->>'gst_amount')::numeric,(p_order->>'total_amount')::numeric,
    (p_order->>'payment_method')::public.payment_method,true,now(),p_order->>'terms_version',p_points,
    (p_order->>'idempotency_key')::uuid,p_order->>'idempotency_request_hash') RETURNING id INTO v_order_id;
  INSERT INTO public.order_items(order_id,service_id,item_name,quantity,weight_kg,unit_price,line_total,customer_notes)
  SELECT v_order_id,i.service_id,i.item_name,i.quantity,i.weight_kg,i.unit_price,i.line_total,i.customer_notes
    FROM jsonb_to_recordset(p_items) AS i(service_id uuid,item_name text,quantity integer,weight_kg numeric,
      unit_price numeric,line_total numeric,customer_notes text);
  INSERT INTO public.order_qr_codes(order_id) VALUES(v_order_id);
  IF p_points>0 THEN INSERT INTO public.loyalty_point_transactions(customer_id,points,transaction_type,reason,reference_type,reference_id)
    VALUES(p_customer_id,-p_points,'redemption','Checkout discount','order',v_order_id); END IF;
  IF v_coupon IS NOT NULL THEN
    PERFORM public.reserve_offer_for_order_atomic(v_coupon,v_order_id,p_customer_id,(p_order->>'subtotal')::numeric,
      v_package_discount,v_coupon_discount);
  END IF;
  PERFORM public.change_order_status(v_order_id,p_target_status,'Order created');
  RETURN v_order_id;
END; $$;

-- Existing earned/redemption transactions are immutable. New earning follows current Admin policy once per paid delivery.
CREATE OR REPLACE FUNCTION public.award_customer_order_loyalty_points(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_points integer; v_settings public.admin_growth_settings%ROWTYPE; v_referral public.referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.current_status NOT IN ('delivered','claim_period_active','completed') THEN RETURN 0; END IF;
  IF v_order.payment_method='razorpay' THEN
    IF NOT EXISTS(SELECT 1 FROM public.payment_orders WHERE order_id=p_order_id AND status='paid') THEN RETURN 0; END IF;
  ELSIF v_order.payment_method<>'cash_on_delivery' THEN RETURN 0; END IF;
  SELECT * INTO v_settings FROM public.admin_growth_settings WHERE id=true;
  v_points:=floor(greatest(v_order.total_amount,0)*v_settings.loyalty_earn_points_per_rupee)::integer;
  IF v_points>0 THEN
    INSERT INTO public.loyalty_point_transactions(customer_id,points,transaction_type,reason,reference_type,reference_id)
      VALUES(v_order.customer_id,v_points,'earned','Order delivered and paid','order',p_order_id) ON CONFLICT DO NOTHING;
  END IF;
  IF v_settings.referral_enabled AND v_settings.referral_reward_points>0 THEN
    SELECT * INTO v_referral FROM public.referrals WHERE referred_customer_id=v_order.customer_id FOR UPDATE;
    IF FOUND AND v_referral.reward_status<>'rewarded' THEN
      INSERT INTO public.loyalty_point_transactions(customer_id,points,transaction_type,reason,reference_type,reference_id)
        VALUES(v_referral.referrer_customer_id,v_settings.referral_reward_points,'referral',
          'Referred customer first paid delivery','referral',v_referral.id) ON CONFLICT DO NOTHING;
      UPDATE public.referrals SET reward_status='rewarded',status='rewarded' WHERE id=v_referral.id;
    END IF;
  END IF;
  RETURN v_points;
END; $$;
CREATE UNIQUE INDEX IF NOT EXISTS referral_reward_once ON public.loyalty_point_transactions(reference_id)
  WHERE reference_type='referral' AND transaction_type='referral';
