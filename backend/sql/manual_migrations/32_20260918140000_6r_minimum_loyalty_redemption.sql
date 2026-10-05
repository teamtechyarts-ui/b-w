-- Enforce the approved ₹10 checkout minimum at the database boundary.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_loyalty_redemption_minimum;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_loyalty_redemption_minimum
  CHECK (loyalty_points_redeemed = 0 OR loyalty_points_redeemed >= 1000);
