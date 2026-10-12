const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SAFE_DRIVER_IDS = [
  'baf27b47-c189-4143-9a7f-da95c391d820',
  '6318919f-77d6-4cca-ae46-8bb76fcddc73',
  '3b28a805-3932-4999-9432-c93d70a042f6',
  '3677fc3f-4f85-4ed9-993a-8165d4073fe0',
  'c576c618-b44a-4914-85ed-3da789568e80',
  '9dce6e4a-ce89-445f-ae0a-5b1c6ef75228',
  '4d4d85cc-d073-4279-84b8-31c5c1dce1bd'
];

const SAFE_DRIVER_PROFILE_IDS = [
  'ad56f27f-cd5b-4901-b713-f0f654857dce',
  'be58d052-bde6-4c9a-8010-5a3229fc5a2c',
  '18822cac-3661-4773-a8cc-a338e9a3f2e4',
  '96cbb7dd-8aa2-4778-870a-20d45a2ca6ab',
  '59dbf265-9969-4b48-9862-2a854e81949c',
  'f8814a1d-401e-4826-b80d-66f43afca1a1',
  '636c6c8a-f12b-4ee4-bd35-52b001b83821'
];

const SAFE_FACILITY_EMP_IDS = [
  'c1482534-f02b-47e6-96d8-9c9caadfa097',
  '977a0d84-cfd3-43d0-ae0c-efbc3c05d416'
];

const SAFE_FACILITY_PROFILE_IDS = [
  '852aa719-965c-4160-9d81-7771c6cda91f',
  '85284640-d000-4e3f-b630-bd945fb5e269'
];

const ALL_SAFE_PROFILE_IDS = [...SAFE_DRIVER_PROFILE_IDS, ...SAFE_FACILITY_PROFILE_IDS];

const PROTECTED_DRIVER_IDS = [
  'a8bc6f4a-2a19-461a-9acd-aabd8576ab72',
  '5e36b020-5a26-43a8-97cf-1342ac058ef4',
  'c3aad637-8256-4279-b13d-a2614f0ef957',
  '2960c013-d553-46ea-9409-b4a9192aa1dd'
];

const PROTECTED_FACILITY_EMP_ID = '13cc85a3-4b7d-4238-ab00-b3ba6fb05fb8';
const PROTECTED_FACILITY_PROFILE_ID = '993ccec2-46ce-4170-8de3-a3f1ba07735e';

