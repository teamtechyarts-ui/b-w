# Bright & White — Facility Dashboard Driver Arrival State & Warning Fix Report

**Date:** October 16, 2026  
**Environment:** Local Workstation (Windows, Powershell, Node.js, NestJS Backend, React Native Mobile, Supabase Local/Live Database)  
**Verification Scope:** Live database query inspection, backend/mobile code analysis, Jest automated regression test suites, static TypeScript verification (`tsc --noEmit`).

---

## 1. Executive Summary

A critical state inconsistency was reported on the facility Work Queue:
- The driver confirmed "Arrived at Facility" from the driver mobile account.
- The facility dashboard continued to display the warning banner: `"Driver has not yet confirmed arrival at the facility"`.
- The dashboard Work Queue showed mixed order states:
  - One order displayed badge `DRIVER ARRIVED` and subtitle `"Driver arrived at facility"`.
  - Another order displayed badge `In Transit` and subtitle `"Driver en route to facility"`.
  - The arrival warning banner remained visible at the top of the queue.

Through live database inspection, backend code analysis, and mobile state tracking, the **exact root causes** were identified and resolved:
1. **The PostgREST `.maybeSingle()` Fatal Error on Duplicate Arrival Events**:
   When a driver tapped "Arrived at Facility" twice or a retry request occurred, two rows were inserted into `driver_navigation_events` 32ms apart. Querying `driver_navigation_events` with `.maybeSingle()` returned an HTTP 406 error (`PGRST116: Results contain 2 rows`) and `data: null`. The backend interpreted `null` as "no arrival event exists" and threw a 409 ConflictException, even though arrival had been confirmed twice.
2. **Stale Action Error Persistence in Mobile Dashboard**:
   In `FacilityDashboardScreen.tsx`, `actionError` was never cleared when `load()` reloaded dashboard data or when a Realtime arrival event was received. Once `actionError` was set, the banner remained stuck on screen indefinitely.
3. **Global Ambiguous Warning vs. Order-Scoped State**:
   The warning banner was placed at the top of the queue without indicating which specific order it belonged to, creating the false appearance that arrived orders were in an invalid state.
4. **Idempotency in Driver Logistics Service**:
   Arrival endpoints previously lacked complete guard checks against rapid concurrent double-taps on both pickup and delivery workflows.

---

## 2. Forensic Trace of Orders and Database State

A live database audit of the active facility (`e439908d-07ef-4ba2-b208-3b8d8423ce56` — *hythnagar*) revealed the exact orders shown in the screenshot:

| Order Number | Order ID | Current Status | Navigation Events (`driver_navigation_events`) | Dashboard Visual State |
| :--- | :--- | :--- | :--- | :--- |
| **BW-20261016-ACD8835C** | `8e0316eb-754a-46d6-a45c-cdf1313ee74f` | `in_transit_to_facility` | **2 arrival events** (`087506a3...` at `05:41:21.228Z`, `07b3c22c...` at `05:41:21.260Z`) | `DRIVER ARRIVED` (Driver arrived at facility) |
| **BW-20261016-9CEBAD28** | `877e3ae2-8ef5-43fb-a643-f54e66982310` | `in_transit_to_facility` | `navigate_facility` at `03:53:34Z` (**0 arrival events**) | `In Transit` (Driver en route to facility) |
| **BW-20261015-3C42CD84** | `0318fa97-a559-451a-9a75-b6ccfde7d6f8` | `in_transit_to_facility` | `navigate_facility` at `03:51:15Z` (**0 arrival events**) | `In Transit` (Driver en route to facility) |

### Key Findings:
1. **These are distinct, valid orders**:
   - Order `BW-20261016-ACD8835C` **had indeed arrived**.
   - Order `BW-20261016-9CEBAD28` **was genuinely still in transit**.
2. **Why the facility card displayed `DRIVER ARRIVED`**:
   In `backend/src/modules/facility/facility.service.ts` (`getFacilityDashboard`), incoming arrival events are queried in bulk:
   ```ts
   this.db().from("driver_navigation_events").select("order_id,event_type").in("order_id", incomingOrderIds).eq("event_type", "arrived_at_facility")
   ```
   Because this query returned an array, `incomingArrivedOrderIds.add(ev.order_id)` succeeded. Thus, `driverArrivedAtFacility: true` was sent to the mobile client, and the card displayed `DRIVER ARRIVED`.
