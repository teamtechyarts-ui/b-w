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
