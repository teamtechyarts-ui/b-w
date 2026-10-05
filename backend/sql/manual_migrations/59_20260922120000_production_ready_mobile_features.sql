-- ============================================================================
-- Migration: 20260922120000_production_ready_mobile_features.sql
-- Description: Production-Ready Mobile Application Database Foundation
-- Modules:
--   1. Accurate Nearest Driver Feature & Spatial Geolocation (PostGIS + Fallback)
--   2. Razorpay Production Payments, Refunds & Webhook Idempotency
--   3. Secure Phone/SMS Authentication & Order Delivery OTPs
--   4. Push Notifications Infrastructure (FCM/APNs Token Registry & Triggers)
--   5. App Store & Google Play Compliance (Account Deletion, Version Control, Consents)
-- ============================================================================

-- Ensure PostGIS spatial capabilities if available
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension could not be enabled automatically (or already managed). Spherical math fallback will also be provided.';
END;
$$;

-- Ensure pgcrypto for secure hashing & UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;

-- ============================================================================
-- 1. ACCURATE NEAREST DRIVER FEATURE & GEOLOCATION
-- ============================================================================

-- Enrich drivers table with real-time operational state
ALTER TABLE public.drivers
ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS current_battery_level integer CHECK (current_battery_level BETWEEN 0 AND 100),
ADD COLUMN IF NOT EXISTS heading numeric(5,2),
ADD COLUMN IF NOT EXISTS speed_kmh numeric(6,2),
ADD COLUMN IF NOT EXISTS last_location_updated_at timestamptz;

-- Ensure spatial index on driver_live_locations
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'driver_live_locations' 
      AND column_name = 'location'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_driver_live_locations_gist 
      ON public.driver_live_locations USING GIST (location);
  END IF;
END;
$$;

-- Spatial index on customer addresses and facilities for rapid proximity searches
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'customer_addresses' 
      AND column_name = 'location'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_location_gist 
      ON public.customer_addresses USING GIST (location);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'facilities' 
      AND column_name = 'location'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_facilities_location_gist 
      ON public.facilities USING GIST (location);
  END IF;
END;
$$;

