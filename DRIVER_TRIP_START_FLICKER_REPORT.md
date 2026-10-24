# Driver Delivery Screen — Start Trip Button Flickering Report

**Affected Order:** `BW-20261009-CAA767C2` (`f4f5fa19-d28e-469d-bc77-1cee3e80e06c`)  
**Affected Screen:** Driver Delivery Screen (`mobile/src/screens/DriverJobDetailScreen.tsx`)  
**Backend Service:** Logistics Service (`backend/src/modules/logistics/logistics.service.ts`)  
**Date:** 2026-10-16  

---

## 1. Executive Summary & Root Cause Analysis

On the Driver Delivery screen for order `BW-20261009-CAA767C2`, when the clean order had been collected from the facility (Phase 2: Customer Delivery), tapping **"Start trip to customer"** caused the bottom button to flicker repeatedly between `Starting trip...` and `Start trip to customer`, visually switching between disabled and enabled states without progressing to the active delivery trip.

Inspection of the database revealed **76 `navigate_facility` records** inserted in rapid bursts (e.g. 10ms to 20ms apart) for this single order, confirming rapid concurrent requests and repeated execution loops.

Tracing the full lifecycle across backend RPCs, API request lifecycles, state synchronization, Realtime subscriptions, and component re-renders identified the following interacting root causes:

### Root Cause 1: Backend Database Query Failure on Multiple Collection Events
- In `backend/src/modules/logistics/logistics.service.ts`, the `startNavigation` endpoint inspects whether the driver has already confirmed collection at the facility:
  ```typescript
  const { data: collectionOp } = await this.db()
    .from("driver_navigation_events")
    .select("id")
    .eq("order_id", assignment.order_id)
    .eq("event_type", "driver_collection_confirmed")
    .maybeSingle();
  ```
- Order `BW-20261009-CAA767C2` had **two** `driver_collection_confirmed` records in `driver_navigation_events`.
- In Supabase / PostgREST, calling `.maybeSingle()` when more than one record exists fails with error `PGRST116: "Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row"` and returns `data: null`.
- Because `data` was `null`, `if (!collectionOp)` evaluated to `true`!
- The backend erroneously concluded that facility collection had not occurred, inserted yet another `navigate_facility` event, and returned `{ status: 'en_route_facility', destination: 'facility' }` without invoking `transition_driver_assignment_atomic`.
- Consequently, the assignment status in PostgreSQL remained `accepted`, and the order status remained `delivery_accepted`.

### Root Cause 2: Frontend Mutation Lifecycle Ignored Authoritative Response & Reset Loading Flag
- In `DriverJobDetailScreen.tsx`, `beginTrip()` called `await startDriverNavigation(accessToken, assignmentId)` but did not use the returned authoritative result to immediately advance local state.
- Instead, it called `await load(true)`.
- When `load(true)` resolved, the backend returned `assignmentStatus: 'accepted'` (due to Root Cause 1).
- In `beginTrip()`'s `finally` block, `setBusy(false)` was executed.
- Because `job.assignmentStatus === 'accepted'` and `!isDeliveryPhase1` were still true, the UI re-rendered Section 6 ("ORDER COLLECTED"). With `busy` reset to `false`, the button immediately flipped back to `Start trip to customer` (enabled).
- This rapid cycle (`Start trip to customer` -> `Starting trip...` -> `Start trip to customer`) repeated on every tap or re-trigger, producing the visible flickering.

### Root Cause 3: Lack of Minimum Tap Interval & Debounce Lock
- `beginTrip()` relied solely on an in-memory lock `actionLock.current = true` and `busy`.
- There was no timestamp debounce. Rapid repeated taps (such as double-clicks or rapid screen touches) could queue requests before the initial state re-render had fully taken effect.

### Root Cause 4: Realtime Subscription Churn & Stale Overwrites
- In `DriverJobDetailScreen.tsx`, `useOrderRealtime` had `job` in its `useCallback` dependency array `[load, job]`.
- Every time `job` updated, the callback was recreated, tearing down and re-subscribing the Supabase realtime channel.
- Furthermore, background refetches from `load(true)` or Realtime updates had no monotonic precedence guard, allowing stale background responses (e.g. read replica latency returning `accepted`) to overwrite a newly confirmed in-flight or transitioned `en_route` state.

---

## 2. Changes Made

### 1. `backend/src/modules/logistics/logistics.service.ts`
- **Replaced `.maybeSingle()` with `.limit(1)` in `startNavigation`**:
  ```typescript
  const { data: collectionOps } = await this.db()
    .from("driver_navigation_events")
    .select("id")
    .eq("order_id", assignment.order_id)
    .eq("event_type", "driver_collection_confirmed")
    .limit(1);

  const collectionOp = collectionOps?.[0];
  ```
  Guarantees that Phase 2 detection succeeds whether 1 or multiple collection records exist.
- **Enhanced `startNavigation` Return Payload**:
  Returns authoritative `assignmentStatus` and `orderStatus` from the atomic transition RPC:
  ```typescript
  return {
    assignmentId,
    orderId: data.orderId,
    provider: this.maps.providerName,
    status: "en_route",
    assignmentStatus: data.assignmentStatus ?? "en_route",
    orderStatus: data.orderStatus ?? "en_route_delivery",
  };
  ```
