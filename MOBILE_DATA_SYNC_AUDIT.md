# Mobile Data Synchronization and Loading State Audit Report

**Application:** Bright & White Laundry Mobile App (React Native / Android / iOS)  
**Workspace:** `D:\techyArts\B-W\mobile`  
**Date:** October 13, 2026  
**Status:** Audit and Remediation Complete

---

## 1. Executive Summary

A comprehensive architectural audit and fix of the data synchronization, state management, cache reconciliation, and loading indicators was conducted across the Bright & White Laundry React Native mobile codebase. 

Prior to this audit, multiple screens suffered from:
1. **Destructive state resets on background refresh failures**, where temporary network blips wiped previously fetched server data (e.g. `useAddresses.ts` wiping addresses to `[]`).
2. **Aggressive full-page loading indicators** that replaced populated screens with spinners during background revalidations (e.g. `AddressScreen`, `OrderDetailsScreen`, `ClaimsRefundsScreen`, `HomeScreen`).
3. **Stale screen states upon navigation revisit**, caused by reliance on mount-only `useEffect` hooks rather than navigation focus listeners and AppState foreground hooks (e.g. `HomeScreen`, `DriverDashboardScreen`, `NotificationsScreen`, `BenefitsScreen`).
4. **Race conditions / out-of-order network overwrites**, where slower older HTTP requests could overwrite newer state updates.
5. **Decoupled mutation state**, where profile updates in `ProfileScreen` updated local screen state but did not propagate to the root session state and Home screen header.

All root causes were identified, remediated with surgical architectural fixes respecting existing API contracts, database schema, and RLS policies, and verified using comprehensive unit and integration tests (105 test suites, 450 tests passing, 0 TypeScript errors).

---

## 2. Root Cause Analysis

### A. Data Synchronization & Stale Data
- **Stale Revisit in Customer Home & Driver Dashboard:**
  - `HomeScreen.tsx` and `DriverDashboardScreen.tsx` relied on mount-only `useEffect` hooks to fetch orders and dashboard stats. When a customer placed an order or a driver completed a job on a details screen and navigated back, the previous list remained stale until manual pull-to-refresh or fallback polling intervals elapsed.
  - **Fix:** Implemented `useSafeFocusEffect` to silently revalidate server data whenever the screen regains focus, and added `AppState` listeners to refresh immediately when the app resumes from background.
- **Race Condition Vulnerabilities:**
  - Several hooks and screens (`useAddresses.ts`, `DriverDashboardScreen.tsx`, `NotificationsScreen.tsx`, `DriverNotificationsScreen.tsx`, `BenefitsScreen.tsx`, `ClaimsRefundsScreen.tsx`) lacked sequence tracking counters. An earlier slow request could finish after a newer request, overwriting fresh data with stale data.
  - **Fix:** Introduced `requestSeqRef = useRef(0)` in all data-fetching hooks and screens. Network responses with sequence numbers older than `requestSeqRef.current` are safely discarded.
- **State Invalidation & Mutation Decoupling:**
  - In `useAddresses.ts`, mutations (`saveAddress`, `makeDefaultAddress`, `deleteAddress`) re-fetched addresses by calling `loadAddresses()` with full `addressesLoading=true`, unmounting the screen during mutation completion.
  - In `ProfileScreen.tsx`, saving a customer's name updated the local screen record but did not notify the parent `App.tsx` session state, leaving `customerName` in the Home screen header out of sync until a restart.
  - **Fix:** Added `silent: boolean` support in `loadAddresses` for non-destructive mutation reconciliations, and added `onProfileUpdated` callback to synchronize root profile state in `App.tsx`.

### B. Destructive State Resets & Loading Indicator Flickers
- **Full-Screen Loaders on Background Refresh:**
  - In `AddressScreen.tsx`, `{loading ? <ActivityIndicator ... /> : ...}` unconditionally unmounted the saved address list and checkout progress whenever `loading === true`, even when `addresses.length > 0`.
  - In `OrderDetailsScreen.tsx`, `if (loading) { return <LoadingView ... /> }` unmounted the active order details and tracking cards if `loadDetails()` was triggered during background operations.
  - In `ClaimsRefundsScreen.tsx`, `{loading && !refreshing ? <View style={styles.loadingContainer}>...` hid all active claims, refunds, and cancellations when a silent revalidation occurred.
  - In `HomeScreen.tsx`, `{props.servicesLoading ? <View style={styles.loadingContainer}>...` rendered a loading banner above the categories grid even when categories were already loaded.
  - **Fix:** Standardized loading logic across all screens:
    - Full-screen loading indicator rendered **only** when `loading && (!data || data.length === 0)`.
    - When data already exists in memory, screens retain their rendered components and use subtle or non-destructive indicators (such as `RefreshControl`).
- **Destructive Catch Blocks:**
  - In `useAddresses.ts`, any error in `loadAddresses` caught in the `catch` block executed `setAddresses([])` and `setSelectedAddressId(null)`, causing instant data loss in the UI during temporary connection drops.
  - **Fix:** Retained current addresses in memory if `addresses.length > 0` on background network error, logging a diagnostic warning without destroying the user's saved address state.

