-- ============================================================
-- STEP 6F: FACILITY OPERATIONS SECURITY
-- ============================================================


-- ------------------------------------------------------------
-- 1. CHECK WHETHER CURRENT USER IS AN ACTIVE FACILITY EMPLOYEE
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_facility_employee(
    p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.facility_employees fe
        WHERE fe.facility_id = p_facility_id
          AND fe.profile_id = auth.uid()
          AND fe.is_active = true
    );
$$;


-- ------------------------------------------------------------
-- 2. CHECK ACCESS TO A FACILITY OPERATION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_facility_operation(
    p_operation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.facility_order_operations foo
            JOIN public.facility_employees fe
                ON fe.facility_id = foo.facility_id
            WHERE foo.id = p_operation_id
              AND fe.profile_id = auth.uid()
              AND fe.is_active = true
        );
$$;


-- ------------------------------------------------------------
-- 3. CHECK ACCESS TO A PROCESSING BATCH
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_processing_batch(
    p_batch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.facility_processing_batches fpb
            JOIN public.facility_employees fe
                ON fe.facility_id = fpb.facility_id
            WHERE fpb.id = p_batch_id
              AND fe.profile_id = auth.uid()
              AND fe.is_active = true
        );
$$;

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_machines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_order_operations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.facility_processing_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.processing_batch_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.garment_inspections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.missing_item_reports ENABLE ROW LEVEL SECURITY;