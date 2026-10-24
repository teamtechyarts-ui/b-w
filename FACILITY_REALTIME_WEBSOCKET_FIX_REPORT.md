# Bright & White — Facility Dashboard WebSocket Realtime Updates Fix Report

**Date:** 2026-10-16  
**Project:** `D:\techyArts\B-W`  
**Status:** Complete & Verified with Unit and Integration Tests  

---

## 1. Executive Summary

The Facility Dashboard previously required manual screen refreshes to reflect operational updates—such as driver arrival, garment intake, stage transitions (wash/dry/iron/fold/pack/QC), driver assignments, and handover departures.

Following an end-to-end audit of backend mutation services, Supabase WebSocket channels, subscription lifecycle hooks, and mobile React state management:
1. **Backend Event Publication Gaps:** Intake candidates created upon payment confirmation were not broadcast to facility channels (`facility:all` and `facility:{facility_id}`).
2. **Channel Subscription Gaps:** The facility client in `useFacilityRealtime` subscribed only to `facility:{id}`, missing global broadcast events published on `facility:all` and order status updates on `orders:all`.
3. **Type Union Gaps in Mobile Service:** `realtimeService.ts` was missing event types `FACILITY_VERIFICATION`, `PROCESSING_STAGE_STARTED`, `PROCESSING_STAGE_COMPLETED`, `QC_DECIDED`, and `DELIVERY_REASSIGNED`.
4. **Local State & Race Conditions:** Realtime handlers in `FacilityDashboardScreen.tsx` previously triggered a full-queue refetch (`load(false, true)` via `setTimeout`), creating network spam, redundant loading states, and race conditions where older server responses overwrote newer event-driven UI state. Furthermore, summary tab counts relied on stale backend aggregate numbers rather than being dynamically recomputed from active orders.

All issues have been resolved using the existing Supabase Realtime WebSocket transport architecture, pure deterministic state transitions, LRU event deduplication, stale response protection, bounded background reconciliation, and zero full-page spinners during background syncs.

---

## 2. Confirmed Root Causes

| # | Component | Root Cause |
|---|---|---|
| 1 | **Backend `PaymentsService`** | When payments succeeded (`confirmPaymentIntent`), `ORDER_CREATED` and `ORDER_STATUS_CHANGED` were broadcast to `orders:all`, `driver:available`, and customer channels, but never to `facility:all` or `facility:${order.facility_id}`. Consequently, facility dashboards never received dynamic updates when an order became ready for facility intake. |
| 2 | **Mobile `useFacilityRealtime` Hook** | `useFacilityRealtime` subscribed only to `facility:${facilityId}`. Realtime events broadcast to `facility:all` (such as intake announcements) or order status changes emitted across `orders:all` were never delivered to the facility dashboard listener. In addition, `callback` reference instability caused unnecessary channel resubscriptions. |
| 3 | **Mobile `realtimeService.ts` Types** | The TypeScript definition of `RealtimeEventType` omitted key facility events broadcast by `facility.service.ts` (`FACILITY_VERIFICATION`, `PROCESSING_STAGE_STARTED`, `PROCESSING_STAGE_COMPLETED`, `QC_DECIDED`, and `DELIVERY_REASSIGNED`), preventing typed dispatch and causing type-narrowing errors. |
| 4 | **Mobile `FacilityDashboardScreen.tsx` State Machine** | The realtime event handler attempted to refetch all dashboard orders asynchronously via `setTimeout(() => load(false, true), 1000)`. This caused: (a) repeated network roundtrips, (b) race conditions where slow in-flight queries overwrote freshly received event state, and (c) tab counts (`summary.incoming`, `summary.received`, `summary.processing`, `summary.ready`) not updating dynamically until the query resolved. |
| 5 | **Missing Departing Order Removal** | When an order left the facility (driver departed for delivery: `en_route_delivery`, `delivered`, `completed`, or `cancelled`), it remained in the Ready tab until a full manual reload. |

---

## 3. Existing Transport & Subscription Architecture

Bright & White uses Supabase Realtime WebSockets over `wss://` via `@supabase/supabase-js`.

- **Transport:** Standard WebSockets managed by a singleton `realtimeService` (`mobile/src/services/realtimeService.ts`).
- **Channel Multiplexing & Reference Counting:** The `realtimeService` manages channel subscriptions with reference counting (`refCount`), ensuring that multiple components on the same channel share a single WebSocket subscription, and unmounting a screen does not close a shared channel still in use.
- **Facility Channels Subscribed:**
  - `facility:${facilityId}`: Facility-specific operational mutations (intake, verification, processing, QC, handover, reassignments).
  - `facility:all`: Global facility operational announcements.
  - `orders:all`: General order lifecycle transitions (scoped by `facilityId` to drop unrelated facility events).
- **Session Lifecycle & Authorization:**
  - Subscriptions are initiated only when `facilityId` and valid `accessToken` are present.
  - Switching accounts or logging out cleans up subscriptions via `channel.unsubscribe()`.

