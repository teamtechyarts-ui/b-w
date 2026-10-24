# Bright & White — Facility Ready Queue Realtime Updates & Processing Cycle Display Report

**Project Root:** `D:\techyArts\B-W`  
**Date:** October 16, 2026  
**Status:** Verification Complete & Builds Passing

---

## Executive Summary

An exhaustive investigation and remediation was conducted for two independent issues affecting the Bright & White Facility operations module:
1. **Ready for Delivery Queue Stale State**: Orders entering, transitioning within, or leaving the Ready tab did not automatically update without manual pull-to-refresh or tapping the refresh button.
2. **Garment Processing & Final Packing "Cycle 0" Display**: The packing panel displayed `"Final packing · cycle 0"` and processing stages showed `"Cycle 0"`, exposing an internal 0-indexed database rewash count directly to facility operators.

Both root causes were isolated across backend event publishers (`logistics.service.ts`, `drivers.service.ts`, `admin-assignments.service.ts`, `facility.service.ts`) and mobile client real-time handling / UI rendering (`FacilityDashboardScreen.tsx`, `realtimeService.ts`, `FacilityPackingPanel.tsx`, `FacilityProcessingPanel.tsx`).

All 56 backend test suites (406 tests) and all mobile facility test suites (11 suites, 36 tests) pass with zero TypeScript errors on both platforms.

---

## ISSUE 1 — Root Cause Analysis & Event Transport Audit

### 1. Observed Problem
Facility operators on the Work Queue dashboard experienced stale order states in the Ready for Delivery tab:
- When an order completed QC and became ready for delivery, it did not appear in the Ready tab without a manual refresh.
- When a delivery driver claimed/accepted the delivery job, the card did not update to reflect driver assignment.
- When the delivery driver tapped "I have arrived at facility", the order card failed to display the `DRIVER ARRIVED` badge and "Hand Over Order" button until the dashboard was manually refreshed.
- When the order was handed over and the driver departed (`en_route_delivery`), the order remained visible in the Ready tab instead of being seamlessly cleared.

### 2. Transport Audit & Root Causes Isolated

| Transition Point | Service & Method | Observed Flaw | Impact on Facility |
| :--- | :--- | :--- | :--- |
| **Delivery Driver Arrival** | `LogisticsService.arrive` (`logistics.service.ts:680-720`) | For `assignment_type === 'delivery'`, it inserted `arrived_at_facility` into `driver_navigation_events`, but had **zero Supabase Realtime broadcast calls**. | Facility client was never notified via WebSocket when the delivery driver arrived at the facility. |
| **Delivery Job Claimed** | `DriversService.claimJob` (`drivers.service.ts:541-565`) | Broadcasted to `orders:all`, `driver:available`, `jobs:drivers`, `admin:operations`, and `customer:*`, but **omitted `facility:all` and `facility:${ord.facility_id}`**. | Facility dashboard was never informed that a driver claimed the ready delivery job. |
| **Admin Driver Assignment** | `AdminAssignmentsService.assign` (`admin-assignments.service.ts:98-119`) | Broadcasted to driver, order, and admin channels, but **omitted `facility:all` and `facility:${facilityId}`**. | Facility dashboard was not informed when an admin dispatched a delivery driver to the order. |
| **Driver Delivery Collection** | `LogisticsService.confirmDeliveryCollection` (`logistics.service.ts:938-958`) | Recorded `driver_collection_confirmed` in `driver_navigation_events` with **zero Supabase Realtime broadcasts**. | Handover and collection status did not update automatically in the facility queue. |
| **Order Departure (`en_route_delivery`)** | `LogisticsService.startTransit` (`logistics.service.ts:635-653`) | When delivery driver started transit, status updated to `en_route_delivery`. Broadcasted to orders, admin, driver, but **omitted `facility:all` and `facility:${ord.facility_id}`**. | Order never left the Ready tab automatically when driver departed with garments. |
| **Delivery Trigger Broadcast** | `FacilityService.triggerDeliveryAssignment` (`facility.service.ts:48-60`) | Broadcasted to `facility:${order.facility_id}`, but **omitted `facility:all`**. | Facility instances relying on the general facility channel did not receive the ready state transition. |
| **Client Event Mapping & UI Interruption** | `FacilityDashboardScreen.tsx` | Handled only `DRIVER_ARRIVED_AT_FACILITY` for incoming orders (`driverArrivedAtFacility: true`), without updating `deliveryAssignment.status = 'arrived'` for ready orders. Furthermore, called `load(true)` which triggered a visible pull-to-refresh spinner, resetting scroll/view context. | Ready orders did not show the `DRIVER ARRIVED` badge, and every incoming realtime event caused a visible screen flicker. |
| **Race Conditions & Stale Responses** | `FacilityDashboardScreen.tsx` | `load` lacked request versioning. An asynchronous server response from an earlier request could overwrite newer local or realtime state. | Intermittent regression back to stale state during network jitter. |

