# APPLICATION-WIDE REAL-TIME SYNCHRONIZATION AUDIT REPORT
**Bright & White Laundry Mobile Platform**  
**Audit Date:** 2026-10-13  
**Scope:** Customer Mobile App, Driver Dashboard, Shared Infrastructure, NestJS Backend, Supabase Realtime  

---

## 1. Executive Summary

This audit resolves the application-wide real-time data synchronization defects and stale-data states across the Bright & White mobile platform:
1. **Late Driver Order Visibility:** A customer-created order appeared late or only upon manual pull-to-refresh on the driver dashboard.
2. **Customer App Synchronization Lag:** Driver status transitions (accepting, navigating, and arriving) were not immediately reflected in the customer tracking view.
3. **OTP Verification Delay:** OTP verification success failed to update in real time on the customer tracking screen until manual refresh.
4. **Stale Cache & Overwrite Bugs:** Screen focus changes, tab switches, and asynchronous API responses occasionally overwrote newer real-time state with stale cached data.
5. **Driver UI Flickering:** Background real-time updates triggered full-screen loading spinners during live delivery/pickup operations.

Our audit identified the root causes across both the backend event fanout layer and the mobile state management layer. All issues have been resolved locally, and 100% of automated tests pass across both backend and mobile suites.

---

## 2. Complete Application Screen Inventory & Real-Time Mapping

