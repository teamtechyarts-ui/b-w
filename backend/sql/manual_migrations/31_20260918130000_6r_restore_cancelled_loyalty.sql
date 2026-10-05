-- Return points once when an order is cancelled through the approved status procedure.
CREATE OR REPLACE FUNCTION public.restore_cancelled_order_loyalty_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status
     AND NEW.loyalty_points_redeemed > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    SELECT NEW.customer_id, NEW.loyalty_points_redeemed, 'restoration',
      'Cancelled order', 'order', NEW.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.loyalty_point_transactions
      WHERE reference_type = 'order' AND reference_id = NEW.id
        AND transaction_type = 'restoration'
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restore_cancelled_order_loyalty_points ON public.orders;
CREATE TRIGGER trg_restore_cancelled_order_loyalty_points
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_order_loyalty_points();
