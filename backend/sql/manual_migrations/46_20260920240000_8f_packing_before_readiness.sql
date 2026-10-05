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
