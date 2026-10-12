-- ============================================================================
-- BRIGHT & WHITE LAUNDRY PLATFORM — ORDER DATA CLEANUP (STEP 1)
-- Only deletes the 38 non-protected orders and their operational dependencies.
-- PRESERVES: 4 protected orders, 4 protected assignments, immutable audits,
-- customers, drivers, facility employees, facilities, catalogue, pricing.
-- ============================================================================

BEGIN;

-- 1. Create temporary table of protected orders
CREATE TEMP TABLE temp_protected_orders (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO temp_protected_orders (id) VALUES
  ('63441735-a88e-43de-b958-06c7a32d8353'),
  ('8ec5ebd1-6079-420d-8320-c91481005dfd'),
  ('3a467513-a2a3-4bf3-814c-f8f67b4a93d2'),
  ('19a3202c-513a-4311-851b-08a2e86fa10d');

-- 2. Create temporary table of protected assignments
CREATE TEMP TABLE temp_protected_assignments (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO temp_protected_assignments (id) VALUES
  ('c4a1e322-4a88-42bd-8401-1bdd25d33eb6'),
  ('76cbe490-3c46-473b-b854-59893f97b0fb'),
  ('f4fb73f6-3a85-4431-b196-e4bb75c64a92'),
  ('5175982e-ccc0-4885-94c3-75592a623e6e');

-- 3. Delete non-cascading child records for deletable orders
-- A. Driver navigation events (ON DELETE NO ACTION)
DELETE FROM public.driver_navigation_events
WHERE order_id NOT IN (SELECT id FROM temp_protected_orders);

-- B. Driver trip locations for non-protected assignments
DELETE FROM public.driver_trip_locations
WHERE assignment_id NOT IN (SELECT id FROM temp_protected_assignments);

-- C. Delivery proofs for non-protected orders
DELETE FROM public.delivery_proofs
WHERE order_id NOT IN (SELECT id FROM temp_protected_orders);

-- D. Route batch stops for non-protected assignments
DELETE FROM public.route_batch_stops
WHERE assignment_id NOT IN (SELECT id FROM temp_protected_assignments);

-- E. Nullify or delete notifications linked to deletable orders
UPDATE public.notifications
SET order_id = NULL
WHERE order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM temp_protected_orders);

-- 4. Delete non-protected driver assignments (36 rows)
DELETE FROM public.driver_assignments
WHERE id NOT IN (SELECT id FROM temp_protected_assignments)
  AND order_id NOT IN (SELECT id FROM temp_protected_orders);

-- 5. Delete the 38 non-protected orders
-- (Cascades to order_items, order_status_history, facility_order_operations, garment_inspections, order_qr_codes, order_otps, payment_orders)
DELETE FROM public.orders
WHERE id NOT IN (SELECT id FROM temp_protected_orders);

-- 6. Verification queries inside transaction
DO $$
DECLARE
  v_order_count integer;
  v_assign_count integer;
  v_audit_count integer;
BEGIN
  SELECT count(*) INTO v_order_count FROM public.orders;
  SELECT count(*) INTO v_assign_count FROM public.driver_assignments;
  SELECT count(*) INTO v_audit_count FROM public.admin_assignment_audit;

  IF v_order_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 orders, found %', v_order_count;
  END IF;

  IF v_assign_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 assignments, found %', v_assign_count;
  END IF;

  IF v_audit_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 audit rows, found %', v_audit_count;
  END IF;
END $$;

COMMIT;
