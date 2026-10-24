# Bright & White — Critical Mobile Reliability, Realtime, Workflow and UI Fixes Report

**Date:** October 16, 2026  
**Environment:** Local Workstation (Windows, Powershell, Node.js, NestJS Backend, React Native Mobile)  
**Verification Scope:** Code inspection, automated test suites (Jest), static type checking (`tsc --noEmit`), and event flow trace analysis. No physical device was connected; all verification was performed locally without claiming real-device verification.

---

## Executive Summary

A comprehensive audit and targeted refactoring were conducted across the Bright & White mobile app (`mobile/`) and backend service (`backend/`) addressing six critical operational defects:
1. **Android Icon Discrepancies & Stroke Clipping**: Resolved category mapping collisions, restored compound service keyword precedence, fixed native SVG stroke clipping caused by `overflow: 'hidden'`, and mapped missing action icons (e.g., driver arrived).
2. **Driver Dashboard 5-Second Polling & Refresh Loops**: Diagnosed the root origin of the recurring refresh spinner, ensured targeted Realtime delivery using dual channel broadcast (`driver:${driver.id}` & `driver:${profileId}`), and eliminated full-screen replacement spinners in favor of silent background reconciliation.
3. **Android Keyboard Covering OTP Field**: Integrated dynamic keyboard height tracking (`Keyboard.addListener`), measured OTP card layout coordinates, provided targeted scroll offsets, dynamic container padding (`paddingBottom: Math.max(120, keyboardHeight + 60)`), and automated keyboard dismissal.
4. **Driver Pickup-to-Facility Workflow Skipping Arrival**: Identified Postgres enum constraints (`order_status` lacks `arrived_at_facility`), enforced arrival verification via `driver_navigation_events` table checks on the backend before facility QR/order intake can proceed, and synchronized mobile driver UI actions.
5. **Driver Dashboard Permission-Denial Flickering & Navigation**: Converted location permission denial into a standard non-fatal state, prevented infinite `AppState` and effect loops, and implemented an on-demand permission/GPS acquisition pipeline for directions with fallback to app settings.
6. **Facility Garment Processing Multiple Loading Indicators**: Identified the root cause of the video's repeated loading spinners—`FacilityProcessingPanel` and `useOrderRealtime` invoking `onChanged()`, which triggered `setFacilityRefresh` in `App.tsx`, causing React Navigation to unmount and remount the entire screen. Isolated intermediate processing stage mutations to local button spinners and preserved view visibility during background synchronization.

---

## Issue 1 — Android Icons Remain Incorrect

### Root Causes
1. **Category Key Mapping Collisions & Precedence**:
   - In `mobile/src/utils/categoryIconMapping.ts`, keyword matching checked `'iron'` before `'wash'`. For compound categories like `"Wash & Iron"`, the matcher prematurely assigned the iron icon instead of the primary washing machine icon.
   - Slugs `wash-iron` and `wash-and-iron` were not explicitly mapped in `SLUG_ICON_MAP`.
   - The default fallback for unmapped dynamic categories was ambiguous rather than using a neutral, clean tag icon (`tag`).
2. **Android SVG Stroke Clipping in React Native**:
   - In `mobile/src/components/AppIcon.tsx` (line 216), native vector wrappers applied `overflow: 'hidden'`. On Android, rotated strokes, checkmarks, hanger hooks, and bed linens with stroke widths ≥ 2px suffered stroke clipping at the vector container boundary.
3. **Mismatched Action Icons**:
   - In `mobile/src/screens/HomeScreen.tsx` (line 295), the "Driver Arrived" active state rendered a generic `'truck'` icon rather than the dedicated `'driver-arrived'` action icon.

### Exact Files Changed
- `mobile/src/utils/categoryIconMapping.ts`:
  - Added explicit mappings for `wash-iron` and `wash-and-iron` to `'wash'`.
  - Added pure `steam-ironing` mapping to `'iron'`.
  - Reordered keyword matching: checked compound `'wash'` + `'iron'` before standalone `'iron'`.
  - Set `DEFAULT_CATEGORY_ICON: 'tag'`.
- `mobile/src/components/AppIcon.tsx`:
  - Changed vector icon wrapper style from `overflow: 'hidden'` to `overflow: 'visible'` on native platforms.
- `mobile/src/screens/HomeScreen.tsx`:
  - Updated driver arrived state icon to `<AppIcon name="driver-arrived" size={16} color={colors.primary} />`.