### 2.1 Customer Experience Screens
| Screen Component | File Path | Data Displayed | Data Source & Endpoints | Refresh & Sync Mechanism | Needs Realtime? | Realtime Channels & Events |
|---|---|---|---|---|---|---|
| `HomeScreen` | `mobile/src/screens/HomeScreen.tsx` | Service categories, active orders hero, addresses summary, cart counter | `GET /v1/services`, `GET /v1/orders`, `GET /v1/customers/me/addresses` | Initial mount, `useFocusEffect`, `useCustomerRealtime`, sequence counter | **Yes** | `orders:all`, `customer:${profileId}`, `customer:${customerId}` (`ORDER_CREATED`, `ORDER_STATUS_CHANGED`) |
| `CategoryScreen` | `mobile/src/screens/CategoryScreen.tsx` | Services within category, price rules, minimum order policy | `GET /v1/services`, `GET /v1/services/pricing-policy` | Initial mount, search filter, local state | No | Static catalog data |
| `CartScreen` | `mobile/src/screens/CartScreen.tsx` | Selected items, quantity adjustments, calculated line totals | Local cart state via `useCart` hook | Reactive state updates | No | Client-side cart |
| `AddressesScreen` | `mobile/src/screens/AddressScreen.tsx` | Saved customer addresses, default address badge | `GET /v1/customers/me/addresses`, `DELETE /v1/customers/me/addresses/:id` | Initial mount, mutation invalidation | No | Mutation-driven |
| `AddressFormScreen` | `mobile/src/screens/AddressFormScreen.tsx` | Address input fields, device GPS autofill, reverse geocoding preview | `POST /v1/maps/reverse-geocode`, `POST/PUT /v1/customers/me/addresses` | Form input state, GPS locator | No | Form submission |
| `LocationPickerScreen` | `mobile/src/screens/LocationPickerScreen.tsx` | Map preview, interactive pin, resolved address | Google Maps / Dev Maps provider | Coordinate selection | No | Interactive picker |
| `PickupSlotScreen` | `mobile/src/screens/PickupSlotScreen.tsx` | 3-day pickup calendar, available morning/evening time windows | `usePickupSchedule`, static slot definitions | Date selection change | No | Slot scheduler |
| `OrderReviewScreen` | `mobile/src/screens/OrderReviewScreen.tsx` | Price summary, delivery fee, GST, coupon code, loyalty points | `GET /v1/services/pricing-policy`, `POST /v1/growth/coupons/validate` | Modifier state change | No | Client pricing engine |
| `PaymentScreen` | `mobile/src/screens/PaymentScreen.tsx` | Payment method (Razorpay / Cash on Delivery), final total, terms modal | `POST /v1/payments/create-order`, `POST /v1/payments/verify`, `POST /v1/orders` | Mutation on submit, BackHandler modal intercept | No | Payment gateway handoff |
| `OrderSuccessScreen` | `mobile/src/screens/OrderSuccessScreen.tsx` | Order confirmation badge, order number, pickup schedule, action buttons | Route parameters (`SuccessfulOrder`) | Static parameters, hardware BackHandler | No | Confirmation screen |
| `OrdersScreen` | `mobile/src/screens/OrdersScreen.tsx` | Active & past orders list, current status chips, amounts, item counts | `GET /v1/orders` | Tab focus (`loadOrders(true, true)` silent revalidation), `useCustomerRealtime`, pull-to-refresh | **Yes** | `orders:all`, `customer:${profileId}`, `customer:${customerId}` (`ORDER_CREATED`, `ORDER_STATUS_CHANGED`) |
| `OrderDetailsScreen` | `mobile/src/screens/OrderDetailsScreen.tsx` | Full order timeline, status badge, items, care notes, live OTP, driver location | `GET /v1/orders/:id`, `GET /v1/orders/:id/history`, `GET /v1/orders/:id/tracking`, `POST /v1/orders/:id/otp` | `useOrderRealtime`, 8s gentle poll fallback during active trip, pull-to-refresh | **Yes** | `order:${orderId}`, `customer:${profileId}` (`ORDER_STATUS_CHANGED`, `ORDER_DRIVER_LOCATION`) |
| `ClaimsRefundsScreen` | `mobile/src/screens/ClaimsRefundsScreen.tsx` | Order item damage/loss claims, refund status, photo attachments | `GET /v1/claims`, `GET /v1/refunds`, `POST /v1/claims` | Realtime channel, pull-to-refresh | **Yes** | `customer:${profileId}`, `orders:all` (`CLAIM_UPDATED`, `REFUND_UPDATED`) |
| `NotificationsScreen` | `mobile/src/screens/NotificationsScreen.tsx` | System alerts, order updates, promotional notices | `GET /v1/notifications`, `PUT /v1/notifications/:id/read` | Focus revalidation, pull-to-refresh | **Yes** | `customer:${profileId}` (`NOTIFICATION_RECEIVED`) |
| `BenefitsScreen` | `mobile/src/screens/BenefitsScreen.tsx` | Customer package subscriptions, loyalty points balance, tier discounts | `GET /v1/packages/subscriptions`, `GET /v1/growth/loyalty` | Initial mount, pull-to-refresh | No | Infrequent updates |
| `ProfileScreen` | `mobile/src/screens/ProfileScreen.tsx` | Customer name, phone, email, saved preferences | `GET /v1/customers/me/profile`, `PUT /v1/customers/me/profile` | Initial mount, mutation on save | No | User profile |
| `AccountScreen` | `mobile/src/screens/AccountScreen.tsx` | Menu shortcuts (Orders, Addresses, Benefits, Support, Logout) | Local session state | Instant render | No | Navigation menu |
| `SupportScreen` | `mobile/src/screens/SupportScreen.tsx` | WhatsApp direct contact, call button, FAQ entries | Static configuration | Instant render | No | Static support |
| `ReceiptScreen` | `mobile/src/screens/ReceiptScreen.tsx` | Digital invoice view, GST tax invoice breakdown, download link | `GET /v1/orders/:id/receipt` | Route param fetch | No | Read-only receipt |
| `PrivacyPolicyScreen` | `mobile/src/screens/PrivacyPolicyScreen.tsx` | Terms of service, privacy disclosures | Local static document | Instant render | No | Legal text |

---

### 2.2 Driver Logistics Screens
| Screen Component | File Path | Data Displayed | Data Source & Endpoints | Refresh & Sync Mechanism | Needs Realtime? | Realtime Channels & Events |
|---|---|---|---|---|---|---|
| `DriverDashboardScreen` | `mobile/src/screens/DriverDashboardScreen.tsx` | Available pickup/delivery queue, claimed route jobs, online availability toggle | `GET /v1/drivers/me/dashboard`, `PUT /v1/drivers/me/availability`, `POST /v1/drivers/jobs/claim` | `useDriverRealtime` (`driver:available`, `jobs:drivers`, `driver:${driverId}`), 15s gentle poll fallback, pull-to-refresh | **Yes** | `driver:available`, `jobs:drivers`, `driver:${driverId}`, `orders:all` (`JOB_AVAILABLE`, `JOB_CLAIMED`, `ASSIGNMENT_UPDATED`, `ORDER_CREATED`) |
| `DriverJobDetailScreen` | `mobile/src/screens/DriverJobDetailScreen.tsx` | Customer address, navigation directions, OTP input, facility handoff QR code, status actions | `GET /v1/drivers/assignments/:id`, `POST /v1/logistics/assignments/:id/start`, `POST /v1/logistics/assignments/:id/arrived`, `POST /v1/orders/:id/otp/verify` | `useOrderRealtime`, silent background load (`load(true)`), 8s active trip polling fallback, hardware BackHandler | **Yes** | `order:${orderId}`, `driver:${driverId}`, `orders:all` (`ORDER_STATUS_CHANGED`, `ASSIGNMENT_UPDATED`) |
| `DriverNotificationsScreen` | `mobile/src/screens/DriverNotificationsScreen.tsx` | Route alerts, assignment changes, administrative announcements | `GET /v1/notifications` | Initial mount, pull-to-refresh | **Yes** | `driver:${driverId}` (`NOTIFICATION_RECEIVED`) |
| `DriverProfileScreen` | `mobile/src/screens/DriverProfileScreen.tsx` | Driver operational status, vehicle details, completed job metrics | `GET /v1/drivers/me/profile` | Initial mount, focus effect | No | Profile metrics |

