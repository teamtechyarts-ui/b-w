-- ============================================================
-- Bright & White
-- Step 6F-C4
-- Performance Indexes + Final Security Hardening
-- ============================================================
--
-- Goals:
--   1. Remove one proven duplicate index.
--   2. Add high-value FK/join indexes for operational workloads.
--   3. Harden legacy SECURITY DEFINER search paths.
--   4. Revoke client EXECUTE from proven trigger/internal helpers.
--
-- No CASCADE is intentionally used.
-- ============================================================


-- ============================================================
-- 1. REMOVE PROVEN DUPLICATE INDEX
-- ============================================================
--
-- Both indexes were proven to be:
--   notifications(profile_id, created_at DESC)
--
-- Keep idx_notifications_profile_created because its name
-- describes the actual index structure more accurately.
-- ============================================================

DROP INDEX IF EXISTS public.idx_notifications_profile;


-- ============================================================
-- 2. DRIVER / LOGISTICS INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_driver_location_history_driver
    ON public.driver_location_history(driver_id);

CREATE INDEX IF NOT EXISTS idx_driver_navigation_events_driver
    ON public.driver_navigation_events(driver_id);

CREATE INDEX IF NOT EXISTS idx_driver_navigation_events_order
    ON public.driver_navigation_events(order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_proofs_driver
    ON public.delivery_proofs(driver_id);

CREATE INDEX IF NOT EXISTS idx_route_batches_driver
    ON public.route_batches(driver_id);


-- ============================================================
-- 3. FACILITY OPERATION INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_facility_operations_facility
    ON public.facility_order_operations(facility_id);

CREATE INDEX IF NOT EXISTS idx_facility_operations_machine
    ON public.facility_order_operations(machine_id);

CREATE INDEX IF NOT EXISTS idx_facility_operations_performed_by
    ON public.facility_order_operations(performed_by);

CREATE INDEX IF NOT EXISTS idx_processing_batches_facility
    ON public.facility_processing_batches(facility_id);

CREATE INDEX IF NOT EXISTS idx_processing_batches_machine
    ON public.facility_processing_batches(machine_id);


-- ============================================================
-- 4. GARMENT / EXCEPTION PROCESSING INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_garment_inspections_operation
    ON public.garment_inspections(operation_id);

CREATE INDEX IF NOT EXISTS idx_garment_inspections_order_item
    ON public.garment_inspections(order_item_id);

CREATE INDEX IF NOT EXISTS idx_garment_inspections_inspected_by
    ON public.garment_inspections(inspected_by);

CREATE INDEX IF NOT EXISTS idx_garment_inspections_verified_by
    ON public.garment_inspections(verified_by);

CREATE INDEX IF NOT EXISTS idx_damage_reports_operation
    ON public.damage_reports(operation_id);

CREATE INDEX IF NOT EXISTS idx_damage_reports_order_item
    ON public.damage_reports(order_item_id);

CREATE INDEX IF NOT EXISTS idx_missing_item_reports_operation
    ON public.missing_item_reports(operation_id);

CREATE INDEX IF NOT EXISTS idx_missing_item_reports_order_item
    ON public.missing_item_reports(order_item_id);


-- ============================================================
-- 5. ORDER LIFECYCLE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_order_status_history_order
    ON public.order_status_history(order_id);

CREATE INDEX IF NOT EXISTS idx_orders_pickup_address
    ON public.orders(pickup_address_id);

CREATE INDEX IF NOT EXISTS idx_orders_delivery_address
    ON public.orders(delivery_address_id);

CREATE INDEX IF NOT EXISTS idx_order_otps_order
    ON public.order_otps(order_id);

CREATE INDEX IF NOT EXISTS idx_order_item_photos_order_item
    ON public.order_item_photos(order_item_id);


-- ============================================================
-- 6. PACKAGES / PAYMENTS INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_package_usage_subscription
    ON public.package_usage(subscription_id);

CREATE INDEX IF NOT EXISTS idx_package_usage_package_service
    ON public.package_usage(package_service_id);

CREATE INDEX IF NOT EXISTS idx_package_usage_order
    ON public.package_usage(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_order
    ON public.payment_transactions(payment_order_id);


-- ============================================================
-- 7. NOTIFICATION / DEVICE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_device_tokens_profile
    ON public.device_tokens(profile_id);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_notification
    ON public.notification_delivery_attempts(notification_id);


-- ============================================================
-- 8. OTHER HIGH-VALUE RELATIONSHIP INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_facility_employees_profile
    ON public.facility_employees(profile_id);

CREATE INDEX IF NOT EXISTS idx_facility_machines_facility
    ON public.facility_machines(facility_id);

CREATE INDEX IF NOT EXISTS idx_processing_batch_orders_operation
    ON public.processing_batch_orders(operation_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
    ON public.referrals(referrer_customer_id);

CREATE INDEX IF NOT EXISTS idx_package_services_service
    ON public.package_services(service_id);


-- ============================================================
-- 9. HARDEN SECURITY DEFINER SEARCH PATHS
-- ============================================================
--
-- These are application-owned functions, not PostGIS functions.
-- Existing behavior is unchanged; only object resolution is
-- hardened against search-path manipulation.
-- ============================================================

ALTER FUNCTION public.can_access_facility_operation(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.can_access_processing_batch(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.create_default_notification_preferences()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.current_driver_id()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.find_driver_assignment_candidates(
    uuid,
    public.assignment_type,
    integer
)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.find_nearby_driver_jobs(uuid, numeric)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.get_active_employee_facility(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.get_customer_loyalty_balance(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.has_facility_access(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.has_role(public.user_role_code)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.is_admin()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.is_admin(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.is_admin_or_manager()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.is_customer_owner(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.is_facility_employee(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.is_manager()
    SET search_path = public, pg_temp;

ALTER FUNCTION public.upsert_driver_live_location(
    uuid,
    numeric,
    numeric,
    numeric
)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.validate_active_facility_employee(uuid, uuid)
    SET search_path = public, pg_temp;


-- ============================================================
-- 10. REVOKE DIRECT CLIENT EXECUTE FROM TRIGGER-ONLY FUNCTIONS
-- ============================================================
--
-- These functions are invoked through database triggers and
-- should not be exposed as client RPC endpoints.
-- ============================================================

REVOKE ALL ON FUNCTION
    public.create_default_notification_preferences()
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    public.create_default_notification_preferences()
FROM anon;

REVOKE ALL ON FUNCTION
    public.create_default_notification_preferences()
FROM authenticated;


REVOKE ALL ON FUNCTION
    public.handle_new_user()
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    public.handle_new_user()
FROM anon;

REVOKE ALL ON FUNCTION
    public.handle_new_user()
FROM authenticated;


-- ============================================================
-- 11. REVOKE DIRECT CLIENT EXECUTE FROM INTERNAL FACILITY
--     VALIDATION HELPERS
-- ============================================================
--
-- Catalog usage proved validate_active_facility_employee()
-- is called by internal integrity functions rather than RLS.
--
-- get_active_employee_facility() had no policy/client dependency
-- in the dependency audit and is treated as an internal helper.
-- ============================================================

REVOKE ALL ON FUNCTION
    public.validate_active_facility_employee(uuid, uuid)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    public.validate_active_facility_employee(uuid, uuid)
FROM anon;

REVOKE ALL ON FUNCTION
    public.validate_active_facility_employee(uuid, uuid)
FROM authenticated;


REVOKE ALL ON FUNCTION
    public.get_active_employee_facility(uuid)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    public.get_active_employee_facility(uuid)
FROM anon;

REVOKE ALL ON FUNCTION
    public.get_active_employee_facility(uuid)
FROM authenticated;


-- ============================================================
-- END STEP 6F-C4
-- ============================================================