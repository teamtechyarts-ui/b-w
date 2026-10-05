-- ============================================================
-- Bright & White
-- Step 6F-C2
-- Status & Lifecycle Integrity
--
-- Architecture:
--
--   order_status_transitions
--            |
--            v
--   change_order_status()
--            |
--            v
--   orders.current_status
--            |
--            v
--   order_status_history
--
-- order_status_transitions is the SINGLE SOURCE OF TRUTH
-- for allowed order lifecycle transitions.
--
-- This migration:
--   1. Completes the order transition matrix.
--   2. Adds defense-in-depth validation on orders.
--   3. Hardens change_order_status().
--   4. Adds driver-assignment lifecycle validation.
--   5. Adds timestamp consistency validation.
--   6. Does NOT redesign facility current_status.
-- ============================================================


-- ============================================================
-- 1. COMPLETE ORDER STATUS TRANSITION MATRIX
-- ============================================================
--
-- Existing valid rows are preserved.
-- ON CONFLICT makes this migration idempotent with respect to
-- transition seed data.
--
-- Important:
-- on_hold is intentionally NOT added as a generic transition.
-- A generic "anything -> on_hold -> anything" path would bypass
-- lifecycle integrity. Hold/resume will be implemented later as
-- a controlled workflow with a recorded resume state.
-- ============================================================

INSERT INTO public.order_status_transitions
    (from_status, to_status)
VALUES

    -- --------------------------------------------------------
    -- DRAFT / PAYMENT
    -- --------------------------------------------------------

    ('draft', 'pending_payment'),
    ('draft', 'confirmed'),
    ('draft', 'cancelled'),

    ('pending_payment', 'confirmed'),
    ('pending_payment', 'cancelled'),

    -- --------------------------------------------------------
    -- PICKUP
    -- --------------------------------------------------------

    ('confirmed', 'pickup_assigned'),
    ('confirmed', 'cancelled'),

    ('pickup_assigned', 'pickup_accepted'),
    ('pickup_assigned', 'pickup_failed'),
    ('pickup_assigned', 'cancelled'),

    ('pickup_accepted', 'en_route_pickup'),
    ('pickup_accepted', 'pickup_failed'),
    ('pickup_accepted', 'cancelled'),

    ('en_route_pickup', 'pickup_otp_pending'),
    ('en_route_pickup', 'pickup_failed'),
    ('en_route_pickup', 'cancelled'),

    ('pickup_otp_pending', 'picked_up'),
    ('pickup_otp_pending', 'pickup_failed'),
    ('pickup_otp_pending', 'cancelled'),

    -- Retry after failed pickup.
    ('pickup_failed', 'pickup_assigned'),
    ('pickup_failed', 'cancelled'),

    -- --------------------------------------------------------
    -- TRANSIT TO FACILITY
    -- --------------------------------------------------------

    ('picked_up', 'in_transit_to_facility'),

    ('in_transit_to_facility', 'received_at_facility'),

    -- --------------------------------------------------------
    -- FACILITY
    -- --------------------------------------------------------

    ('received_at_facility', 'verification'),

    ('verification', 'processing'),

    ('processing', 'quality_check'),
    ('processing', 'rework_required'),

    ('quality_check', 'ready_for_delivery'),
    ('quality_check', 'rework_required'),

    ('rework_required', 'processing'),
    ('rework_required', 'quality_check'),

    -- --------------------------------------------------------
    -- DELIVERY
    -- --------------------------------------------------------

    ('ready_for_delivery', 'delivery_assigned'),

    ('delivery_assigned', 'delivery_accepted'),
    ('delivery_assigned', 'delivery_failed'),

    ('delivery_accepted', 'en_route_delivery'),
    ('delivery_accepted', 'delivery_failed'),

    ('en_route_delivery', 'delivery_otp_pending'),
    ('en_route_delivery', 'delivery_failed'),

    ('delivery_otp_pending', 'delivered'),
    ('delivery_otp_pending', 'delivery_failed'),

    -- Retry after failed delivery.
    ('delivery_failed', 'delivery_assigned'),

    -- --------------------------------------------------------
    -- POST DELIVERY
    -- --------------------------------------------------------

    ('delivered', 'claim_period_active'),
    ('delivered', 'completed'),

    ('claim_period_active', 'completed')

