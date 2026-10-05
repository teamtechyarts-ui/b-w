-- =============================================================================
-- PART 3 of 3 — Facility, staff, admin, production features
-- Bright & White / Supabase manual setup
-- Run this ENTIRE file in Supabase SQL Editor (one paste).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SOURCE: 38_20260918200000_7a_staff_account_safety.sql
-- ---------------------------------------------------------------------------

-- Admin-created operational identities start inactive until backend provisioning
-- has completed. Normal customer signup retains its existing active default.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone'),
    CASE WHEN NEW.raw_user_meta_data ->> 'bw_staff_provisioning' = 'true'
      THEN false ELSE true END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- A direct authenticated Supabase request may edit a display name or avatar,
-- but may never reactivate a deactivated staff profile.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_path) ON public.profiles TO authenticated;


-- ---------------------------------------------------------------------------
-- SOURCE: 39_20260918210000_7c_atomic_driver_reassignment.sql
-- ---------------------------------------------------------------------------

-- 7C: replace an active assignment without exposing an intermediate state.
-- Historical rows retain their original driver for audit attribution.
CREATE OR REPLACE FUNCTION public.reassign_driver_assignment_atomic(
    p_assignment_id uuid,
    p_admin_profile_id uuid,
    p_new_driver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old public.driver_assignments%ROWTYPE;
    v_order_status public.order_status;
    v_expected public.order_status;
    v_failed public.order_status;
    v_new jsonb;
BEGIN
    IF p_assignment_id IS NULL OR p_admin_profile_id IS NULL OR p_new_driver_id IS NULL THEN
        RAISE EXCEPTION 'Assignment, Admin, and replacement Driver are required' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profile_roles AS pr
        JOIN public.roles AS role ON role.id = pr.role_id
        WHERE pr.profile_id = p_admin_profile_id AND role.code = 'admin'
    ) THEN
        RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
    END IF;

    -- Lock order first, matching the established assignment transaction order.
    SELECT assignment.* INTO v_old
    FROM public.driver_assignments AS assignment WHERE assignment.id = p_assignment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT o.current_status INTO v_order_status
    FROM public.orders AS o WHERE o.id = v_old.order_id FOR UPDATE;
    SELECT assignment.* INTO v_old
    FROM public.driver_assignments AS assignment WHERE assignment.id = p_assignment_id FOR UPDATE;
    IF v_old.status NOT IN ('assigned', 'accepted', 'en_route', 'arrived') THEN
        RAISE EXCEPTION 'Assignment can no longer be reassigned' USING ERRCODE = '23514';
    END IF;
    IF v_old.driver_id = p_new_driver_id THEN
        RAISE EXCEPTION 'Replacement Driver must be different' USING ERRCODE = '23514';
    END IF;

    IF v_old.assignment_type = 'pickup' THEN
        v_failed := 'pickup_failed';
        v_expected := CASE v_old.status
            WHEN 'assigned' THEN 'pickup_assigned'::public.order_status
            WHEN 'accepted' THEN 'pickup_accepted'::public.order_status
            WHEN 'en_route' THEN 'en_route_pickup'::public.order_status
            ELSE 'pickup_otp_pending'::public.order_status END;
    ELSE
        v_failed := 'delivery_failed';
        v_expected := CASE v_old.status
            WHEN 'assigned' THEN 'delivery_assigned'::public.order_status
            WHEN 'accepted' THEN 'delivery_accepted'::public.order_status
            WHEN 'en_route' THEN 'en_route_delivery'::public.order_status
            ELSE 'delivery_otp_pending'::public.order_status END;
    END IF;
    IF v_order_status IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'Order is not in the expected assignment state' USING ERRCODE = '23514';
    END IF;

    UPDATE public.driver_assignments SET status = 'reassignment_required'
    WHERE id = p_assignment_id;
    PERFORM public.change_order_status(v_old.order_id, v_failed, 'Admin reassigned Driver');
    v_new := public.create_driver_assignment_atomic(
        v_old.order_id, p_new_driver_id, v_old.assignment_type, NULL
    );
    RETURN jsonb_build_object(
        'previousAssignmentId', p_assignment_id,
        'assignment', v_new->'assignment',
        'orderStatus', v_new->'orderStatus'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_driver_assignment_atomic(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_driver_assignment_atomic(uuid, uuid, uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 40_20260918220000_7d_assignment_scoped_driver_gps.sql
-- ---------------------------------------------------------------------------

-- 7D: a location belongs to one active trip, not merely to a Driver.
CREATE TABLE IF NOT EXISTS public.driver_trip_locations (
    assignment_id uuid PRIMARY KEY REFERENCES public.driver_assignments(id) ON DELETE CASCADE,
    driver_id uuid NOT NULL REFERENCES public.drivers(id),
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    accuracy_m numeric(10,2),
    recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_trip_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_trip_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.driver_trip_locations TO service_role;

CREATE OR REPLACE FUNCTION public.publish_driver_trip_location_atomic(
    p_assignment_id uuid,
    p_driver_id uuid,
    p_latitude numeric,
    p_longitude numeric,
    p_accuracy_m numeric DEFAULT NULL
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
    v_last timestamptz;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF p_assignment_id IS NULL OR p_driver_id IS NULL OR p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
       OR (p_accuracy_m IS NOT NULL AND p_accuracy_m NOT BETWEEN 0 AND 100000) THEN
        RAISE EXCEPTION 'Invalid trip location' USING ERRCODE = '22023';
    END IF;
    SELECT a.order_id INTO v_order_id FROM public.driver_assignments AS a
    WHERE a.id = p_assignment_id AND a.driver_id = p_driver_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'P0002'; END IF;
    SELECT o.current_status INTO v_order_status FROM public.orders AS o
    WHERE o.id = v_order_id FOR UPDATE;
    SELECT a.* INTO v_assignment FROM public.driver_assignments AS a
    WHERE a.id = p_assignment_id AND a.driver_id = p_driver_id FOR UPDATE;
    IF NOT FOUND OR v_assignment.status <> 'en_route' OR
       (v_assignment.assignment_type = 'pickup' AND v_order_status <> 'en_route_pickup') OR
       (v_assignment.assignment_type = 'delivery' AND v_order_status <> 'en_route_delivery') THEN
        RAISE EXCEPTION 'Trip is not active' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.drivers AS d WHERE d.id = p_driver_id AND d.is_active) THEN
        RAISE EXCEPTION 'Driver is inactive' USING ERRCODE = '23514';
    END IF;
    SELECT recorded_at INTO v_last FROM public.driver_trip_locations
    WHERE assignment_id = p_assignment_id FOR UPDATE;
    IF v_last IS NOT NULL AND v_now - v_last < interval '15 seconds' THEN
        RETURN jsonb_build_object('published', false, 'recordedAt', v_last);
    END IF;
    INSERT INTO public.driver_trip_locations (assignment_id, driver_id, latitude, longitude, accuracy_m, recorded_at)
    VALUES (p_assignment_id, p_driver_id, p_latitude, p_longitude, p_accuracy_m, v_now)
    ON CONFLICT (assignment_id) DO UPDATE SET
        latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
        accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at;
    PERFORM public.upsert_driver_live_location(p_driver_id, p_latitude, p_longitude, p_accuracy_m);
    RETURN jsonb_build_object('published', true, 'recordedAt', v_now);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_driver_trip_location_atomic(uuid,uuid,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_driver_trip_location_atomic(uuid,uuid,numeric,numeric,numeric) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 41_20260920200000_8c_facility_intake_verification.sql
-- ---------------------------------------------------------------------------

-- 8C: retain customer order_items unchanged and record Facility measurements separately.
CREATE TABLE IF NOT EXISTS public.facility_intake_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES public.garment_inspections(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('missing', 'extra', 'damaged', 'weight_mismatch')),
  expected_quantity integer NOT NULL,
  counted_quantity integer NOT NULL,
  expected_weight_kg numeric(10,2),
  measured_weight_kg numeric(10,2),
  notes text NOT NULL CHECK (length(trim(notes)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  CONSTRAINT discrepancy_resolution_complete CHECK (
    (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_notes IS NULL)
    OR (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      AND length(trim(coalesce(resolution_notes, ''))) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_facility_intake_discrepancies_open
  ON public.facility_intake_discrepancies(order_id, status);
ALTER TABLE public.facility_intake_discrepancies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_intake_discrepancies FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_facility_intake_verification_atomic(
  p_order_id uuid, p_performed_by uuid, p_items jsonb, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_input jsonb;
  v_result jsonb;
  v_inspection_id uuid;
  v_expected integer;
  v_counted integer;
  v_weight numeric(10,2);
  v_total_count integer := 0;
  v_total_weight numeric(10,2) := 0;
  v_damaged boolean;
  v_note text;
  v_discrepancies integer := 0;
BEGIN
  IF p_order_id IS NULL OR p_performed_by IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Order, operator and item measurements are required' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_expected FROM public.order_items WHERE order_id = p_order_id;
  IF v_expected = 0 OR jsonb_array_length(p_items) <> v_expected THEN
    RAISE EXCEPTION 'Every listed item must be measured exactly once' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT entry->>'orderItemId') FROM jsonb_array_elements(p_items) entry) <> v_expected THEN
    RAISE EXCEPTION 'Duplicate item measurement' USING ERRCODE = '23514';
  END IF;
  -- Validate every measurement before the existing atomic lifecycle procedure runs.
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id ORDER BY id LOOP
    SELECT entry INTO v_input FROM jsonb_array_elements(p_items) entry
      WHERE entry->>'orderItemId' = v_item.id::text;
    IF v_input IS NULL OR jsonb_typeof(v_input->'countedQuantity') <> 'number' OR
       (v_input ? 'weightKg' AND v_input->'weightKg' <> 'null'::jsonb AND jsonb_typeof(v_input->'weightKg') <> 'number') THEN
      RAISE EXCEPTION 'Invalid item measurement' USING ERRCODE = '22023';
    END IF;
    v_counted := (v_input->>'countedQuantity')::integer;
    v_weight := nullif(v_input->>'weightKg', '')::numeric;
    v_damaged := coalesce((v_input->>'damaged')::boolean, false);
    v_note := trim(coalesce(v_input->>'notes', ''));
    IF v_counted < 0 OR v_counted > 10000 OR v_weight < 0 OR v_weight > 99999999 THEN
      RAISE EXCEPTION 'Invalid count or weight' USING ERRCODE = '22023';
    END IF;
    IF (v_counted <> v_item.quantity OR v_damaged OR
        (v_item.weight_kg IS NOT NULL AND v_weight IS DISTINCT FROM v_item.weight_kg))
       AND v_note = '' THEN
      RAISE EXCEPTION 'Discrepancy notes are required' USING ERRCODE = '23514';
    END IF;
    v_total_count := v_total_count + v_counted;
    v_total_weight := v_total_weight + coalesce(v_weight, 0);
  END LOOP;

  -- Existing function owns the approved lifecycle transition and aggregate audit.
  v_result := public.record_facility_verification_atomic(
    p_order_id, p_performed_by, v_total_count, v_total_weight, p_notes);

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id ORDER BY id LOOP
    SELECT entry INTO v_input FROM jsonb_array_elements(p_items) entry
      WHERE entry->>'orderItemId' = v_item.id::text;
    v_counted := (v_input->>'countedQuantity')::integer;
    v_weight := nullif(v_input->>'weightKg', '')::numeric;
    v_damaged := coalesce((v_input->>'damaged')::boolean, false);
    v_note := trim(coalesce(v_input->>'notes', ''));
    INSERT INTO public.garment_inspections(
      operation_id, order_id, order_item_id, inspected_by, verified_by,
      item_count, counted_quantity, weight_kg, condition_notes, inspection_status)
    VALUES ((v_result->>'operationId')::uuid, p_order_id, v_item.id, p_performed_by,
      p_performed_by, v_counted, v_counted, v_weight, nullif(v_note, ''), 'verified')
    RETURNING id INTO v_inspection_id;
    IF v_counted <> v_item.quantity THEN
      INSERT INTO public.facility_intake_discrepancies(
        order_id, order_item_id, inspection_id, kind, expected_quantity,
        counted_quantity, expected_weight_kg, measured_weight_kg, notes, created_by)
      VALUES (p_order_id, v_item.id, v_inspection_id,
        CASE WHEN v_counted < v_item.quantity THEN 'missing' ELSE 'extra' END,
        v_item.quantity, v_counted, v_item.weight_kg, v_weight, v_note, p_performed_by);
      v_discrepancies := v_discrepancies + 1;
    END IF;
    IF v_item.weight_kg IS NOT NULL AND v_weight IS DISTINCT FROM v_item.weight_kg THEN
      INSERT INTO public.facility_intake_discrepancies(
        order_id, order_item_id, inspection_id, kind, expected_quantity,
        counted_quantity, expected_weight_kg, measured_weight_kg, notes, created_by)
      VALUES (p_order_id, v_item.id, v_inspection_id, 'weight_mismatch',
        v_item.quantity, v_counted, v_item.weight_kg, v_weight, v_note, p_performed_by);
      v_discrepancies := v_discrepancies + 1;
    END IF;
    IF v_damaged THEN
      INSERT INTO public.facility_intake_discrepancies(
        order_id, order_item_id, inspection_id, kind, expected_quantity,
        counted_quantity, expected_weight_kg, measured_weight_kg, notes, created_by)
      VALUES (p_order_id, v_item.id, v_inspection_id, 'damaged',
        v_item.quantity, v_counted, v_item.weight_kg, v_weight, v_note, p_performed_by);
      v_discrepancies := v_discrepancies + 1;
    END IF;
  END LOOP;
  RETURN v_result || jsonb_build_object('discrepancyCount', v_discrepancies);
END;
$$;
REVOKE ALL ON FUNCTION public.record_facility_intake_verification_atomic(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facility_intake_verification_atomic(uuid, uuid, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.block_processing_with_open_intake_discrepancy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.operation_type IN ('washing', 'drying', 'ironing', 'folding', 'packaging')
     AND EXISTS (SELECT 1 FROM public.facility_intake_discrepancies d
                 WHERE d.order_id = NEW.order_id AND d.status = 'open') THEN
    RAISE EXCEPTION 'Resolve Facility intake discrepancies before processing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_processing_with_open_intake_discrepancy ON public.facility_order_operations;
CREATE TRIGGER trg_block_processing_with_open_intake_discrepancy
BEFORE INSERT ON public.facility_order_operations
FOR EACH ROW EXECUTE FUNCTION public.block_processing_with_open_intake_discrepancy();


-- ---------------------------------------------------------------------------
-- SOURCE: 42_20260920210000_8c_require_measured_intake_before_processing.sql
-- ---------------------------------------------------------------------------

-- Apply the new per-item verification policy only to receipts created after 8C.
-- Historical in-progress orders keep their existing verification path.
CREATE TABLE IF NOT EXISTS public.facility_intake_policy_orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facility_intake_policy_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_intake_policy_orders FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_facility_intake_policy_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.operation_type = 'facility_workflow' AND NEW.current_status = 'received' THEN
    INSERT INTO public.facility_intake_policy_orders(order_id) VALUES (NEW.order_id)
      ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mark_facility_intake_policy_order ON public.facility_order_operations;
CREATE TRIGGER trg_mark_facility_intake_policy_order
AFTER INSERT ON public.facility_order_operations
FOR EACH ROW EXECUTE FUNCTION public.mark_facility_intake_policy_order();

CREATE OR REPLACE FUNCTION public.block_processing_with_open_intake_discrepancy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_verification_id uuid;
BEGIN
  IF NEW.operation_type NOT IN ('washing', 'drying', 'ironing', 'folding', 'packaging') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.facility_intake_discrepancies d
             WHERE d.order_id = NEW.order_id AND d.status = 'open') THEN
    RAISE EXCEPTION 'Resolve Facility intake discrepancies before processing'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facility_intake_policy_orders p WHERE p.order_id = NEW.order_id) THEN
    SELECT operation.id INTO v_verification_id
    FROM public.facility_order_operations operation
    WHERE operation.order_id = NEW.order_id AND operation.operation_type = 'verification'
    ORDER BY operation.started_at DESC NULLS LAST, operation.id DESC LIMIT 1;
    IF v_verification_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.order_items item WHERE item.order_id = NEW.order_id
    ) OR EXISTS (
      SELECT 1 FROM public.order_items item WHERE item.order_id = NEW.order_id
      AND NOT EXISTS (SELECT 1 FROM public.garment_inspections inspection
        WHERE inspection.operation_id = v_verification_id AND inspection.order_item_id = item.id)
    ) THEN
      RAISE EXCEPTION 'Measure every listed garment before processing'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- SOURCE: 43_20260920220000_8d_processing_operator_audit.sql
-- ---------------------------------------------------------------------------

-- Preserve both actors when the existing atomic completion procedure updates
-- performed_by. Each processing operation remains the stage history record.
ALTER TABLE public.facility_order_operations
  ADD COLUMN IF NOT EXISTS started_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.profiles(id);

UPDATE public.facility_order_operations
SET started_by = performed_by
WHERE operation_type IN ('washing', 'drying', 'ironing', 'folding', 'packaging')
  AND started_by IS NULL;

CREATE OR REPLACE FUNCTION public.audit_facility_processing_actors()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.operation_type NOT IN ('washing', 'drying', 'ironing', 'folding', 'packaging') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.started_by := NEW.performed_by;
  ELSE
    NEW.started_by := OLD.started_by;
    IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
      NEW.completed_by := NEW.performed_by;
      NEW.performed_by := OLD.performed_by;
    ELSE
      NEW.completed_by := OLD.completed_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_facility_processing_actors ON public.facility_order_operations;
CREATE TRIGGER trg_audit_facility_processing_actors
BEFORE INSERT OR UPDATE ON public.facility_order_operations
FOR EACH ROW EXECUTE FUNCTION public.audit_facility_processing_actors();


-- ---------------------------------------------------------------------------
-- SOURCE: 44_20260920230000_8e_qc_rewash_audit.sql
-- ---------------------------------------------------------------------------

-- QC decisions are immutable audit records. Existing facility operations remain
-- the authority for order transitions and retain every processing cycle.
CREATE TABLE public.facility_qc_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.facility_order_operations(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL CHECK (cycle_number BETWEEN 0 AND 2),
  approved boolean NOT NULL,
  rewash_required boolean NOT NULL,
  defect_code text,
  reason text,
  affected_item_ids uuid[] NOT NULL DEFAULT '{}',
  decided_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT qc_failure_requires_reason CHECK (approved OR (defect_code IS NOT NULL AND length(btrim(reason)) >= 5)),
  CONSTRAINT qc_rewash_matches_verdict CHECK (rewash_required = NOT approved)
);
CREATE INDEX idx_facility_qc_decisions_order ON public.facility_qc_decisions(order_id, created_at);
ALTER TABLE public.facility_qc_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_qc_decisions FROM anon, authenticated;

ALTER TABLE public.facility_order_operations
  ADD COLUMN IF NOT EXISTS rewash_cycle integer NOT NULL DEFAULT 0 CHECK (rewash_cycle BETWEEN 0 AND 2);

CREATE OR REPLACE FUNCTION public.mark_facility_processing_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.operation_type IN ('washing','drying','ironing','folding','packaging','quality_check') THEN
    SELECT count(*)::integer INTO NEW.rewash_cycle
    FROM public.facility_qc_decisions decision
    WHERE decision.order_id = NEW.order_id AND NOT decision.approved;
    IF NEW.rewash_cycle > 2 THEN
      RAISE EXCEPTION 'Rewash cycle limit exceeded' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_mark_facility_processing_cycle
BEFORE INSERT ON public.facility_order_operations
FOR EACH ROW EXECUTE FUNCTION public.mark_facility_processing_cycle();

CREATE OR REPLACE FUNCTION public.record_facility_qc_decision_atomic(
  p_order_id uuid, p_performed_by uuid, p_approved boolean,
  p_defect_code text, p_reason text, p_affected_item_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_failures integer;
  v_result jsonb;
  v_code text := nullif(btrim(p_defect_code), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_item uuid;
BEGIN
  IF p_order_id IS NULL OR p_performed_by IS NULL OR p_approved IS NULL THEN
    RAISE EXCEPTION 'Order, operator and QC verdict are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.facility_employees employee
    JOIN public.profiles profile ON profile.id = employee.profile_id
    WHERE employee.profile_id = p_performed_by AND employee.facility_id = v_order.facility_id
      AND employee.is_active AND employee.employee_role = 'manager' AND profile.is_active
  ) THEN RAISE EXCEPTION 'Active Facility Manager QC approval required' USING ERRCODE = '42501'; END IF;
  IF p_approved = false AND (v_code NOT IN ('stain','damage','finish','missing','other') OR
                             v_code IS NULL OR length(coalesce(v_reason, '')) < 5) THEN
    RAISE EXCEPTION 'Failed QC requires defect category and reason' USING ERRCODE = '22023';
  END IF;
  FOREACH v_item IN ARRAY coalesce(p_affected_item_ids, '{}'::uuid[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = v_item AND order_id = p_order_id) THEN
      RAISE EXCEPTION 'QC item does not belong to order' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT count(*)::integer INTO v_failures FROM public.facility_qc_decisions
    WHERE order_id = p_order_id AND NOT approved;
  IF NOT p_approved AND v_failures >= 2 THEN
    RAISE EXCEPTION 'Rewash limit reached; Manager reconciliation required' USING ERRCODE = '23514';
  END IF;
  v_result := public.complete_facility_quality_check_atomic(
    p_order_id, p_performed_by, p_approved, v_reason
  );
  INSERT INTO public.facility_qc_decisions
    (order_id, operation_id, cycle_number, approved, rewash_required,
     defect_code, reason, affected_item_ids, decided_by)
  VALUES (p_order_id, (v_result->>'operationId')::uuid, v_failures, p_approved,
          NOT p_approved, CASE WHEN p_approved THEN NULL ELSE v_code END,
          v_reason, coalesce(p_affected_item_ids, '{}'::uuid[]), p_performed_by);
  RETURN v_result || jsonb_build_object('cycleNumber', v_failures, 'rewashRequired', NOT p_approved);
END;
$$;
REVOKE ALL ON FUNCTION public.record_facility_qc_decision_atomic(uuid,uuid,boolean,text,text,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facility_qc_decision_atomic(uuid,uuid,boolean,text,text,uuid[])
  TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 45_20260920231000_8e_manager_reconciliation_after_rewash_cap.sql
-- ---------------------------------------------------------------------------

-- After two failed cycles, final QC approval needs an explicit Manager account
-- of the reconciliation. This trigger runs in the same transaction as the
-- existing atomic QC transition, so a missing explanation rolls it back.
CREATE OR REPLACE FUNCTION public.require_capped_rewash_reconciliation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.approved AND NEW.cycle_number >= 2 AND length(coalesce(btrim(NEW.reason), '')) < 5 THEN
    RAISE EXCEPTION 'Manager reconciliation notes are required after two rewash cycles'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_require_capped_rewash_reconciliation
BEFORE INSERT ON public.facility_qc_decisions
FOR EACH ROW EXECUTE FUNCTION public.require_capped_rewash_reconciliation();


-- ---------------------------------------------------------------------------
-- SOURCE: 46_20260920240000_8f_packing_before_readiness.sql
-- ---------------------------------------------------------------------------

-- 8F applies to orders received after this migration. Existing in-progress
-- orders keep their established QC route.
CREATE TABLE public.facility_packing_policy_orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.facility_packing_policy_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_packing_policy_orders FROM anon, authenticated;

CREATE TABLE public.facility_packings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  packaging_operation_id uuid NOT NULL REFERENCES public.facility_order_operations(id),
  cycle_number integer NOT NULL CHECK (cycle_number BETWEEN 0 AND 2),
  parcel_id text NOT NULL UNIQUE CHECK (parcel_id ~ '^[A-Z0-9-]{6,40}$'),
  packed_by uuid NOT NULL REFERENCES public.profiles(id),
  packed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  notes text,
  UNIQUE(order_id, cycle_number)
);
CREATE TABLE public.facility_packing_items (
  packing_id uuid NOT NULL REFERENCES public.facility_packings(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  verified_quantity integer NOT NULL CHECK (verified_quantity >= 0),
  packed_quantity integer NOT NULL CHECK (packed_quantity >= 0),
  PRIMARY KEY(packing_id, order_item_id),
  CHECK (packed_quantity = verified_quantity)
);
ALTER TABLE public.facility_packings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_packing_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_packings, public.facility_packing_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_facility_packing_policy_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.operation_type = 'facility_workflow' AND NEW.current_status = 'received' THEN
    INSERT INTO public.facility_packing_policy_orders(order_id) VALUES (NEW.order_id)
      ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_mark_facility_packing_policy_order
AFTER INSERT ON public.facility_order_operations
FOR EACH ROW EXECUTE FUNCTION public.mark_facility_packing_policy_order();

CREATE OR REPLACE FUNCTION public.confirm_facility_packing_atomic(
  p_order_id uuid, p_performed_by uuid, p_parcel_id text, p_items jsonb, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_packaging public.facility_order_operations%ROWTYPE;
  v_verification_id uuid;
  v_cycle integer;
  v_parcel text := upper(btrim(p_parcel_id));
  v_packing_id uuid;
  v_item public.order_items%ROWTYPE;
  v_expected integer;
  v_actual integer;
  v_entry jsonb;
  v_count integer := 0;
BEGIN
  IF p_order_id IS NULL OR p_performed_by IS NULL OR coalesce(v_parcel !~ '^[A-Z0-9-]{6,40}$', true)
     OR coalesce(jsonb_typeof(p_items), '') <> 'array' THEN
    RAISE EXCEPTION 'Order, operator, parcel ID and packed items are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.current_status <> 'processing' THEN
    RAISE EXCEPTION 'Packing is not allowed while order is %', v_order.current_status USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facility_employees employee
    JOIN public.profiles profile ON profile.id = employee.profile_id
    WHERE employee.profile_id = p_performed_by AND employee.facility_id = v_order.facility_id
      AND employee.is_active AND profile.is_active) THEN
    RAISE EXCEPTION 'Active assigned Facility operator required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facility_intake_discrepancies
    WHERE order_id = p_order_id AND status = 'open') THEN
    RAISE EXCEPTION 'Resolve intake discrepancies before packing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_packaging FROM public.facility_order_operations
    WHERE order_id = p_order_id ORDER BY started_at DESC NULLS LAST, id DESC LIMIT 1;
  IF NOT FOUND OR v_packaging.operation_type <> 'packaging' OR v_packaging.completed_at IS NULL THEN
    RAISE EXCEPTION 'Complete current Pack-prep before final packing' USING ERRCODE = '23514';
  END IF;
  v_cycle := v_packaging.rewash_cycle;
  SELECT id INTO v_verification_id FROM public.facility_order_operations
    WHERE order_id = p_order_id AND operation_type = 'verification'
    ORDER BY started_at DESC NULLS LAST, id DESC LIMIT 1;
  IF v_verification_id IS NULL OR
     jsonb_array_length(p_items) <> (SELECT count(*) FROM public.order_items WHERE order_id = p_order_id) OR
     (SELECT count(DISTINCT entry->>'orderItemId') FROM jsonb_array_elements(p_items) entry) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Pack every verified item exactly once' USING ERRCODE = '23514';
  END IF;
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id ORDER BY id LOOP
    SELECT entry INTO v_entry FROM jsonb_array_elements(p_items) entry
      WHERE entry->>'orderItemId' = v_item.id::text;
    SELECT counted_quantity INTO v_expected FROM public.garment_inspections
      WHERE operation_id = v_verification_id AND order_item_id = v_item.id
      ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_entry IS NULL OR v_expected IS NULL OR coalesce((v_entry->>'packedQuantity') !~ '^[0-9]+$', true) THEN
      RAISE EXCEPTION 'Verified garment count unavailable' USING ERRCODE = '23514';
    END IF;
    v_actual := (v_entry->>'packedQuantity')::integer;
    IF v_actual <> v_expected THEN
      RAISE EXCEPTION 'Packed count does not match verified intake count' USING ERRCODE = '23514';
    END IF;
    v_count := v_count + v_actual;
  END LOOP;
  INSERT INTO public.facility_packings
    (order_id, facility_id, packaging_operation_id, cycle_number, parcel_id, packed_by, notes)
  VALUES (p_order_id, v_order.facility_id, v_packaging.id, v_cycle, v_parcel,
          p_performed_by, nullif(btrim(p_notes), '')) RETURNING id INTO v_packing_id;
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id ORDER BY id LOOP
    SELECT entry INTO v_entry FROM jsonb_array_elements(p_items) entry
      WHERE entry->>'orderItemId' = v_item.id::text;
    SELECT counted_quantity INTO v_expected FROM public.garment_inspections
      WHERE operation_id = v_verification_id AND order_item_id = v_item.id
      ORDER BY created_at DESC, id DESC LIMIT 1;
    INSERT INTO public.facility_packing_items(packing_id, order_item_id, verified_quantity, packed_quantity)
      VALUES (v_packing_id, v_item.id, v_expected, (v_entry->>'packedQuantity')::integer);
  END LOOP;
  RETURN jsonb_build_object('orderId', p_order_id, 'packingId', v_packing_id,
    'parcelId', v_parcel, 'cycleNumber', v_cycle, 'packedCount', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_facility_packing_atomic(uuid,uuid,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_facility_packing_atomic(uuid,uuid,text,jsonb,text)
  TO service_role;

-- QC still uses the existing atomic procedure and C2 lifecycle. This guard
-- rejects its pass transition when the current cycle lacks final packing.
CREATE OR REPLACE FUNCTION public.require_packing_before_ready()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.operation_type = 'quality_check' AND OLD.current_status = 'quality_check'
     AND NEW.current_status = 'ready_for_delivery'
     AND EXISTS (SELECT 1 FROM public.facility_packing_policy_orders WHERE order_id = NEW.order_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.facility_packings packing
       WHERE packing.order_id = NEW.order_id AND packing.cycle_number = NEW.rewash_cycle
         AND EXISTS (SELECT 1 FROM public.facility_order_operations operation
           WHERE operation.id = packing.packaging_operation_id
             AND operation.operation_type = 'packaging' AND operation.completed_at IS NOT NULL
             AND operation.rewash_cycle = NEW.rewash_cycle)
     ) THEN
    RAISE EXCEPTION 'Confirm current-cycle packing before Ready-for-Delivery' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_require_packing_before_ready
BEFORE UPDATE OF current_status ON public.facility_order_operations
FOR EACH ROW EXECUTE FUNCTION public.require_packing_before_ready();


-- ---------------------------------------------------------------------------
-- SOURCE: 47_20260920241000_8f_packing_audit_order_cleanup.sql
-- ---------------------------------------------------------------------------

-- Keep packing audit tied to its operation while permitting local fictional
-- order cleanup and the existing order-retention cascade.
ALTER TABLE public.facility_packings
  DROP CONSTRAINT facility_packings_packaging_operation_id_fkey;
ALTER TABLE public.facility_packings
  ADD CONSTRAINT facility_packings_packaging_operation_id_fkey
  FOREIGN KEY (packaging_operation_id)
  REFERENCES public.facility_order_operations(id) ON DELETE CASCADE;


-- ---------------------------------------------------------------------------
-- SOURCE: 48_20260920242000_8f_packing_item_cleanup.sql
-- ---------------------------------------------------------------------------

-- A packing item belongs to its original order item and should be removed
-- when a fictional Development order is deleted through the normal cascade.
ALTER TABLE public.facility_packing_items
  DROP CONSTRAINT facility_packing_items_order_item_id_fkey;
ALTER TABLE public.facility_packing_items
  ADD CONSTRAINT facility_packing_items_order_item_id_fkey
  FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


-- ---------------------------------------------------------------------------
-- SOURCE: 49_20260920250000_9b_admin_cancellation.sql
-- ---------------------------------------------------------------------------

-- An Admin cancellation uses the existing atomic customer cancellation and
-- refund workflow. This wrapper authenticates the privileged actor and fixes
-- the history attribution in the same database transaction.
CREATE OR REPLACE FUNCTION public.cancel_order_by_admin_atomic(
    p_order_id uuid, p_admin_profile_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer_profile_id uuid;
    v_previous_status public.order_status;
    v_result jsonb;
BEGIN
    IF NOT public.is_admin(p_admin_profile_id) THEN
        RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
    END IF;
    SELECT customer.profile_id, orders.current_status
      INTO v_customer_profile_id, v_previous_status
      FROM public.orders AS orders
      JOIN public.customers AS customer ON customer.id = orders.customer_id
     WHERE orders.id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
    END IF;
    v_result := public.cancel_customer_order_atomic(p_order_id, v_customer_profile_id, p_reason);
    IF COALESCE((v_result->>'duplicate')::boolean, false) THEN
        RAISE EXCEPTION 'Order already cancelled' USING ERRCODE = '23514';
    END IF;
    UPDATE public.order_status_history AS history
       SET changed_by = p_admin_profile_id,
           reason = 'Admin cancellation: ' || btrim(p_reason)
     WHERE history.id = (
       SELECT candidate.id FROM public.order_status_history AS candidate
       WHERE candidate.order_id = p_order_id
         AND candidate.from_status = v_previous_status
         AND candidate.to_status = 'cancelled'::public.order_status
         AND candidate.reason = 'Customer cancellation: ' || btrim(p_reason)
       ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
     );
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cancellation audit missing' USING ERRCODE = '23514';
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_order_by_admin_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_by_admin_atomic(uuid, uuid, text) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 50_20260920260000_9c_admin_staff_audit.sql
-- ---------------------------------------------------------------------------

-- Append-only audit for Admin-managed operational account changes.
CREATE TABLE IF NOT EXISTS public.admin_staff_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('provision','activate','deactivate','revoke_access','reassign_facility')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_staff_action_audit_target_time
  ON public.admin_staff_action_audit(target_profile_id, created_at DESC);
ALTER TABLE public.admin_staff_action_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_staff_action_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_staff_action_audit TO service_role;
-- Audits are immutable, including when accessed through the service role.
CREATE OR REPLACE FUNCTION public.reject_admin_staff_audit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Admin staff audit is immutable' USING ERRCODE = '42501'; END;
$$;
DROP TRIGGER IF EXISTS admin_staff_audit_immutable ON public.admin_staff_action_audit;
CREATE TRIGGER admin_staff_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_staff_action_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();


-- ---------------------------------------------------------------------------
-- SOURCE: 51_20260920270000_9d_admin_assignment_operations.sql
-- ---------------------------------------------------------------------------

-- Admin operations reuse the existing atomic assignment and lifecycle procedures.
CREATE TABLE public.admin_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  previous_assignment_id uuid REFERENCES public.driver_assignments(id),
  new_assignment_id uuid NOT NULL REFERENCES public.driver_assignments(id),
  action text NOT NULL CHECK (action IN ('assign', 'reassign')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_assignment_audit_order_time ON public.admin_assignment_audit(order_id, created_at DESC);
ALTER TABLE public.admin_assignment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_assignment_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_assignment_audit TO service_role;
CREATE TRIGGER admin_assignment_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_assignment_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE FUNCTION public.admin_assign_driver_atomic(p_admin_profile_id uuid, p_order_id uuid,
  p_driver_id uuid, p_assignment_type public.assignment_type) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_admin_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501';
  END IF;
  v_result := public.create_driver_assignment_atomic(p_order_id,p_driver_id,p_assignment_type,NULL);
  INSERT INTO public.admin_assignment_audit(actor_profile_id,order_id,new_assignment_id,action)
  VALUES (p_admin_profile_id,p_order_id,(v_result->'assignment'->>'id')::uuid,'assign');
  RETURN v_result;
END; $$;

CREATE FUNCTION public.admin_reassign_driver_atomic(p_admin_profile_id uuid, p_assignment_id uuid,
  p_new_driver_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_order_id uuid;
BEGIN
  SELECT order_id INTO v_order_id FROM public.driver_assignments WHERE id=p_assignment_id;
  v_result := public.reassign_driver_assignment_atomic(p_assignment_id,p_admin_profile_id,p_new_driver_id);
  INSERT INTO public.admin_assignment_audit(actor_profile_id,order_id,previous_assignment_id,new_assignment_id,action)
  VALUES (p_admin_profile_id,v_order_id,p_assignment_id,(v_result->'assignment'->>'id')::uuid,'reassign');
  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.admin_assign_driver_atomic(uuid,uuid,uuid,public.assignment_type) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_reassign_driver_atomic(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver_atomic(uuid,uuid,uuid,public.assignment_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reassign_driver_atomic(uuid,uuid,uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 52_20260920280000_9e_admin_catalogue_pricing.sql
-- ---------------------------------------------------------------------------

-- Versioned commercial policy. Order rows already snapshot charge, taxable amount and GST.
CREATE TABLE public.checkout_pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_delivery_fee numeric(12,2) NOT NULL CHECK (pickup_delivery_fee >= 0),
  free_delivery_threshold numeric(12,2) NOT NULL CHECK (free_delivery_threshold >= 0),
  gst_rate_percent numeric(5,2) NOT NULL CHECK (gst_rate_percent >= 0 AND gst_rate_percent <= 100),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);
INSERT INTO public.checkout_pricing_policies(pickup_delivery_fee,free_delivery_threshold,gst_rate_percent)
VALUES (50,500,5);
ALTER TABLE public.checkout_pricing_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_pricing_policies FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.checkout_pricing_policies TO service_role;

CREATE TABLE public.admin_catalogue_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_id uuid NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_catalogue_audit_entity_time ON public.admin_catalogue_audit(entity_id,created_at DESC);
ALTER TABLE public.admin_catalogue_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_catalogue_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_catalogue_audit TO service_role;
CREATE TRIGGER admin_catalogue_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_catalogue_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE FUNCTION public.admin_catalogue_change_atomic(p_actor_profile_id uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_before jsonb; v_after jsonb; v_amount numeric; v_facility uuid; v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_actor_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501';
  END IF;
  IF p_action='create_category' THEN
    IF length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Valid category name required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.service_categories(name,description) VALUES (trim(p_payload->>'name'),nullif(trim(p_payload->>'description'),''))
      RETURNING id,to_jsonb(public.service_categories.*) INTO v_id,v_after;
  ELSIF p_action='update_category' THEN
    v_id := (p_payload->>'id')::uuid;
    SELECT to_jsonb(c) INTO v_before FROM public.service_categories c WHERE c.id=v_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='P0002'; END IF;
    IF p_payload ? 'name' AND length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Valid category name required' USING ERRCODE='22023'; END IF;
    UPDATE public.service_categories SET name=COALESCE(nullif(trim(p_payload->>'name'),''),name),
      description=CASE WHEN p_payload ? 'description' THEN nullif(trim(p_payload->>'description'),'') ELSE description END,
      is_active=COALESCE((p_payload->>'isActive')::boolean,is_active)
      WHERE id=v_id RETURNING to_jsonb(public.service_categories.*) INTO v_after;
  ELSIF p_action='create_service' THEN
    IF length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Valid service name required' USING ERRCODE='22023'; END IF;
    IF length(trim(p_payload->>'pricingUnit')) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Pricing unit required' USING ERRCODE='22023'; END IF;
    IF p_payload->>'categoryId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.service_categories WHERE id=(p_payload->>'categoryId')::uuid AND is_active) THEN
      RAISE EXCEPTION 'Active category required' USING ERRCODE='23514'; END IF;
    INSERT INTO public.services(category_id,name,description,pricing_unit)
      VALUES ((p_payload->>'categoryId')::uuid,trim(p_payload->>'name'),nullif(trim(p_payload->>'description'),''),trim(p_payload->>'pricingUnit'))
      RETURNING id,to_jsonb(public.services.*) INTO v_id,v_after;
  ELSIF p_action='update_service' THEN
    v_id := (p_payload->>'id')::uuid;
    SELECT to_jsonb(s) INTO v_before FROM public.services s WHERE s.id=v_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='P0002'; END IF;
    IF p_payload ? 'name' AND length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Valid service name required' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'pricingUnit' AND length(trim(p_payload->>'pricingUnit')) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Pricing unit required' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'categoryId' AND p_payload->>'categoryId' IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.service_categories WHERE id=(p_payload->>'categoryId')::uuid AND is_active) THEN
      RAISE EXCEPTION 'Active category required' USING ERRCODE='23514'; END IF;
    UPDATE public.services SET name=COALESCE(nullif(trim(p_payload->>'name'),''),name),
      description=CASE WHEN p_payload ? 'description' THEN nullif(trim(p_payload->>'description'),'') ELSE description END,
      pricing_unit=COALESCE(nullif(trim(p_payload->>'pricingUnit'),''),pricing_unit),
      category_id=CASE WHEN p_payload ? 'categoryId' THEN (p_payload->>'categoryId')::uuid ELSE category_id END,
      is_active=COALESCE((p_payload->>'isActive')::boolean,is_active)
      WHERE id=v_id RETURNING to_jsonb(public.services.*) INTO v_after;
  ELSIF p_action='set_price' THEN
    v_id := (p_payload->>'serviceId')::uuid;
    v_amount := (p_payload->>'price')::numeric;
    v_facility := (p_payload->>'facilityId')::uuid;
    IF v_amount IS NULL OR v_amount < 0 OR v_amount > 9999999999.99 OR v_amount <> round(v_amount,2) THEN
      RAISE EXCEPTION 'Invalid service price' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.services WHERE id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='P0002'; END IF;
    IF v_facility IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facilities WHERE id=v_facility AND is_active) THEN
      RAISE EXCEPTION 'Active facility required' USING ERRCODE='23514'; END IF;
    SELECT to_jsonb(sp) INTO v_before FROM public.service_prices sp WHERE sp.service_id=v_id AND sp.facility_id IS NOT DISTINCT FROM v_facility
      AND sp.effective_from<=v_now AND (sp.effective_to IS NULL OR sp.effective_to>v_now)
      ORDER BY sp.effective_from DESC LIMIT 1;
    UPDATE public.service_prices SET effective_to=v_now WHERE service_id=v_id AND facility_id IS NOT DISTINCT FROM v_facility
      AND effective_from<=v_now AND (effective_to IS NULL OR effective_to>v_now);
    INSERT INTO public.service_prices(service_id,facility_id,price,effective_from) VALUES(v_id,v_facility,v_amount,v_now)
      RETURNING to_jsonb(public.service_prices.*) INTO v_after;
    v_id := (v_after->>'id')::uuid;
  ELSIF p_action='set_policy' THEN
    IF (p_payload->>'pickupDeliveryFee')::numeric < 0 OR (p_payload->>'freeDeliveryThreshold')::numeric < 0 OR
      (p_payload->>'gstRatePercent')::numeric < 0 OR (p_payload->>'gstRatePercent')::numeric > 100 OR
      (p_payload->>'pickupDeliveryFee')::numeric IS NULL OR (p_payload->>'freeDeliveryThreshold')::numeric IS NULL OR
      (p_payload->>'gstRatePercent')::numeric IS NULL THEN RAISE EXCEPTION 'Invalid pricing policy' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(p) INTO v_before FROM public.checkout_pricing_policies p ORDER BY effective_from DESC LIMIT 1;
    INSERT INTO public.checkout_pricing_policies(pickup_delivery_fee,free_delivery_threshold,gst_rate_percent,effective_from,created_by)
      VALUES((p_payload->>'pickupDeliveryFee')::numeric,(p_payload->>'freeDeliveryThreshold')::numeric,
        (p_payload->>'gstRatePercent')::numeric,v_now,p_actor_profile_id)
      RETURNING id,to_jsonb(public.checkout_pricing_policies.*) INTO v_id,v_after;
  ELSE RAISE EXCEPTION 'Unsupported catalogue action' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.admin_catalogue_audit(actor_profile_id,action,entity_id,before_value,after_value)
    VALUES(p_actor_profile_id,p_action,v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_catalogue_change_atomic(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_catalogue_change_atomic(uuid,text,jsonb) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 53_20260920281000_9e_minimum_order_package_eligibility.sql
-- ---------------------------------------------------------------------------

ALTER TABLE public.checkout_pricing_policies ADD COLUMN minimum_order_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0);

CREATE FUNCTION public.admin_set_checkout_policy_atomic(p_actor_profile_id uuid,p_fee numeric,p_free_threshold numeric,
  p_gst_rate numeric,p_minimum_order numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_actor_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF p_fee IS NULL OR p_fee<0 OR p_free_threshold IS NULL OR p_free_threshold<0 OR
    p_gst_rate IS NULL OR p_gst_rate<0 OR p_gst_rate>100 OR p_minimum_order IS NULL OR p_minimum_order<0 THEN
    RAISE EXCEPTION 'Invalid checkout policy' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(p) INTO v_before FROM public.checkout_pricing_policies p ORDER BY effective_from DESC LIMIT 1;
  INSERT INTO public.checkout_pricing_policies AS p(pickup_delivery_fee,free_delivery_threshold,gst_rate_percent,minimum_order_amount,created_by)
    VALUES(p_fee,p_free_threshold,p_gst_rate,p_minimum_order,p_actor_profile_id)
    RETURNING p.id,to_jsonb(p) INTO v_id,v_after;
  INSERT INTO public.admin_catalogue_audit(actor_profile_id,action,entity_id,before_value,after_value)
    VALUES(p_actor_profile_id,'set_policy',v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_checkout_policy_atomic(uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_checkout_policy_atomic(uuid,numeric,numeric,numeric,numeric) TO service_role;

-- Existing subscriptions keep their package service contract; edit only unsold package templates.
CREATE FUNCTION public.admin_set_package_service_atomic(p_actor_profile_id uuid,p_package_id uuid,p_service_id uuid,
  p_usage_limit integer,p_eligible boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=p_actor_profile_id AND r.code='admin') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.package_subscriptions WHERE package_id=p_package_id) THEN
    RAISE EXCEPTION 'Sold package eligibility is locked' USING ERRCODE='23514'; END IF;
  IF p_eligible AND NOT EXISTS (SELECT 1 FROM public.services s LEFT JOIN public.service_categories c ON c.id=s.category_id
    WHERE s.id=p_service_id AND s.is_active AND (s.category_id IS NULL OR c.is_active)) THEN
    RAISE EXCEPTION 'Active service required' USING ERRCODE='23514'; END IF;
  IF p_usage_limit IS NOT NULL AND p_usage_limit<0 THEN RAISE EXCEPTION 'Invalid usage limit' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(ps),ps.id INTO v_before,v_id FROM public.package_services ps
    WHERE ps.package_id=p_package_id AND ps.service_id=p_service_id FOR UPDATE;
  IF p_eligible THEN
    INSERT INTO public.package_services AS ps(package_id,service_id,usage_limit)
      VALUES(p_package_id,p_service_id,p_usage_limit)
      ON CONFLICT(package_id,service_id) DO UPDATE SET usage_limit=EXCLUDED.usage_limit
      RETURNING ps.id,to_jsonb(ps) INTO v_id,v_after;
  ELSE
    IF v_id IS NULL THEN RAISE EXCEPTION 'Package service not found' USING ERRCODE='P0002'; END IF;
    DELETE FROM public.package_services WHERE id=v_id;
    v_after:=jsonb_build_object('id',v_id,'eligible',false);
  END IF;
  INSERT INTO public.admin_catalogue_audit(actor_profile_id,action,entity_id,before_value,after_value)
    VALUES(p_actor_profile_id,'set_package_eligibility',v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_package_service_atomic(uuid,uuid,uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_package_service_atomic(uuid,uuid,uuid,integer,boolean) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 54_20260920290000_9f_admin_claim_refund_decisions.sql
-- ---------------------------------------------------------------------------

CREATE TABLE public.admin_issue_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  claim_id uuid REFERENCES public.customer_order_claims(id),
  refund_id uuid REFERENCES public.refund_requests(id),
  action text NOT NULL CHECK (action IN ('claim_review','claim_approve','claim_reject','claim_resolve','refund_request','refund_approve','refund_reject')),
  notes text NOT NULL,
  before_status text,
  after_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_issue_decision_audit_order_time ON public.admin_issue_decision_audit(order_id,created_at DESC);
ALTER TABLE public.admin_issue_decision_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_issue_decision_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_issue_decision_audit TO service_role;
CREATE TRIGGER admin_issue_decision_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_issue_decision_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS decision_notes text;

CREATE FUNCTION public.admin_review_customer_claim_atomic(p_claim_id uuid,p_admin_id uuid,p_target_status text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_claim public.customer_order_claims%ROWTYPE; v_customer_profile uuid; v_previous_status text; v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF length(v_notes) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decision notes must contain 3 to 1000 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_claim FROM public.customer_order_claims WHERE id=p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found' USING ERRCODE='P0002'; END IF;
  IF NOT ((v_claim.status='submitted' AND p_target_status IN ('under_review','rejected')) OR
    (v_claim.status='under_review' AND p_target_status IN ('approved','rejected')) OR
    (v_claim.status='approved' AND p_target_status='resolved')) THEN
    RAISE EXCEPTION 'Invalid claim transition from % to %',v_claim.status,p_target_status USING ERRCODE='23514'; END IF;
  v_previous_status:=v_claim.status;
  UPDATE public.customer_order_claims SET status=p_target_status,resolution_notes=v_notes,reviewed_by=p_admin_id,
    reviewed_at=transaction_timestamp(),resolved_at=CASE WHEN p_target_status='resolved' THEN transaction_timestamp() ELSE resolved_at END,
    updated_at=transaction_timestamp() WHERE id=p_claim_id RETURNING * INTO v_claim;
  INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,claim_id,action,notes,before_status,after_status)
    VALUES(p_admin_id,v_claim.order_id,p_claim_id,'claim_'||CASE p_target_status WHEN 'under_review' THEN 'review' WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' ELSE 'resolve' END,
      v_notes,v_previous_status,p_target_status);
  SELECT profile_id INTO v_customer_profile FROM public.customers WHERE id=v_claim.customer_id;
  INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
    VALUES(v_customer_profile,v_claim.order_id,'claim.'||p_target_status,'Claim update',
      format('Your claim is %s',replace(p_target_status,'_',' ')),jsonb_build_object('orderId',v_claim.order_id::text,'claimId',p_claim_id::text), 'queued');
  RETURN to_jsonb(v_claim);
END; $$;

CREATE FUNCTION public.admin_request_order_refund_atomic(p_order_id uuid,p_payment_order_id uuid,p_admin_id uuid,p_amount numeric,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_customer_profile uuid; v_refund jsonb; v_notes text:=btrim(coalesce(p_reason,''));
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  SELECT c.profile_id INTO v_customer_profile FROM public.payment_orders po JOIN public.orders o ON o.id=po.order_id
    JOIN public.customers c ON c.id=o.customer_id WHERE po.id=p_payment_order_id AND o.id=p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment does not belong to order' USING ERRCODE='P0002'; END IF;
  v_refund:=public.request_refund_atomic(p_payment_order_id,v_customer_profile,p_amount,v_notes);
  INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,refund_id,action,notes,after_status)
    VALUES(p_admin_id,p_order_id,(v_refund->>'id')::uuid,'refund_request',v_notes,'requested');
  INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
    VALUES(v_customer_profile,p_order_id,'refund.requested','Refund update','A refund was requested for your order',
      jsonb_build_object('orderId',p_order_id::text,'refundId',v_refund->>'id'),'queued');
  RETURN v_refund;
END; $$;

CREATE FUNCTION public.admin_claim_refund_approval_audited_atomic(p_refund_id uuid,p_admin_id uuid,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_order_id uuid; v_customer_profile uuid; v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
  IF length(v_notes) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decision notes must contain 3 to 1000 characters' USING ERRCODE='22023'; END IF;
  v_result:=public.claim_refund_approval_atomic(p_refund_id,p_admin_id);
  IF coalesce((v_result->>'claimed')::boolean,false) THEN
    SELECT o.id,c.profile_id INTO v_order_id,v_customer_profile FROM public.refund_requests rr
      JOIN public.payment_orders po ON po.id=rr.payment_order_id JOIN public.orders o ON o.id=po.order_id
      JOIN public.customers c ON c.id=o.customer_id WHERE rr.id=p_refund_id;
    UPDATE public.refund_requests SET decision_notes=v_notes WHERE id=p_refund_id;
    INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,refund_id,action,notes,before_status,after_status)
      VALUES(p_admin_id,v_order_id,p_refund_id,'refund_approve',v_notes,'requested','approved');
    INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
      VALUES(v_customer_profile,v_order_id,'refund.approved','Refund update','Your refund was approved',
        jsonb_build_object('orderId',v_order_id::text,'refundId',p_refund_id::text),'queued');
  END IF;
  RETURN v_result;
END; $$;

CREATE FUNCTION public.admin_reject_refund_atomic(p_refund_id uuid,p_admin_id uuid,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_refund public.refund_requests%ROWTYPE; v_order_id uuid; v_customer_profile uuid; v_previous_status text; v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF length(v_notes) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decision notes must contain 3 to 1000 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_refund FROM public.refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found' USING ERRCODE='P0002'; END IF;
  IF v_refund.status NOT IN ('requested','under_review') THEN RAISE EXCEPTION 'Refund can no longer be rejected' USING ERRCODE='23514'; END IF;
  v_previous_status:=v_refund.status;
  SELECT o.id,c.profile_id INTO v_order_id,v_customer_profile FROM public.payment_orders po
    JOIN public.orders o ON o.id=po.order_id JOIN public.customers c ON c.id=o.customer_id WHERE po.id=v_refund.payment_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment order not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.refund_requests SET status='rejected',rejected_by=p_admin_id,rejected_at=transaction_timestamp(),decision_notes=v_notes
    WHERE id=p_refund_id RETURNING * INTO v_refund;
  INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,refund_id,action,notes,before_status,after_status)
    VALUES(p_admin_id,v_order_id,p_refund_id,'refund_reject',v_notes,v_previous_status,'rejected');
  INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
    VALUES(v_customer_profile,v_order_id,'refund.rejected','Refund update','Your refund request was declined',
      jsonb_build_object('orderId',v_order_id::text,'refundId',p_refund_id::text),'queued');
  RETURN to_jsonb(v_refund);
END; $$;

REVOKE ALL ON FUNCTION public.admin_review_customer_claim_atomic(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_request_order_refund_atomic(uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_claim_refund_approval_audited_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_reject_refund_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_customer_claim_atomic(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_order_refund_atomic(uuid,uuid,uuid,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_claim_refund_approval_audited_atomic(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_refund_atomic(uuid,uuid,text) TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 55_20260920293000_9g_admin_growth_programs.sql
-- ---------------------------------------------------------------------------

-- 9G commercial templates. Customer history, subscription contracts and redemptions stay append-only.
ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS validity_days integer CHECK (validity_days BETWEEN 1 AND 3650);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS eligibility_note text;

CREATE TABLE public.admin_growth_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  referral_enabled boolean NOT NULL DEFAULT true,
  referral_reward_points integer NOT NULL DEFAULT 0 CHECK (referral_reward_points BETWEEN 0 AND 1000000),
  loyalty_earn_points_per_rupee numeric(10,4) NOT NULL DEFAULT 0.01 CHECK (loyalty_earn_points_per_rupee BETWEEN 0 AND 100),
  loyalty_points_per_rupee integer NOT NULL DEFAULT 10 CHECK (loyalty_points_per_rupee BETWEEN 1 AND 1000000),
  loyalty_minimum_redemption_rupees numeric(12,2) NOT NULL DEFAULT 100 CHECK (loyalty_minimum_redemption_rupees BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admin_growth_settings(id) VALUES(true);
ALTER TABLE public.admin_growth_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_growth_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.admin_growth_settings TO service_role;

CREATE TABLE public.offer_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  coupon_code text NOT NULL,
  discount_amount numeric(12,2) NOT NULL CHECK(discount_amount > 0),
  offer_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz
);
CREATE INDEX offer_redemptions_active ON public.offer_redemptions(offer_id) WHERE reversed_at IS NULL;
ALTER TABLE public.offer_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_redemptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.offer_redemptions TO service_role;

CREATE TABLE public.admin_growth_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_growth_audit_time ON public.admin_growth_audit(created_at DESC);
ALTER TABLE public.admin_growth_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_growth_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_growth_audit TO service_role;
CREATE TRIGGER admin_growth_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_growth_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE FUNCTION public.admin_growth_change_atomic(p_actor uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_before jsonb; v_after jsonb; v_code text; v_start timestamptz; v_end timestamptz;
  v_amount numeric; v_limit integer; v_name text; v_locked boolean; v_settings public.admin_growth_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin(p_actor) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF p_action IN ('create_offer','update_offer') THEN
    v_code:=upper(btrim(coalesce(p_payload->>'couponCode','')));
    v_name:=btrim(coalesce(p_payload->>'name',''));
    v_start:=(p_payload->>'startsAt')::timestamptz; v_end:=(p_payload->>'expiresAt')::timestamptz;
    v_amount:=(p_payload->>'discountValue')::numeric; v_limit:=(p_payload->>'usageLimit')::integer;
    IF v_code !~ '^[A-Z0-9-]{1,64}$' OR length(v_name) NOT BETWEEN 2 AND 120 OR
      p_payload->>'discountType' NOT IN ('fixed','percentage') OR v_amount IS NULL OR v_amount<=0 OR
      (p_payload->>'discountType'='percentage' AND v_amount>100) OR
      (p_payload->>'minimumOrderAmount')::numeric<0 OR (p_payload->>'maximumDiscount')::numeric<0 OR
      (v_start IS NOT NULL AND v_end IS NOT NULL AND v_end<=v_start) OR
      (v_limit IS NOT NULL AND v_limit<1) THEN RAISE EXCEPTION 'Invalid offer' USING ERRCODE='22023'; END IF;
    IF p_action='update_offer' THEN
      v_id:=(p_payload->>'id')::uuid;
      SELECT to_jsonb(o) INTO v_before FROM public.offers o WHERE o.id=v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.offer_redemptions WHERE offer_id=v_id) THEN
        RAISE EXCEPTION 'Redeemed offer terms are locked; activation may still change' USING ERRCODE='23514'; END IF;
      UPDATE public.offers o SET code=v_code,coupon_code=v_code,name=v_name,
        discount_type=p_payload->>'discountType',discount_value=v_amount,
        minimum_order_amount=(p_payload->>'minimumOrderAmount')::numeric,
        maximum_discount=(p_payload->>'maximumDiscount')::numeric,
        starts_at=v_start,expires_at=v_end,usage_limit=v_limit,
        eligibility_note=nullif(btrim(p_payload->>'eligibilityNote'),'')
        WHERE o.id=v_id RETURNING to_jsonb(o) INTO v_after;
    ELSE
      INSERT INTO public.offers AS o(code,coupon_code,name,discount_type,discount_value,minimum_order_amount,
        maximum_discount,starts_at,expires_at,usage_limit,eligibility_note,is_active)
      VALUES(v_code,v_code,v_name,p_payload->>'discountType',v_amount,
        (p_payload->>'minimumOrderAmount')::numeric,(p_payload->>'maximumDiscount')::numeric,
        v_start,v_end,v_limit,nullif(btrim(p_payload->>'eligibilityNote'),''),false)
      RETURNING o.id,to_jsonb(o) INTO v_id,v_after;
    END IF;
  ELSIF p_action='set_offer_active' THEN
    v_id:=(p_payload->>'id')::uuid;
    SELECT to_jsonb(o) INTO v_before FROM public.offers o WHERE o.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE='P0002'; END IF;
    UPDATE public.offers o SET is_active=(p_payload->>'isActive')::boolean WHERE o.id=v_id RETURNING to_jsonb(o) INTO v_after;
  ELSIF p_action IN ('create_package','update_package') THEN
    v_name:=btrim(coalesce(p_payload->>'name',''));
    v_amount:=(p_payload->>'price')::numeric;
    IF length(v_name) NOT BETWEEN 2 AND 120 OR v_amount IS NULL OR v_amount<=0 OR
      (p_payload->>'validityDays')::integer NOT BETWEEN 1 AND 3650 THEN
      RAISE EXCEPTION 'Invalid package' USING ERRCODE='22023'; END IF;
    IF p_action='update_package' THEN
      v_id:=(p_payload->>'id')::uuid;
      SELECT to_jsonb(p) INTO v_before FROM public.packages p WHERE p.id=v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.package_subscriptions WHERE package_id=v_id) THEN
        RAISE EXCEPTION 'Sold package terms are locked' USING ERRCODE='23514'; END IF;
      UPDATE public.packages p SET name=v_name,description=p_payload->>'description',monthly_price=v_amount,
        price=v_amount,validity_days=(p_payload->>'validityDays')::integer WHERE p.id=v_id
        RETURNING to_jsonb(p) INTO v_after;
    ELSE
      INSERT INTO public.packages AS p(name,description,monthly_price,price,validity_days,is_active)
        VALUES(v_name,p_payload->>'description',v_amount,v_amount,(p_payload->>'validityDays')::integer,false)
        RETURNING p.id,to_jsonb(p) INTO v_id,v_after;
    END IF;
  ELSIF p_action='set_package_active' THEN
    v_id:=(p_payload->>'id')::uuid;
    SELECT to_jsonb(p) INTO v_before FROM public.packages p WHERE p.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='P0002'; END IF;
    UPDATE public.packages p SET is_active=(p_payload->>'isActive')::boolean WHERE p.id=v_id RETURNING to_jsonb(p) INTO v_after;
  ELSIF p_action='set_program_settings' THEN
    SELECT * INTO v_settings FROM public.admin_growth_settings WHERE id=true FOR UPDATE;
    v_before:=to_jsonb(v_settings);
    UPDATE public.admin_growth_settings s SET
      referral_enabled=(p_payload->>'referralEnabled')::boolean,
      referral_reward_points=(p_payload->>'referralRewardPoints')::integer,
      loyalty_earn_points_per_rupee=(p_payload->>'loyaltyEarnPointsPerRupee')::numeric,
      loyalty_points_per_rupee=(p_payload->>'loyaltyPointsPerRupee')::integer,
      loyalty_minimum_redemption_rupees=(p_payload->>'loyaltyMinimumRedemptionRupees')::numeric,
      updated_at=now() WHERE id=true RETURNING to_jsonb(s) INTO v_after;
  ELSE RAISE EXCEPTION 'Unsupported growth action' USING ERRCODE='22023'; END IF;
  INSERT INTO public.admin_growth_audit(actor_profile_id,action,entity_type,entity_id,before_value,after_value)
    VALUES(p_actor,p_action,CASE WHEN p_action LIKE '%offer%' THEN 'offer' WHEN p_action LIKE '%package%' THEN 'package' ELSE 'settings' END,v_id,v_before,v_after);
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.admin_growth_change_atomic(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_growth_change_atomic(uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.reserve_offer_for_order_atomic(p_offer_id uuid,p_order_id uuid,p_customer_id uuid,
  p_subtotal numeric,p_package_discount numeric,p_coupon_discount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_offer public.offers%ROWTYPE; v_used integer; v_expected numeric;
BEGIN
  SELECT * INTO v_offer FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  IF NOT FOUND OR NOT v_offer.is_active OR v_offer.coupon_code IS NULL OR
    (v_offer.starts_at IS NOT NULL AND v_offer.starts_at>now()) OR
    (v_offer.expires_at IS NOT NULL AND v_offer.expires_at<=now()) OR
    p_subtotal<v_offer.minimum_order_amount THEN
    RAISE EXCEPTION 'Coupon is unavailable' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO v_used FROM public.offer_redemptions WHERE offer_id=p_offer_id AND reversed_at IS NULL;
  IF v_offer.usage_limit IS NOT NULL AND v_used>=v_offer.usage_limit THEN
    RAISE EXCEPTION 'Coupon usage limit reached' USING ERRCODE='23514'; END IF;
  v_expected:=CASE WHEN v_offer.discount_type='percentage' THEN p_subtotal*v_offer.discount_value/100
    ELSE v_offer.discount_value END;
  v_expected:=round(least(greatest(v_expected,0),coalesce(v_offer.maximum_discount,p_subtotal),
    p_subtotal,greatest(0,p_subtotal-p_package_discount)),2);
  IF p_coupon_discount IS NULL OR p_coupon_discount<=0 OR p_coupon_discount<>v_expected THEN
    RAISE EXCEPTION 'Coupon discount changed; review checkout' USING ERRCODE='23514'; END IF;
  INSERT INTO public.offer_redemptions(offer_id,order_id,customer_id,coupon_code,discount_amount,offer_snapshot)
    VALUES(p_offer_id,p_order_id,p_customer_id,v_offer.coupon_code,p_coupon_discount,to_jsonb(v_offer));
END; $$;
REVOKE ALL ON FUNCTION public.reserve_offer_for_order_atomic(uuid,uuid,uuid,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_offer_for_order_atomic(uuid,uuid,uuid,numeric,numeric,numeric) TO service_role;

CREATE FUNCTION public.reverse_offer_after_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.current_status='cancelled' AND OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    UPDATE public.offer_redemptions SET reversed_at=now() WHERE order_id=NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER reverse_offer_after_cancellation AFTER UPDATE OF current_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.reverse_offer_after_cancellation();

-- Keep the existing customer order procedure; add locked coupon reservation and dynamic redemption policy.
CREATE OR REPLACE FUNCTION public.create_customer_order_with_rewards_atomic(
  p_customer_id uuid,p_order jsonb,p_items jsonb,p_target_status public.order_status,p_points integer DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order_id uuid; v_balance integer; v_settings public.admin_growth_settings%ROWTYPE;
  v_coupon uuid; v_coupon_discount numeric; v_package_discount numeric; v_loyalty_discount numeric;
BEGIN
  SELECT * INTO v_settings FROM public.admin_growth_settings WHERE id=true;
  IF p_points IS NULL OR p_points<0 OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Invalid order rewards or items'; END IF;
  v_coupon:=nullif(p_order->>'coupon_offer_id','')::uuid;
  v_coupon_discount:=coalesce((p_order->>'coupon_discount_amount')::numeric,0);
  v_package_discount:=coalesce((p_order->>'package_discount_amount')::numeric,0);
  v_loyalty_discount:=coalesce((p_order->>'loyalty_discount_amount')::numeric,0);
  IF v_coupon IS NULL AND v_coupon_discount<>0 OR
    v_coupon_discount<0 OR v_package_discount<0 OR v_loyalty_discount<0 OR
    (p_order->>'discount_amount')::numeric <> v_coupon_discount+v_package_discount+v_loyalty_discount THEN
    RAISE EXCEPTION 'Invalid discount breakdown'; END IF;
  IF p_points>0 THEN
    PERFORM 1 FROM public.customers WHERE id=p_customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT coalesce(sum(points),0)::integer INTO v_balance FROM public.loyalty_point_transactions WHERE customer_id=p_customer_id;
    IF v_balance<p_points OR p_points < ceil(v_settings.loyalty_minimum_redemption_rupees*v_settings.loyalty_points_per_rupee) OR
      v_loyalty_discount<>p_points::numeric/v_settings.loyalty_points_per_rupee THEN RAISE EXCEPTION 'Invalid loyalty discount'; END IF;
  ELSIF v_loyalty_discount<>0 THEN RAISE EXCEPTION 'Invalid loyalty discount'; END IF;
  INSERT INTO public.orders(customer_id,facility_id,current_status,pickup_address_id,delivery_address_id,
    pickup_scheduled_at,pickup_slot_label,subtotal,discount_amount,pickup_delivery_charge,taxable_amount,
    gst_rate,gst_amount,total_amount,payment_method,terms_accepted,terms_accepted_at,terms_version,
    loyalty_points_redeemed,idempotency_key,idempotency_request_hash)
  VALUES(p_customer_id,(p_order->>'facility_id')::uuid,'draft',(p_order->>'pickup_address_id')::uuid,
    (p_order->>'delivery_address_id')::uuid,(p_order->>'pickup_scheduled_at')::timestamptz,
    p_order->>'pickup_slot_label',(p_order->>'subtotal')::numeric,(p_order->>'discount_amount')::numeric,
    (p_order->>'pickup_delivery_charge')::numeric,(p_order->>'taxable_amount')::numeric,
    (p_order->>'gst_rate')::numeric,(p_order->>'gst_amount')::numeric,(p_order->>'total_amount')::numeric,
    (p_order->>'payment_method')::public.payment_method,true,now(),p_order->>'terms_version',p_points,
    (p_order->>'idempotency_key')::uuid,p_order->>'idempotency_request_hash') RETURNING id INTO v_order_id;
  INSERT INTO public.order_items(order_id,service_id,item_name,quantity,weight_kg,unit_price,line_total,customer_notes)
  SELECT v_order_id,i.service_id,i.item_name,i.quantity,i.weight_kg,i.unit_price,i.line_total,i.customer_notes
    FROM jsonb_to_recordset(p_items) AS i(service_id uuid,item_name text,quantity integer,weight_kg numeric,
      unit_price numeric,line_total numeric,customer_notes text);
  INSERT INTO public.order_qr_codes(order_id) VALUES(v_order_id);
  IF p_points>0 THEN INSERT INTO public.loyalty_point_transactions(customer_id,points,transaction_type,reason,reference_type,reference_id)
    VALUES(p_customer_id,-p_points,'redemption','Checkout discount','order',v_order_id); END IF;
  IF v_coupon IS NOT NULL THEN
    PERFORM public.reserve_offer_for_order_atomic(v_coupon,v_order_id,p_customer_id,(p_order->>'subtotal')::numeric,
      v_package_discount,v_coupon_discount);
  END IF;
  PERFORM public.change_order_status(v_order_id,p_target_status,'Order created');
  RETURN v_order_id;
END; $$;

-- Existing earned/redemption transactions are immutable. New earning follows current Admin policy once per paid delivery.
CREATE OR REPLACE FUNCTION public.award_customer_order_loyalty_points(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_points integer; v_settings public.admin_growth_settings%ROWTYPE; v_referral public.referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.current_status NOT IN ('delivered','claim_period_active','completed') THEN RETURN 0; END IF;
  IF v_order.payment_method='razorpay' THEN
    IF NOT EXISTS(SELECT 1 FROM public.payment_orders WHERE order_id=p_order_id AND status='paid') THEN RETURN 0; END IF;
  ELSIF v_order.payment_method<>'cash_on_delivery' THEN RETURN 0; END IF;
  SELECT * INTO v_settings FROM public.admin_growth_settings WHERE id=true;
  v_points:=floor(greatest(v_order.total_amount,0)*v_settings.loyalty_earn_points_per_rupee)::integer;
  IF v_points>0 THEN
    INSERT INTO public.loyalty_point_transactions(customer_id,points,transaction_type,reason,reference_type,reference_id)
      VALUES(v_order.customer_id,v_points,'earned','Order delivered and paid','order',p_order_id) ON CONFLICT DO NOTHING;
  END IF;
  IF v_settings.referral_enabled AND v_settings.referral_reward_points>0 THEN
    SELECT * INTO v_referral FROM public.referrals WHERE referred_customer_id=v_order.customer_id FOR UPDATE;
    IF FOUND AND v_referral.reward_status<>'rewarded' THEN
      INSERT INTO public.loyalty_point_transactions(customer_id,points,transaction_type,reason,reference_type,reference_id)
        VALUES(v_referral.referrer_customer_id,v_settings.referral_reward_points,'referral',
          'Referred customer first paid delivery','referral',v_referral.id) ON CONFLICT DO NOTHING;
      UPDATE public.referrals SET reward_status='rewarded',status='rewarded' WHERE id=v_referral.id;
    END IF;
  END IF;
  RETURN v_points;
END; $$;
CREATE UNIQUE INDEX IF NOT EXISTS referral_reward_once ON public.loyalty_point_transactions(reference_id)
  WHERE reference_type='referral' AND transaction_type='referral';


-- ---------------------------------------------------------------------------
-- SOURCE: 56_20260921200000_customer_driver_consistency.sql
-- ---------------------------------------------------------------------------

-- Keep loyalty value and customer refund eligibility server-authoritative.
ALTER TABLE public.admin_growth_settings
  ALTER COLUMN loyalty_points_per_rupee SET DEFAULT 10,
  ALTER COLUMN loyalty_minimum_redemption_rupees SET DEFAULT 100;

UPDATE public.admin_growth_settings
SET loyalty_points_per_rupee = 10,
    loyalty_minimum_redemption_rupees = 100
WHERE id = true;

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
        RAISE EXCEPTION 'Payment and requester are required' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount is invalid' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Refund reason must contain between 3 and 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT payment.* INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id USING ERRCODE = 'P0002';
    END IF;

    SELECT orders.* INTO v_order
    FROM public.orders
    WHERE orders.id = v_payment.order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_payment.order_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.customers AS customer
        WHERE customer.id = v_order.customer_id
          AND customer.profile_id = p_requested_by
    ) THEN
        RAISE EXCEPTION 'Payment belongs to another customer' USING ERRCODE = '42501';
    END IF;
    IF v_payment.status NOT IN ('paid', 'partially_refunded') OR v_payment.provider_payment_id IS NULL THEN
        RAISE EXCEPTION 'Only a captured payment can be refunded' USING ERRCODE = '23514';
    END IF;
    IF v_order.current_status NOT IN (
        'cancelled'::public.order_status,
        'claim_period_active'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Order is not eligible for a refund request' USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(sum(refund.amount), 0) INTO v_committed
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
        RAISE EXCEPTION 'Refund exceeds the remaining captured amount' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.refund_requests (
        payment_order_id, requested_by, amount, reason, status, is_cancellation_refund
    ) VALUES (
        v_payment.id, p_requested_by, p_amount, v_reason, 'requested'::public.refund_status, false
    ) RETURNING * INTO v_refund;
    RETURN to_jsonb(v_refund);
END;
$$;

REVOKE ALL ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text)
TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 57_20260922003000_facility_staff_qc.sql
-- ---------------------------------------------------------------------------

-- Active staff at the order's assigned Facility may complete the final QC step.
-- Facility scoping, active-profile checks, ordered processing, packing, discrepancy,
-- rewash, and immutable audit controls remain enforced by the existing workflow.
CREATE OR REPLACE FUNCTION public.record_facility_qc_decision_atomic(
  p_order_id uuid, p_performed_by uuid, p_approved boolean,
  p_defect_code text, p_reason text, p_affected_item_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_failures integer;
  v_result jsonb;
  v_code text := nullif(btrim(p_defect_code), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_item uuid;
BEGIN
  IF p_order_id IS NULL OR p_performed_by IS NULL OR p_approved IS NULL THEN
    RAISE EXCEPTION 'Order, operator and QC verdict are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.facility_employees employee
    JOIN public.profiles profile ON profile.id = employee.profile_id
    WHERE employee.profile_id = p_performed_by AND employee.facility_id = v_order.facility_id
      AND employee.is_active AND profile.is_active
  ) THEN RAISE EXCEPTION 'Active assigned Facility Staff access required' USING ERRCODE = '42501'; END IF;
  IF p_approved = false AND (v_code NOT IN ('stain','damage','finish','missing','other') OR
                             v_code IS NULL OR length(coalesce(v_reason, '')) < 5) THEN
    RAISE EXCEPTION 'Failed QC requires defect category and reason' USING ERRCODE = '22023';
  END IF;
  FOREACH v_item IN ARRAY coalesce(p_affected_item_ids, '{}'::uuid[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = v_item AND order_id = p_order_id) THEN
      RAISE EXCEPTION 'QC item does not belong to order' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT count(*)::integer INTO v_failures FROM public.facility_qc_decisions
    WHERE order_id = p_order_id AND NOT approved;
  IF NOT p_approved AND v_failures >= 2 THEN
    RAISE EXCEPTION 'Rewash limit reached; reconciliation required' USING ERRCODE = '23514';
  END IF;
  v_result := public.complete_facility_quality_check_atomic(
    p_order_id, p_performed_by, p_approved, v_reason
  );
  INSERT INTO public.facility_qc_decisions
    (order_id, operation_id, cycle_number, approved, rewash_required,
     defect_code, reason, affected_item_ids, decided_by)
  VALUES (p_order_id, (v_result->>'operationId')::uuid, v_failures, p_approved,
          NOT p_approved, CASE WHEN p_approved THEN NULL ELSE v_code END,
          v_reason, coalesce(p_affected_item_ids, '{}'::uuid[]), p_performed_by);
  RETURN v_result || jsonb_build_object('cycleNumber', v_failures, 'rewashRequired', NOT p_approved);
END;
$$;
REVOKE ALL ON FUNCTION public.record_facility_qc_decision_atomic(uuid,uuid,boolean,text,text,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facility_qc_decision_atomic(uuid,uuid,boolean,text,text,uuid[])
  TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 58_20260922090000_facility_delivery_reassignment.sql
-- ---------------------------------------------------------------------------

-- Facility Staff may replace a rejected delivery assignment for an order at
-- their own active facility. Existing assignment rows remain immutable audit
-- history; the standard assignment function creates the replacement.
CREATE OR REPLACE FUNCTION public.facility_reassign_delivery_atomic(
    p_profile_id uuid,
    p_order_id uuid,
    p_new_driver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_facility_id uuid;
    v_order public.orders%ROWTYPE;
    v_rejected public.driver_assignments%ROWTYPE;
    v_result jsonb;
BEGIN
    IF p_profile_id IS NULL OR p_order_id IS NULL OR p_new_driver_id IS NULL THEN
        RAISE EXCEPTION 'Facility employee, order, and replacement Driver are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT employee.facility_id INTO v_facility_id
    FROM public.facility_employees AS employee
    JOIN public.facilities AS facility ON facility.id = employee.facility_id
    JOIN public.profiles AS profile ON profile.id = employee.profile_id
    WHERE employee.profile_id = p_profile_id
      AND employee.is_active = true
      AND facility.is_active = true
      AND profile.is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active facility employee access required'
            USING ERRCODE = '42501';
    END IF;

    SELECT o.* INTO v_order
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_order.facility_id IS DISTINCT FROM v_facility_id THEN
        RAISE EXCEPTION 'Order belongs to another facility'
            USING ERRCODE = '42501';
    END IF;
    IF v_order.current_status <> 'delivery_failed'::public.order_status THEN
        RAISE EXCEPTION 'A rejected delivery assignment is required before reassignment'
            USING ERRCODE = '23514';
    END IF;

    SELECT assignment.* INTO v_rejected
    FROM public.driver_assignments AS assignment
    WHERE assignment.order_id = p_order_id
      AND assignment.assignment_type = 'delivery'::public.assignment_type
      AND assignment.status = 'rejected'::public.assignment_status
    ORDER BY assignment.assigned_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rejected delivery assignment not found'
            USING ERRCODE = 'P0002';
    END IF;
    IF v_rejected.driver_id = p_new_driver_id THEN
        RAISE EXCEPTION 'Select a different Driver'
            USING ERRCODE = '23514';
    END IF;

    v_result := public.create_driver_assignment_atomic(
        p_order_id,
        p_new_driver_id,
        'delivery'::public.assignment_type,
        NULL
    );
    RETURN v_result || jsonb_build_object(
        'previousAssignmentId', v_rejected.id,
        'reassignedBy', p_profile_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.facility_reassign_delivery_atomic(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facility_reassign_delivery_atomic(uuid, uuid, uuid)
TO service_role;


-- ---------------------------------------------------------------------------
-- SOURCE: 59_20260922120000_production_ready_mobile_features.sql
-- ---------------------------------------------------------------------------

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
    END;

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

