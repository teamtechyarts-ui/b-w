const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runAudit() {
  console.log('================================================================');
  console.log('       LIVE SUPABASE DATABASE FORENSIC AUDIT REPORT             ');
  console.log('================================================================\n');

  // 1. Audit admin_assignment_audit
  const { data: auditLogs, error: auditErr } = await supabase
    .from('admin_assignment_audit')
    .select('*');

  if (auditErr) {
    console.error('Error fetching admin_assignment_audit:', auditErr);
    return;
  }

  console.log(`--- [1] admin_assignment_audit (${auditLogs.length} rows) ---`);
  console.log(JSON.stringify(auditLogs, null, 2));

  const protectedAssignmentIds = new Set();
  auditLogs.forEach(row => {
    if (row.new_assignment_id) protectedAssignmentIds.add(row.new_assignment_id);
    if (row.previous_assignment_id) protectedAssignmentIds.add(row.previous_assignment_id);
  });

  console.log(`\nProtected Assignment IDs from admin_assignment_audit:`, [...protectedAssignmentIds]);

  // 2. Fetch driver_assignments referenced by admin_assignment_audit
  const protectedOrderIds = new Set();
  const protectedDriverIds = new Set();
  let protectedAssignments = [];

  if (protectedAssignmentIds.size > 0) {
    const { data: assignments, error: assignErr } = await supabase
      .from('driver_assignments')
      .select('*')
      .in('id', [...protectedAssignmentIds]);

    if (assignErr) {
      console.error('Error fetching protected assignments:', assignErr);
    } else {
      protectedAssignments = assignments || [];
      console.log(`\n--- [2] Protected driver_assignments (${protectedAssignments.length} rows found) ---`);
      console.log(JSON.stringify(protectedAssignments, null, 2));

      protectedAssignments.forEach(a => {
        if (a.order_id) protectedOrderIds.add(a.order_id);
        if (a.driver_id) protectedDriverIds.add(a.driver_id);
      });
    }
  }

  console.log(`\nProtected Order IDs (${protectedOrderIds.size}):`, [...protectedOrderIds]);
  console.log(`Protected Driver IDs (${protectedDriverIds.size}):`, [...protectedDriverIds]);

  // 3. Audit all driver_assignments
  const { data: allAssignments, error: allAssignErr } = await supabase
    .from('driver_assignments')
    .select('id, order_id, driver_id, status, assignment_type, created_at');
  
  console.log(`\n--- [3] Total driver_assignments in DB: ${allAssignments ? allAssignments.length : 0} ---`);

  // 4. Audit all drivers
  const { data: allDrivers, error: driversErr } = await supabase
    .from('drivers')
    .select('id, profile_id, current_facility_id, is_active, is_online, approval_status, created_at');
  
  console.log(`\n--- [4] Drivers in DB (${allDrivers ? allDrivers.length : 0} rows) ---`);
  console.log(JSON.stringify(allDrivers, null, 2));

  // 5. Audit all facility_employees
  const { data: allFacilityEmployees, error: facEmpErr } = await supabase
    .from('facility_employees')
    .select('id, profile_id, facility_id, is_active, created_at');

  console.log(`\n--- [5] Facility Employees in DB (${allFacilityEmployees ? allFacilityEmployees.length : 0} rows) ---`);
  console.log(JSON.stringify(allFacilityEmployees, null, 2));

  // 6. Audit all roles & profile_roles
  const { data: allRoles, error: rolesErr } = await supabase
    .from('roles')
    .select('id, name');
  console.log(`\n--- [6] Roles in DB ---`);
  console.log(JSON.stringify(allRoles, null, 2));

  const { data: allProfileRoles, error: profRolesErr } = await supabase
    .from('profile_roles')
    .select('profile_id, role_id, roles(name)');
  console.log(`\n--- [7] Profile Roles in DB (${allProfileRoles ? allProfileRoles.length : 0} rows) ---`);
  console.log(JSON.stringify(allProfileRoles, null, 2));

  // 7. Audit all profiles
  const { data: allProfiles, error: profsErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, is_active, created_at');
  console.log(`\n--- [8] Profiles in DB (${allProfiles ? allProfiles.length : 0} rows) ---`);
  console.log(JSON.stringify(allProfiles, null, 2));

  // 8. Audit all orders
  const { data: allOrders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, customer_id, facility_id, status, created_at');
  console.log(`\n--- [9] Orders in DB (${allOrders ? allOrders.length : 0} rows) ---`);
  console.log(JSON.stringify(allOrders, null, 2));

  // 9. Check row counts for all tables in current_schema.sql
  const tablesToCheck = [
    'admin_assignment_audit',
    'customer_addresses',
    'customer_claim_photos',
    'customers',
    'damage_reports',
    'delivery_proofs',
    'device_tokens',
    'driver_assignments',
    'driver_live_locations',
    'driver_location_history',
    'driver_navigation_events',
    'driver_trip_locations',
    'drivers',
    'facilities',
    'facility_employees',
    'facility_machines',
    'facility_order_operations',
    'facility_processing_batches',
    'financial_audit_logs',
    'garment_inspections',
    'loyalty_point_transactions',
    'loyalty_transactions',
    'missing_item_reports',
    'notification_delivery_attempts',
    'notification_preferences',
    'notifications',
    'order_item_photos',
    'order_items',
    'order_otps',
    'order_qr_codes',
    'order_status_history',
    'orders',
    'package_service_limits',
    'package_services',
    'package_subscriptions',
    'package_usage',
    'packages',
    'payment_orders',
    'payment_transactions',
    'payment_webhook_events',
    'permissions',
    'processing_batch_orders',
    'profile_roles',
    'profiles',
    'push_devices',
    'qr_scan_logs',
    'referral_codes',
    'referrals',
    'refund_requests',
    'role_permissions',
    'roles',
    'route_batch_stops',
    'route_batches',
    'security_events',
    'service_categories',
    'service_prices',
    'services',
    'system_configurations',
    'vehicles'
  ];

  console.log('\n--- [10] Row Counts Across All 58 System Tables ---');
  for (const tbl of tablesToCheck) {
    const { count, error } = await supabase
      .from(tbl)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${tbl}: ERROR (${error.message})`);
    } else {
      console.log(`  ${tbl}: ${count}`);
    }
  }
}

runAudit().catch(console.error);
