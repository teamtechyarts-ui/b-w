-- 6R: serialize redemptions for each customer against the canonical points ledger.
CREATE OR REPLACE FUNCTION public.redeem_customer_loyalty_points(
  p_customer_id uuid, p_points integer, p_reason text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_balance integer;
BEGIN
  IF p_points IS NULL OR p_points <= 0 OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Positive points and reason required';
  END IF;
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  SELECT COALESCE(SUM(points), 0)::integer INTO current_balance
    FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
  IF current_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
  INSERT INTO public.loyalty_point_transactions
    (customer_id, points, transaction_type, reason)
    VALUES (p_customer_id, -p_points, 'redemption', btrim(p_reason));
  RETURN current_balance - p_points;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text) FROM PUBLIC;
-- Checkout redemption uses the atomic order creation function below instead.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_loyalty_points_redeemed_nonnegative;
ALTER TABLE public.orders ADD CONSTRAINT orders_loyalty_points_redeemed_nonnegative
  CHECK (loyalty_points_redeemed >= 0);

CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid; v_balance integer;
BEGIN
  IF p_points IS NULL OR p_points < 0 OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid order rewards or items';
  END IF;
  IF p_points > 0 THEN
    PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT COALESCE(SUM(points), 0)::integer INTO v_balance
      FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
    IF v_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
    IF (p_order->>'loyalty_discount_amount')::numeric <> p_points::numeric / 100 THEN
      RAISE EXCEPTION 'Invalid loyalty discount';
    END IF;
  END IF;
  INSERT INTO public.orders (
    customer_id, facility_id, current_status, pickup_address_id, delivery_address_id,
    pickup_scheduled_at, pickup_slot_label, subtotal, discount_amount,
    pickup_delivery_charge, taxable_amount, gst_rate, gst_amount, total_amount,
    payment_method, terms_accepted, terms_accepted_at, terms_version, loyalty_points_redeemed
  ) VALUES (
    p_customer_id, (p_order->>'facility_id')::uuid, 'draft',
    (p_order->>'pickup_address_id')::uuid, (p_order->>'delivery_address_id')::uuid,
    (p_order->>'pickup_scheduled_at')::timestamptz, p_order->>'pickup_slot_label',
    (p_order->>'subtotal')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric, (p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric, (p_order->>'gst_amount')::numeric,
    (p_order->>'total_amount')::numeric, (p_order->>'payment_method')::public.payment_method,
    true, now(), p_order->>'terms_version', p_points
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items
    (order_id, service_id, item_name, quantity, weight_kg, unit_price, line_total, customer_notes)
  SELECT v_order_id, i.service_id, i.item_name, i.quantity, i.weight_kg,
    i.unit_price, i.line_total, i.customer_notes
  FROM jsonb_to_recordset(p_items) AS i(
    service_id uuid, item_name text, quantity integer, weight_kg numeric,
    unit_price numeric, line_total numeric, customer_notes text
  );
  INSERT INTO public.order_qr_codes(order_id) VALUES (v_order_id);
  IF p_points > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    VALUES (p_customer_id, -p_points, 'redemption', 'Checkout discount', 'order', v_order_id);
  END IF;
  PERFORM public.change_order_status(v_order_id, p_target_status, 'Order created');
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) TO service_role;
