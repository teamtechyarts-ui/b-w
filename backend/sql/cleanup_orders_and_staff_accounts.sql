-- ============================================================================
-- BRIGHT & WHITE — FORENSIC DATA CLEANUP SCRIPT
-- Purpose:
--   1. Delete all order data across customers, drivers, and facility employees.
--   2. Delete all driver and facility employee accounts (auth.users + profiles).
--   3. PRESERVE all Admin, Manager, and Customer accounts & catalog data.
-- Execution:
--   Run directly in the Supabase SQL Editor as postgres/superuser.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: IDENTIFY STAFF PROFILES TO BE DELETED (DRIVERS & FACILITY EMPLOYEES)
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE temp_staff_profiles_to_delete ON COMMIT DROP AS
SELECT DISTINCT p.id AS profile_id, p.full_name, p.phone, r.code AS role_code
FROM public.profiles p
JOIN public.profile_roles pr ON pr.profile_id = p.id
JOIN public.roles r ON r.id = pr.role_id
WHERE r.code IN ('driver', 'facility_employee', 'facility_operator')
  -- Safety guard: NEVER delete admin or manager accounts
  AND NOT EXISTS (
    SELECT 1 
    FROM public.profile_roles pr_admin
    JOIN public.roles r_admin ON r_admin.id = pr_admin.role_id
    WHERE pr_admin.profile_id = p.id 
      AND r_admin.code IN ('admin', 'manager')
  )
  -- Safety guard: NEVER delete customer accounts
  AND NOT EXISTS (
    SELECT 1 
    FROM public.profile_roles pr_cust
    JOIN public.roles r_cust ON r_cust.id = pr_cust.role_id
    WHERE pr_cust.profile_id = p.id 
      AND r_cust.code = 'customer'
  );

-- ----------------------------------------------------------------------------
-- STEP 2: DELETE ORDER-RELATED OPERATIONAL DATA (CASCADE ORDER)
-- ----------------------------------------------------------------------------

-- 2.1 Customer Claims & Photos
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_claim_photos') THEN
    DELETE FROM public.customer_claim_photos;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_claims') THEN
    DELETE FROM public.customer_claims;
  END IF;
END $$;

-- 2.2 Facility Quality & Processing Audits
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'facility_packing_audits') THEN
    DELETE FROM public.facility_packing_audits;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'facility_qc_audits') THEN
    DELETE FROM public.facility_qc_audits;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'damage_reports') THEN
    DELETE FROM public.damage_reports;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'missing_item_reports') THEN
    DELETE FROM public.missing_item_reports;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'garment_inspections') THEN
    DELETE FROM public.garment_inspections;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'processing_batch_orders') THEN
    DELETE FROM public.processing_batch_orders;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'facility_order_operations') THEN
    DELETE FROM public.facility_order_operations;
  END IF;
END $$;

-- 2.3 Driver Logistics, Route Batches, Proofs & Navigation
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_navigation_events') THEN
    DELETE FROM public.driver_navigation_events;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'route_batch_stops') THEN
    DELETE FROM public.route_batch_stops;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'route_batches') THEN
    DELETE FROM public.route_batches;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'delivery_proofs') THEN
    DELETE FROM public.delivery_proofs;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_assignments') THEN
    DELETE FROM public.driver_assignments;
  END IF;
END $$;

-- 2.4 QR codes, Scans & OTPs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'qr_scan_logs') THEN
    DELETE FROM public.qr_scan_logs;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_qr_codes') THEN
    DELETE FROM public.order_qr_codes;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_otps') THEN
    DELETE FROM public.order_otps;
  END IF;
END $$;

-- 2.5 Payments, Refunds & Transactions
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refund_requests') THEN
    DELETE FROM public.refund_requests;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_transactions') THEN
    DELETE FROM public.payment_transactions;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_orders') THEN
    DELETE FROM public.payment_orders;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_webhook_events') THEN
    DELETE FROM public.payment_webhook_events;
  END IF;
END $$;

-- 2.6 Package & Loyalty Usage linked to orders
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'package_usage') THEN
    DELETE FROM public.package_usage WHERE order_id IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'loyalty_point_transactions') THEN
    DELETE FROM public.loyalty_point_transactions WHERE reference_type = 'order';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'loyalty_transactions') THEN
    DELETE FROM public.loyalty_transactions WHERE reference_type = 'order';
  END IF;
END $$;

-- 2.7 Order Items, Photos & Status History
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_item_photos') THEN
    DELETE FROM public.order_item_photos;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
    DELETE FROM public.order_items;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_status_history') THEN
    DELETE FROM public.order_status_history;
  END IF;
END $$;

-- 2.8 Order Notifications
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    DELETE FROM public.notifications WHERE order_id IS NOT NULL;
  END IF;
END $$;

-- 2.9 Delete ALL Orders
DELETE FROM public.orders;

-- ----------------------------------------------------------------------------
-- STEP 3: DELETE DRIVERS & FACILITY EMPLOYEES PROFILES & ACCOUNTS
-- ----------------------------------------------------------------------------

-- 3.1 Driver location data & vehicles
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_live_locations') THEN
    DELETE FROM public.driver_live_locations 
    WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_location_history') THEN
    DELETE FROM public.driver_location_history 
    WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicles') THEN
    DELETE FROM public.vehicles 
    WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drivers') THEN
    DELETE FROM public.drivers 
    WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
END $$;

-- 3.2 Facility employees
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'facility_employees') THEN
    DELETE FROM public.facility_employees 
    WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
END $$;

-- 3.3 Staff device tokens, notification preferences, and notifications
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device_tokens') THEN
    DELETE FROM public.device_tokens WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_devices') THEN
    DELETE FROM public.push_devices WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notification_preferences') THEN
    DELETE FROM public.notification_preferences WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    DELETE FROM public.notifications WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
END $$;

-- 3.4 Unlink staff from audit logs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_activity_logs') THEN
    UPDATE public.admin_activity_logs SET actor_profile_id = NULL WHERE actor_profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
    UPDATE public.admin_activity_logs SET admin_id = NULL WHERE admin_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_audit_logs') THEN
    UPDATE public.financial_audit_logs SET actor_profile_id = NULL WHERE actor_profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
  END IF;
END $$;

-- 3.5 Delete profile roles and profiles
DELETE FROM public.profile_roles WHERE profile_id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);
DELETE FROM public.profiles WHERE id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);

-- 3.6 Delete auth.users accounts for the drivers and facility employees
DELETE FROM auth.users WHERE id IN (SELECT profile_id FROM temp_staff_profiles_to_delete);

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION REPORT
-- ----------------------------------------------------------------------------
SELECT 'orders' AS table_name, count(*) AS remaining_records FROM public.orders
UNION ALL
SELECT 'driver_assignments', count(*) FROM public.driver_assignments
UNION ALL
SELECT 'drivers', count(*) FROM public.drivers
UNION ALL
SELECT 'facility_employees', count(*) FROM public.facility_employees
UNION ALL
SELECT 'customers (preserved)', count(*) FROM public.customers
UNION ALL
SELECT 'admin/manager profiles (preserved)', count(*) 
FROM public.profiles p 
JOIN public.profile_roles pr ON pr.profile_id = p.id 
JOIN public.roles r ON r.id = pr.role_id 
WHERE r.code IN ('admin', 'manager');
