-- ============================================
-- Bright & White
-- Phase 4B Step 6
-- Database Security and RLS Hardening
-- ============================================

-- --------------------------------------------
-- Helper: Check whether authenticated user
-- has a particular role
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.has_role(
    required_role public.user_role_code
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profile_roles pr
        JOIN public.roles r
            ON r.id = pr.role_id
        WHERE pr.profile_id = auth.uid()
          AND r.code::text = required_role::text
    );
$$;


-- --------------------------------------------
-- Helper: Check whether user is admin
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.has_role('admin');
$$;


-- --------------------------------------------
-- Helper: Check whether user is manager
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.has_role('manager');
$$;


-- --------------------------------------------
-- Helper: Check customer ownership
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.is_customer_owner(
    target_customer_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = target_customer_id
          AND c.profile_id = auth.uid()
    );
$$;


-- --------------------------------------------
-- Helper: Get current driver's ID
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT d.id
    FROM public.drivers d
    WHERE d.profile_id = auth.uid()
      AND d.is_active = true
    LIMIT 1;
$$;


-- --------------------------------------------
-- Helper: Check whether current user belongs
-- to a specific facility
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.has_facility_access(
    target_facility_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR public.is_manager()
        OR EXISTS (
            SELECT 1
            FROM public.facility_employees fe
            WHERE fe.profile_id = auth.uid()
              AND fe.facility_id = target_facility_id
        );
$$;

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_execution_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_proofs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_navigation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_order_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_processing_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.garment_inspections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.loyalty_point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.missing_item_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notification_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_item_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.package_service_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.processing_batch_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.qr_scan_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.route_batch_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;