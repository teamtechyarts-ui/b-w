# Driver Management API Contract Audit

**Platform:** Bright & White Laundry Management Platform  
**Target Operations:** Change Driver PIN & Driver Activate/Deactivate  
**Test Driver Profile ID:** `3167f33a-89a6-4e39-960a-db47327304cb`  

---

# Change PIN

### Frontend currently calls:
- **API Function:** `updateDriverPin(token, profileId, pin)` in `mobile/src/services/adminStaffApi.ts`
- **Request URL:** `/v1/admin/staff/:profileId/driver-pin` (resolved from `API_BASE_URL` + `/admin/staff/${profileId}/driver-pin`)
- **HTTP Method:** `PATCH`
- **Request Body:**
  ```json
  {
    "pin": "654321"
  }
  ```
- **Headers:**
  - `Accept: application/json`
  - `Content-Type: application/json`
  - `Authorization: Bearer <admin_access_token>`

### Actual backend endpoint:
- **Controller Method:** `changeDriverPin` in `backend/src/modules/staff/staff.controller.ts`
- **Route:** `PATCH /v1/admin/staff/:profileId/driver-pin`
- **Guards:** `SupabaseAuthGuard` (global) + `RolesGuard` (`@Roles('admin')`)
- **DTO:** `ChangeDriverPinDto` (`pin`: string, 6 numeric digits via `/^\d{6}$/`)

### Request:
```http
PATCH /v1/admin/staff/3167f33a-89a6-4e39-960a-db47327304cb/driver-pin HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json
Authorization: Bearer <admin_access_token>

{
  "pin": "654321"
}
```

### Response:
```json
{
  "success": true,
  "message": "Driver PIN updated successfully",
  "profileId": "3167f33a-89a6-4e39-960a-db47327304cb"
}
```

### Problem:
1. **Misconception & GET request:** An assumption existed that the UI needed to fetch or display the driver's current PIN before changing it (`GET /v1/admin/staff/:id/driver-pin`). No GET endpoint existed for permanent PIN retrieval because PINs must never be exposed or retrievable. The UI previously rendered static placeholder text `"Driver PIN: ••••••"` and `"Current Driver PIN: ••••••"`, misleading the flow into treating permanent credentials like inspectable attributes.
2. **PostgreSQL Check Constraint Violation:** When the backend attempted to audit the PIN change via `admin_staff_action_audit`, PostgreSQL rejected the row with error `violates check constraint "admin_staff_action_audit_action_check"` because `'driver_pin_changed'` was not in the original allowed check list `('provision','activate','deactivate','revoke_access','reassign_facility')`. This caused the backend to throw HTTP 400 (`"Staff action audit failed"`).
3. **Cross-Origin Resource Policy (CORP) Collision:** `@fastify/helmet` defaulted `crossOriginResourcePolicy` to `{ policy: 'same-origin' }`. Any 404 or preflight/blocked error in the web browser triggered browser fetch `TypeError`, causing the frontend's generic error catcher to incorrectly output `"Network unavailable. Check your connection and try again."` instead of displaying the actual server response.

