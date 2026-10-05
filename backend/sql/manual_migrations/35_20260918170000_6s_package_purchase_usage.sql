-- 6S package purchase audit and reversible, order-linked usage.
ALTER TABLE public.package_subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_subscription_payment_reference
  ON public.package_subscriptions(payment_reference)
  WHERE payment_reference IS NOT NULL;

ALTER TABLE public.package_usage
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_usage_order_service
  ON public.package_usage(subscription_id, order_id, service_id)
  WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.restore_cancelled_order_package_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    UPDATE public.package_usage SET reversed_at = now()
    WHERE order_id = NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restore_cancelled_order_package_usage ON public.orders;
CREATE TRIGGER trg_restore_cancelled_order_package_usage
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_order_package_usage();
