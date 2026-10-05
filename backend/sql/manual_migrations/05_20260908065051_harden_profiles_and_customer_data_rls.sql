-- ============================================
-- BRIGHT & WHITE
-- PHASE 4B - STEP 6D
-- PROFILES AND CUSTOMER DATA ISOLATION
-- ============================================


-- ============================================
-- Helper: Check whether the authenticated user
-- has a particular application role
-- ============================================


CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.has_role('admin')
        OR public.has_role('manager');
$$;

REVOKE ALL ON FUNCTION public.has_role(public.user_role_code)
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.is_admin_or_manager()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(public.user_role_code)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin_or_manager()
TO authenticated;

-- ============================================
-- SECTION 2
-- PROFILES SECURITY
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- Remove existing policies discovered in audit

DROP POLICY IF EXISTS "profiles_self_read"
ON public.profiles;

DROP POLICY IF EXISTS "profiles_self_update"
ON public.profiles;


-- Users can read only their own profile.
-- Admins and managers can read all profiles.

CREATE POLICY "profiles_select_isolated"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    id = auth.uid()
    OR public.is_admin_or_manager()
);


-- Users can update only their own profile.

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    id = auth.uid()
)
WITH CHECK (
    id = auth.uid()
);


-- Admins and managers can update profiles.

CREATE POLICY "profiles_update_admin"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    public.is_admin_or_manager()
)
WITH CHECK (
    public.is_admin_or_manager()
);


-- ============================================
-- SECTION 3
-- CUSTOMERS SECURITY
-- ============================================

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;


-- Remove existing policy discovered in audit

DROP POLICY IF EXISTS "customers_self_read"
ON public.customers;


-- Customers can read only their own customer record.

CREATE POLICY "customers_select_own"
ON public.customers
FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
);


-- Admins and managers can read all customers.

CREATE POLICY "customers_select_admin"
ON public.customers
FOR SELECT
TO authenticated
USING (
    public.is_admin_or_manager()
);


-- Customers can update only their own customer record.

CREATE POLICY "customers_update_own"
ON public.customers
FOR UPDATE
TO authenticated
USING (
    profile_id = auth.uid()
)
WITH CHECK (
    profile_id = auth.uid()
);


-- Admins and managers can update customer records.

CREATE POLICY "customers_update_admin"
ON public.customers
FOR UPDATE
TO authenticated
USING (
    public.is_admin_or_manager()
)
WITH CHECK (
    public.is_admin_or_manager()
);


-- ============================================
-- SECTION 4
-- CUSTOMER ADDRESS ISOLATION
-- ============================================

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;


-- Remove existing broad policy.

DROP POLICY IF EXISTS "addresses_customer_access"
ON public.customer_addresses;


-- Customers can read only their own addresses.

CREATE POLICY "customer_addresses_select_own"
ON public.customer_addresses
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Customers can create addresses only for themselves.

CREATE POLICY "customer_addresses_insert_own"
ON public.customer_addresses
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Customers can update only their own addresses.

CREATE POLICY "customer_addresses_update_own"
ON public.customer_addresses
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Customers can delete only their own addresses.

CREATE POLICY "customer_addresses_delete_own"
ON public.customer_addresses
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = customer_addresses.customer_id
          AND c.profile_id = auth.uid()
    )
);


-- Admins and managers have full address access.

CREATE POLICY "customer_addresses_admin_access"
ON public.customer_addresses
FOR ALL
TO authenticated
USING (
    public.is_admin_or_manager()
)
WITH CHECK (
    public.is_admin_or_manager()
);


-- ============================================
-- SECTION 5
-- PROFILE ROLE SECURITY
-- ============================================

ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;


-- Users can see their own assigned roles.

CREATE POLICY "profile_roles_select_own"
ON public.profile_roles
FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
);


-- Only administrators can manage roles.

CREATE POLICY "profile_roles_admin_manage"
ON public.profile_roles
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================
-- SECTION 6
-- ROLES SECURITY
-- ============================================

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;


-- Authenticated users can read role definitions.

CREATE POLICY "roles_select_authenticated"
ON public.roles
FOR SELECT
TO authenticated
USING (true);


-- Only administrators can modify role definitions.

CREATE POLICY "roles_admin_manage"
ON public.roles
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================
-- SECTION 7
-- PERMISSIONS SECURITY
-- ============================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;


-- Authenticated users can read permissions.

CREATE POLICY "permissions_select_authenticated"
ON public.permissions
FOR SELECT
TO authenticated
USING (true);


-- Only administrators can manage permissions.

CREATE POLICY "permissions_admin_manage"
ON public.permissions
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================
-- SECTION 8
-- ROLE PERMISSION SECURITY
-- ============================================

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;


-- Authenticated users can read permission mappings.

CREATE POLICY "role_permissions_select_authenticated"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);


-- Only administrators can modify role permissions.

CREATE POLICY "role_permissions_admin_manage"
ON public.role_permissions
FOR ALL
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);

