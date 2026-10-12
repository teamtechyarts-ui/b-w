const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function generateComprehensiveReport() {
  console.log('Generating comprehensive forensic audit data...');

  // 1. All FKs in the database schema
  const schemaSql = fs.readFileSync('current_schema.sql', 'utf8');
  
  // Find all migrations to see any additional tables or constraints not in current_schema.sql
  const migrationFiles = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'));
  let allMigrationsSql = '';
  migrationFiles.forEach(f => {
    allMigrationsSql += fs.readFileSync(`supabase/migrations/${f}`, 'utf8') + '\n';
  });

  // Query live DB tables
  const { data: adminAssignments } = await supabase.from('admin_assignment_audit').select('*');
  const { data: staffAudits } = await supabase.from('admin_staff_action_audit').select('*');
  const { data: catalogueAudits } = await supabase.from('admin_catalogue_audit').select('*');
  const { data: growthAudits } = await supabase.from('admin_growth_audit').select('*');
  const { data: orders } = await supabase.from('orders').select('*');
  const { data: assignments } = await supabase.from('driver_assignments').select('*');
  const { data: drivers } = await supabase.from('drivers').select('*');
  const { data: facilityEmployees } = await supabase.from('facility_employees').select('*');
  const { data: profiles } = await supabase.from('profiles').select('*');
  const { data: profileRoles } = await supabase.from('profile_roles').select('*, roles(*)');
  const { data: customers } = await supabase.from('customers').select('*');
  const { data: facilities } = await supabase.from('facilities').select('*');

  // Protected IDs calculation
  const protectedAssignmentIds = new Set();
  const protectedOrderIds = new Set();
  const protectedDriverIds = new Set();
  const protectedStaffProfileIds = new Set();

  // From admin_assignment_audit
  adminAssignments.forEach(a => {
    if (a.new_assignment_id) protectedAssignmentIds.add(a.new_assignment_id);
    if (a.previous_assignment_id) protectedAssignmentIds.add(a.previous_assignment_id);
    if (a.order_id) protectedOrderIds.add(a.order_id);
  });

  assignments.forEach(assign => {
    if (protectedAssignmentIds.has(assign.id)) {
      if (assign.order_id) protectedOrderIds.add(assign.order_id);
      if (assign.driver_id) protectedDriverIds.add(assign.driver_id);
    }
  });

  // From admin_staff_action_audit
  staffAudits.forEach(s => {
    if (s.actor_profile_id) protectedStaffProfileIds.add(s.actor_profile_id);
    if (s.target_profile_id) protectedStaffProfileIds.add(s.target_profile_id);
  });

  console.log('Protected Assignments:', [...protectedAssignmentIds]);
  console.log('Protected Orders:', [...protectedOrderIds]);
  console.log('Protected Drivers:', [...protectedDriverIds]);
  console.log('Protected Profiles by Staff Audit:', [...protectedStaffProfileIds]);

  return {
    protectedAssignmentIds: [...protectedAssignmentIds],
    protectedOrderIds: [...protectedOrderIds],
    protectedDriverIds: [...protectedDriverIds],
    protectedStaffProfileIds: [...protectedStaffProfileIds],
    counts: {
      orders: orders.length,
      assignments: assignments.length,
      drivers: drivers.length,
      facilityEmployees: facilityEmployees.length,
      profiles: profiles.length,
      customers: customers.length,
      facilities: facilities.length,
      adminAssignments: adminAssignments.length,
      staffAudits: staffAudits.length,
      catalogueAudits: catalogueAudits.length,
      growthAudits: growthAudits.length
    }
  };
}

generateComprehensiveReport().then(res => console.log('Result Summary:', res)).catch(console.error);