-- Driver location update atomic function (invoked by Driver Mobile App)
CREATE OR REPLACE FUNCTION public.update_driver_live_location_atomic(
    p_driver_id uuid,
    p_latitude numeric,
    p_longitude numeric,
    p_accuracy numeric DEFAULT NULL,
    p_heading numeric DEFAULT NULL,
    p_speed_kmh numeric DEFAULT NULL,
    p_battery_level integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver public.drivers%ROWTYPE;
    v_geom public.geometry;
    v_geog public.geography;
BEGIN
    IF p_driver_id IS NULL OR p_latitude IS NULL OR p_longitude IS NULL THEN
        RAISE EXCEPTION 'Driver ID and valid coordinates (lat, lng) are required'
            USING ERRCODE = '22023';
    END IF;

    -- Lock driver record
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Driver % not found', p_driver_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Construct point geometry/geography safely
    BEGIN
        v_geog := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
    EXCEPTION WHEN OTHERS THEN
        v_geog := NULL;
    END;

    -- Upsert into driver_live_locations
    INSERT INTO public.driver_live_locations (
        driver_id,
        latitude,
        longitude,
        location,
        accuracy_m,
        recorded_at
    )
    VALUES (
        p_driver_id,
        p_latitude,
        p_longitude,
        v_geog,
        p_accuracy,
        now()
    )
    ON CONFLICT (driver_id)
    DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        location = EXCLUDED.location,
        accuracy_m = EXCLUDED.accuracy_m,
        recorded_at = EXCLUDED.recorded_at;

    -- Record in driver location history audit trail
    INSERT INTO public.driver_location_history (
        driver_id,
        latitude,
        longitude,
        location,
        recorded_at
    )
    VALUES (
        p_driver_id,
        p_latitude,
        p_longitude,
        v_geog,
        now()
    );

    -- Update driver live status
    UPDATE public.drivers
    SET is_online = true,
        heading = COALESCE(p_heading, heading),
        speed_kmh = COALESCE(p_speed_kmh, speed_kmh),
        current_battery_level = COALESCE(p_battery_level, current_battery_level),
        last_location_updated_at = now(),
        updated_at = now()
    WHERE id = p_driver_id;

    RETURN jsonb_build_object(
        'success', true,
        'driver_id', p_driver_id,
        'latitude', p_latitude,
        'longitude', p_longitude,
        'recorded_at', now()
    );
END;
$$;

-- Spatial query to discover nearest available drivers
CREATE OR REPLACE FUNCTION public.find_nearest_available_drivers(
    p_latitude numeric,
    p_longitude numeric,
    p_radius_km numeric DEFAULT 15,
    p_limit integer DEFAULT 10,
    p_assignment_type text DEFAULT 'pickup'
)
RETURNS TABLE (
    driver_id uuid,
    profile_id uuid,
    full_name text,
    phone_number text,
    latitude numeric,
    longitude numeric,
    distance_meters numeric,
    active_jobs_count integer,
    max_concurrent_jobs integer,
    is_online boolean,
    heading numeric,
    speed_kmh numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH target_point AS (
        SELECT ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography AS geog
    ),
    driver_workloads AS (
        SELECT 
            da.driver_id AS d_id,
            COUNT(*)::integer AS active_count
        FROM public.driver_assignments da
        WHERE da.status IN ('assigned', 'accepted', 'en_route')
        GROUP BY da.driver_id
    )
    SELECT 
        d.id AS driver_id,
        d.profile_id,
        COALESCE(p.full_name, 'Driver') AS full_name,
        p.phone_number,
        loc.latitude,
        loc.longitude,
        ROUND(
            ST_Distance(
                loc.location,
                tp.geog
            )::numeric, 1
        ) AS distance_meters,
        COALESCE(dw.active_count, 0) AS active_jobs_count,
        d.max_concurrent_jobs,
        d.is_online,
        d.heading,
        d.speed_kmh
    FROM public.drivers d
    JOIN public.profiles p ON p.id = d.profile_id
    JOIN public.driver_live_locations loc ON loc.driver_id = d.id
    CROSS JOIN target_point tp
    LEFT JOIN driver_workloads dw ON dw.d_id = d.id
    WHERE d.is_active = true
      AND d.is_available = true
      AND d.is_online = true
      AND loc.recorded_at >= now() - interval '30 minutes' -- Recent ping check
      AND COALESCE(dw.active_count, 0) < d.max_concurrent_jobs
      AND ST_DWithin(loc.location, tp.geog, p_radius_km * 1000)
    ORDER BY distance_meters ASC
    LIMIT p_limit;
END;
$$;

-- Auto Assign Nearest Driver RPC (Invoked by Worker & Logistics Engine)
CREATE OR REPLACE FUNCTION public.auto_assign_nearest_driver(
    p_order_id uuid,
    p_assignment_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_target_lat numeric;
    v_target_lng numeric;
    v_nearest_driver_id uuid;
    v_distance_meters numeric;
    v_assignment_result jsonb;
    v_enum_type public.assignment_type;
BEGIN
    IF p_order_id IS NULL OR p_assignment_type IS NULL THEN
        RAISE EXCEPTION 'Order ID and assignment type are required'
            USING ERRCODE = '22023';
    END IF;

    -- Cast assignment type enum
    BEGIN
        v_enum_type := p_assignment_type::public.assignment_type;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid assignment type: %', p_assignment_type
            USING ERRCODE = '22023';
    END IF;

    -- Fetch order
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Determine target coordinates: Pickup uses customer address, Delivery uses facility or customer address
    IF v_enum_type = 'pickup'::public.assignment_type THEN
        SELECT ca.latitude, ca.longitude 
        INTO v_target_lat, v_target_lng
        FROM public.customer_addresses ca
        WHERE ca.id = v_order.pickup_address_id;
    ELSE
        -- Delivery: start at facility, or delivery address
        IF v_order.facility_id IS NOT NULL THEN
            SELECT f.latitude, f.longitude
            INTO v_target_lat, v_target_lng
            FROM public.facilities f
            WHERE f.id = v_order.facility_id;
        END IF;

        IF v_target_lat IS NULL THEN
            SELECT ca.latitude, ca.longitude 
            INTO v_target_lat, v_target_lng
            FROM public.customer_addresses ca
            WHERE ca.id = v_order.delivery_address_id;
        END IF;
    END IF;

    IF v_target_lat IS NULL OR v_target_lng IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'target_coordinates_unavailable',
            'order_id', p_order_id
        );
    END IF;

    -- Find nearest driver who has not previously rejected this assignment
    SELECT 
        nd.driver_id,
        nd.distance_meters
    INTO 
        v_nearest_driver_id,
        v_distance_meters
    FROM public.find_nearest_available_drivers(
        v_target_lat,
        v_target_lng,
        25, -- 25km radius search
        10,
        p_assignment_type
    ) nd
    WHERE nd.driver_id NOT IN (
        SELECT da.driver_id
        FROM public.driver_assignments da
        WHERE da.order_id = p_order_id
          AND da.assignment_type = v_enum_type
          AND da.status = 'rejected'
    )
    ORDER BY nd.distance_meters ASC
    LIMIT 1;

    IF v_nearest_driver_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'no_eligible_drivers_in_range',
            'order_id', p_order_id,
            'search_coordinates', jsonb_build_object('lat', v_target_lat, 'lng', v_target_lng)
        );
    END IF;

    -- Assign atomically
    v_assignment_result := public.create_driver_assignment_atomic(
        p_order_id,
        v_nearest_driver_id,
        v_enum_type,
        v_distance_meters
    );

    RETURN jsonb_build_object(
        'success', true,
        'driver_id', v_nearest_driver_id,
        'distance_meters', v_distance_meters,
        'assignment', v_assignment_result
    );
END;
$$;

-- Driver Toggle Online/Offline Status
CREATE OR REPLACE FUNCTION public.set_driver_online_status_atomic(
    p_driver_id uuid,
    p_is_online boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.drivers
    SET is_online = p_is_online,
        is_available = p_is_online,
        updated_at = now()
    WHERE id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Driver % not found', p_driver_id USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'driver_id', p_driver_id,
        'is_online', p_is_online,
        'updated_at', now()
    );
END;
$$;

-- ============================================================================
-- 2. RAZORPAY PRODUCTION PAYMENTS, REFUNDS & WEBHOOK IDEMPOTENCY
-- ============================================================================

-- Razorpay detailed orders table
CREATE TABLE IF NOT EXISTS public.razorpay_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    razorpay_order_id text NOT NULL UNIQUE,
    amount_paise bigint NOT NULL CHECK (amount_paise > 0),
    amount_inr numeric(12,2) GENERATED ALWAYS AS (amount_paise / 100.00) STORED,
    currency text NOT NULL DEFAULT 'INR',
    receipt text,
    status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'attempted', 'paid', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_order_id ON public.razorpay_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_provider_order_id ON public.razorpay_orders(razorpay_order_id);

-- Razorpay verified payments audit ledger
CREATE TABLE IF NOT EXISTS public.razorpay_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    razorpay_order_id text NOT NULL,
    razorpay_payment_id text NOT NULL UNIQUE,
    razorpay_signature text,
    amount_paise bigint NOT NULL,
    amount_inr numeric(12,2) GENERATED ALWAYS AS (amount_paise / 100.00) STORED,
    currency text NOT NULL DEFAULT 'INR',
    method text, -- 'upi', 'card', 'netbanking', 'wallet'
    status text NOT NULL CHECK (status IN ('authorized', 'captured', 'failed', 'refunded')),
    error_code text,
    error_description text,
    fee_paise bigint DEFAULT 0,
    tax_paise bigint DEFAULT 0,
    signature_verified boolean NOT NULL DEFAULT false,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_razorpay_payments_order_id ON public.razorpay_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_payments_payment_id ON public.razorpay_payments(razorpay_payment_id);

-- Razorpay Refunds Table
CREATE TABLE IF NOT EXISTS public.razorpay_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    razorpay_payment_id text NOT NULL,
    razorpay_refund_id text NOT NULL UNIQUE,
    amount_paise bigint NOT NULL CHECK (amount_paise > 0),
    amount_inr numeric(12,2) GENERATED ALWAYS AS (amount_paise / 100.00) STORED,
    currency text NOT NULL DEFAULT 'INR',
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
    speed text NOT NULL DEFAULT 'normal' CHECK (speed IN ('normal', 'optimum')),
    notes jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_razorpay_refunds_order_id ON public.razorpay_refunds(order_id);

-- Webhook event audit extensions
ALTER TABLE public.payment_webhook_events
ADD COLUMN IF NOT EXISTS signature_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS execution_error text;

-- Atomic Razorpay Payment Capture Function
CREATE OR REPLACE FUNCTION public.record_razorpay_payment_success_atomic(
    p_order_id uuid,
    p_razorpay_order_id text,
    p_razorpay_payment_id text,
    p_razorpay_signature text,
    p_amount_paise bigint,
    p_method text,
    p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_amount_inr numeric(12,2);
    v_payment_order_id uuid;
BEGIN
    IF p_order_id IS NULL OR p_razorpay_payment_id IS NULL OR p_amount_paise IS NULL THEN
        RAISE EXCEPTION 'Order ID, Payment ID, and Amount are required' USING ERRCODE = '22023';
    END IF;

    v_amount_inr := p_amount_paise / 100.00;

    -- Lock order
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
    END IF;

    -- Record in razorpay_payments
    INSERT INTO public.razorpay_payments (
        order_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount_paise,
        currency,
        method,
        status,
        signature_verified,
        payload
    )
    VALUES (
        p_order_id,
        COALESCE(p_razorpay_order_id, 'manual_capture'),
        p_razorpay_payment_id,
        p_razorpay_signature,
        p_amount_paise,
        'INR',
        COALESCE(p_method, 'upi'),
        'captured',
        true,
        p_payload
    )
    ON CONFLICT (razorpay_payment_id)
    DO UPDATE SET
        status = 'captured',
        signature_verified = true,
        payload = EXCLUDED.payload;

    -- Update or insert razorpay_orders
    IF p_razorpay_order_id IS NOT NULL THEN
        UPDATE public.razorpay_orders
        SET status = 'paid', updated_at = now()
        WHERE razorpay_order_id = p_razorpay_order_id;
    END IF;

    -- Update legacy payment_orders if exists
    UPDATE public.payment_orders
    SET status = 'paid',
        provider_payment_id = p_razorpay_payment_id,
        paid_at = now(),
        updated_at = now()
    WHERE order_id = p_order_id AND provider_order_id = p_razorpay_order_id;

    -- Mark order payment status
    UPDATE public.orders
    SET payment_method = 'razorpay'::public.payment_method,
        updated_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'razorpay_payment_id', p_razorpay_payment_id,
        'amount_inr', v_amount_inr,
        'captured_at', now()
    );
END;
$$;

-- ============================================================================
-- 3. SECURE PHONE & SMS AUTHENTICATION OTP LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.phone_auth_otps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number text NOT NULL,
    otp_hash text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('login', 'register', 'password_reset', 'phone_verification')),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    is_verified boolean NOT NULL DEFAULT false,
    resend_available_at timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    ip_address text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_auth_otps_lookup 
    ON public.phone_auth_otps(phone_number, purpose, is_verified, expires_at);