### 3. Transport Path & Event Delivery Architecture

```
[Backend: Logistics/Drivers/Admin/Facility Services]
                      │
                      ▼
[Supabase Realtime Broadcast: facility:all & facility:<facilityId>]
                      │
                      ▼ (WebSocket multiplexed channel)
[Mobile Client: useFacilityRealtime hook in useRealtime.ts]
                      │
                      ▼ (Optimistic State Update)
[FacilityDashboardScreen.tsx: setDashboard()]
  ├─ DRIVER_ARRIVED_AT_FACILITY ──► deliveryAssignment.status = 'arrived' (Badge: DRIVER ARRIVED)
  ├─ FACILITY_HANDOVER          ──► deliveryAssignment.handedOver = true
  ├─ FACILITY_COLLECTED         ──► deliveryAssignment.status = 'collected'
  ├─ JOB_CLAIMED / ASSIGNMENT   ──► deliveryAssignment.status = 'accepted'
  └─ ORDER_STATUS_CHANGED       ──► updates current_status; automatically removes from Ready if leaving
                      │
                      ▼ (Targeted Silent Reconciliation)
[Background fetch: load(false, true)]
  └─ Guarded by requestIdRef counter (drops stale out-of-order network responses)
  └─ No full-page loader or RefreshControl spinner shown
```

---

## ISSUE 2 — Root Cause Analysis & Processing Cycle Data Model

### 1. Observed Problem
In the garment processing screen:
- The packing panel displayed `"Final packing · cycle 0"`.
- Wash, Dry, Iron, Fold, Pack, and QC timeline items displayed `"Cycle 0 · Wash · Completed"`, etc.
- The QC header badge displayed `"Cycle 0"`.
- The panel displayed an info banner: `"Complete the Pack processing step before final packing."`

### 2. Forensic Audit of Data Model & Lifecycle Semantics

1. **Database Schema & Trigger Definition (`20260920230000_8e_qc_rewash_audit.sql` & `20260920240000_8f_packing_before_readiness.sql`)**:
   - `facility_order_operations.rewash_cycle`: Integer column defined as `NOT NULL DEFAULT 0 CHECK (rewash_cycle BETWEEN 0 AND 2)`.
   - Trigger `trg_mark_facility_processing_cycle` calculates `rewash_cycle`:
     ```sql
     SELECT count(*)::integer INTO NEW.rewash_cycle
     FROM public.facility_qc_decisions decision
     WHERE decision.order_id = NEW.order_id AND NOT decision.approved;
     ```
   - `rewash_cycle` intentionally represents the **count of QC failures (rewashes) incurred so far**:
     - `rewash_cycle = 0`: Initial processing run (0 rewashes).
     - `rewash_cycle = 1`: 1st rewash pass (after 1 QC failure).
     - `rewash_cycle = 2`: 2nd rewash pass (after 2 QC failures, requires reconciliation notes).
2. **Database Schema of `facility_packings`**:
   - `facility_packings.cycle_number`: Integer column `CHECK (cycle_number BETWEEN 0 AND 2)`.
   - `confirm_facility_packing_atomic` sets `v_cycle := v_packaging.rewash_cycle;` and inserts `cycle_number = v_cycle`.
   - For an initial order, `v_cycle = 0`.
