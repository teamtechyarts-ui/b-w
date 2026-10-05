# DRIVER CREATION FIELD AUDIT & VERIFICATION REPORT
**Bright & White Laundry Management Platform**  
**Date:** 2026-09-30  
**Target:** Admin → Driver Provisioning & Management Flow

---

## 1. Current Driver Creation Flow

The complete architectural flow from user interaction to database persistence was audited and verified:

```
[ Admin Dashboard UI ]
         │
         ▼
[ Driver Form (AdminStaffScreen.tsx) ]
         │  Client-side validation (/^\+[1-9]\d{7,14}$/, full name length 1-100)
         ▼
[ API Request: adminStaffApi.ts -> api.ts ]
         │  HTTP POST /v1/admin/staff (Bearer token, JSON payload)
         ▼
[ Fastify / NestJS Controller (StaffController.ts) ]
         │  @Roles('admin'), SupabaseAuthGuard, RolesGuard
         ▼
[ DTO Validation Pipe (ProvisionStaffDto) ]
         │  class-validator rules: phone (@Matches), fullName, role (@IsIn)
         ▼
[ StaffService.ts (provision) ]
         │  requireAdmin(actorId) verification
         │  driver vs facility role branch check (facilityId forbidden for driver)
         ├───────────────────────────────┐
         ▼                               ▼
[ Supabase Auth (auth.users) ]   [ Operational DB (public schema) ]
  auth.admin.createUser:           1. Trigger -> initial row in public.profiles
  - phone (confirmed)              2. profiles.update(full_name, phone, is_active: false)
  - user_metadata:                 3. Lookup role id from public.roles (code: 'driver')
    - full_name                    4. Insert public.profile_roles (profile_id, role_id)
    - bw_staff_provisioning: true  5. Insert public.drivers (profile_id, is_active: true, is_available: false)
                                   6. profiles.update(is_active: true)
                                   7. Insert public.admin_staff_action_audit (action: 'provision')
         │                               │
         └───────────────┬───────────────┘
                         ▼
             [ HTTP 201 Created Response ]
             { profileId, role: 'driver', active: true }
                         │
                         ▼
             [ Admin UI State Update ]
             - Clear form inputs
             - Display green success alert: "Staff account created. Login uses the Development OTP."
             - Reload and render updated Staff Directory with driver card
```

---

## 2. Frontend Fields

**Screen File:** [`mobile/src/screens/AdminStaffScreen.tsx`](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx)

### Fields on the Form:
1. **Full Name** (`fullName`):
   - Input: `<TextInput accessibilityLabel="Staff name" ... />`
   - Placeholder: `e.g. Ramesh Patel`
   - Required: Yes
   - Frontend Validation: Trimmed, non-empty, max 100 characters. Shows inline error if violated.
2. **Mobile Phone** (`phone`):
   - Input: `<TextInput accessibilityLabel="Staff phone" keyboardType="phone-pad" ... />`
   - Placeholder: `+919876543210 or +16505550199`
   - Required: Yes
   - Frontend Validation: Must match regex `/^\+[1-9]\d{7,14}$/` (E.164 standard with leading `+` and country code). Shows inline validation guidance and field-level error.
3. **Staff Role** (`newRole`):
   - Options: `'driver'`, `'manager'`, `'facility_employee'`
   - Default: `'driver'`
   - Driver Selection Behavior: High-contrast tab active state. Shows driver-specific context banner explaining dynamic order dispatch and that no facility assignment is needed. Hides the facility picker.
4. **Assigned Facility** (`facilityId`):
   - Condition: Only rendered when role is NOT `'driver'`. Omitted from payload when creating a driver.

---

## 3. API Request

