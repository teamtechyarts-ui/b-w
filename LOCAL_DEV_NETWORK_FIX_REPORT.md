# Bright & White Laundry — Local Development Network & CORS Fix Report

**Date:** October 12, 2026  
**Status:** Resolved & Verified  
**Scope:** Backend Fastify CORS, Mobile API URL Resolution, Realtime & Foreground Request Throttling, CSP Worker Directives, Favicon Asset, and Cross-Platform Styling.

---

## 1. Executive Summary

During local web development (`http://localhost:5173` connecting to `http://127.0.0.1:3000/v1`), the browser blocked API requests during CORS preflight with:
```
Request header field x-request-id is not allowed by Access-Control-Allow-Headers in preflight response.
```
This prevented the web application from loading `/v1/auth/me`, `/v1/services`, `/v1/services/pricing-policy`, `/v1/customers/me/addresses`, and `/v1/orders`.

Additionally, secondary issues were diagnosed and resolved:
1. **Repeated `/orders` Calls:** Caused by multi-channel listener duplication in `handleAppForeground()`, an asynchronous unmount race condition in `useRealtimeSubscription()`, lack of in-flight promise deduplication in `ordersApi.ts`, and unthrottled refresh triggers in `HomeScreen.tsx`.
2. **CSP Worker Error:** Vite's internal web worker instantiation from `blob:` URLs was blocked by Content Security Policy because `worker-src` was omitted and `script-src` lacked `blob:`.
3. **Vite WebSocket Reconnects:** `connect-src` lacked explicit `ws:` / `wss:` schemes and `clientPort` was unpinned.
4. **Missing Favicon:** `/favicon.ico` returned 404 on initial page load.
5. **Deprecated `shadow*` Styles:** React Native Web logged warnings for deprecated `shadow*` style properties.

All issues were remediated at the root cause without weakening security, disabling CORS, removing performance headers, modifying database schemas, or changing production infrastructure.

---

## 2. Root Cause of the CORS Failure

### What Happened
In Phase 4, `X-Request-Id` (and `Server-Timing`) was introduced for performance monitoring. The client (`mobile/src/services/api.ts`) sends an `X-Request-Id` header with every API request.

In browsers, cross-origin requests (`http://localhost:5173` to `http://127.0.0.1:3000/v1`) with custom headers trigger an `OPTIONS` preflight request:
```http
OPTIONS /v1/auth/me HTTP/1.1
Origin: http://localhost:5173
Access-Control-Request-Method: GET
Access-Control-Request-Headers: accept, authorization, x-request-id
```

The Fastify CORS configuration in `backend/src/configure-app.ts` was previously configured as:
```typescript
app.enableCors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
});
```

Because `X-Request-Id` (and `x-request-id`) was missing from `allowedHeaders`, Fastify responded with:
```http
access-control-allow-headers: Content-Type, Authorization, Accept, X-Requested-With
```
The browser detected that `x-request-id` was not permitted and refused to send the actual `GET /v1/auth/me` request, triggering an immediate network error in the frontend.

### Fix Implemented
In `backend/src/configure-app.ts`:
1. **Allowed Headers:** Added `'X-Request-Id'` and `'x-request-id'`.
2. **Exposed Headers:** Added `exposedHeaders: ['Server-Timing', 'X-Request-Id', 'x-request-id']` so client JavaScript can read telemetry data.
3. **Allowed Origins:** Explicitly permitted `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:3000`, `http://127.0.0.1:3000`, `FRONTEND_URL`, and any comma-separated origins from `ALLOWED_ORIGINS`. Requests without an `Origin` header (native mobile apps, curl, server-to-server) continue to be allowed.
4. **Preflight Caching:** Added `maxAge: 86400` (24h) to eliminate redundant preflight roundtrips.

---

## 3. CORS Preflight Verification Results

Using live preflight tests via `curl.exe` against `http://127.0.0.1:3000`:

| Request | Origin | Preflight Status | Verified Headers | Result |
| :--- | :--- | :---: | :--- | :---: |
| `OPTIONS /v1/auth/me` | `http://localhost:5173` | **204 No Content** | `Access-Control-Allow-Origin: http://localhost:5173`<br>`Access-Control-Allow-Headers: ... X-Request-Id, x-request-id`<br>`Access-Control-Expose-Headers: Server-Timing, X-Request-Id, x-request-id` | **PASS** |
| `OPTIONS /v1/services` | `http://localhost:5173` | **204 No Content** | Allowed headers include `x-request-id` | **PASS** |
| `OPTIONS /v1/services/pricing-policy` | `http://localhost:5173` | **204 No Content** | Allowed headers include `x-request-id` | **PASS** |
| `OPTIONS /v1/customers/me/addresses` | `http://localhost:5173` | **204 No Content** | Allowed headers include `x-request-id` | **PASS** |
| `OPTIONS /v1/orders` | `http://localhost:5173` | **204 No Content** | Allowed headers include `x-request-id` | **PASS** |
| `OPTIONS /v1/auth/me` | `http://127.0.0.1:5173` | **204 No Content** | `Access-Control-Allow-Origin: http://127.0.0.1:5173` | **PASS** |
| `OPTIONS /v1/auth/me` | `http://malicious.com` | **404 / Blocked** | No `Access-Control-Allow-Origin` returned | **PASS** |

