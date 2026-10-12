-- ============================================================================
-- BRIGHT & WHITE LAUNDRY PLATFORM — STAFF DATA CLEANUP (STEP 2)
-- Only deletes the 7 safe driver accounts and 2 safe facility employee accounts.
-- PRESERVES: 4 protected drivers, 1 protected facility employee,
-- 4 protected orders, 4 protected assignments, immutable audits,
-- customers, admin, managers, facilities, catalogue, pricing.
-- ============================================================================

BEGIN;

-- 1. Create temporary table of safe drivers to delete
CREATE TEMP TABLE temp_safe_drivers (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO temp_safe_drivers (id, profile_id) VALUES
  ('baf27b47-c189-4143-9a7f-da95c391d820', 'ad56f27f-cd5b-4901-b713-f0f654857dce'),
  ('6318919f-77d6-4cca-ae46-8bb76fcddc73', 'be58d052-bde6-4c9a-8010-5a3229fc5a2c'),
  ('3b28a805-3932-4999-9432-c93d70a042f6', '18822cac-3661-4773-a8cc-a338e9a3f2e4'),
  ('3677fc3f-4f85-4ed9-993a-8165d4073fe0', '96cbb7dd-8aa2-4778-870a-20d45a2ca6ab'),
  ('c576c618-b44a-4914-85ed-3da789568e80', '59dbf265-9969-4b48-9862-2a854e81949c'),
  ('9dce6e4a-ce89-445f-ae0a-5b1c6ef75228', 'f8814a1d-401e-4826-b80d-66f43afca1a1'),
  ('4d4d85cc-d073-4279-84b8-31c5c1dce1bd', '636c6c8a-f12b-4ee4-bd35-52b001b83821');

-- 2. Create temporary table of safe facility employees to delete
CREATE TEMP TABLE temp_safe_facility_employees (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO temp_safe_facility_employees (id, profile_id) VALUES
  ('c1482534-f02b-47e6-96d8-9c9caadfa097', '852aa719-965c-4160-9d81-7771c6cda91f'),
  ('977a0d84-cfd3-43d0-ae0c-efbc3c05d416', '85284640-d000-4e3f-b630-bd945fb5e269');

-- 3. Delete driver-specific operational records for the 7 safe drivers (if any)
DELETE FROM public.driver_live_locations WHERE driver_id IN (SELECT id FROM temp_safe_drivers);
DELETE FROM public.driver_location_history WHERE driver_id IN (SELECT id FROM temp_safe_drivers);
DELETE FROM public.vehicles WHERE driver_id IN (SELECT id FROM temp_safe_drivers);
DELETE FROM public.route_batches WHERE driver_id IN (SELECT id FROM temp_safe_drivers);

-- 4. Delete the 7 safe drivers from public.drivers
DELETE FROM public.drivers WHERE id IN (SELECT id FROM temp_safe_drivers);

-- 5. Delete the 2 safe facility employees from public.facility_employees
DELETE FROM public.facility_employees WHERE id IN (SELECT id FROM temp_safe_facility_employees);

-- 6. Delete profile-specific records for the 9 safe profiles
DELETE FROM public.notifications WHERE profile_id IN (SELECT profile_id FROM temp_safe_drivers UNION SELECT profile_id FROM temp_safe_facility_employees);
DELETE FROM public.notification_preferences WHERE profile_id IN (SELECT profile_id FROM temp_safe_drivers UNION SELECT profile_id FROM temp_safe_facility_employees);
DELETE FROM public.device_tokens WHERE profile_id IN (SELECT profile_id FROM temp_safe_drivers UNION SELECT profile_id FROM temp_safe_facility_employees);
DELETE FROM public.profile_roles WHERE profile_id IN (SELECT profile_id FROM temp_safe_drivers UNION SELECT profile_id FROM temp_safe_facility_employees);

-- 7. Delete the 9 safe profiles from public.profiles
DELETE FROM public.profiles WHERE id IN (SELECT profile_id FROM temp_safe_drivers UNION SELECT profile_id FROM temp_safe_facility_employees);

-- 8. Verification assertions inside transaction
DO $$
DECLARE
  v_driver_count integer;
  v_fac_emp_count integer;
  v_order_count integer;
  v_assign_count integer;
  v_audit_count integer;
  v_staff_audit_count integer;
BEGIN
  SELECT count(*) INTO v_driver_count FROM public.drivers;
  SELECT count(*) INTO v_fac_emp_count FROM public.facility_employees;
  SELECT count(*) INTO v_order_count FROM public.orders;
  SELECT count(*) INTO v_assign_count FROM public.driver_assignments;
  SELECT count(*) INTO v_audit_count FROM public.admin_assignment_audit;
  SELECT count(*) INTO v_staff_audit_count FROM public.admin_staff_action_audit;

  IF v_driver_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 drivers, found %', v_driver_count;
  END IF;

  IF v_fac_emp_count <> 1 THEN
    RAISE EXCEPTION 'Verification failed: Expected 1 facility employee, found %', v_fac_emp_count;
  END IF;

  IF v_order_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 orders, found %', v_order_count;
  END IF;

  IF v_assign_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 assignments, found %', v_assign_count;
  END IF;

  IF v_audit_count <> 4 THEN
    RAISE EXCEPTION 'Verification failed: Expected 4 assignment audits, found %', v_audit_count;
  END IF;

  IF v_staff_audit_count <> 29 THEN
    RAISE EXCEPTION 'Verification failed: Expected 29 staff audits, found %', v_staff_audit_count;
  END IF;
END $$;

COMMIT;