---

## 3. Exact Files Modified & Summary of Changes

### 1. `mobile/src/hooks/useSafeFocusEffect.ts` (New File)
- Created a robust navigation focus hook built on `React.useContext(NavigationContext)` and `React.useContext(NavigationContainerRefContext)`.
- Automatically binds `isFocused()`, `focus`, and `blur` listeners when rendered inside a React Navigation container.
- Safely degrades to a clean no-op when rendered in isolated unit tests without requiring extensive mocking or crashing with `Couldn't find a navigation object`.

### 2. `mobile/src/hooks/useAddresses.ts`
- Added `requestSeqRef = useRef(0)` and `addressesRef = useRef<AddressItem[]>([])` to track in-flight requests and current cache state.
- Enhanced `loadAddresses(preferredAddressId?: string | null, silent?: boolean)`:
  - If `silent === true` or addresses already exist, prevents setting `addressesLoading(true)`.
  - Discards out-of-order responses (`seq !== requestSeqRef.current`).
  - Preserves existing addresses in memory if an error occurs during background revalidation.
- Updated `saveAddress`, `makeDefaultAddress`, and `deleteAddress` to trigger silent revalidations (`loadAddresses(..., true)`), preventing full-screen unmounting after mutations.

### 3. `mobile/src/screens/AddressScreen.tsx`
- Added `onRefresh` and `refreshing` props to `AddressScreenProps`.
- Added `RefreshControl` to the `ScrollView` for pull-to-refresh capabilities.
- Changed full-screen loading condition from `{loading ? ...}` to `{loading && addresses.length === 0 ? ...}`, ensuring existing addresses remain mounted and visible during background updates.

### 4. `mobile/src/screens/HomeScreen.tsx`
- Imported `useSafeFocusEffect`, `AppState`, `AppStateStatus`, and `RefreshControl`.
- Added `useSafeFocusEffect` to silently refresh urgent orders (`refreshOrders(true)`) whenever the customer returns to the Home tab.
- Added `AppState` listener to revalidate urgent orders upon returning from the mobile background.
- Added pull-to-refresh (`RefreshControl`) to the main `ScrollView`.
- Guarded category catalogue loading spinner so it only appears when `props.servicesLoading && !displayCategories.length`.
- Handled React 19 test renderer circular reference safeguards in test environment.

### 5. `mobile/src/screens/OrderDetailsScreen.tsx`
- Added `orderRef` tracking to guard against unmounting populated screens during background revalidations.
- Changed full-screen loading guard from `if (loading)` to `if (loading && !order)`.
- Changed full-screen error guard from `if (error || !order)` to `if (!order)`, preventing background refresh errors from blanking an active order.
- Added `useSafeFocusEffect` and `AppState` listeners to revalidate order details and status transitions when returning to the screen or resuming from background.

### 6. `mobile/src/screens/DriverDashboardScreen.tsx`
- Added `requestSeqRef` and `dashboardRef` to prevent race conditions and eliminate loading flickers.
- Updated `load()` to only set `loading(true)` if `!dashboardRef.current`.
- Added `useSafeFocusEffect` so the driver dashboard immediately revalidates assigned jobs when the driver returns from `DriverJobDetailScreen`.
- Added `AppState` listener to revalidate routes upon app resume from background.

### 7. `mobile/src/screens/NotificationsScreen.tsx`
- Added `requestSeqRef` and `itemsRef` tracking.
- Added `useSafeFocusEffect` to refresh notifications when the screen regains focus.
- Guarded loading indicator to `{loading && items.length === 0 ? ... : null}`.

### 8. `mobile/src/screens/DriverNotificationsScreen.tsx`
- Added `requestSeqRef` and `itemsRef` tracking.
- Added `useSafeFocusEffect` to refresh driver notifications on screen focus.
- Guarded loading indicator to `{loading && items.length === 0 && role === 'driver' ? ... : null}`.

### 9. `mobile/src/screens/BenefitsScreen.tsx`
- Added `requestSeqRef` and `offersRef` tracking.
- Added `RefreshControl` for pull-to-refresh.
- Added `useSafeFocusEffect` to refresh promotional coupons on screen focus.
- Guarded loading spinner to `{offersLoading && !offers.length ? ... : null}`.

### 10. `mobile/src/screens/ClaimsRefundsScreen.tsx`
- Added `requestSeqRef` and `totalCountRef` tracking.
- Added `useSafeFocusEffect` to revalidate claims, refunds, and cancellations when the screen is focused.
- Changed loading indicator guard to `{loading && !refreshing && totalItemsCount === 0 ? ... : null}`.
- Changed content list guard to `{(!loading || totalItemsCount > 0) && !error ? ... : null}` to prevent blanking populated tabs during background fetches.

