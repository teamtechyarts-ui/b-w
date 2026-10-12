# Bright & White Laundry — Phase 4A: Pre-Deployment Security Review

**Date:** October 12, 2026  
**Auditor:** Antigravity AI Security & Systems Team  
**Scope:** Phase 4 Performance Optimizations, Supabase Migration (`20261010140000_create_password_reset_challenges.sql`), Backend Authentication & Customer Caching, Mobile Orders Caching, API Timeouts, Email Verification OTP & SMTP Transport.  
**Deployment Constraints:** Keep Render on the free plan, do not upgrade hosting, do not execute migration on live Supabase, do not modify live database schema, do not remove `app_metadata` fallback, no production deployments.

---

## 1. Executive Summary

Phase 4 introduced several local performance enhancements to eliminate mobile UI lag, reduce Supabase Auth latency, optimize checkout queries, and stabilize SMTP operations. Prior to deploying these enhancements to production, a pre-deployment security review was conducted across the codebase.

### Key Audit Outcomes:
1. **Migration Safety:** The migration `20261010140000_create_password_reset_challenges.sql` was inspected in detail. It is non-destructive, non-blocking, and safely isolated to the `service_role` via Row-Level Security (RLS). The runtime dual-mode fallback (`app_metadata`) is intact and tested. The migration is **safe to apply** whenever the database administrator chooses, but application code remains 100% operational without it.
2. **Critical Vulnerabilities Remediated Pre-Deployment:**
   - **Mobile Orders Cache Multi-User Leak (HIGH):** The client-side cache in `mobile/src/services/ordersApi.ts` originally stored orders in an un-scoped variable. If User A logged out and User B logged in within 30 seconds on the same device, User B could view User A's cached orders. **Fixed:** Scoped cache directly to `accessToken`, and integrated `invalidateOrdersCache()` into `sessionManager.clearSession()`.
   - **Auth Guard Token Expiration Overhang (MEDIUM):** The in-memory session cache in `supabase-auth.guard.ts` previously cached authorization for 30 seconds unconditionally. If a JWT expired in 5 seconds, it could have remained authorized in cache for 25 seconds past expiration. **Fixed:** Capped cache entry TTL to `Math.min(now + 30000, jwtExpMs)` by reading the JWT payload `exp` claim, and added active invalidation upon account deletion (`deleteAccount`) and password reset (`resetPassword`).
   - **Unbounded In-Memory Customer Cache (LOW):** In `orders.service.ts`, the profile-to-customer ID mapping had a 5-minute TTL but no maximum capacity bound. **Fixed:** Enforced `MAX_CUSTOMER_CACHE_SIZE = 1000` with FIFO/LRU eviction and export of `invalidateCustomerCache(profileId)`.
   - **Silent Cache Refresh Failure in Mobile (LOW):** If a background or pull-to-refresh request failed while cached orders were already visible, errors were silently discarded. **Fixed:** Added an inline notification banner warning users that latest refresh failed and displayed data is cached.
3. **Automated Verification:**
   - **Backend:** 56 test suites passed, 404 tests passed, 0 failures. TypeScript compile clean (`0 errors`).
   - **Mobile:** 105 test suites passed, 444 tests passed, 0 failures. TypeScript compile clean (`0 errors`).

---

## 2. Migration Safety Assessment

**File Inspected:**  
- `backend/supabase/migrations/20261010140000_create_password_reset_challenges.sql`  
- `backend/sql/manual_migrations/66_20261010140000_create_password_reset_challenges.sql`

### 2.1 What the SQL Creates or Changes
The migration script defines:
1. **Table:** `public.password_reset_challenges`
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
   - `email TEXT NOT NULL`
   - `otp_hash TEXT NOT NULL`
   - `purpose TEXT NOT NULL DEFAULT 'password_reset'`
   - `expires_at TIMESTAMPTZ NOT NULL`
   - `resend_available_at TIMESTAMPTZ NOT NULL`
   - `attempt_count INT NOT NULL DEFAULT 0`
   - `max_attempts INT NOT NULL DEFAULT 5`
   - `consumed BOOLEAN NOT NULL DEFAULT FALSE`
   - `reset_token_hash TEXT`
   - `reset_token_expires_at TIMESTAMPTZ`
   - `reset_token_consumed BOOLEAN NOT NULL DEFAULT FALSE`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