- **Guarded `confirmFacilityHandover` against duplicate row exceptions**:
  Updated `facility_dispatch` and `driver_collection_confirmed` queries to use `.limit(1)`.

### 2. `mobile/src/services/driverAssignmentsApi.ts`
- Exported `DriverNavigationResult` interface and annotated `startDriverNavigation`:
  ```typescript
  export interface DriverNavigationResult {
    assignmentId: string;
    orderId?: string;
    provider?: string;
    status: string;
    destination?: string;
    assignmentStatus?: string;
    orderStatus?: string;
  }
  ```

### 3. `mobile/src/screens/DriverJobDetailScreen.tsx`
- **Dedicated Loading State & Tap Debounce**:
  Introduced `startingTrip` state, `isTripStartingRef`, and `lastTripTapTimeRef` (1000ms minimum interval guard):
  ```typescript
  const [startingTrip, setTripStarting] = useState(false);
  const isTripStartingRef = useRef(false);
  const lastTripTapTimeRef = useRef(0);
  ```
- **Authoritative Immediate State Update in `beginTrip`**:
  ```typescript
  const beginTrip = async () => {
    const now = Date.now();
    if (now - lastTripTapTimeRef.current < 1000) return;
    if (isTripStartingRef.current || actionLock.current || busy || startingTrip) return;

    lastTripTapTimeRef.current = now;
    isTripStartingRef.current = true;
    requestSeqRef.current += 1;
    actionLock.current = true;
    setTripStarting(true);
    setBusy(true);
    setTripError('');
    setError('');
    try {
      const navResult = await startDriverNavigation(accessToken, assignmentId);
      if (isDeliveryPhase1 || navResult?.destination === 'facility' || navResult?.status === 'en_route_facility') {
        setJob(prev => (prev ? {
          ...prev,
          assignmentStatus: 'en_route',
          inTransitToFacility: true,
        } : prev));
        setMessage('Trip to facility started. Live GPS is active during navigation.');
      } else {
        const nextOrderStatus = navResult?.orderStatus || (job?.type === 'pickup' ? 'en_route_pickup' : 'en_route_delivery');
        setJob(prev => (prev ? {
          ...prev,
          assignmentStatus: 'en_route',
          orderStatus: nextOrderStatus,
        } : prev));
        setMessage('Trip started. Live GPS is active during navigation.');
      }
      await load(true);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Unable to start trip.';
      setTripError(msg);
    } finally {
      isTripStartingRef.current = false;
      actionLock.current = false;
      setTripStarting(false);
      setBusy(false);
    }
  };
  ```
- **Stale Overwrite Protection in `load()` and `useOrderRealtime`**:
  Guarded against state regression: if local state has progressed to `en_route` or `en_route_delivery`, a stale server response or Realtime event with `accepted` / `delivery_accepted` will not overwrite confirmed progress.
- **Stabilized Realtime Subscription Callback**:
  Extracted `handleOrderRealtimeEvent` to depend solely on `[load]`, removing `job` from dependency array and eliminating subscription reconnection cycles.
- **Button Visual States & Accessibility**:
  Both Phase 1 ("Start trip to facility") and Phase 2 ("Start trip to customer") buttons now check `(busy || startingTrip)` for disabled styling and render `Starting trip...` reliably until settled or failed.

---

## 3. Verification & Tests Performed

### Automated Unit & Integration Tests

1. **Driver Delivery Screen Tests (`mobile/src/screens/DriverJobDetailScreen.test.tsx`)**:
   - `start trip to customer successfully transitions to active delivery trip without flickering` (PASS)
   - `start trip to customer failure restores action and displays inline error with retry capability` (PASS)
   - `start trip to customer prevents rapid repeated taps from triggering duplicate mutations` (PASS)
   - `start trip to customer keeps loading state stable under slow network conditions until completion` (PASS)
   - `stale background refetches do not regress confirmed forward delivery status to accepted` (PASS)
   - Full test suite: **39 passed, 39 total** (6.2s).

2. **Full Mobile Driver Suites**:
   - `DriverDashboardScreen.test.tsx` (PASS)
   - `DriverJobDetailScreen.test.tsx` (PASS)
   - `driverAssignmentsApi.test.ts` (PASS)
   - Total: **56 passed, 56 total**.

3. **Backend Logistics Service Tests (`backend/src/modules/logistics/`)**:
   - `logistics.service.spec.ts` (PASS - 10/10 tests)
   - `logistics.assignments.spec.ts` (PASS - 4/4 tests)

4. **TypeScript Typecheck Validation**:
   - `mobile`: `npx tsc --noEmit` exited with code 0 (clean, 0 errors).
   - `backend`: `npx tsc --noEmit` exited with code 0 (clean, 0 errors).

5. **Live Backend Query Verification for `BW-20261009-CAA767C2`**:
   - Tested Phase 2 collection detection logic against the PostgreSQL database.
   - Verified that `.limit(1)` resolves `collectionOp: true` for the affected order `f4f5fa19-d28e-469d-bc77-1cee3e80e06c`, routing to atomic transition `start_navigation` rather than duplicate `navigate_facility` insertion.

---

## 4. Remaining Issues / Notes

- **No Real Device Connected**: All tests and validations were executed using Node.js scripts, unit/integration test suites with React Native Testing Library, and TypeScript compilation.
- **Local Work Tree Cleanliness**: All changes remain local in the working directory; no commits, branches, or uploads were made.
