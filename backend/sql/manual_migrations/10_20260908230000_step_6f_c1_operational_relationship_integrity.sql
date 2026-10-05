-- ============================================================
-- Bright & White
-- Step 6F-C1
-- Operational Relationship Integrity
--
-- Goals:
--   1. Order addresses must belong to the order customer.
--   2. Facility operations must match the order facility.
--   3. Order facility cannot be changed incompatibly once
--      facility operations exist.
--   4. Only one active driver assignment per order/type.
--   5. Delivery proof driver must match a delivery assignment.
--   6. Route batch stops must match the route batch driver/type.
--
-- This migration intentionally does NOT normalize additional
-- status fields or implement workflow transitions.
-- Those belong to Step 6F-C2.
-- ============================================================


-- ============================================================
-- 1. ORDER ADDRESS OWNERSHIP
-- ============================================================
--
-- Foreign keys currently guarantee that pickup_address_id and
-- delivery_address_id reference valid customer_addresses.
--
-- They do NOT by themselves guarantee that those addresses
-- actually belong to orders.customer_id.
--
-- This trigger closes that integrity gap.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_address_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_address_customer_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Pickup address
    -- --------------------------------------------------------
    IF NEW.pickup_address_id IS NOT NULL THEN

        SELECT ca.customer_id
        INTO v_address_customer_id
        FROM public.customer_addresses ca
        WHERE ca.id = NEW.pickup_address_id;

        IF v_address_customer_id IS NULL THEN
            RAISE EXCEPTION
                'Pickup address % does not exist',
                NEW.pickup_address_id
                USING ERRCODE = '23514';
        END IF;

        IF v_address_customer_id <> NEW.customer_id THEN
            RAISE EXCEPTION
                'Pickup address % belongs to customer %, not order customer %',
                NEW.pickup_address_id,
                v_address_customer_id,
                NEW.customer_id
                USING ERRCODE = '23514';
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Delivery address
    -- --------------------------------------------------------
    IF NEW.delivery_address_id IS NOT NULL THEN

        SELECT ca.customer_id
        INTO v_address_customer_id
        FROM public.customer_addresses ca
        WHERE ca.id = NEW.delivery_address_id;

        IF v_address_customer_id IS NULL THEN
            RAISE EXCEPTION
                'Delivery address % does not exist',
                NEW.delivery_address_id
                USING ERRCODE = '23514';
        END IF;

        IF v_address_customer_id <> NEW.customer_id THEN
            RAISE EXCEPTION
                'Delivery address % belongs to customer %, not order customer %',
                NEW.delivery_address_id,
                v_address_customer_id,
                NEW.customer_id
                USING ERRCODE = '23514';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_address_ownership
ON public.orders;


CREATE TRIGGER trg_validate_order_address_ownership
BEFORE INSERT OR UPDATE OF
    customer_id,
    pickup_address_id,
    delivery_address_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_address_ownership();


-- ============================================================
-- 2. FACILITY OPERATION ↔ ORDER FACILITY
-- ============================================================
--
-- facility_order_operations.facility_id is currently nullable.
--
-- That is useful for backward compatibility because the existing
-- backend historically created facility operations without
-- explicitly sending facility_id.
--
-- Therefore:
--
--   * If order.facility_id exists and operation.facility_id is
--     NULL, automatically copy the order facility.
--
--   * If operation.facility_id is supplied, it must equal
--     order.facility_id.
--
--   * An operational facility record cannot exist for an order
--     that has no assigned facility.
--
-- This preserves compatibility while making facility identity
-- authoritative.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_operation_order_facility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_facility_id uuid;
BEGIN

    SELECT o.facility_id
    INTO v_order_facility_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Order % does not exist',
            NEW.order_id
            USING ERRCODE = '23503';
    END IF;


    -- An order must have a facility before facility processing starts.
    IF v_order_facility_id IS NULL THEN
        RAISE EXCEPTION
            'Order % has no assigned facility; facility operation cannot be created',
            NEW.order_id
            USING ERRCODE = '23514';
    END IF;


    -- Backend compatibility:
    -- automatically derive facility_id when it is omitted.
    IF NEW.facility_id IS NULL THEN
        NEW.facility_id := v_order_facility_id;
    END IF;


    -- Explicitly supplied facility must match the order.
    IF NEW.facility_id <> v_order_facility_id THEN
        RAISE EXCEPTION
            'Facility operation facility % does not match order % facility %',
            NEW.facility_id,
            NEW.order_id,
            v_order_facility_id
            USING ERRCODE = '23514';
    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_enforce_operation_order_facility
