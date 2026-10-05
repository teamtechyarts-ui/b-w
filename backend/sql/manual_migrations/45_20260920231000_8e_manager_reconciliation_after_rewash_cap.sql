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
