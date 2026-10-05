-- ============================================================
-- STEP 6F-B: PROFILE, EMPLOYEE & STATUS INTEGRITY
-- ============================================================
--
-- Purpose:
--
-- 1. Automatically create public.profiles records for new
--    auth.users.
--
-- 2. Validate garment_inspections.order_id against the
--    referenced facility operation.
--
-- 3. Allow employee history across multiple facilities while
--    ensuring only one active facility assignment per employee.
--
-- 4. Normalize unrestricted text status fields.
--
-- 5. Make facility_order_operations.current_status the
--    authoritative operational status and remove the duplicate
--    generic status column.
--
-- ============================================================


-- ============================================================
-- STEP 1: AUTOMATIC PROFILE CREATION
-- ============================================================
--
-- Every auth.users record must have a corresponding
-- public.profiles record.
--
-- Profile data can be supplied through auth user metadata:
--
-- raw_user_meta_data:
--
-- {
--   "full_name": "Customer Name",
--   "phone": "+919999999999"
-- }
--
-- The trigger runs with SECURITY DEFINER because inserts into
-- auth.users may not have direct access to public.profiles.
--
-- ============================================================


CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    INSERT INTO public.profiles (
        id,
        full_name,
        phone
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            NEW.raw_user_meta_data ->> 'name'
        ),
        COALESCE(
            NEW.phone,
            NEW.raw_user_meta_data ->> 'phone'
        )
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;

END;

$$;


DROP TRIGGER IF EXISTS
trg_handle_new_user
ON auth.users;


CREATE TRIGGER
trg_handle_new_user
AFTER INSERT
ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- STEP 2: ENSURE EXISTING AUTH USERS HAVE PROFILES
-- ============================================================
--
-- Backfill profiles for users that already exist in auth.users
-- but do not yet have a public.profiles record.
--
-- ============================================================


INSERT INTO public.profiles (
    id,
    full_name,
    phone
)
SELECT
    au.id,
    COALESCE(
        au.raw_user_meta_data ->> 'full_name',
        au.raw_user_meta_data ->> 'name'
    ),
    COALESCE(
        au.phone,
        au.raw_user_meta_data ->> 'phone'
    )
FROM auth.users au
LEFT JOIN public.profiles p
    ON p.id = au.id
WHERE p.id IS NULL;


-- ============================================================
-- STEP 3: EMPLOYEE FACILITY ASSIGNMENT STRATEGY
-- ============================================================
--
-- Business Rule:
--
-- A profile may have historical assignments to multiple
-- facilities.
--
-- However, only ONE facility assignment may be active at any
-- given time.
--
-- Example:
--
-- Employee
--     |
--     +-- Hyderabad Facility
--     |      is_active = false
--     |
--     +-- Gachibowli Facility
--            is_active = true
--
-- This allows employee transfers while preserving history.
--
-- ============================================================


CREATE UNIQUE INDEX IF NOT EXISTS
facility_employees_one_active_facility_per_profile_idx
ON public.facility_employees (profile_id)
WHERE is_active = true;


-- ============================================================
-- STEP 4: IMPROVE ACTIVE EMPLOYEE FACILITY LOOKUP
-- ============================================================
--
-- Since the partial unique index guarantees only one active
-- facility assignment per profile, this function is now safe
-- as a single-facility lookup.
--
-- ============================================================