---

### 2.3 Facility & Operations Screens
| Screen Component | File Path | Data Displayed | Data Source & Endpoints | Refresh & Sync Mechanism | Needs Realtime? | Realtime Channels & Events |
|---|---|---|---|---|---|---|
| `FacilityDashboardScreen` | `mobile/src/screens/FacilityDashboardScreen.tsx` | Incoming shipments, processing queue, delivery staging backlog | `GET /v1/facility/dashboard`, `GET /v1/facility/orders` | Realtime channel subscription, pull-to-refresh | **Yes** | `facility:${facilityId}`, `facility:all` (`FACILITY_INTAKE`, `PROCESSING_STAGE_CHANGED`, `QC_UPDATED`) |
| `FacilityIntakeScreen` | `mobile/src/screens/FacilityIntakeScreen.tsx` | Garment itemization, tag association, piece verification, initial inspection | `POST /v1/facility/intake` | Form scan and submit | **Yes** | `facility:${facilityId}` (`INTAKE_COMPLETED`) |
| `FacilityVerificationScreen` | `mobile/src/screens/FacilityVerificationScreen.tsx` | Stage transitions (wash, dry, press, QC check, packing) | `GET /v1/facility/orders/:id`, `POST /v1/facility/orders/:id/progress` | Mutation invalidation, Realtime events | **Yes** | `order:${orderId}`, `facility:${facilityId}` (`ORDER_STATUS_CHANGED`) |

---

