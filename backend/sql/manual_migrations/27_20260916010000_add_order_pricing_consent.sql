BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_delivery_charge numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terms_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

UPDATE public.orders
SET
  pickup_delivery_charge = COALESCE(pickup_delivery_charge, 0),
  taxable_amount = GREATEST(subtotal - discount_amount, 0),
  gst_rate = COALESCE(gst_rate, 0),
  gst_amount = COALESCE(gst_amount, 0),
  terms_accepted = COALESCE(terms_accepted, false)
WHERE taxable_amount = 0;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_delivery_charge_nonnegative;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_delivery_charge_nonnegative
  CHECK (pickup_delivery_charge >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_taxable_amount_nonnegative;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_taxable_amount_nonnegative
  CHECK (taxable_amount >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_gst_rate_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_gst_rate_valid
  CHECK (gst_rate >= 0 AND gst_rate <= 100);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_gst_amount_nonnegative;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_gst_amount_nonnegative
  CHECK (gst_amount >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_timestamp_consistency;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_timestamp_consistency
  CHECK (
    (
      terms_accepted = false
      AND terms_accepted_at IS NULL
    )
    OR
    (
      terms_accepted = true
      AND terms_accepted_at IS NOT NULL
    )
  );

COMMIT;
