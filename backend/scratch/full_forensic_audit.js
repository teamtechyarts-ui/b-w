const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fullForensicAudit() {
  console.log('--- 1. AUDIT PROFILES AND LINKED ROLES/ENTITIES ---');
  const { data: profiles } = await supabase.from('profiles').select('*');
  const { data: profileRoles } = await supabase.from('profile_roles').select('profile_id, role_id, roles(name)');
  const { data: customers } = await supabase.from('customers').select('*');
  const { data: drivers } = await supabase.from('drivers').select('*');
  const { data: facilityEmployees } = await supabase.from('facility_employees').select('*');
  const { data: audits } = await supabase.from('admin_assignment_audit').select('*');

  const customerProfileIds = new Set(customers.map(c => c.profile_id));
  const driverProfileIds = new Set(drivers.map(d => d.profile_id));
  const facilityProfileIds = new Set(facilityEmployees.map(f => f.profile_id));
  const auditActorProfileIds = new Set(audits.map(a => a.actor_profile_id));

  console.log(`Total Profiles: ${profiles.length}`);
  console.log(`Total Customers: ${customers.length}`);
  console.log(`Total Drivers: ${drivers.length}`);
  console.log(`Total Facility Employees: ${facilityEmployees.length}`);

  const profileSummary = profiles.map(p => {
    const roles = (profileRoles || []).filter(pr => pr.profile_id === p.id).map(pr => pr.roles?.name);
    const isCust = customerProfileIds.has(p.id);
    const isDrv = driverProfileIds.has(p.id);
    const isFac = facilityProfileIds.has(p.id);
    const isAuditActor = auditActorProfileIds.has(p.id);
    return {
      id: p.id,
      name: p.full_name,
      phone: p.phone,
      roles: roles.join(', ') || 'NO_ROLE_ROW',
      isCustomer: isCust,
      isDriver: isDrv,
      isFacilityEmp: isFac,
      isAuditActor: isAuditActor
    };
  });

  console.table(profileSummary);

  console.log('\n--- 2. AUDIT ALL 42 ORDERS ---');
  const { data: orders } = await supabase.from('orders').select('id, order_number, customer_id, facility_id, current_status, created_at');
  
  const protectedOrderIds = new Set(audits.map(a => a.order_id));
  const orderList = orders.map(o => ({
    id: o.id,
    order_number: o.order_number,
    status: o.current_status,
    isProtected: protectedOrderIds.has(o.id)
  }));
  console.table(orderList);

  console.log('\n--- 3. AUDIT ALL 11 DRIVERS ---');
  // Find which drivers are linked to protected assignments
  const protectedAssignmentIds = new Set(audits.map(a => a.new_assignment_id).concat(audits.map(a => a.previous_assignment_id)).filter(Boolean));
  const { data: protectedAssignments } = await supabase.from('driver_assignments').select('*').in('id', [...protectedAssignmentIds]);
  const protectedDriverIds = new Set(protectedAssignments.map(a => a.driver_id));

  const driverList = drivers.map(d => ({
    id: d.id,
    profile_id: d.profile_id,
    is_active: d.is_active,
    isProtected: protectedDriverIds.has(d.id)
  }));
  console.table(driverList);

  console.log('\n--- 4. AUDIT ALL 3 FACILITY EMPLOYEES ---');
  const facList = facilityEmployees.map(f => ({
    id: f.id,
    profile_id: f.profile_id,
    facility_id: f.facility_id,
    is_active: f.is_active
  }));
  console.table(facList);
}

fullForensicAudit().catch(console.error);