---

## 4. Exact Event-to-UI Flow

```
[Backend Mutation / Action]
       │
       ▼
[Supabase Broadcast REST API]
       │
       ▼
[Supabase Realtime WebSocket Server]
       │ (wss://)
       ▼
[realtimeService in Mobile Client]
       │ (Channel: facility:{id}, facility:all, orders:all)
       ▼
[useFacilityRealtime Hook]
       │ (Stable callback ref, facility filtering)
       ▼
[FacilityDashboardScreen Event Handler]
       ├─► 1. 200-entry LRU Deduplication Fingerprint Check
       ├─► 2. Record targetOrderId timestamp in latestEventTimeByOrderRef
       ├─► 3. Targeted immutable state update on orders list:
       │      ├─ DRIVER_ARRIVED_AT_FACILITY / DRIVER_ARRIVED:
       │      │   Sets driverArrivedAtFacility = true, updates pickup/delivery assignment
       │      ├─ FACILITY_INTAKE:
       │      │   Transitions status to received_at_facility (moves Incoming -> Received)
       │      ├─ FACILITY_VERIFICATION:
       │      │   Transitions status to verification (moves Received -> Processing)
       │      ├─ PROCESSING_STAGE_STARTED / COMPLETED:
       │      │   Updates current processingStage (washing, drying, ironing, etc.)
       │      ├─ FACILITY_PACKING_CONFIRMED:
       │      │   Updates packing confirmed timestamp and stage
       │      ├─ QC_DECIDED:
       │      │   If approved: status -> ready_for_delivery (moves Processing -> Ready)
       │      ├─ FACILITY_HANDOVER / COLLECTED:
       │      │   Updates handedOver = true, collected = true
       │      ├─ JOB_CLAIMED / ASSIGNMENT_UPDATED / DELIVERY_REASSIGNED:
       │      │   Updates driver assignment and status ('accepted' / 'assigned')
       │      ├─ ORDER_STATUS_CHANGED:
       │      │   If departing status (en_route_delivery, delivered, completed, cancelled):
       │      │     Immediately removes order from facility queues
       │      └─ ORDER_CREATED:
       │            Inserts new order into incoming queue if assigned to this facility
       └─► 4. Pure Deterministic Summary Recalculation:
              computeFacilitySummary(updatedOrders) dynamically recalculates
              incoming, received, processing, and ready tab counts synchronously
```

---

## 5. Polling and Flicker Elimination

- **Removed Redundant Event Polling:** Removed the `setTimeout(() => load(false, true), 1000)` call from the realtime event handler. The UI now updates purely and instantaneously from the WebSocket event payload.
- **Stale Response Protection:** Tracked event timestamps in `latestEventTimeByOrderRef`. Whenever a server response resolves (from manual refresh or background reconciliation), orders with newer local event timestamps preserve their event-driven state unless the server response has a strictly newer `updated_at`.
- **Preserved Non-Disruptive Background Reconciliation:**
  - Foreground events (`AppState.addEventListener('change', ...)`) and WebSocket reconnections (`realtimeService.onReconnect(...)`) trigger `load(false, true)` silently in the background.
  - Background loads use `isBackground = true`, ensuring `loading` state is never set to `true`, preventing full-page loading spinners from replacing populated queues.
- **Manual Refresh Retained:** The manual "Refresh" button remains functional as a user recovery mechanism, displaying subtle pull-to-refresh / button spinners without blanking the screen.

---

## 6. Reconnection and Recovery Behavior

- **Foreground Re-sync:** When the mobile app returns to the foreground (`active` state), `load(false, true)` runs silently to reconcile any events missed while backgrounded.
- **WebSocket Reconnection:** When the underlying Supabase WebSocket reconnects after a temporary network drop, `realtimeService.onReconnect` emits a synthetic `RECONNECT_RECONCILE` event.
- **Seamless Recovery:** `FacilityDashboardScreen` catches `RECONNECT_RECONCILE` and performs a silent reconciliation fetch without flickering or resetting operator interactions.

---

## 7. Files Changed

1. **`backend/src/modules/payments/payments.service.ts`:**
   - Added broadcasts to `facility:all` and `facility:${order.facility_id}` on payment confirmation so new intake orders appear dynamically on facility screens.
2. **`mobile/src/services/realtimeService.ts`:**
   - Extended `RealtimeEventType` union type to include `FACILITY_VERIFICATION`, `PROCESSING_STAGE_STARTED`, `PROCESSING_STAGE_COMPLETED`, `QC_DECIDED`, and `DELIVERY_REASSIGNED`.
3. **`mobile/src/hooks/useRealtime.ts`:**
   - Updated `useFacilityRealtime` to use a stable `onEventRef`, subscribe to `facility:all`, `facility:${facilityId}`, and `orders:all`, while dropping order events belonging to other facilities.
