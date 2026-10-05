-- =============================================================================
-- PART 2 of 3 — Order lifecycle RPCs, payments, loyalty, packages
-- Bright & White / Supabase manual setup
-- Run this ENTIRE file in Supabase SQL Editor (one paste).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 14_20260910010000_atomic_delivery_completion.sql
-- ---------------------------------------------------------------------------

-- Runtime Gate 6: finish delivery in one transaction.
--
-- Nest verifies the repository's scrypt OTP hash before calling this
-- service-role-only function. PostgreSQL locks and rechecks that exact OTP
-- record, then commits the proof, assignment, and two existing C2 order
-- transitions together. The change_order_status function and its grants are
-- intentionally unchanged.

CREATE OR REPLACE FUNCTION public.complete_delivery_atomic(
    p_order_id uuid,
    p_driver_profile_id uuid,
    p_otp_id uuid,
    p_validated_otp_hash text,
    p_photo_path text,
    p_latitude numeric,
    p_longitude numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver_id uuid;
    v_assignment_id uuid;
    v_otp public.order_otps%ROWTYPE;
    v_object_name text;
    v_claim_deadline_at timestamptz;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
    v_delivery_reason text;
    v_claim_reason text;
BEGIN
    IF p_order_id IS NULL
       OR p_driver_profile_id IS NULL
       OR p_otp_id IS NULL THEN
        RAISE EXCEPTION 'Order, driver profile, and OTP are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_validated_otp_hash IS NULL OR p_validated_otp_hash = '' THEN
        RAISE EXCEPTION 'Validated OTP hash is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_photo_path IS NULL
       OR length(p_photo_path) > 1024
       OR p_photo_path !~ (
            '^' || p_order_id::text ||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
       ) THEN
        RAISE EXCEPTION 'Invalid delivery proof path'
            USING ERRCODE = '22023';
    END IF;

    IF (p_latitude IS NULL) <> (p_longitude IS NULL)
       OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'Invalid delivery coordinates'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'delivery_otp_pending'::public.order_status THEN
        RAISE EXCEPTION
            'Delivery completion is not allowed while order is %',
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    SELECT d.id
    INTO v_driver_id
    FROM public.drivers AS d
    WHERE d.profile_id = p_driver_profile_id
      AND d.is_active
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active driver profile not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT da.id
    INTO v_assignment_id
    FROM public.driver_assignments AS da
    WHERE da.order_id = p_order_id
      AND da.driver_id = v_driver_id
      AND da.assignment_type = 'delivery'::public.assignment_type
      AND da.status = 'arrived'::public.assignment_status
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'No arrived delivery assignment found for this driver'
            USING ERRCODE = '23514';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'delivery'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Delivery OTP has already been used'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.expires_at <= v_now THEN
        RAISE EXCEPTION 'Delivery OTP expired'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Delivery OTP attempts exceeded'
            USING ERRCODE = '23514';
    END IF;

    -- Confirm that the locked row is the same version Nest validated.
    IF v_otp.otp_hash IS DISTINCT FROM p_validated_otp_hash THEN
        RAISE EXCEPTION 'Delivery OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    -- Lock Storage metadata so object deletion cannot race this transaction.
    SELECT so.name
    INTO v_object_name
    FROM storage.objects AS so
    WHERE so.bucket_id = 'delivery-proofs'
      AND so.name = p_photo_path
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery photograph has not been uploaded'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.delivery_proofs (
        order_id,
        driver_id,
        photo_path,
        latitude,
        longitude,
        delivered_at
    )
    VALUES (
        p_order_id,
        v_driver_id,
        p_photo_path,
        p_latitude,
        p_longitude,
        v_now
    );

    UPDATE public.order_otps
    SET
        verified_at = v_now,
        verified_by = p_driver_profile_id
    WHERE id = p_otp_id
      AND verified_at IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Delivery OTP was consumed concurrently'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.driver_assignments
    SET
        status = 'completed'::public.assignment_status,
        completed_at = v_now
    WHERE id = v_assignment_id
      AND status = 'arrived'::public.assignment_status;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Delivery assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    v_delivery_reason := format(
        'Delivery OTP and mandatory photograph verified (assignment %s)',
        v_assignment_id
    );

    PERFORM public.change_order_status(
        p_order_id,
        'delivered'::public.order_status,
        v_delivery_reason
    );

    UPDATE public.order_status_history AS history
    SET changed_by = p_driver_profile_id
    WHERE history.order_id = p_order_id
      AND history.from_status = 'delivery_otp_pending'::public.order_status
      AND history.to_status = 'delivered'::public.order_status
      AND history.reason = v_delivery_reason;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Delivered status history was not recorded'
            USING ERRCODE = '40001';
    END IF;

    v_claim_reason := format(
        'Seven-day delivery claim period started (assignment %s)',
        v_assignment_id
    );

    PERFORM public.change_order_status(
        p_order_id,
        'claim_period_active'::public.order_status,
        v_claim_reason
    );

    UPDATE public.order_status_history AS history
    SET changed_by = p_driver_profile_id
    WHERE history.order_id = p_order_id
      AND history.from_status = 'delivered'::public.order_status
      AND history.to_status = 'claim_period_active'::public.order_status
      AND history.reason = v_claim_reason;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Claim-period status history was not recorded'
            USING ERRCODE = '40001';
    END IF;

    SELECT o.claim_deadline_at
    INTO v_claim_deadline_at
    FROM public.orders AS o
    WHERE o.id = p_order_id;

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'assignmentId', v_assignment_id,
        'delivered', true,
        'orderStatus', 'claim_period_active',
        'assignmentStatus', 'completed',
        'claimPeriodDays', 7,
        'claimDeadlineAt', v_claim_deadline_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_delivery_atomic(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_delivery_atomic(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric
)
TO service_role;

COMMENT ON FUNCTION public.complete_delivery_atomic(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric
)
IS 'Atomically records delivery proof, consumes the OTP, completes the assignment, and starts the claim period.';


-- ---------------------------------------------------------------------------
-- SOURCE: 15_20260910011000_enforce_facility_processing_sequence.sql
-- ---------------------------------------------------------------------------

-- Runtime Gate 5: enforce and retain the exact facility-stage sequence.
--
-- The existing schema deliberately supports multiple facility operation rows
-- per order. Each new row is therefore an immutable stage record. This trigger
-- serializes stage creation through the order row and invokes the existing C2
-- function in the same transaction for the corresponding order-level status.

CREATE INDEX IF NOT EXISTS idx_facility_operations_order_started
ON public.facility_order_operations (
    order_id,
    started_at DESC,
    id DESC
);

CREATE OR REPLACE FUNCTION public.enforce_facility_processing_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_previous public.facility_order_operations%ROWTYPE;
    v_has_previous boolean := false;
    v_expected_stage text;
    v_target_order_status public.order_status;
BEGIN
    SELECT o.current_status
    INTO v_order_status
    FROM public.orders o
    WHERE o.id = NEW.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', NEW.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.operation_type IS DISTINCT FROM OLD.operation_type THEN
            RAISE EXCEPTION 'Facility operation type is immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
            RETURN NEW;
        END IF;

        IF OLD.operation_type <> 'quality_check'
           OR OLD.current_status <> 'quality_check'::public.facility_operation_status
           OR NEW.current_status NOT IN (
                'ready_for_delivery'::public.facility_operation_status,
                'rework_required'::public.facility_operation_status
           ) THEN
            RAISE EXCEPTION 'Facility operation status cannot change from % to %',
                OLD.current_status,
                NEW.current_status
                USING ERRCODE = '23514';
        END IF;

        v_target_order_status := NEW.current_status::text::public.order_status;
        PERFORM public.change_order_status(
            NEW.order_id,
            v_target_order_status,
            CASE NEW.current_status
                WHEN 'ready_for_delivery'::public.facility_operation_status
                    THEN 'Quality control approved'
                ELSE 'Quality control rejected - rework required'
            END
        );

        RETURN NEW;
    END IF;

    SELECT foo.*
    INTO v_previous
    FROM public.facility_order_operations foo
    WHERE foo.order_id = NEW.order_id
    ORDER BY foo.started_at DESC NULLS LAST, foo.id DESC
    LIMIT 1;

    v_has_previous := FOUND;

    IF NEW.operation_type = 'facility_workflow' THEN
        IF v_has_previous
           OR NEW.current_status <> 'received'::public.facility_operation_status THEN
            RAISE EXCEPTION 'Facility receipt must be the first operation event'
                USING ERRCODE = '23514';
        END IF;

        v_target_order_status := 'received_at_facility'::public.order_status;

    ELSIF NEW.operation_type = 'verification' THEN
        IF NOT v_has_previous
           OR v_previous.operation_type <> 'facility_workflow'
           OR v_previous.current_status <> 'received'::public.facility_operation_status
           OR NEW.current_status <> 'verification'::public.facility_operation_status
           OR NEW.completed_at IS NULL THEN
            RAISE EXCEPTION 'Verification must follow facility receipt and complete immediately'
                USING ERRCODE = '23514';
        END IF;

        v_target_order_status := 'verification'::public.order_status;

    ELSIF NEW.operation_type IN (
        'washing',
        'drying',
        'ironing',
        'folding',
        'packaging'
    ) THEN
        IF NOT v_has_previous THEN
            RAISE EXCEPTION 'Facility processing requires a preceding operation'
                USING ERRCODE = '23514';
        END IF;

        v_expected_stage := CASE v_previous.current_status
            WHEN 'verification'::public.facility_operation_status THEN 'washing'
            WHEN 'washing'::public.facility_operation_status THEN 'drying'
            WHEN 'drying'::public.facility_operation_status THEN 'ironing'
            WHEN 'ironing'::public.facility_operation_status THEN 'folding'
            WHEN 'folding'::public.facility_operation_status THEN 'packaging'
            WHEN 'rework_required'::public.facility_operation_status THEN 'washing'
            ELSE NULL
        END;

        IF v_expected_stage IS NULL
           OR NEW.operation_type <> v_expected_stage
           OR NEW.current_status::text <> NEW.operation_type
           OR NEW.completed_at IS NOT NULL
           OR (
                v_previous.current_status NOT IN (
                    'verification'::public.facility_operation_status,
                    'rework_required'::public.facility_operation_status
                )
                AND v_previous.completed_at IS NULL
           ) THEN
            RAISE EXCEPTION 'Expected completed facility stage %, received %',
                coalesce(v_expected_stage, '<none>'),
                NEW.operation_type
                USING ERRCODE = '23514';
        END IF;

        v_target_order_status := 'processing'::public.order_status;

    ELSIF NEW.operation_type = 'quality_check' THEN
        IF NOT v_has_previous
           OR v_previous.operation_type <> 'packaging'
           OR v_previous.current_status <> 'packaging'::public.facility_operation_status
           OR v_previous.completed_at IS NULL
           OR NEW.current_status <> 'quality_check'::public.facility_operation_status
           OR NEW.completed_at IS NULL THEN
            RAISE EXCEPTION 'Quality check requires completed packaging'
                USING ERRCODE = '23514';
        END IF;

        v_target_order_status := 'quality_check'::public.order_status;

    ELSE
        RAISE EXCEPTION 'Unsupported facility operation type: %', NEW.operation_type
            USING ERRCODE = '22023';
    END IF;

    PERFORM public.change_order_status(
        NEW.order_id,
        v_target_order_status,
        CASE NEW.operation_type
            WHEN 'facility_workflow' THEN 'Order received through facility QR scan'
            WHEN 'verification' THEN 'Facility garment verification completed'
            WHEN 'quality_check' THEN 'Facility quality check started'
            ELSE format('Facility %s started', NEW.operation_type)
        END
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_facility_processing_sequence
ON public.facility_order_operations;

CREATE TRIGGER trg_enforce_facility_processing_sequence
BEFORE INSERT OR UPDATE OF current_status, operation_type
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_facility_processing_sequence();

REVOKE ALL ON FUNCTION public.enforce_facility_processing_sequence()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_facility_processing_sequence()
IS 'Serializes facility stage records and delegates order-level transitions to the C2 state machine.';


-- ---------------------------------------------------------------------------
-- SOURCE: 16_20260910012000_order_status_history_chronology.sql
-- ---------------------------------------------------------------------------

-- A transaction may perform more than one valid C2 transition. PostgreSQL's
-- now() is fixed at transaction start, so those history rows would otherwise
-- share a timestamp and have no deterministic chronological sort order.

CREATE OR REPLACE FUNCTION public.stamp_order_status_history_chronology()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_latest timestamptz;
    v_clock timestamptz := clock_timestamp();
BEGIN
    SELECT max(history.created_at)
    INTO v_latest
    FROM public.order_status_history AS history
    WHERE history.order_id = NEW.order_id;

    NEW.created_at := CASE
        WHEN v_latest IS NULL THEN v_clock
        ELSE greatest(v_clock, v_latest + interval '1 microsecond')
    END;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_order_status_history_chronology
ON public.order_status_history;

CREATE TRIGGER trg_stamp_order_status_history_chronology
BEFORE INSERT
ON public.order_status_history
FOR EACH ROW
EXECUTE FUNCTION public.stamp_order_status_history_chronology();

REVOKE ALL ON FUNCTION public.stamp_order_status_history_chronology()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.stamp_order_status_history_chronology()
IS 'Assigns strictly increasing per-order status-history timestamps, including multi-transition transactions.';


-- ---------------------------------------------------------------------------
-- SOURCE: 17_20260910013000_atomic_delivery_otp_failure_attempt.sql
-- ---------------------------------------------------------------------------

-- Serialize failed delivery OTP attempts so concurrent guesses cannot collapse
-- into one counter update. The OTP plaintext never crosses this boundary; Nest
-- compares the scrypt hash and supplies the exact row version it inspected.

CREATE OR REPLACE FUNCTION public.record_delivery_otp_failure_attempt(
    p_order_id uuid,
    p_otp_id uuid,
    p_expected_otp_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_otp public.order_otps%ROWTYPE;
    v_attempt_count integer;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_otp_id IS NULL THEN
        RAISE EXCEPTION 'Order and OTP are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_expected_otp_hash IS NULL OR p_expected_otp_hash = '' THEN
        RAISE EXCEPTION 'Expected OTP hash is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'delivery'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.otp_hash IS DISTINCT FROM p_expected_otp_hash THEN
        RAISE EXCEPTION 'Delivery OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    IF v_otp.verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Delivery OTP has already been used'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.expires_at <= v_now THEN
        RAISE EXCEPTION 'Delivery OTP expired'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Delivery OTP attempts exceeded'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.order_otps
    SET attempt_count = attempt_count + 1
    WHERE id = p_otp_id
    RETURNING attempt_count
    INTO v_attempt_count;

    RETURN v_attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_delivery_otp_failure_attempt(
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_delivery_otp_failure_attempt(
    uuid,
    uuid,
    text
)
TO service_role;

COMMENT ON FUNCTION public.record_delivery_otp_failure_attempt(
    uuid,
    uuid,
    text
)
IS 'Locks one delivery OTP and records exactly one failed verification attempt.';


-- ---------------------------------------------------------------------------
-- SOURCE: 18_20260910014000_atomic_facility_verification_quality_check.sql
-- ---------------------------------------------------------------------------

-- Keep the three multi-row facility decisions transactionally complete.
--
-- The existing facility-sequence trigger remains the authority for order
-- transitions and delegates every transition to the C2 change_order_status
-- function. These service-role-only RPCs group the associated writes so a
-- receipt, inspection, or final quality verdict cannot be half committed.

CREATE OR REPLACE FUNCTION public.receive_facility_order_atomic(
    p_secure_token uuid,
    p_scanner_profile_id uuid,
    p_latitude numeric,
    p_longitude numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_qr public.order_qr_codes%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_assignment_id uuid;
    v_operation public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
BEGIN
    IF p_secure_token IS NULL OR p_scanner_profile_id IS NULL THEN
        RAISE EXCEPTION 'QR token and facility scanner are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT qr.*
    INTO v_qr
    FROM public.order_qr_codes AS qr
    WHERE qr.secure_token = p_secure_token
    FOR UPDATE;

    IF NOT FOUND OR NOT v_qr.is_active THEN
        RAISE EXCEPTION 'Invalid QR code'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = v_qr.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_qr.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.facility_id IS NULL THEN
        RAISE EXCEPTION 'Order has no assigned facility'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status <> 'in_transit_to_facility'::public.order_status THEN
        RAISE EXCEPTION 'Facility receipt is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_scanner_profile_id
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT assignment.id
    INTO v_assignment_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.order_id = v_order.id
      AND assignment.assignment_type = 'pickup'::public.assignment_type
      AND assignment.status = 'arrived'::public.assignment_status
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No arrived pickup assignment found for this order'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.qr_scan_logs (
        qr_code_id,
        scanner_profile_id,
        scan_action,
        latitude,
        longitude,
        scanned_at
    )
    VALUES (
        v_qr.id,
        p_scanner_profile_id,
        'facility_received',
        p_latitude,
        p_longitude,
        v_now
    );

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        received_at,
        started_at,
        completed_at
    )
    VALUES (
        v_order.id,
        v_order.facility_id,
        'received'::public.facility_operation_status,
        'facility_workflow',
        p_scanner_profile_id,
        v_now,
        v_now,
        v_now
    )
    RETURNING * INTO v_operation;

    UPDATE public.driver_assignments
    SET
        status = 'completed'::public.assignment_status,
        completed_at = v_now
    WHERE id = v_assignment_id
      AND status = 'arrived'::public.assignment_status;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Pickup assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'orderId', v_order.id,
        'operationId', v_operation.id,
        'assignmentId', v_assignment_id,
        'received', true,
        'facilityStatus', 'received',
        'orderStatus', 'received_at_facility',
        'pickupAssignmentStatus', 'completed'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_facility_verification_atomic(
    p_order_id uuid,
    p_performed_by uuid,
    p_item_count integer,
    p_weight_kg numeric,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_previous public.facility_order_operations%ROWTYPE;
    v_verification public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Order and facility operator are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.current_status <> 'received_at_facility'::public.order_status THEN
        RAISE EXCEPTION 'Verification is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_performed_by
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT operation.*
    INTO v_previous
    FROM public.facility_order_operations AS operation
    WHERE operation.order_id = p_order_id
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC
    LIMIT 1;

    IF NOT FOUND
       OR v_previous.operation_type <> 'facility_workflow'
       OR v_previous.current_status <> 'received'::public.facility_operation_status
       OR v_previous.completed_at IS NULL THEN
        RAISE EXCEPTION 'Facility verification requires a completed receipt'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        started_at,
        completed_at,
        notes
    )
    VALUES (
        p_order_id,
        v_order.facility_id,
        'verification'::public.facility_operation_status,
        'verification',
        p_performed_by,
        v_now,
        v_now,
        p_notes
    )
    RETURNING * INTO v_verification;

    INSERT INTO public.garment_inspections (
        operation_id,
        order_id,
        inspected_by,
        verified_by,
        item_count,
        counted_quantity,
        weight_kg,
        condition_notes,
        inspection_status
    )
    VALUES (
        v_verification.id,
        p_order_id,
        p_performed_by,
        p_performed_by,
        p_item_count,
        coalesce(p_item_count, 0),
        p_weight_kg,
        p_notes,
        'verified'
    );

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'operationId', v_verification.id,
        'verified', true,
        'facilityStatus', 'verification',
        'orderStatus', 'verification'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_facility_quality_check_atomic(
    p_order_id uuid,
    p_performed_by uuid,
    p_approved boolean,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_previous public.facility_order_operations%ROWTYPE;
    v_quality public.facility_order_operations%ROWTYPE;
    v_target_status public.facility_operation_status;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL
       OR p_performed_by IS NULL
       OR p_approved IS NULL THEN
        RAISE EXCEPTION 'Order, facility operator, and quality verdict are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.current_status <> 'processing'::public.order_status THEN
        RAISE EXCEPTION 'Quality check is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_performed_by
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT operation.*
    INTO v_previous
    FROM public.facility_order_operations AS operation
    WHERE operation.order_id = p_order_id
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC
    LIMIT 1;

    IF NOT FOUND
       OR v_previous.operation_type <> 'packaging'
       OR v_previous.current_status <> 'packaging'::public.facility_operation_status
       OR v_previous.completed_at IS NULL THEN
        RAISE EXCEPTION 'Quality check requires completed packaging'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        machine_id,
        started_at,
        completed_at,
        notes
    )
    VALUES (
        p_order_id,
        v_order.facility_id,
        'quality_check'::public.facility_operation_status,
        'quality_check',
        p_performed_by,
        NULL,
        v_now,
        v_now,
        p_notes
    )
    RETURNING * INTO v_quality;

    v_target_status := CASE p_approved
        WHEN true THEN 'ready_for_delivery'::public.facility_operation_status
        ELSE 'rework_required'::public.facility_operation_status
    END;

    UPDATE public.facility_order_operations
    SET
        current_status = v_target_status,
        ready_for_delivery_at = CASE p_approved WHEN true THEN v_now ELSE NULL END,
        performed_by = p_performed_by,
        notes = CASE
            WHEN p_approved THEN p_notes
            ELSE coalesce(p_notes, 'Quality control rejected')
        END
    WHERE id = v_quality.id
      AND current_status = 'quality_check'::public.facility_operation_status
    RETURNING * INTO v_quality;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quality operation changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'operationId', v_quality.id,
        'approved', p_approved,
        'facilityStatus', v_target_status::text,
        'orderStatus', v_target_status::text
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_facility_verification_atomic(
    uuid,
    uuid,
    integer,
    numeric,
    text
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.receive_facility_order_atomic(
    uuid,
    uuid,
    numeric,
    numeric
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.receive_facility_order_atomic(
    uuid,
    uuid,
    numeric,
    numeric
)
TO service_role;

GRANT EXECUTE ON FUNCTION public.record_facility_verification_atomic(
    uuid,
    uuid,
    integer,
    numeric,
    text
)
TO service_role;

REVOKE ALL ON FUNCTION public.complete_facility_quality_check_atomic(
    uuid,
    uuid,
    boolean,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_facility_quality_check_atomic(
    uuid,
    uuid,
    boolean,
    text
)
TO service_role;

COMMENT ON FUNCTION public.record_facility_verification_atomic(
    uuid,
    uuid,
    integer,
    numeric,
    text
)
IS 'Atomically records facility verification and its garment inspection.';

COMMENT ON FUNCTION public.receive_facility_order_atomic(
    uuid,
    uuid,
    numeric,
    numeric
)
IS 'Atomically records a facility QR receipt and completes its arrived pickup assignment.';

COMMENT ON FUNCTION public.complete_facility_quality_check_atomic(
    uuid,
    uuid,
    boolean,
    text
)
IS 'Atomically records a quality check and commits its ready or rework verdict.';


-- ---------------------------------------------------------------------------
-- SOURCE: 19_20260910015000_complete_expired_claim_period_atomic.sql
-- ---------------------------------------------------------------------------

-- Runtime Gate 6: complete an expired delivery claim period atomically.
--
-- This service-role-only function locks the order before checking its
-- deadline. The deadline validation and the existing C2 lifecycle transition
-- therefore happen in one transaction without a time-of-check/time-of-use
-- race. The change_order_status function and its grants remain unchanged.

CREATE OR REPLACE FUNCTION public.complete_expired_claim_period(
    p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_claim_deadline_at timestamptz;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'Order is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT
        o.current_status,
        o.claim_deadline_at
    INTO
        v_order_status,
        v_claim_deadline_at
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'claim_period_active'::public.order_status THEN
        RAISE EXCEPTION
            'Order cannot complete while it is %',
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    IF v_claim_deadline_at IS NULL THEN
        RAISE EXCEPTION 'Order has no claim-period deadline'
            USING ERRCODE = '23514';
    END IF;

    IF v_claim_deadline_at > v_now THEN
        RAISE EXCEPTION 'The delivery claim period is still active'
            USING ERRCODE = '23514';
    END IF;

    PERFORM public.change_order_status(
        p_order_id,
        'completed'::public.order_status,
        'Delivery claim period elapsed'
    );

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'orderStatus', 'completed',
        'claimDeadlineAt', v_claim_deadline_at,
        'completedAt', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_expired_claim_period(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_expired_claim_period(uuid)
TO service_role;

COMMENT ON FUNCTION public.complete_expired_claim_period(uuid)
IS 'Locks an order, verifies that its delivery claim deadline elapsed, and completes it through the C2 lifecycle function.';


-- ---------------------------------------------------------------------------
-- SOURCE: 20_20260910016000_atomic_pickup_and_assignment_lifecycle.sql
-- ---------------------------------------------------------------------------

-- Runtime Gates 4 and 6: keep assignment, navigation, and pickup OTP
-- transitions consistent with the C2 order lifecycle.
--
-- All functions are callable only by the backend service role. They lock the
-- order before related rows, revalidate current state inside the transaction,
-- and delegate every order transition to the unchanged change_order_status().

CREATE OR REPLACE FUNCTION public.create_driver_assignment_atomic(
    p_order_id uuid,
    p_driver_id uuid,
    p_assignment_type public.assignment_type,
    p_assignment_score numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver public.drivers%ROWTYPE;
    v_assignment public.driver_assignments%ROWTYPE;
    v_expected_status public.order_status;
    v_retry_status public.order_status;
    v_target_status public.order_status;
    v_active_jobs integer;
BEGIN
    IF p_order_id IS NULL OR p_driver_id IS NULL OR p_assignment_type IS NULL THEN
        RAISE EXCEPTION 'Order, driver, and assignment type are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF p_assignment_type = 'pickup'::public.assignment_type THEN
        v_expected_status := 'confirmed'::public.order_status;
        v_retry_status := 'pickup_failed'::public.order_status;
        v_target_status := 'pickup_assigned'::public.order_status;
    ELSE
        v_expected_status := 'ready_for_delivery'::public.order_status;
        v_retry_status := 'delivery_failed'::public.order_status;
        v_target_status := 'delivery_assigned'::public.order_status;
    END IF;

    IF v_order_status NOT IN (v_expected_status, v_retry_status) THEN
        RAISE EXCEPTION '% assignment is not allowed while order is %',
            p_assignment_type,
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    SELECT d.*
    INTO v_driver
    FROM public.drivers AS d
    WHERE d.id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND OR NOT v_driver.is_active OR NOT v_driver.is_available THEN
        RAISE EXCEPTION 'Selected driver is not active and available'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
    INTO v_active_jobs
    FROM public.driver_assignments AS assignment
    WHERE assignment.driver_id = p_driver_id
      AND assignment.status IN (
          'assigned'::public.assignment_status,
          'accepted'::public.assignment_status,
          'en_route'::public.assignment_status,
          'arrived'::public.assignment_status
      );

    IF v_active_jobs >= v_driver.max_concurrent_jobs THEN
        RAISE EXCEPTION 'Selected driver has reached the active-job limit'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.driver_assignments AS assignment
        WHERE assignment.order_id = p_order_id
          AND assignment.assignment_type = p_assignment_type
          AND assignment.status IN (
              'assigned'::public.assignment_status,
              'accepted'::public.assignment_status,
              'en_route'::public.assignment_status,
              'arrived'::public.assignment_status
          )
    ) THEN
        RAISE EXCEPTION 'An active assignment already exists'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.driver_assignments (
        order_id,
        driver_id,
        assignment_type,
        assignment_score,
        status
    )
    VALUES (
        p_order_id,
        p_driver_id,
        p_assignment_type,
        p_assignment_score,
        'assigned'::public.assignment_status
    )
    RETURNING * INTO v_assignment;

    PERFORM public.change_order_status(
        p_order_id,
        v_target_status,
        format('%s driver assigned', p_assignment_type)
    );

    RETURN jsonb_build_object(
        'assignment', to_jsonb(v_assignment),
        'orderStatus', v_target_status::text
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_driver_assignment_atomic(
    p_assignment_id uuid,
    p_driver_id uuid,
    p_action text,
    p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id uuid;
    v_order_status public.order_status;
    v_assignment public.driver_assignments%ROWTYPE;
    v_expected_order_status public.order_status;
    v_target_order_status public.order_status;
    v_target_assignment_status public.assignment_status;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
BEGIN
    IF p_assignment_id IS NULL OR p_driver_id IS NULL OR p_action IS NULL THEN
        RAISE EXCEPTION 'Assignment, driver, and action are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT assignment.order_id
    INTO v_order_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT assignment.*
    INTO v_assignment
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    IF p_action IN ('accept', 'reject') THEN
        IF v_assignment.status <> 'assigned'::public.assignment_status THEN
            RAISE EXCEPTION 'Assignment can no longer be responded to'
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment.assignment_type = 'pickup'::public.assignment_type THEN
            v_expected_order_status := 'pickup_assigned'::public.order_status;
            v_target_order_status := CASE p_action
                WHEN 'accept' THEN 'pickup_accepted'::public.order_status
                ELSE 'pickup_failed'::public.order_status
            END;
        ELSE
            v_expected_order_status := 'delivery_assigned'::public.order_status;
            v_target_order_status := CASE p_action
                WHEN 'accept' THEN 'delivery_accepted'::public.order_status
                ELSE 'delivery_failed'::public.order_status
            END;
        END IF;

        v_target_assignment_status := CASE p_action
            WHEN 'accept' THEN 'accepted'::public.assignment_status
            ELSE 'rejected'::public.assignment_status
        END;

        UPDATE public.driver_assignments
        SET
            status = v_target_assignment_status,
            accepted_at = CASE p_action WHEN 'accept' THEN v_now ELSE accepted_at END,
            rejection_reason = CASE
                WHEN p_action = 'reject' THEN coalesce(nullif(p_rejection_reason, ''), 'Rejected by driver')
                ELSE rejection_reason
            END
        WHERE id = p_assignment_id
          AND status = 'assigned'::public.assignment_status
        RETURNING * INTO v_assignment;

    ELSIF p_action = 'start_navigation' THEN
        IF v_assignment.status <> 'accepted'::public.assignment_status THEN
            RAISE EXCEPTION 'Only an accepted assignment can start navigation'
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment.assignment_type = 'pickup'::public.assignment_type THEN
            v_expected_order_status := 'pickup_accepted'::public.order_status;
            v_target_order_status := 'en_route_pickup'::public.order_status;
        ELSE
            v_expected_order_status := 'delivery_accepted'::public.order_status;
            v_target_order_status := 'en_route_delivery'::public.order_status;
        END IF;

        v_target_assignment_status := 'en_route'::public.assignment_status;

        UPDATE public.driver_assignments
        SET status = v_target_assignment_status
        WHERE id = p_assignment_id
          AND status = 'accepted'::public.assignment_status
        RETURNING * INTO v_assignment;

    ELSIF p_action = 'arrive' THEN
        IF v_assignment.status <> 'en_route'::public.assignment_status THEN
            RAISE EXCEPTION 'Only an en-route assignment can be marked arrived'
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment.assignment_type = 'pickup'::public.assignment_type THEN
            v_expected_order_status := 'en_route_pickup'::public.order_status;
            v_target_order_status := 'pickup_otp_pending'::public.order_status;
        ELSE
            v_expected_order_status := 'en_route_delivery'::public.order_status;
            v_target_order_status := 'delivery_otp_pending'::public.order_status;
        END IF;

        v_target_assignment_status := 'arrived'::public.assignment_status;

        UPDATE public.driver_assignments
        SET status = v_target_assignment_status
        WHERE id = p_assignment_id
          AND status = 'en_route'::public.assignment_status
        RETURNING * INTO v_assignment;

    ELSE
        RAISE EXCEPTION 'Unsupported assignment action: %', p_action
            USING ERRCODE = '22023';
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Assignment changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    IF v_order_status <> v_expected_order_status THEN
        RAISE EXCEPTION 'Order is not in the expected assignment state'
            USING ERRCODE = '23514';
    END IF;

    PERFORM public.change_order_status(
        v_order_id,
        v_target_order_status,
        CASE p_action
            WHEN 'accept' THEN format('%s assignment accepted', v_assignment.assignment_type)
            WHEN 'reject' THEN format('%s assignment rejected', v_assignment.assignment_type)
            WHEN 'start_navigation' THEN format('%s driver started navigation', v_assignment.assignment_type)
            ELSE format('%s driver arrived', v_assignment.assignment_type)
        END
    );

    IF p_action = 'start_navigation' THEN
        INSERT INTO public.driver_navigation_events (
            driver_id,
            order_id,
            event_type
        )
        VALUES (
            p_driver_id,
            v_order_id,
            format('navigate_%s', v_assignment.assignment_type)
        );
    END IF;

    RETURN jsonb_build_object(
        'assignment', to_jsonb(v_assignment),
        'assignmentId', p_assignment_id,
        'orderId', v_order_id,
        'assignmentStatus', v_target_assignment_status::text,
        'orderStatus', v_target_order_status::text
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_facility_transit_atomic(
    p_assignment_id uuid,
    p_driver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id uuid;
    v_order public.orders%ROWTYPE;
    v_assignment public.driver_assignments%ROWTYPE;
    v_facility public.facilities%ROWTYPE;
BEGIN
    IF p_assignment_id IS NULL OR p_driver_id IS NULL THEN
        RAISE EXCEPTION 'Assignment and driver are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT assignment.order_id
    INTO v_order_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT assignment.*
    INTO v_assignment
    FROM public.driver_assignments AS assignment
    WHERE assignment.id = p_assignment_id
      AND assignment.driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_assignment.assignment_type <> 'pickup'::public.assignment_type
       OR v_assignment.status <> 'arrived'::public.assignment_status THEN
        RAISE EXCEPTION 'An arrived pickup assignment is required'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status <> 'picked_up'::public.order_status THEN
        RAISE EXCEPTION 'Facility transit is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF v_order.facility_id IS NULL THEN
        RAISE EXCEPTION 'Order has no assigned facility'
            USING ERRCODE = '23514';
    END IF;

    SELECT facility.*
    INTO v_facility
    FROM public.facilities AS facility
    WHERE facility.id = v_order.facility_id
    FOR SHARE;

    IF NOT FOUND
       OR NOT v_facility.is_active
       OR v_facility.latitude IS NULL
       OR v_facility.longitude IS NULL THEN
        RAISE EXCEPTION 'Assigned facility has no active route destination'
            USING ERRCODE = '23514';
    END IF;

    PERFORM public.change_order_status(
        v_order.id,
        'in_transit_to_facility'::public.order_status,
        'Pickup driver started transit to facility'
    );

    INSERT INTO public.driver_navigation_events (
        driver_id,
        order_id,
        event_type,
        destination_latitude,
        destination_longitude
    )
    VALUES (
        p_driver_id,
        v_order.id,
        'navigate_facility',
        v_facility.latitude,
        v_facility.longitude
    );

    RETURN jsonb_build_object(
        'assignmentId', p_assignment_id,
        'orderId', v_order.id,
        'assignmentStatus', 'arrived',
        'orderStatus', 'in_transit_to_facility'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_order_otp_atomic(
    p_order_id uuid,
    p_otp_type text,
    p_otp_hash text,
    p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_expected_status public.order_status;
    v_otp public.order_otps%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL
       OR p_otp_type IS NULL
       OR p_otp_type NOT IN ('pickup', 'delivery')
       OR p_otp_hash IS NULL
       OR p_otp_hash = ''
       OR p_expires_at IS NULL
       OR p_expires_at <= v_now THEN
        RAISE EXCEPTION 'Valid order, OTP type, hash, and future expiry are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    v_expected_status := CASE p_otp_type
        WHEN 'pickup' THEN 'pickup_otp_pending'::public.order_status
        ELSE 'delivery_otp_pending'::public.order_status
    END;

    IF v_order_status <> v_expected_status THEN
        RAISE EXCEPTION 'OTP cannot be created while order is %', v_order_status
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.order_otps
    SET expires_at = least(expires_at, v_now)
    WHERE order_id = p_order_id
      AND otp_type = p_otp_type
      AND verified_at IS NULL
      AND expires_at > v_now;

    INSERT INTO public.order_otps (
        order_id,
        otp_type,
        otp_hash,
        expires_at
    )
    VALUES (
        p_order_id,
        p_otp_type,
        p_otp_hash,
        p_expires_at
    )
    RETURNING * INTO v_otp;

    RETURN jsonb_build_object(
        'id', v_otp.id,
        'otpType', v_otp.otp_type,
        'expiresAt', v_otp.expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pickup_otp_failure_attempt(
    p_order_id uuid,
    p_driver_profile_id uuid,
    p_otp_id uuid,
    p_expected_otp_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver_id uuid;
    v_otp public.order_otps%ROWTYPE;
    v_attempt_count integer;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL
       OR p_driver_profile_id IS NULL
       OR p_otp_id IS NULL
       OR p_expected_otp_hash IS NULL
       OR p_expected_otp_hash = '' THEN
        RAISE EXCEPTION 'Order, driver, OTP, and expected hash are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'pickup_otp_pending'::public.order_status THEN
        RAISE EXCEPTION 'Pickup OTP is not pending'
            USING ERRCODE = '23514';
    END IF;

    SELECT d.id
    INTO v_driver_id
    FROM public.drivers AS d
    WHERE d.profile_id = p_driver_profile_id
      AND d.is_active
    FOR SHARE;

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.driver_assignments AS assignment
        WHERE assignment.order_id = p_order_id
          AND assignment.driver_id = v_driver_id
          AND assignment.assignment_type = 'pickup'::public.assignment_type
          AND assignment.status = 'arrived'::public.assignment_status
    ) THEN
        RAISE EXCEPTION 'Arrived pickup driver access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'pickup'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.otp_hash IS DISTINCT FROM p_expected_otp_hash THEN
        RAISE EXCEPTION 'Pickup OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    IF v_otp.verified_at IS NOT NULL OR v_otp.expires_at <= v_now THEN
        RAISE EXCEPTION 'Pickup OTP is expired or already used'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Pickup OTP attempts exceeded'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.order_otps
    SET attempt_count = attempt_count + 1
    WHERE id = p_otp_id
    RETURNING attempt_count INTO v_attempt_count;

    RETURN v_attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pickup_otp_verification(
    p_order_id uuid,
    p_driver_profile_id uuid,
    p_otp_id uuid,
    p_validated_otp_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_driver_id uuid;
    v_assignment_id uuid;
    v_otp public.order_otps%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
    v_rows integer;
    v_reason text;
BEGIN
    IF p_order_id IS NULL
       OR p_driver_profile_id IS NULL
       OR p_otp_id IS NULL
       OR p_validated_otp_hash IS NULL
       OR p_validated_otp_hash = '' THEN
        RAISE EXCEPTION 'Order, driver, OTP, and validated hash are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.current_status
    INTO v_order_status
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'pickup_otp_pending'::public.order_status THEN
        RAISE EXCEPTION 'Pickup verification is not allowed while order is %',
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    SELECT d.id
    INTO v_driver_id
    FROM public.drivers AS d
    WHERE d.profile_id = p_driver_profile_id
      AND d.is_active
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active driver profile not found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT assignment.id
    INTO v_assignment_id
    FROM public.driver_assignments AS assignment
    WHERE assignment.order_id = p_order_id
      AND assignment.driver_id = v_driver_id
      AND assignment.assignment_type = 'pickup'::public.assignment_type
      AND assignment.status = 'arrived'::public.assignment_status
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No arrived pickup assignment found for this driver'
            USING ERRCODE = '23514';
    END IF;

    SELECT otp.*
    INTO v_otp
    FROM public.order_otps AS otp
    WHERE otp.id = p_otp_id
      AND otp.order_id = p_order_id
      AND otp.otp_type = 'pickup'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup OTP not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_otp.verified_at IS NOT NULL
       OR v_otp.expires_at <= v_now
       OR v_otp.attempt_count >= 5 THEN
        RAISE EXCEPTION 'Pickup OTP is expired, used, or attempt-limited'
            USING ERRCODE = '23514';
    END IF;

    IF v_otp.otp_hash IS DISTINCT FROM p_validated_otp_hash THEN
        RAISE EXCEPTION 'Pickup OTP changed during verification'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.order_otps
    SET
        verified_at = v_now,
        verified_by = p_driver_profile_id
    WHERE id = p_otp_id
      AND verified_at IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Pickup OTP was consumed concurrently'
            USING ERRCODE = '40001';
    END IF;

    v_reason := format('Pickup OTP verified (assignment %s)', v_assignment_id);

    PERFORM public.change_order_status(
        p_order_id,
        'picked_up'::public.order_status,
        v_reason
    );

    UPDATE public.order_status_history AS history
    SET changed_by = p_driver_profile_id
    WHERE history.order_id = p_order_id
      AND history.from_status = 'pickup_otp_pending'::public.order_status
      AND history.to_status = 'picked_up'::public.order_status
      AND history.reason = v_reason;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Pickup status history was not recorded'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'verified', true,
        'orderId', p_order_id,
        'otpType', 'pickup',
        'orderStatus', 'picked_up'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_driver_assignment_atomic(
    uuid,
    uuid,
    public.assignment_type,
    numeric
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_driver_assignment_atomic(
    uuid,
    uuid,
    public.assignment_type,
    numeric
)
TO service_role;

REVOKE ALL ON FUNCTION public.transition_driver_assignment_atomic(
    uuid,
    uuid,
    text,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.transition_driver_assignment_atomic(
    uuid,
    uuid,
    text,
    text
)
TO service_role;

REVOKE ALL ON FUNCTION public.start_facility_transit_atomic(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_facility_transit_atomic(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.create_order_otp_atomic(
    uuid,
    text,
    text,
    timestamptz
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order_otp_atomic(
    uuid,
    text,
    text,
    timestamptz
)
TO service_role;

REVOKE ALL ON FUNCTION public.record_pickup_otp_failure_attempt(
    uuid,
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_pickup_otp_failure_attempt(
    uuid,
    uuid,
    uuid,
    text
)
TO service_role;

REVOKE ALL ON FUNCTION public.complete_pickup_otp_verification(
    uuid,
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_pickup_otp_verification(
    uuid,
    uuid,
    uuid,
    text
)
TO service_role;

COMMENT ON FUNCTION public.create_driver_assignment_atomic(
    uuid,
    uuid,
    public.assignment_type,
    numeric
)
IS 'Atomically creates an active driver assignment and advances the C2 order state.';

COMMENT ON FUNCTION public.transition_driver_assignment_atomic(
    uuid,
    uuid,
    text,
    text
)
IS 'Atomically accepts, rejects, starts, or arrives a driver assignment with its C2 transition.';

COMMENT ON FUNCTION public.start_facility_transit_atomic(uuid, uuid)
IS 'Atomically starts pickup transit to the assigned facility and records its navigation event.';

COMMENT ON FUNCTION public.create_order_otp_atomic(uuid, text, text, timestamptz)
IS 'Serializes OTP replacement so one unexpired code remains active per order and type.';

COMMENT ON FUNCTION public.record_pickup_otp_failure_attempt(uuid, uuid, uuid, text)
IS 'Locks a pickup OTP and records exactly one failed verification attempt.';

COMMENT ON FUNCTION public.complete_pickup_otp_verification(uuid, uuid, uuid, text)
IS 'Atomically consumes the assigned driver pickup OTP and advances the order to picked up.';


-- ---------------------------------------------------------------------------
-- SOURCE: 21_20260910017000_atomic_facility_processing_stages.sql
-- ---------------------------------------------------------------------------

-- Keep processing-stage authorization, sequence validation, and mutations in
-- one database transaction. The existing facility sequence trigger remains
-- the authority for stage ordering and delegates order transitions to C2.

CREATE OR REPLACE FUNCTION public.start_facility_processing_atomic(
    p_order_id uuid,
    p_performed_by uuid,
    p_process_type text,
    p_machine_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_previous public.facility_order_operations%ROWTYPE;
    v_machine public.facility_machines%ROWTYPE;
    v_operation public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Order and facility operator are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_process_type IS NULL
       OR p_process_type NOT IN (
            'washing',
            'drying',
            'ironing',
            'folding',
            'packaging'
       ) THEN
        RAISE EXCEPTION 'Unsupported facility processing stage: %',
            coalesce(p_process_type, '<null>')
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.facility_id IS NULL THEN
        RAISE EXCEPTION 'Order has no assigned facility'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status NOT IN (
        'verification'::public.order_status,
        'processing'::public.order_status,
        'rework_required'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Processing is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_performed_by
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT operation.*
    INTO v_previous
    FROM public.facility_order_operations AS operation
    WHERE operation.order_id = p_order_id
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility operation not found for order %', p_order_id
            USING ERRCODE = '23514';
    END IF;

    IF p_machine_id IS NOT NULL THEN
        SELECT machine.*
        INTO v_machine
        FROM public.facility_machines AS machine
        WHERE machine.id = p_machine_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Machine % not found', p_machine_id
                USING ERRCODE = 'P0002';
        END IF;

        IF v_machine.facility_id IS DISTINCT FROM v_order.facility_id THEN
            RAISE EXCEPTION 'Machine belongs to another facility'
                USING ERRCODE = '42501';
        END IF;

        IF v_machine.status NOT IN (
            'active'::public.machine_status,
            'idle'::public.machine_status
        ) THEN
            RAISE EXCEPTION 'Machine is not available: %', v_machine.status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    INSERT INTO public.facility_order_operations (
        order_id,
        facility_id,
        current_status,
        operation_type,
        performed_by,
        machine_id,
        started_at,
        completed_at
    )
    VALUES (
        p_order_id,
        v_order.facility_id,
        p_process_type::public.facility_operation_status,
        p_process_type,
        p_performed_by,
        p_machine_id,
        v_now,
        NULL
    )
    RETURNING * INTO v_operation;

    RETURN to_jsonb(v_operation) || jsonb_build_object(
        'operationId', v_operation.id,
        'previousFacilityStatus', v_previous.current_status::text,
        'facilityStatus', p_process_type,
        'orderStatus', 'processing'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_facility_processing_atomic(
    p_operation_id uuid,
    p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_operation public.facility_order_operations%ROWTYPE;
    v_completed public.facility_order_operations%ROWTYPE;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_operation_id IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Facility operation and operator are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    JOIN public.facility_order_operations AS target
      ON target.order_id = o.id
    WHERE target.id = p_operation_id
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility operation % not found', p_operation_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.current_status <> 'processing'::public.order_status THEN
        RAISE EXCEPTION 'Processing completion is not allowed while order is %',
            v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.facility_employees AS employee
        WHERE employee.profile_id = p_performed_by
          AND employee.facility_id = v_order.facility_id
          AND employee.is_active
    ) THEN
        RAISE EXCEPTION 'Active facility employee access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT operation.*
    INTO v_operation
    FROM public.facility_order_operations AS operation
    WHERE operation.order_id = v_order.id
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_operation.id IS DISTINCT FROM p_operation_id THEN
        RAISE EXCEPTION 'Only the current facility stage can be completed'
            USING ERRCODE = '23514';
    END IF;

    IF v_operation.operation_type NOT IN (
        'washing',
        'drying',
        'ironing',
        'folding',
        'packaging'
    )
       OR v_operation.current_status::text IS DISTINCT FROM
          v_operation.operation_type THEN
        RAISE EXCEPTION 'Facility status % is not an active processing stage',
            v_operation.current_status
            USING ERRCODE = '23514';
    END IF;

    IF v_operation.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Processing stage is already completed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.facility_order_operations
    SET
        performed_by = p_performed_by,
        completed_at = v_now
    WHERE id = p_operation_id
      AND completed_at IS NULL
    RETURNING * INTO v_completed;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facility processing stage changed concurrently'
            USING ERRCODE = '40001';
    END IF;

    RETURN to_jsonb(v_completed) || jsonb_build_object(
        'processingCompleted', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.start_facility_processing_atomic(
    uuid,
    uuid,
    text,
    uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_facility_processing_atomic(
    uuid,
    uuid,
    text,
    uuid
)
TO service_role;

REVOKE ALL ON FUNCTION public.complete_facility_processing_atomic(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_facility_processing_atomic(uuid, uuid)
TO service_role;

COMMENT ON FUNCTION public.start_facility_processing_atomic(
    uuid,
    uuid,
    text,
    uuid
)
IS 'Atomically validates and starts the next facility processing stage; the facility sequence trigger remains the C2 transition authority.';

COMMENT ON FUNCTION public.complete_facility_processing_atomic(uuid, uuid)
IS 'Atomically marks the current facility processing stage complete using completed_at.';


-- ---------------------------------------------------------------------------
-- SOURCE: 22_20260910019000_atomic_payment_provider_lifecycle.sql
-- ---------------------------------------------------------------------------

-- Keep payment confirmation, webhook replay handling, and refund accounting
-- transactionally consistent. Provider network calls remain in Nest; these
-- service-role-only functions own the Bright & White database effects.

ALTER TABLE public.payment_webhook_events
ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.payment_transactions
        WHERE payment_order_id IS NOT NULL
          AND transaction_type IS NOT NULL
          AND provider_reference IS NOT NULL
        GROUP BY payment_order_id, transaction_type, provider_reference
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate provider payment transactions must be reconciled before payment lifecycle hardening'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payment_orders
        WHERE status IN ('created', 'authorized', 'paid')
        GROUP BY order_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate active payment orders must be reconciled before payment lifecycle hardening'
            USING ERRCODE = '23505';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_transactions_provider_reference
ON public.payment_transactions (
    payment_order_id,
    transaction_type,
    provider_reference
)
WHERE payment_order_id IS NOT NULL
  AND transaction_type IS NOT NULL
  AND provider_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_one_active_per_order
ON public.payment_orders (order_id)
WHERE status IN ('created', 'authorized', 'paid');

CREATE OR REPLACE FUNCTION public.record_captured_payment_atomic(
    p_payment_order_id uuid,
    p_provider_payment_id text,
    p_provider_status text,
    p_provider_payload jsonb DEFAULT '{}'::jsonb,
    p_actor_profile_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_order_status public.order_status;
    v_duplicate boolean;
    v_reason text;
    v_rows integer;
BEGIN
    IF p_payment_order_id IS NULL
       OR p_provider_payment_id IS NULL
       OR btrim(p_provider_payment_id) = ''
       OR p_provider_status <> 'captured' THEN
        RAISE EXCEPTION 'A captured provider payment is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT orders.current_status
    INTO v_order_status
    FROM public.orders
    WHERE orders.id = v_payment.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_payment.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_payment.status = 'paid'
       AND v_payment.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
        RAISE EXCEPTION 'Payment order is already paid by another payment'
            USING ERRCODE = '23514';
    END IF;

    IF v_payment.status NOT IN ('created', 'authorized', 'failed', 'paid') THEN
        RAISE EXCEPTION 'Payment cannot be captured while it is %', v_payment.status
            USING ERRCODE = '23514';
    END IF;

    v_duplicate := v_payment.status = 'paid';

    IF NOT v_duplicate AND v_order_status <> 'pending_payment'::public.order_status THEN
        RAISE EXCEPTION 'Order is not awaiting payment'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.payment_orders
    SET
        status = 'paid',
        provider_payment_id = p_provider_payment_id,
        paid_at = COALESCE(paid_at, transaction_timestamp()),
        updated_at = transaction_timestamp()
    WHERE id = v_payment.id;

    INSERT INTO public.payment_transactions (
        payment_order_id,
        order_id,
        provider,
        provider_order_id,
        provider_payment_id,
        transaction_type,
        amount,
        currency,
        status,
        provider_reference,
        provider_payload,
        verified_at,
        processed_at
    )
    VALUES (
        v_payment.id,
        v_payment.order_id,
        v_payment.provider,
        v_payment.provider_order_id,
        p_provider_payment_id,
        'payment',
        v_payment.amount,
        v_payment.currency,
        'paid',
        p_provider_payment_id,
        COALESCE(p_provider_payload, '{}'::jsonb)
            || jsonb_build_object('status', p_provider_status),
        transaction_timestamp(),
        transaction_timestamp()
    )
    ON CONFLICT (
        payment_order_id,
        transaction_type,
        provider_reference
    ) WHERE payment_order_id IS NOT NULL
          AND transaction_type IS NOT NULL
          AND provider_reference IS NOT NULL
    DO NOTHING;

    IF v_order_status = 'pending_payment'::public.order_status THEN
        v_reason := format(
            'Provider payment captured (%s)',
            p_provider_payment_id
        );

        PERFORM public.change_order_status(
            v_payment.order_id,
            'confirmed'::public.order_status,
            v_reason
        );

        IF p_actor_profile_id IS NOT NULL THEN
            UPDATE public.order_status_history AS history
            SET changed_by = p_actor_profile_id
            WHERE history.order_id = v_payment.order_id
              AND history.from_status = 'pending_payment'::public.order_status
              AND history.to_status = 'confirmed'::public.order_status
              AND history.reason = v_reason;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Payment status history was not recorded'
                    USING ERRCODE = '40001';
            END IF;
        END IF;

        v_order_status := 'confirmed'::public.order_status;
    END IF;

    RETURN jsonb_build_object(
        'paymentOrderId', v_payment.id,
        'orderId', v_payment.order_id,
        'orderStatus', v_order_status,
        'duplicate', v_duplicate
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_failed_payment_atomic(
    p_payment_order_id uuid,
    p_provider_payment_id text,
    p_provider_status text,
    p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_duplicate boolean;
BEGIN
    IF p_payment_order_id IS NULL
       OR p_provider_payment_id IS NULL
       OR btrim(p_provider_payment_id) = ''
       OR p_provider_status <> 'failed' THEN
        RAISE EXCEPTION 'A failed provider payment is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_payment.status = 'paid' THEN
        RAISE EXCEPTION 'A paid payment cannot be marked failed'
            USING ERRCODE = '23514';
    END IF;

    IF v_payment.status NOT IN ('created', 'authorized', 'failed') THEN
        RAISE EXCEPTION 'Payment cannot fail while it is %', v_payment.status
            USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.payment_transactions AS transaction
        WHERE transaction.payment_order_id = v_payment.id
          AND transaction.transaction_type = 'payment'
          AND transaction.provider_reference = p_provider_payment_id
    ) INTO v_duplicate;

    UPDATE public.payment_orders
    SET
        status = 'failed',
        provider_payment_id = p_provider_payment_id,
        updated_at = transaction_timestamp()
    WHERE id = v_payment.id;

    INSERT INTO public.payment_transactions (
        payment_order_id,
        order_id,
        provider,
        provider_order_id,
        provider_payment_id,
        transaction_type,
        amount,
        currency,
        status,
        provider_reference,
        provider_payload,
        verified_at,
        processed_at
    )
    VALUES (
        v_payment.id,
        v_payment.order_id,
        v_payment.provider,
        v_payment.provider_order_id,
        p_provider_payment_id,
        'payment',
        v_payment.amount,
        v_payment.currency,
        'failed',
        p_provider_payment_id,
        COALESCE(p_provider_payload, '{}'::jsonb)
            || jsonb_build_object('status', p_provider_status),
        transaction_timestamp(),
        transaction_timestamp()
    )
    ON CONFLICT (
        payment_order_id,
        transaction_type,
        provider_reference
    ) WHERE payment_order_id IS NOT NULL
          AND transaction_type IS NOT NULL
          AND provider_reference IS NOT NULL
    DO NOTHING;

    RETURN jsonb_build_object(
        'paymentOrderId', v_payment.id,
        'orderId', v_payment.order_id,
        'orderStatus', (
            SELECT orders.current_status
            FROM public.orders
            WHERE orders.id = v_payment.order_id
        ),
        'duplicate', v_duplicate
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_payment_webhook_event_atomic(
    p_provider text,
    p_external_event_id text,
    p_event_type text,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_event public.payment_webhook_events%ROWTYPE;
    v_claimed boolean := false;
    v_duplicate boolean := false;
BEGIN
    IF p_provider IS NULL OR btrim(p_provider) = ''
       OR p_external_event_id IS NULL OR btrim(p_external_event_id) = ''
       OR p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'Provider webhook identity is required'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_webhook_events (
        provider,
        external_event_id,
        provider_event_id,
        event_type,
        payload,
        processing_status,
        processing_started_at
    )
    VALUES (
        p_provider,
        p_external_event_id,
        p_external_event_id,
        p_event_type,
        COALESCE(p_payload, '{}'::jsonb),
        'processing',
        transaction_timestamp()
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_event;

    IF FOUND THEN
        v_claimed := true;
    ELSE
        SELECT event.*
        INTO v_event
        FROM public.payment_webhook_events AS event
        WHERE event.provider = p_provider
          AND event.external_event_id = p_external_event_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Webhook event identity conflicts with another provider'
                USING ERRCODE = '23505';
        END IF;

        IF v_event.processing_status = 'processed' THEN
            v_duplicate := true;
        ELSIF v_event.processing_status IN ('failed', 'pending')
           OR (
               v_event.processing_status = 'processing'
               AND COALESCE(
                   v_event.processing_started_at,
                   v_event.created_at
               ) <= statement_timestamp() - interval '5 minutes'
           ) THEN
            UPDATE public.payment_webhook_events
            SET
                event_type = p_event_type,
                payload = COALESCE(p_payload, '{}'::jsonb),
                processing_status = 'processing',
                processing_started_at = transaction_timestamp(),
                processed_at = NULL
            WHERE id = v_event.id
            RETURNING * INTO v_event;
            v_claimed := true;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'eventId', v_event.id,
        'claimed', v_claimed,
        'duplicate', v_duplicate,
        'processingStatus', v_event.processing_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_payment_webhook_event_atomic(
    p_event_id uuid,
    p_succeeded boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.payment_webhook_events
    SET
        processing_status = CASE WHEN p_succeeded THEN 'processed' ELSE 'failed' END,
        processed_at = CASE WHEN p_succeeded THEN transaction_timestamp() ELSE NULL END,
        processing_started_at = NULL
    WHERE id = p_event_id
      AND processing_status = 'processing';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Webhook event is not being processed'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_refund_approval_atomic(
    p_refund_id uuid,
    p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_refund public.refund_requests%ROWTYPE;
    v_payment public.payment_orders%ROWTYPE;
    v_committed numeric(12,2);
    v_claimed boolean := false;
BEGIN
    IF p_refund_id IS NULL OR p_admin_id IS NULL THEN
        RAISE EXCEPTION 'Refund and administrator are required'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profile_roles AS profile_role
        JOIN public.roles AS role ON role.id = profile_role.role_id
        WHERE profile_role.profile_id = p_admin_id
          AND role.code = 'admin'
    ) THEN
        RAISE EXCEPTION 'Administrator access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT refund.*
    INTO v_refund
    FROM public.refund_requests AS refund
    WHERE refund.id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund request % not found', p_refund_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = v_refund.payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order for refund was not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_payment.status NOT IN ('paid', 'partially_refunded')
       OR v_payment.provider_payment_id IS NULL THEN
        RAISE EXCEPTION 'Only a captured payment can be refunded'
            USING ERRCODE = '23514';
    END IF;

    IF v_refund.status = 'requested' THEN
        SELECT COALESCE(sum(other.amount), 0)
        INTO v_committed
        FROM public.refund_requests AS other
        WHERE other.payment_order_id = v_payment.id
          AND other.id <> v_refund.id
          AND other.status IN ('approved', 'processing', 'completed');

        IF v_refund.amount + v_committed > v_payment.amount THEN
            RAISE EXCEPTION 'Refund exceeds the remaining captured amount'
                USING ERRCODE = '23514';
        END IF;

        UPDATE public.refund_requests
        SET
            status = 'approved',
            approved_by = p_admin_id,
            approved_at = COALESCE(approved_at, transaction_timestamp())
        WHERE id = v_refund.id
        RETURNING * INTO v_refund;

        v_claimed := true;
    ELSIF v_refund.status NOT IN ('approved', 'processing', 'completed') THEN
        RAISE EXCEPTION 'Refund cannot be approved while it is %', v_refund.status
            USING ERRCODE = '23514';
    END IF;

    RETURN jsonb_build_object(
        'refundId', v_refund.id,
        'paymentOrderId', v_payment.id,
        'providerPaymentId', v_payment.provider_payment_id,
        'amount', v_refund.amount,
        'currency', v_payment.currency,
        'claimed', v_claimed,
        'status', v_refund.status,
        'providerRefundId', v_refund.provider_refund_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_provider_refund_atomic(
    p_refund_id uuid,
    p_provider_refund_id text,
    p_provider_status text,
    p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_refund public.refund_requests%ROWTYPE;
    v_payment public.payment_orders%ROWTYPE;
    v_target_status public.refund_status;
    v_duplicate boolean;
    v_refunded numeric(12,2);
BEGIN
    IF p_refund_id IS NULL
       OR p_provider_refund_id IS NULL
       OR btrim(p_provider_refund_id) = '' THEN
        RAISE EXCEPTION 'Provider refund identity is required'
            USING ERRCODE = '22023';
    END IF;

    v_target_status := CASE
        WHEN p_provider_status IN ('processed', 'completed') THEN 'completed'::public.refund_status
        WHEN p_provider_status = 'failed' THEN 'failed'::public.refund_status
        ELSE 'processing'::public.refund_status
    END;

    SELECT refund.*
    INTO v_refund
    FROM public.refund_requests AS refund
    WHERE refund.id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund request % not found', p_refund_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_refund.status NOT IN ('approved', 'processing', 'completed', 'failed') THEN
        RAISE EXCEPTION 'Refund has not been claimed for provider processing'
            USING ERRCODE = '23514';
    END IF;

    IF v_refund.provider_refund_id IS NOT NULL
       AND v_refund.provider_refund_id <> p_provider_refund_id THEN
        RAISE EXCEPTION 'Refund already has another provider reference'
            USING ERRCODE = '23514';
    END IF;

    v_duplicate := v_refund.provider_refund_id = p_provider_refund_id
        AND v_refund.status = v_target_status;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = v_refund.payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order for refund was not found'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.refund_requests
    SET
        status = v_target_status,
        provider_refund_id = p_provider_refund_id,
        processed_at = CASE
            WHEN v_target_status IN ('completed', 'failed') THEN
                COALESCE(processed_at, transaction_timestamp())
            ELSE processed_at
        END
    WHERE id = v_refund.id;

    IF v_target_status = 'completed' THEN
        INSERT INTO public.payment_transactions (
            payment_order_id,
            order_id,
            provider,
            provider_order_id,
            provider_payment_id,
            transaction_type,
            amount,
            currency,
            status,
            provider_reference,
            provider_payload,
            verified_at,
            processed_at
        )
        VALUES (
            v_payment.id,
            v_payment.order_id,
            v_payment.provider,
            v_payment.provider_order_id,
            v_payment.provider_payment_id,
            'refund',
            v_refund.amount,
            v_payment.currency,
            'refunded',
            p_provider_refund_id,
            COALESCE(p_provider_payload, '{}'::jsonb)
                || jsonb_build_object('status', p_provider_status),
            transaction_timestamp(),
            transaction_timestamp()
        )
        ON CONFLICT (
            payment_order_id,
            transaction_type,
            provider_reference
        ) WHERE payment_order_id IS NOT NULL
              AND transaction_type IS NOT NULL
              AND provider_reference IS NOT NULL
        DO NOTHING;

        SELECT COALESCE(sum(refund.amount), 0)
        INTO v_refunded
        FROM public.refund_requests AS refund
        WHERE refund.payment_order_id = v_payment.id
          AND refund.status = 'completed';

        UPDATE public.payment_orders
        SET
            status = CASE
                WHEN v_refunded >= amount THEN 'refunded'
                ELSE 'partially_refunded'
            END,
            updated_at = transaction_timestamp()
        WHERE id = v_payment.id;

        INSERT INTO public.financial_audit_logs (
            actor_profile_id,
            action,
            entity_type,
            entity_id,
            amount,
            metadata
        )
        SELECT
            v_refund.approved_by,
            'refund_approved',
            'refund_request',
            v_refund.id,
            v_refund.amount,
            jsonb_build_object(
                'providerRefundId', p_provider_refund_id,
                'providerStatus', p_provider_status
            )
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.financial_audit_logs AS audit
            WHERE audit.action = 'refund_approved'
              AND audit.entity_type = 'refund_request'
              AND audit.entity_id = v_refund.id
        );
    END IF;

    RETURN jsonb_build_object(
        'refundId', v_refund.id,
        'paymentOrderId', v_payment.id,
        'providerRefundId', p_provider_refund_id,
        'status', v_target_status,
        'duplicate', v_duplicate
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_refund_provider_uncertain_atomic(
    p_refund_id uuid,
    p_provider_refund_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_provider_refund_id IS NOT NULL
       AND btrim(p_provider_refund_id) = '' THEN
        RAISE EXCEPTION 'Provider refund identity cannot be blank'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.refund_requests
    SET
        status = 'processing',
        provider_refund_id = COALESCE(
            provider_refund_id,
            p_provider_refund_id
        )
    WHERE id = p_refund_id
      AND status IN ('approved', 'processing')
      AND (
          provider_refund_id IS NULL
          OR p_provider_refund_id IS NULL
          OR provider_refund_id = p_provider_refund_id
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund is not awaiting its provider result'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_captured_payment_atomic(uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_failed_payment_atomic(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_payment_webhook_event_atomic(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_payment_webhook_event_atomic(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_refund_approval_atomic(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_provider_refund_atomic(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_provider_uncertain_atomic(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_captured_payment_atomic(uuid, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_failed_payment_atomic(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_payment_webhook_event_atomic(text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_payment_webhook_event_atomic(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_refund_approval_atomic(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_refund_atomic(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_provider_uncertain_atomic(uuid, text) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 23_20260912090000_seed_bright_white_customer_catalog.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- =========================================================
-- BRIGHT & WHITE - REAL B2C CUSTOMER CATALOGUE
-- =========================================================

-- Hide the old runtime integration fixture from customers.
-- Keep the row for historical/test-reference safety.
UPDATE public.services
SET is_active = false
WHERE name = 'Runtime Garment Care';


-- =========================================================
-- 1. CUSTOMER-FACING CATEGORIES
-- =========================================================

INSERT INTO public.service_categories (
  name,
  description,
  is_active
)
VALUES
  ('Wash & Fold', 'Everyday laundry charged by weight', true),
  ('Wash & Steam Iron', 'Washing with professional steam ironing', true),
  ('Premium Laundry', 'Premium garment washing and finishing', true),
  ('Wash & Iron', 'Item-wise washing and ironing', true),
  ('Steam Ironing', 'Professional steam ironing', true),
  ('Dry Cleaning', 'Professional dry-cleaning services', true),
  ('Household & Linen Care', 'Bedding, linen, curtains and household laundry', true),
  ('Shoe Cleaning', 'Professional shoe cleaning and restoration', true),
  ('Add-On Services', 'Optional garment and laundry care add-ons', true)
ON CONFLICT (name)
DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true;


-- =========================================================
-- 2. TEMPORARY CATALOGUE SOURCE
-- =========================================================

-- FIXED for Supabase SQL Editor: TEMP ... ON COMMIT DROP vanishes between statements.
DROP TABLE IF EXISTS public.bw_catalog_seed;
CREATE TABLE public.bw_catalog_seed (
  category_name text NOT NULL,
  service_name text NOT NULL,
  description text,
  pricing_unit text NOT NULL,
  price numeric(12,2)
);


INSERT INTO public.bw_catalog_seed (
  category_name,
  service_name,
  description,
  pricing_unit,
  price
)
VALUES

-- =========================================================
-- WASH & FOLD
-- =========================================================

('Wash & Fold',
 'Wash & Fold',
 'Everyday garments',
 'kg',
 89.00),

-- =========================================================
-- WASH & STEAM IRON
-- =========================================================

('Wash & Steam Iron',
 'Wash & Steam Iron',
 'Most popular',
 'kg',
 119.00),

-- =========================================================
-- PREMIUM LAUNDRY
-- =========================================================

('Premium Laundry',
 'Premium Laundry',
 'Premium garment care',
 'kg',
 149.00),

-- =========================================================
-- WASH & IRON - MEN
-- =========================================================

('Wash & Iron','Men - Shirt',NULL,'piece',35.00),
('Wash & Iron','Men - T-Shirt',NULL,'piece',30.00),
('Wash & Iron','Men - Polo T-Shirt',NULL,'piece',35.00),
('Wash & Iron','Men - Trouser',NULL,'piece',40.00),
('Wash & Iron','Men - Jeans',NULL,'piece',45.00),
('Wash & Iron','Men - Chinos',NULL,'piece',40.00),
('Wash & Iron','Men - Shorts',NULL,'piece',30.00),
('Wash & Iron','Men - Track Pant',NULL,'piece',35.00),
('Wash & Iron','Men - Joggers',NULL,'piece',35.00),
('Wash & Iron','Men - Kurta',NULL,'piece',50.00),
('Wash & Iron','Men - Pyjama',NULL,'piece',30.00),
('Wash & Iron','Men - Kurta + Pyjama Set',NULL,'set',75.00),
('Wash & Iron','Men - Dhoti',NULL,'piece',50.00),
('Wash & Iron','Men - Silk Dhoti',NULL,'piece',75.00),
('Wash & Iron','Men - Hoodie',NULL,'piece',70.00),
('Wash & Iron','Men - Sweater',NULL,'piece',80.00),

-- =========================================================
-- WASH & IRON - WOMEN
-- =========================================================

('Wash & Iron','Women - Top',NULL,'piece',35.00),
('Wash & Iron','Women - T-Shirt',NULL,'piece',30.00),
('Wash & Iron','Women - Shirt',NULL,'piece',35.00),
('Wash & Iron','Women - Kurti',NULL,'piece',50.00),
('Wash & Iron','Women - Long Kurti',NULL,'piece',60.00),
('Wash & Iron','Women - Leggings',NULL,'piece',30.00),
('Wash & Iron','Women - Palazzo',NULL,'piece',40.00),
('Wash & Iron','Women - Salwar',NULL,'piece',40.00),
('Wash & Iron','Women - Dupatta',NULL,'piece',30.00),
('Wash & Iron','Women - Blouse',NULL,'piece',40.00),
('Wash & Iron','Women - Skirt',NULL,'piece',50.00),
('Wash & Iron','Women - Short Dress',NULL,'piece',80.00),
('Wash & Iron','Women - Long Dress',NULL,'piece',120.00),
('Wash & Iron','Women - Gown',NULL,'piece',180.00),
('Wash & Iron','Women - Cotton Saree',NULL,'piece',100.00),
('Wash & Iron','Women - Silk Saree',NULL,'piece',150.00),

-- =========================================================
-- STEAM IRONING
-- =========================================================

('Steam Ironing','Men - Shirt',NULL,'piece',15.00),
('Steam Ironing','Men - T-Shirt',NULL,'piece',15.00),
('Steam Ironing','Men - Trouser',NULL,'piece',20.00),
('Steam Ironing','Men - Jeans',NULL,'piece',20.00),
('Steam Ironing','Men - Kurta',NULL,'piece',25.00),
('Steam Ironing','Men - Pyjama',NULL,'piece',15.00),

('Steam Ironing','Women - Blouse',NULL,'piece',20.00),
('Steam Ironing','Women - Saree',NULL,'piece',50.00),
('Steam Ironing','Women - Heavy Saree',NULL,'piece',80.00),
('Steam Ironing','Women - Dress',NULL,'piece',40.00),
('Steam Ironing','Women - Long Dress',NULL,'piece',60.00),

('Steam Ironing','Premium - Blazer',NULL,'piece',60.00),
('Steam Ironing','Premium - Suit',NULL,'set',100.00),

('Steam Ironing','Household - Bedsheet',NULL,'piece',40.00),

-- =========================================================
-- DRY CLEANING - MEN
-- =========================================================

('Dry Cleaning','Men - Shirt',NULL,'piece',99.00),
('Dry Cleaning','Men - Premium / Party Shirt',NULL,'piece',129.00),
('Dry Cleaning','Men - T-Shirt',NULL,'piece',89.00),
('Dry Cleaning','Men - Trouser',NULL,'piece',110.00),
('Dry Cleaning','Men - Jeans',NULL,'piece',120.00),
('Dry Cleaning','Men - Chinos',NULL,'piece',110.00),
('Dry Cleaning','Men - Shorts',NULL,'piece',80.00),
('Dry Cleaning','Men - Kurta',NULL,'piece',130.00),
('Dry Cleaning','Men - Heavy Kurta',NULL,'piece',180.00),
('Dry Cleaning','Men - Pyjama',NULL,'piece',80.00),
('Dry Cleaning','Men - Kurta + Pyjama',NULL,'set',190.00),
('Dry Cleaning','Men - Waistcoat',NULL,'piece',150.00),
('Dry Cleaning','Men - Blazer',NULL,'piece',249.00),
('Dry Cleaning','Men - Coat',NULL,'piece',299.00),
('Dry Cleaning','Men - Jacket',NULL,'piece',249.00),
('Dry Cleaning','Men - Leather Jacket','Special care','piece',799.00),
('Dry Cleaning','Men - Sweater',NULL,'piece',149.00),
('Dry Cleaning','Men - Hoodie',NULL,'piece',149.00),
('Dry Cleaning','Men - 2-Piece Suit',NULL,'set',449.00),
('Dry Cleaning','Men - 3-Piece Suit',NULL,'set',549.00),
('Dry Cleaning','Men - Basic Sherwani',NULL,'piece',499.00),
('Dry Cleaning','Men - Heavy Sherwani',NULL,'piece',799.00),

-- =========================================================
-- DRY CLEANING - WOMEN
-- =========================================================

('Dry Cleaning','Women - Top',NULL,'piece',99.00),
('Dry Cleaning','Women - Kurti',NULL,'piece',129.00),
('Dry Cleaning','Women - Long Kurti',NULL,'piece',159.00),
('Dry Cleaning','Women - Palazzo',NULL,'piece',110.00),
('Dry Cleaning','Women - Salwar',NULL,'piece',110.00),
('Dry Cleaning','Women - Dupatta',NULL,'piece',99.00),
('Dry Cleaning','Women - Basic Blouse',NULL,'piece',99.00),
('Dry Cleaning','Women - Heavy Work Blouse',NULL,'piece',199.00),
('Dry Cleaning','Women - Cotton Saree',NULL,'piece',199.00),
('Dry Cleaning','Women - Silk Saree',NULL,'piece',299.00),
('Dry Cleaning','Women - Designer Saree',NULL,'piece',399.00),
('Dry Cleaning','Women - Heavy Work Saree',NULL,'piece',599.00),
('Dry Cleaning','Women - Short Dress',NULL,'piece',199.00),
('Dry Cleaning','Women - Long Dress',NULL,'piece',299.00),
('Dry Cleaning','Women - Gown',NULL,'piece',399.00),
('Dry Cleaning','Women - Heavy Work Gown',NULL,'piece',699.00),
('Dry Cleaning','Women - Skirt',NULL,'piece',149.00),
('Dry Cleaning','Women - Basic Lehenga',NULL,'piece',499.00),
('Dry Cleaning','Women - Heavy Lehenga',NULL,'piece',999.00),
('Dry Cleaning',
 'Women - Lehenga + Blouse + Dupatta',
 'Starting price',
 'set',
 1199.00),
('Dry Cleaning','Women - Anarkali',NULL,'piece',349.00),
('Dry Cleaning','Women - Heavy Anarkali',NULL,'piece',599.00),

-- =========================================================
-- HOUSEHOLD & LINEN CARE
-- =========================================================

('Household & Linen Care',
 'Single Bedsheet - Wash',
 NULL,
 'piece',
 40.00),

('Household & Linen Care',
 'Single Bedsheet - Wash & Iron',
 NULL,
 'piece',
 70.00),

('Household & Linen Care',
 'Double Bedsheet - Wash',
 NULL,
 'piece',
 60.00),

('Household & Linen Care',
 'Double Bedsheet - Wash & Iron',
 NULL,
 'piece',
 100.00),

('Household & Linen Care',
 'Pillow Cover - Wash',
 NULL,
 'piece',
 15.00),

('Household & Linen Care',
 'Pillow Cover - Wash & Iron',
 NULL,
 'piece',
 25.00),

('Household & Linen Care',
 'Towel - Wash',
 NULL,
 'piece',
 25.00),

('Household & Linen Care',
 'Towel - Wash & Iron',
 NULL,
 'piece',
 40.00),

('Household & Linen Care',
 'Pillow Cleaning',
 NULL,
 'piece',
 100.00),

('Household & Linen Care',
 'Single Blanket',
 NULL,
 'piece',
 250.00),

('Household & Linen Care',
 'Double Blanket',
 NULL,
 'piece',
 350.00),

('Household & Linen Care',
 'Single Quilt',
 NULL,
 'piece',
 350.00),

('Household & Linen Care',
 'Double Quilt',
 NULL,
 'piece',
 450.00),

('Household & Linen Care',
 'Duvet',
 NULL,
 'piece',
 400.00),

('Household & Linen Care',
 'Small Curtain',
 NULL,
 'piece',
 50.00),

('Household & Linen Care',
 'Large Curtain',
 NULL,
 'piece',
 80.00),

('Household & Linen Care',
 'Small Carpet',
 NULL,
 'piece',
 500.00),

-- Quote-based item intentionally has NO service_prices record.
('Household & Linen Care',
 'Large Carpet',
 'Price after inspection',
 'quote',
 NULL),

-- =========================================================
-- SHOE CLEANING
-- =========================================================

('Shoe Cleaning','Basic Shoe Cleaning',NULL,'pair',199.00),
('Shoe Cleaning','Sports Shoes',NULL,'pair',249.00),
('Shoe Cleaning','Sneakers',NULL,'pair',299.00),
('Shoe Cleaning','Premium Sneakers',NULL,'pair',399.00),
('Shoe Cleaning','Leather Shoes',NULL,'pair',399.00),
('Shoe Cleaning','Suede Shoes',NULL,'pair',499.00),
('Shoe Cleaning','Boots',NULL,'pair',599.00),
('Shoe Cleaning','Shoe Whitening',NULL,'pair',249.00),
('Shoe Cleaning','Deodorization','Add-on','pair',99.00),
('Shoe Cleaning',
 'Premium Restoration',
 'Starting price',
 'pair',
 699.00),

-- =========================================================
-- ADD-ON SERVICES
-- =========================================================

('Add-On Services','Fabric Softener',NULL,'kg',10.00),
('Add-On Services','Sanitization',NULL,'kg',15.00),
('Add-On Services','Antibacterial Wash',NULL,'kg',15.00),
('Add-On Services','Whitening Treatment',NULL,'item',20.00),
('Add-On Services','Basic Stain Removal',NULL,'item',30.00),
('Add-On Services',
 'Heavy Stain Removal',
 'Starting price',
 'item',
 75.00),
('Add-On Services','Starching',NULL,'item',20.00),
('Add-On Services','Premium Packaging',NULL,'order',20.00),
('Add-On Services','Individual Garment Packing',NULL,'item',10.00),
('Add-On Services','Hanger Packing',NULL,'item',15.00);


-- =========================================================
-- 3. UPDATE SERVICES THAT ALREADY EXIST
-- =========================================================

UPDATE public.services s
SET
  description = c.description,
  pricing_unit = c.pricing_unit,
  is_active = true
FROM public.bw_catalog_seed c
JOIN public.service_categories sc
  ON sc.name = c.category_name
WHERE
  s.category_id = sc.id
  AND s.name = c.service_name;


-- =========================================================
-- 4. INSERT SERVICES THAT DO NOT EXIST
-- =========================================================

INSERT INTO public.services (
  category_id,
  name,
  description,
  pricing_unit,
  is_active
)
SELECT
  sc.id,
  c.service_name,
  c.description,
  c.pricing_unit,
  true
FROM public.bw_catalog_seed c
JOIN public.service_categories sc
  ON sc.name = c.category_name
WHERE NOT EXISTS (
  SELECT 1
  FROM public.services s
  WHERE
    s.category_id = sc.id
    AND s.name = c.service_name
);


-- =========================================================
-- 5. CLOSE EXISTING GLOBAL PRICES FOR THIS CATALOGUE
-- =========================================================

UPDATE public.service_prices sp
SET effective_to = CURRENT_TIMESTAMP
FROM
  public.services s,
  public.service_categories sc,
  public.bw_catalog_seed c
WHERE
  sp.service_id = s.id
  AND s.category_id = sc.id
  AND sc.name = c.category_name
  AND s.name = c.service_name
  AND sp.facility_id IS NULL
  AND sp.effective_to IS NULL;


-- =========================================================
-- 6. INSERT CURRENT GLOBAL CUSTOMER PRICES
-- =========================================================

INSERT INTO public.service_prices (
  service_id,
  facility_id,
  price,
  effective_from,
  effective_to
)
SELECT
  s.id,
  NULL,
  c.price,
  CURRENT_TIMESTAMP,
  NULL
FROM public.bw_catalog_seed c
JOIN public.service_categories sc
  ON sc.name = c.category_name
JOIN public.services s
  ON s.category_id = sc.id
 AND s.name = c.service_name
WHERE c.price IS NOT NULL;


COMMIT;


-- ---------------------------------------------------------------------------
-- SOURCE: 24_20260912113000_add_order_pickup_schedule.sql
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS pickup_scheduled_at timestamptz;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS pickup_slot_label text;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_scheduled_at
ON public.orders(pickup_scheduled_at)
WHERE pickup_scheduled_at IS NOT NULL;

COMMIT;


-- ---------------------------------------------------------------------------
-- SOURCE: 25_20260915100000_atomic_customer_cancellation_refunds.sql
-- ---------------------------------------------------------------------------

-- Keep customer cancellation and refund requests transactionally consistent.
-- Provider calls remain in Nest; these service-role-only functions own the
-- Bright & White database effects and preserve change_order_status as the
-- canonical order lifecycle transition mechanism.

ALTER TABLE public.refund_requests
ADD COLUMN IF NOT EXISTS is_cancellation_refund boolean NOT NULL DEFAULT false;

ALTER TABLE public.refund_requests
DROP CONSTRAINT IF EXISTS refund_requests_cancellation_payment_required;

ALTER TABLE public.refund_requests
ADD CONSTRAINT refund_requests_cancellation_payment_required
CHECK (NOT is_cancellation_refund OR payment_order_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_requests_one_cancellation_per_payment
ON public.refund_requests (payment_order_id)
WHERE is_cancellation_refund;

-- A provider order may only be registered while its application order is
-- awaiting payment. Locking the order on insert closes the race where a
-- customer cancellation commits while provider order creation is in flight.
CREATE OR REPLACE FUNCTION public.validate_payment_order_insert_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
BEGIN
    SELECT orders.current_status
    INTO v_order_status
    FROM public.orders
    WHERE orders.id = NEW.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', NEW.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'pending_payment'::public.order_status THEN
        RAISE EXCEPTION 'Order is not awaiting payment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_order_insert_lifecycle
ON public.payment_orders;

CREATE TRIGGER trg_validate_payment_order_insert_lifecycle
BEFORE INSERT ON public.payment_orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_payment_order_insert_lifecycle();

CREATE OR REPLACE FUNCTION public.request_refund_atomic(
    p_payment_order_id uuid,
    p_requested_by uuid,
    p_amount numeric,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_refund public.refund_requests%ROWTYPE;
    v_committed numeric(12,2);
    v_reason text;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));

    IF p_payment_order_id IS NULL OR p_requested_by IS NULL THEN
        RAISE EXCEPTION 'Payment and requester are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount is invalid'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Refund reason must contain between 3 and 500 characters'
            USING ERRCODE = '22023';
    END IF;

    -- Every refund request for a payment serializes on this row. This makes
    -- the remaining-balance calculation safe under concurrent requests.
    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT orders.*
    INTO v_order
    FROM public.orders
    WHERE orders.id = v_payment.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_payment.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customers AS customer
        WHERE customer.id = v_order.customer_id
          AND customer.profile_id = p_requested_by
    ) THEN
        RAISE EXCEPTION 'Payment belongs to another customer'
            USING ERRCODE = '42501';
    END IF;

    IF v_payment.status NOT IN ('paid', 'partially_refunded')
       OR v_payment.provider_payment_id IS NULL THEN
        RAISE EXCEPTION 'Only a captured payment can be refunded'
            USING ERRCODE = '23514';
    END IF;

    IF v_order.current_status NOT IN (
        'cancelled'::public.order_status,
        'claim_period_active'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Order is not eligible for a refund request'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(sum(refund.amount), 0)
    INTO v_committed
    FROM public.refund_requests AS refund
    WHERE refund.payment_order_id = v_payment.id
      AND refund.status IN (
          'requested'::public.refund_status,
          'under_review'::public.refund_status,
          'approved'::public.refund_status,
          'processing'::public.refund_status,
          'completed'::public.refund_status
      );

    IF p_amount + v_committed > v_payment.amount THEN
        RAISE EXCEPTION 'Refund exceeds the remaining captured amount'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.refund_requests (
        payment_order_id,
        requested_by,
        amount,
        reason,
        status,
        is_cancellation_refund
    )
    VALUES (
        v_payment.id,
        p_requested_by,
        p_amount,
        v_reason,
        'requested'::public.refund_status,
        false
    )
    RETURNING * INTO v_refund;

    RETURN to_jsonb(v_refund);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_customer_order_atomic(
    p_order_id uuid,
    p_profile_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_payment public.payment_orders%ROWTYPE;
    v_refund public.refund_requests%ROWTYPE;
    v_payment_id uuid;
    v_committed numeric(12,2) := 0;
    v_remaining numeric(12,2) := 0;
    v_reason text;
    v_history_reason text;
    v_duplicate boolean;
    v_refund_created boolean := false;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));

    IF p_order_id IS NULL OR p_profile_id IS NULL THEN
        RAISE EXCEPTION 'Order and customer profile are required'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Cancellation reason must contain between 3 and 500 characters'
            USING ERRCODE = '22023';
    END IF;

    -- Match payment capture/refund lock order whenever an existing payment is
    -- present: payment first, then order. A non-locking lookup is safe because
    -- the insert trigger above serializes a new provider order on the order row.
    SELECT payment.id
    INTO v_payment_id
    FROM public.payment_orders AS payment
    WHERE payment.order_id = p_order_id
    ORDER BY
        CASE payment.status
            WHEN 'paid' THEN 1
            WHEN 'partially_refunded' THEN 2
            WHEN 'refunded' THEN 3
            WHEN 'authorized' THEN 4
            WHEN 'created' THEN 5
            WHEN 'failed' THEN 6
            WHEN 'cancelled' THEN 7
            ELSE 8
        END,
        payment.created_at DESC
    LIMIT 1;

    IF v_payment_id IS NOT NULL THEN
        SELECT payment.*
        INTO v_payment
        FROM public.payment_orders AS payment
        WHERE payment.id = v_payment_id
        FOR UPDATE;
    END IF;

    SELECT orders.*
    INTO v_order
    FROM public.orders
    WHERE orders.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customers AS customer
        WHERE customer.id = v_order.customer_id
          AND customer.profile_id = p_profile_id
    ) THEN
        RAISE EXCEPTION 'Order belongs to another customer'
            USING ERRCODE = '42501';
    END IF;

    v_duplicate := v_order.current_status = 'cancelled'::public.order_status;

    IF NOT v_duplicate THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.order_status_transitions AS transition
            WHERE transition.from_status = v_order.current_status
              AND transition.to_status = 'cancelled'::public.order_status
        ) THEN
            RAISE EXCEPTION 'Order cannot be cancelled while it is %', v_order.current_status
                USING ERRCODE = '23514';
        END IF;

        v_history_reason := format('Customer cancellation: %s', v_reason);

        PERFORM public.change_order_status(
            p_order_id,
            'cancelled'::public.order_status,
            v_history_reason
        );

        UPDATE public.order_status_history AS history
        SET changed_by = p_profile_id
        WHERE history.id = (
            SELECT candidate.id
            FROM public.order_status_history AS candidate
            WHERE candidate.order_id = p_order_id
              AND candidate.from_status = v_order.current_status
              AND candidate.to_status = 'cancelled'::public.order_status
              AND candidate.reason = v_history_reason
            ORDER BY candidate.created_at DESC, candidate.id DESC
            LIMIT 1
        );
    END IF;

    -- Catch a provider-order insert that committed before the order lock was
    -- obtained but after the initial lookup.
    IF v_payment_id IS NULL THEN
        SELECT payment.*
        INTO v_payment
        FROM public.payment_orders AS payment
        WHERE payment.order_id = p_order_id
        ORDER BY
            CASE payment.status
                WHEN 'paid' THEN 1
                WHEN 'partially_refunded' THEN 2
                WHEN 'refunded' THEN 3
                WHEN 'authorized' THEN 4
                WHEN 'created' THEN 5
                WHEN 'failed' THEN 6
                WHEN 'cancelled' THEN 7
                ELSE 8
            END,
            payment.created_at DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF v_payment.id IS NULL THEN
        RETURN jsonb_build_object(
            'orderId', p_order_id,
            'orderStatus', 'cancelled',
            'duplicate', v_duplicate,
            'paymentOrderId', NULL,
            'refundRequestId', NULL,
            'refundStatus', NULL,
            'refundAmount', 0,
            'refundCreated', false
        );
    END IF;

    IF v_payment.status IN ('created', 'authorized', 'failed') THEN
        UPDATE public.payment_orders
        SET
            status = 'cancelled',
            updated_at = transaction_timestamp()
        WHERE id = v_payment.id;
    ELSIF v_payment.status IN ('paid', 'partially_refunded', 'refunded')
          AND v_payment.provider_payment_id IS NOT NULL THEN
        SELECT refund.*
        INTO v_refund
        FROM public.refund_requests AS refund
        WHERE refund.payment_order_id = v_payment.id
          AND refund.is_cancellation_refund
        LIMIT 1;

        IF v_refund.id IS NULL THEN
            SELECT COALESCE(sum(refund.amount), 0)
            INTO v_committed
            FROM public.refund_requests AS refund
            WHERE refund.payment_order_id = v_payment.id
              AND refund.status IN (
                  'requested'::public.refund_status,
                  'under_review'::public.refund_status,
                  'approved'::public.refund_status,
                  'processing'::public.refund_status,
                  'completed'::public.refund_status
              );

            v_remaining := GREATEST(v_payment.amount - v_committed, 0);

            IF v_remaining > 0 THEN
                INSERT INTO public.refund_requests (
                    payment_order_id,
                    requested_by,
                    amount,
                    reason,
                    status,
                    is_cancellation_refund
                )
                VALUES (
                    v_payment.id,
                    p_profile_id,
                    v_remaining,
                    v_reason,
                    'requested'::public.refund_status,
                    true
                )
                ON CONFLICT (payment_order_id)
                    WHERE is_cancellation_refund
                DO NOTHING
                RETURNING * INTO v_refund;

                IF v_refund.id IS NULL THEN
                    SELECT refund.*
                    INTO v_refund
                    FROM public.refund_requests AS refund
                    WHERE refund.payment_order_id = v_payment.id
                      AND refund.is_cancellation_refund
                    LIMIT 1;
                ELSE
                    v_refund_created := true;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'orderStatus', 'cancelled',
        'duplicate', v_duplicate,
        'paymentOrderId', v_payment.id,
        'refundRequestId', v_refund.id,
        'refundStatus', v_refund.status,
        'refundAmount', COALESCE(v_refund.amount, 0),
        'refundCreated', v_refund_created
    );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_payment_order_insert_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_customer_order_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_customer_order_atomic(uuid, uuid, text) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 26_20260915120000_add_customer_order_claims.sql
-- ---------------------------------------------------------------------------

-- Customer claims are separate from facility-authored damage/missing-item
-- reports. The backend creates claims and signed Storage upload URLs with the
-- service role; no direct anonymous or authenticated table access is granted.

CREATE TABLE IF NOT EXISTS public.customer_order_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
    submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    client_request_id uuid NOT NULL,
    claim_type text NOT NULL CHECK (
        claim_type IN ('damage', 'missing_item', 'quality', 'delivery', 'other')
    ),
    description text NOT NULL CHECK (
        length(btrim(description)) BETWEEN 10 AND 4000
    ),
    status text NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('submitted', 'under_review', 'approved', 'rejected', 'resolved')
    ),
    resolution_notes text,
    reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (customer_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS public.customer_claim_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid NOT NULL REFERENCES public.customer_order_claims(id) ON DELETE CASCADE,
    storage_path text NOT NULL UNIQUE,
    uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_order_claims_order
ON public.customer_order_claims(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_order_claims_customer
ON public.customer_order_claims(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_claim_photos_claim
ON public.customer_claim_photos(claim_id, created_at);

ALTER TABLE public.customer_order_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_claim_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_order_claims
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.customer_claim_photos
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_order_claims
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_claim_photos
TO service_role;

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'customer-claim-photos',
    'customer-claim-photos',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.create_customer_order_claim_atomic(
    p_order_id uuid,
    p_profile_id uuid,
    p_claim_type text,
    p_description text,
    p_order_item_id uuid,
    p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_customer_profile_id uuid;
    v_claim public.customer_order_claims%ROWTYPE;
    v_item_order_id uuid;
    v_duplicate boolean := false;
BEGIN
    IF p_order_id IS NULL
       OR p_profile_id IS NULL
       OR p_client_request_id IS NULL THEN
        RAISE EXCEPTION 'Order, profile, and client request ID are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_claim_type IS NULL
       OR p_claim_type NOT IN (
            'damage',
            'missing_item',
            'quality',
            'delivery',
            'other'
       ) THEN
        RAISE EXCEPTION 'Invalid claim type'
            USING ERRCODE = '22023';
    END IF;

    IF p_description IS NULL
       OR length(btrim(p_description)) NOT BETWEEN 10 AND 4000 THEN
        RAISE EXCEPTION 'Claim description must be between 10 and 4000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT o.*
    INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT c.profile_id
    INTO v_customer_profile_id
    FROM public.customers AS c
    WHERE c.id = v_order.customer_id;

    IF v_customer_profile_id IS DISTINCT FROM p_profile_id THEN
        RAISE EXCEPTION 'Order is not owned by this customer'
            USING ERRCODE = '42501';
    END IF;

    SELECT claims.*
    INTO v_claim
    FROM public.customer_order_claims AS claims
    WHERE claims.customer_id = v_order.customer_id
      AND claims.client_request_id = p_client_request_id;

    IF FOUND THEN
        IF v_claim.order_id IS DISTINCT FROM p_order_id
           OR v_claim.order_item_id IS DISTINCT FROM p_order_item_id
           OR v_claim.claim_type IS DISTINCT FROM p_claim_type
           OR v_claim.description IS DISTINCT FROM btrim(p_description) THEN
            RAISE EXCEPTION 'Client request ID was already used for another claim'
                USING ERRCODE = '23505';
        END IF;

        RETURN to_jsonb(v_claim) || jsonb_build_object('duplicate', true);
    END IF;

    IF v_order.current_status <> 'claim_period_active'::public.order_status THEN
        RAISE EXCEPTION 'Claims are not accepted while order is %', v_order.current_status
            USING ERRCODE = '23514';
    END IF;

    IF v_order.claim_deadline_at IS NULL
       OR v_order.claim_deadline_at <= transaction_timestamp() THEN
        RAISE EXCEPTION 'The order claim period has expired'
            USING ERRCODE = '23514';
    END IF;

    IF p_order_item_id IS NOT NULL THEN
        SELECT items.order_id
        INTO v_item_order_id
        FROM public.order_items AS items
        WHERE items.id = p_order_item_id;

        IF NOT FOUND OR v_item_order_id IS DISTINCT FROM p_order_id THEN
            RAISE EXCEPTION 'Claim item does not belong to this order'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    INSERT INTO public.customer_order_claims (
        order_id,
        customer_id,
        order_item_id,
        submitted_by,
        client_request_id,
        claim_type,
        description
    )
    VALUES (
        p_order_id,
        v_order.customer_id,
        p_order_item_id,
        p_profile_id,
        p_client_request_id,
        p_claim_type,
        btrim(p_description)
    )
    ON CONFLICT (customer_id, client_request_id) DO NOTHING
    RETURNING * INTO v_claim;

    IF NOT FOUND THEN
        SELECT claims.*
        INTO v_claim
        FROM public.customer_order_claims AS claims
        WHERE claims.customer_id = v_order.customer_id
          AND claims.client_request_id = p_client_request_id;

        IF NOT FOUND
           OR v_claim.order_id IS DISTINCT FROM p_order_id
           OR v_claim.order_item_id IS DISTINCT FROM p_order_item_id
           OR v_claim.claim_type IS DISTINCT FROM p_claim_type
           OR v_claim.description IS DISTINCT FROM btrim(p_description) THEN
            RAISE EXCEPTION 'Unable to resolve concurrent claim submission'
                USING ERRCODE = '40001';
        END IF;

        v_duplicate := true;
    END IF;

    RETURN to_jsonb(v_claim) || jsonb_build_object('duplicate', v_duplicate);
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_customer_claim_photo_atomic(
    p_claim_id uuid,
    p_profile_id uuid,
    p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_claim public.customer_order_claims%ROWTYPE;
    v_customer_profile_id uuid;
    v_object_name text;
    v_photo public.customer_claim_photos%ROWTYPE;
    v_duplicate boolean := false;
BEGIN
    IF p_claim_id IS NULL
       OR p_profile_id IS NULL
       OR p_storage_path IS NULL THEN
        RAISE EXCEPTION 'Claim, profile, and photo path are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT claims.*
    INTO v_claim
    FROM public.customer_order_claims AS claims
    WHERE claims.id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim % not found', p_claim_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT customers.profile_id
    INTO v_customer_profile_id
    FROM public.customers AS customers
    WHERE customers.id = v_claim.customer_id;

    IF v_customer_profile_id IS DISTINCT FROM p_profile_id THEN
        RAISE EXCEPTION 'Claim is not owned by this customer'
            USING ERRCODE = '42501';
    END IF;

    IF v_claim.status NOT IN ('submitted', 'under_review') THEN
        RAISE EXCEPTION 'Photos cannot be added while claim is %', v_claim.status
            USING ERRCODE = '23514';
    END IF;

    IF length(p_storage_path) > 1024
       OR p_storage_path !~ (
            '^' || p_profile_id::text || '/' || p_claim_id::text ||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
       ) THEN
        RAISE EXCEPTION 'Invalid claim photo path'
            USING ERRCODE = '22023';
    END IF;

    SELECT objects.name
    INTO v_object_name
    FROM storage.objects AS objects
    WHERE objects.bucket_id = 'customer-claim-photos'
      AND objects.name = p_storage_path
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim photograph has not been uploaded'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.customer_claim_photos (
        claim_id,
        storage_path,
        uploaded_by
    )
    VALUES (
        p_claim_id,
        p_storage_path,
        p_profile_id
    )
    ON CONFLICT (storage_path) DO NOTHING
    RETURNING * INTO v_photo;

    IF NOT FOUND THEN
        SELECT photos.*
        INTO v_photo
        FROM public.customer_claim_photos AS photos
        WHERE photos.storage_path = p_storage_path;

        IF NOT FOUND
           OR v_photo.claim_id IS DISTINCT FROM p_claim_id
           OR v_photo.uploaded_by IS DISTINCT FROM p_profile_id THEN
            RAISE EXCEPTION 'Claim photograph is already attached elsewhere'
                USING ERRCODE = '23505';
        END IF;

        v_duplicate := true;
    END IF;

    RETURN to_jsonb(v_photo) || jsonb_build_object('duplicate', v_duplicate);
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order_claim_atomic(
    uuid,
    uuid,
    text,
    text,
    uuid,
    uuid
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.attach_customer_claim_photo_atomic(
    uuid,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_customer_order_claim_atomic(
    uuid,
    uuid,
    text,
    text,
    uuid,
    uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION public.attach_customer_claim_photo_atomic(
    uuid,
    uuid,
    text
)
TO service_role;

COMMENT ON TABLE public.customer_order_claims IS
'Customer-submitted claims created during the existing post-delivery claim period.';

COMMENT ON TABLE public.customer_claim_photos IS
'Private Storage objects attached to customer-submitted order claims.';


-- ---------------------------------------------------------------------------
-- SOURCE: 27_20260916010000_add_order_pricing_consent.sql
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- SOURCE: 28_20260917090000_add_order_terms_version.sql
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS terms_version text;

UPDATE public.orders
SET terms_version = 'legacy-pre-2026.09.17'
WHERE terms_accepted = true
  AND terms_version IS NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_acceptance_version_consistency;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_acceptance_version_consistency
  CHECK (
    terms_accepted = false
    OR (
      terms_accepted = true
      AND terms_accepted_at IS NOT NULL
      AND terms_version IS NOT NULL
      AND length(btrim(terms_version)) > 0
    )
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_version_not_blank;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_version_not_blank
  CHECK (
    terms_version IS NULL
    OR length(btrim(terms_version)) > 0
  );

COMMENT ON COLUMN public.orders.terms_version IS
'Version identifier of the customer Terms & Conditions accepted for this order. Historical accepted orders created before version tracking use legacy-pre-2026.09.17.';

COMMIT;


-- ---------------------------------------------------------------------------
-- SOURCE: 29_20260918010000_6r_atomic_loyalty_redemption.sql
-- ---------------------------------------------------------------------------

-- 6R: serialize redemptions for each customer against the canonical points ledger.
CREATE OR REPLACE FUNCTION public.redeem_customer_loyalty_points(
  p_customer_id uuid, p_points integer, p_reason text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_balance integer;
BEGIN
  IF p_points IS NULL OR p_points <= 0 OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Positive points and reason required';
  END IF;
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  SELECT COALESCE(SUM(points), 0)::integer INTO current_balance
    FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
  IF current_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
  INSERT INTO public.loyalty_point_transactions
    (customer_id, points, transaction_type, reason)
    VALUES (p_customer_id, -p_points, 'redemption', btrim(p_reason));
  RETURN current_balance - p_points;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text) FROM PUBLIC;
-- Checkout redemption uses the atomic order creation function below instead.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_loyalty_points_redeemed_nonnegative;
ALTER TABLE public.orders ADD CONSTRAINT orders_loyalty_points_redeemed_nonnegative
  CHECK (loyalty_points_redeemed >= 0);

CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid; v_balance integer;
BEGIN
  IF p_points IS NULL OR p_points < 0 OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid order rewards or items';
  END IF;
  IF p_points > 0 THEN
    PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT COALESCE(SUM(points), 0)::integer INTO v_balance
      FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
    IF v_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
    IF (p_order->>'loyalty_discount_amount')::numeric <> p_points::numeric / 100 THEN
      RAISE EXCEPTION 'Invalid loyalty discount';
    END IF;
  END IF;
  INSERT INTO public.orders (
    customer_id, facility_id, current_status, pickup_address_id, delivery_address_id,
    pickup_scheduled_at, pickup_slot_label, subtotal, discount_amount,
    pickup_delivery_charge, taxable_amount, gst_rate, gst_amount, total_amount,
    payment_method, terms_accepted, terms_accepted_at, terms_version, loyalty_points_redeemed
  ) VALUES (
    p_customer_id, (p_order->>'facility_id')::uuid, 'draft',
    (p_order->>'pickup_address_id')::uuid, (p_order->>'delivery_address_id')::uuid,
    (p_order->>'pickup_scheduled_at')::timestamptz, p_order->>'pickup_slot_label',
    (p_order->>'subtotal')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric, (p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric, (p_order->>'gst_amount')::numeric,
    (p_order->>'total_amount')::numeric, (p_order->>'payment_method')::public.payment_method,
    true, now(), p_order->>'terms_version', p_points
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items
    (order_id, service_id, item_name, quantity, weight_kg, unit_price, line_total, customer_notes)
  SELECT v_order_id, i.service_id, i.item_name, i.quantity, i.weight_kg,
    i.unit_price, i.line_total, i.customer_notes
  FROM jsonb_to_recordset(p_items) AS i(
    service_id uuid, item_name text, quantity integer, weight_kg numeric,
    unit_price numeric, line_total numeric, customer_notes text
  );
  INSERT INTO public.order_qr_codes(order_id) VALUES (v_order_id);
  IF p_points > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    VALUES (p_customer_id, -p_points, 'redemption', 'Checkout discount', 'order', v_order_id);
  END IF;
  PERFORM public.change_order_status(v_order_id, p_target_status, 'Order created');
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 30_20260918120000_customer_order_lifecycle_notifications.sql
-- ---------------------------------------------------------------------------

-- Customer lifecycle notifications are persisted locally by the database.
-- FCM dispatch remains opt-in and credential-gated by the backend dispatcher.
CREATE OR REPLACE FUNCTION public.create_customer_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_title text;
  v_body text;
BEGIN
  IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    RETURN NEW;
  END IF;

  SELECT c.profile_id INTO v_profile_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id;
  IF v_profile_id IS NULL THEN RETURN NEW; END IF;

  SELECT CASE NEW.current_status
    WHEN 'pickup_assigned' THEN 'Pickup driver assigned'
    WHEN 'pickup_otp_pending' THEN 'Driver arriving for pickup'
    WHEN 'picked_up' THEN 'Pickup completed'
    WHEN 'received_at_facility' THEN 'Laundry received at facility'
    WHEN 'processing' THEN 'Laundry processing update'
    WHEN 'ready_for_delivery' THEN 'Ready for delivery'
    WHEN 'en_route_delivery' THEN 'Driver is on the way'
    WHEN 'delivered' THEN 'Order delivered'
    WHEN 'claim_period_active' THEN 'Claim period is active'
    ELSE NULL
  END INTO v_title;
  IF v_title IS NULL THEN RETURN NEW; END IF;

  v_body := format('Order %s: %s', coalesce(NEW.order_number, NEW.id::text), v_title);
  INSERT INTO public.notifications(profile_id, order_id, notification_type, title, body, data, status)
  VALUES (v_profile_id, NEW.id, concat('order.', NEW.current_status), v_title, v_body,
    jsonb_build_object('orderId', NEW.id::text, 'status', NEW.current_status::text), 'queued');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_order_status_notification ON public.orders;
CREATE TRIGGER trg_customer_order_status_notification
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_customer_order_status_notification();


-- ---------------------------------------------------------------------------
-- SOURCE: 31_20260918130000_6r_restore_cancelled_loyalty.sql
-- ---------------------------------------------------------------------------

-- Return points once when an order is cancelled through the approved status procedure.
CREATE OR REPLACE FUNCTION public.restore_cancelled_order_loyalty_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status
     AND NEW.loyalty_points_redeemed > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    SELECT NEW.customer_id, NEW.loyalty_points_redeemed, 'restoration',
      'Cancelled order', 'order', NEW.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.loyalty_point_transactions
      WHERE reference_type = 'order' AND reference_id = NEW.id
        AND transaction_type = 'restoration'
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restore_cancelled_order_loyalty_points ON public.orders;
CREATE TRIGGER trg_restore_cancelled_order_loyalty_points
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_order_loyalty_points();


-- ---------------------------------------------------------------------------
-- SOURCE: 32_20260918140000_6r_minimum_loyalty_redemption.sql
-- ---------------------------------------------------------------------------

-- Enforce the approved ₹10 checkout minimum at the database boundary.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_loyalty_redemption_minimum;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_loyalty_redemption_minimum
  CHECK (loyalty_points_redeemed = 0 OR loyalty_points_redeemed >= 1000);


-- ---------------------------------------------------------------------------
-- SOURCE: 33_20260918150000_6r_loyalty_earning.sql
-- ---------------------------------------------------------------------------

-- Approved earning rate: 0.01 point per ₹1 paid (one whole point per ₹100).
-- Credit once after delivery and payment; COD is treated as collected on delivery.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_order_earned_once
ON public.loyalty_point_transactions(reference_id)
WHERE reference_type = 'order' AND transaction_type = 'earned';

CREATE OR REPLACE FUNCTION public.award_customer_order_loyalty_points(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders%ROWTYPE; v_points integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.current_status NOT IN ('delivered', 'claim_period_active', 'completed') THEN
    RETURN 0;
  END IF;
  IF v_order.payment_method = 'razorpay' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_orders
                   WHERE order_id = p_order_id AND status = 'paid') THEN
      RETURN 0;
    END IF;
  ELSIF v_order.payment_method <> 'cash_on_delivery' THEN
    RETURN 0;
  END IF;
  v_points := floor(GREATEST(v_order.total_amount, 0) / 100)::integer;
  IF v_points < 1 THEN RETURN 0; END IF;
  INSERT INTO public.loyalty_point_transactions
    (customer_id, points, transaction_type, reason, reference_type, reference_id)
  VALUES (v_order.customer_id, v_points, 'earned', 'Order delivered and paid', 'order', p_order_id)
  ON CONFLICT DO NOTHING;
  RETURN v_points;
END;
$$;
REVOKE ALL ON FUNCTION public.award_customer_order_loyalty_points(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_customer_order_loyalty_points(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.award_loyalty_after_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'delivered' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    PERFORM public.award_customer_order_loyalty_points(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_loyalty_after_delivery ON public.orders;
CREATE TRIGGER trg_award_loyalty_after_delivery
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_after_delivery();

CREATE OR REPLACE FUNCTION public.award_loyalty_after_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.award_customer_order_loyalty_points(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_loyalty_after_payment ON public.payment_orders;
CREATE TRIGGER trg_award_loyalty_after_payment
AFTER INSERT OR UPDATE OF status ON public.payment_orders
FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_after_payment();


-- ---------------------------------------------------------------------------
-- SOURCE: 34_20260918160000_6r_disable_standalone_redemption.sql
-- ---------------------------------------------------------------------------

-- Preserve the old function for compatibility, but prevent service-role use.
-- Customer redemption is only available in atomic checkout order creation.
REVOKE EXECUTE ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text)
FROM service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 35_20260918170000_6s_package_purchase_usage.sql
-- ---------------------------------------------------------------------------

-- 6S package purchase audit and reversible, order-linked usage.
ALTER TABLE public.package_subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_subscription_payment_reference
  ON public.package_subscriptions(payment_reference)
  WHERE payment_reference IS NOT NULL;

ALTER TABLE public.package_usage
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_usage_order_service
  ON public.package_usage(subscription_id, order_id, service_id)
  WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.restore_cancelled_order_package_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_status = 'cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    UPDATE public.package_usage SET reversed_at = now()
    WHERE order_id = NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restore_cancelled_order_package_usage ON public.orders;
CREATE TRIGGER trg_restore_cancelled_order_package_usage
AFTER UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_order_package_usage();


-- ---------------------------------------------------------------------------
-- SOURCE: 36_20260918180000_6s_atomic_package_order.sql
-- ---------------------------------------------------------------------------

-- Serialise consumption per subscription and create the order in one transaction.
CREATE OR REPLACE FUNCTION public.create_customer_order_with_package_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer,
  p_subscription_id uuid, p_coverages jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_subscription public.package_subscriptions%ROWTYPE;
  v_coverage record; v_item record; v_limit record;
  v_used integer; v_package_discount numeric(12,2) := 0; v_order_id uuid;
BEGIN
  SELECT * INTO v_subscription FROM public.package_subscriptions
  WHERE id = p_subscription_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_subscription.status <> 'active'
     OR v_subscription.starts_at > now() OR v_subscription.expires_at <= now() THEN
    RAISE EXCEPTION 'Package is unavailable or expired';
  END IF;
  IF p_coverages IS NULL OR jsonb_array_length(p_coverages) = 0 THEN
    RAISE EXCEPTION 'No eligible package credits selected';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_coverages)
    AS c(service_id uuid, quantity integer)
    GROUP BY service_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate package service';
  END IF;
  FOR v_coverage IN SELECT * FROM jsonb_to_recordset(p_coverages)
    AS c(service_id uuid, quantity integer) LOOP
    SELECT * INTO v_item FROM jsonb_to_recordset(p_items)
      AS i(service_id uuid, quantity integer, unit_price numeric)
      WHERE service_id = v_coverage.service_id;
    SELECT * INTO v_limit FROM public.package_services
      WHERE package_id = v_subscription.package_id
        AND service_id = v_coverage.service_id;
    IF NOT FOUND OR v_coverage.quantity IS NULL OR v_coverage.quantity <= 0
       OR v_item.service_id IS NULL OR v_item.quantity < v_coverage.quantity THEN
      RAISE EXCEPTION 'Package service is not eligible for this order';
    END IF;
    SELECT COALESCE(SUM(usage_quantity), 0)::integer INTO v_used
      FROM public.package_usage
      WHERE subscription_id = p_subscription_id
        AND service_id = v_coverage.service_id AND reversed_at IS NULL;
    IF v_limit.usage_limit IS NOT NULL
       AND v_used + v_coverage.quantity > v_limit.usage_limit THEN
      RAISE EXCEPTION 'Package balance is insufficient';
    END IF;
    v_package_discount := v_package_discount + v_coverage.quantity * v_item.unit_price;
  END LOOP;
  IF v_package_discount <= 0
     OR v_package_discount <> (p_order->>'package_discount_amount')::numeric
     OR v_package_discount > (p_order->>'discount_amount')::numeric THEN
    RAISE EXCEPTION 'Package discount is invalid';
  END IF;
  v_order_id := public.create_customer_order_with_rewards_atomic(
    p_customer_id, p_order, p_items, p_target_status, p_points);
  INSERT INTO public.package_usage
    (subscription_id, service_id, order_id, usage_quantity, customer_id, package_service_id)
  SELECT p_subscription_id, c.service_id, v_order_id, c.quantity,
    p_customer_id, ps.id
  FROM jsonb_to_recordset(p_coverages) AS c(service_id uuid, quantity integer)
  JOIN public.package_services ps ON ps.package_id = v_subscription.package_id
    AND ps.service_id = c.service_id;
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_package_atomic(uuid, jsonb, jsonb, public.order_status, integer, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_package_atomic(uuid, jsonb, jsonb, public.order_status, integer, uuid, jsonb) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 37_20260918190000_6u2_order_create_idempotency.sql
-- ---------------------------------------------------------------------------

-- 6U.2: the client keeps the same key for retries; the unique index serializes concurrent inserts.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_idempotency_key_unique
  ON public.orders(customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid, p_order jsonb, p_items jsonb,
  p_target_status public.order_status, p_points integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid; v_balance integer;
BEGIN
  IF p_points IS NULL OR p_points < 0 OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid order rewards or items';
  END IF;
  IF p_points > 0 THEN
    PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT COALESCE(SUM(points), 0)::integer INTO v_balance
      FROM public.loyalty_point_transactions WHERE customer_id = p_customer_id;
    IF v_balance < p_points THEN RAISE EXCEPTION 'Insufficient loyalty points'; END IF;
    IF (p_order->>'loyalty_discount_amount')::numeric <> p_points::numeric / 100 THEN
      RAISE EXCEPTION 'Invalid loyalty discount';
    END IF;
  END IF;
  INSERT INTO public.orders (
    customer_id, facility_id, current_status, pickup_address_id, delivery_address_id,
    pickup_scheduled_at, pickup_slot_label, subtotal, discount_amount,
    pickup_delivery_charge, taxable_amount, gst_rate, gst_amount, total_amount,
    payment_method, terms_accepted, terms_accepted_at, terms_version, loyalty_points_redeemed,
    idempotency_key, idempotency_request_hash
  ) VALUES (
    p_customer_id, (p_order->>'facility_id')::uuid, 'draft',
    (p_order->>'pickup_address_id')::uuid, (p_order->>'delivery_address_id')::uuid,
    (p_order->>'pickup_scheduled_at')::timestamptz, p_order->>'pickup_slot_label',
    (p_order->>'subtotal')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric, (p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric, (p_order->>'gst_amount')::numeric,
    (p_order->>'total_amount')::numeric, (p_order->>'payment_method')::public.payment_method,
    true, now(), p_order->>'terms_version', p_points,
    (p_order->>'idempotency_key')::uuid, p_order->>'idempotency_request_hash'
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items
    (order_id, service_id, item_name, quantity, weight_kg, unit_price, line_total, customer_notes)
  SELECT v_order_id, i.service_id, i.item_name, i.quantity, i.weight_kg,
    i.unit_price, i.line_total, i.customer_notes
  FROM jsonb_to_recordset(p_items) AS i(
    service_id uuid, item_name text, quantity integer, weight_kg numeric,
    unit_price numeric, line_total numeric, customer_notes text
  );
  INSERT INTO public.order_qr_codes(order_id) VALUES (v_order_id);
  IF p_points > 0 THEN
    INSERT INTO public.loyalty_point_transactions
      (customer_id, points, transaction_type, reason, reference_type, reference_id)
    VALUES (p_customer_id, -p_points, 'redemption', 'Checkout discount', 'order', v_order_id);
  END IF;
  PERFORM public.change_order_status(v_order_id, p_target_status, 'Order created');
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_rewards_atomic(uuid, jsonb, jsonb, public.order_status, integer) TO service_role;

DROP TABLE IF EXISTS public.bw_catalog_seed;
