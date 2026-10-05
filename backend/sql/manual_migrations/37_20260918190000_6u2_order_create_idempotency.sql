-- 6U.2: the client keeps the same key for retries; the unique index serializes concurrent inserts.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_idempotency_key_unique
  ON public.orders(customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

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
    payment_method, terms_accepted, terms_accepted_at, terms_version, loyalty_points_redeemed,
    idempotency_key, idempotency_request_hash
  ) VALUES (
    p_customer_id, (p_order->>'facility_id')::uuid, 'draft',
    (p_order->>'pickup_address_id')::uuid, (p_order->>'delivery_address_id')::uuid,
    (p_order->>'pickup_scheduled_at')::timestamptz, p_order->>'pickup_slot_label',
    (p_order->>'subtotal')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric, (p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric, (p_order->>'gst_amount')::numeric,
    (p_order->>'total_amount')::numeric, (p_order->>'payment_method')::public.payment_method,
    true, now(), p_order->>'terms_version', p_points,
    (p_order->>'idempotency_key')::uuid, p_order->>'idempotency_request_hash'
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