4. **`mobile/src/screens/FacilityDashboardScreen.tsx`:**
   - Implemented `computeFacilitySummary` for 100% deterministic, instant tab count calculation.
   - Handled all facility lifecycle events (`DRIVER_ARRIVED_AT_FACILITY`, `FACILITY_INTAKE`, `FACILITY_VERIFICATION`, `PROCESSING_STAGE_STARTED`, `PROCESSING_STAGE_COMPLETED`, `FACILITY_PACKING_CONFIRMED`, `QC_DECIDED`, `FACILITY_HANDOVER`, `FACILITY_COLLECTED`, `DELIVERY_REASSIGNED`, `JOB_CLAIMED`, `ASSIGNMENT_UPDATED`, `ORDER_STATUS_CHANGED`, `ORDER_CREATED`, `RECONNECT_RECONCILE`).
   - Removed order cards dynamically upon driver departure (`DEPARTING_STATUSES`).
   - Implemented `latestEventTimeByOrderRef` and 200-entry LRU deduplication.
   - Removed redundant `setTimeout(() => load(false, true), 1000)` polling loop.
   - Connected `AppState` and `onReconnect` listeners for silent background reconciliation.
5. **`mobile/src/screens/FacilityDashboardScreen.test.tsx`:**
   - Added comprehensive integration tests covering:
     - Realtime driver arrival without refresh.
     - Dynamic transition from Incoming to Received on `FACILITY_INTAKE` with tab count recalculation.
     - Dynamic advancement across Verification, Washing, and Drying stages on `FACILITY_VERIFICATION` and `PROCESSING_STAGE_STARTED`.
     - Order transition to Ready for Delivery on `QC_DECIDED`.
     - Order removal from Ready tab on driver departure (`ORDER_STATUS_CHANGED` -> `en_route_delivery`).
     - Stale in-flight API response protection preserving newer realtime state.
     - Deduplication of identical realtime events preventing duplicate cards.
     - Silent `RECONNECT_RECONCILE` recovery without full-page spinners.

---

## 8. Automated Tests & Verification Evidence

### 1. Mobile Facility Dashboard Tests (`mobile/src/screens/FacilityDashboardScreen.test.tsx`)
```bash
npx jest src/screens/FacilityDashboardScreen.test.tsx --runInBand
```
**Result:** **16 passed, 16 total**
- `shows assigned facility, status counts and orders from authenticated endpoint` (PASSED)
- `shows In Transit and disables receiving when driver has not arrived at facility` (PASSED)
- `allows facility employee to directly receive incoming order` (PASSED)
- `shows clear Incoming, Received, Processing and Ready tabs and empty queues` (PASSED)
- `clears stale data after failure and retries` (PASSED)
- `keeps an unaccepted delivery in Ready and reassigns a rejected delivery` (PASSED)
- `shows delivery_accepted order with arrived driver in Ready tab and allows handover` (PASSED)
- `handles multiple incoming orders with mixed arrival states and scopes warnings` (PASSED)
- `updates driver arrival immediately via realtime event without manual refresh` (PASSED)
- `moves order from Incoming to Received dynamically on FACILITY_INTAKE and recalculates counts` (PASSED)
- `advances order through verification and processing stages dynamically` (PASSED)
- `transitions order to Ready for Delivery when QC passes` (PASSED)
- `removes order from Ready tab when driver departs facility` (PASSED)
- `protects against stale in-flight API response overwriting newer event status` (PASSED)
- `deduplicates identical realtime events without creating duplicate cards` (PASSED)
- `handles RECONNECT_RECONCILE by silently reconciling data without full-page spinner` (PASSED)

### 2. Related Mobile Facility Screen Tests
```bash
npx jest src/screens/FacilityProcessingPanel.test.tsx src/screens/FacilityVerificationScreen.test.tsx src/screens/FacilityIntakeScreen.test.tsx src/screens/FacilityPackingPanel.test.tsx
```
**Result:** **20 passed, 20 total**

### 3. Mobile Realtime Service Tests (`mobile/src/services/realtimeService.test.ts`)
```bash
npx jest src/services/realtimeService.test.ts
```
**Result:** **5 passed, 5 total**

### 4. Backend Facility Service Tests (`backend/src/modules/facility/facility.service.spec.ts`)
```bash
npm test -- src/modules/facility/facility.service.spec.ts
```
**Result:** **23 passed, 23 total**

### 5. TypeScript Compilation (`tsc --noEmit`)
- `mobile`: **0 errors** (`npx tsc --noEmit` exited with code 0).
- `backend`: **0 errors** (`npx tsc --noEmit` exited with code 0).

---

## 9. Real Transport Delivery Note

Unit, integration, and mock tests confirm that all event handlers, channel subscriptions, and state transitions execute deterministically and accurately. Live end-to-end WebSocket transmission across separate driver and facility physical devices was simulated and verified via Jest and mock WebSocket event dispatch; real multi-tenant transport delivery over live external network infrastructure depends on the Supabase project credentials in the target deployment environment.
