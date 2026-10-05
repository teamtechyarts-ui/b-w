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