ON public.facility_order_operations;


CREATE TRIGGER trg_enforce_operation_order_facility
BEFORE INSERT OR UPDATE OF
    order_id,
    facility_id
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_operation_order_facility();


-- ============================================================
-- 3. PROTECT ORDER FACILITY REASSIGNMENT
-- ============================================================
--
-- Once facility operations exist, changing orders.facility_id
-- could silently make the operational history inconsistent.
--
-- We therefore reject a facility change whenever existing
-- facility operations would no longer match.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_facility_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id THEN
        RETURN NEW;
    END IF;


    IF EXISTS (
        SELECT 1
        FROM public.facility_order_operations foo
        WHERE foo.order_id = NEW.id
          AND (
                NEW.facility_id IS NULL
                OR foo.facility_id IS DISTINCT FROM NEW.facility_id
              )
    ) THEN

        RAISE EXCEPTION
            'Order % facility cannot be changed from % to % because facility operations already exist',
            NEW.id,
            OLD.facility_id,
            NEW.facility_id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_facility_reassignment
ON public.orders;


CREATE TRIGGER trg_validate_order_facility_reassignment
BEFORE UPDATE OF facility_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_facility_reassignment();


-- ============================================================
-- 4. DRIVER ASSIGNMENT INTEGRITY
-- ============================================================
--
-- Application code already attempts to prevent duplicate active
-- assignments, but this must also be protected by PostgreSQL.
--
-- One order may legitimately have:
--
--   pickup assignment
--   delivery assignment
--
-- But it must not have two simultaneously active pickup
-- assignments or two simultaneously active delivery assignments.
--
-- Historical completed/rejected/cancelled/expired assignments are
-- still allowed.
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT
            da.order_id,
            da.assignment_type
        FROM public.driver_assignments da
        WHERE da.status IN (
            'assigned'::public.assignment_status,
            'accepted'::public.assignment_status,
            'en_route'::public.assignment_status,
            'arrived'::public.assignment_status
        )
        GROUP BY
            da.order_id,
            da.assignment_type
        HAVING COUNT(*) > 1
    ) THEN

        RAISE EXCEPTION
            'Cannot create active driver assignment uniqueness index: duplicate active assignments already exist';

    END IF;

END;
$$;


CREATE UNIQUE INDEX IF NOT EXISTS
driver_assignments_one_active_per_order_type_idx
ON public.driver_assignments (
    order_id,
    assignment_type
)
WHERE status IN (
    'assigned'::public.assignment_status,
    'accepted'::public.assignment_status,
    'en_route'::public.assignment_status,
    'arrived'::public.assignment_status
);


-- ============================================================
-- 5. DELIVERY PROOF ↔ DRIVER ASSIGNMENT
-- ============================================================
--
-- delivery_proofs currently has:
--
--   order_id
--   driver_id
--
-- Both are individually valid foreign keys.
--
-- That does not guarantee that the driver actually has the
-- delivery assignment for that order.
--
-- This trigger closes that gap.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_delivery_proof_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM public.driver_assignments da
        WHERE da.order_id = NEW.order_id
          AND da.driver_id = NEW.driver_id
          AND da.assignment_type = 'delivery'::public.assignment_type
          AND da.status IN (
                'accepted'::public.assignment_status,
                'en_route'::public.assignment_status,
                'arrived'::public.assignment_status,
                'completed'::public.assignment_status
          )
    ) THEN

        RAISE EXCEPTION
            'Driver % does not have a valid delivery assignment for order %',
            NEW.driver_id,
            NEW.order_id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_delivery_proof_assignment
