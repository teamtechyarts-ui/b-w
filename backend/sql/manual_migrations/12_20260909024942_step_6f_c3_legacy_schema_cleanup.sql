-- ============================================================
-- Bright & White
-- Step 6F-C3
-- Legacy Schema Cleanup + Targeted Security Hardening
-- ============================================================
--
-- Canonical models:
--   loyalty_point_transactions
--   device_tokens
--   package_services
--
-- Legacy models removed:
--   loyalty_transactions
--   push_devices
--   package_service_limits
--
-- IMPORTANT:
--   No CASCADE is intentionally used.
--   Unexpected dependencies must cause this migration to fail.
-- ============================================================


-- ============================================================
-- 1. REMOVE LEGACY LOYALTY MODEL
-- ============================================================

DROP TRIGGER IF EXISTS trg_loyalty_balance
ON public.loyalty_transactions;

DROP FUNCTION IF EXISTS public.apply_loyalty_transaction();

DROP TABLE IF EXISTS public.loyalty_transactions;


-- ============================================================
-- 2. REMOVE LEGACY PUSH DEVICE MODEL
-- ============================================================

DROP POLICY IF EXISTS devices_owner_manage
ON public.push_devices;

DROP TABLE IF EXISTS public.push_devices;


-- ============================================================
-- 3. REMOVE LEGACY PACKAGE/SERVICE LIMIT MODEL
-- ============================================================

DROP TABLE IF EXISTS public.package_service_limits;


-- ============================================================
-- 4. HARDEN AUTH PROFILE CREATION FUNCTION
-- ============================================================
--
-- Keep the function and auth.users trigger.
-- Only harden its search_path.
-- ============================================================

ALTER FUNCTION public.handle_new_user()
SET search_path = public, pg_temp;


-- ============================================================
-- 5. DOCUMENT CANONICAL MODELS
-- ============================================================

COMMENT ON TABLE public.loyalty_point_transactions IS
'Canonical Bright & White loyalty-points ledger. Supersedes legacy loyalty_transactions.';

COMMENT ON TABLE public.device_tokens IS
'Canonical Bright & White push-notification device token registry. Supersedes legacy push_devices.';

COMMENT ON TABLE public.package_services IS
'Canonical package-to-service relationship including per-service usage limits. Supersedes legacy package_service_limits.';


-- ============================================================
-- END STEP 6F-C3
-- ============================================================