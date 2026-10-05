-- Serialise consumption per subscription and create the order in one transaction.
CREATE OR REPLACE FUNCTION public.create_customer_order_with_package_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer,
  p_subscription_id uuid, p_coverages jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_subscription public.package_subscriptions%ROWTYPE;
  v_coverage record; v_item record; v_limit record;
  v_used integer; v_package_discount numeric(12,2) := 0; v_order_id uuid;
BEGIN
  SELECT * INTO v_subscription FROM public.package_subscriptions
  WHERE id = p_subscription_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_subscription.status <> 'active'
     OR v_subscription.starts_at > now() OR v_subscription.expires_at <= now() THEN
    RAISE EXCEPTION 'Package is unavailable or expired';
  END IF;
  IF p_coverages IS NULL OR jsonb_array_length(p_coverages) = 0 THEN
    RAISE EXCEPTION 'No eligible package credits selected';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_coverages)
    AS c(service_id uuid, quantity integer)
    GROUP BY service_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate package service';
  END IF;
  FOR v_coverage IN SELECT * FROM jsonb_to_recordset(p_coverages)
    AS c(service_id uuid, quantity integer) LOOP
    SELECT * INTO v_item FROM jsonb_to_recordset(p_items)
      AS i(service_id uuid, quantity integer, unit_price numeric)
      WHERE service_id = v_coverage.service_id;
    SELECT * INTO v_limit FROM public.package_services
      WHERE package_id = v_subscription.package_id
        AND service_id = v_coverage.service_id;
    IF NOT FOUND OR v_coverage.quantity IS NULL OR v_coverage.quantity <= 0
       OR v_item.service_id IS NULL OR v_item.quantity < v_coverage.quantity THEN
      RAISE EXCEPTION 'Package service is not eligible for this order';
    END IF;
    SELECT COALESCE(SUM(usage_quantity), 0)::integer INTO v_used
      FROM public.package_usage
      WHERE subscription_id = p_subscription_id
        AND service_id = v_coverage.service_id AND reversed_at IS NULL;
    IF v_limit.usage_limit IS NOT NULL
       AND v_used + v_coverage.quantity > v_limit.usage_limit THEN
      RAISE EXCEPTION 'Package balance is insufficient';
    END IF;
    v_package_discount := v_package_discount + v_coverage.quantity * v_item.unit_price;
  END LOOP;
  IF v_package_discount <= 0
     OR v_package_discount <> (p_order->>'package_discount_amount')::numeric
     OR v_package_discount > (p_order->>'discount_amount')::numeric THEN
    RAISE EXCEPTION 'Package discount is invalid';
  END IF;
  v_order_id := public.create_customer_order_with_rewards_atomic(
    p_customer_id, p_order, p_items, p_target_status, p_points);
  INSERT INTO public.package_usage
    (subscription_id, service_id, order_id, usage_quantity, customer_id, package_service_id)
  SELECT p_subscription_id, c.service_id, v_order_id, c.quantity,
    p_customer_id, ps.id
  FROM jsonb_to_recordset(p_coverages) AS c(service_id uuid, quantity integer)
  JOIN public.package_services ps ON ps.package_id = v_subscription.package_id
    AND ps.service_id = c.service_id;
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_package_atomic(uuid, jsonb, jsonb, public.order_status, integer, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_package_atomic(uuid, jsonb, jsonb, public.order_status, integer, uuid, jsonb) TO service_role;