ON CONFLICT (from_status, to_status)
DO NOTHING;


-- ============================================================
-- 2. ORDER STATUS DEFENSE-IN-DEPTH TRIGGER
-- ============================================================
--
-- INSERT:
--   Every newly-created order must begin in DRAFT.
--
-- UPDATE:
--   Every status change must exist in the central
--   order_status_transitions table.
--
-- This prevents both:
--   * invalid lifecycle jumps
--   * creating an order directly in a later lifecycle state
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    -- --------------------------------------------------------
    -- INSERT integrity
    -- --------------------------------------------------------

    IF TG_OP = 'INSERT' THEN

        IF NEW.current_status <>
            'draft'::public.order_status THEN

            RAISE EXCEPTION
                'New order % must begin in draft status, not %',
                NEW.id,
                NEW.current_status
                USING ERRCODE = '23514';

        END IF;

        RETURN NEW;

    END IF;


    -- --------------------------------------------------------
    -- UPDATE integrity
    -- --------------------------------------------------------

    IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
        RETURN NEW;
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.order_status_transitions ost
        WHERE ost.from_status = OLD.current_status
          AND ost.to_status = NEW.current_status
    ) THEN

        RAISE EXCEPTION
            'Invalid order status transition for order %: % -> %',
            OLD.id,
            OLD.current_status,
            NEW.current_status
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_status_transition
ON public.orders;


CREATE TRIGGER trg_validate_order_status_transition
BEFORE INSERT OR UPDATE OF current_status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_status_transition();


-- ============================================================
-- 3. HARDEN change_order_status()
-- ============================================================
--
-- Preserve the existing behavior:
--
--   * lock order row
--   * validate transition
--   * update current_status
--   * set delivered_at
--   * set 7-day claim deadline
--   * write order_status_history
--
-- Improvements:
--
--   * safe search_path includes pg_temp
--   * schema-qualified objects
--   * clearer error code
--   * no duplicate history entry for same-state calls
-- ============================================================

CREATE OR REPLACE FUNCTION public.change_order_status(
    p_order_id uuid,
    p_new_status public.order_status,
    p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old public.order_status;
BEGIN

    SELECT o.current_status
    INTO v_old
    FROM public.orders o
    WHERE o.id = p_order_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Order % not found',
            p_order_id
            USING ERRCODE = 'P0002';
    END IF;


    -- Same-state request is a no-op.
    IF v_old IS NOT DISTINCT FROM p_new_status THEN
        RETURN;
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.order_status_transitions ost
        WHERE ost.from_status = v_old
          AND ost.to_status = p_new_status
    ) THEN

        RAISE EXCEPTION
            'Invalid order status transition: % -> %',
            v_old,
            p_new_status
            USING ERRCODE = '23514';

    END IF;


    UPDATE public.orders
    SET
        current_status = p_new_status,

        updated_at = now(),

        delivered_at =
            CASE
                WHEN p_new_status =
                    'delivered'::public.order_status
                THEN COALESCE(delivered_at, now())
                ELSE delivered_at
            END,

        claim_deadline_at =
            CASE
                WHEN p_new_status =
                    'delivered'::public.order_status
                THEN COALESCE(
                    claim_deadline_at,
                    now() + interval '7 days'
                )
                ELSE claim_deadline_at
            END

    WHERE id = p_order_id;


    INSERT INTO public.order_status_history (
        order_id,
        from_status,
        to_status,
        changed_by,
        reason
    )
    VALUES (
        p_order_id,
        v_old,
        p_new_status,
        auth.uid(),
        p_reason
    );

END;
$$;


