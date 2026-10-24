# Garment Verification Error Resolution Report: Missing rewash_cycle Column

**Project:** `D:\techyArts\B-W`  
**Order Number:** `BW-20261006-B774233C` (UUID: `62a064fe-4605-4e49-ad76-58bf6197e5b8`)  
**Status:** Resolved  
**Scope:** Local only. No Git commit, push, deploy, upload, or unreviewed production SQL applied.

---

## 1. Executive Summary

When opening the Garment Verification / Processing screen for order `BW-20261006-B774233C`, the application failed to load processing history and presented a database error:
```text
column facility_order_operations.rewash_cycle does not exist
```
The Garment Processing panel displayed a fallback error message with a "Retry processing" button, blocking the operator from viewing stages, progressing steps (Wash, Dry, Iron, Fold, Pack, QC), or performing final packing.

Direct inspection of the live PostgreSQL database confirmed that the `public.facility_order_operations` table has never contained a `rewash_cycle` column. The error was introduced when application code in `facility.service.ts` attempted to query `facility_order_operations.rewash_cycle` directly in a PostgREST `.select()` call.

The issue has been corrected via a schema-compatible application fix:
1. `facility_order_operations` queries in `facility.service.ts` now only select canonical schema columns (`id,operation_type,current_status,started_at,completed_at,performed_by,notes`).
2. Cycle numbering and rewash passes are dynamically calculated from canonical `facility_qc_decisions` (`cycle_number`, `approved`, `rewash_required`).
3. Final packing readiness check in `packingDetails` now safely matches cycle numbers without relying on a non-existent database column.
4. Regression tests were added to guarantee queries never select `rewash_cycle` on `facility_order_operations` and ensure dynamic cycle calculation functions correctly across initial and rework passes.

---

## 2. Root Cause Analysis

### A. Code Origin of the Failure
In a previous enhancement aimed at eliminating "Cycle 0" in favor of 1-based "Cycle 1" display in the UI, `backend/src/modules/facility/facility.service.ts` updated `processingHistory`:
```typescript
// Previous implementation:
this.db()
  .from("facility_order_operations")
  .select(
    "id,operation_type,current_status,started_at,completed_at,performed_by,notes,rewash_cycle", // <-- ERROR: rewash_cycle does not exist
  )
```
When PostgREST translated this query to PostgreSQL, PostgreSQL returned error `42703` (`undefined_column`):
`column facility_order_operations.rewash_cycle does not exist`.

### B. Live Database Schema vs. Migration History
- Migration file `20260920230000_8e_qc_rewash_audit.sql` was authored with `ALTER TABLE public.facility_order_operations ADD COLUMN IF NOT EXISTS rewash_cycle integer...`.
- However, this DDL was **never applied** to the active PostgreSQL database instance.
- Canonical columns in `public.facility_order_operations` on the live database are:
  - `id` (uuid)
  - `order_id` (uuid)
  - `facility_id` (uuid)
  - `current_status` (character varying)
  - `received_at` (timestamp with time zone)
  - `ready_for_delivery_at` (timestamp with time zone)
  - `operation_type` (character varying)
  - `performed_by` (uuid)
  - `machine_id` (uuid)
  - `started_at` (timestamp with time zone)
  - `completed_at` (timestamp with time zone)
  - `notes` (text)
- Notably, `admin-facility-oversight.service.spec.ts` already had an explicit contract test stating that queries on `facility_order_operations` must NOT select `rewash_cycle`.

---

## 3. Actual Schema vs. Application Expectations

| Layer | Expected by Previous Code | Actual Live Database Schema | Resolved Contract |
| :--- | :--- | :--- | :--- |
| **`facility_order_operations` table** | Contains `rewash_cycle integer` | Canonical columns only (`id,order_id,facility_id,current_status,operation_type,started_at,completed_at,...`) | Code strictly queries canonical columns only |
| **`facility_qc_decisions` table** | Exists with audit columns | `id,order_id,operation_id,cycle_number,approved,rewash_required,defect_code,reason,affected_item_ids,decided_by,created_at` | Fully authoritative for rework and cycle tracking |
| **`facility_packings` table** | `id,order_id,facility_id,parcel_id,cycle_number,packed_by,packed_at,notes` | Exists with `cycle_number` | Verified present; matches current computed cycle index |
| **Cycle calculation** | Static column on operation row | Derived from QC failure count | Dynamically computed: Count of prior rejected QC decisions before operation started |

---

## 4. Implementation Details & Files Changed