### 2.4 Administrative Screens
| Screen Component | File Path | Data Displayed | Data Source & Endpoints | Refresh & Sync Mechanism | Needs Realtime? | Realtime Channels & Events |
|---|---|---|---|---|---|---|
| `AdminDashboardScreen` | `mobile/src/screens/AdminDashboardScreen.tsx` | High-level metrics, active order counts, SLA violations, revenue totals | `GET /v1/admin/dashboard` | Realtime channel, focus reload | **Yes** | `admin:operations` (`ORDER_CREATED`, `ORDER_STATUS_CHANGED`) |
| `AdminCustomersScreen` | `mobile/src/screens/AdminCustomersScreen.tsx` | Customer list, registration dates, spend tier | `GET /v1/admin/customers` | Search filter, pagination | No | Admin query |
| `AdminCustomerDetailScreen`| `mobile/src/screens/AdminCustomerDetailScreen.tsx`| Customer profile, past order history, loyalty points | `GET /v1/admin/customers/:id` | Route param fetch | No | Admin query |
| `AdminOrderDetailScreen` | `mobile/src/screens/AdminOrderDetailScreen.tsx` | Full order timeline, manual status override, driver assignment | `GET /v1/admin/orders/:id`, `POST /v1/admin/assignments` | Realtime subscription, focus reload | **Yes** | `order:${orderId}`, `admin:operations` |
| `AdminStaffScreen` | `mobile/src/screens/AdminStaffScreen.tsx` | Drivers, facility workers, shift status | `GET /v1/admin/staff` | Initial mount, pull-to-refresh | No | Staff roster |
| `AdminStaffDetailScreen` | `mobile/src/screens/AdminStaffDetailScreen.tsx` | Staff credentials, shift assignments, activity logs | `GET /v1/admin/staff/:id` | Route param fetch | No | Staff details |
| `AdminAssignmentsScreen` | `mobile/src/screens/AdminAssignmentsScreen.tsx` | Unassigned jobs, active driver locations, reassignments | `GET /v1/admin/assignments`, `POST /v1/admin/assignments/reassign` | Realtime subscription | **Yes** | `driver:available`, `admin:operations` (`ASSIGNMENT_UPDATED`) |
| `AdminCatalogueScreen` | `mobile/src/screens/AdminCatalogueScreen.tsx` | Service catalog, pricing policies, turnaround hours | `GET /v1/admin/catalogue`, `PUT /v1/admin/catalogue/:id` | Mutation on save | No | Catalog CRUD |
| `AdminIssuesScreen` | `mobile/src/screens/AdminIssuesScreen.tsx` | Customer complaints, garment damage claims, refund reviews | `GET /v1/admin/issues` | Realtime subscription | **Yes** | `admin:operations` (`CLAIM_UPDATED`) |
| `AdminIssueDetailScreen` | `mobile/src/screens/AdminIssueDetailScreen.tsx` | Issue photos, resolution decisions, refund processing | `GET /v1/admin/issues/:id`, `POST /v1/admin/issues/:id/resolve` | Route param fetch | No | Admin resolution |
| `AdminGrowthScreen` | `mobile/src/screens/AdminGrowthScreen.tsx` | Referral campaigns, promo codes, package subscriptions | `GET /v1/admin/growth` | Initial mount | No | Marketing config |
| `AdminFacilityOversightScreen`| `mobile/src/screens/AdminFacilityOversightScreen.tsx`| Machine utilization, batch turnaround times, facility logs | `GET /v1/admin/facilities` | Realtime subscription | **Yes** | `facility:all`, `admin:operations` |
| `AdminReportsScreen` | `mobile/src/screens/AdminReportsScreen.tsx` | Operational reports, driver performance, export CSV | `GET /v1/admin/reports` | Date filter query | No | Reporting engine |

---

### 2.5 Authentication & Onboarding Screens
| Screen Component | File Path | Data Displayed | Data Source & Endpoints | Refresh & Sync Mechanism | Needs Realtime? | Realtime Channels & Events |
|---|---|---|---|---|---|---|
| `WelcomeScreen` | `mobile/src/screens/WelcomeScreen.tsx` | Value proposition, Login / Sign Up options | Static assets | Instant render | No | Static onboarding |
| `LoginScreen` | `mobile/src/screens/LoginScreen.tsx` | Phone/Email input, Password, Forgot Password link | `POST /v1/auth/login` | Mutation on submit | No | Auth mutation |
| `DriverLoginScreen` | `mobile/src/screens/DriverLoginScreen.tsx` | Driver phone, 4-digit PIN | `POST /v1/auth/driver-login` | Mutation on submit | No | Auth mutation |
| `SignUpScreen` | `mobile/src/screens/SignUpScreen.tsx` | Name, phone, email, password, referral code | `POST /v1/auth/register` | Mutation on submit | No | Registration |
| `ForgotPasswordScreen` | `mobile/src/screens/ForgotPasswordScreen.tsx` | Email input for password reset link | `POST /v1/auth/forgot-password` | Mutation on submit | No | Password reset |
| `ResetPasswordScreen` | `mobile/src/screens/ResetPasswordScreen.tsx` | New password input, reset token | `POST /v1/auth/reset-password` | Mutation on submit | No | Token reset |
| `OtpScreen` | `mobile/src/screens/OtpScreen.tsx` | 6-digit phone verification OTP input | `POST /v1/auth/verify-otp`, `POST /v1/auth/resend-otp` | Form submit, countdown timer | No | SMS verification |

---

## 3. Root Causes & File-by-File Resolutions