2. **Indexes:**
   - `idx_pwd_reset_email` ON `public.password_reset_challenges(email)`
   - `idx_pwd_reset_user_id` ON `public.password_reset_challenges(user_id)`
   - `idx_pwd_reset_active` ON `public.password_reset_challenges(email, consumed, expires_at)`
3. **Access Controls & RLS:**
   - `ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;`
   - `REVOKE ALL ON public.password_reset_challenges FROM PUBLIC, anon, authenticated;`
   - `GRANT ALL ON public.password_reset_challenges TO service_role;`

### 2.2 Safety Assessment & Preconditions
- **Non-Destructive:** The SQL uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. It does not alter, drop, or rename existing tables, columns, constraints, or triggers.
- **Zero Table Locks:** Creating a new standalone table does not take exclusive write locks on existing tables.
- **Client Privilege Isolation:** RLS is enabled with all privileges revoked from `PUBLIC`, `anon`, and `authenticated` roles. Anonymous visitors and standard mobile users cannot read or write challenge records via PostgREST. Access is granted solely to `service_role`, which is restricted to the backend environment variables (`SUPABASE_SERVICE_ROLE_KEY`).
- **Preconditions:**
  1. Supabase Auth schema exists with `auth.users(id)` table.
  2. Postgres extensions `pgcrypto` or `gen_random_uuid()` enabled (standard in all Supabase projects).
- **Verification Queries:**
  ```sql
  -- Verify table existence and RLS status
  SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'password_reset_challenges';

  -- Verify indexes
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'password_reset_challenges';

  -- Verify role grants (only service_role should have privileges)
  SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'password_reset_challenges';
  ```
- **Rollback Procedure & Data Impact:**
  ```sql
  DROP TABLE IF EXISTS public.password_reset_challenges CASCADE;
  ```
  *Data Impact:* Rolling back deletes stored challenge history from that table. Because both `PasswordResetService` and `EmailVerificationService` contain dynamic feature detection (`checkTableAvailable()`), the application immediately falls back to storing challenges in `auth.users.app_metadata` with zero application downtime or code changes required.

---

## 3. Authentication Guard Cache Audit

**File Inspected:** `backend/src/common/guards/supabase-auth.guard.ts`

### 3.1 Verification Matrix
| Requirement | Status | Verification Detail |
| :--- | :--- | :--- |
| **Cryptographic Token Hashing** | PASS | Entries are keyed by `crypto.createHash('sha256').update(token).digest('hex')`. Raw tokens are never stored as map keys or written to logs. |
| **Token Logging Prevention** | PASS | `supabase-auth.guard.ts` contains no log statements writing access tokens, refresh tokens, or authorization headers. |
| **Cache Lifetime & Eviction** | PASS | Max TTL is 30,000ms. If the JWT `exp` claim expires earlier (e.g. in 5s), cache TTL is capped to `jwtExpMs`. Expired entries are deleted on read. |
| **Bounded Memory Footprint** | PASS | `MAX_CACHE_SIZE = 500`. When size exceeds 500 entries, the oldest key is evicted via `SESSION_CACHE.keys().next().value`. Memory footprint is capped at <250 KB. |
| **Concurrency & Consistency** | PASS | Cache lookups occur before asynchronous Supabase calls. If a token fails Supabase verification, `SESSION_CACHE.delete(tokenHash)` is executed immediately. |
| **Invalid Tokens Never Cached** | PASS | Entries are only written to `SESSION_CACHE` after `supabase.getUser(accessToken)` succeeds, `profiles.is_active` is confirmed `true`, and role permissions are loaded. |
| **Security Invalidation Events** | PASS | `invalidateAuthSessionsForUser(userId)` was implemented and hooked into `deleteAccount` (`customers.service.ts`) and `resetPassword` (`password-reset.service.ts`). |
| **Cross-User Data Isolation** | PASS | `resolvedUser` is reconstructed strictly from the user's verified token claims and DB profile UUID. Cache keys are unique SHA-256 digests. |
| **Server-Side Decisions** | PASS | Role checks (`admin`, `driver`, `facility_employee`, `manager`) and active profile validation are executed strictly server-side. |
| **Untrusted Header Protection** | PASS | Authorization decisions depend solely on the cryptographic `Bearer` JWT validated by Supabase Auth; no client headers (e.g. `X-User-Id`, `X-Role`) are trusted. |
| **Failure Mode** | PASS | Supabase network/auth errors throw `UnauthorizedException`; access is never silently granted. |
| **Test Coverage** | PASS | 9 tests in `supabase-auth.guard.spec.ts` covering TTL, JWT exp cap, SHA-256 hashing, token invalidation, user ID invalidation, inactive profiles, and error handling. |

