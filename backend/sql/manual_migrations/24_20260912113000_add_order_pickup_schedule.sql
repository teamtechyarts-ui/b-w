BEGIN;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS pickup_scheduled_at timestamptz;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS pickup_slot_label text;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_scheduled_at
ON public.orders(pickup_scheduled_at)
WHERE pickup_scheduled_at IS NOT NULL;

COMMIT;