CREATE OR REPLACE FUNCTION public.get_active_employee_facility(
    p_profile_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT facility_id
    FROM public.facility_employees
    WHERE profile_id = p_profile_id
      AND is_active = true
    LIMIT 1;
$$;


-- ============================================================
-- STEP 5: VALIDATE FACILITY EMPLOYEE TRANSITIONS
-- ============================================================
--
-- Prevents a profile from being assigned to multiple active
-- facilities.
--
-- The unique partial index is the final database-level
-- enforcement.
--
-- This trigger provides a clearer business error.
--
-- ============================================================


CREATE OR REPLACE FUNCTION
public.validate_employee_facility_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_existing_facility_id uuid;
BEGIN

    IF NEW.is_active = true THEN

        SELECT facility_id
        INTO v_existing_facility_id
        FROM public.facility_employees
        WHERE profile_id = NEW.profile_id
          AND is_active = true
          AND id IS DISTINCT FROM NEW.id
        LIMIT 1;

        IF FOUND THEN

            RAISE EXCEPTION
                'Profile % already has an active facility assignment at facility %. Deactivate the existing assignment before activating another facility.',
                NEW.profile_id,
                v_existing_facility_id;

        END IF;

    END IF;

    RETURN NEW;

END;

$$;


DROP TRIGGER IF EXISTS
trg_validate_employee_facility_assignment
ON public.facility_employees;


CREATE TRIGGER
trg_validate_employee_facility_assignment
BEFORE INSERT OR UPDATE
ON public.facility_employees
FOR EACH ROW
EXECUTE FUNCTION
public.validate_employee_facility_assignment();


-- ============================================================
-- STEP 6F-B: UPDATE ADMIN MACHINE UTILIZATION VIEW
-- ============================================================
--
-- Update the dependent view BEFORE removing the old status column.
--
-- ============================================================

CREATE OR REPLACE VIEW public.admin_machine_utilization AS
SELECT
    fm.id AS machine_id,
    fm.machine_name,
    fm.machine_type,
    fm.capacity_kg,
    fm.status AS machine_status,

    f.id AS facility_id,
    f.name AS facility_name,

    COUNT(foo.id) AS total_operations,

    COUNT(
        CASE
            WHEN foo.completed_at IS NOT NULL THEN 1
        END
    ) AS completed_operations,

    MAX(foo.completed_at) AS last_completed_at,
    MAX(foo.started_at) AS last_started_at

FROM public.facility_machines fm

JOIN public.facilities f
    ON f.id = fm.facility_id

LEFT JOIN public.facility_order_operations foo
    ON foo.machine_id = fm.id

GROUP BY
    fm.id,
    fm.machine_name,
    fm.machine_type,
    fm.capacity_kg,
    fm.status,
    f.id,
    f.name;


-- ============================================================
-- REMOVE LEGACY DUPLICATE STATUS COLUMN
-- ============================================================

ALTER TABLE public.facility_order_operations
DROP COLUMN IF EXISTS status;

-- ============================================================
-- STEP 7: NORMALIZE PROCESSING BATCH STATUS
-- ============================================================
--
-- Current status values:
--
-- pending
-- processing
-- completed
-- cancelled
--
-- A dedicated enum prevents invalid free-text values.
--
-- ============================================================


DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'processing_batch_status'
          AND typnamespace = 'public'::regnamespace
    ) THEN

        CREATE TYPE public.processing_batch_status AS ENUM (
            'pending',
            'processing',
            'completed',
            'cancelled'
        );

    END IF;

END;
$$;


-- ------------------------------------------------------------
-- Normalize existing processing batch values.
-- ------------------------------------------------------------


UPDATE public.facility_processing_batches
SET status = LOWER(TRIM(status));


-- ------------------------------------------------------------
-- Convert the status column to the enum.
-- ------------------------------------------------------------


ALTER TABLE public.facility_processing_batches
ALTER COLUMN status DROP DEFAULT;


ALTER TABLE public.facility_processing_batches
ALTER COLUMN status
TYPE public.processing_batch_status
USING (
    CASE
        WHEN status IN (
            'pending',
            'processing',
            'completed',
            'cancelled'
        )
        THEN status::public.processing_batch_status

        ELSE 'pending'::public.processing_batch_status
    END
);


ALTER TABLE public.facility_processing_batches
ALTER COLUMN status
SET DEFAULT 'pending'::public.processing_batch_status;


-- ============================================================
-- STEP 8: NORMALIZE DAMAGE REPORT STATUS
-- ============================================================
--
-- Valid values:
--
-- open
-- under_review
-- approved
-- resolved
-- rejected
--
-- ============================================================


DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'damage_report_status'
          AND typnamespace = 'public'::regnamespace
    ) THEN

        CREATE TYPE public.damage_report_status AS ENUM (
            'open',
            'under_review',
            'approved',
            'resolved',
            'rejected'
        );

    END IF;

END;
$$;


UPDATE public.damage_reports
SET status = LOWER(TRIM(status));


ALTER TABLE public.damage_reports
ALTER COLUMN status DROP DEFAULT;


ALTER TABLE public.damage_reports
ALTER COLUMN status
TYPE public.damage_report_status
USING (
    CASE
        WHEN status IN (
            'open',
            'under_review',
            'approved',
            'resolved',
            'rejected'
        )
        THEN status::public.damage_report_status

        ELSE 'open'::public.damage_report_status
    END
);


