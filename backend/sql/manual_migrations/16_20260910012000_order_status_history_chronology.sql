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
