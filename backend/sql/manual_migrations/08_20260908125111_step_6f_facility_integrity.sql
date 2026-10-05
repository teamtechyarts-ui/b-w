-- ============================================================
-- STEP 6F-A: FACILITY INTEGRITY CONSTRAINTS & VALIDATION
-- ============================================================
--
-- Purpose:
-- Prevent cross-facility data relationships and logically
-- inconsistent operational data.
--
-- Protected relationships:
--
-- 1. Operation -> Machine
--    The machine must belong to the operation's facility.
--
-- 2. Operation -> Employee
--    The employee performing an operation must be an active
--    employee of the operation's facility.
--
-- 3. Processing Batch -> Machine
--    The machine must belong to the batch's facility.
--
-- 4. Processing Batch -> Operation
--    Operations added to a batch must belong to the same facility.
--
-- 5. Inspections -> Employees
--    Inspectors and verifiers must belong to the operation facility.
--
-- 6. Damage Reports -> Employees
--    Reporters must belong to the operation facility.
--
-- 7. Order Items -> Operations
--    Any referenced order item must belong to the same order as
--    the referenced facility operation.
--
-- ============================================================


-- ============================================================
-- HELPER FUNCTION:
-- GET FACILITY FOR A PROFILE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_active_employee_facility(
    p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_facility_id uuid;
BEGIN

    SELECT facility_id
    INTO v_facility_id
    FROM public.facility_employees
    WHERE profile_id = p_profile_id
      AND is_active = true;

    RETURN v_facility_id;

END;
$$;


-- ============================================================
-- HELPER FUNCTION:
-- VALIDATE ACTIVE FACILITY EMPLOYEE
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_active_facility_employee(
    p_profile_id uuid,
    p_facility_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    RETURN EXISTS (
        SELECT 1
        FROM public.facility_employees fe
        WHERE fe.profile_id = p_profile_id
          AND fe.facility_id = p_facility_id
          AND fe.is_active = true
    );

END;
$$;


-- ============================================================
-- 1. VALIDATE FACILITY ORDER OPERATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_facility_order_operation_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_machine_facility_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Rule 1:
    -- A machine assigned to an operation must belong to
    -- the same facility.
    -- --------------------------------------------------------

    IF NEW.machine_id IS NOT NULL THEN

        IF NEW.facility_id IS NULL THEN
            RAISE EXCEPTION
                'Cannot assign a machine to an operation without a facility';
        END IF;

        SELECT facility_id
        INTO v_machine_facility_id
        FROM public.facility_machines
        WHERE id = NEW.machine_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Machine % does not exist',
                NEW.machine_id;
        END IF;

        IF v_machine_facility_id IS DISTINCT FROM NEW.facility_id THEN
            RAISE EXCEPTION
                'Cross-facility machine assignment is not allowed. Machine belongs to facility %, operation belongs to facility %',
                v_machine_facility_id,
                NEW.facility_id;
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Rule 2:
    -- Employee performing the operation must be active and
    -- belong to the same facility.
    -- --------------------------------------------------------

    IF NEW.performed_by IS NOT NULL THEN

        IF NEW.facility_id IS NULL THEN
            RAISE EXCEPTION
                'Cannot assign performed_by without a facility';
        END IF;

        IF NOT public.validate_active_facility_employee(
            NEW.performed_by,
            NEW.facility_id
        ) THEN

            RAISE EXCEPTION
                'Profile % is not an active employee of facility %',
                NEW.performed_by,
                NEW.facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_facility_order_operation_integrity
ON public.facility_order_operations;


CREATE TRIGGER
trg_validate_facility_order_operation_integrity
BEFORE INSERT OR UPDATE
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION
public.validate_facility_order_operation_integrity();


-- ============================================================
-- 2. VALIDATE PROCESSING BATCH
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_processing_batch_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_machine_facility_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- A machine assigned to a processing batch must belong
    -- to the same facility as the batch.
    -- --------------------------------------------------------

    IF NEW.machine_id IS NOT NULL THEN

        SELECT facility_id
        INTO v_machine_facility_id
        FROM public.facility_machines
        WHERE id = NEW.machine_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Machine % does not exist',
                NEW.machine_id;
        END IF;

        IF v_machine_facility_id IS DISTINCT FROM NEW.facility_id THEN
            RAISE EXCEPTION
                'Cross-facility machine assignment is not allowed. Machine belongs to facility %, batch belongs to facility %',
                v_machine_facility_id,
                NEW.facility_id;
        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_processing_batch_integrity
ON public.facility_processing_batches;


CREATE TRIGGER
trg_validate_processing_batch_integrity
BEFORE INSERT OR UPDATE
ON public.facility_processing_batches
FOR EACH ROW
EXECUTE FUNCTION
public.validate_processing_batch_integrity();


-- ============================================================
-- 3. VALIDATE PROCESSING BATCH -> OPERATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_processing_batch_order_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_batch_facility_id uuid;
    v_operation_facility_id uuid;
BEGIN

    -- Get batch facility.

    SELECT facility_id
    INTO v_batch_facility_id
    FROM public.facility_processing_batches
    WHERE id = NEW.batch_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Processing batch % does not exist',
            NEW.batch_id;
    END IF;


    -- Get operation facility.

    SELECT facility_id
    INTO v_operation_facility_id
    FROM public.facility_order_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Facility operation % does not exist',
            NEW.operation_id;
    END IF;


    -- An operation in a processing batch must have a facility.

    IF v_operation_facility_id IS NULL THEN
        RAISE EXCEPTION
            'Operation % does not have a facility assigned',
            NEW.operation_id;
    END IF;


    -- Both must belong to the same facility.

    IF v_batch_facility_id IS DISTINCT FROM v_operation_facility_id THEN

        RAISE EXCEPTION
            'Cross-facility batch relationship is not allowed. Batch facility % does not match operation facility %',
            v_batch_facility_id,
            v_operation_facility_id;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_processing_batch_order_integrity
ON public.processing_batch_orders;


CREATE TRIGGER
trg_validate_processing_batch_order_integrity
BEFORE INSERT OR UPDATE
ON public.processing_batch_orders
FOR EACH ROW
EXECUTE FUNCTION
public.validate_processing_batch_order_integrity();


-- ============================================================
-- 4. VALIDATE GARMENT INSPECTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_garment_inspection_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_operation_facility_id uuid;
    v_operation_order_id uuid;
    v_order_item_order_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Get operation information when operation_id is provided.
    -- --------------------------------------------------------

    IF NEW.operation_id IS NOT NULL THEN

        SELECT
            facility_id,
            order_id
        INTO
            v_operation_facility_id,
            v_operation_order_id
        FROM public.facility_order_operations
        WHERE id = NEW.operation_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Operation % does not exist',
                NEW.operation_id;
        END IF;

    END IF;

    -- Validate explicit order_id against operation order.
    IF NEW.order_id IS NOT NULL
    AND NEW.operation_id IS NOT NULL THEN

        IF NEW.order_id IS DISTINCT FROM v_operation_order_id THEN
            RAISE EXCEPTION
                'Inspection order % does not match operation order %',
                NEW.order_id,
                v_operation_order_id;
        END IF;

    END IF;

    -- --------------------------------------------------------
    -- Rule:
    -- order_item must belong to the same order as operation.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL
       AND NEW.operation_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF v_order_item_order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % belongs to order %, but the operation belongs to order %',
                NEW.order_item_id,
                v_order_item_order_id,
                v_operation_order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Inspector must belong to the operation facility.
    -- --------------------------------------------------------

    IF NEW.inspected_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.inspected_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Inspector % is not an active employee of the operation facility %',
                NEW.inspected_by,
                v_operation_facility_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Verifier must belong to the operation facility.
    -- --------------------------------------------------------

    IF NEW.verified_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.verified_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Verifier % is not an active employee of the operation facility %',
                NEW.verified_by,
                v_operation_facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_garment_inspection_integrity
ON public.garment_inspections;


CREATE TRIGGER
trg_validate_garment_inspection_integrity
BEFORE INSERT OR UPDATE
ON public.garment_inspections
FOR EACH ROW
EXECUTE FUNCTION
public.validate_garment_inspection_integrity();


-- ============================================================
-- 5. VALIDATE DAMAGE REPORT
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_damage_report_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_operation_facility_id uuid;
    v_operation_order_id uuid;
    v_order_item_order_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Get operation details.
    -- --------------------------------------------------------

    SELECT
        facility_id,
        order_id
    INTO
        v_operation_facility_id,
        v_operation_order_id
    FROM public.facility_order_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Operation % does not exist',
            NEW.operation_id;
    END IF;


    -- --------------------------------------------------------
    -- Validate order item belongs to operation order.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF v_order_item_order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % belongs to a different order than operation %',
                NEW.order_item_id,
                NEW.operation_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Reporter must be an active employee of the operation
    -- facility.
    -- --------------------------------------------------------

    IF NEW.detected_by IS NOT NULL THEN

        IF v_operation_facility_id IS NULL THEN

            RAISE EXCEPTION
                'Operation % does not have a facility assigned',
                NEW.operation_id;

        END IF;

        IF NOT public.validate_active_facility_employee(
            NEW.detected_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Reporter % is not an active employee of facility %',
                NEW.detected_by,
                v_operation_facility_id;

        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_damage_report_integrity
ON public.damage_reports;


CREATE TRIGGER
trg_validate_damage_report_integrity
BEFORE INSERT OR UPDATE
ON public.damage_reports
FOR EACH ROW
EXECUTE FUNCTION
public.validate_damage_report_integrity();


-- ============================================================
-- 6. VALIDATE MISSING ITEM REPORT
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_missing_item_report_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_operation_order_id uuid;
    v_order_item_order_id uuid;
BEGIN

    -- Get operation order.

    SELECT order_id
    INTO v_operation_order_id
    FROM public.facility_order_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Operation % does not exist',
            NEW.operation_id;
    END IF;


    -- Validate the order item.

    IF NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF v_order_item_order_id IS DISTINCT FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % does not belong to the same order as operation %',
                NEW.order_item_id,
                NEW.operation_id;

        END IF;

    END IF;
    -- --------------------------------------------------------
    -- Validate inspection order against order item.
    -- --------------------------------------------------------

    IF NEW.order_id IS NOT NULL
    AND NEW.order_item_id IS NOT NULL THEN

        SELECT order_id
        INTO v_order_item_order_id
        FROM public.order_items
        WHERE id = NEW.order_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order item % does not exist',
                NEW.order_item_id;
        END IF;

        IF NEW.order_id IS DISTINCT FROM v_order_item_order_id THEN
            RAISE EXCEPTION
                'Inspection order % does not match order item order %',
                NEW.order_id,
                v_order_item_order_id;
        END IF;

    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_missing_item_report_integrity
ON public.missing_item_reports;


CREATE TRIGGER
trg_validate_missing_item_report_integrity
BEFORE INSERT OR UPDATE
ON public.missing_item_reports
FOR EACH ROW
EXECUTE FUNCTION
public.validate_missing_item_report_integrity();


-- ============================================================
-- END OF STEP 6F-A
-- ============================================================