### 1. `backend/src/modules/facility/facility.service.ts`
- **`processingHistory` (lines 1086–1224)**:
  - Removed `rewash_cycle` from `.select(...)` on `facility_order_operations`.
  - Added concurrent `Promise.all` fetching of operations, intake discrepancies, and `facility_qc_decisions`.
  - Dynamically calculates `rewash_cycle` for each stage:
    ```typescript
    rewash_cycle:
      (operation as any).rewash_cycle != null
        ? (operation as any).rewash_cycle
        : qcFailures.filter(
            (qc) =>
              new Date(qc.created_at).getTime() <=
              new Date(operation.started_at).getTime(),
          ).length,
    ```
  - Returns `rewashCycle: qcFailures.length` to represent the overall rework cycle count (0 for initial run, 1 for first rewash pass, etc.).
- **`packingDetails` (lines 1242–1313)**:
  - Included `facility_qc_decisions` (`id,approved`) in `Promise.all`.
  - Replaced `latest?.rewash_cycle ?? 0` with `currentCycle = (latest as any)?.rewash_cycle != null ? (latest as any).rewash_cycle : qcFailuresCount`.
  - Updated `canPack` check:
    ```typescript
    !history.some((packing) => packing.cycle_number === currentCycle)
    ```
    This prevents duplicate packings for the same cycle while correctly allowing packing once per rewash cycle.

### 2. `backend/src/modules/facility/facility.service.spec.ts`
- Added unit and regression tests:
  - `loads processingHistory without querying rewash_cycle on facility_order_operations`: Verifies that the SQL select string never contains `rewash_cycle` and that initial cycle displays `rewash_cycle = 0`.
  - `dynamically increments rewash_cycle for stages following QC rejection`: Verifies that stages created before a QC rejection are cycle 0, and subsequent rewash stages are cycle 1.

---

## 5. Is a Database Change Required?

**No database schema change is required.**

The application now cleanly runs against the authoritative live database schema without schema mismatches. Rework cycles and QC audit trails are canonically tracked through `facility_qc_decisions`, adhering to the architectural separation of operational stages from quality control verdicts.

### Optional Future Migration (For Reference Only — Do NOT Run Automatically)
If a team lead decides in a future release to persist `rewash_cycle` directly on `facility_order_operations` for denormalized querying, the reviewed DDL would be:
```sql
-- REFERENCE ONLY: Do not execute in production without architectural review.
ALTER TABLE public.facility_order_operations 
  ADD COLUMN IF NOT EXISTS rewash_cycle integer NOT NULL DEFAULT 0 
  CHECK (rewash_cycle BETWEEN 0 AND 5);

COMMENT ON COLUMN public.facility_order_operations.rewash_cycle IS 
  'Count of QC failures incurred before this stage started (0 = initial run, 1 = 1st rewash, etc.)';
```

---

## 6. Verification & Test Execution

### A. Live Database Verification on Order `BW-20261006-B774233C`
- Direct database query against order `62a064fe-4605-4e49-ad76-58bf6197e5b8` confirmed:
  - 5 existing operations:
    1. `facility_workflow` (received): Completed
    2. `verification` (verification): Completed
    3. `washing` (washing): Completed
    4. `drying` (drying): Completed
    5. `ironing` (ironing): In progress (`completed_at: null`)
  - `facility_qc_decisions`: `0` records.
  - Calculated `rewash_cycle`: `0` (renders as **Cycle 1** in UI).
  - Executed query with canonical columns: Returned **0 errors** and loaded all 5 operations instantly.

### B. Automated Backend Test Suites
```bash
npm test -- facility.service.spec.ts facility.packing.spec.ts admin-facility-oversight.service.spec.ts
```
- `facility.service.spec.ts`: **21 passed, 21 total** (including new regression tests).
- `facility.packing.spec.ts`: **2 passed, 2 total**.
- `admin-facility-oversight.service.spec.ts`: **7 passed, 7 total**.
- `npm run build`: Backend NestJS build succeeded with **0 errors**.

### C. Automated Mobile Test Suites
```bash
npm test -- FacilityProcessingPanel.test.tsx FacilityPackingPanel.test.tsx
```
- `FacilityProcessingPanel.test.tsx`: **6 passed, 6 total**.
- `FacilityPackingPanel.test.tsx`: **5 passed, 5 total**.
- `npx tsc --noEmit` in `mobile/`: **0 type errors**.

### D. Workflow & Business Rules Preserved
1. **Cycle 1 Display**: Initial runs show `Cycle 1 · Wash · Completed` (`(rewash_cycle ?? 0) + 1`), preserving the user-facing 1-based cycle design without database errors.
2. **Rewash Pass Numbering**: If QC rejects an order, subsequent stages automatically increment to Cycle 2.
3. **Sequential Workflow Enforcement**: Wash -> Dry -> Iron -> Fold -> Pack -> QC sequence constraints remain enforced.
4. **Final Packing Gate**: Packing remains blocked until Pack-prep is complete and all verified items are accounted for.
5. **No Screen Flashing**: Background polling and realtime events use silent refresh mode without wiping state or resetting panels.

---

## 7. Required Manual SQL Action

**None.**
No manual SQL statements need to be executed on the production or development database. The application works directly with the active schema.