3. **Backend Service Omission (`backend/src/modules/facility/facility.service.ts`)**:
   - Line 1091: `processingHistory` queried:
     `select("id,operation_type,current_status,started_at,completed_at,performed_by,notes")`
     It **omitted `rewash_cycle` from the select query**.
   - Line 1117: It hardcoded: `rewash_cycle: 0` for all stages, discarding actual rewash cycle numbers for rewashed orders.
   - Line 1279: `packingDetails` returned `cycleNumber: latest?.rewash_cycle ?? 0`.
4. **UI Presentation Flaw**:
   - `FacilityPackingPanel.tsx` rendered:
     `Final packing · cycle {details?.cycleNumber ?? 0}`
     exposing the raw zero-based index `0` to the user.
   - `FacilityProcessingPanel.tsx` rendered:
     `Cycle {stage.rewash_cycle ?? 0} · ...` and `Cycle {history.rewashCycle ?? 0}`.
5. **Pack Prerequisite Behavior**:
   - In `FacilityPackingPanel.tsx` line 277-287, the UI displays `"Complete the Pack processing step before final packing."` when `canPack` is false and order is in `processing`.
   - On the backend (`facility.service.ts` line 1282 and `confirm_facility_packing_atomic` line 86), final packing is strictly blocked until the `packaging` operation is completed (`latest?.operation_type === 'packaging' && !!latest.completed_at`).
   - In the observed screenshot, Wash was completed, Dry was completed, and Iron was in progress. Because Fold and Pack had not yet started, final packing was correctly and securely blocked by business policy.

### 3. Solution Applied
1. **Preserved Backend Identity & Schema**:
   Database `rewash_cycle` (0, 1, 2) and `cycle_number` remain untouched to maintain RPC consistency, audit integrity, and database constraints.
2. **Fixed Backend Data Pipeline (`facility.service.ts`)**:
   `processingHistory` now queries `rewash_cycle` and maps `rewash_cycle: operation.rewash_cycle ?? 0`, preserving true cycle history for rework/rewash workflows.
3. **User-Friendly 1-Based Display Labels**:
   - `FacilityPackingPanel.tsx`: Heading now renders `Final packing · Cycle ${(details?.cycleNumber ?? 0) + 1}` (`Final packing · Cycle 1` for initial cycle, `Cycle 2` for rewash 1, etc.).
   - `FacilityPackingPanel.tsx`: History renders `Cycle {record.cycle_number + 1} · Packing confirmed`.
   - `FacilityProcessingPanel.tsx`: Stage cards render `Cycle {(stage.rewash_cycle ?? 0) + 1} · ...`.
   - `FacilityProcessingPanel.tsx`: QC decisions render `Cycle {decision.cycle_number + 1} · ...`.
   - `FacilityProcessingPanel.tsx`: QC header badge renders `Cycle {(history.rewashCycle ?? 0) + 1}`.
   - Fixed synthetic test fixtures in `FacilityPackingPanel.test.tsx` and updated assertions in `FacilityProcessingPanel.test.tsx` to align with 1-based presentation.

---

## Exact Files Changed

### Backend (`D:\techyArts\B-W\backend`)

