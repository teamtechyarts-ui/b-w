-- 15_20261009130000_enable_supabase_realtime_publications.sql
-- Enables Supabase Realtime publication for operational tables:
-- orders, driver_assignments, order_status_history, customer_order_claims,
-- refund_requests, facility_order_operations, drivers, notifications

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- Set REPLICA IDENTITY FULL so updates/deletes contain all columns in payload
ALTER TABLE IF EXISTS public.orders REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.driver_assignments REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.order_status_history REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.order_processing_history REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.customer_order_claims REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.customer_claims REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.refund_requests REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.facility_order_operations REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.drivers REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.notifications REPLICA IDENTITY FULL;

-- Add tables to publication safely and idempotently
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'orders',
    'driver_assignments',
    'order_status_history',
    'order_processing_history',
    'customer_order_claims',
    'customer_claims',
    'refund_requests',
    'facility_order_operations',
    'drivers',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
      END IF;
    END IF;
  END LOOP;
END $$;