3. **Why the receipt attempt threw `"Driver has not yet confirmed arrival at the facility"`**:
   When the facility employee clicked "Receive Order" for `BW-20261016-ACD8835C`, the endpoint `POST /facility/receive/order-id` called `receiptCandidateByOrderNumber(profileId, orderNumber, true)`.
   In `facility.service.ts`:
   ```ts
   // BROKEN LOGIC:
   const { data: arrivalEvent } = await this.db()
     .from("driver_navigation_events")
     .select("id")
     .eq("order_id", order.id)
     .eq("event_type", "arrived_at_facility")
     .maybeSingle(); // <--- FAILED WITH PGRST116 (2 rows returned)
   ```
   PostgREST returned:
   ```json
   {
     "code": "PGRST116",
     "details": "Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row",
     "message": "JSON object requested, multiple (or no) rows returned"
   }
   ```
   Because `data` was `null`, `if (!arrivalEvent)` evaluated to `true`, and the backend rejected the request with `ConflictException("Driver has not yet confirmed arrival at the facility")`!
4. **Why the warning remained stuck on the dashboard**:
   `FacilityDashboardScreen.tsx` caught this error and set `setActionError(...)`. When the dashboard was subsequently refreshed or when Realtime events arrived, `load()` did not clear `actionError`. Consequently, the error banner remained stuck at the top of the Work Queue.

---

## 3. Detailed Fixes Implemented

### Backend Service Updates

#### 1. Tolerating Multiple/Duplicate Arrival Events with `.limit(1)`
In `backend/src/modules/facility/facility.service.ts`:
- Replaced `.maybeSingle()` with `.limit(1)` in both `receiptCandidate` (QR-code intake) and `receiptCandidateByOrderNumber` (Order ID intake):
```ts
if (requireArrival) {
  const { data: arrivalEvents } = await this.db()
    .from("driver_navigation_events")
    .select("id")
    .eq("order_id", order.id)
    .eq("event_type", "arrived_at_facility")
    .limit(1);

  if (!arrivalEvents || !arrivalEvents.length) {
    throw new ConflictException(
      "Driver has not yet confirmed arrival at the facility",
    );
  }
}
```

#### 2. Driver Assignment Detail & Query Consistency
In `backend/src/modules/drivers/drivers.service.ts`:
- In `getAssignmentDetail`, updated `arrived_at_facility` check from `.maybeSingle()` to `.order("created_at", { ascending: false }).limit(1)` to ensure driver screens consistently reflect arrival state even if multiple records exist.

#### 3. Idempotent Arrival Event Persistence
In `backend/src/modules/logistics/logistics.service.ts`:
- In `arrive()`, ensured pickup arrival check uses `.order("created_at", { ascending: false }).limit(1)`. If an arrival record already exists, returns the existing record immediately without inserting duplicates.
- Added duplicate check for delivery drivers before inserting `arrived_at_facility`.

---

### Mobile Application Updates

#### 1. Realtime Targeted Reconciliation & Error Dismissal
In `mobile/src/screens/FacilityDashboardScreen.tsx`:
- When receiving `DRIVER_ARRIVED_AT_FACILITY` via Realtime:
  1. Optimistically updates the specific order in `dashboard.orders` to `driverArrivedAtFacility: true` without waiting for network re-fetch.
  2. Automatically clears any pending arrival action error (`actionError`) if present.
  3. Reconciles authoritative server data silently via `load(true)` in the background without blanking the screen or showing a full-screen loading spinner.

#### 2. Clearing Stale Errors on Dashboard Revalidation
- In `load()`, whenever fresh dashboard data is loaded, stale arrival errors are automatically cleared:
```ts
setActionError(prev => {
  if (prev.includes('Driver has not yet confirmed arrival')) {
    return '';
  }
  return prev;
});
```

#### 3. Order-Scoped Warnings on Invalid Receipt Attempts
- If an employee attempts to receive an order whose driver is still en route, the error message explicitly scopes the order:
```ts
if (targetOrder && !targetOrder.driverArrivedAtFacility) {
  setActionError(`Driver has not yet confirmed arrival at the facility for order ${orderNumber}.`);
  return;
}
```
- Orders that have arrived remain fully enabled for receipt.

#### 4. Actionable Dismiss Button on Error Banner
- Added an accessible "Dismiss" button to the error banner so operators can clear action errors manually if desired.

#### 5. Realtime Event Type Union Extension
In `mobile/src/services/realtimeService.ts`:
- Added `'DRIVER_ARRIVED'` and `'DRIVER_ARRIVED_AT_FACILITY'` to `RealtimeEventType` union to maintain strict TypeScript compliance.