### Root Cause 1: Backend `broadcastEvent` Channel Failure (Unsubscribed Socket Drop)
- **File:** [backend/src/modules/supabase/supabase.service.ts](file:///d:/techyArts/B-W/backend/src/modules/supabase/supabase.service.ts)
- **Problem:**
  `SupabaseService.broadcastEvent` attempted to broadcast via `@supabase/supabase-js` WebSocket channels by creating an ad-hoc channel `this.admin.channel(channelName)` and immediately calling `.send()`. In `@supabase/supabase-js` v2, calling `.send()` on an unsubscribed channel does not throw; it returns the string `'error'` because Phoenix WebSocket topic joining only occurs after calling `.subscribe()`. Because this was wrapped in a silent `try { ... } catch {}`, every single backend broadcast across the platform failed silently.
- **Resolution:**
  Upgraded `broadcastEvent` to dispatch directly to the official Supabase Realtime REST Broadcast endpoint (`POST ${this.url}/realtime/v1/api/broadcast`) using the service-role key. This returns HTTP 202 and achieves instantaneous WebSocket fanout to all active clients with zero socket negotiation overhead. Maintained a persistent, verified WebSocket channel pool as an automatic fallback.

### Root Cause 2: Channel Addressing Discrepancy Between Customer ID and Profile ID
- **Files:**
  - [backend/src/modules/otp/otp.service.ts](file:///d:/techyArts/B-W/backend/src/modules/otp/otp.service.ts)
  - [backend/src/modules/logistics/logistics.service.ts](file:///d:/techyArts/B-W/backend/src/modules/logistics/logistics.service.ts)
  - [backend/src/modules/drivers/drivers.service.ts](file:///d:/techyArts/B-W/backend/src/modules/drivers/drivers.service.ts)
  - [backend/src/modules/orders/orders.service.ts](file:///d:/techyArts/B-W/backend/src/modules/orders/orders.service.ts)
  - [backend/src/modules/payments/payments.service.ts](file:///d:/techyArts/B-W/backend/src/modules/payments/payments.service.ts)
  - [backend/src/modules/facility/facility.service.ts](file:///d:/techyArts/B-W/backend/src/modules/facility/facility.service.ts)
  - [backend/src/modules/delivery/delivery.service.ts](file:///d:/techyArts/B-W/backend/src/modules/delivery/delivery.service.ts)
- **Problem:**
  Mobile clients authenticate using Supabase Auth JWT, where the token `sub` represents `profile_id` (from the `profiles` table). `useCustomerRealtime` subscribes to `customer:${profileId}` and `customer:${customerId}`. However, backend services frequently queried only `orders.customer_id` and broadcasted solely to `customer:${orders.customer_id}`. Whenever `customer_id` differed from `profile_id`, customer clients missed all status updates.
- **Resolution:**
  Updated queries across all backend modules to select `customer_id, customers(profile_id)` and broadcast concurrently to both `customer:${customerId}` and `customer:${profileId}`.

### Root Cause 3: Stale Cache Traps & Orders Cache Invalidation Gaps
- **Files:**
  - [mobile/src/services/ordersApi.ts](file:///d:/techyArts/B-W/mobile/src/services/ordersApi.ts)
  - [mobile/src/hooks/useRealtime.ts](file:///d:/techyArts/B-W/mobile/src/hooks/useRealtime.ts)
  - [mobile/src/screens/HomeScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/HomeScreen.tsx)
  - [mobile/src/screens/OrdersScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/OrdersScreen.tsx)
- **Problem:**
  `ordersApi.ts` implements a 30-second in-memory cache for `getOrders`. Previously, `invalidateOrdersCache()` was only invoked on explicit order creation or cancellation. Real-time events never cleared the cache. Consequently, when `HomeScreen` or `OrdersScreen` re-fetched orders following a real-time event without `{ forceRefresh: true }`, the API returned stale cached data, reverting the UI back to prior statuses.
- **Resolution:**
  1. Updated `useCustomerRealtime` and `useOrderRealtime` in `useRealtime.ts` to call `invalidateOrdersCache()` automatically upon receiving any real-time event.
  2. Updated `HomeScreen` and `OrdersScreen` to pass `{ forceRefresh: true }` on real-time event triggers and screen focus returns.

### Root Cause 4: Out-of-Order API Response Overwrites (Race Conditions)
- **Files:**
  - [mobile/src/screens/HomeScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/HomeScreen.tsx)
  - [mobile/src/screens/OrdersScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/OrdersScreen.tsx)
  - [mobile/src/screens/OrderDetailsScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/OrderDetailsScreen.tsx)
  - [mobile/src/screens/DriverJobDetailScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/DriverJobDetailScreen.tsx)
- **Problem:**
  When rapid status transitions occurred, earlier slow HTTP requests (e.g., initial screen load) could resolve after a newer real-time update had already arrived and been applied, overwriting newer state with stale data.
- **Resolution:**
  Implemented incremental request sequence counters (`requestSeqRef = useRef(0)`) across all four screens. When an HTTP response resolves, state is updated if and only if `seq === requestSeqRef.current`.

### Root Cause 5: Full-Screen Loading Flashes on Operational Screens
- **Files:**
  - [mobile/src/screens/DriverJobDetailScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/DriverJobDetailScreen.tsx)
  - [mobile/src/screens/OrdersScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/OrdersScreen.tsx)
- **Problem:**
  `DriverJobDetailScreen.load()` unconditionally executed `setLoading(true)`, replacing the driver's active navigation view with a full-screen loading spinner whenever an event or silent poll fired.
- **Resolution:**
  Added silent background refresh options `load(options?: boolean | unknown)` where `options === true` performs the fetch and state update without modifying `loading` or flashing the UI.

### Root Cause 6: OTP State Reset Blocker on Status Changes
- **File:** [mobile/src/screens/OrderDetailsScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/OrderDetailsScreen.tsx)
- **Problem:**
  If a customer opened tracking before driver arrival, `otpError` could be populated. When the driver arrived (`pickup_otp_pending`), the OTP fetch was blocked by the guard `if (otpType && !customerOtp && !otpLoading && !otpError)`. Because `otpError` was never cleared, the code was never displayed until manual refresh.
- **Resolution:**
  In `OrderDetailsScreen.tsx`, upon receiving any real-time status update, `setOtpError(null)` is called immediately, unlocking automatic OTP retrieval as soon as the driver arrives.

---

## 4. End-to-End Data Synchronization Lifecycle

```
[CUSTOMER APP]                                       [NESTJS BACKEND]                                   [DRIVER APP]
      │                                                     │                                                │
1. Creates Order ──────────────────────────────────────────>│                                                │
      │   POST /v1/orders                                   │                                                │
      │                                                     │─── REST Broadcast: driver:available ──────────>│
      │                                                     │    Event: JOB_AVAILABLE                        │ (Appears instantly on
      │                                                     │                                                │  Driver Dashboard)
      │                                                     │<── Claim Job ──────────────────────────────────│
      │                                                     │    POST /v1/drivers/jobs/claim                 │
      │<── REST Broadcast: customer:${profileId} ───────────│─── REST Broadcast: driver:available ──────────>│
      │    Event: ORDER_STATUS_CHANGED                      │    Event: JOB_CLAIMED                          │
      │    Status: driver_assigned_pickup                   │                                                │
      │                                                     │                                                │
      │                                                     │<── Start Navigation ───────────────────────────│
      │                                                     │    POST /v1/logistics/assignments/:id/start    │
      │<── Event: ORDER_STATUS_CHANGED ─────────────────────│                                                │
      │    Status: en_route_pickup                          │                                                │
      │                                                     │                                                │
      │                                                     │<── Arrived ────────────────────────────────────│
      │                                                     │    POST /v1/logistics/assignments/:id/arrived  │
      │<── Event: ORDER_STATUS_CHANGED ─────────────────────│                                                │
      │    Status: pickup_otp_pending                       │                                                │
      │    (Customer sees OTP code immediately)             │                                                │
      │                                                     │                                                │
      │                                                     │<── Verify OTP ─────────────────────────────────│
      │                                                     │    POST /v1/orders/:id/otp/verify              │
      │<── Event: ORDER_STATUS_CHANGED ─────────────────────│                                                │
      │    Status: picked_up                                │                                                │
      │    (Customer shows green success modal)             │                                                │
```

---

## 5. Required Supabase Configuration & Verification

1. **Supabase Realtime Publication:**
   The database publication `supabase_realtime` is defined in `backend/sql/manual_migrations/15_20261009130000_enable_supabase_realtime_publications.sql`.
   The following tables have `REPLICA IDENTITY FULL` enabled:
   - `orders`
   - `driver_assignments`
   - `order_status_history`
   - `customer_order_claims`
   - `refund_requests`
   - `facility_order_operations`
   - `drivers`
   - `notifications`

2. **Security & RLS Integrity:**
   - Client subscriptions use authenticated Supabase anon tokens with `setAuth(accessToken)` for user-scoped channels.
   - Server-side event broadcasts utilize the REST API with the service-role key to publish directly to target channels without exposing service-role keys to clients.
   - OTP secrets are verified exclusively on the backend (`verify_order_otp_atomic` RPC); no plaintext OTP codes or verifications are trusted on the client.

No further production database migrations or schema adjustments are required.
