# Facility Dashboard Quality Control Eligibility Resolution Report

**Project:** `D:\techyArts\B-W`  
**Screen:** Quality Inspection / Garment Processing Panel (`FacilityProcessingPanel.tsx`, `FacilityPackingPanel.tsx`, `FacilityVerificationScreen.tsx`)  
**Scope:** Local only. No Git commit, push, deploy, or unreviewed production SQL.

---

## 1. Executive Summary

When inspecting an order where Cycle 1 Fold and Cycle 1 Pack were completed, operators encountered a blocked state:
- The **Pass QC** button was disabled.
- An alert warned: *"Confirm final packing before QC can make this order ready."*
- Even after Pack was marked Completed, the UI did not allow the operator to proceed with QC approval.

The investigation confirmed that this was caused by a combination of stale state propagation, missing cross-component synchronization, and a hardcoded state clobber in `FacilityVerificationScreen.tsx`:
1. In `FacilityVerificationScreen.tsx`, every processing stage change unconditionally executed `setPackingReady(false)`, wiping out packing readiness even when packing was not required or already confirmed.
2. `FacilityPackingPanel` (which handles final garment count confirmation into a parcel) and `FacilityProcessingPanel` (which handles the 5 processing steps and QC) did not synchronize when the "Pack" stage completed, leaving `FacilityPackingPanel` with stale cached state (`canPack: false`).
3. `FacilityProcessingPanel` lacked authoritative backend awareness of whether final packing policy was actually required for the order.
4. When final packing was required, `FacilityProcessingPanel` only showed a passive warning with no action button to navigate to or complete final packing.

All root causes have been resolved cleanly with schema-compatible backend enhancements and responsive frontend state synchronization.

---

## 2. Root Cause Analysis

### A. The Clobbered Readiness State Bug
In `mobile/src/screens/FacilityVerificationScreen.tsx`:
```tsx
// Previous implementation:
<FacilityProcessingPanel
  ...
  onChanged={(isStatusChange?: boolean) => {
    if (isStatusChange) {
      onChanged();
    }
    load(true);
    setPackingReady(false); // <-- BUG: Blindly resets readiness on every processing step
  }}
/>
```
Whenever an operator completed a stage (e.g. Fold or Pack):
- `FacilityProcessingPanel` called `onChanged(false)`.
- `FacilityVerificationScreen` immediately executed `setPackingReady(false)`.
- Even for orders where final packing was not required (`packingRequired: false`), `packingReady` was forcibly set to `false`.
- Because `FacilityPackingPanel` was not instructed to reload, `onReadiness` was never called again to restore `packingReady: true`.

### B. Lack of Cross-Panel Synchronization on Pack Completion
- The 5 processing steps are: Wash -> Dry -> Iron -> Fold -> Pack (`packaging`).
- Final packing (`FacilityPackingPanel`) is a separate verification step where the operator verifies garment counts against intake counts and records a parcel.
- On the backend, final packing eligibility (`canPack`) requires that the Pack prep stage (`operation_type: 'packaging'`) is completed (`completed_at IS NOT NULL`).
- When the operator completed Pack in `FacilityProcessingPanel`, `FacilityPackingPanel` was not notified to reload. It remained in its stale mount state where `canPack = false`, still displaying *"Complete the Pack processing step before final packing."* instead of rendering the packing confirmation form.

### C. Missing Authoritative Backend Packing Readiness in `processingHistory`
- `FacilityProcessingPanel` previously relied solely on an optional prop `packingReady?: boolean` passed from its parent, defaulting to `false`.
- The backend endpoint `/api/facility/orders/:orderId/processing` (`processingHistory`) did not query `facility_packing_policy_orders` or `facility_packings`.
- Consequently, `FacilityProcessingPanel` had no authoritative backend truth regarding whether the order actually had an active packing policy (`facility_packing_policy_orders`) or whether current-cycle packing was confirmed.

---

## 3. Prerequisite Rules & Workflow Architecture

The Bright & White processing lifecycle adheres to strict business rules:

1. **Processing Sequence**:
   - `Wash` -> `Dry` -> `Iron` -> `Fold` -> `Pack` must complete sequentially.
   - Operators cannot skip stages or start later stages out of order.
2. **Quality Control Eligibility**:
   - Quality inspection is unlocked only when `packaging` is completed (`operation_type = 'packaging' AND completed_at IS NOT NULL`) and there are 0 open intake discrepancies.
3. **Final Packing Requirement**:
   - If an order has an active packing policy (`facility_packing_policy_orders`), passing QC to transition the order to `ready_for_delivery` strictly requires that final packing (`facility_packings`) has been confirmed for the current cycle.
   - If an order does not require final packing policy (`packingRequired: false`), Pass QC is immediately enabled upon Pack stage completion.
4. **Actionable Recovery**:
   - When final packing is required, the UI must provide a clear reason and an immediate, usable action button (*"Confirm Final Packing"*) that navigates the operator directly to the packing confirmation form.

---

## 4. Files Changed