---

## 4. Verification and Automated Test Results

### 1. Live Database Query Verification
Tested `.limit(1)` query directly against order `8e0316eb-754a-46d6-a45c-cdf1313ee74f` (`BW-20261016-ACD8835C`) containing two arrival events:
- **Prior `.maybeSingle()`**: `error: { code: 'PGRST116', details: 'Results contain 2 rows' }, data: null` (FAILURE).
- **Corrected `.limit(1)`**: `error: null, data: [ { id: '087506a3-946c-4b0d-ab8e-13f92582316e' } ]` (PASS).

### 2. Backend Automated Test Suite
Ran Jest test suites in `backend/`:
```bash
npm test -- test/phase5-realtime-cross-role.spec.ts src/modules/facility/facility.intake.spec.ts src/modules/facility/facility.dashboard.spec.ts src/modules/facility/facility.verification.spec.ts
```
- `src/modules/facility/facility.intake.spec.ts` (4/4 tests passed):
  - `resolves the assigned facility, order identity, and physical items without writing` (PASS)
  - `blocks wrong facility, inactive QR, and duplicate receipt state` (PASS)
  - `blocks receipt if driver has not confirmed arrival at facility` (PASS)
  - `allows receipt when driver confirmed arrival even if duplicate arrival events exist` (PASS)
- `test/phase5-realtime-cross-role.spec.ts` (7/7 tests passed)
- `src/modules/facility/facility.dashboard.spec.ts` (3/3 tests passed)
- `src/modules/facility/facility.verification.spec.ts` (4/4 tests passed)
- **Total:** 18 passed, 18 total.

### 3. Mobile Automated Test Suite
Ran Jest test suites in `mobile/`:
```bash
npx jest src/screens/FacilityDashboardScreen.test.tsx src/screens/FacilityVerificationScreen.test.tsx src/screens/FacilityProcessingPanel.test.tsx src/screens/DriverJobDetailScreen.test.tsx src/utils/categoryIconMapping.test.ts
```
- `src/screens/FacilityDashboardScreen.test.tsx` (8/8 tests passed):
  - `shows assigned facility, status counts and orders from authenticated endpoint` (PASS)
  - `shows In Transit and disables receiving when driver has not arrived at facility` (PASS)
  - `allows facility employee to directly receive incoming order` (PASS)
  - `shows clear Incoming, Received, Processing and Ready tabs and empty queues` (PASS)
  - `clears stale data after failure and retries` (PASS)
  - `keeps an unaccepted delivery in Ready and reassigns a rejected delivery` (PASS)
  - `shows delivery_accepted order with arrived driver in Ready tab and allows handover` (PASS)
  - `handles multiple incoming orders with mixed arrival states and scopes warnings` (PASS)
- All 5 test suites passed: **71 passed, 71 total**.

### 4. TypeScript Static Type Checks
- `backend`: `npx tsc --noEmit` exited with code 0 (0 errors).
- `mobile`: `npx tsc --noEmit` exited with code 0 (0 errors).

---

## 5. Exact Files Changed

| File | Changes Made |
| :--- | :--- |
| `backend/src/modules/facility/facility.service.ts` | Replaced `.maybeSingle()` with `.limit(1)` in `receiptCandidate` and `receiptCandidateByOrderNumber`. |
| `backend/src/modules/facility/facility.intake.spec.ts` | Enhanced fixture mock to support `limit` and added test verifying successful receipt with duplicate arrival events. |
| `backend/src/modules/drivers/drivers.service.ts` | Replaced `.maybeSingle()` with `.limit(1)` on driver arrival event check in `getAssignmentDetail`. |
| `backend/src/modules/logistics/logistics.service.ts` | Replaced `.maybeSingle()` with `.limit(1)` in pickup arrival and added duplicate check for delivery arrival. |
| `mobile/src/screens/FacilityDashboardScreen.tsx` | Added optimistic update for `DRIVER_ARRIVED_AT_FACILITY`, automatic error clearing on reload, order-scoped warning messages, and dismiss action. |
| `mobile/src/screens/FacilityDashboardScreen.test.tsx` | Added regression test covering mixed arrival queue states and scoped warning validation. |
| `mobile/src/services/realtimeService.ts` | Added `DRIVER_ARRIVED` and `DRIVER_ARRIVED_AT_FACILITY` to `RealtimeEventType` union. |
