-- ============================================
-- Bright & White
-- Admin Analytics Views
-- ============================================


-- ============================================
-- 1. Revenue Analytics
-- ============================================

CREATE OR REPLACE VIEW public.admin_revenue_analytics AS
SELECT
    DATE(o.created_at) AS order_date,

    COUNT(DISTINCT o.id) AS total_orders,

    COALESCE(
        SUM(
            CASE
                WHEN o.current_status NOT IN ('cancelled', 'draft')
                THEN o.total_amount
                ELSE 0
            END
        ),
        0
    ) AS gross_revenue,

    COALESCE(
        SUM(
            CASE
                WHEN o.current_status = 'completed'
                THEN o.total_amount
                ELSE 0
            END
        ),
        0
    ) AS completed_revenue,

    COUNT(
        CASE
            WHEN o.current_status = 'cancelled'
            THEN 1
        END
    ) AS cancelled_orders

FROM public.orders o

GROUP BY DATE(o.created_at);


-- ============================================
-- 2. Order Analytics
-- ============================================

CREATE OR REPLACE VIEW public.admin_order_analytics AS
SELECT
    o.current_status,

    COUNT(*) AS order_count,

    COALESCE(
        SUM(o.total_amount),
        0
    ) AS total_order_value,

    COALESCE(
        AVG(o.total_amount),
        0
    ) AS average_order_value,

    MIN(o.created_at) AS first_order_at,

    MAX(o.created_at) AS latest_order_at

FROM public.orders o

GROUP BY o.current_status;


-- ============================================
-- 3. Driver Performance
-- ============================================

CREATE OR REPLACE VIEW public.admin_driver_performance AS
SELECT
    d.id AS driver_id,

    p.full_name AS driver_name,

    d.is_active,

    d.is_available,

    d.max_concurrent_jobs,

    COUNT(da.id) AS total_assignments,

    COUNT(
        CASE
            WHEN da.status = 'completed'
            THEN 1
        END
    ) AS completed_assignments,

    COUNT(
        CASE
            WHEN da.status = 'rejected'
            THEN 1
        END
    ) AS rejected_assignments,

    MAX(da.completed_at) AS last_completed_at

FROM public.drivers d

LEFT JOIN public.profiles p
    ON p.id = d.profile_id

LEFT JOIN public.driver_assignments da
    ON da.driver_id = d.id

GROUP BY
    d.id,
    p.full_name,
    d.is_active,
    d.is_available,
    d.max_concurrent_jobs;


-- ============================================
-- 4. Facility Performance
-- ============================================

CREATE OR REPLACE VIEW public.admin_facility_performance AS
SELECT
    f.id AS facility_id,

    f.name AS facility_name,

    f.is_active,

    COUNT(DISTINCT o.id) AS total_orders,

    COUNT(
        CASE
            WHEN o.current_status = 'completed'
            THEN 1
        END
    ) AS completed_orders,

    COUNT(
        CASE
            WHEN o.current_status IN (
                'processing',
                'verification',
                'quality_check'
            )
            THEN 1
        END
    ) AS active_processing_orders,

    COUNT(
        CASE
            WHEN o.current_status = 'ready_for_delivery'
            THEN 1
        END
    ) AS ready_for_delivery_orders

FROM public.facilities f

LEFT JOIN public.orders o
    ON o.facility_id = f.id

GROUP BY
    f.id,
    f.name,
    f.is_active;


-- ============================================
-- 5. Machine Utilization
-- ============================================

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
            WHEN foo.status = 'completed'
            THEN 1
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


-- ============================================
-- SECURITY
-- ============================================

REVOKE ALL ON public.admin_revenue_analytics FROM anon;
REVOKE ALL ON public.admin_order_analytics FROM anon;
REVOKE ALL ON public.admin_driver_performance FROM anon;
REVOKE ALL ON public.admin_facility_performance FROM anon;
REVOKE ALL ON public.admin_machine_utilization FROM anon;

REVOKE ALL ON public.admin_revenue_analytics FROM authenticated;
REVOKE ALL ON public.admin_order_analytics FROM authenticated;
REVOKE ALL ON public.admin_driver_performance FROM authenticated;
REVOKE ALL ON public.admin_facility_performance FROM authenticated;
REVOKE ALL ON public.admin_machine_utilization FROM authenticated;