-- ============================================================
-- 4. DRIVER ASSIGNMENT STATUS TRANSITION RULE
-- ============================================================
--
-- assignment_status values:
--
--   assigned
--   accepted
--   rejected
--   en_route
--   arrived
--   completed
--   cancelled
--   expired
--   reassignment_required
--
-- reassignment_required is treated as the terminal state for
-- the OLD assignment. A new driver assignment should be created
-- for the replacement driver rather than reviving the old row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_valid_assignment_status_transition(
    p_old_status public.assignment_status,
    p_new_status public.assignment_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        p_old_status = p_new_status

        OR CASE p_old_status

            WHEN 'assigned'::public.assignment_status THEN
                p_new_status IN (
                    'accepted'::public.assignment_status,
                    'rejected'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'expired'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'accepted'::public.assignment_status THEN
                p_new_status IN (
                    'en_route'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'en_route'::public.assignment_status THEN
                p_new_status IN (
                    'arrived'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'arrived'::public.assignment_status THEN
                p_new_status IN (
                    'completed'::public.assignment_status,
                    'cancelled'::public.assignment_status,
                    'reassignment_required'::public.assignment_status
                )

            WHEN 'completed'::public.assignment_status THEN
                false

            WHEN 'rejected'::public.assignment_status THEN
                false

            WHEN 'cancelled'::public.assignment_status THEN
                false

            WHEN 'expired'::public.assignment_status THEN
                false

            WHEN 'reassignment_required'::public.assignment_status THEN
                false

            ELSE
                false

        END;
$$;


-- ============================================================
-- DRIVER ASSIGNMENT STATUS INTEGRITY
-- ============================================================
--
-- INSERT:
--   New assignments must begin as ASSIGNED.
--
-- UPDATE:
--   Status changes must follow the assignment lifecycle.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    -- --------------------------------------------------------
    -- INSERT integrity
    -- --------------------------------------------------------

    IF TG_OP = 'INSERT' THEN

        IF NEW.status <>
            'assigned'::public.assignment_status THEN

            RAISE EXCEPTION
                'New driver assignment % must begin in assigned status, not %',
                NEW.id,
                NEW.status
                USING ERRCODE = '23514';

        END IF;

        RETURN NEW;

    END IF;


    -- --------------------------------------------------------
    -- UPDATE integrity
    -- --------------------------------------------------------

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;


    IF NOT public.is_valid_assignment_status_transition(
        OLD.status,
        NEW.status
    ) THEN

        RAISE EXCEPTION
            'Invalid driver assignment status transition for assignment %: % -> %',
            OLD.id,
            OLD.status,
            NEW.status
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_assignment_status_transition
ON public.driver_assignments;


CREATE TRIGGER trg_validate_assignment_status_transition
BEFORE INSERT OR UPDATE OF status
ON public.driver_assignments
FOR EACH ROW
EXECUTE FUNCTION public.validate_assignment_status_transition();


-- ============================================================
-- 5. ORDER TIMESTAMP CONSISTENCY
-- ============================================================
--
-- Actual current orders timestamp model:
--
--   delivered_at
--   claim_deadline_at
--
-- We intentionally do NOT reference nonexistent pickup or
-- delivery-start timestamp columns.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_order_lifecycle_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.claim_deadline_at IS NOT NULL
       AND NEW.delivered_at IS NULL THEN

        RAISE EXCEPTION
            'Order % cannot have claim_deadline_at without delivered_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.claim_deadline_at IS NOT NULL
       AND NEW.delivered_at IS NOT NULL
       AND NEW.claim_deadline_at < NEW.delivered_at THEN

        RAISE EXCEPTION
            'Order % claim_deadline_at cannot be earlier than delivered_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_order_lifecycle_timestamps
ON public.orders;


CREATE TRIGGER trg_validate_order_lifecycle_timestamps
BEFORE INSERT OR UPDATE OF
    delivered_at,
    claim_deadline_at
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_lifecycle_timestamps();


-- ============================================================
-- 6. DRIVER ASSIGNMENT TIMESTAMP CONSISTENCY
-- ============================================================
--
-- Actual current columns:
--
--   assigned_at
--   accepted_at
--   completed_at
--
-- There is currently NO started_at column.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_lifecycle_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.accepted_at IS NOT NULL
       AND NEW.assigned_at IS NOT NULL
       AND NEW.accepted_at < NEW.assigned_at THEN

        RAISE EXCEPTION
            'Assignment % accepted_at cannot be earlier than assigned_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.completed_at IS NOT NULL
       AND NEW.assigned_at IS NOT NULL
       AND NEW.completed_at < NEW.assigned_at THEN

        RAISE EXCEPTION
            'Assignment % completed_at cannot be earlier than assigned_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.completed_at IS NOT NULL
       AND NEW.accepted_at IS NOT NULL
       AND NEW.completed_at < NEW.accepted_at THEN

        RAISE EXCEPTION
            'Assignment % completed_at cannot be earlier than accepted_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_assignment_lifecycle_timestamps
ON public.driver_assignments;


CREATE TRIGGER trg_validate_assignment_lifecycle_timestamps
BEFORE INSERT OR UPDATE OF
    assigned_at,
    accepted_at,
    completed_at
ON public.driver_assignments
FOR EACH ROW
EXECUTE FUNCTION public.validate_assignment_lifecycle_timestamps();


-- ============================================================
-- 7. FACILITY OPERATION TIMESTAMP CONSISTENCY
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_facility_operation_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.started_at IS NOT NULL
       AND NEW.completed_at IS NOT NULL
       AND NEW.completed_at < NEW.started_at THEN

        RAISE EXCEPTION
            'Facility operation % completed_at cannot be earlier than started_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    IF NEW.received_at IS NOT NULL
       AND NEW.ready_for_delivery_at IS NOT NULL
       AND NEW.ready_for_delivery_at < NEW.received_at THEN

        RAISE EXCEPTION
            'Facility operation % ready_for_delivery_at cannot be earlier than received_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_facility_operation_timestamps
ON public.facility_order_operations;


CREATE TRIGGER trg_validate_facility_operation_timestamps
BEFORE INSERT OR UPDATE OF
    received_at,
    ready_for_delivery_at,
    started_at,
    completed_at
ON public.facility_order_operations
FOR EACH ROW
EXECUTE FUNCTION public.validate_facility_operation_timestamps();


-- ============================================================
-- 8. PROCESSING BATCH TIMESTAMP CONSISTENCY
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_processing_batch_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    IF NEW.started_at IS NOT NULL
       AND NEW.completed_at IS NOT NULL
       AND NEW.completed_at < NEW.started_at THEN

        RAISE EXCEPTION
            'Processing batch % completed_at cannot be earlier than started_at',
            NEW.id
            USING ERRCODE = '23514';

    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
trg_validate_processing_batch_timestamps
ON public.facility_processing_batches;


CREATE TRIGGER trg_validate_processing_batch_timestamps
BEFORE INSERT OR UPDATE OF
    started_at,
    completed_at
ON public.facility_processing_batches
FOR EACH ROW
EXECUTE FUNCTION public.validate_processing_batch_timestamps();


-- ============================================================
-- 9. SECURITY HARDENING
-- ============================================================

REVOKE ALL
ON FUNCTION public.validate_order_status_transition()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_assignment_status_transition()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_order_lifecycle_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_assignment_lifecycle_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_facility_operation_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.validate_processing_batch_timestamps()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.is_valid_assignment_status_transition(
    public.assignment_status,
    public.assignment_status
)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 10. HARDEN change_order_status() EXECUTE PRIVILEGES
-- ============================================================
--
-- change_order_status() is SECURITY DEFINER and therefore must
-- not be directly executable by anonymous or ordinary
-- authenticated Supabase clients.
--
-- Order lifecycle mutations must pass through the trusted
-- Bright & White backend/service-role path.
-- ============================================================

REVOKE ALL
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
FROM anon;

REVOKE ALL
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.change_order_status(
    uuid,
    public.order_status,
    text
)
TO service_role;


-- ============================================================
-- END STEP 6F-C2
-- ============================================================