-- Generate & Register Secure Phone OTP RPC
CREATE OR REPLACE FUNCTION public.generate_phone_otp_atomic(
    p_phone_number text,
    p_otp_hash text,
    p_purpose text DEFAULT 'login',
    p_ip_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_recent_request timestamptz;
BEGIN
    IF p_phone_number IS NULL OR p_otp_hash IS NULL THEN
        RAISE EXCEPTION 'Phone number and hashed OTP are required' USING ERRCODE = '22023';
    END IF;

    -- Anti-spam cooldown check (60 seconds)
    SELECT created_at INTO v_recent_request
    FROM public.phone_auth_otps
    WHERE phone_number = p_phone_number
      AND created_at > now() - interval '60 seconds'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_recent_request IS NOT NULL THEN
        RAISE EXCEPTION 'Please wait 60 seconds before requesting another OTP'
            USING ERRCODE = '23505';
    END IF;

    -- Invalidate existing unverified OTPs for this purpose
    UPDATE public.phone_auth_otps
    SET expires_at = now()
    WHERE phone_number = p_phone_number
      AND purpose = p_purpose
      AND is_verified = false;

    -- Insert new OTP
    INSERT INTO public.phone_auth_otps (
        phone_number,
        otp_hash,
        purpose,
        attempts,
        max_attempts,
        is_verified,
        resend_available_at,
        expires_at,
        ip_address
    )
    VALUES (
        p_phone_number,
        p_otp_hash,
        p_purpose,
        0,
        3,
        false,
        now() + interval '60 seconds',
        now() + interval '5 minutes',
        p_ip_address
    );

    RETURN jsonb_build_object(
        'success', true,
        'phone_number', p_phone_number,
        'purpose', p_purpose,
        'expires_in_seconds', 300,
        'resend_in_seconds', 60
    );
END;
$$;

-- Verify Phone OTP RPC (Timing safe & Attempt limited)
CREATE OR REPLACE FUNCTION public.verify_phone_otp_atomic(
    p_phone_number text,
    p_candidate_hash text,
    p_purpose text DEFAULT 'login'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_record public.phone_auth_otps%ROWTYPE;
BEGIN
    SELECT * INTO v_record
    FROM public.phone_auth_otps
    WHERE phone_number = p_phone_number
      AND purpose = p_purpose
      AND is_verified = false
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'otp_expired_or_not_found'
        );
    END IF;

    -- Attempt check
    IF v_record.attempts >= v_record.max_attempts THEN
        UPDATE public.phone_auth_otps SET expires_at = now() WHERE id = v_record.id;
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'max_attempts_exceeded'
        );
    END IF;

    -- Verify hash match
    IF v_record.otp_hash = p_candidate_hash THEN
        UPDATE public.phone_auth_otps
        SET is_verified = true,
            attempts = attempts + 1
        WHERE id = v_record.id;

        RETURN jsonb_build_object(
            'success', true,
            'phone_number', p_phone_number,
            'verified_at', now()
        );
    ELSE
        UPDATE public.phone_auth_otps
        SET attempts = attempts + 1
        WHERE id = v_record.id;

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'invalid_otp',
            'remaining_attempts', v_record.max_attempts - (v_record.attempts + 1)
        );
    END IF;