ALTER TABLE public.damage_reports
ALTER COLUMN status
SET DEFAULT 'open'::public.damage_report_status;


-- ============================================================
-- STEP 9: NORMALIZE MISSING ITEM REPORT STATUS
-- ============================================================
--
-- Valid values:
--
-- open
-- investigating
-- found
-- resolved
-- closed
--
-- ============================================================


DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'missing_item_report_status'
          AND typnamespace = 'public'::regnamespace
    ) THEN

        CREATE TYPE public.missing_item_report_status AS ENUM (
            'open',
            'investigating',
            'found',
            'resolved',
            'closed'
        );

    END IF;

END;
$$;


UPDATE public.missing_item_reports
SET status = LOWER(TRIM(status));


ALTER TABLE public.missing_item_reports
ALTER COLUMN status DROP DEFAULT;


ALTER TABLE public.missing_item_reports
ALTER COLUMN status
TYPE public.missing_item_report_status
USING (
    CASE
        WHEN status IN (
            'open',
            'investigating',
            'found',
            'resolved',
            'closed'
        )
        THEN status::public.missing_item_report_status

        ELSE 'open'::public.missing_item_report_status
    END
);


ALTER TABLE public.missing_item_reports
ALTER COLUMN status
SET DEFAULT 'open'::public.missing_item_report_status;


-- ============================================================
-- STEP 10: EXTEND GARMENT INSPECTION INTEGRITY
-- ============================================================
--
-- Rules:
--
-- 1. operation_id must exist when provided.
--
-- 2. order_item_id must belong to the same order as operation.
--
-- 3. order_id must match the operation order.
--
-- 4. When both order_id and order_item_id are provided,
--    they must belong to the same order.
--
-- 5. Inspector and verifier must be active employees of
--    the operation facility.
--
-- ============================================================


CREATE OR REPLACE FUNCTION
public.validate_garment_inspection_integrity()
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
    -- Retrieve operation information.
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


    -- --------------------------------------------------------
    -- Validate inspection order against operation order.
    -- --------------------------------------------------------

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
    -- Retrieve order item information.
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

    END IF;


    -- --------------------------------------------------------
    -- Validate order item against operation order.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL
       AND NEW.operation_id IS NOT NULL THEN

        IF v_order_item_order_id IS DISTINCT
           FROM v_operation_order_id THEN

            RAISE EXCEPTION
                'Order item % belongs to order %, but operation belongs to order %',
                NEW.order_item_id,
                v_order_item_order_id,
                v_operation_order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Validate order item against inspection order.
    -- --------------------------------------------------------

    IF NEW.order_item_id IS NOT NULL
       AND NEW.order_id IS NOT NULL THEN

        IF v_order_item_order_id IS DISTINCT FROM NEW.order_id THEN

            RAISE EXCEPTION
                'Order item % does not belong to inspection order %',
                NEW.order_item_id,
                NEW.order_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Inspector must belong to operation facility.
    -- --------------------------------------------------------

    IF NEW.inspected_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.inspected_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Inspector % is not an active employee of facility %',
                NEW.inspected_by,
                v_operation_facility_id;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Verifier must belong to operation facility.
    -- --------------------------------------------------------

    IF NEW.verified_by IS NOT NULL
       AND v_operation_facility_id IS NOT NULL THEN

        IF NOT public.validate_active_facility_employee(
            NEW.verified_by,
            v_operation_facility_id
        ) THEN

            RAISE EXCEPTION
                'Verifier % is not an active employee of facility %',
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
-- STEP 11: STATUS DOCUMENTATION
-- ============================================================


COMMENT ON COLUMN
public.facility_order_operations.current_status
IS
'Authoritative operational workflow status. Replaces the deprecated generic status column.';


COMMENT ON TYPE
public.processing_batch_status
IS
'Lifecycle status of a facility processing batch.';


COMMENT ON TYPE
public.damage_report_status
IS
'Resolution lifecycle status for a garment damage report.';


COMMENT ON TYPE
public.missing_item_report_status
IS
'Investigation and resolution lifecycle status for a missing item report.';


-- ============================================================
-- END OF STEP 6F-B
-- ============================================================