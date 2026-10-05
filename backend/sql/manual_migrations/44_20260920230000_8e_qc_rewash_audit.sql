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