---

## 4. Customer ID Mapping Cache Audit

**File Inspected:** `backend/src/modules/orders/orders.service.ts`

### 4.1 Verification Matrix
| Requirement | Status | Verification Detail |
| :--- | :--- | :--- |
| **Collision-Safe Keys** | PASS | Keyed strictly by `profileId` (UUID guaranteed unique by Supabase Auth). |
| **Tenant / User Isolation** | PASS | Mapping values are loaded from `customers` table with `.eq('profile_id', profileId)`. No tenant confusion possible. |
| **Independent Authorization** | PASS | Every order query independently checks ownership: `listMine` enforces `.eq('customer_id', customerId)`, `getById` verifies ownership and role elevation, and `cancel` delegates to atomic database RPC `cancel_customer_order_atomic(p_profile_id: profileId)`. |
| **Bounded Cache Size & TTL** | PASS | Added `MAX_CUSTOMER_CACHE_SIZE = 1000` with FIFO/LRU eviction. TTL is 5 minutes (300,000ms). |
| **Account Deletion Invalidation** | PASS | Exported `invalidateCustomerCache(profileId)` and hooked it directly into `CustomersService.deleteAccount(userId)`. |
| **Database Error Safety** | PASS | Missing or errored profile lookups throw `ForbiddenException("Customer profile required")` and do not cache. |
| **Test Coverage** | PASS | Tested in `orders.service.spec.ts` (customer caching, invalidation, and query isolation) and `customers.service.spec.ts`. |

---

## 5. Mobile Orders Cache Audit

**Files Inspected:** `mobile/src/services/ordersApi.ts`, `mobile/src/services/sessionManager.ts`, `mobile/src/screens/OrdersScreen.tsx`

### 5.1 Verification Matrix
| Requirement | Status | Verification Detail |
| :--- | :--- | :--- |
| **User & Session Isolation** | PASS (FIXED) | `cachedOrders` now records `token: accessToken`. On cache read, `cachedOrders.token === accessToken` is verified. Requests with a different token bypass the cache. |
| **Session Clear Invalidation** | PASS (FIXED) | `invalidateOrdersCache()` is called directly inside `clearSession()` in `sessionManager.ts`. Logging out or switching accounts purges the cache immediately. |
| **Mutation Invalidation** | PASS | `createOrder()` and `cancelOrder()` call `invalidateOrdersCache()` before returning, ensuring fresh server data is fetched on subsequent navigation. |
| **Stale Data Prevention** | PASS (FIXED) | `OrdersScreen.tsx` now sets `refreshNotice` ("Unable to refresh orders right now. Showing cached list.") if a refresh attempt fails while cached orders are displayed. |
| **Real-time Order Updates** | PASS | `useCustomerRealtime` updates in-memory order status on WebSocket events and triggers `loadOrders(true)` with `forceRefresh: true`. |
| **Pagination & Sorting** | PASS | Cache only stores unpaginated default requests (`limit === undefined && offset === undefined`). Paginated or offset requests bypass the cache. |
| **Test Coverage** | PASS | 6 tests in `ordersApi.test.ts` verifying cache hit, cross-user isolation, mutation invalidation, force refresh, and session logout invalidation. |

---

## 6. API Timeout & Retry Audit

**File Inspected:** `mobile/src/services/api.ts`

### 6.1 Verification Matrix
| Requirement | Status | Verification Detail |
| :--- | :--- | :--- |
| **Timeout Policy** | PASS | `API_TIMEOUT_MS = 45_000` (45s). Uses `AbortController.abort()` to terminate socket connections upon timer expiry. |
| **Differentiated Timeout Messaging** | PASS | GET requests report: *"Request timed out. Check your connection and try again."* Non-GET mutations (POST, PATCH, DELETE) report: *"Request timed out. Check your orders before retrying."* |
| **No Unsafe Retries** | PASS | `apiRequest` does **NOT** retry requests on timeout or network error. Non-idempotent mutations (creating orders, payments, cancellations) are never duplicated by the transport client. |
| **Idempotency Strategy** | PASS | Order creation uses `newOrderAttemptKey()` client-side and validates atomic `idempotency_key` and `idempotency_request_hash` server-side. |
| **UI Duplicate Submission Prevention** | PASS | Screens (`SignUpScreen`, `OrdersScreen`, `CheckoutScreen`) maintain in-flight tracking refs and state flags (`if (loading) return;`) preventing double-taps. |
| **401 Token Refresh** | PASS | 401 retry only triggers when an active session exists and `retryAuthentication: true`. Refresh token request is deduplicated via `refreshPromise`. |