**Service Function:** [`provisionAdminStaff`](file:///d:/techyArts/B-W/mobile/src/services/adminStaffApi.ts) in [`mobile/src/services/adminStaffApi.ts`](file:///d:/techyArts/B-W/mobile/src/services/adminStaffApi.ts)  
**Client:** [`apiRequest`](file:///d:/techyArts/B-W/mobile/src/services/api.ts) in [`mobile/src/services/api.ts`](file:///d:/techyArts/B-W/mobile/src/services/api.ts)

- **HTTP Method:** `POST`
- **URL:** `http://127.0.0.1:3000/v1/admin/staff`
- **Headers:**
  - `Content-Type: application/json`
  - `Accept: application/json`
  - `Authorization: Bearer <ADMIN_ACCESS_TOKEN>`
- **Request Body (Driver):**
  ```json
  {
    "phone": "+16505550820",
    "fullName": "TEST Driver 3945",
    "role": "driver"
  }
  ```
  *(Note: `facilityId` is deliberately excluded by the service layer when `role === 'driver'`)*
- **Response Body (HTTP 201 Created):**
  ```json
  {
    "profileId": "8abcb50c-2ec9-4c40-a52e-fe971e371022",
    "role": "driver",
    "active": true
  }
  ```
- **Error Responses Handled:**
  - `HTTP 400 Bad Request`: Invalid E.164 phone regex, empty full name, or sending facility with driver.
  - `HTTP 401 Unauthorized`: Session expired or invalid Bearer token.
  - `HTTP 403 Forbidden`: Authenticated user does not possess the `admin` role.
  - `HTTP 409 Conflict`: Phone number is already registered in `auth.users`.

---

## 4. Backend DTO

**File:** [`backend/src/modules/staff/dto/provision-staff.dto.ts`](file:///d:/techyArts/B-W/backend/src/modules/staff/dto/provision-staff.dto.ts)

| Field | Type | Required | Validation Decorators | Used For |
|---|---|---|---|---|
| `phone` | `string` | Yes | `@Matches(/^\+[1-9]\d{7,14}$/)` | Supabase Auth phone identity and `profiles.phone` |
| `fullName` | `string` | Yes | `@IsString() @IsNotEmpty() @MaxLength(100)` | Driver identity name in `profiles.full_name` |
| `role` | `string` | Yes | `@IsIn(['driver', 'facility_employee', 'manager'])` | Role assignment (`'driver'`) |
| `facilityId` | `string` | Optional | `@IsOptional() @IsUUID()` | Facility link (asserted null/forbidden for drivers) |

---

## 5. Backend Service Logic

**File:** [`backend/src/modules/staff/staff.service.ts`](file:///d:/techyArts/B-W/backend/src/modules/staff/staff.service.ts)  
**Method:** `provision(actorId: string, dto: ProvisionStaffDto)`

1. **Authorization Gate:** Calls `requireAdmin(actorId)` to confirm caller has `roles.code === 'admin'`.
2. **Driver Role Guard:** 
   ```ts
   if (dto.role !== 'driver') {
     // requires active facility
   } else if (dto.facilityId) {
     throw new BadRequestException('Driver provisioning does not accept a facility');
   }
   ```
3. **Auth User Creation:** Calls `this.supabase.admin.auth.admin.createUser`:
   - `phone: dto.phone`
   - `phone_confirm: true`
   - `user_metadata: { full_name: dto.fullName.trim(), bw_staff_provisioning: true }`
4. **Profile Setup:** 
   - A PostgreSQL trigger on `auth.users` creates an initial record in `public.profiles` (`is_active: false`).
   - Updates `profiles`: sets `full_name`, `phone`, `is_active: false`.
5. **Role Assignment:**
   - Queries `public.roles` where `code = 'driver'` to fetch its UUID (`69fb4270-8f92-4421-ad2b-3df3b192872d`).
   - Inserts row into `public.profile_roles` (`profile_id`, `role_id`).
6. **Driver Operational Record:**
   - Inserts row into `public.drivers`:
     - `profile_id: id`
     - `is_active: true`
     - `is_available: false`
7. **Profile Activation:**
   - Updates `public.profiles` setting `is_active: true`.
8. **Audit Logging:**
   - Inserts audit row into `public.admin_staff_action_audit` with `action: 'provision'`, `detail: { role: 'driver', facilityId: null }`.
9. **Return:**
   - Returns `{ profileId: id, role: 'driver', active: true }`.

---

## 6. Supabase Auth Fields

Creating a driver invokes `supabase.admin.auth.admin.createUser`:
- **Table:** `auth.users`
- **Phone:** Required. Stored in E.164 format (e.g. `16505550820`).
- **Phone Confirmation:** Pre-confirmed (`phone_confirm: true`, `phone_confirmed_at` populated immediately).
- **Email:** Not required (`null` / empty).
- **Password:** Not required / not generated. Drivers log in using Phone OTP (`/v1/auth/phone/request-otp` and `/v1/auth/phone/verify-otp`).
- **Metadata:**
  - `user_metadata`: `{ "full_name": "<fullName>", "bw_staff_provisioning": true }`
  - `app_metadata`: `{ "provider": "phone", "providers": ["phone"] }`
- **User ID:** UUID generated by Supabase Auth, serving as foreign key to `public.profiles.id` and `public.drivers.profile_id`.

---

## 7. Database Tables and Columns

The live PostgreSQL database (`https://snvfpzjovkjjdslgmwjy.supabase.co`) was audited for all driver-related tables:

### Table 1: `auth.users`
| Column | Type | Nullable | Default | Required for Driver |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Yes (System generated) |
| `phone` | `text` | Yes | `null` | Yes (Unique per account) |
| `phone_confirmed_at` | `timestamptz` | Yes | `null` | Yes (System set) |
| `raw_user_meta_data` | `jsonb` | Yes | `null` | Yes (Full name & provisioning flag) |

### Table 2: `public.profiles`
| Column | Type | Nullable | Default | Required for Driver |
|---|---|---|---|---|
| `id` | `uuid` | No | PK (FK to `auth.users.id`) | Yes (System mapped) |
| `full_name` | `text` | Yes | `null` | Yes (From Admin form) |
| `phone` | `text` | Yes | `null` | Yes (From Admin form) |
| `avatar_path` | `text` | Yes | `null` | No (Optional) |
| `is_active` | `boolean` | No | `true` | Yes (Set to `true` upon activation) |
| `created_at` | `timestamptz` | No | `now()` | Yes (System default) |
| `updated_at` | `timestamptz` | No | `now()` | Yes (System default) |

### Table 3: `public.roles`
| Column | Type | Nullable | Default | Required for Driver |
|---|---|---|---|---|
| `id` | `uuid` | No | PK (`69fb4270-8f92-4421-ad2b-3df3b192872d`) | Yes |
| `code` | `text` | No | Unique (`'driver'`) | Yes |
| `name` | `text` | No | `'Driver'` | Yes |
| `description` | `text` | Yes | `'Pickup and delivery access'` | Yes |

### Table 4: `public.profile_roles`
| Column | Type | Nullable | Default | Required for Driver |
|---|---|---|---|---|
| `profile_id` | `uuid` | No | Composite PK (FK to `profiles.id`) | Yes |
| `role_id` | `uuid` | No | Composite PK (FK to `roles.id`) | Yes |

### Table 5: `public.drivers`
| Column | Type | Nullable | Default | Required for Driver |
|---|---|---|---|---|
| `id` | `uuid` | No | PK (`gen_random_uuid()`) | Yes (System generated) |
| `profile_id` | `uuid` | No | Unique (FK to `profiles.id`) | Yes |
| `is_available` | `boolean` | No | `false` | Yes (Default `false` until driver toggles online) |
| `is_active` | `boolean` | No | `true` | Yes (Default `true`) |
| `max_concurrent_jobs` | `integer` | No | `5` | Yes (Default `5`) |
| `is_online` | `boolean` | No | `false` | Yes (Default `false`) |
| `current_battery_level` | `integer` | Yes | `null` | No (Updated via driver GPS telemetry) |
| `heading` | `numeric` | Yes | `null` | No (Updated via driver GPS telemetry) |
| `speed_kmh` | `numeric` | Yes | `null` | No (Updated via driver GPS telemetry) |
| `last_location_updated_at`| `timestamptz` | Yes | `null` | No (Updated via driver GPS telemetry) |
| `created_at` | `timestamptz` | No | `now()` | Yes (System default) |
| `updated_at` | `timestamptz` | No | `now()` | Yes (System default) |

### Table 6: `public.admin_staff_action_audit`
| Column | Type | Nullable | Default | Required for Driver |
|---|---|---|---|---|
| `id` | `uuid` | No | PK (`gen_random_uuid()`) | Yes (System generated) |
| `actor_profile_id` | `uuid` | No | FK to `profiles.id` | Yes (Admin profile ID) |
| `target_profile_id`| `uuid` | No | FK to `profiles.id` | Yes (New driver profile ID) |
| `action` | `text` | No | - | Yes (`'provision'`) |
| `detail` | `jsonb` | No | - | Yes (`{"role":"driver","facilityId":null}`) |
| `created_at` | `timestamptz` | No | `now()` | Yes (System default) |

---

## 8. Complete Field Mapping

| Field | Frontend | API | DTO | Service | Auth | DB | Required |
|---|---|---|---|---|---|---|---|
| **Full Name** | `fullName` | `fullName` | `fullName` | `dto.fullName` | `raw_user_meta_data.full_name` | `profiles.full_name` | **Yes (Admin input)** |
| **Phone Number** | `phone` | `phone` | `phone` | `dto.phone` | `auth.users.phone` | `profiles.phone` | **Yes (Admin input)** |
| **Role Code** | `newRole` | `role` | `role` | `dto.role` | - | `roles.code` -> `profile_roles.role_id` | **Yes (Tab selection)** |
| **Facility ID** | Omitted | Omitted | Optional | Asserted `null` | - | N/A (Drivers not bound to facility) | **No (Forbidden for driver)** |
| **Profile ID** | - | - | - | `id` | `auth.users.id` | `profiles.id`, `drivers.profile_id` | **System Generated** |
| **Driver ID** | - | - | - | Auto | - | `drivers.id` | **System Generated** |
| **Active Status** | - | - | - | `true` | - | `profiles.is_active`, `drivers.is_active` | **System Default (`true`)** |
| **Availability** | - | - | - | `false` | - | `drivers.is_available` | **System Default (`false`)** |
| **Concurrent Jobs** | - | - | - | Auto | - | `drivers.max_concurrent_jobs` | **System Default (`5`)** |
| **Online Status** | - | - | - | Auto | - | `drivers.is_online` | **System Default (`false`)** |

---

## 9. Fields Admin Must Enter

1. **Full Name:** Text string (1–100 characters, trimmed).
2. **Mobile Phone Number:** E.164 formatted telephone number (e.g. `+919876543210` or `+16505550199`).
3. **Role:** Select the **Driver** tab (default).

---

## 10. Fields Generated Automatically

1. `auth.users.id` (UUID generated by Supabase Auth)
2. `profiles.id` (mirrors `auth.users.id`)
3. `drivers.id` (UUID primary key generated by PostgreSQL)
4. `admin_staff_action_audit.id` (UUID primary key generated by PostgreSQL)
5. `created_at` and `updated_at` timestamps across all tables

---

## 11. Fields Not Needed in UI

1. **Facility Selector:** Not applicable to drivers; drivers are dispatched dynamically across facilities and service zones. Exposing or sending a facility causes backend `BadRequestException('Driver provisioning does not accept a facility')`.
2. **Email Address:** Driver authentication is phone + OTP based. Email is not required.
3. **Password:** No password needed; drivers use mobile SMS / Development OTP.
4. **Internal Database Keys:** UUIDs, audit metadata, role IDs, telemetry fields (`current_battery_level`, `heading`, `speed_kmh`).

---

## 12. UI Changes Made

File modified: [`mobile/src/screens/AdminStaffScreen.tsx`](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx)

1. **Design System & Elevation:** Replaced unstyled wireframe boxes with production-grade card containers featuring clean borders (`#E5E7EB`), soft shadows, and `#FFFFFF` card surfaces against `#F9FAFB` page background.
2. **Visual Hierarchy & Header:**
   - Added section eyebrow: `B&W ADMIN · OPERATIONS`.
   - Clear page heading and descriptive subtitle.
   - Clean back navigation button.
3. **Role Selection Tabs:**
   - Built modern segmented control for `Driver`, `Manager`, and `Facility Employee`.
   - Selected role is highlighted with dark slate `#111827` and white text.
   - Dynamic contextual banner explaining operational scope (dynamic dispatch for drivers, facility binding for facility staff).
4. **Field Labels & Validation Feedback:**
   - Clear labels with red required asterisks (`Full Name *`, `Mobile Phone (E.164 with Country Code) *`).
   - Inline hint: *"Must start with + and country code. Used for login authentication."*
   - Real-time client-side validation errors displayed directly under the affected field.
5. **Driver-Specific Field Filtering:**
   - Facility selector is completely hidden when `role === 'driver'`.
6. **Feedback Alerts:**
   - Error alert box with warning icon, `#FEF2F2` background, and `#B91C1C` text.
   - Success alert box with checkmark icon, `#F0FDF4` background, and `#15803D` text.
7. **Staff Directory Redesign:**
   - Avatars with member initials and color coding (indigo for drivers, green for facility staff).
   - Clean status badges (`Active` with green dot, `Disabled` with gray dot).
   - Role badge pill.
   - Operational description line.
   - Clean search input with role and status filter pills.

---

## 13. Driver Creation Test Result

A complete end-to-end test was performed using real Headless Chrome driving the live frontend (`http://localhost:5173`) and live backend (`http://127.0.0.1:3000`).

### Test Execution Details:
- **Admin Identity:** `dharmikclothing@gmail.com` (UUID: `a1f87ac3-9986-4e8a-88ee-c76661a39b7b`)
- **Input Data:**
  - Full Name: `TEST Driver 3945`
  - Mobile Phone: `+16505550820`
  - Role: `driver`
- **Result:**
  - Hardware click on **Create staff** button dispatched HTTP POST `/v1/admin/staff`.
  - Backend responded with HTTP 201 Created.
  - UI displayed green confirmation banner: `"Staff account created. Login uses the Development OTP."`
  - Form inputs cleared automatically.
  - Staff Directory refreshed immediately and displayed `TEST Driver 3945` with role `Driver` and status `Active`.

```
==============================================
TEST RESULT: hasSuccess = true , hasDriverInList = true
==============================================
```

---

## 14. Created Test Record IDs

The newly provisioned test records are verified in the live Supabase PostgreSQL database:

- **`auth.users` ID:** `8abcb50c-2ec9-4c40-a52e-fe971e371022`
  - Phone: `16505550820`
  - Confirmed at: `2026-09-30T04:59:15.459417Z`
- **`public.profiles` ID:** `8abcb50c-2ec9-4c40-a52e-fe971e371022`
  - `full_name`: `TEST Driver 3945`
  - `phone`: `+16505550820`
  - `is_active`: `true`
- **`public.profile_roles` Record:**
  - `profile_id`: `8abcb50c-2ec9-4c40-a52e-fe971e371022`
  - `role_id`: `69fb4270-8f92-4421-ad2b-3df3b192872d` (code: `'driver'`)
- **`public.drivers` ID:** `2960c013-d553-46ea-9409-b4a9192aa1dd`
  - `profile_id`: `8abcb50c-2ec9-4c40-a52e-fe971e371022`
  - `is_active`: `true`
  - `is_available`: `false`
  - `is_online`: `false`
  - `max_concurrent_jobs`: `5`
- **`public.admin_staff_action_audit` ID:** `e6afbbc4-903c-4e8e-b04e-986baaa0572e`
  - `actor_profile_id`: `a1f87ac3-9986-4e8a-88ee-c76661a39b7b` (Admin)
  - `target_profile_id`: `8abcb50c-2ec9-4c40-a52e-fe971e371022`
  - `action`: `'provision'`
  - `detail`: `{"role": "driver", "facilityId": null}`
  - `created_at`: `2026-09-30T04:59:15.744007+00:00`

---

## 15. Files Changed

Only the frontend staff screen was modified to implement the targeted UI improvements:
- [`mobile/src/screens/AdminStaffScreen.tsx`](file:///d:/techyArts/B-W/mobile/src/screens/AdminStaffScreen.tsx)

No backend code, database schema, role codes, or API contracts were modified.

---

## 16. Tests Executed

1. **Mobile Unit Test Suites:**
   ```bash
   npm test -- --runInBand --watch=false AdminStaffScreen AdminStaffListScreen AdminStaffErrorScreen adminStaffApi
   ```
   **Result:** 4 Test Suites passed, 6 Tests passed.
2. **Backend Unit Test Suites:**
   ```bash
   npm test -- --runInBand src/modules/staff
   ```
   **Result:** 1 Test Suite passed, 6 Tests passed.
3. **Backend Compilation & Lint:**
   ```bash
   npm run build  # nest build -> PASS (exit code 0)
   npm run lint   # eslint -> PASS (0 warnings, 0 errors)
   ```
4. **Mobile Web Compilation:**
   ```bash
   npx vite build # vite v8.3.0 -> PASS (exit code 0)
   ```
5. **Live Chrome Browser End-to-End Test:**
   - Navigated to `http://localhost:5173`.
   - Verified Admin authentication and operations dashboard.
   - Navigated to **Driver and Facility staff**.
   - Submitted new test driver form with genuine input dispatch.
   - Verified instant success response, UI state update, and direct database persistence.

---

## 17. Remaining Issues

None for the Driver creation flow. The Admin → Driver creation flow is fully verified end-to-end and meets all production criteria.
