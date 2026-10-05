-- =============================================================================
-- PART 1 of 3 — Core schema, security (RLS), integrity
-- Bright & White / Supabase manual setup
-- Run this ENTIRE file in Supabase SQL Editor (one paste).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 01_20260907155337_consolidated_backend_schema.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- BRIGHT & WHITE MASTER SCHEMA v1.0
-- Final Consolidated Production SQL for Supabase / PostgreSQL
-- Canonical baseline generated from reconstructed migrations 001-012.
-- Version: 1.0.0
-- IMPORTANT: Execute against a NEW Supabase project/database.
-- ============================================================================


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 2. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.user_role_code AS ENUM ('admin','manager','facility_employee','driver','customer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM (
    'draft','pending_payment','confirmed',
    'pickup_assigned','pickup_accepted','en_route_pickup','pickup_otp_pending','picked_up',
    'in_transit_to_facility','received_at_facility','verification','processing',
    'quality_check','rework_required','ready_for_delivery',
    'delivery_assigned','delivery_accepted','en_route_delivery','delivery_otp_pending',
    'delivered','claim_period_active','completed',
    'cancelled','pickup_failed','delivery_failed','on_hold'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assignment_type AS ENUM ('pickup','delivery','facility_return','nearby_pickup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assignment_status AS ENUM ('assigned','accepted','rejected','en_route','arrived','completed','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('razorpay','cash_on_delivery','package_credit','loyalty_points');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending','authorized','paid','failed','cancelled','refunded','partially_refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.refund_status AS ENUM ('requested','under_review','approved','rejected','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.facility_operation_status AS ENUM (
    'received','verification','washing','drying','ironing','folding','packaging',
    'quality_check','rework_required','ready_for_delivery'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.machine_status AS ENUM ('active','idle','running','maintenance','out_of_service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_channel AS ENUM ('push','sms','whatsapp','email','in_app');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_status AS ENUM ('queued','processing','sent','delivered','read','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_priority AS ENUM ('low','normal','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 3. COMMON FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- ============================================================================
-- 4. IDENTITY, ROLES AND PERMISSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text UNIQUE,
  avatar_path text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.profile_roles (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY(profile_id, role_id)
);

-- ============================================================================
-- ADMIN HELPER FUNCTION
-- Must be created after profiles, roles and profile_roles tables
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_roles pr
    INNER JOIN public.roles r
      ON r.id = pr.role_id
    WHERE pr.profile_id = p_user_id
      AND r.code = 'admin'
  );
$$;

-- ============================================================================
-- 5. CUSTOMERS AND ADDRESSES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code text NOT NULL UNIQUE,
  loyalty_balance integer NOT NULL DEFAULT 0 CHECK (loyalty_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  label text,
  address_line1 text NOT NULL,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  location geography(Point,4326),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. FACILITIES AND EMPLOYEES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  location geography(Point,4326),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facility_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, profile_id)
);

-- ============================================================================
-- 7. DRIVERS, VEHICLES AND GPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_available boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  max_concurrent_jobs integer NOT NULL DEFAULT 5 CHECK(max_concurrent_jobs > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  registration_number text NOT NULL UNIQUE,
  vehicle_type text,
  capacity_kg numeric(10,2),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.driver_live_locations (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  location geography(Point,4326),
  accuracy_m numeric(10,2),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  location geography(Point,4326),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 8. SERVICES AND PRICING
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.service_categories(id),
  name text NOT NULL,
  description text,
  pricing_unit text NOT NULL DEFAULT 'item',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE CASCADE,
  price numeric(12,2) NOT NULL CHECK(price >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  UNIQUE(service_id, facility_id, effective_from)
);

-- ============================================================================
-- 9. ORDER ENGINE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  facility_id uuid REFERENCES public.facilities(id),
  current_status public.order_status NOT NULL DEFAULT 'draft',
  pickup_address_id uuid REFERENCES public.customer_addresses(id),
  delivery_address_id uuid REFERENCES public.customer_addresses(id),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_method public.payment_method,
  claim_deadline_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id),
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK(quantity > 0),
  weight_kg numeric(10,2),
  unit_price numeric(12,2) NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
  line_total numeric(12,2) NOT NULL DEFAULT 0 CHECK(line_total >= 0),
  customer_notes text
);

CREATE TABLE IF NOT EXISTS public.order_item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  secure_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qr_scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id uuid NOT NULL REFERENCES public.order_qr_codes(id) ON DELETE CASCADE,
  scanner_profile_id uuid REFERENCES public.profiles(id),
  scan_action text NOT NULL,
  latitude numeric(10,7),
  longitude numeric(10,7),
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  otp_type text NOT NULL CHECK(otp_type IN ('pickup','delivery')),
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id),
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  photo_path text NOT NULL,
  latitude numeric(10,7),
  longitude numeric(10,7),
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status public.order_status,
  to_status public.order_status NOT NULL,
  changed_by uuid REFERENCES public.profiles(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. DRIVER ASSIGNMENTS AND LOGISTICS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.driver_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  assignment_type public.assignment_type NOT NULL,
  status public.assignment_status NOT NULL DEFAULT 'assigned',
  assignment_score numeric(12,4),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  rejection_reason text
);

CREATE TABLE IF NOT EXISTS public.route_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  batch_type public.assignment_type NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.route_batch_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_batch_id uuid NOT NULL REFERENCES public.route_batches(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.driver_assignments(id) ON DELETE CASCADE,
  stop_sequence integer NOT NULL CHECK(stop_sequence > 0),
  UNIQUE(route_batch_id, stop_sequence)
);

CREATE TABLE IF NOT EXISTS public.driver_navigation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  order_id uuid REFERENCES public.orders(id),
  event_type text NOT NULL,
  destination_latitude numeric(10,7),
  destination_longitude numeric(10,7),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 11. PAYMENTS, RAZORPAY AND REFUNDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  provider text NOT NULL,
  provider_order_id text,
  provider_payment_id text,
  amount numeric(12,2) NOT NULL CHECK(amount >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status public.payment_status NOT NULL DEFAULT 'pending',
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_transaction_id uuid REFERENCES public.payment_transactions(id),
  requested_by uuid REFERENCES public.profiles(id),
  amount numeric(12,2) NOT NULL CHECK(amount > 0),
  reason text,
  status public.refund_status NOT NULL DEFAULT 'requested',
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  provider_refund_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 12. PACKAGES, OFFERS, REFERRALS AND LOYALTY
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  monthly_price numeric(12,2) NOT NULL CHECK(monthly_price >= 0),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.package_service_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id),
  usage_limit integer NOT NULL CHECK(usage_limit >= 0),
  UNIQUE(package_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.package_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  package_id uuid NOT NULL REFERENCES public.packages(id),
  status text NOT NULL DEFAULT 'active',
  auto_renew boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.package_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.package_subscriptions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id),
  order_id uuid REFERENCES public.orders(id),
  usage_quantity integer NOT NULL DEFAULT 1 CHECK(usage_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  discount_type text NOT NULL CHECK(discount_type IN ('percentage','fixed')),
  discount_value numeric(12,2) NOT NULL CHECK(discount_value >= 0),
  minimum_order_amount numeric(12,2) NOT NULL DEFAULT 0,
  starts_at timestamptz,
  expires_at timestamptz,
  usage_limit integer,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_customer_id uuid NOT NULL REFERENCES public.customers(id),
  referred_customer_id uuid NOT NULL REFERENCES public.customers(id),
  referral_code text NOT NULL,
  reward_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referred_customer_id)
);

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  points integer NOT NULL,
  transaction_type text NOT NULL CHECK(transaction_type IN ('earned','redeemed','expired','adjustment')),
  reference_type text,
  reference_id uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 13. FACILITY OPERATIONS AND LAUNDRY PROCESSING
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.facility_order_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  current_status public.facility_operation_status NOT NULL DEFAULT 'received',
  received_at timestamptz,
  ready_for_delivery_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.garment_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.facility_order_operations(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id),
  counted_quantity integer NOT NULL DEFAULT 0,
  weight_kg numeric(10,2),
  condition_notes text,
  verified_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.damage_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.facility_order_operations(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id),
  description text NOT NULL,
  detected_by uuid REFERENCES public.profiles(id),
  photo_path text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.missing_item_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.facility_order_operations(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id),
  quantity integer NOT NULL DEFAULT 1 CHECK(quantity > 0),
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facility_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  machine_name text NOT NULL,
  machine_type text NOT NULL,
  capacity_kg numeric(10,2),
  status public.machine_status NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.facility_processing_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid REFERENCES public.facility_machines(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  batch_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.processing_batch_orders (
  batch_id uuid NOT NULL REFERENCES public.facility_processing_batches(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.facility_order_operations(id) ON DELETE CASCADE,
  PRIMARY KEY(batch_id, operation_id)
);

-- ============================================================================
-- 14. NOTIFICATIONS AND SYSTEM ADMINISTRATION
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  promotional_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK(platform IN ('ios','android','web')),
  provider text NOT NULL CHECK(provider IN ('fcm','apns','expo')),
  device_token text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  channel public.notification_channel NOT NULL DEFAULT 'in_app',
  priority public.notification_priority NOT NULL DEFAULT 'normal',
  event_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.notification_status NOT NULL DEFAULT 'queued',
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  provider_response jsonb,
  status public.notification_status NOT NULL DEFAULT 'queued',
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_configurations (
  config_key text PRIMARY KEY,
  config_value jsonb NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL UNIQUE,
  flag_name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  rollout_percentage numeric(5,2) NOT NULL DEFAULT 100 CHECK(rollout_percentage BETWEEN 0 AND 100),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','high','critical')),
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_rate_limit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  identifier text NOT NULL,
  endpoint text,
  request_count integer NOT NULL DEFAULT 1,
  window_expires_at timestamptz NOT NULL,
  UNIQUE(scope, identifier, endpoint)
);

CREATE TABLE IF NOT EXISTS public.backup_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type text NOT NULL,
  status text NOT NULL,
  backup_location text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================================================
-- 15. ORDER STATUS ENGINE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_status_transitions (
  from_status public.order_status,
  to_status public.order_status NOT NULL,
  PRIMARY KEY(from_status, to_status)
);

INSERT INTO public.order_status_transitions(from_status,to_status) VALUES
('draft','pending_payment'),('draft','confirmed'),
('pending_payment','confirmed'),('pending_payment','cancelled'),
('confirmed','pickup_assigned'),('confirmed','cancelled'),
('pickup_assigned','pickup_accepted'),('pickup_assigned','cancelled'),
('pickup_accepted','en_route_pickup'),('en_route_pickup','pickup_otp_pending'),
('pickup_otp_pending','picked_up'),('picked_up','in_transit_to_facility'),
('in_transit_to_facility','received_at_facility'),('received_at_facility','verification'),
('verification','processing'),('processing','quality_check'),('processing','rework_required'),
('rework_required','processing'),('quality_check','ready_for_delivery'),
('ready_for_delivery','delivery_assigned'),('delivery_assigned','delivery_accepted'),
('delivery_accepted','en_route_delivery'),('en_route_delivery','delivery_otp_pending'),
('delivery_otp_pending','delivered'),('delivered','claim_period_active'),
('claim_period_active','completed')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.change_order_status(
  p_order_id uuid, p_new_status public.order_status, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.order_status;
BEGIN
  SELECT current_status INTO v_old FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_status_transitions
    WHERE from_status=v_old AND to_status=p_new_status
  ) THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> %', v_old, p_new_status;
  END IF;
  UPDATE public.orders SET current_status=p_new_status, updated_at=now(),
    delivered_at=CASE WHEN p_new_status='delivered' THEN now() ELSE delivered_at END,
    claim_deadline_at=CASE WHEN p_new_status='delivered' THEN now()+interval '7 days' ELSE claim_deadline_at END
  WHERE id=p_order_id;
  INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,reason)
  VALUES(p_order_id,v_old,p_new_status,auth.uid(),p_reason);
END $$;

-- ============================================================================
-- 16. AUTOMATION FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_default_notification_preferences()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.notification_preferences(profile_id)
  VALUES(NEW.id) ON CONFLICT(profile_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.apply_loyalty_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.customers
  SET loyalty_balance = GREATEST(0, loyalty_balance + NEW.points),
      updated_at=now()
  WHERE id=NEW.customer_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_refund_admin_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved','processing','completed') AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Refund approval requires an admin profile';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number='' THEN
    NEW.order_number := 'BW-' || to_char(now(),'YYYYMMDD') || '-' ||
                        upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  END IF;
  RETURN NEW;
END $$;

-- ============================================================================
-- 17. TRIGGERS
-- ============================================================================
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_facilities_updated BEFORE UPDATE ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profile_notification_preferences AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.create_default_notification_preferences();
CREATE TRIGGER trg_order_number BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.generate_order_number();
CREATE TRIGGER trg_loyalty_balance AFTER INSERT ON public.loyalty_transactions FOR EACH ROW EXECUTE FUNCTION public.apply_loyalty_transaction();
CREATE TRIGGER trg_refund_admin BEFORE INSERT OR UPDATE ON public.refund_requests FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_admin_approval();

-- ============================================================================
-- 18. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON public.customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_driver_live_locations_geo ON public.driver_live_locations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(current_status);
CREATE INDEX IF NOT EXISTS idx_orders_facility ON public.orders(facility_id, current_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver ON public.driver_assignments(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_order ON public.driver_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON public.payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_profile ON public.notifications(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_open ON public.security_events(created_at DESC) WHERE resolved=false;

-- ============================================================================
-- 19. RLS
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self_read ON public.profiles FOR SELECT USING(id=auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE USING(id=auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY customers_self_read ON public.customers FOR SELECT USING(profile_id=auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY addresses_customer_access ON public.customer_addresses FOR ALL USING(
  EXISTS(SELECT 1 FROM public.customers c WHERE c.id=customer_id AND c.profile_id=auth.uid())
  OR public.is_admin(auth.uid())
);

CREATE POLICY orders_customer_read ON public.orders FOR SELECT USING(
  EXISTS(SELECT 1 FROM public.customers c WHERE c.id=customer_id AND c.profile_id=auth.uid())
  OR public.is_admin(auth.uid())
  OR EXISTS(SELECT 1 FROM public.driver_assignments da JOIN public.drivers d ON d.id=da.driver_id WHERE da.order_id=orders.id AND d.profile_id=auth.uid())
);

CREATE POLICY order_items_order_access ON public.order_items FOR SELECT USING(
  EXISTS(
    SELECT 1 FROM public.orders o JOIN public.customers c ON c.id=o.customer_id
    WHERE o.id=order_items.order_id AND c.profile_id=auth.uid()
  ) OR public.is_admin(auth.uid())
);

CREATE POLICY notifications_owner_read ON public.notifications FOR SELECT USING(profile_id=auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY notifications_owner_update ON public.notifications FOR UPDATE USING(profile_id=auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY devices_owner_manage ON public.push_devices FOR ALL USING(profile_id=auth.uid() OR public.is_admin(auth.uid()))
WITH CHECK(profile_id=auth.uid() OR public.is_admin(auth.uid()));

-- Admin/service-role controlled operational tables remain RLS-disabled in this
-- baseline and should be accessed through the Node.js trusted backend only.

-- ============================================================================
-- 20. SUPABASE STORAGE BUCKETS
-- ============================================================================
INSERT INTO storage.buckets(id,name,public) VALUES
('customer-product-photos','customer-product-photos',false),
('facility-order-images','facility-order-images',false),
('delivery-proofs','delivery-proofs',false),
('damage-reports','damage-reports',false),
('driver-documents','driver-documents',false)
ON CONFLICT(id) DO NOTHING;

-- ============================================================================
-- 21. SEED DATA
-- ============================================================================
INSERT INTO public.roles(code,name,description) VALUES
('admin','Administrator','Full system control'),
('manager','Manager','Operational management'),
('facility_employee','Facility Employee','Facility processing access'),
('driver','Driver','Pickup and delivery access'),
('customer','Customer','Customer application access')
ON CONFLICT(code) DO NOTHING;

INSERT INTO public.permissions(code,name) VALUES
('orders.read','Read orders'),('orders.manage','Manage orders'),
('drivers.manage','Manage drivers'),('facilities.manage','Manage facilities'),
('services.manage','Manage services and pricing'),('refunds.approve','Approve refunds'),
('users.manage','Manage users'),('analytics.read','Read analytics')
ON CONFLICT(code) DO NOTHING;

INSERT INTO public.system_configurations(config_key,config_value) VALUES
('claim_period_days','{"days":7}'::jsonb),
('pickup_otp_required','{"enabled":true}'::jsonb),
('delivery_otp_required','{"enabled":true}'::jsonb),
('delivery_photo_required','{"enabled":true}'::jsonb),
('driver_location_update_seconds','{"seconds":15}'::jsonb)
ON CONFLICT(config_key) DO NOTHING;

-- ============================================================================
-- BACKEND COMPATIBILITY LAYER
-- Generated from actual NestJS source audit. This section reconciles the
-- reconstructed master schema with the current backend contract.
-- ============================================================================

-- Backend uses this assignment state during worker-driven reassignment.
ALTER TYPE public.assignment_status ADD VALUE IF NOT EXISTS 'reassignment_required';

-- Orders: payments service requires a currency column.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR';

-- Driver live location: backend and RPC contract require updated_at as well as
-- latitude/longitude values for the fallback upsert path.
ALTER TABLE public.driver_live_locations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.sync_driver_live_location()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude),4326)::geography;
  ELSIF NEW.location IS NOT NULL THEN
    NEW.latitude := ST_Y(NEW.location::geometry);
    NEW.longitude := ST_X(NEW.location::geometry);
  END IF;
  NEW.updated_at := COALESCE(NEW.updated_at, now());
  NEW.recorded_at := COALESCE(NEW.recorded_at, now());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_driver_live_location ON public.driver_live_locations;
CREATE TRIGGER trg_sync_driver_live_location BEFORE INSERT OR UPDATE ON public.driver_live_locations
FOR EACH ROW EXECUTE FUNCTION public.sync_driver_live_location();

-- The existing Phase-3 RPC referenced a non-existent updated_at column and did
-- not populate latitude/longitude required by the NestJS fallback/query path.
CREATE OR REPLACE FUNCTION public.upsert_driver_live_location(
  p_driver_id uuid, p_latitude numeric, p_longitude numeric,
  p_accuracy_m numeric DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.driver_live_locations(
    driver_id, latitude, longitude, location, accuracy_m, recorded_at, updated_at
  ) VALUES (
    p_driver_id, p_latitude, p_longitude,
    ST_SetSRID(ST_MakePoint(p_longitude,p_latitude),4326)::geography,
    p_accuracy_m, now(), now()
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
    location=EXCLUDED.location, accuracy_m=EXCLUDED.accuracy_m,
    recorded_at=now(), updated_at=now();
END $$;

-- Facility backend supports multiple processing records per order. The master
-- schema modeled one operational aggregate row per order, so relax that model
-- and add the fields actually inserted/updated by FacilityService.
ALTER TABLE public.facility_order_operations DROP CONSTRAINT IF EXISTS facility_order_operations_order_id_key;
ALTER TABLE public.facility_order_operations ALTER COLUMN facility_id DROP NOT NULL;
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS operation_type text;
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS performed_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.facility_machines(id) ON DELETE SET NULL;
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS notes text;
-- Multiple operation rows are queried by order.
CREATE INDEX IF NOT EXISTS idx_facility_operations_order ON public.facility_order_operations(order_id);

-- Facility verification inserts are order-centric, while the reconstructed
-- master schema was operation-centric. Keep operation_id optional and expose
-- the backend contract directly.
ALTER TABLE public.garment_inspections ALTER COLUMN operation_id DROP NOT NULL;
ALTER TABLE public.garment_inspections ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE public.garment_inspections ADD COLUMN IF NOT EXISTS inspected_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.garment_inspections ADD COLUMN IF NOT EXISTS item_count integer;
ALTER TABLE public.garment_inspections ADD COLUMN IF NOT EXISTS inspection_status text;
CREATE INDEX IF NOT EXISTS idx_garment_inspections_order ON public.garment_inspections(order_id);

-- Payment aggregate required by PaymentsService.
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_order_id text NOT NULL UNIQUE,
  provider_payment_id text,
  amount numeric(12,2) NOT NULL CHECK(amount >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','authorized','paid','failed','cancelled','refunded','partially_refunded')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_order ON public.payment_orders(order_id);

-- Transaction model used by the backend is tied to payment_orders.
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE CASCADE;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS transaction_type text;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS provider_reference text;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS processed_at timestamptz;
-- Backend status strings are success/failed rather than the master enum only.
ALTER TABLE public.payment_transactions ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.payment_transactions ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE public.payment_transactions ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.payment_webhook_events ADD COLUMN IF NOT EXISTS provider_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_webhook_provider_event
ON public.payment_webhook_events(provider,provider_event_id) WHERE provider_event_id IS NOT NULL;

ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE CASCADE;
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.refund_requests ALTER COLUMN payment_transaction_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON public.refund_requests(status);

CREATE TABLE IF NOT EXISTS public.financial_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  amount numeric(12,2),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Packages: expose the names and fields used by PackagesService.
ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS price numeric(12,2);
UPDATE public.packages SET price=monthly_price WHERE price IS NULL;
ALTER TABLE public.packages ALTER COLUMN price SET DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.package_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  usage_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id,service_id)
);

ALTER TABLE public.package_subscriptions ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.package_subscriptions ADD COLUMN IF NOT EXISTS amount numeric(12,2);
UPDATE public.package_subscriptions SET started_at=starts_at WHERE started_at IS NULL;
ALTER TABLE public.package_subscriptions ALTER COLUMN started_at SET DEFAULT now();

ALTER TABLE public.package_usage ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.package_usage ADD COLUMN IF NOT EXISTS package_service_id uuid REFERENCES public.package_services(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_package_usage_customer ON public.package_usage(customer_id);

-- Growth backend contract.
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS maximum_discount numeric(12,2);
UPDATE public.offers SET coupon_code=code WHERE coupon_code IS NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offers_coupon_code ON public.offers(coupon_code) WHERE coupon_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_customer ON public.referral_codes(customer_id);

ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS status text;
UPDATE public.referrals SET status=COALESCE(status,reward_status,'registered');
ALTER TABLE public.referrals ALTER COLUMN referral_code DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.loyalty_point_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  points integer NOT NULL,
  transaction_type text NOT NULL,
  reason text,
  reference_type text,
  reference_id uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_customer ON public.loyalty_point_transactions(customer_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.get_customer_loyalty_balance(p_customer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(points),0) FROM public.loyalty_point_transactions WHERE customer_id=p_customer_id;
$$;

-- Notifications backend uses device_tokens and notification_type/body rather
-- than the original push_devices and event_type/message names.
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS notification_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.notifications ALTER COLUMN event_type DROP NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN message DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_profile_created ON public.notifications(profile_id,created_at DESC);

-- Production audit backend contract.
ALTER TABLE public.admin_activity_logs ADD COLUMN IF NOT EXISTS actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.admin_activity_logs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Replace the status function with a compatibility-safe implementation. The
-- backend does not supply an actor parameter; auth.uid() is retained when a JWT
-- is present and service-role calls may therefore produce NULL changed_by.
CREATE OR REPLACE FUNCTION public.change_order_status(
  p_order_id uuid, p_new_status public.order_status, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.order_status;
BEGIN
  SELECT current_status INTO v_old FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_old IS DISTINCT FROM p_new_status AND NOT EXISTS (
    SELECT 1 FROM public.order_status_transitions
    WHERE from_status=v_old AND to_status=p_new_status
  ) THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> %', v_old, p_new_status;
  END IF;
  UPDATE public.orders SET current_status=p_new_status, updated_at=now(),
    delivered_at=CASE WHEN p_new_status='delivered' THEN now() ELSE delivered_at END,
    claim_deadline_at=CASE WHEN p_new_status='delivered' THEN now()+interval '7 days' ELSE claim_deadline_at END
  WHERE id=p_order_id;
  INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,reason)
  VALUES(p_order_id,v_old,p_new_status,auth.uid(),p_reason);
END $$;

-- Backend-required logistics RPCs.
CREATE OR REPLACE FUNCTION public.find_driver_assignment_candidates(
  p_order_id uuid, p_assignment_type public.assignment_type, p_limit integer DEFAULT 12
)
RETURNS TABLE(driver_id uuid,driver_latitude numeric,driver_longitude numeric,target_latitude numeric,target_longitude numeric,active_workload bigint,route_compatibility numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH target AS (
    SELECT CASE WHEN p_assignment_type='pickup' THEN ca_pick.location ELSE ca_drop.location END AS location
    FROM public.orders o
    JOIN public.customer_addresses ca_pick ON ca_pick.id=o.pickup_address_id
    JOIN public.customer_addresses ca_drop ON ca_drop.id=o.delivery_address_id
    WHERE o.id=p_order_id
  ), workloads AS (
    SELECT driver_id,count(*)::bigint active_workload FROM public.driver_assignments
    WHERE status::text IN ('assigned','accepted','en_route') GROUP BY driver_id
  )
  SELECT d.id, dll.latitude, dll.longitude,
    ST_Y(t.location::geometry)::numeric, ST_X(t.location::geometry)::numeric,
    COALESCE(w.active_workload,0),0::numeric
  FROM public.drivers d JOIN public.driver_live_locations dll ON dll.driver_id=d.id
  CROSS JOIN target t LEFT JOIN workloads w ON w.driver_id=d.id
  WHERE d.is_available=true AND dll.location IS NOT NULL AND t.location IS NOT NULL
  ORDER BY dll.location <-> t.location LIMIT GREATEST(1,LEAST(p_limit,50));
$$;

CREATE OR REPLACE FUNCTION public.find_nearby_driver_jobs(
  p_driver_id uuid,p_radius_meters numeric DEFAULT 3000
)
RETURNS TABLE(order_id uuid,assignment_id uuid,assignment_type public.assignment_type,distance_meters numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT da.order_id,da.id,da.assignment_type,ST_Distance(dll.location,ca.location)::numeric
  FROM public.driver_live_locations dll JOIN public.driver_assignments da ON da.driver_id=p_driver_id
  JOIN public.orders o ON o.id=da.order_id
  JOIN public.customer_addresses ca ON ca.id=CASE WHEN da.assignment_type='pickup' THEN o.pickup_address_id ELSE o.delivery_address_id END
  WHERE dll.driver_id=p_driver_id AND da.status::text IN ('assigned','accepted','en_route')
    AND dll.location IS NOT NULL AND ca.location IS NOT NULL
    AND ST_DWithin(dll.location,ca.location,p_radius_meters)
  ORDER BY ST_Distance(dll.location,ca.location);
$$;

GRANT EXECUTE ON FUNCTION public.upsert_driver_live_location(uuid,numeric,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_driver_assignment_candidates(uuid,public.assignment_type,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_nearby_driver_jobs(uuid,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_loyalty_balance(uuid) TO service_role;

-- Storage bucket used by DeliveryService. Keep private; signed upload URLs are
-- generated by the trusted backend.
INSERT INTO storage.buckets(id,name,public) VALUES ('delivery-proofs','delivery-proofs',false)
ON CONFLICT(id) DO NOTHING;

-- Service role owns backend writes; no broad anonymous Storage access is added.


-- ---------------------------------------------------------------------------
-- SOURCE: 02_20260907200000_create_delivery_proofs_bucket.sql
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'delivery-proofs',
  'delivery-proofs',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- SOURCE: 03_20260908025252_create_admin_analytics_views.sql
-- ---------------------------------------------------------------------------

-- ============================================
-- Bright & White
-- Admin Analytics Views
-- ============================================


-- ============================================
-- 1. Revenue Analytics
-- ============================================

CREATE OR REPLACE VIEW public.admin_revenue_analytics AS
SELECT
    DATE(o.created_at) AS order_date,

    COUNT(DISTINCT o.id) AS total_orders,

    COALESCE(
        SUM(
            CASE
                WHEN o.current_status NOT IN ('cancelled', 'draft')
                THEN o.total_amount
                ELSE 0
            END
        ),
        0
    ) AS gross_revenue,

    COALESCE(
        SUM(
            CASE
                WHEN o.current_status = 'completed'
                THEN o.total_amount
                ELSE 0
            END
        ),
        0
    ) AS completed_revenue,

    COUNT(
        CASE
            WHEN o.current_status = 'cancelled'
            THEN 1
        END
    ) AS cancelled_orders

FROM public.orders o

GROUP BY DATE(o.created_at);


-- ============================================
-- 2. Order Analytics
-- ============================================

CREATE OR REPLACE VIEW public.admin_order_analytics AS
SELECT
    o.current_status,

    COUNT(*) AS order_count,

    COALESCE(
        SUM(o.total_amount),
        0
    ) AS total_order_value,

    COALESCE(
        AVG(o.total_amount),
        0
    ) AS average_order_value,

    MIN(o.created_at) AS first_order_at,

    MAX(o.created_at) AS latest_order_at

FROM public.orders o

GROUP BY o.current_status;


-- ============================================
-- 3. Driver Performance
-- ============================================

CREATE OR REPLACE VIEW public.admin_driver_performance AS
SELECT
    d.id AS driver_id,

    p.full_name AS driver_name,

    d.is_active,

    d.is_available,

    d.max_concurrent_jobs,

    COUNT(da.id) AS total_assignments,

    COUNT(
        CASE
            WHEN da.status = 'completed'
            THEN 1
        END
    ) AS completed_assignments,

    COUNT(
        CASE
            WHEN da.status = 'rejected'
            THEN 1
        END
    ) AS rejected_assignments,

    MAX(da.completed_at) AS last_completed_at

FROM public.drivers d

LEFT JOIN public.profiles p
    ON p.id = d.profile_id

LEFT JOIN public.driver_assignments da
    ON da.driver_id = d.id

GROUP BY
    d.id,
    p.full_name,
    d.is_active,
    d.is_available,
    d.max_concurrent_jobs;


-- ============================================
-- 4. Facility Performance
-- ============================================

CREATE OR REPLACE VIEW public.admin_facility_performance AS
SELECT
    f.id AS facility_id,

    f.name AS facility_name,

    f.is_active,

    COUNT(DISTINCT o.id) AS total_orders,

    COUNT(
        CASE
            WHEN o.current_status = 'completed'
            THEN 1
        END
    ) AS completed_orders,

    COUNT(
        CASE
            WHEN o.current_status IN (
                'processing',
                'verification',
                'quality_check'
            )
            THEN 1
        END
    ) AS active_processing_orders,

    COUNT(
        CASE
            WHEN o.current_status = 'ready_for_delivery'
            THEN 1
        END
    ) AS ready_for_delivery_orders

FROM public.facilities f

LEFT JOIN public.orders o
    ON o.facility_id = f.id

GROUP BY
    f.id,
    f.name,
    f.is_active;


-- ============================================
-- 5. Machine Utilization
-- ============================================

CREATE OR REPLACE VIEW public.admin_machine_utilization AS
SELECT
    fm.id AS machine_id,

    fm.machine_name,

    fm.machine_type,

    fm.capacity_kg,

    fm.status AS machine_status,

    f.id AS facility_id,

    f.name AS facility_name,

    COUNT(foo.id) AS total_operations,

    COUNT(
        CASE
            WHEN foo.status = 'completed'
            THEN 1
        END
    ) AS completed_operations,

    MAX(foo.completed_at) AS last_completed_at,

    MAX(foo.started_at) AS last_started_at

FROM public.facility_machines fm

JOIN public.facilities f
    ON f.id = fm.facility_id

LEFT JOIN public.facility_order_operations foo
    ON foo.machine_id = fm.id

GROUP BY
    fm.id,
    fm.machine_name,
    fm.machine_type,
    fm.capacity_kg,
    fm.status,
    f.id,
    f.name;


-- ============================================
-- SECURITY
-- ============================================

REVOKE ALL ON public.admin_revenue_analytics FROM anon;
REVOKE ALL ON public.admin_order_analytics FROM anon;
REVOKE ALL ON public.admin_driver_performance FROM anon;
REVOKE ALL ON public.admin_facility_performance FROM anon;
REVOKE ALL ON public.admin_machine_utilization FROM anon;

REVOKE ALL ON public.admin_revenue_analytics FROM authenticated;
REVOKE ALL ON public.admin_order_analytics FROM authenticated;
REVOKE ALL ON public.admin_driver_performance FROM authenticated;
REVOKE ALL ON public.admin_facility_performance FROM authenticated;
REVOKE ALL ON public.admin_machine_utilization FROM authenticated;


-- ---------------------------------------------------------------------------
-- SOURCE: 04_20260908061134_harden_database_security.sql
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- SOURCE: 05_20260908065051_harden_profiles_and_customer_data_rls.sql
-- ---------------------------------------------------------------------------

-- ============================================
-- BRIGHT & WHITE
-- PHASE 4B - STEP 6D
-- PROFILES AND CUSTOMER DATA ISOLATION
-- ============================================


-- ============================================
-- Helper: Check whether the authenticated user
-- has a particular application role
-- ============================================


CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.has_role('admin')
        OR public.has_role('manager');
$$;

REVOKE ALL ON FUNCTION public.has_role(public.user_role_code)
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.is_admin_or_manager()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(public.user_role_code)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin_or_manager()
TO authenticated;

-- ============================================
-- SECTION 2
-- PROFILES SECURITY
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- Remove existing policies discovered in audit

DROP POLICY IF EXISTS "profiles_self_read"
ON public.profiles;

DROP POLICY IF EXISTS "profiles_self_update"
ON public.profiles;


-- Users can read only their own profile.
-- Admins and managers can read all profiles.

CREATE POLICY "profiles_select_isolated"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    id = auth.uid()
    OR public.is_admin_or_manager()
);


-- Users can update only their own profile.

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    id = auth.uid()
)
WITH CHECK (
    id = auth.uid()
);


-- Admins and managers can update profiles.

CREATE POLICY "profiles_update_admin"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    public.is_admin_or_manager()
)
WITH CHECK (
    public.is_admin_or_manager()
);


-- ============================================
-- SECTION 3
-- CUSTOMERS SECURITY
-- ============================================

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;


-- Remove existing policy discovered in audit

DROP POLICY IF EXISTS "customers_self_read"
ON public.customers;


-- Customers can read only their own customer record.

CREATE POLICY "customers_select_own"
ON public.customers
FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
);


-- Admins and managers can read all customers.

CREATE POLICY "customers_select_admin"
ON public.customers
FOR SELECT
TO authenticated
USING (
    public.is_admin_or_manager()
);


-- Customers can update only their own customer record.

CREATE POLICY "customers_update_own"
ON public.customers
FOR UPDATE
TO authenticated
USING (
    profile_id = auth.uid()
)
WITH CHECK (
    profile_id = auth.uid()
);


-- Admins and managers can update customer records.

CREATE POLICY "customers_update_admin"
ON public.customers
FOR UPDATE
TO authenticated
USING (
    public.is_admin_or_manager()
)
WITH CHECK (
    public.is_admin_or_manager()
);


-- ============================================
-- SECTION 4
-- CUSTOMER ADDRESS ISOLATION
-- ============================================

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;


-- Remove existing broad policy.

DROP POLICY IF EXISTS "addresses_customer_access"
ON public.customer_addresses;


-- Customers can read only their own addresses.

CREATE POLICY "customer_addresses_select_own"
ON public.customer_addresses
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Customers can create addresses only for themselves.

CREATE POLICY "customer_addresses_insert_own"
ON public.customer_addresses
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Customers can update only their own addresses.

CREATE POLICY "customer_addresses_update_own"
ON public.customer_addresses
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Customers can delete only their own addresses.

CREATE POLICY "customer_addresses_delete_own"
ON public.customer_addresses
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Admins and managers have full address access.

CREATE POLICY "customer_addresses_admin_access"
ON public.customer_addresses
FOR ALL
TO authenticated
USING (
    public.is_admin_or_manager()
)
WITH CHECK (
    public.is_admin_or_manager()
);


-- ============================================
-- SECTION 5
-- PROFILE ROLE SECURITY
-- ============================================

ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;


-- Users can see their own assigned roles.

CREATE POLICY "profile_roles_select_own"
ON public.profile_roles
FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
);


-- Only administrators can manage roles.

CREATE POLICY "profile_roles_admin_manage"
ON public.profile_roles
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================
-- SECTION 6
-- ROLES SECURITY
-- ============================================

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;


-- Authenticated users can read role definitions.

CREATE POLICY "roles_select_authenticated"
ON public.roles
FOR SELECT
TO authenticated
USING (true);


-- Only administrators can modify role definitions.

CREATE POLICY "roles_admin_manage"
ON public.roles
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================
-- SECTION 7
-- PERMISSIONS SECURITY
-- ============================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;


-- Authenticated users can read permissions.

CREATE POLICY "permissions_select_authenticated"
ON public.permissions
FOR SELECT
TO authenticated
USING (true);


-- Only administrators can manage permissions.

CREATE POLICY "permissions_admin_manage"
ON public.permissions
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================
-- SECTION 8
-- ROLE PERMISSION SECURITY
-- ============================================

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;


-- Authenticated users can read permission mappings.

CREATE POLICY "role_permissions_select_authenticated"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);


-- Only administrators can modify role permissions.

CREATE POLICY "role_permissions_admin_manage"
ON public.role_permissions
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);



-- ---------------------------------------------------------------------------
-- SOURCE: 06_20260908100000_harden_driver_and_delivery_rls.sql
-- ---------------------------------------------------------------------------

-- ============================================
-- Bright & White
-- Phase 4B Step 6E
-- Driver and Delivery RLS Hardening
-- ============================================


-- ============================================
-- Helper: Get Current Driver ID
-- ============================================

CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT d.id
    FROM public.drivers d
    WHERE d.profile_id = auth.uid()
    LIMIT 1;
$$;


-- ============================================
-- Function Security
-- ============================================

REVOKE ALL
ON FUNCTION public.current_driver_id()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_driver_id()
TO authenticated;


-- ============================================
-- 1. DRIVERS
-- ============================================

DROP POLICY IF EXISTS drivers_self_read
ON public.drivers;

DROP POLICY IF EXISTS drivers_admin_read
ON public.drivers;

DROP POLICY IF EXISTS drivers_admin_manage
ON public.drivers;


-- Driver can read only their own driver record

CREATE POLICY drivers_self_read
ON public.drivers
FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
);


-- Admin can read all drivers

CREATE POLICY drivers_admin_read
ON public.drivers
FOR SELECT
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
);


-- Admin can manage drivers

CREATE POLICY drivers_admin_manage
ON public.drivers
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 2. DRIVER ASSIGNMENTS
-- ============================================

DROP POLICY IF EXISTS driver_assignments_driver_read
ON public.driver_assignments;

DROP POLICY IF EXISTS driver_assignments_admin_access
ON public.driver_assignments;


-- Driver can read only assignments belonging to them

CREATE POLICY driver_assignments_driver_read
ON public.driver_assignments
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Admin full access

CREATE POLICY driver_assignments_admin_access
ON public.driver_assignments
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 3. DRIVER LIVE LOCATIONS
-- ============================================

DROP POLICY IF EXISTS driver_live_locations_driver_access
ON public.driver_live_locations;

DROP POLICY IF EXISTS driver_live_locations_admin_access
ON public.driver_live_locations;


-- Driver can manage only their own live location

CREATE POLICY driver_live_locations_driver_access
ON public.driver_live_locations
FOR ALL
TO authenticated
USING (
    driver_id = public.current_driver_id()
)
WITH CHECK (
    driver_id = public.current_driver_id()
);


-- Admin full access

CREATE POLICY driver_live_locations_admin_access
ON public.driver_live_locations
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 4. DRIVER LOCATION HISTORY
-- ============================================

DROP POLICY IF EXISTS driver_location_history_driver_read
ON public.driver_location_history;

DROP POLICY IF EXISTS driver_location_history_driver_insert
ON public.driver_location_history;

DROP POLICY IF EXISTS driver_location_history_admin_access
ON public.driver_location_history;


-- Driver can read only their own location history

CREATE POLICY driver_location_history_driver_read
ON public.driver_location_history
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Driver can insert only their own location history

CREATE POLICY driver_location_history_driver_insert
ON public.driver_location_history
FOR INSERT
TO authenticated
WITH CHECK (
    driver_id = public.current_driver_id()
);


-- Admin full access

CREATE POLICY driver_location_history_admin_access
ON public.driver_location_history
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 5. DRIVER NAVIGATION EVENTS
-- ============================================

DROP POLICY IF EXISTS driver_navigation_events_driver_read
ON public.driver_navigation_events;

DROP POLICY IF EXISTS driver_navigation_events_driver_insert
ON public.driver_navigation_events;

DROP POLICY IF EXISTS driver_navigation_events_admin_access
ON public.driver_navigation_events;


-- Driver can read only their own navigation events

CREATE POLICY driver_navigation_events_driver_read
ON public.driver_navigation_events
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Driver can create navigation events only for themselves
--
-- If an order_id is provided, the driver must have
-- an active assignment for that order.

CREATE POLICY driver_navigation_events_driver_insert
ON public.driver_navigation_events
FOR INSERT
TO authenticated
WITH CHECK (

    driver_id = public.current_driver_id()

    AND (

        order_id IS NULL

        OR EXISTS (
            SELECT 1
            FROM public.driver_assignments da
            WHERE da.order_id = driver_navigation_events.order_id
              AND da.driver_id = public.current_driver_id()
              AND da.status NOT IN (
                  'rejected'::public.assignment_status,
                  'cancelled'::public.assignment_status,
                  'expired'::public.assignment_status
              )
        )
    )
);


-- Admin full access

CREATE POLICY driver_navigation_events_admin_access
ON public.driver_navigation_events
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 6. DELIVERY PROOFS
-- ============================================

DROP POLICY IF EXISTS delivery_proofs_driver_read
ON public.delivery_proofs;

DROP POLICY IF EXISTS delivery_proofs_driver_insert
ON public.delivery_proofs;

DROP POLICY IF EXISTS delivery_proofs_admin_access
ON public.delivery_proofs;


-- Driver can read only delivery proofs created by them

CREATE POLICY delivery_proofs_driver_read
ON public.delivery_proofs
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Driver can create a delivery proof only when:
--
-- 1. The proof belongs to that driver.
-- 2. The order is assigned to that driver.
-- 3. The assignment is a delivery assignment.
-- 4. The assignment is active.

CREATE POLICY delivery_proofs_driver_insert
ON public.delivery_proofs
FOR INSERT
TO authenticated
WITH CHECK (

    driver_id = public.current_driver_id()

    AND EXISTS (
        SELECT 1
        FROM public.driver_assignments da
        WHERE da.order_id = delivery_proofs.order_id
          AND da.driver_id = public.current_driver_id()
          AND da.assignment_type =
              'delivery'::public.assignment_type
          AND da.status IN (
              'accepted'::public.assignment_status,
              'en_route'::public.assignment_status,
              'arrived'::public.assignment_status
          )
    )
);


-- Admin full access

CREATE POLICY delivery_proofs_admin_access
ON public.delivery_proofs
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ---------------------------------------------------------------------------
-- SOURCE: 07_20260908124003_secure_facility_operations.sql
-- ---------------------------------------------------------------------------

-- ============================================================
-- STEP 6F: FACILITY OPERATIONS SECURITY
-- ============================================================


-- ------------------------------------------------------------
-- 1. CHECK WHETHER CURRENT USER IS AN ACTIVE FACILITY EMPLOYEE
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_facility_employee(
    p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.facility_employees fe
        WHERE fe.facility_id = p_facility_id
          AND fe.profile_id = auth.uid()
          AND fe.is_active = true
    );
$$;


-- ------------------------------------------------------------
-- 2. CHECK ACCESS TO A FACILITY OPERATION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_facility_operation(
    p_operation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.facility_order_operations foo
            JOIN public.facility_employees fe
                ON fe.facility_id = foo.facility_id
            WHERE foo.id = p_operation_id
              AND fe.profile_id = auth.uid()
              AND fe.is_active = true
        );
$$;


-- ------------------------------------------------------------
-- 3. CHECK ACCESS TO A PROCESSING BATCH
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_processing_batch(
    p_batch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.facility_processing_batches fpb
            JOIN public.facility_employees fe
                ON fe.facility_id = fpb.facility_id
            WHERE fpb.id = p_batch_id
              AND fe.profile_id = auth.uid()
              AND fe.is_active = true
        );
$$;

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_machines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_order_operations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_processing_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.processing_batch_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.garment_inspections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.missing_item_reports ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- SOURCE: 08_20260908125111_step_6f_facility_integrity.sql
-- ---------------------------------------------------------------------------

-- ============================================================
-- STEP 6F-A: FACILITY INTEGRITY CONSTRAINTS & VALIDATION
-- ============================================================
--
-- Purpose:
-- Prevent cross-facility data relationships and logically
-- inconsistent operational data.
--
-- Protected relationships:
--
-- 1. Operation -> Machine
--    The machine must belong to the operation's facility.
--
-- 2. Operation -> Employee
--    The employee performing an operation must be an active
--    employee of the operation's facility.
--
-- 3. Processing Batch -> Machine
--    The machine must belong to the batch's facility.
--
-- 4. Processing Batch -> Operation
--    Operations added to a batch must belong to the same facility.
--
-- 5. Inspections -> Employees
--    Inspectors and verifiers must belong to the operation facility.
--
-- 6. Damage Reports -> Employees
--    Reporters must belong to the operation facility.
--
-- 7. Order Items -> Operations
--    Any referenced order item must belong to the same order as
--    the referenced facility operation.
--
-- ============================================================


-- ============================================================
-- HELPER FUNCTION:
-- GET FACILITY FOR A PROFILE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_active_employee_facility(
    p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_facility_id uuid;
BEGIN

    SELECT facility_id
    INTO v_facility_id
    FROM public.facility_employees
    WHERE profile_id = p_profile_id
      AND is_active = true;

    RETURN v_facility_id;

END;
$$;


-- ============================================================
-- HELPER FUNCTION:
-- VALIDATE ACTIVE FACILITY EMPLOYEE
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_active_facility_employee(
    p_profile_id uuid,
    p_facility_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    RETURN EXISTS (
        SELECT 1
        FROM public.facility_employees fe
        WHERE fe.profile_id = p_profile_id
          AND fe.facility_id = p_facility_id
          AND fe.is_active = true
    );

END;
$$;


-- ============================================================
-- 1. VALIDATE FACILITY ORDER OPERATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_facility_order_operation_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_machine_facility_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Rule 1:
    -- A machine assigned to an operation must belong to
    -- the same facility.
    -- --------------------------------------------------------

    IF NEW.machine_id IS NOT NULL THEN

        IF NEW.facility_id IS NULL THEN
            RAISE EXCEPTION
                'Cannot assign a machine to an operation without a facility';
        END IF;

        SELECT facility_id
        INTO v_machine_facility_id
        FROM public.facility_machines
        WHERE id = NEW.machine_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Machine % does not exist',
                NEW.machine_id;
        END IF;

        IF v_machine_facility_id IS DISTINCT FROM NEW.facility_id THEN
            RAISE EXCEPTION
                'Cross-facility machine assignment is not allowed. Machine belongs to facility %, operation belongs to facility %',
                v_machine_facility_id,
                NEW.facility_id;
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Rule 2:
    -- Employee performing the operation must be active and
    -- belong to the same facility.
    -- --------------------------------------------------------

    IF NEW.performed_by IS NOT NULL THEN

        IF NEW.facility_id IS NULL THEN
            RAISE EXCEPTION
                'Cannot assign performed_by without a facility';
        END IF;

        IF NOT public.validate_active_facility_employee(
            NEW.performed_by,
            NEW.facility_id
        ) THEN

            RAISE EXCEPTION
                'Profile % is not an active employee of facility %',
                NEW.performed_by,
                NEW.facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_facility_order_operation_integrity
ON public.facility_order_operations;


CREATE TRIGGER
trg_validate_facility_order_operation_integrity
BEFORE INSERT OR UPDATE
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION
public.validate_facility_order_operation_integrity();


-- ============================================================
-- 2. VALIDATE PROCESSING BATCH
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_processing_batch_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_machine_facility_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- A machine assigned to a processing batch must belong
    -- to the same facility as the batch.
    -- --------------------------------------------------------

    IF NEW.machine_id IS NOT NULL THEN

        SELECT facility_id
        INTO v_machine_facility_id
        FROM public.facility_machines
        WHERE id = NEW.machine_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Machine % does not exist',
                NEW.machine_id;
        END IF;

        IF v_machine_facility_id IS DISTINCT FROM NEW.facility_id THEN
            RAISE EXCEPTION
                'Cross-facility machine assignment is not allowed. Machine belongs to facility %, batch belongs to facility %',
                v_machine_facility_id,
                NEW.facility_id;
        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_processing_batch_integrity
ON public.facility_processing_batches;


CREATE TRIGGER
trg_validate_processing_batch_integrity
BEFORE INSERT OR UPDATE
ON public.facility_processing_batches
FOR EACH ROW
EXECUTE FUNCTION
public.validate_processing_batch_integrity();


-- ============================================================
-- 3. VALIDATE PROCESSING BATCH -> OPERATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_processing_batch_order_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_batch_facility_id uuid;
    v_operation_facility_id uuid;
BEGIN

    -- Get batch facility.

    SELECT facility_id
    INTO v_batch_facility_id
    FROM public.facility_processing_batches
    WHERE id = NEW.batch_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Processing batch % does not exist',
            NEW.batch_id;
    END IF;


    -- Get operation facility.

    SELECT facility_id
    INTO v_operation_facility_id
    FROM public.facility_order_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Facility operation % does not exist',
            NEW.operation_id;
    END IF;


    -- An operation in a processing batch must have a facility.

    IF v_operation_facility_id IS NULL THEN
        RAISE EXCEPTION
            'Operation % does not have a facility assigned',
            NEW.operation_id;
    END IF;


    -- Both must belong to the same facility.

    IF v_batch_facility_id IS DISTINCT FROM v_operation_facility_id THEN

        RAISE EXCEPTION
            'Cross-facility batch relationship is not allowed. Batch facility % does not match operation facility %',
            v_batch_facility_id,
            v_operation_facility_id;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_processing_batch_order_integrity
ON public.processing_batch_orders;


CREATE TRIGGER
trg_validate_processing_batch_order_integrity
BEFORE INSERT OR UPDATE
ON public.processing_batch_orders
FOR EACH ROW
EXECUTE FUNCTION
public.validate_processing_batch_order_integrity();


-- ============================================================
-- 4. VALIDATE GARMENT INSPECTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_garment_inspection_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_operation_facility_id uuid;
    v_operation_order_id uuid;
    v_order_item_order_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Get operation information when operation_id is provided.
    -- --------------------------------------------------------

    IF NEW.operation_id IS NOT NULL THEN

        SELECT
            facility_id,
            order_id
        INTO
            v_operation_facility_id,
            v_operation_order_id
        FROM public.facility_order_operations
        WHERE id = NEW.operation_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Operation % does not exist',
                NEW.operation_id;
        END IF;

    END IF;

    -- Validate explicit order_id against operation order.
    IF NEW.order_id IS NOT NULL
    AND NEW.operation_id IS NOT NULL THEN

        IF NEW.order_id IS DISTINCT FROM v_operation_order_id THEN
            RAISE EXCEPTION
                'Inspection order % does not match operation order %',
                NEW.order_id,
                v_operation_order_id;
        END IF;

    END IF;

    -- --------------------------------------------------------
    -- Rule:
    -- order_item must belong to the same order as operation.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL
       AND NEW.operation_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF v_order_item_order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % belongs to order %, but the operation belongs to order %',
                NEW.order_item_id,
                v_order_item_order_id,
                v_operation_order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Inspector must belong to the operation facility.
    -- --------------------------------------------------------

    IF NEW.inspected_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.inspected_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Inspector % is not an active employee of the operation facility %',
                NEW.inspected_by,
                v_operation_facility_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Verifier must belong to the operation facility.
    -- --------------------------------------------------------

    IF NEW.verified_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.verified_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Verifier % is not an active employee of the operation facility %',
                NEW.verified_by,
                v_operation_facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_garment_inspection_integrity
ON public.garment_inspections;


CREATE TRIGGER
trg_validate_garment_inspection_integrity
BEFORE INSERT OR UPDATE
ON public.garment_inspections
FOR EACH ROW
EXECUTE FUNCTION
public.validate_garment_inspection_integrity();


-- ============================================================
-- 5. VALIDATE DAMAGE REPORT
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_damage_report_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_operation_facility_id uuid;
    v_operation_order_id uuid;
    v_order_item_order_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Get operation details.
    -- --------------------------------------------------------

    SELECT
        facility_id,
        order_id
    INTO
        v_operation_facility_id,
        v_operation_order_id
    FROM public.facility_order_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Operation % does not exist',
            NEW.operation_id;
    END IF;


    -- --------------------------------------------------------
    -- Validate order item belongs to operation order.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF v_order_item_order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % belongs to a different order than operation %',
                NEW.order_item_id,
                NEW.operation_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Reporter must be an active employee of the operation
    -- facility.
    -- --------------------------------------------------------

    IF NEW.detected_by IS NOT NULL THEN

        IF v_operation_facility_id IS NULL THEN

            RAISE EXCEPTION
                'Operation % does not have a facility assigned',
                NEW.operation_id;

        END IF;

        IF NOT public.validate_active_facility_employee(
            NEW.detected_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Reporter % is not an active employee of facility %',
                NEW.detected_by,
                v_operation_facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_damage_report_integrity
ON public.damage_reports;


CREATE TRIGGER
trg_validate_damage_report_integrity
BEFORE INSERT OR UPDATE
ON public.damage_reports
FOR EACH ROW
EXECUTE FUNCTION
public.validate_damage_report_integrity();


-- ============================================================
-- 6. VALIDATE MISSING ITEM REPORT
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_missing_item_report_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_operation_order_id uuid;
    v_order_item_order_id uuid;
BEGIN

    -- Get operation order.

    SELECT order_id
    INTO v_operation_order_id
    FROM public.facility_order_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Operation % does not exist',
            NEW.operation_id;
    END IF;


    -- Validate the order item.

    IF NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF v_order_item_order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % does not belong to the same order as operation %',
                NEW.order_item_id,
                NEW.operation_id;

        END IF;

    END IF;
    -- --------------------------------------------------------
    -- Validate inspection order against order item.
    -- --------------------------------------------------------

    IF NEW.order_id IS NOT NULL
    AND NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF NEW.order_id IS DISTINCT FROM v_order_item_order_id THEN
            RAISE EXCEPTION
                'Inspection order % does not match order item order %',
                NEW.order_id,
                v_order_item_order_id;
        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_missing_item_report_integrity
ON public.missing_item_reports;


CREATE TRIGGER
trg_validate_missing_item_report_integrity
BEFORE INSERT OR UPDATE
ON public.missing_item_reports
FOR EACH ROW
EXECUTE FUNCTION
public.validate_missing_item_report_integrity();


-- ============================================================
-- END OF STEP 6F-A
-- ============================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 09_20260908172541_step_6f_b_profile_employee_status_integrity.sql
-- ---------------------------------------------------------------------------

-- ============================================================
-- STEP 6F-B: PROFILE, EMPLOYEE & STATUS INTEGRITY
-- ============================================================
--
-- Purpose:
--
-- 1. Automatically create public.profiles records for new
--    auth.users.
--
-- 2. Validate garment_inspections.order_id against the
--    referenced facility operation.
--
-- 3. Allow employee history across multiple facilities while
--    ensuring only one active facility assignment per employee.
--
-- 4. Normalize unrestricted text status fields.
--
-- 5. Make facility_order_operations.current_status the
--    authoritative operational status and remove the duplicate
--    generic status column.
--
-- ============================================================


-- ============================================================
-- STEP 1: AUTOMATIC PROFILE CREATION
-- ============================================================
--
-- Every auth.users record must have a corresponding
-- public.profiles record.
--
-- Profile data can be supplied through auth user metadata:
--
-- raw_user_meta_data:
--
-- {
--   "full_name": "Customer Name",
--   "phone": "+919999999999"
-- }
--
-- The trigger runs with SECURITY DEFINER because inserts into
-- auth.users may not have direct access to public.profiles.
--
-- ============================================================


CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    INSERT INTO public.profiles (
        id,
        full_name,
        phone
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            NEW.raw_user_meta_data ->> 'name'
        ),
        COALESCE(
            NEW.phone,
            NEW.raw_user_meta_data ->> 'phone'
        )
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;

END;

$$;


DROP TRIGGER IF EXISTS
trg_handle_new_user
ON auth.users;


CREATE TRIGGER
trg_handle_new_user
AFTER INSERT
ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- STEP 2: ENSURE EXISTING AUTH USERS HAVE PROFILES
-- ============================================================
--
-- Backfill profiles for users that already exist in auth.users
-- but do not yet have a public.profiles record.
--
-- ============================================================


INSERT INTO public.profiles (
    id,
    full_name,
    phone
)
SELECT
    au.id,
    COALESCE(
        au.raw_user_meta_data ->> 'full_name',
        au.raw_user_meta_data ->> 'name'
    ),
    COALESCE(
        au.phone,
        au.raw_user_meta_data ->> 'phone'
    )
FROM auth.users au
LEFT JOIN public.profiles p
    ON p.id = au.id
WHERE p.id IS NULL;


-- ============================================================
-- STEP 3: EMPLOYEE FACILITY ASSIGNMENT STRATEGY
-- ============================================================
--
-- Business Rule:
--
-- A profile may have historical assignments to multiple
-- facilities.
--
-- However, only ONE facility assignment may be active at any
-- given time.
--
-- Example:
--
-- Employee
--     |
--     +-- Hyderabad Facility
--     |      is_active = false
--     |
--     +-- Gachibowli Facility
--            is_active = true
--
-- This allows employee transfers while preserving history.
--
-- ============================================================


CREATE UNIQUE INDEX IF NOT EXISTS
facility_employees_one_active_facility_per_profile_idx
ON public.facility_employees (profile_id)
WHERE is_active = true;


-- ============================================================
-- STEP 4: IMPROVE ACTIVE EMPLOYEE FACILITY LOOKUP
-- ============================================================
--
-- Since the partial unique index guarantees only one active
-- facility assignment per profile, this function is now safe
-- as a single-facility lookup.
--
-- ============================================================


CREATE OR REPLACE FUNCTION public.get_active_employee_facility(
    p_profile_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT facility_id
    FROM public.facility_employees
    WHERE profile_id = p_profile_id
      AND is_active = true
    LIMIT 1;
$$;


-- ============================================================
-- STEP 5: VALIDATE FACILITY EMPLOYEE TRANSITIONS
-- ============================================================
--
-- Prevents a profile from being assigned to multiple active
-- facilities.
--
-- The unique partial index is the final database-level
-- enforcement.
--
-- This trigger provides a clearer business error.
--
-- ============================================================


CREATE OR REPLACE FUNCTION
public.validate_employee_facility_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_existing_facility_id uuid;
BEGIN

    IF NEW.is_active = true THEN

        SELECT facility_id
        INTO v_existing_facility_id
        FROM public.facility_employees
        WHERE profile_id = NEW.profile_id
          AND is_active = true
          AND id IS DISTINCT FROM NEW.id
        LIMIT 1;

        IF FOUND THEN

            RAISE EXCEPTION
                'Profile % already has an active facility assignment at facility %. Deactivate the existing assignment before activating another facility.',
                NEW.profile_id,
                v_existing_facility_id;

        END IF;

    END IF;

    RETURN NEW;

END;

$$;


DROP TRIGGER IF EXISTS
trg_validate_employee_facility_assignment
ON public.facility_employees;


CREATE TRIGGER
trg_validate_employee_facility_assignment
BEFORE INSERT OR UPDATE
ON public.facility_employees
FOR EACH ROW
EXECUTE FUNCTION
public.validate_employee_facility_assignment();


-- ============================================================
-- STEP 6F-B: UPDATE ADMIN MACHINE UTILIZATION VIEW
-- ============================================================
--
-- Update the dependent view BEFORE removing the old status column.
--
-- ============================================================

CREATE OR REPLACE VIEW public.admin_machine_utilization AS
SELECT
    fm.id AS machine_id,
    fm.machine_name,
    fm.machine_type,
    fm.capacity_kg,
    fm.status AS machine_status,

    f.id AS facility_id,
    f.name AS facility_name,

    COUNT(foo.id) AS total_operations,

    COUNT(
        CASE
            WHEN foo.completed_at IS NOT NULL THEN 1
        END
    ) AS completed_operations,

    MAX(foo.completed_at) AS last_completed_at,
    MAX(foo.started_at) AS last_started_at

FROM public.facility_machines fm

JOIN public.facilities f
    ON f.id = fm.facility_id

LEFT JOIN public.facility_order_operations foo
    ON foo.machine_id = fm.id

GROUP BY
    fm.id,
    fm.machine_name,
    fm.machine_type,
    fm.capacity_kg,
    fm.status,
    f.id,
    f.name;


-- ============================================================
-- REMOVE LEGACY DUPLICATE STATUS COLUMN
-- ============================================================

ALTER TABLE public.facility_order_operations
DROP COLUMN IF EXISTS status;

-- ============================================================
-- STEP 7: NORMALIZE PROCESSING BATCH STATUS
-- ============================================================
--
-- Current status values:
--
-- pending
-- processing
-- completed
-- cancelled
--
-- A dedicated enum prevents invalid free-text values.
--
-- ============================================================


DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'processing_batch_status'
          AND typnamespace = 'public'::regnamespace
    ) THEN

        CREATE TYPE public.processing_batch_status AS ENUM (
            'pending',
            'processing',
            'completed',
            'cancelled'
        );

    END IF;

END;
$$;


-- ------------------------------------------------------------
-- Normalize existing processing batch values.
-- ------------------------------------------------------------


UPDATE public.facility_processing_batches
SET status = LOWER(TRIM(status));


-- ------------------------------------------------------------
-- Convert the status column to the enum.
-- ------------------------------------------------------------


ALTER TABLE public.facility_processing_batches
ALTER COLUMN status DROP DEFAULT;


ALTER TABLE public.facility_processing_batches
ALTER COLUMN status
TYPE public.processing_batch_status
USING (
    CASE
        WHEN status IN (
            'pending',
            'processing',
            'completed',
            'cancelled'
        )
        THEN status::public.processing_batch_status

        ELSE 'pending'::public.processing_batch_status
    END
);


ALTER TABLE public.facility_processing_batches
ALTER COLUMN status
SET DEFAULT 'pending'::public.processing_batch_status;


-- ============================================================
-- STEP 8: NORMALIZE DAMAGE REPORT STATUS
-- ============================================================
--
-- Valid values:
--
-- open
-- under_review
-- approved
-- resolved
-- rejected
--
-- ============================================================


DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'damage_report_status'
          AND typnamespace = 'public'::regnamespace
    ) THEN

        CREATE TYPE public.damage_report_status AS ENUM (
            'open',
            'under_review',
            'approved',
            'resolved',
            'rejected'
        );

    END IF;

END;
$$;


UPDATE public.damage_reports
SET status = LOWER(TRIM(status));


ALTER TABLE public.damage_reports
ALTER COLUMN status DROP DEFAULT;


ALTER TABLE public.damage_reports
ALTER COLUMN status
TYPE public.damage_report_status
USING (
    CASE
        WHEN status IN (
            'open',
            'under_review',
            'approved',
            'resolved',
            'rejected'
        )
        THEN status::public.damage_report_status

        ELSE 'open'::public.damage_report_status
    END
);


ALTER TABLE public.damage_reports
ALTER COLUMN status
SET DEFAULT 'open'::public.damage_report_status;


-- ============================================================
-- STEP 9: NORMALIZE MISSING ITEM REPORT STATUS
-- ============================================================
--
-- Valid values:
--
-- open
-- investigating
-- found
-- resolved
-- closed
--
-- ============================================================


DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'missing_item_report_status'
          AND typnamespace = 'public'::regnamespace
    ) THEN

        CREATE TYPE public.missing_item_report_status AS ENUM (
            'open',
            'investigating',
            'found',
            'resolved',
            'closed'
        );

    END IF;

END;
$$;


UPDATE public.missing_item_reports
SET status = LOWER(TRIM(status));


ALTER TABLE public.missing_item_reports
ALTER COLUMN status DROP DEFAULT;


ALTER TABLE public.missing_item_reports
ALTER COLUMN status
TYPE public.missing_item_report_status
USING (
    CASE
        WHEN status IN (
            'open',
            'investigating',
            'found',
            'resolved',
            'closed'
        )
        THEN status::public.missing_item_report_status

        ELSE 'open'::public.missing_item_report_status
    END
);


ALTER TABLE public.missing_item_reports
ALTER COLUMN status
SET DEFAULT 'open'::public.missing_item_report_status;


-- ============================================================
-- STEP 10: EXTEND GARMENT INSPECTION INTEGRITY
-- ============================================================
--
-- Rules:
--
-- 1. operation_id must exist when provided.
--
-- 2. order_item_id must belong to the same order as operation.
--
-- 3. order_id must match the operation order.
--
-- 4. When both order_id and order_item_id are provided,
--    they must belong to the same order.
--
-- 5. Inspector and verifier must be active employees of
--    the operation facility.
--
-- ============================================================


CREATE OR REPLACE FUNCTION
public.validate_garment_inspection_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE

    v_operation_facility_id uuid;
    v_operation_order_id uuid;
    v_order_item_order_id uuid;

BEGIN

    -- --------------------------------------------------------
    -- Retrieve operation information.
    -- --------------------------------------------------------

    IF NEW.operation_id IS NOT NULL THEN

        SELECT
            facility_id,
            order_id
        INTO
            v_operation_facility_id,
            v_operation_order_id
        FROM public.facility_order_operations
        WHERE id = NEW.operation_id;

        IF NOT FOUND THEN

            RAISE EXCEPTION
                'Operation % does not exist',
                NEW.operation_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Validate inspection order against operation order.
    -- --------------------------------------------------------

    IF NEW.order_id IS NOT NULL
       AND NEW.operation_id IS NOT NULL THEN

        IF NEW.order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Inspection order % does not match operation order %',
                NEW.order_id,
                v_operation_order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Retrieve order item information.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN

            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Validate order item against operation order.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL
       AND NEW.operation_id IS NOT NULL THEN

        IF v_order_item_order_id IS DISTINCT
           FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % belongs to order %, but operation belongs to order %',
                NEW.order_item_id,
                v_order_item_order_id,
                v_operation_order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Validate order item against inspection order.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL
       AND NEW.order_id IS NOT NULL THEN

        IF v_order_item_order_id IS DISTINCT FROM NEW.order_id THEN

            RAISE EXCEPTION
                'Order item % does not belong to inspection order %',
                NEW.order_item_id,
                NEW.order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Inspector must belong to operation facility.
    -- --------------------------------------------------------

    IF NEW.inspected_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.inspected_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Inspector % is not an active employee of facility %',
                NEW.inspected_by,
                v_operation_facility_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Verifier must belong to operation facility.
    -- --------------------------------------------------------

    IF NEW.verified_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.verified_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Verifier % is not an active employee of facility %',
                NEW.verified_by,
                v_operation_facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;

$$;


DROP TRIGGER IF EXISTS
trg_validate_garment_inspection_integrity
ON public.garment_inspections;


CREATE TRIGGER
trg_validate_garment_inspection_integrity
BEFORE INSERT OR UPDATE
ON public.garment_inspections
FOR EACH ROW
EXECUTE FUNCTION
public.validate_garment_inspection_integrity();


-- ============================================================
-- STEP 11: STATUS DOCUMENTATION
-- ============================================================


COMMENT ON COLUMN
public.facility_order_operations.current_status
IS
'Authoritative operational workflow status. Replaces the deprecated generic status column.';


COMMENT ON TYPE
public.processing_batch_status
IS
'Lifecycle status of a facility processing batch.';


COMMENT ON TYPE
public.damage_report_status
IS
'Resolution lifecycle status for a garment damage report.';


COMMENT ON TYPE
public.missing_item_report_status
IS
'Investigation and resolution lifecycle status for a missing item report.';


-- ============================================================
-- END OF STEP 6F-B
-- ============================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 10_20260908230000_step_6f_c1_operational_relationship_integrity.sql
-- ---------------------------------------------------------------------------

-- ============================================================
-- Bright & White
-- Step 6F-C1
-- Operational Relationship Integrity
--
-- Goals:
--   1. Order addresses must belong to the order customer.
--   2. Facility operations must match the order facility.
--   3. Order facility cannot be changed incompatibly once
--      facility operations exist.
--   4. Only one active driver assignment per order/type.
--   5. Delivery proof driver must match a delivery assignment.
--   6. Route batch stops must match the route batch driver/type.
--
-- This migration intentionally does NOT normalize additional
-- status fields or implement workflow transitions.
-- Those belong to Step 6F-C2.
-- ============================================================


-- ============================================================
-- 1. ORDER ADDRESS OWNERSHIP
-- ============================================================
--
-- Foreign keys currently guarantee that pickup_address_id and
-- delivery_address_id reference valid customer_addresses.
--
-- They do NOT by themselves guarantee that those addresses
-- actually belong to orders.customer_id.
--
-- This trigger closes that integrity gap.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_address_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_address_customer_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Pickup address
    -- --------------------------------------------------------
    IF NEW.pickup_address_id IS NOT NULL THEN

        SELECT ca.customer_id
        INTO v_address_customer_id
        FROM public.customer_addresses ca
        WHERE ca.id = NEW.pickup_address_id;

        IF v_address_customer_id IS NULL THEN
            RAISE EXCEPTION
                'Pickup address % does not exist',
                NEW.pickup_address_id
                USING ERRCODE = '23514';
        END IF;

        IF v_address_customer_id <> NEW.customer_id THEN
            RAISE EXCEPTION
                'Pickup address % belongs to customer %, not order customer %',
                NEW.pickup_address_id,
                v_address_customer_id,
                NEW.customer_id
                USING ERRCODE = '23514';
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Delivery address
    -- --------------------------------------------------------
    IF NEW.delivery_address_id IS NOT NULL THEN

        SELECT ca.customer_id
        INTO v_address_customer_id
        FROM public.customer_addresses ca
        WHERE ca.id = NEW.delivery_address_id;

        IF v_address_customer_id IS NULL THEN
            RAISE EXCEPTION
                'Delivery address % does not exist',
                NEW.delivery_address_id
                USING ERRCODE = '23514';
        END IF;

        IF v_address_customer_id <> NEW.customer_id THEN
            RAISE EXCEPTION
                'Delivery address % belongs to customer %, not order customer %',
                NEW.delivery_address_id,
                v_address_customer_id,
                NEW.customer_id
                USING ERRCODE = '23514';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_address_ownership
ON public.orders;


CREATE TRIGGER trg_validate_order_address_ownership
BEFORE INSERT OR UPDATE OF
    customer_id,
    pickup_address_id,
    delivery_address_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_address_ownership();


-- ============================================================
-- 2. FACILITY OPERATION ↔ ORDER FACILITY
-- ============================================================
--
-- facility_order_operations.facility_id is currently nullable.
--
-- That is useful for backward compatibility because the existing
-- backend historically created facility operations without
-- explicitly sending facility_id.
--
-- Therefore:
--
--   * If order.facility_id exists and operation.facility_id is
--     NULL, automatically copy the order facility.
--
--   * If operation.facility_id is supplied, it must equal
--     order.facility_id.
--
--   * An operational facility record cannot exist for an order
--     that has no assigned facility.
--
-- This preserves compatibility while making facility identity
-- authoritative.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_operation_order_facility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_facility_id uuid;
BEGIN

    SELECT o.facility_id
    INTO v_order_facility_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Order % does not exist',
            NEW.order_id
            USING ERRCODE = '23503';
    END IF;


    -- An order must have a facility before facility processing starts.
    IF v_order_facility_id IS NULL THEN
        RAISE EXCEPTION
            'Order % has no assigned facility; facility operation cannot be created',
            NEW.order_id
            USING ERRCODE = '23514';
    END IF;


    -- Backend compatibility:
    -- automatically derive facility_id when it is omitted.
    IF NEW.facility_id IS NULL THEN
        NEW.facility_id := v_order_facility_id;
    END IF;


    -- Explicitly supplied facility must match the order.
    IF NEW.facility_id <> v_order_facility_id THEN
        RAISE EXCEPTION
            'Facility operation facility % does not match order % facility %',
            NEW.facility_id,
            NEW.order_id,
            v_order_facility_id
            USING ERRCODE = '23514';
    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_enforce_operation_order_facility
ON public.facility_order_operations;


CREATE TRIGGER trg_enforce_operation_order_facility
BEFORE INSERT OR UPDATE OF
    order_id,
    facility_id
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_operation_order_facility();


-- ============================================================
-- 3. PROTECT ORDER FACILITY REASSIGNMENT
-- ============================================================
--
-- Once facility operations exist, changing orders.facility_id
-- could silently make the operational history inconsistent.
--
-- We therefore reject a facility change whenever existing
-- facility operations would no longer match.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_facility_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id THEN
        RETURN NEW;
    END IF;


    IF EXISTS (
        SELECT 1
        FROM public.facility_order_operations foo
        WHERE foo.order_id = NEW.id
          AND (
                NEW.facility_id IS NULL
                OR foo.facility_id IS DISTINCT FROM NEW.facility_id
              )
    ) THEN

        RAISE EXCEPTION
            'Order % facility cannot be changed from % to % because facility operations already exist',
            NEW.id,
            OLD.facility_id,
            NEW.facility_id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_facility_reassignment
ON public.orders;


CREATE TRIGGER trg_validate_order_facility_reassignment
BEFORE UPDATE OF facility_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_facility_reassignment();


-- ============================================================
-- 4. DRIVER ASSIGNMENT INTEGRITY
-- ============================================================
--
-- Application code already attempts to prevent duplicate active
-- assignments, but this must also be protected by PostgreSQL.
--
-- One order may legitimately have:
--
--   pickup assignment
--   delivery assignment
--
-- But it must not have two simultaneously active pickup
-- assignments or two simultaneously active delivery assignments.
--
-- Historical completed/rejected/cancelled/expired assignments are
-- still allowed.
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT
            da.order_id,
            da.assignment_type
        FROM public.driver_assignments da
        WHERE da.status IN (
            'assigned'::public.assignment_status,
            'accepted'::public.assignment_status,
            'en_route'::public.assignment_status,
            'arrived'::public.assignment_status
        )
        GROUP BY
            da.order_id,
            da.assignment_type
        HAVING COUNT(*) > 1
    ) THEN

        RAISE EXCEPTION
            'Cannot create active driver assignment uniqueness index: duplicate active assignments already exist';

    END IF;

END;
$$;


CREATE UNIQUE INDEX IF NOT EXISTS
driver_assignments_one_active_per_order_type_idx
ON public.driver_assignments (
    order_id,
    assignment_type
)
WHERE status IN (
    'assigned'::public.assignment_status,
    'accepted'::public.assignment_status,
    'en_route'::public.assignment_status,
    'arrived'::public.assignment_status
);


-- ============================================================
-- 5. DELIVERY PROOF ↔ DRIVER ASSIGNMENT
-- ============================================================
--
-- delivery_proofs currently has:
--
--   order_id
--   driver_id
--
-- Both are individually valid foreign keys.
--
-- That does not guarantee that the driver actually has the
-- delivery assignment for that order.
--
-- This trigger closes that gap.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_delivery_proof_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM public.driver_assignments da
        WHERE da.order_id = NEW.order_id
          AND da.driver_id = NEW.driver_id
          AND da.assignment_type = 'delivery'::public.assignment_type
          AND da.status IN (
                'accepted'::public.assignment_status,
                'en_route'::public.assignment_status,
                'arrived'::public.assignment_status,
                'completed'::public.assignment_status
          )
    ) THEN

        RAISE EXCEPTION
            'Driver % does not have a valid delivery assignment for order %',
            NEW.driver_id,
            NEW.order_id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_delivery_proof_assignment
ON public.delivery_proofs;


CREATE TRIGGER trg_validate_delivery_proof_assignment
BEFORE INSERT OR UPDATE OF
    order_id,
    driver_id
ON public.delivery_proofs
FOR EACH ROW
EXECUTE FUNCTION public.validate_delivery_proof_assignment();


-- ============================================================
-- 6. ROUTE BATCH STOP ↔ DRIVER ASSIGNMENT
-- ============================================================
--
-- route_batch_stops currently links:
--
--   route_batch_id
--   assignment_id
--
-- The foreign keys ensure those objects exist, but they do not
-- guarantee:
--
--   route_batches.driver_id = driver_assignments.driver_id
--
-- or:
--
--   route_batches.batch_type = driver_assignments.assignment_type
--
-- This trigger enforces both.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_route_batch_stop_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_route_driver_id uuid;
    v_route_type public.assignment_type;

    v_assignment_driver_id uuid;
    v_assignment_type public.assignment_type;
BEGIN

    SELECT
        rb.driver_id,
        rb.batch_type
    INTO
        v_route_driver_id,
        v_route_type
    FROM public.route_batches rb
    WHERE rb.id = NEW.route_batch_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Route batch % does not exist',
            NEW.route_batch_id
            USING ERRCODE = '23503';
    END IF;


    SELECT
        da.driver_id,
        da.assignment_type
    INTO
        v_assignment_driver_id,
        v_assignment_type
    FROM public.driver_assignments da
    WHERE da.id = NEW.assignment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Driver assignment % does not exist',
            NEW.assignment_id
            USING ERRCODE = '23503';
    END IF;


    IF v_route_driver_id <> v_assignment_driver_id THEN

        RAISE EXCEPTION
            'Route batch driver % does not match assignment driver %',
            v_route_driver_id,
            v_assignment_driver_id
            USING ERRCODE = '23514';

    END IF;


    IF v_route_type <> v_assignment_type THEN

        RAISE EXCEPTION
            'Route batch type % does not match assignment type %',
            v_route_type,
            v_assignment_type
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_route_batch_stop_relationship
ON public.route_batch_stops;


CREATE TRIGGER trg_validate_route_batch_stop_relationship
BEFORE INSERT OR UPDATE OF
    route_batch_id,
    assignment_id
ON public.route_batch_stops
FOR EACH ROW
EXECUTE FUNCTION public.validate_route_batch_stop_relationship();


-- ============================================================
-- 7. ONE DRIVER ASSIGNMENT MAY APPEAR IN ONLY ONE ROUTE BATCH
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT assignment_id
        FROM public.route_batch_stops
        GROUP BY assignment_id
        HAVING COUNT(*) > 1
    ) THEN

        RAISE EXCEPTION
            'Cannot enforce route assignment uniqueness: an assignment appears in multiple route batches';

    END IF;

END;
$$;


CREATE UNIQUE INDEX IF NOT EXISTS
route_batch_stops_assignment_unique_idx
ON public.route_batch_stops (assignment_id);


-- ============================================================
-- 8. SECURITY HARDENING FOR TRIGGER FUNCTIONS
-- ============================================================

REVOKE ALL
ON FUNCTION public.validate_order_address_ownership()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.enforce_operation_order_facility()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.validate_order_facility_reassignment()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.validate_delivery_proof_assignment()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.validate_route_batch_stop_relationship()
FROM PUBLIC;


REVOKE ALL
ON FUNCTION public.validate_order_address_ownership()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.enforce_operation_order_facility()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_order_facility_reassignment()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_delivery_proof_assignment()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_route_batch_stop_relationship()
FROM anon, authenticated;


-- ============================================================
-- END STEP 6F-C1
-- ============================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 11_20260909003000_step_6f_c2_status_lifecycle_integrity.sql
-- ---------------------------------------------------------------------------

-- ============================================================
-- Bright & White
-- Step 6F-C2
-- Status & Lifecycle Integrity
--
-- Architecture:
--
--   order_status_transitions
--            |
--            v
--   change_order_status()
--            |
--            v
--   orders.current_status
--            |
--            v
--   order_status_history
--
-- order_status_transitions is the SINGLE SOURCE OF TRUTH
-- for allowed order lifecycle transitions.
--
-- This migration:
--   1. Completes the order transition matrix.
--   2. Adds defense-in-depth validation on orders.
--   3. Hardens change_order_status().
--   4. Adds driver-assignment lifecycle validation.
--   5. Adds timestamp consistency validation.
--   6. Does NOT redesign facility current_status.
-- ============================================================


-- ============================================================
-- 1. COMPLETE ORDER STATUS TRANSITION MATRIX
-- ============================================================
--
-- Existing valid rows are preserved.
-- ON CONFLICT makes this migration idempotent with respect to
-- transition seed data.
--
-- Important:
-- on_hold is intentionally NOT added as a generic transition.
-- A generic "anything -> on_hold -> anything" path would bypass
-- lifecycle integrity. Hold/resume will be implemented later as
-- a controlled workflow with a recorded resume state.
-- ============================================================

INSERT INTO public.order_status_transitions
    (from_status, to_status)
VALUES

    -- --------------------------------------------------------
    -- DRAFT / PAYMENT
    -- --------------------------------------------------------

    ('draft', 'pending_payment'),
    ('draft', 'confirmed'),
    ('draft', 'cancelled'),

    ('pending_payment', 'confirmed'),
    ('pending_payment', 'cancelled'),

    -- --------------------------------------------------------
    -- PICKUP
    -- --------------------------------------------------------

    ('confirmed', 'pickup_assigned'),
    ('confirmed', 'cancelled'),

    ('pickup_assigned', 'pickup_accepted'),
    ('pickup_assigned', 'pickup_failed'),
    ('pickup_assigned', 'cancelled'),

    ('pickup_accepted', 'en_route_pickup'),
    ('pickup_accepted', 'pickup_failed'),
    ('pickup_accepted', 'cancelled'),

    ('en_route_pickup', 'pickup_otp_pending'),
    ('en_route_pickup', 'pickup_failed'),
    ('en_route_pickup', 'cancelled'),

    ('pickup_otp_pending', 'picked_up'),
    ('pickup_otp_pending', 'pickup_failed'),
    ('pickup_otp_pending', 'cancelled'),

    -- Retry after failed pickup.
    ('pickup_failed', 'pickup_assigned'),
    ('pickup_failed', 'cancelled'),

    -- --------------------------------------------------------
    -- TRANSIT TO FACILITY
    -- --------------------------------------------------------

    ('picked_up', 'in_transit_to_facility'),

    ('in_transit_to_facility', 'received_at_facility'),

    -- --------------------------------------------------------
    -- FACILITY
    -- --------------------------------------------------------

    ('received_at_facility', 'verification'),

    ('verification', 'processing'),

    ('processing', 'quality_check'),
    ('processing', 'rework_required'),

    ('quality_check', 'ready_for_delivery'),
    ('quality_check', 'rework_required'),

    ('rework_required', 'processing'),
    ('rework_required', 'quality_check'),

    -- --------------------------------------------------------
    -- DELIVERY
    -- --------------------------------------------------------

    ('ready_for_delivery', 'delivery_assigned'),

    ('delivery_assigned', 'delivery_accepted'),
    ('delivery_assigned', 'delivery_failed'),

    ('delivery_accepted', 'en_route_delivery'),
    ('delivery_accepted', 'delivery_failed'),

    ('en_route_delivery', 'delivery_otp_pending'),
    ('en_route_delivery', 'delivery_failed'),

    ('delivery_otp_pending', 'delivered'),
    ('delivery_otp_pending', 'delivery_failed'),

    -- Retry after failed delivery.
    ('delivery_failed', 'delivery_assigned'),

    -- --------------------------------------------------------
    -- POST DELIVERY
    -- --------------------------------------------------------

    ('delivered', 'claim_period_active'),
    ('delivered', 'completed'),

    ('claim_period_active', 'completed')

ON CONFLICT (from_status, to_status)
DO NOTHING;


-- ============================================================
-- 2. ORDER STATUS DEFENSE-IN-DEPTH TRIGGER
-- ============================================================
--
-- INSERT:
--   Every newly-created order must begin in DRAFT.
--
-- UPDATE:
--   Every status change must exist in the central
--   order_status_transitions table.
--
-- This prevents both:
--   * invalid lifecycle jumps
--   * creating an order directly in a later lifecycle state
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    -- --------------------------------------------------------
    -- INSERT integrity
    -- --------------------------------------------------------

    IF TG_OP = 'INSERT' THEN

        IF NEW.current_status <>
            'draft'::public.order_status THEN

            RAISE EXCEPTION
                'New order % must begin in draft status, not %',
                NEW.id,
                NEW.current_status
                USING ERRCODE = '23514';

        END IF;

        RETURN NEW;

    END IF;


    -- --------------------------------------------------------
    -- UPDATE integrity
    -- --------------------------------------------------------

    IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
        RETURN NEW;
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.order_status_transitions ost
        WHERE ost.from_status = OLD.current_status
          AND ost.to_status = NEW.current_status
    ) THEN

        RAISE EXCEPTION
            'Invalid order status transition for order %: % -> %',
            OLD.id,
            OLD.current_status,
            NEW.current_status
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_status_transition
ON public.orders;


CREATE TRIGGER trg_validate_order_status_transition
BEFORE INSERT OR UPDATE OF current_status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_status_transition();


-- ============================================================
-- 3. HARDEN change_order_status()
-- ============================================================
--
-- Preserve the existing behavior:
--
--   * lock order row
--   * validate transition
--   * update current_status
--   * set delivered_at
--   * set 7-day claim deadline
--   * write order_status_history
--
-- Improvements:
--
--   * safe search_path includes pg_temp
--   * schema-qualified objects
--   * clearer error code
--   * no duplicate history entry for same-state calls
-- ============================================================

CREATE OR REPLACE FUNCTION public.change_order_status(
    p_order_id uuid,
    p_new_status public.order_status,
    p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old public.order_status;
BEGIN

    SELECT o.current_status
    INTO v_old
    FROM public.orders o
    WHERE o.id = p_order_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Order % not found',
            p_order_id
            USING ERRCODE = 'P0002';
    END IF;


    -- Same-state request is a no-op.
    IF v_old IS NOT DISTINCT FROM p_new_status THEN
        RETURN;
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.order_status_transitions ost
        WHERE ost.from_status = v_old
          AND ost.to_status = p_new_status
    ) THEN

        RAISE EXCEPTION
            'Invalid order status transition: % -> %',
            v_old,
            p_new_status
            USING ERRCODE = '23514';

    END IF;


    UPDATE public.orders
    SET
        current_status = p_new_status,

        updated_at = now(),

        delivered_at =
            CASE
                WHEN p_new_status =
                    'delivered'::public.order_status
                THEN COALESCE(delivered_at, now())
                ELSE delivered_at
            END,

        claim_deadline_at =
            CASE
                WHEN p_new_status =
                    'delivered'::public.order_status
                THEN COALESCE(
                    claim_deadline_at,
                    now() + interval '7 days'
                )
                ELSE claim_deadline_at
            END

    WHERE id = p_order_id;


    INSERT INTO public.order_status_history (
        order_id,
        from_status,
        to_status,
        changed_by,
        reason
    )
    VALUES (
        p_order_id,
        v_old,
        p_new_status,
        auth.uid(),
        p_reason
    );

END;
$$;


-- ============================================================
-- 4. DRIVER ASSIGNMENT STATUS TRANSITION RULE
-- ============================================================
--
-- assignment_status values:
--
--   assigned
--   accepted
--   rejected
--   en_route
--   arrived
--   completed
--   cancelled
--   expired
--   reassignment_required
--
-- reassignment_required is treated as the terminal state for
-- the OLD assignment. A new driver assignment should be created
-- for the replacement driver rather than reviving the old row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_valid_assignment_status_transition(
    p_old_status public.assignment_status,
    p_new_status public.assignment_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        p_old_status = p_new_status

        OR CASE p_old_status

            WHEN 'assigned'::public.assignment_status THEN
                p_new_status IN (
                    'accepted'::public.assignment_status,
                    'rejected'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'expired'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'accepted'::public.assignment_status THEN
                p_new_status IN (
                    'en_route'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'en_route'::public.assignment_status THEN
                p_new_status IN (
                    'arrived'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'arrived'::public.assignment_status THEN
                p_new_status IN (
                    'completed'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'completed'::public.assignment_status THEN
                false

            WHEN 'rejected'::public.assignment_status THEN
                false

            WHEN 'cancelled'::public.assignment_status THEN
                false

            WHEN 'expired'::public.assignment_status THEN
                false

            WHEN 'reassignment_required'::public.assignment_status THEN
                false

            ELSE
                false

        END;
$$;


-- ============================================================
-- DRIVER ASSIGNMENT STATUS INTEGRITY
-- ============================================================
--
-- INSERT:
--   New assignments must begin as ASSIGNED.
--
-- UPDATE:
--   Status changes must follow the assignment lifecycle.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    -- --------------------------------------------------------
    -- INSERT integrity
    -- --------------------------------------------------------

    IF TG_OP = 'INSERT' THEN

        IF NEW.status <>
            'assigned'::public.assignment_status THEN

            RAISE EXCEPTION
                'New driver assignment % must begin in assigned status, not %',
                NEW.id,
                NEW.status
                USING ERRCODE = '23514';

        END IF;

        RETURN NEW;

    END IF;


    -- --------------------------------------------------------
    -- UPDATE integrity
    -- --------------------------------------------------------

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;


    IF NOT public.is_valid_assignment_status_transition(
        OLD.status,
        NEW.status
    ) THEN

        RAISE EXCEPTION
            'Invalid driver assignment status transition for assignment %: % -> %',
            OLD.id,
            OLD.status,
            NEW.status
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_assignment_status_transition
ON public.driver_assignments;


CREATE TRIGGER trg_validate_assignment_status_transition
BEFORE INSERT OR UPDATE OF status
ON public.driver_assignments
FOR EACH ROW
EXECUTE FUNCTION public.validate_assignment_status_transition();


-- ============================================================
-- 5. ORDER TIMESTAMP CONSISTENCY
-- ============================================================
--
-- Actual current orders timestamp model:
--
--   delivered_at
--   claim_deadline_at
--
-- We intentionally do NOT reference nonexistent pickup or
-- delivery-start timestamp columns.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_lifecycle_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.claim_deadline_at IS NOT NULL
       AND NEW.delivered_at IS NULL THEN

        RAISE EXCEPTION
            'Order % cannot have claim_deadline_at without delivered_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.claim_deadline_at IS NOT NULL
       AND NEW.delivered_at IS NOT NULL
       AND NEW.claim_deadline_at < NEW.delivered_at THEN

        RAISE EXCEPTION
            'Order % claim_deadline_at cannot be earlier than delivered_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_lifecycle_timestamps
ON public.orders;


CREATE TRIGGER trg_validate_order_lifecycle_timestamps
BEFORE INSERT OR UPDATE OF
    delivered_at,
    claim_deadline_at
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_lifecycle_timestamps();


-- ============================================================
-- 6. DRIVER ASSIGNMENT TIMESTAMP CONSISTENCY
-- ============================================================
--
-- Actual current columns:
--
--   assigned_at
--   accepted_at
--   completed_at
--
-- There is currently NO started_at column.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_lifecycle_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.accepted_at IS NOT NULL
       AND NEW.assigned_at IS NOT NULL
       AND NEW.accepted_at < NEW.assigned_at THEN

        RAISE EXCEPTION
            'Assignment % accepted_at cannot be earlier than assigned_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.completed_at IS NOT NULL
       AND NEW.assigned_at IS NOT NULL
       AND NEW.completed_at < NEW.assigned_at THEN

        RAISE EXCEPTION
            'Assignment % completed_at cannot be earlier than assigned_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.completed_at IS NOT NULL
       AND NEW.accepted_at IS NOT NULL
       AND NEW.completed_at < NEW.accepted_at THEN

        RAISE EXCEPTION
            'Assignment % completed_at cannot be earlier than accepted_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_assignment_lifecycle_timestamps
ON public.driver_assignments;


CREATE TRIGGER trg_validate_assignment_lifecycle_timestamps
BEFORE INSERT OR UPDATE OF
    assigned_at,
    accepted_at,
    completed_at
ON public.driver_assignments
FOR EACH ROW
EXECUTE FUNCTION public.validate_assignment_lifecycle_timestamps();


-- ============================================================
-- 7. FACILITY OPERATION TIMESTAMP CONSISTENCY
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_facility_operation_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.started_at IS NOT NULL
       AND NEW.completed_at IS NOT NULL
       AND NEW.completed_at < NEW.started_at THEN

        RAISE EXCEPTION
            'Facility operation % completed_at cannot be earlier than started_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.received_at IS NOT NULL
       AND NEW.ready_for_delivery_at IS NOT NULL
       AND NEW.ready_for_delivery_at < NEW.received_at THEN

        RAISE EXCEPTION
            'Facility operation % ready_for_delivery_at cannot be earlier than received_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_facility_operation_timestamps
ON public.facility_order_operations;


CREATE TRIGGER trg_validate_facility_operation_timestamps
BEFORE INSERT OR UPDATE OF
    received_at,
    ready_for_delivery_at,
    started_at,
    completed_at
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION public.validate_facility_operation_timestamps();


-- ============================================================
-- 8. PROCESSING BATCH TIMESTAMP CONSISTENCY
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_processing_batch_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.started_at IS NOT NULL
       AND NEW.completed_at IS NOT NULL
       AND NEW.completed_at < NEW.started_at THEN

        RAISE EXCEPTION
            'Processing batch % completed_at cannot be earlier than started_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_processing_batch_timestamps
ON public.facility_processing_batches;


CREATE TRIGGER trg_validate_processing_batch_timestamps
BEFORE INSERT OR UPDATE OF
    started_at,
    completed_at
ON public.facility_processing_batches
FOR EACH ROW
EXECUTE FUNCTION public.validate_processing_batch_timestamps();


-- ============================================================
-- 9. SECURITY HARDENING
-- ============================================================

REVOKE ALL
ON FUNCTION public.validate_order_status_transition()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_assignment_status_transition()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_order_lifecycle_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_assignment_lifecycle_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_facility_operation_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_processing_batch_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.is_valid_assignment_status_transition(
    public.assignment_status,
    public.assignment_status
)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 10. HARDEN change_order_status() EXECUTE PRIVILEGES
-- ============================================================
--
-- change_order_status() is SECURITY DEFINER and therefore must
-- not be directly executable by anonymous or ordinary
-- authenticated Supabase clients.
--
-- Order lifecycle mutations must pass through the trusted
-- Bright & White backend/service-role path.
-- ============================================================

REVOKE ALL
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
FROM anon;

REVOKE ALL
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
TO service_role;


-- ============================================================
-- END STEP 6F-C2
-- ============================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 12_20260909024942_step_6f_c3_legacy_schema_cleanup.sql
-- ---------------------------------------------------------------------------

-- ============================================================
-- Bright & White
-- Step 6F-C3
-- Legacy Schema Cleanup + Targeted Security Hardening
-- ============================================================
--
-- Canonical models:
--   loyalty_point_transactions
--   device_tokens
--   package_services
--
-- Legacy models removed:
--   loyalty_transactions
--   push_devices
--   package_service_limits
--
-- IMPORTANT:
--   No CASCADE is intentionally used.
--   Unexpected dependencies must cause this migration to fail.
-- ============================================================


-- ============================================================
-- 1. REMOVE LEGACY LOYALTY MODEL
-- ============================================================

DROP TRIGGER IF EXISTS trg_loyalty_balance
ON public.loyalty_transactions;

DROP FUNCTION IF EXISTS public.apply_loyalty_transaction();

DROP TABLE IF EXISTS public.loyalty_transactions;


-- ============================================================
-- 2. REMOVE LEGACY PUSH DEVICE MODEL
-- ============================================================

DROP POLICY IF EXISTS devices_owner_manage
ON public.push_devices;

DROP TABLE IF EXISTS public.push_devices;


-- ============================================================
-- 3. REMOVE LEGACY PACKAGE/SERVICE LIMIT MODEL
-- ============================================================

DROP TABLE IF EXISTS public.package_service_limits;


-- ============================================================
-- 4. HARDEN AUTH PROFILE CREATION FUNCTION
-- ============================================================
--
-- Keep the function and auth.users trigger.
-- Only harden its search_path.
-- ============================================================

ALTER FUNCTION public.handle_new_user()
SET search_path = public, pg_temp;


-- ============================================================
-- 5. DOCUMENT CANONICAL MODELS
-- ============================================================

COMMENT ON TABLE public.loyalty_point_transactions IS
'Canonical Bright & White loyalty-points ledger. Supersedes legacy loyalty_transactions.';

COMMENT ON TABLE public.device_tokens IS
'Canonical Bright & White push-notification device token registry. Supersedes legacy push_devices.';

COMMENT ON TABLE public.package_services IS
'Canonical package-to-service relationship including per-service usage limits. Supersedes legacy package_service_limits.';


-- ============================================================
-- END STEP 6F-C3
-- ============================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 13_20260909040126_step_6f_c4_performance_and_final_hardening.sql
-- ---------------------------------------------------------------------------

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