---

## 7. Email Verification OTP & SMTP Pooling Audit

**Files Inspected:** `backend/src/modules/auth/email-verification.service.ts`, `backend/src/modules/auth/password-reset.service.ts`, `backend/src/modules/mail/mail.service.ts`

### 7.1 Verification Matrix
| Requirement | Status | Verification Detail |
| :--- | :--- | :--- |
| **Cryptographic OTP Storage** | PASS | OTPs are hashed using HMAC-SHA256 with purpose binding (`${otp}:${challengeId}:email_verification`). Raw OTPs are never stored. |
| **Constant-Time Verification** | PASS | OTP hashes are validated using `crypto.timingSafeEqual` to prevent timing attacks. |
| **Rate Limiting & Cooldown** | PASS | Resend enforces a 60-second cooldown (`resendAvailableAt`). Max 5 failed attempts allowed before the challenge is permanently consumed. |
| **Expiration & Single-Use** | PASS | OTPs expire after 10 minutes (600s). Once verified or expired, `consumed: true` is set immediately. Replay attempts are rejected. |
| **SMTP Transport Pooling** | PASS | Gmail SMTP uses `nodemailer.createTransport({ pool: true, maxConnections: 3, maxMessages: 100 })`. Connections are reused without cross-message state pollution. |
| **Credential & Log Safety** | PASS | `SMTP_APP_PASSWORD` and OTPs are never logged. Emails logged are masked (e.g. `cu***r@example.com`). |
| **Fallback Consistency** | PASS | Dynamic check (`checkTableAvailable()`) ensures seamless operation whether `password_reset_challenges` table exists or falls back to `app_metadata`. |
| **Test Coverage** | PASS | 12 tests in `email-verification.service.spec.ts`, 14 tests in `password-reset.service.spec.ts`, and SMTP tests in `mail.service.spec.ts` all passing. |

---

## 8. Findings Classified by Severity

| ID | Finding Description | Severity | Status | Remediation Summary |
| :---: | :--- | :---: | :---: | :--- |
| **SEC-01** | **Mobile Orders Cache Cross-User Leak**<br>In `ordersApi.ts`, `cachedOrders` was stored in a global module variable without checking the user token. Logging out and logging in as another user within 30s returned cached orders from the previous user. | **HIGH** | **RESOLVED** | Scoped `OrdersCacheEntry` to `token: accessToken`, verified token on read, and called `invalidateOrdersCache()` inside `sessionManager.clearSession()`. |
| **SEC-02** | **Auth Guard JWT Expiration Overhang**<br>In `supabase-auth.guard.ts`, session cache TTL was fixed at 30s. Tokens expiring within <30s remained valid in memory past their expiration. | **MEDIUM** | **RESOLVED** | Capped cache entry TTL to `Math.min(now + 30000, jwtExpMs)` by parsing the JWT `exp` claim, and added `invalidateAuthSessionsForUser` for account deletion and password resets. |
| **SEC-03** | **Unbounded Customer ID Cache in OrdersService**<br>`this.customerIdCache` in `orders.service.ts` had a 5-minute TTL but no maximum capacity limit, presenting an in-memory accumulation risk under high traffic. | **LOW** | **RESOLVED** | Implemented `MAX_CUSTOMER_CACHE_SIZE = 1000` with FIFO/LRU eviction and exported `invalidateCustomerCache(profileId)`. |
| **SEC-04** | **Silent Mobile Orders Refresh Failure**<br>When pull-to-refresh failed on `OrdersScreen.tsx` while orders were already loaded, the error was swallowed silently. | **LOW** | **RESOLVED** | Added user-facing warning banner notifying users that latest refresh failed and displayed data is cached. |
| **SEC-05** | **Future Migration Table Cleanup Policy**<br>Over months of high volume, unconsumed expired records in `password_reset_challenges` will accumulate. | **INFO** | **RECOMMENDED** | Recommend adding a lightweight pg_cron or periodic pruning query (`DELETE FROM password_reset_challenges WHERE created_at < NOW() - INTERVAL '30 days'`). |