### 11. `mobile/src/screens/ProfileScreen.tsx` & `mobile/App.tsx`
- Added `onProfileUpdated?: (name: string) => void` prop to `ProfileScreen`.
- Added `RefreshControl` to `ProfileScreen`'s `ScrollView`.
- Added `useSafeFocusEffect` for focus revalidation.
- Guarded full-screen loading spinner to `{loading && !record ? ... : null}`.
- Connected `onProfileUpdated` in `App.tsx` to immediately update `setProfile(...)` in the root session state, keeping the Home screen header in sync.
- Connected `onRefresh` prop on `AddressScreen` route in `App.tsx` to `loadAddresses`.

---

## 4. Tests Executed & Verification Results

All tests were executed locally within `d:\techyArts\B-W\mobile`.

### A. TypeScript Typecheck
- **Command:** `npx tsc --noEmit`
- **Result:** **PASSED** (0 errors)

### B. Jest Test Suites
- **Command:** `npm test`
- **Result:** **105 passed, 105 total** (450 passed, 450 total, 0 failed)

### C. Targeted Synchronization and Loading State Test Results
1. **`src/hooks/useAddresses.test.ts` (6 passed)**
   - `loads addresses and sets initial selected address` (PASSED)
   - `validates addressLine1, city, state, postalCode and coordinates before saving` (PASSED)
   - `deletes an address and refreshes the address list` (PASSED)
   - `handles delete failure when address is linked to existing order` (PASSED)
   - `preserves existing addresses when background reload fails` (PASSED - Verified data is not wiped to `[]`)
   - `prevents race conditions by ignoring out-of-order stale responses` (PASSED - Verified sequence counter discards older responses)

2. **`src/screens/AddressScreen.test.tsx` (9 passed)**
   - Verified address fields formatting, deletion modals, error modals, and manage-only mode.
   - `retains populated address list and avoids full-page spinner during background refresh` (PASSED - Verified loading indicator is suppressed when addresses exist)

3. **`src/screens/HomeScreen.test.tsx` (9 passed)**
   - Verified profile greeting, urgent action cards for OTP stages, category catalogue filters, and delivery address selection.

4. **`src/screens/OrderDetailsScreen.test.tsx` (6 passed)**
   - Verified realtime OTP verification success animations, OTP expiry notices, tracking badges, and background state retention.

5. **`src/screens/DriverDashboardScreen.test.tsx` (10 passed)**
   - Verified driver availability toggling, job claiming, conflict handling, retry on error, and route queues.

6. **`src/screens/DriverNotificationsScreen.test.tsx` (4 passed)**
   - Verified owned driver notifications, role filtering, and loading/empty states.

7. **`src/screens/NotificationsScreen.test.tsx` (3 passed)**
   - Verified notification listing, order navigation on tap, and mark-all-read.

8. **`src/screens/BenefitsScreen.test.tsx` (3 passed)**
   - Verified server coupon display, empty state, and retry handling.

9. **`src/screens/ClaimsRefundsScreen.test.tsx` (3 passed)**
   - Verified claim/refund/cancellation tabs, empty states, and error retries.

10. **`src/screens/ProfileScreen.test.tsx` (2 passed)**
    - Verified verified phone display, name updating, `onProfileUpdated` notification, and loading indicator suppression.

---

## 5. Flow Tracing Verification

### Flow 1: Customer Order Mutation to Driver Claim Flow
1. **Customer places order:** Order is created with status `order_placed` / `pending_confirmation`.
2. **Realtime Broadcast / Postgres Changes:** `realtimeService` receives postgres notification on `orders` and broadcasts `ORDER_CREATED`.
3. **Driver Dashboard:** `useDriverRealtime` catches the event, updates `availablePickups`, and immediately runs `load(true)` with request sequence protection.
4. **Driver Claims Order:** Driver presses "Accept Pickup". `claimDriverJob` succeeds. Driver is transitioned to `DriverJobDetailScreen`.
5. **Customer Screen Update:** Customer's `useCustomerRealtime` catches `ASSIGNMENT_UPDATED` / `ORDER_STATUS_CHANGED`, triggers `invalidateOrdersCache()`, and silently revalidates active orders. When returning to `HomeScreen`, `useSafeFocusEffect` immediately re-queries urgent orders without requiring manual pull-to-refresh.

### Flow 2: Navigation Away and Back
1. Customer visits `AddressScreen` or `ProfileScreen`. Data is loaded.
2. Customer navigates away to `Cart` or `Orders`, and modifies data.
3. Customer navigates back to `AddressScreen` / `ProfileScreen`.
4. `useSafeFocusEffect` triggers a background revalidation.
5. Populated lists remain smoothly mounted; no spinner blanks the UI; server updates reconcile seamlessly.

### Flow 3: App Background to Foreground Resume
1. Mobile app is minimized to background.
2. Background changes occur on server.
3. User resumes app into foreground.
4. `AppState` event triggers `active` state.
5. `realtimeService` fires `RECONNECT_RECONCILE` and screen-level `AppState` listeners trigger silent background refreshes across active screens (`HomeScreen`, `DriverDashboardScreen`, `OrderDetailsScreen`).

---

## 6. Unresolved Issues

- **None.** All identified stale-data bugs, missing focus revalidations, loading flickers, and destructive cache errors have been resolved. All unit test suites pass, and TypeScript compiles cleanly without errors.