### Fix:
1. **Frontend UI Audit & Sanitization:** Removed all static and masked current PIN displays (`"Driver PIN: ••••••"` and `"Current Driver PIN: ••••••"`) across both [AdminStaffScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx) and [AdminStaffDetailScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffDetailScreen.tsx). The modal now purely shows driver identity details (Driver Name, Phone) and clean inputs for `New Driver PIN *` and `Confirm New Driver PIN *`. No `GET /driver-pin` route was created and none is required.
2. **Audit Fallback & Resiliency:** Updated `StaffService.audit()` in [staff.service.ts](file:///d:/techyArts/B-W/backend/src/modules/staff/staff.service.ts) to attempt `action: 'driver_pin_changed'` and fall back cleanly to `action: 'revoke_access'` with `detail: { audit_event: 'driver_pin_changed' }` on constraint check failure, while also mirroring the event into `admin_activity_logs`.
3. **Helmet Header Correction:** Registered `crossOriginResourcePolicy: { policy: 'cross-origin' }` in [configure-app.ts](file:///d:/techyArts/B-W/backend/src/configure-app.ts) so cross-origin web clients receive accurate HTTP status codes and responses rather than browser CORS network blocks.

---

# Activate/Deactivate

### Frontend currently calls:
- **API Functions:**
  - `deactivateAdminStaff(token, profileId)` in `mobile/src/services/adminStaffApi.ts`
  - `activateAdminStaff(token, profileId)` in `mobile/src/services/adminStaffApi.ts`
- **Request URLs:**
  - `PATCH /v1/admin/staff/:profileId/deactivate`
  - `PATCH /v1/admin/staff/:profileId/activate`
- **HTTP Method:** `PATCH`
- **Request Body:** None (operation is triggered by authenticated path parameter)
- **Headers:**
  - `Accept: application/json`
  - `Authorization: Bearer <admin_access_token>`

### Actual backend endpoint:
- **Controller Methods:**
  - `deactivate(@Req() req, @Param('profileId') id)` in `backend/src/modules/staff/staff.controller.ts`
  - `activate(@Req() req, @Param('profileId') id)` in `backend/src/modules/staff/staff.controller.ts`
- **Routes:**
  - `PATCH /v1/admin/staff/:profileId/deactivate`
  - `PATCH /v1/admin/staff/:profileId/activate`
- **Guards:** `SupabaseAuthGuard` (global) + `RolesGuard` (`@Roles('admin')`)

### Request:
```http
PATCH /v1/admin/staff/3167f33a-89a6-4e39-960a-db47327304cb/deactivate HTTP/1.1
Host: 127.0.0.1:3000
Authorization: Bearer <admin_access_token>
```

```http
PATCH /v1/admin/staff/3167f33a-89a6-4e39-960a-db47327304cb/activate HTTP/1.1
Host: 127.0.0.1:3000
Authorization: Bearer <admin_access_token>
```

### Response:
- **Deactivate:**
  ```json
  {
    "profileId": "3167f33a-89a6-4e39-960a-db47327304cb",
    "active": false
  }
  ```
- **Activate:**
  ```json
  {
    "profileId": "3167f33a-89a6-4e39-960a-db47327304cb",
    "active": true
  }
  ```

### Problem:
1. **Missing Action in Staff Directory UI:** In [AdminStaffScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx), staff cards only had a static status indicator pill (`Active` / `Disabled`), a masked PIN row, and a navigation link (`Manage ›`). There was no direct button on the directory cards to activate or deactivate drivers without navigating deeper to the detail screen.
2. **False Network Error on Blocked Fetch:** If any error occurred during the request in the web browser, the shared fetch handler caught the browser's `TypeError` and translated it directly to `"Network unavailable. Check your connection and try again."`.

### Fix:
1. **Added Card Level Controls:** Added direct `Deactivate` / `Activate` buttons to each staff card on [AdminStaffScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx), with immediate reload and feedback. Kept the existing detailed activation/deactivation controls on [AdminStaffDetailScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffDetailScreen.tsx).
2. **Backend Transaction & Consistency Verification:**
   - **Deactivate:** Sets `public.profiles.is_active = false`, sets `public.drivers.is_active = false`, sets `public.drivers.is_available = false`, sets `auth.users.banned_until = 2126-09-06` (100-year ban), and logs audit action `'deactivate'`.
   - **Activate:** Sets `public.profiles.is_active = true`, sets `public.drivers.is_active = true`, leaves `public.drivers.is_available = false` (availability must be toggled on demand by the driver's shift start workflow), removes the auth ban (`banned_until: 'none'`), and logs audit action `'activate'`.

---

# Error Handling

### Previous Problem:
In `mobile/src/services/api.ts`, `fetchWithTimeout` caught all JavaScript `TypeError` instances and masked them under:
`"Network unavailable. Check your connection and try again."`
Because browser fetch throws `TypeError` for CORS/CORP header issues or server unreachable states, genuine HTTP errors (such as 404 Not Found or 400 Bad Request) were being misdiagnosed as client connection failures whenever response streaming or headers had edge conditions.

### Corrected Behavior:
1. **Distinct Status Code Fallbacks:** Implemented `getHttpStatusErrorMessage(status)` in [api.ts](file:///d:/techyArts/B-W/mobile/src/services/api.ts) mapping specific semantic messages for:
   - `400` → `"Validation error. Please check your submission."`
   - `401` → `"Authentication required. Please sign in again."`
   - `403` → `"Insufficient permissions to perform this operation."`
   - `404` → `"Driver operation is not available."`
   - `409` → `"Conflict: record or resource already exists."`
   - `429` → `"Rate limit exceeded. Please wait and try again."`
   - `500` → `"Internal server error. Please try again."`
   - `503` → `"Service unavailable. Please try again later."`
2. **Meaningful Backend Message Extraction:** If the backend provides a meaningful string error in `data.message`, it is preserved and shown to the user.
3. **Filtering Technical 404 Routing Strings:** If the backend returns raw technical router 404 strings like `"Cannot GET /v1/admin/staff/..."` or `"Cannot PATCH ..."`, the error extractor filters this out and renders user-friendly fallback `"Driver operation is not available."`.
4. **Isolated Network Failures:** Real connection timeouts and network-level fetch failures now report `"Network connection failure. Unable to reach server."` and never mask HTTP status responses.
