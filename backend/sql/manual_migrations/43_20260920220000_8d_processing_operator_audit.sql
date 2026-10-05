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
