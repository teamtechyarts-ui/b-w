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