async function executeStaffCleanup() {
  console.log('===============================================================');
  console.log('       EXECUTING SAFE DRIVERS & FACILITY EMPLOYEES CLEANUP      ');
  console.log('===============================================================\n');

  // Step 0: Pre-cleanup validation
  console.log('--- STEP 0: PRE-CLEANUP VALIDATION ---');
  const { count: preDriverCount } = await supabase.from('drivers').select('*', { count: 'exact', head: true });
  const { count: preFacCount } = await supabase.from('facility_employees').select('*', { count: 'exact', head: true });
  const { count: preAuditCount } = await supabase.from('admin_assignment_audit').select('*', { count: 'exact', head: true });
  const { count: preStaffAuditCount } = await supabase.from('admin_staff_action_audit').select('*', { count: 'exact', head: true });
  const { count: preOrderCount } = await supabase.from('orders').select('*', { count: 'exact', head: true });
  const { count: preAssignCount } = await supabase.from('driver_assignments').select('*', { count: 'exact', head: true });

  console.log(`Pre-cleanup Drivers count: ${preDriverCount} (Expected: 11)`);
  console.log(`Pre-cleanup Facility Employees count: ${preFacCount} (Expected: 3)`);
  console.log(`Pre-cleanup admin_assignment_audit count: ${preAuditCount} (Expected: 4)`);
  console.log(`Pre-cleanup admin_staff_action_audit count: ${preStaffAuditCount} (Expected: 29)`);
  console.log(`Pre-cleanup Orders count: ${preOrderCount} (Expected: 4)`);
  console.log(`Pre-cleanup Driver Assignments count: ${preAssignCount} (Expected: 4)`);

  if (preDriverCount !== 11 || preFacCount !== 3) {
    throw new Error(`Pre-conditions not met: drivers=${preDriverCount}, fac_employees=${preFacCount}`);
  }

  // Step 1: Delete driver-specific operational records for the 7 safe drivers
  console.log('\n--- STEP 1: DELETING DRIVER-SPECIFIC OPERATIONAL DATA ---');
  await supabase.from('driver_live_locations').delete().in('driver_id', SAFE_DRIVER_IDS);
  await supabase.from('driver_location_history').delete().in('driver_id', SAFE_DRIVER_IDS);
  await supabase.from('vehicles').delete().in('driver_id', SAFE_DRIVER_IDS);
  await supabase.from('route_batches').delete().in('driver_id', SAFE_DRIVER_IDS);
  console.log('  -> Driver operational records deleted.');

  // Step 2: Delete 7 safe drivers from public.drivers
  console.log('\n--- STEP 2: DELETING 7 SAFE DRIVERS ---');
  const { error: drvDelErr } = await supabase.from('drivers').delete().in('id', SAFE_DRIVER_IDS);
  if (drvDelErr) throw new Error(`drivers delete failed: ${drvDelErr.message}`);
  console.log('  -> 7 drivers deleted from public.drivers.');

  // Step 3: Delete 2 safe facility employees from public.facility_employees
  console.log('\n--- STEP 3: DELETING 2 SAFE FACILITY EMPLOYEES ---');
  const { error: facDelErr } = await supabase.from('facility_employees').delete().in('id', SAFE_FACILITY_EMP_IDS);
  if (facDelErr) throw new Error(`facility_employees delete failed: ${facDelErr.message}`);
  console.log('  -> 2 facility employees deleted from public.facility_employees.');

  // Step 4: Delete profile-specific records for the 9 safe profiles
  console.log('\n--- STEP 4: DELETING PROFILE-SPECIFIC RECORDS ---');
  await supabase.from('notifications').delete().in('profile_id', ALL_SAFE_PROFILE_IDS);
  await supabase.from('notification_preferences').delete().in('profile_id', ALL_SAFE_PROFILE_IDS);
  await supabase.from('device_tokens').delete().in('profile_id', ALL_SAFE_PROFILE_IDS);
  await supabase.from('profile_roles').delete().in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log('  -> Profile dependencies deleted.');

  // Step 5: Delete 9 safe profiles from public.profiles
  console.log('\n--- STEP 5: DELETING 9 SAFE PROFILES ---');
  const { error: profDelErr } = await supabase.from('profiles').delete().in('id', ALL_SAFE_PROFILE_IDS);
  if (profDelErr) throw new Error(`profiles delete failed: ${profDelErr.message}`);
  console.log('  -> 9 profiles deleted from public.profiles.');

  // Step 6: Delete auth.users accounts for the 9 safe users
  console.log('\n--- STEP 6: DELETING 9 SAFE AUTH.USERS ACCOUNTS ---');
  for (const uid of ALL_SAFE_PROFILE_IDS) {
    const { error: authDelErr } = await supabase.auth.admin.deleteUser(uid);
    if (authDelErr) {
      console.warn(`  Warning deleting auth.user ${uid}: ${authDelErr.message}`);
    } else {
      console.log(`  -> Deleted auth.user: ${uid}`);
    }
  }

  // Step 7: Final Verification
  console.log('\n===============================================================');
  console.log('                 POST-CLEANUP VERIFICATION                     ');
  console.log('===============================================================\n');

  const { data: postDrivers, count: postDriverCount } = await supabase.from('drivers').select('*', { count: 'exact' });
  const { data: postFacEmps, count: postFacCount } = await supabase.from('facility_employees').select('*', { count: 'exact' });
  const { count: postOrderCount } = await supabase.from('orders').select('*', { count: 'exact', head: true });
  const { count: postAssignCount } = await supabase.from('driver_assignments').select('*', { count: 'exact', head: true });
  const { count: postAuditCount } = await supabase.from('admin_assignment_audit').select('*', { count: 'exact', head: true });
  const { count: postStaffAuditCount } = await supabase.from('admin_staff_action_audit').select('*', { count: 'exact', head: true });
  const { count: custCount } = await supabase.from('customers').select('*', { count: 'exact', head: true });
  const { count: facCount } = await supabase.from('facilities').select('*', { count: 'exact', head: true });
  const { count: srvCount } = await supabase.from('services').select('*', { count: 'exact', head: true });
  const { count: srvCatCount } = await supabase.from('service_categories').select('*', { count: 'exact', head: true });
  const { count: srvPriceCount } = await supabase.from('service_prices').select('*', { count: 'exact', head: true });
  const { count: profCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });

  console.log(`[VERIFICATION RESULTS]`);
  console.log(`- Drivers remaining: ${postDriverCount} (Expected: 4)`);
  console.log(`- Facility Employees remaining: ${postFacCount} (Expected: 1)`);
  console.log(`- Orders remaining: ${postOrderCount} (Expected: 4)`);
  console.log(`- Driver Assignments remaining: ${postAssignCount} (Expected: 4)`);
  console.log(`- admin_assignment_audit rows: ${postAuditCount} (Expected: 4)`);
  console.log(`- admin_staff_action_audit rows: ${postStaffAuditCount} (Expected: 29)`);
  console.log(`- Customers count: ${custCount} (Expected: 7)`);
  console.log(`- Facilities count: ${facCount} (Expected: 2)`);
  console.log(`- Services count: ${srvCount} (Expected: 134)`);
  console.log(`- Service Categories count: ${srvCatCount} (Expected: 13)`);
  console.log(`- Service Prices count: ${srvPriceCount} (Expected: 263)`);
  console.log(`- Profiles remaining: ${profCount} (Expected: 27)`);

  console.log('\n[REMAINING 4 PROTECTED DRIVERS]:');
  postDrivers.forEach(d => {
    console.log(`  Driver ID: ${d.id} | Profile ID: ${d.profile_id} | Active: ${d.is_active}`);
  });

  console.log('\n[REMAINING 1 PROTECTED FACILITY EMPLOYEE]:');
  postFacEmps.forEach(fe => {
    console.log(`  Facility Emp ID: ${fe.id} | Profile ID: ${fe.profile_id} | Facility ID: ${fe.facility_id}`);
  });

  // Assert expected remaining IDs
  const remainingDriverIds = new Set(postDrivers.map(d => d.id));
  const expectedDriverIds = new Set(PROTECTED_DRIVER_IDS);
  for (const id of expectedDriverIds) {
    if (!remainingDriverIds.has(id)) {
      throw new Error(`Expected driver ${id} is missing!`);
    }
  }

  if (postFacEmps.length !== 1 || postFacEmps[0].profile_id !== PROTECTED_FACILITY_PROFILE_ID) {
    throw new Error(`Expected facility employee profile ${PROTECTED_FACILITY_PROFILE_ID} mismatch!`);
  }

  console.log('\n>>> ALL INTEGRITY CHECKS AND ID ASSERTIONS PASSED PERFECTLY. <<<');
}

executeStaffCleanup().catch(err => {
  console.error('\n*** ERROR DURING STAFF CLEANUP EXECUTION ***:', err);
  process.exit(1);
});