### 1. `backend/src/modules/facility/facility.service.ts`
- **`processingHistory` (lines 1091–1235)**:
  - Added concurrent `Promise.all` queries for `facility_packing_policy_orders` and `facility_packings`.
  - Computes `isPackingRequired = !policyResult?.error && !!policyResult?.data`.
  - Computes `isPacked = packings.some((p) => p.cycle_number === qcFailures.length)`.
  - Computes `packingReady = !isPackingRequired || isPacked`.
  - Returns `{ packingRequired, isPacked, packingReady }` so the client receives authoritative backend readiness.
- **`confirmPacking` (lines 1350–1425)**:
  - Added safe database table fallback if atomic RPC `confirm_facility_packing_atomic` is unavailable (`PGRST202`).
  - Atomically validates packaging completion, derives cycle number from QC history, checks duplicate packing constraints, and inserts into `facility_packings` and `facility_packing_items`.
- **`qualityCheck` (lines 1658–1695)**:
  - When `approved: true`, verifies whether `facility_packing_policy_orders` applies to the order. If active, requires confirmed final packing in `facility_packings` for the current cycle before allowing the approved transition.

### 2. `mobile/src/services/facilityProcessingApi.ts`
- Updated `ProcessingHistory` TypeScript interface to include:
  `packingRequired?: boolean; isPacked?: boolean; packingReady?: boolean;`

### 3. `mobile/src/screens/FacilityPackingPanel.tsx`
- Added `refreshTrigger?: number` prop.
- Added `useEffect` listening to `refreshTrigger` to automatically reload packing state whenever processing operations mutate.
- Updated `submit()` to immediately notify readiness `onReadiness(true)` upon successful confirmation.

### 4. `mobile/src/screens/FacilityProcessingPanel.tsx`
- Added `onConfirmPackingPress?: () => void` prop.
- Computed `effectivePackingReady`:
  ```tsx
  const effectivePackingReady =
    history?.packingReady !== undefined
      ? history.packingReady
      : history?.packingRequired === false
        ? true
        : packingReady;
  ```
- Replaced the passive text warning with an actionable warning card containing an active *"Confirm Final Packing"* button that invokes `onConfirmPackingPress`.
- Pass QC button disabled state now strictly tracks `busy || !effectivePackingReady`.

### 5. `mobile/src/screens/FacilityVerificationScreen.tsx`
- Added `packingRefreshTrigger` state.
- Removed the erroneous `setPackingReady(false)` clobber from `FacilityProcessingPanel.onChanged`.
- Connected `setPackingRefreshTrigger(t => t + 1)` in `onChanged` so `FacilityPackingPanel` re-evaluates `canPack` immediately when Pack completes.
- Linked `onConfirmPackingPress` to automatically scroll the screen directly to the Final Packing form.

---

## 5. Verification & Test Execution

### A. Live Database Verification
- Tested order `BW-20261006-B774233C` (UUID: `62a064fe-4605-4e49-ad76-58bf6197e5b8`):
  - `packingRequired: false`
  - `packingReady: true`
  - Pass QC is enabled with 0 database errors.

### B. Automated Backend Test Suites
```bash
npm test -- facility.service.spec.ts facility.packing.spec.ts admin-facility-oversight.service.spec.ts
```
- `facility.service.spec.ts`: **25 passed, 25 total** (including new regression tests:
  - `returns packingReady true when packing policy is not required`
  - `blocks quality check approval when packing policy is active and final packing is missing`).
- `facility.packing.spec.ts`: **2 passed, 2 total**.
- `admin-facility-oversight.service.spec.ts`: **7 passed, 7 total**.
- `npm run build`: Backend NestJS build succeeded with **0 errors**.

### C. Automated Mobile Test Suites
```bash
npm test -- FacilityProcessingPanel.test.tsx FacilityPackingPanel.test.tsx FacilityVerificationScreen.test.tsx
```
- `FacilityProcessingPanel.test.tsx`: **8 passed, 8 total** (including new tests:
  - `disables Pass QC and provides Confirm Final Packing action button when packing is not ready`
  - `enables Pass QC when backend confirms packing is ready`).
- `FacilityPackingPanel.test.tsx`: **5 passed, 5 total**.
- `FacilityVerificationScreen.test.tsx`: **3 passed, 3 total**.
- Total: **16 passed, 16 total**.
- `npx tsc --noEmit` in `mobile/`: Passed with **0 errors**.

---

## 6. Behavior Verification Summary

| Scenario | Before Fix | After Fix |
| :--- | :--- | :--- |
| **Order without packing policy** | Pass QC disabled, warning displayed | Pass QC **enabled** immediately after Pack completed. |
| **Order with packing policy (unpacked)** | Pass QC disabled, no action button to pack | Pass QC disabled, displays clear alert with **"Confirm Final Packing"** button that scrolls directly to packing inputs. |
| **Final packing confirmed** | Sibling state remained stale or reset | `FacilityPackingPanel` calls `onReadiness(true)` and broadcasts event; Pass QC **instantly enables**. |
| **Pack stage completion** | `FacilityPackingPanel` stayed stale with `canPack: false` | `refreshTrigger` automatically triggers packing panel reload; form renders with verified garment counts. |
| **Mutations & transitions** | Unmounted components or wiped state | Local button spinners only; views and forms remain visible without full-screen spinners. |