---

## 9. Code Modifications Summary

1. `backend/src/common/guards/supabase-auth.guard.ts`:
   - Added JWT `exp` parsing and TTL capping (`expiresAt = Math.min(now + CACHE_TTL_MS, jwtExpMs)`).
   - Added automatic purge of expired entries upon lookup.
   - Added and exported `invalidateAuthSessionsForUser(userId: string)`.
   - Added and exported `getAuthSessionCacheSize()`.
2. `backend/src/modules/orders/orders.service.ts`:
   - Added `MAX_CUSTOMER_CACHE_SIZE = 1000` bound and eviction.
   - Added and exported `invalidateCustomerCache(profileId?: string)` and `getCustomerCacheSize()`.
3. `backend/src/modules/customers/customers.service.ts`:
   - In `deleteAccount(userId)`, invoked `invalidateAuthSessionsForUser(userId)` and `invalidateCustomerCache(userId)`.
4. `backend/src/modules/auth/password-reset.service.ts`:
   - In `resetPassword(...)`, invoked `invalidateAuthSessionsForUser(payload.userId)`.
5. `mobile/src/services/ordersApi.ts`:
   - Scoped `cachedOrders` to `token: accessToken` and verified token match on read.
6. `mobile/src/services/sessionManager.ts`:
   - Integrated `invalidateOrdersCache()` into `clearSession()`.
7. `mobile/src/screens/OrdersScreen.tsx`:
   - Added `refreshNotice` state, warning banner UI, and corresponding styling.
8. **Tests Added / Updated:**
   - `backend/src/common/guards/supabase-auth.guard.spec.ts` (9 tests added).
   - `backend/src/modules/orders/orders.service.spec.ts` (customer cache isolation tests added).
   - `backend/src/modules/customers/customers.service.spec.ts` (2 tests added).
   - `mobile/src/services/ordersApi.test.ts` (6 tests added).

---

## 10. Automated Test Results

### Backend (`npm test`)
```
Test Suites: 56 passed, 56 total
Tests:       404 passed, 404 total
Snapshots:   0 total
Time:        21.056 s
TypeScript check: 0 errors (npx tsc --noEmit)
NestJS build: passed (npm run build)
```

### Mobile (`npm test`)
```
Test Suites: 105 passed, 105 total
Tests:       444 passed, 444 total
Snapshots:   0 total
Time:        11.751 s
TypeScript check: 0 errors (npx tsc --noEmit)
```

---

## 11. Pre-Deployment Recommendations

| Component / Change | Recommendation | Notes / Next Action |
| :--- | :---: | :--- |
| **`20261010140000_create_password_reset_challenges.sql`** | **SAFE TO PROCEED** (Optional) | Can be applied to Supabase SQL editor at the DBA's convenience. App works transparently with or without it due to the verified `app_metadata` fallback. |
| **`supabase-auth.guard.ts` (Auth Cache)** | **SAFE TO PROCEED** | JWT `exp` cap, token hashing, bounded size (500), and user ID invalidation are verified and passing 100% of tests. |
| **`orders.service.ts` (Customer ID Cache)** | **SAFE TO PROCEED** | Bounded size (1,000), 5-minute TTL, and active invalidation on account deletion prevent memory leaks and data leakage. |
| **`ordersApi.ts` & `OrdersScreen.tsx` (Mobile Orders Cache)** | **SAFE TO PROCEED** | Scoped to user token, invalidated on logout, mutation invalidation verified, and stale data banner implemented. |
| **`api.ts` (45s Timeout & Retries)** | **SAFE TO PROCEED** | Differentiated timeout messaging, no unsafe retries on mutations, client-side in-flight guards in place. |
| **`email-verification.service.ts` & `mail.service.ts`** | **SAFE TO PROCEED** | Constant-time HMAC verification, single-use enforcement, 60s cooldown, pooled SMTP transport verified. |

### Pre-Deployment Checklist for Deployment Phase:
- [x] Verify no secrets, tokens, passwords, or OTPs are written to application logs.
- [x] Verify Render free plan compatibility: bounded in-memory maps (<500 KB total footprint) prevent OOM on 512 MB instances.
- [x] Verify rollback strategy: if anything fails, zero database schema changes have been forced, and `app_metadata` fallback remains active.
- [x] All 848 automated tests across backend and mobile pass cleanly.