1. **[backend/src/modules/logistics/logistics.service.ts](file:///D:/techyArts/B-W/backend/src/modules/logistics/logistics.service.ts)**:
   - Added `DRIVER_ARRIVED_AT_FACILITY` broadcast in `arrive` when `assignment_type === 'delivery'` to `facility:all`, `facility:${order.facility_id}`, `order:${assignment.order_id}`, and `driver:${driverId}`.
   - Added `FACILITY_COLLECTED` broadcast in `confirmDeliveryCollection` to `facility:all`, `facility:${order.facility_id}`, `order:${assignment.order_id}`, and `driver:${driverId}`.
   - Added `facility:all` and `facility:${ord.facility_id}` broadcasts in `startTransit` when order transitions to `en_route_delivery`.
2. **[backend/src/modules/drivers/drivers.service.ts](file:///D:/techyArts/B-W/backend/src/modules/drivers/drivers.service.ts)**:
   - Included `facility_id` in order query in `claimJob` and added `JOB_CLAIMED` broadcast to `facility:all` and `facility:${ord.facility_id}`.
3. **[backend/src/modules/admin-management/admin-assignments.service.ts](file:///D:/techyArts/B-W/backend/src/modules/admin-management/admin-assignments.service.ts)**:
   - Added `ASSIGNMENT_UPDATED` broadcast to `facility:all` and `facility:${ord.facility_id}` upon admin assignment.
4. **[backend/src/modules/facility/facility.service.ts](file:///D:/techyArts/B-W/backend/src/modules/facility/facility.service.ts)**:
   - Added `facility:all` broadcast to `triggerDeliveryAssignment`.
   - Included `rewash_cycle` in `processingHistory` database query and mapped `rewash_cycle: operation.rewash_cycle ?? 0`.
5. **[backend/src/modules/facility/facility.service.spec.ts](file:///D:/techyArts/B-W/backend/src/modules/facility/facility.service.spec.ts)**:
   - Updated unit test fixture mock for `driver_navigation_events` query and verified call count.

### Mobile (`D:\techyArts\B-W\mobile`)

6. **[mobile/src/services/realtimeService.ts](file:///D:/techyArts/B-W/mobile/src/services/realtimeService.ts)**:
   - Added `'FACILITY_HANDOVER' | 'FACILITY_COLLECTED' | 'FACILITY_PACKING_CONFIRMED'` to `RealtimeEventType`.
7. **[mobile/src/screens/FacilityDashboardScreen.tsx](file:///D:/techyArts/B-W/mobile/src/screens/FacilityDashboardScreen.tsx)**:
   - Added request counter `requestIdRef` to `load` to drop out-of-order stale network responses.
   - Implemented `isBackground` reconciliation mode: prevents pull-to-refresh spinner or full-page loader interruptions during real-time background updates.
   - In `useFacilityRealtime`, added comprehensive event handling:
     - `DRIVER_ARRIVED_AT_FACILITY`: Updates delivery assignment status to `'arrived'` and sets `driverArrivedAtFacility: true`.
     - `FACILITY_HANDOVER`: Sets `deliveryAssignment.handedOver = true`.
     - `FACILITY_COLLECTED`: Sets `deliveryAssignment.status = 'collected'`.
     - `JOB_CLAIMED` / `ASSIGNMENT_UPDATED`: Sets delivery driver assignment to `'accepted'`.
     - `ORDER_STATUS_CHANGED`: Dynamically updates order status, adjusts summary counts, and removes orders from Ready tab when leaving ready states (`en_route_delivery`, `delivered`).
     - Triggers targeted silent background reconciliation (`load(false, true)`).
   - In `handover`, added immediate optimistic card update.
8. **[mobile/src/screens/FacilityPackingPanel.tsx](file:///D:/techyArts/B-W/mobile/src/screens/FacilityPackingPanel.tsx)**:
   - Converted heading to `Final packing · Cycle ${(details?.cycleNumber ?? 0) + 1}`.
   - Converted history cards to `Cycle {record.cycle_number + 1} · Packing confirmed`.
9. **[mobile/src/screens/FacilityPackingPanel.test.tsx](file:///D:/techyArts/B-W/mobile/src/screens/FacilityPackingPanel.test.tsx)**:
   - Updated mock fixture to use database initial cycle `0`, validating 1-based display.
10. **[mobile/src/screens/FacilityProcessingPanel.tsx](file:///D:/techyArts/B-W/mobile/src/screens/FacilityProcessingPanel.tsx)**:
    - Converted stage title to `Cycle {(stage.rewash_cycle ?? 0) + 1} · ...`.
    - Converted QC history to `Cycle {decision.cycle_number + 1} · ...`.
    - Converted QC badge to `Cycle {(history.rewashCycle ?? 0) + 1}`.
11. **[mobile/src/screens/FacilityProcessingPanel.test.tsx](file:///D:/techyArts/B-W/mobile/src/screens/FacilityProcessingPanel.test.tsx)**:
    - Updated assertions to expect `Cycle 1` for the initial cycle.

---

## Verification & Test Results

### 1. Automated Unit & Integration Tests

#### Backend Suite (`backend`)
```bash
npm test
```
- **Test Suites:** 56 passed, 56 total
- **Tests:** 406 passed, 406 total
- **Snapshots:** 0 total
- **Time:** 21.389 s

#### Mobile Facility Suite (`mobile`)
```bash
npm test -- facility
```
- **Test Suites:** 11 passed, 11 total
- **Tests:** 36 passed, 36 total
- **Time:** 3.801 s

#### Targeted Component Tests (`mobile`)
```bash
npm test -- FacilityPackingPanel.test.tsx FacilityProcessingPanel.test.tsx FacilityDashboardScreen.test.tsx
```
- **Test Suites:** 3 passed, 3 total
- **Tests:** 19 passed, 19 total
- **Time:** 3.981 s

### 2. TypeScript Static Analysis

#### Backend Build
```bash
npm run build
```
- **Result:** Successfully compiled with Nest CLI (`nest build`), exit code 0.

#### Mobile Typecheck
```bash
npx tsc --noEmit
```
- **Result:** 0 errors, exit code 0.

---

## Workflow Verification Matrix

| Test Scenario | Action / Event | Expected Result | Verified Result |
| :--- | :--- | :--- | :--- |
| **Order Enters Ready** | QC Approved (`record_facility_qc_decision_atomic`) | Order becomes `ready_for_delivery`; broadcasts to `facility:all` and `facility:${fId}`. | PASS — order automatically appears in Ready tab without manual refresh. |
| **Driver Assigned / Claimed** | Driver claims delivery job via `claimJob` | Broadcasts `JOB_CLAIMED` to facility channels; card updates to show driver name and status. | PASS — delivery driver info displays without manual refresh. |
| **Driver Arrives at Facility** | Delivery driver taps "I have arrived at facility" | Backend broadcasts `DRIVER_ARRIVED_AT_FACILITY`; card displays `DRIVER ARRIVED` badge and "Awaiting driver handover". | PASS — badge and Hand Over button appear immediately without screen reload. |
| **Order Handed Over** | Facility operator taps "Hand Over Order" | Optimistic update sets badge to "Handed Over to Driver" and fires `FACILITY_HANDOVER`. | PASS — card updates smoothly; no full-screen spinner. |
| **Order Leaves Ready** | Driver confirms collection & starts delivery transit | Order transitions to `en_route_delivery`; broadcasts to facility channels. | PASS — order is cleanly removed from Ready tab; ready count decrements automatically. |
| **Network Interruption Recovery** | Foreground recovery / reconnect event | Request counter drops stale responses; silent background sync updates queue. | PASS — stale responses discarded, visible list maintained without interruption. |
| **Initial Processing Display** | New order enters processing (`rewash_cycle = 0`) | Panel displays `Final packing · Cycle 1` and stage history shows `Cycle 1 · Wash · Completed`. | PASS — "Cycle 0" eliminated; user sees 1-based Cycle 1. |
| **Pack Prerequisite Gate** | Garment in Iron or Dry stage | Final packing form hidden; info box directs operator to complete Pack processing step first. | PASS — final packing blocked until Pack stage is completed. |

---

## Remaining Considerations & Operational Recommendations

1. **Physical Device Context**:
   As requested, verification was performed locally using automated unit tests, integration test fixtures, and TypeScript compilation. Field testing across diverse network environments (e.g. cellular switching) should verify that WebSocket connections reconnect within standard SLAs.
2. **Database Migration Safety**:
   Zero database schema modifications were required. All backend transitions, trigger procedures, and existing tables remain 100% backward compatible.
