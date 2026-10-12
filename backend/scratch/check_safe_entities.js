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

async function checkSafeEntitiesDependencies() {
  console.log('=== CHECKING DRIVER-SPECIFIC TABLES ===');
  
  // 1. driver_assignments
  const { data: assDrv } = await supabase.from('driver_assignments').select('*').in('driver_id', SAFE_DRIVER_IDS);
  console.log(`driver_assignments linked to 7 safe drivers: ${assDrv ? assDrv.length : 0}`);

  // 2. driver_live_locations
  const { data: liveLoc } = await supabase.from('driver_live_locations').select('*').in('driver_id', SAFE_DRIVER_IDS);
  console.log(`driver_live_locations linked to 7 safe drivers: ${liveLoc ? liveLoc.length : 0}`);

  // 3. driver_location_history
  const { data: locHist } = await supabase.from('driver_location_history').select('*').in('driver_id', SAFE_DRIVER_IDS);
  console.log(`driver_location_history linked to 7 safe drivers: ${locHist ? locHist.length : 0}`);

  // 4. vehicles
  const { data: veh } = await supabase.from('vehicles').select('*').in('driver_id', SAFE_DRIVER_IDS);
  console.log(`vehicles linked to 7 safe drivers: ${veh ? veh.length : 0}`);

  // 5. route_batches
  const { data: rb } = await supabase.from('route_batches').select('*').in('driver_id', SAFE_DRIVER_IDS);
  console.log(`route_batches linked to 7 safe drivers: ${rb ? rb.length : 0}`);

  console.log('\n=== CHECKING PROFILE-SPECIFIC TABLES FOR THE 9 SAFE PROFILES ===');

  // 6. notifications
  const { data: notifs } = await supabase.from('notifications').select('id, profile_id').in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`notifications linked to 9 safe profiles: ${notifs ? notifs.length : 0}`);

  // 7. notification_preferences
  const { data: notifPrefs } = await supabase.from('notification_preferences').select('id, profile_id').in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`notification_preferences linked to 9 safe profiles: ${notifPrefs ? notifPrefs.length : 0}`);

  // 8. device_tokens
  const { data: devTokens } = await supabase.from('device_tokens').select('id, profile_id').in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`device_tokens linked to 9 safe profiles: ${devTokens ? devTokens.length : 0}`);

  // 9. push_devices
  // Check if push_devices table exists/is queryable
  const { data: pushDev, error: pushErr } = await supabase.from('push_devices').select('*').in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`push_devices linked to 9 safe profiles: ${pushDev ? pushDev.length : (pushErr ? pushErr.message : 0)}`);

  // 10. profile_roles
  const { data: profRoles } = await supabase.from('profile_roles').select('*').in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`profile_roles linked to 9 safe profiles: ${profRoles ? profRoles.length : 0}`);

  // 11. customers
  const { data: custs } = await supabase.from('customers').select('*').in('profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`customers linked to 9 safe profiles (must be 0): ${custs ? custs.length : 0}`);

  // 12. admin_assignment_audit (actor_profile_id)
  const { data: audActor } = await supabase.from('admin_assignment_audit').select('*').in('actor_profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`admin_assignment_audit actor linked to 9 safe profiles (must be 0): ${audActor ? audActor.length : 0}`);

  // 13. admin_staff_action_audit (actor_profile_id or target_profile_id)
  const { data: staffActor } = await supabase.from('admin_staff_action_audit').select('*').in('actor_profile_id', ALL_SAFE_PROFILE_IDS);
  const { data: staffTarget } = await supabase.from('admin_staff_action_audit').select('*').in('target_profile_id', ALL_SAFE_PROFILE_IDS);
  console.log(`admin_staff_action_audit actor linked to 9 safe profiles (must be 0): ${staffActor ? staffActor.length : 0}`);
  console.log(`admin_staff_action_audit target linked to 9 safe profiles (must be 0): ${staffTarget ? staffTarget.length : 0}`);

  // 14. check auth.users via Supabase Auth Admin API
  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
  if (usersErr) {
    console.error('Error listing auth.users:', usersErr.message);
  } else {
    const safeSet = new Set(ALL_SAFE_PROFILE_IDS);
    const matchedUsers = usersData.users.filter(u => safeSet.has(u.id));
    console.log(`\nauth.users matched for the 9 safe profiles: ${matchedUsers.length}`);
    matchedUsers.forEach(u => console.log(`  User: ${u.id} | Email: ${u.email}`));
  }
}

checkSafeEntitiesDependencies().catch(console.error);