---

## 4. API Base URL Selection Across Environments

Inspected `mobile/src/config/environment.ts`:

| Environment / Target | URL Resolved | Rationale & Safety |
| :--- | :--- | :--- |
| **Web Development (`Platform.OS === 'web'`)** | `http://127.0.0.1:3000/v1` (or `BW_DEV_WEB_API_URL` / `BW_API_URL`) | Connects to local NestJS backend. Local CORS allows both `localhost:5173` and `127.0.0.1:5173`. |
| **Android Emulator (`Platform.OS === 'android'`)** | `http://10.0.2.2:3000/v1` (or `BW_DEV_ANDROID_API_URL`) | The Android Emulator loopback alias `10.0.2.2` reaches the host development machine. |
| **Physical Android Device (Debug)** | `BW_DEV_ANDROID_API_URL` or `adb reverse tcp:3000 tcp:3000` | Configured via environment; physical devices do not confuse `127.0.0.1` with host laptop. |
| **iOS Simulator (`Platform.OS === 'ios'`)** | `http://127.0.0.1:3000/v1` (or `BW_DEV_IOS_API_URL`) | Uses host localhost directly. |
| **Production / Release Builds** | `Config.BW_PRODUCTION_API_URL` / `Config.BW_UAT_API_URL` | Release builds enforce `API_BASE_URL.startsWith('https://')` via `assertSafeMobileConfiguration()`. If unconfigured, build aborts immediately. |

---

## 5. Repeated Orders Requests Investigation & Fix

### Root Cause Analysis
Console logs reported bursts of `GET /v1/orders` requests. Tracing the call chain:
`HomeScreen.tsx` → `refreshOrders()` → `ordersApi.ts` → `realtimeService.ts` / `useRealtime.ts` revealed four compounding causes:
1. **Multi-Channel Listener Multiplication:** `useCustomerRealtime` subscribes the same listener callback to `orders:all` AND `customer:${derivedId}`. On app foreground, `handleAppForeground()` iterated through all channels and called `cb(...)` once per channel, triggering 2–3 redundant fetches simultaneously.
2. **Asynchronous Subscription Cleanup Race:** In `useRealtimeSubscription()`, `subscribeToChannel` returned a Promise. If React remounted or props changed before the Promise resolved, `cleanupFn` was undefined at cleanup time, leaving orphaned listeners attached.
3. **Missing In-Flight Deduplication:** In `ordersApi.ts`, if multiple `getOrders()` calls were issued concurrently (e.g. initial mount + foreground event), separate HTTP requests were fired over the network.
4. **Unthrottled `HomeScreen` Callback:** In `HomeScreen.tsx`, `refreshOrders` had no minimum execution spacing, and re-executed whenever active urgent orders changed.

### Remediations Applied
1. **`realtimeService.ts`:** In `handleAppForeground()`, listeners across all channels are deduplicated into a `Set<RealtimeEventListener>` before dispatching `RECONNECT_RECONCILE`. Each component listener is now called exactly once.
2. **`useRealtime.ts`:** Added an `isCancelled` guard in `useRealtimeSubscription()`. If the component unmounts before `subscribeToChannel` resolves, the resulting unsubscribe callback is invoked immediately upon promise resolution.
3. **`ordersApi.ts`:** Added `inFlightGetOrders` promise deduplication. Concurrent calls with identical parameters share the active promise rather than firing duplicate requests.
4. **`HomeScreen.tsx`:** Added timestamp throttling (`lastRefreshTimeRef.current`) ensuring `refreshOrders()` will not trigger redundant network requests within 1000ms. Filtered `useCustomerRealtime` to only trigger on order-specific event types.
5. **Regression Tests:** Added tests in `ordersApi.test.ts` (in-flight deduplication) and `realtimeService.test.ts` (multi-channel foreground deduplication).

---

## 6. Content Security Policy & Worker Resolution

### Root Cause Analysis
The browser reported:
```
Refused to create a worker from 'blob:...' because it violates the following Content Security Policy directive: "script-src * 'unsafe-inline' 'unsafe-eval'". Note that 'worker-src' was not explicitly set, so 'script-src' is used as a fallback.
```
In Vite development mode, Vite instantiates web workers (for HMR and dependency analysis) using `URL.createObjectURL(blob)`.
Under CSP Level 3, if `worker-src` is omitted, browsers fall back to `child-src` and then `script-src`. Wildcards (`*`) in `script-src` do not match `blob:` schemes without explicit declaration.

