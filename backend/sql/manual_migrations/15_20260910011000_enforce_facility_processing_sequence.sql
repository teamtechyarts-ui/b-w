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