- `mobile/src/utils/categoryIconMapping.test.ts`:
  - Added 17 unit test assertions covering all standard categories, compound keywords, and neutral fallbacks.

### Verification Results
- `mobile/src/utils/categoryIconMapping.test.ts`: **17/17 tests PASSED**.

---

## Issue 2 — Driver Dashboard Polling and Realtime Reconciliation

### Origin of the Recurring Refresh Spinner
1. **Background Polling vs. Stale Realtime Channel**:
   - In `mobile/src/screens/DriverDashboardScreen.tsx`, background intervals or manual re-fetches called `load()`. When `load()` did not distinguish between initial load and background sync, `loading` was toggled, wiping out `dashboard` and rendering the full-page spinner `<ActivityIndicator ... />`.
2. **Channel Identity Disconnect on Backend**:
   - The mobile driver client subscribed to Realtime channels using `driver:${profile.id}` (the authenticated user's profile ID).
   - Backend services (`backend/src/modules/drivers/drivers.service.ts` and `backend/src/modules/logistics/logistics.service.ts`) broadcasted events exclusively to `driver:${driver.id}` (the `delivery_drivers` table primary key) or generic admin channels.
   - Because the driver ID was a separate UUID from the auth profile ID, the mobile driver client never received the Realtime broadcast and was forced to rely on fallback polling.

### Solutions Implemented
1. **Dual Channel Broadcast in Backend**:
   - In `backend/src/modules/drivers/drivers.service.ts` (`claimJob`), broadcasted `ORDER_ASSIGNED` and `JOB_CLAIMED` to both `driver:${driver.id}` and `driver:${profileId}`.
   - In `backend/src/modules/logistics/logistics.service.ts` (`arrive`), broadcasted `DRIVER_ARRIVED` to both channels.
2. **Silent Background Invalidation & Optimistic Retention in Mobile**:
   - In `mobile/src/screens/DriverDashboardScreen.tsx`, updated `load(isRefresh = false)`:
     - Only sets `loading: true` if `!dashboardRef.current`.
     - Preserves existing dashboard data in memory during Realtime revalidations.
     - Never blanks the screen or shows full-page loaders for background reconciliation.
     - Reconnects Realtime channel on `AppState: 'active'` without wiping screen state.

---

## Issue 3 — OTP Field Covered by Android Keyboard

### Root Cause
- In `mobile/src/screens/DriverJobDetailScreen.tsx`, both pickup OTP and delivery OTP input cards are situated in the lower section of a `ScrollView`.
- On Android, soft input resizing (`windowSoftInputMode="adjustResize"` or `"adjustPan"`) combined with nested view containers caused the keyboard to cover the numeric OTP inputs and submit buttons.
- The screen previously issued a generic `scrollToEnd({ animated: true })`, which did not calculate keyboard height or offset, causing the input to be clipped beneath the virtual keyboard.

### Exact Files Changed
- `mobile/src/screens/DriverJobDetailScreen.tsx`:
  - Added keyboard event listeners (`keyboardDidShow` / `keyboardDidHide`) to accurately track dynamic `keyboardHeight`.
  - Added layout tracking via `otpCardYRef` on both the pickup OTP card and the delivery OTP card (`onLayout={(e) => { otpCardYRef.current = e.nativeEvent.layout.y; }}`).
  - Replaced blind scrolling with targeted scrolling: `scrollViewRef.current?.scrollTo({ y: Math.max(0, otpCardYRef.current - 20), animated: true })`.
  - Added dynamic scroll content padding: `contentContainerStyle={[styles.content, { paddingBottom: Math.max(120, keyboardHeight + 60) }]}`.
  - Added automatic `Keyboard.dismiss()` upon initiating OTP verification and inside modal success dismissals.

### Verification Results
- Validated via `mobile/src/screens/DriverJobDetailScreen.test.tsx`: **34/34 tests PASSED**.

---

## Issue 4 — Driver Pickup-to-Facility Workflow Skips Arrival Step

### Root Cause & Schema Constraint
- Inspection of Postgres database schema (`backend/src/database/migrations/20260907155337_consolidated_backend_schema.sql`) confirmed that Postgres enum `order_status` contains:
  `['created', 'pickup_assigned', 'pickup_accepted', 'driver_arrived_pickup', 'pickup_otp_pending', 'picked_up', 'in_transit_to_facility', 'received_at_facility', 'verification', 'processing', 'rework_required', 'ready_for_delivery', 'delivery_assigned', 'delivery_accepted', 'en_route_delivery', 'driver_arrived_delivery', 'delivery_otp_pending', 'delivered', 'claim_period_active', 'closed', 'cancelled']`.
- **Key Schema Finding**: There is **no** `arrived_at_facility` enum value in `order_status`. In-transit orders hold status `'in_transit_to_facility'` until staff receives them (`'received_at_facility'`).
- Authoritative arrival is tracked in the `driver_navigation_events` table with `event_type = 'arrived_at_facility'` and `order_id = <orderId>`.
- Prior to this fix, `receiptCandidate` and `receiptCandidateByOrderNumber` in `backend/src/modules/facility/facility.service.ts` allowed facility intake as long as the order status was `'in_transit_to_facility'`, completely ignoring whether the driver had actually recorded arrival!

### Solutions Implemented
1. **Backend State Machine Enforcement**:
   - In `backend/src/modules/facility/facility.service.ts`:
     - Added `requireArrival: boolean = false` parameter to `receiptCandidate` and `receiptCandidateByOrderNumber`.
     - When receiving orders via QR code (`receiveByQr`) or order number (`receiveByOrderNumber`), set `requireArrival: true`.
     - Queried `driver_navigation_events` for `event_type = 'arrived_at_facility'` and `order_id = <orderId>`. If no record exists, threw `ConflictException("Driver has not yet confirmed arrival at the facility")`.
2. **Driver Mobile Workflow**:
   - In `mobile/src/screens/DriverJobDetailScreen.tsx`:
     - After driver confirms pickup and starts transit, the active action is "Confirm Arrival at Facility" (`markDriverArrivedAtFacility`).
     - Only after recording arrival does `driverArrivedAtFacility` state persist.
     - Facility staff dashboard displays "In Transit" and disables receiving until the driver arrives.

### Verification Results
- Added regression test to `backend/src/modules/facility/facility.intake.spec.ts` asserting rejection when driver arrival is missing.
- Backend intake tests: **3/3 tests PASSED**.
- Backend facility dashboard & verification tests: **7/7 tests PASSED**.
- Cross-role realtime tests: **7/7 tests PASSED**.

---

## Issue 5 — Driver Dashboard Flickering on Location Permission Denial

### Root Cause
- In `mobile/src/screens/DriverJobDetailScreen.tsx`, location permission was requested unconditionally in an `AppState: 'active'` listener and in an unconstrained `useEffect([tripActive])`.
- When a driver clicked "Deny", the state updated to `'denied'`. The component re-rendered, triggering the effect again or failing an unhandled promise, which caused continuous re-renders, screen flicker, and an abrupt red error box.
- Directions buttons blindly called `openDirections` without verifying current permission or availability.

### Solutions Implemented
1. **Guarded Permission State Lifecycle**:
   - In `mobile/src/screens/DriverJobDetailScreen.tsx`:
     - Added `permissionAttempted` ref to ensure initial permission request is evaluated at most once per active trip.
     - Removed redundant permission re-requests from the `AppState: 'active'` listener (only performs silent `load(true)`).
     - Distinctly handled `granted`, `denied`, and `blocked` (permanently denied) states.
     - When permission is denied, set a non-blocking diagnostic banner (`"Location permission denied. Enable location in Settings."`) without blanking the order details or disabling unrelated workflow buttons.
2. **On-Demand Navigation Permission & Bounded GPS Acquisition**:
   - Updated `openDirections` and `openFacilityDirections`:
     - Checked location permission explicitly when the driver presses the navigation button.
     - If blocked, displayed an actionable alert with a shortcut to open device app settings.
     - If permission is available, acquired fresh coordinates with a bounded timeout (`timeoutMs: 10000`).
     - Preserved last known location only according to business rules; never fabricated fake GPS coordinates.

### Verification Results
- Validated via `mobile/src/screens/DriverJobDetailScreen.test.tsx`: **34/34 tests PASSED**.

---

## Issue 6 — Facility Processing Screen Multiple Loading Indicators

### Root Cause
- As demonstrated in the supplied facility recording, completing Wash and Dry stages caused full-screen loading spinners to repeatedly flash and interrupt the operator.
- Detailed code tracing revealed a severe cascade:
  1. `FacilityProcessingPanel.tsx` had a Realtime subscription `useOrderRealtime` that called `onChanged()` on every single event.
  2. Inside `act()`, after completing a stage (e.g., Wash), it called `onChanged()`.
  3. In `FacilityVerificationScreen.tsx`, `onChanged` invoked the parent callback passed from `App.tsx`: `() => setFacilityRefresh(value => value + 1)`.
  4. In `App.tsx` (line 1475), `setFacilityRefresh` caused the root `App` component to re-render!
  5. Because `Stack.Screen` used an inline render function `{({route}) => <FacilityVerificationScreen ... />} `, React Navigation treated it as a new component on every `App` re-render.
  6. This completely unmounted `FacilityVerificationScreen` and `FacilityProcessingPanel`, resetting `loading: true`, `detail: null`, and `history: null`.
  7. Consequently, two full-page `ActivityIndicator` spinners ("Loading garment verification" and "Loading processing history") flashed on the screen on every stage click and every Realtime event!

### Solutions Implemented
1. **Isolated Stage Progression**:
   - In `mobile/src/screens/FacilityProcessingPanel.tsx`:
     - Removed `onChanged()` from `useOrderRealtime` (silently runs `refresh(true)`).
     - Parameterized `act(actionId, action, success, isStatusChange = false)`. Only terminal QC decisions (`qc-pass` and `qc-fail`) notify the parent of an order status change. Intermediate processing stages (Wash, Dry, Iron, Fold, Pack) do not notify the parent screen.
     - Buttons display a scoped `ActivityIndicator` on `submittingActionId`, keeping the entire stepper, stages list, and notes visible and interactive.
2. **Protected Screen Tree in Verification Screen**:
   - In `mobile/src/screens/FacilityVerificationScreen.tsx`:
     - Updated `onChanged={(isStatusChange?: boolean) => { if (isStatusChange) onChanged(); load(true); setPackingReady(false); }}`.
     - Added `onChanged()` to the back button (`← Back`) so the dashboard revalidates only when returning.

### Verification Results
- `mobile/src/screens/FacilityProcessingPanel.test.tsx`: **5/5 tests PASSED**.
- `mobile/src/screens/FacilityVerificationScreen.test.tsx`: **7/7 tests PASSED**.
- `mobile/src/screens/FacilityDashboardScreen.test.tsx`: **7/7 tests PASSED**.

---

## Automated Test and Build Summary

### Mobile Test Suite (`mobile/`)
```bash
npx jest src/utils/categoryIconMapping.test.ts src/screens/DriverJobDetailScreen.test.tsx src/screens/FacilityProcessingPanel.test.tsx src/screens/FacilityVerificationScreen.test.tsx src/screens/FacilityDashboardScreen.test.tsx
```
- **Test Suites:** 5 passed, 5 total
- **Tests:** 70 passed, 70 total
- **Snapshots:** 0 total
- **Execution Time:** 9.58s

### Backend Test Suite (`backend/`)
```bash
npm test -- test/phase5-realtime-cross-role.spec.ts src/modules/facility/facility.intake.spec.ts src/modules/facility/facility.dashboard.spec.ts src/modules/facility/facility.verification.spec.ts
```
- **Test Suites:** 4 passed, 4 total
- **Tests:** 17 passed, 17 total
- **Snapshots:** 0 total
- **Execution Time:** 6.63s

### TypeScript Static Checks (`tsc --noEmit`)
- `mobile`: **0 type errors** (`tsc --noEmit` exited with code 0).
- `backend`: **0 type errors** (`tsc --noEmit` exited with code 0).

---

## Remaining Limitations & Recommended Real-Device Checks

1. **Hardware GPS & Android OEM Battery Optimizations**:
   - Automated tests verify permission logic and mock coordinate acquisitions.
   - On physical devices (e.g., Xiaomi MIUI, Samsung OneUI), background battery saving can throttle GPS watchers when the screen locks. Recommend testing foreground-service behavior on a real Android device.
2. **Keyboard Soft-Input Window Configuration**:
   - Verified with Android keyboard listeners and scroll calculations. Real-device testing with custom soft keyboards (Gboard, SwiftKey, Samsung Keyboard) is recommended to confirm floating/split keyboard padding.
3. **Database Migration Note**:
   - Because Postgres `order_status` enum cannot be altered in a locked production schema without a migration, arrival enforcement relies on `driver_navigation_events`. If a future schema migration adds `'arrived_at_facility'` to the `order_status` enum, the backend state machine can transition `current_status` directly.