### Remediations Applied
In `mobile/vite.config.ts` and `mobile/index.html`:
- Added `worker-src 'self' blob:;`
- Added `blob:` to `script-src` and `script-src-elem`
- Added `ws: wss:` to `connect-src` to guarantee Vite HMR WebSocket connectivity
- Configured Vite HMR `clientPort: 5173` to prevent reconnect loops on multi-host bindings

---

## 7. Favicon Asset & Styling Deprecation Fixes

1. **Favicon:**
   - Copied existing brand asset `mobile/public/bw_logo.png` to `mobile/public/favicon.ico`.
   - Added `<link rel="icon" type="image/png" href="/bw_logo.png" />` and `<link rel="shortcut icon" href="/favicon.ico" />` in `mobile/index.html`.
   - Direct requests to `/favicon.ico` now return 200 OK.
2. **Deprecated `shadow*` Warnings:**
   - In `mobile/src/theme/designSystem.ts`, wrapped shadow definitions in `Platform.select`:
     - On **web**: Uses standard CSS `boxShadow` strings (`0 1px 2px rgba(0,0,0,0.04)`), eliminating React Native Web deprecation warnings.
     - On **native** (Android/iOS): Preserves exact native `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`, and `elevation` properties.
3. **Touch-History Warning:**
   - Investigated React Native for Web `TouchHistoryMath` notice. The warning is a development-only reconciliation diagnostic in React Native Web when simulated touch events fire on unmounted wrappers. No broken interaction was observed; per project guidelines, React Native internal packages were left intact.

---

## 8. Files Changed

| File | Changes Made |
| :--- | :--- |
| `backend/src/configure-app.ts` | Added `X-Request-Id`, `x-request-id` to CORS `allowedHeaders`; added `Server-Timing`, `X-Request-Id` to `exposedHeaders`; added dev origins (`localhost:5173`, `127.0.0.1:5173`, `3000`) and preflight caching (`maxAge: 86400`). |
| `mobile/vite.config.ts` | Added `worker-src 'self' blob:`, `blob:` in `script-src`, `ws: wss:` in `connect-src`, and pinned `hmr.clientPort: 5173`. |
| `mobile/index.html` | Updated CSP meta tag matching Vite config; added favicon `<link>` tags. |
| `mobile/public/favicon.ico` | Created favicon from `bw_logo.png`. |
| `mobile/src/theme/designSystem.ts` | Implemented `Platform.select` for shadows (`boxShadow` on web, native shadow properties on mobile). |
| `mobile/src/services/ordersApi.ts` | Added in-flight request deduplication for `getOrders()`. |
| `mobile/src/services/ordersApi.test.ts` | Added regression test for concurrent in-flight `getOrders()` deduplication. |
| `mobile/src/services/realtimeService.ts` | Deduplicated listeners in `handleAppForeground()` to prevent multiple dispatches. |
| `mobile/src/services/realtimeService.test.ts` | Added regression test for multi-channel foreground notification deduplication. |
| `mobile/src/hooks/useRealtime.ts` | Added `isCancelled` flag to prevent orphaned subscriptions on unmount. |
| `mobile/src/screens/HomeScreen.tsx` | Added 1000ms throttle and event type filtering to `refreshOrders()`. |

---

## 9. Automated Test & Typecheck Results

### Backend
- **Test Suite (`npm test`):** 56 passed / 56 suites (404 tests passed, 0 failed).
- **TypeScript Check (`npx tsc --noEmit`):** 0 errors.

### Mobile
- **Test Suite (`npm test`):** 105 passed / 105 suites (446 tests passed, 0 failed).
- **TypeScript Check (`npx tsc --noEmit`):** 0 errors.

---

## 10. Conclusion & Verification Summary

All issues reported in the user request have been systematically diagnosed, resolved, and verified:
1. `x-request-id` header is now explicitly permitted in Fastify CORS preflight.
2. Preflights for `/auth/me`, `/services`, `/services/pricing-policy`, `/customers/me/addresses`, and `/orders` succeed with 204 No Content.
3. Production configuration remains strictly HTTPS and does not use localhost.
4. Vite CSP worker error and reconnect loops are eliminated.
5. Favicon 404 is resolved with the official brand asset.
6. Web `shadow*` deprecation warnings are resolved while maintaining full native Android/iOS shadow support.
7. Order requests are deduplicated and throttled across foreground and realtime transitions.
8. Existing authentication, rate limiting, RLS, and role-based access remain completely intact.
