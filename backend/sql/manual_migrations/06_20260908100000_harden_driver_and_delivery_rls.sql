-- ============================================
-- Bright & White
-- Phase 4B Step 6E
-- Driver and Delivery RLS Hardening
-- ============================================


-- ============================================
-- Helper: Get Current Driver ID
-- ============================================

CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT d.id
    FROM public.drivers d
    WHERE d.profile_id = auth.uid()
    LIMIT 1;
$$;


-- ============================================
-- Function Security
-- ============================================

REVOKE ALL
ON FUNCTION public.current_driver_id()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_driver_id()
TO authenticated;


-- ============================================
-- 1. DRIVERS
-- ============================================

DROP POLICY IF EXISTS drivers_self_read
ON public.drivers;

DROP POLICY IF EXISTS drivers_admin_read
ON public.drivers;

DROP POLICY IF EXISTS drivers_admin_manage
ON public.drivers;


-- Driver can read only their own driver record

CREATE POLICY drivers_self_read
ON public.drivers
FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
);


-- Admin can read all drivers

CREATE POLICY drivers_admin_read
ON public.drivers
FOR SELECT
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
);


-- Admin can manage drivers

CREATE POLICY drivers_admin_manage
ON public.drivers
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 2. DRIVER ASSIGNMENTS
-- ============================================

DROP POLICY IF EXISTS driver_assignments_driver_read
ON public.driver_assignments;

DROP POLICY IF EXISTS driver_assignments_admin_access
ON public.driver_assignments;


-- Driver can read only assignments belonging to them

CREATE POLICY driver_assignments_driver_read
ON public.driver_assignments
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Admin full access

CREATE POLICY driver_assignments_admin_access
ON public.driver_assignments
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 3. DRIVER LIVE LOCATIONS
-- ============================================

DROP POLICY IF EXISTS driver_live_locations_driver_access
ON public.driver_live_locations;

DROP POLICY IF EXISTS driver_live_locations_admin_access
ON public.driver_live_locations;


-- Driver can manage only their own live location

CREATE POLICY driver_live_locations_driver_access
ON public.driver_live_locations
FOR ALL
TO authenticated
USING (
    driver_id = public.current_driver_id()
)
WITH CHECK (
    driver_id = public.current_driver_id()
);


-- Admin full access

CREATE POLICY driver_live_locations_admin_access
ON public.driver_live_locations
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 4. DRIVER LOCATION HISTORY
-- ============================================

DROP POLICY IF EXISTS driver_location_history_driver_read
ON public.driver_location_history;

DROP POLICY IF EXISTS driver_location_history_driver_insert
ON public.driver_location_history;

DROP POLICY IF EXISTS driver_location_history_admin_access
ON public.driver_location_history;


-- Driver can read only their own location history

CREATE POLICY driver_location_history_driver_read
ON public.driver_location_history
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Driver can insert only their own location history

CREATE POLICY driver_location_history_driver_insert
ON public.driver_location_history
FOR INSERT
TO authenticated
WITH CHECK (
    driver_id = public.current_driver_id()
);


-- Admin full access

CREATE POLICY driver_location_history_admin_access
ON public.driver_location_history
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 5. DRIVER NAVIGATION EVENTS
-- ============================================

DROP POLICY IF EXISTS driver_navigation_events_driver_read
ON public.driver_navigation_events;

DROP POLICY IF EXISTS driver_navigation_events_driver_insert
ON public.driver_navigation_events;

DROP POLICY IF EXISTS driver_navigation_events_admin_access
ON public.driver_navigation_events;


-- Driver can read only their own navigation events

CREATE POLICY driver_navigation_events_driver_read
ON public.driver_navigation_events
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Driver can create navigation events only for themselves
--
-- If an order_id is provided, the driver must have
-- an active assignment for that order.

CREATE POLICY driver_navigation_events_driver_insert
ON public.driver_navigation_events
FOR INSERT
TO authenticated
WITH CHECK (

    driver_id = public.current_driver_id()

    AND (

        order_id IS NULL

        OR EXISTS (
            SELECT 1
            FROM public.driver_assignments da
            WHERE da.order_id = driver_navigation_events.order_id
              AND da.driver_id = public.current_driver_id()
              AND da.status NOT IN (
                  'rejected'::public.assignment_status,
                  'cancelled'::public.assignment_status,
                  'expired'::public.assignment_status
              )
        )
    )
);


-- Admin full access

CREATE POLICY driver_navigation_events_admin_access
ON public.driver_navigation_events
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);


-- ============================================
-- 6. DELIVERY PROOFS
-- ============================================

DROP POLICY IF EXISTS delivery_proofs_driver_read
ON public.delivery_proofs;

DROP POLICY IF EXISTS delivery_proofs_driver_insert
ON public.delivery_proofs;

DROP POLICY IF EXISTS delivery_proofs_admin_access
ON public.delivery_proofs;


-- Driver can read only delivery proofs created by them

CREATE POLICY delivery_proofs_driver_read
ON public.delivery_proofs
FOR SELECT
TO authenticated
USING (
    driver_id = public.current_driver_id()
);


-- Driver can create a delivery proof only when:
--
-- 1. The proof belongs to that driver.
-- 2. The order is assigned to that driver.
-- 3. The assignment is a delivery assignment.
-- 4. The assignment is active.

CREATE POLICY delivery_proofs_driver_insert
ON public.delivery_proofs
FOR INSERT
TO authenticated
WITH CHECK (

    driver_id = public.current_driver_id()

    AND EXISTS (
        SELECT 1
        FROM public.driver_assignments da
        WHERE da.order_id = delivery_proofs.order_id
          AND da.driver_id = public.current_driver_id()
          AND da.assignment_type =
              'delivery'::public.assignment_type
          AND da.status IN (
              'accepted'::public.assignment_status,
              'en_route'::public.assignment_status,
              'arrived'::public.assignment_status
          )
    )
);


-- Admin full access

CREATE POLICY delivery_proofs_admin_access
ON public.delivery_proofs
FOR ALL
TO authenticated
USING (
    public.has_role('admin'::public.user_role_code)
)
WITH CHECK (
    public.has_role('admin'::public.user_role_code)
);