# Supabase manual setup

## If Part 2 failed on bw_catalog (your case)

Run in order:

1. `02b_FIXED_customer_catalog_seed.sql`   ← fixed catalog seed
2. `02c_AFTER_catalog_seed_continue.sql` ← rest of Part 2
3. `03_facility_admin_production_features.sql`

(You already did core + 01b. Do NOT re-run full `02_...` unless you want to.)

## Fresh install (nothing applied)

1. `01_core_schema_security_integrity.sql`
2. `02_order_lifecycle_payments_loyalty.sql`  (already patched for bw_catalog)
3. `03_facility_admin_production_features.sql`
