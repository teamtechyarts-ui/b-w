-- Approved earning rate: 0.01 point per ₹1 paid (one whole point per ₹100).
-- Credit once after delivery and payment; COD is treated as collected on delivery.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_order_earned_once
ON public.loyalty_point_transactions(reference_id)
WHERE reference_type = 'order' AND transaction_type = 'earned';

CREATE OR REPLACE FUNCTION public.award_customer_order_loyalty_points(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders%ROWTYPE; v_points integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.current_status NOT IN ('delivered', 'claim_period_active', 'completed') THEN
    RETURN 0;
  END IF;
  IF v_order.payment_method = 'razorpay' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_orders
                   WHERE order_id = p_order_id AND status = 'paid') THEN
      RETURN 0;
    END IF;
  ELSIF v_order.payment_method <> 'cash_on_delivery' THEN
    RETURN 0;
  END IF;
  v_points := floor(GREATEST(v_order.total_amount, 0) / 100)::integer;
  IF v_points < 1 THEN RETURN 0; END IF;
  INSERT INTO public.loyalty_point_transactions
    (customer_id, points, transaction_type, reason, reference_type, reference_id)
  VALUES (v_order.customer_id, v_points, 'earned', 'Order delivered and paid', 'order', p_order_id)
  ON CONFLICT DO NOTHING;
  RETURN v_points;
END;
$$;
REVOKE ALL ON FUNCTION public.award_customer_order_loyalty_points(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_customer_order_loyalty_points(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.award_loyalty_after_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'delivered' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    PERFORM public.award_customer_order_loyalty_points(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_loyalty_after_delivery ON public.orders;
CREATE TRIGGER trg_award_loyalty_after_delivery
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_after_delivery();

CREATE OR REPLACE FUNCTION public.award_loyalty_after_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.award_customer_order_loyalty_points(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_loyalty_after_payment ON public.payment_orders;
CREATE TRIGGER trg_award_loyalty_after_payment
AFTER INSERT OR UPDATE OF status ON public.payment_orders
FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_after_payment();