ON public.delivery_proofs;


CREATE TRIGGER trg_validate_delivery_proof_assignment
BEFORE INSERT OR UPDATE OF
    order_id,
    driver_id
ON public.delivery_proofs
FOR EACH ROW
EXECUTE FUNCTION public.validate_delivery_proof_assignment();


-- ============================================================
-- 6. ROUTE BATCH STOP ↔ DRIVER ASSIGNMENT
-- ============================================================
--
-- route_batch_stops currently links:
--
--   route_batch_id
--   assignment_id
--
-- The foreign keys ensure those objects exist, but they do not
-- guarantee:
--
--   route_batches.driver_id = driver_assignments.driver_id
--
-- or:
--
--   route_batches.batch_type = driver_assignments.assignment_type
--
-- This trigger enforces both.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_route_batch_stop_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_route_driver_id uuid;
    v_route_type public.assignment_type;

    v_assignment_driver_id uuid;
    v_assignment_type public.assignment_type;
BEGIN

    SELECT
        rb.driver_id,
        rb.batch_type
    INTO
        v_route_driver_id,
        v_route_type
    FROM public.route_batches rb
    WHERE rb.id = NEW.route_batch_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Route batch % does not exist',
            NEW.route_batch_id
            USING ERRCODE = '23503';
    END IF;


    SELECT
        da.driver_id,
        da.assignment_type
    INTO
        v_assignment_driver_id,
        v_assignment_type
    FROM public.driver_assignments da
    WHERE da.id = NEW.assignment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Driver assignment % does not exist',
            NEW.assignment_id
            USING ERRCODE = '23503';
    END IF;


    IF v_route_driver_id <> v_assignment_driver_id THEN

        RAISE EXCEPTION
            'Route batch driver % does not match assignment driver %',
            v_route_driver_id,
            v_assignment_driver_id
            USING ERRCODE = '23514';

    END IF;


    IF v_route_type <> v_assignment_type THEN

        RAISE EXCEPTION
            'Route batch type % does not match assignment type %',
            v_route_type,
            v_assignment_type
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_route_batch_stop_relationship
ON public.route_batch_stops;


CREATE TRIGGER trg_validate_route_batch_stop_relationship
BEFORE INSERT OR UPDATE OF
    route_batch_id,
    assignment_id
ON public.route_batch_stops
FOR EACH ROW
EXECUTE FUNCTION public.validate_route_batch_stop_relationship();


-- ============================================================
-- 7. ONE DRIVER ASSIGNMENT MAY APPEAR IN ONLY ONE ROUTE BATCH
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT assignment_id
        FROM public.route_batch_stops
        GROUP BY assignment_id
        HAVING COUNT(*) > 1
    ) THEN

        RAISE EXCEPTION
            'Cannot enforce route assignment uniqueness: an assignment appears in multiple route batches';

    END IF;

END;
$$;


CREATE UNIQUE INDEX IF NOT EXISTS
route_batch_stops_assignment_unique_idx
ON public.route_batch_stops (assignment_id);


-- ============================================================
-- 8. SECURITY HARDENING FOR TRIGGER FUNCTIONS
-- ============================================================

REVOKE ALL
ON FUNCTION public.validate_order_address_ownership()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.enforce_operation_order_facility()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.validate_order_facility_reassignment()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.validate_delivery_proof_assignment()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.validate_route_batch_stop_relationship()
FROM PUBLIC;


REVOKE ALL
ON FUNCTION public.validate_order_address_ownership()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.enforce_operation_order_facility()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_order_facility_reassignment()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_delivery_proof_assignment()
FROM anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_route_batch_stop_relationship()
FROM anon, authenticated;


-- ============================================================
-- END STEP 6F-C1
-- ============================================================