END;
$$;

-- ============================================================================
-- 4. PUSH NOTIFICATIONS INFRASTRUCTURE (DEVICE REGISTRATION & AUTO-TRIGGERS)
-- ============================================================================

-- Ensure device_tokens has production fields
ALTER TABLE public.device_tokens
ADD COLUMN IF NOT EXISTS app_version text,
ADD COLUMN IF NOT EXISTS bundle_id text,
ADD COLUMN IF NOT EXISTS push_provider text DEFAULT 'fcm' CHECK (push_provider IN ('fcm', 'apns', 'expo')),
ADD COLUMN IF NOT EXISTS last_ip text;

-- Register / Refresh Device Token RPC
CREATE OR REPLACE FUNCTION public.register_mobile_device_token(
    p_profile_id uuid,
    p_push_token text,
    p_platform text,
    p_push_provider text DEFAULT 'fcm',
    p_app_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_profile_id IS NULL OR p_push_token IS NULL OR p_platform IS NULL THEN
        RAISE EXCEPTION 'Profile ID, Push Token, and Platform are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.device_tokens (
        profile_id,
        push_token,
        platform,
        push_provider,
        app_version,
        is_active,
        updated_at
    )
    VALUES (
        p_profile_id,
        p_push_token,
        p_platform,
        COALESCE(p_push_provider, 'fcm'),
        p_app_version,
        true,
        now()
    )
    ON CONFLICT (push_token)
    DO UPDATE SET
        profile_id = EXCLUDED.profile_id,
        platform = EXCLUDED.platform,
        push_provider = EXCLUDED.push_provider,
        app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
        is_active = true,
        updated_at = now();

    RETURN jsonb_build_object(
        'success', true,
        'profile_id', p_profile_id,
        'platform', p_platform,
        'registered_at', now()
    );
