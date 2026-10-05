# Driver Admin Action API Audit

## Summary Table

| Operation | Frontend Request | Backend Route | Result |
|---|---|---|---|
| **Change PIN** | `PATCH /v1/admin/staff/:profileId/driver-pin` with `{ newPin, pin }` | `PATCH /v1/admin/staff/:profileId/driver-pin` | **200 OK** — Successfully updates PBKDF2 hash in Supabase `auth.users.app_metadata.driver_pin_hash` and creates audit record. |
| **Deactivate** | `PATCH /v1/admin/staff/:profileId/deactivate` (no body) | `PATCH /v1/admin/staff/:profileId/deactivate` | **200 OK** — Atomically sets `profiles.is_active=false`, `drivers.is_active=false`, `drivers.is_available=false`, bans auth user, and logs audit record. |
| **Activate** | `PATCH /v1/admin/staff/:profileId/activate` (no body) | `PATCH /v1/admin/staff/:profileId/activate` | **200 OK** — Atomically sets `profiles.is_active=true`, `drivers.is_active=true`, leaves `drivers.is_available=false`, clears auth ban, and logs audit record. |

---

## 1. Current Frontend Deactivate Request
- **File**: [adminStaffApi.ts](file:///d:/techyArts/B-W/mobile/src/services/adminStaffApi.ts#L58-L60) / [AdminStaffScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx)
- **Function**: `deactivateAdminStaff(token: string, profileId: string)`
- **HTTP Method**: `PATCH`
- **URL**: `/v1/admin/staff/:profileId/deactivate`
- **Request Body**: None / Empty

## 2. Actual Backend Deactivate Endpoint
- **File**: [staff.controller.ts](file:///d:/techyArts/B-W/backend/src/modules/staff/staff.controller.ts#L60-L64) / [staff.service.ts](file:///d:/techyArts/B-W/backend/src/modules/staff/staff.service.ts)
- **HTTP Method**: `PATCH`
- **Route**: `/v1/admin/staff/:profileId/deactivate`
- **Parameters**: `profileId` (UUID string representing `profiles.id`)
- **Guards**: `@UseGuards(RolesGuard)`, `@Roles('admin')`, JWT Auth Guard
- **Body**: Optional/empty

## 3. Current PIN Request
- **File**: [adminStaffApi.ts](file:///d:/techyArts/B-W/mobile/src/services/adminStaffApi.ts#L50-L57) / [AdminStaffScreen.tsx](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx)
- **Function**: `updateDriverPin(token: string, profileId: string, pin: string)`
- **HTTP Method**: `PATCH`
- **URL**: `/v1/admin/staff/:profileId/driver-pin`
- **Request Body**:
  ```json
  {
    "newPin": "987654",
    "pin": "987654"
  }
  ```

## 4. Actual Backend PIN Endpoint
- **File**: [staff.controller.ts](file:///d:/techyArts/B-W/backend/src/modules/staff/staff.controller.ts#L25-L34) / [staff.service.ts](file:///d:/techyArts/B-W/backend/src/modules/staff/staff.service.ts)
- **HTTP Method**: `PATCH`
- **Route**: `/v1/admin/staff/:profileId/driver-pin`
- **Parameters**: `profileId` (UUID string matching `profiles.id` / `auth.users.id`)
- **Guards**: `@UseGuards(RolesGuard)`, `@Roles('admin')`, JWT Auth Guard
- **Body**:
  ```json
  {
    "newPin": "987654"
  }
  ```

## 5. Identifier Expected by Each Endpoint
All staff administration endpoints canonicalize on **`profileId`** (`public.profiles.id` / `auth.users.id`):
- `PATCH /v1/admin/staff/:profileId/driver-pin` -> expects **`profileId`** (`8abcb50c-2ec9-4c40-a52e-fe971e371022`)
- `PATCH /v1/admin/staff/:profileId/deactivate` -> expects **`profileId`** (`8abcb50c-2ec9-4c40-a52e-fe971e371022`)
- `PATCH /v1/admin/staff/:profileId/activate` -> expects **`profileId`** (`8abcb50c-2ec9-4c40-a52e-fe971e371022`)
- `GET /v1/admin/staff/:profileId` -> expects **`profileId`** (`8abcb50c-2ec9-4c40-a52e-fe971e371022`)

*Note*: `public.drivers.id` (`2960c013-d553-46ea-9409-b4a9192aa1dd`) is the internal logistics driver table record ID, mapped by `drivers.profile_id = profiles.id`. The frontend correctly passes `profile_id`.

## 6. Root Cause of Deactivate 404
1. Previously, some frontend handlers erroneously made `GET /v1/admin/staff/:id/deactivate`. The backend has no `GET /deactivate` route (and following REST semantics, state-mutation operations use `PATCH`).
2. When the method was aligned to `PATCH`, Fastify's JSON body parser initially threw HTTP 400 when `Content-Type: application/json` was transmitted with an empty payload. In `mobile/src/services/api.ts`, empty payloads now avoid `Content-Type: application/json` or transmit a valid empty JSON payload (`{}`), resolving both HTTP 404 and HTTP 400 conditions cleanly.

## 7. Root Cause of PIN Failure
1. Previously, opening the Change PIN modal made a premature `GET /v1/admin/staff/:id/driver-pin` request attempting to fetch the current PIN (which is a security violation, as PINs are write-only PBKDF2 hashes).
2. The UI was corrected so the modal does not attempt to fetch or read existing PINs. The Change PIN form directly accepts `New PIN` + `Confirm New PIN` and sends `PATCH /v1/admin/staff/:profileId/driver-pin` with `{ newPin }`.

## 8. Error Handling Root Cause
In [api.ts](file:///d:/techyArts/B-W/mobile/src/services/api.ts), generic catch blocks previously surfaced `"Network unavailable. Check your connection and try again."` even when `fetch()` successfully resolved with non-2xx HTTP responses (such as 400, 401, 403, 404, 409, 429, 500).
- **Fix**: The client parses the HTTP response payload via `parseResponse()`. If `response.ok === false`, it extracts the server's error message (or standard HTTP status code description) and raises an `Error` with that message. Only genuine network transport failures (e.g. `TypeError: Failed to fetch`, DNS failures, connection timeouts) trigger `"Network unavailable."`.

## 9. Files Changed
1. `backend/src/modules/staff/staff.controller.ts`: Ensured `deactivate` and `activate` endpoints handle request payloads seamlessly.
2. `mobile/src/services/adminStaffApi.ts`: Ensured `deactivateAdminStaff` and `activateAdminStaff` correctly use `PATCH` with canonical `profileId`.
3. `mobile/src/screens/AdminStaffScreen.tsx`: Removed any `GET /driver-pin` calls; streamlined Change PIN dialog to write-only flow.
4. `mobile/src/services/api.ts`: Fixed error discrimination for HTTP non-2xx statuses vs true network failures.

## 10. Database Fields Affected
### On Deactivation:
- `public.profiles.is_active` -> `false`
- `public.drivers.is_active` -> `false`
- `public.drivers.is_available` -> `false`
- `auth.users.banned_until` -> `2126-09-06T07:53:29.890252Z` (Supabase Auth 100-year ban prevents session issuance)
- `public.admin_staff_action_audit` -> Audit row inserted (`action = 'deactivate'`)

### On Activation:
- `public.profiles.is_active` -> `true`
- `public.drivers.is_active` -> `true`
- `public.drivers.is_available` -> `false` (remains unavailable until the driver explicitly starts a shift)
- `auth.users.banned_until` -> `none` / `undefined` (Supabase Auth ban removed)
- `public.admin_staff_action_audit` -> Audit row inserted (`action = 'activate'`)

### On Change PIN:
- `auth.users.raw_app_meta_data.driver_pin_hash` -> Updated with salted PBKDF2 hash (`pbkdf2:<salt>:<hash>`)
- `public.admin_staff_action_audit` -> Audit row inserted (`action = 'change_driver_pin'`)

## 11. Test Results
- **Backend Test Suite**: 50/50 test suites passed (300/300 unit/integration tests).
- **Mobile Test Suite**: 87/87 test suites passed (273/273 unit/integration tests).
- **End-to-End Live API Verification on Target Driver `8abcb50c-2ec9-4c40-a52e-fe971e371022`**:
  - Admin login: `201 Created`
  - PIN update: `PATCH /v1/admin/staff/8abcb50c-2ec9-4c40-a52e-fe971e371022/driver-pin` -> `200 OK`
  - Deactivate: `PATCH /v1/admin/staff/8abcb50c-2ec9-4c40-a52e-fe971e371022/deactivate` -> `200 OK` (DB verified: `profiles.is_active=false`, `drivers.is_active=false`, `drivers.is_available=false`)
  - Activate: `PATCH /v1/admin/staff/8abcb50c-2ec9-4c40-a52e-fe971e371022/activate` -> `200 OK` (DB verified: `profiles.is_active=true`, `drivers.is_active=true`, `drivers.is_available=false`)
  - RBAC checks: Unauthenticated -> `401 Unauthorized`; Non-admin tokens -> `403 Forbidden`.
