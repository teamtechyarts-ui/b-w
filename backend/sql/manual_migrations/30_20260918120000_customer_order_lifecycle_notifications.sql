-- Customer lifecycle notifications are persisted locally by the database.
-- FCM dispatch remains opt-in and credential-gated by the backend dispatcher.
CREATE OR REPLACE FUNCTION public.create_customer_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_title text;
  v_body text;
BEGIN
  IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    RETURN NEW;
  END IF;

  SELECT c.profile_id INTO v_profile_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id;
  IF v_profile_id IS NULL THEN RETURN NEW; END IF;

  SELECT CASE NEW.current_status
    WHEN 'pickup_assigned' THEN 'Pickup driver assigned'
    WHEN 'pickup_otp_pending' THEN 'Driver arriving for pickup'
    WHEN 'picked_up' THEN 'Pickup completed'
    WHEN 'received_at_facility' THEN 'Laundry received at facility'
    WHEN 'processing' THEN 'Laundry processing update'
    WHEN 'ready_for_delivery' THEN 'Ready for delivery'
    WHEN 'en_route_delivery' THEN 'Driver is on the way'
    WHEN 'delivered' THEN 'Order delivered'
    WHEN 'claim_period_active' THEN 'Claim period is active'
    ELSE NULL
  END INTO v_title;
  IF v_title IS NULL THEN RETURN NEW; END IF;

  v_body := format('Order %s: %s', coalesce(NEW.order_number, NEW.id::text), v_title);
  INSERT INTO public.notifications(profile_id, order_id, notification_type, title, body, data, status)
  VALUES (v_profile_id, NEW.id, concat('order.', NEW.current_status), v_title, v_body,
    jsonb_build_object('orderId', NEW.id::text, 'status', NEW.current_status::text), 'queued');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_order_status_notification ON public.orders;
CREATE TRIGGER trg_customer_order_status_notification
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_customer_order_status_notification();