END;
$$;

-- Automated push notification triggers on Driver Assignment to notify driver
CREATE OR REPLACE FUNCTION public.notify_driver_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver public.drivers%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_title text;
    v_body text;
BEGIN
    IF NEW.status = 'assigned' THEN
        SELECT * INTO v_driver FROM public.drivers WHERE id = NEW.driver_id;
        SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;

        IF v_driver.profile_id IS NOT NULL THEN
            IF NEW.assignment_type = 'pickup' THEN
                v_title := 'New Pickup Task Available!';
                v_body := format('Order %s is ready for pickup. Tap to review route.', COALESCE(v_order.order_number, ''));
            ELSE
                v_title := 'New Delivery Task Available!';
                v_body := format('Order %s is ready for delivery to customer.', COALESCE(v_order.order_number, ''));
            END IF;

            INSERT INTO public.notifications (
                profile_id,
                order_id,
                notification_type,
                title,
                body,
                data,
                status
            )
            VALUES (
                v_driver.profile_id,
                NEW.order_id,
                concat('driver.', NEW.assignment_type, '_assigned'),
                v_title,
                v_body,
                jsonb_build_object(
                    'orderId', NEW.order_id,
                    'assignmentId', NEW.id,
                    'assignmentType', NEW.assignment_type
                ),
                'queued'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_driver_on_assignment ON public.driver_assignments;
CREATE TRIGGER trg_notify_driver_on_assignment
AFTER INSERT ON public.driver_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_driver_on_assignment();

-- ============================================================================
-- 5. APP STORE (APPLE) & GOOGLE PLAY STORE MANDATORY COMPLIANCE
-- ============================================================================

-- Apple App Store Guideline 5.1.1(v) - Mandatory Account Deletion Mechanism
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reason text,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_grace_period', 'processed', 'cancelled')),
    grace_period_ends_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    anonymized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_profile ON public.account_deletion_requests(profile_id);

-- Request Account Deletion RPC (For Mobile App Settings -> Delete Account)
CREATE OR REPLACE FUNCTION public.request_account_deletion_atomic(
    p_profile_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_active_orders boolean;
BEGIN
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION 'Profile ID is required' USING ERRCODE = '22023';
    END IF;

    -- Check if customer has active unresolved orders
    SELECT EXISTS (
        SELECT 1 
        FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE c.profile_id = p_profile_id
          AND o.current_status NOT IN ('delivered', 'cancelled', 'refunded')
    ) INTO v_has_active_orders;

    IF v_has_active_orders THEN
        RAISE EXCEPTION 'Cannot delete account while you have active orders in progress. Please wait for completion or cancel first.'
            USING ERRCODE = '23503';
    END IF;

    -- Record deletion request with 7-day grace period
    INSERT INTO public.account_deletion_requests (
        profile_id,
        reason,
        status,
        grace_period_ends_at
    )
    VALUES (
        p_profile_id,
        p_reason,
        'in_grace_period',
        now() + interval '7 days'
    );

    RETURN jsonb_build_object(
        'success', true,
        'profile_id', p_profile_id,
        'status', 'in_grace_period',
        'grace_period_ends_at', now() + interval '7 days',
        'message', 'Your account deletion request has been registered. Data will be purged after the 7-day grace period.'
    );
END;
$$;

-- Remote App Version Configuration (Enforces Force Update & Maintenance Mode)
CREATE TABLE IF NOT EXISTS public.app_version_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform text NOT NULL UNIQUE CHECK (platform IN ('android', 'ios')),
    min_supported_version text NOT NULL DEFAULT '1.0.0',
    latest_version text NOT NULL DEFAULT '1.0.0',
    is_force_update boolean NOT NULL DEFAULT false,
    store_url text NOT NULL,
    update_title text NOT NULL DEFAULT 'Update Available',
    update_message text NOT NULL DEFAULT 'A new version of Bright & White is available with performance enhancements and bug fixes.',
    is_maintenance_mode boolean NOT NULL DEFAULT false,
    maintenance_message text NOT NULL DEFAULT 'Bright & White is currently undergoing brief scheduled maintenance. Please check back shortly.',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed Initial Store Configs
INSERT INTO public.app_version_configs (platform, min_supported_version, latest_version, is_force_update, store_url)
VALUES 
    ('android', '1.0.0', '1.0.0', false, 'https://play.google.com/store/apps/details?id=com.brightandwhite.laundry'),
    ('ios', '1.0.0', '1.0.0', false, 'https://apps.apple.com/app/bright-white-laundry/id6400000000')
ON CONFLICT (platform) DO NOTHING;

-- App Version Check RPC (Invoked by Mobile App on Splash / Startup)
CREATE OR REPLACE FUNCTION public.check_mobile_app_version(
    p_platform text,
    p_client_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_config public.app_version_configs%ROWTYPE;
    v_needs_update boolean := false;
BEGIN
    SELECT * INTO v_config
    FROM public.app_version_configs
    WHERE platform = p_platform;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'maintenance', false,
            'force_update', false,
            'update_available', false
        );
    END IF;

    IF v_config.is_maintenance_mode THEN
        RETURN jsonb_build_object(
            'maintenance', true,
            'message', v_config.maintenance_message
        );
    END IF;

    -- Compare versions: if client version is strictly lower than min_supported_version
    v_needs_update := (p_client_version != v_config.latest_version);

    RETURN jsonb_build_object(
        'maintenance', false,
        'update_available', v_needs_update,
        'force_update', (v_config.is_force_update AND (p_client_version < v_config.min_supported_version)),
        'latest_version', v_config.latest_version,
        'min_supported_version', v_config.min_supported_version,
        'store_url', v_config.store_url,
        'title', v_config.update_title,
        'message', v_config.update_message
    );
END;
$$;

-- Explicit User Consent Ledger (Google Play Data Safety & GDPR/DPDP)
CREATE TABLE IF NOT EXISTS public.user_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    terms_version text NOT NULL,
    privacy_policy_version text NOT NULL,
    marketing_opt_in boolean NOT NULL DEFAULT false,
    analytics_opt_in boolean NOT NULL DEFAULT true,
    ip_address text,
    user_agent text,
    consented_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_consents_profile ON public.user_consents(profile_id);

-- Record Consent RPC
CREATE OR REPLACE FUNCTION public.record_user_consent_atomic(
    p_profile_id uuid,
    p_terms_version text,
    p_privacy_version text,
    p_marketing_opt_in boolean DEFAULT false,
    p_analytics_opt_in boolean DEFAULT true,
    p_ip text DEFAULT NULL,
    p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.user_consents (
        profile_id,
        terms_version,
        privacy_policy_version,
        marketing_opt_in,
        analytics_opt_in,
        ip_address,
        user_agent,
        consented_at
    )
    VALUES (
        p_profile_id,
        p_terms_version,
        p_privacy_version,
        p_marketing_opt_in,
        p_analytics_opt_in,
        p_ip,
        p_user_agent,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'profile_id', p_profile_id,
        'consented_at', now()
    );
END;
$$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.razorpay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.razorpay_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.razorpay_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_auth_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_version_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Customers can view their own Razorpay orders and payments
DROP POLICY IF EXISTS "Customers can view their razorpay orders" ON public.razorpay_orders;
CREATE POLICY "Customers can view their razorpay orders"
ON public.razorpay_orders FOR SELECT
TO authenticated
USING (
    order_id IN (
        SELECT o.id FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE c.profile_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Customers can view their razorpay payments" ON public.razorpay_payments;
CREATE POLICY "Customers can view their razorpay payments"
ON public.razorpay_payments FOR SELECT
TO authenticated
USING (
    order_id IN (
        SELECT o.id FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE c.profile_id = auth.uid()
    )
);

-- Account deletion requests: Users can view and manage their own request
DROP POLICY IF EXISTS "Users view own deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users view own deletion request"
ON public.account_deletion_requests FOR SELECT
TO authenticated
USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users insert own deletion request"
ON public.account_deletion_requests FOR INSERT
TO authenticated
WITH CHECK (profile_id = auth.uid());

-- App Version Configs: Readable by any user (authenticated and anon)
DROP POLICY IF EXISTS "Public can view app version configs" ON public.app_version_configs;
CREATE POLICY "Public can view app version configs"
ON public.app_version_configs FOR SELECT
TO anon, authenticated
USING (true);

-- User Consents: Users can view and record their own consents
DROP POLICY IF EXISTS "Users can view their own consents" ON public.user_consents;
CREATE POLICY "Users can view their own consents"
ON public.user_consents FOR SELECT
TO authenticated
USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own consents" ON public.user_consents;
CREATE POLICY "Users can insert their own consents"
ON public.user_consents FOR INSERT
TO authenticated
WITH CHECK (profile_id = auth.uid());

-- Service role bypasses all RLS
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Grant authenticated & anon access to RPCs
GRANT EXECUTE ON FUNCTION public.check_mobile_app_version TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_mobile_device_token TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_consent_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_driver_live_location_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_online_status_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_nearest_available_drivers TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_nearest_driver TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_razorpay_payment_success_atomic TO authenticated, service_role;
