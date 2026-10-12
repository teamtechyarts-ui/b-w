const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PROTECTED_ORDER_IDS = [
  '63441735-a88e-43de-b958-06c7a32d8353',
  '8ec5ebd1-6079-420d-8320-c91481005dfd',
  '3a467513-a2a3-4bf3-814c-f8f67b4a93d2',
  '19a3202c-513a-4311-851b-08a2e86fa10d'
];

const PROTECTED_ASSIGNMENT_IDS = [
  'c4a1e322-4a88-42bd-8401-1bdd25d33eb6',
  '76cbe490-3c46-473b-b854-59893f97b0fb',
  'f4fb73f6-3a85-4431-b196-e4bb75c64a92',
  '5175982e-ccc0-4885-94c3-75592a623e6e'
];

async function executeOrderCleanup() {
  console.log('===============================================================');
  console.log('       EXECUTING CONTROLLED NON-PROTECTED ORDERS CLEANUP       ');
  console.log('===============================================================\n');

  // Step 0: Pre-cleanup validation
  console.log('--- STEP 0: PRE-CLEANUP VALIDATION ---');
  const { data: preOrders, error: preOrdErr } = await supabase.from('orders').select('id');
  if (preOrdErr) throw preOrdErr;
  console.log(`Current Total Orders: ${preOrders.length}`);

  const { data: preAssigns, error: preAssErr } = await supabase.from('driver_assignments').select('id');
  if (preAssErr) throw preAssErr;
  console.log(`Current Total Driver Assignments: ${preAssigns.length}`);

  const { data: preAudits, error: preAudErr } = await supabase.from('admin_assignment_audit').select('*');
  if (preAudErr) throw preAudErr;
  console.log(`Current admin_assignment_audit rows: ${preAudits.length}`);

  if (preOrders.length !== 42) {
    console.warn(`WARNING: Expected 42 orders before cleanup, found ${preOrders.length}`);
  }

  const protectedSet = new Set(PROTECTED_ORDER_IDS);
  const deletableOrderIds = preOrders.filter(o => !protectedSet.has(o.id)).map(o => o.id);
  console.log(`Identified ${deletableOrderIds.length} deletable order IDs.`);

  if (deletableOrderIds.length !== 38) {
    throw new Error(`Expected exactly 38 deletable orders, found ${deletableOrderIds.length}`);
  }

  const protAssignSet = new Set(PROTECTED_ASSIGNMENT_IDS);
  const deletableAssignIds = preAssigns.filter(a => !protAssignSet.has(a.id)).map(a => a.id);
  console.log(`Identified ${deletableAssignIds.length} deletable assignment IDs.`);

  // Step 1: Delete non-cascading child records
  console.log('\n--- STEP 1: DELETING NON-CASCADING CHILD RECORDS ---');
  
  // A. driver_navigation_events (ON DELETE NO ACTION)
  console.log('Deleting driver_navigation_events for deletable orders...');
  const { error: navErr } = await supabase
    .from('driver_navigation_events')
    .delete()
    .in('order_id', deletableOrderIds);
  if (navErr) throw new Error(`driver_navigation_events delete failed: ${navErr.message}`);
  console.log('  -> driver_navigation_events cleaned.');

  // B. driver_trip_locations for deletable assignments
  console.log('Deleting driver_trip_locations for deletable assignments...');
  if (deletableAssignIds.length > 0) {
    const { error: tripErr } = await supabase
      .from('driver_trip_locations')
      .delete()
      .in('assignment_id', deletableAssignIds);
    if (tripErr) throw new Error(`driver_trip_locations delete failed: ${tripErr.message}`);
  }
  console.log('  -> driver_trip_locations cleaned.');

  // C. delivery_proofs for deletable orders
  console.log('Deleting delivery_proofs for deletable orders...');
  const { error: proofErr } = await supabase
    .from('delivery_proofs')
    .delete()
    .in('order_id', deletableOrderIds);
  if (proofErr) throw new Error(`delivery_proofs delete failed: ${proofErr.message}`);
  console.log('  -> delivery_proofs cleaned.');

  // D. route_batch_stops for deletable assignments
  console.log('Deleting route_batch_stops for deletable assignments...');
  if (deletableAssignIds.length > 0) {
    const { error: rbsErr } = await supabase
      .from('route_batch_stops')
      .delete()
      .in('assignment_id', deletableAssignIds);
    if (rbsErr) throw new Error(`route_batch_stops delete failed: ${rbsErr.message}`);
  }
  console.log('  -> route_batch_stops cleaned.');

  // E. Nullify notifications order_id
  console.log('Nullifying order_id in notifications for deletable orders...');
  const { error: notifErr } = await supabase
    .from('notifications')
    .update({ order_id: null })
    .in('order_id', deletableOrderIds);
  if (notifErr) throw new Error(`notifications nullify failed: ${notifErr.message}`);
  console.log('  -> notifications updated.');

  // Step 2: Delete 36 non-protected driver assignments
  console.log('\n--- STEP 2: DELETING NON-PROTECTED DRIVER ASSIGNMENTS ---');
  const { error: assDelErr } = await supabase
    .from('driver_assignments')
    .delete()
    .in('id', deletableAssignIds);
  if (assDelErr) throw new Error(`driver_assignments delete failed: ${assDelErr.message}`);
  console.log(`  -> ${deletableAssignIds.length} driver_assignments deleted.`);

  // Step 3: Delete 38 non-protected orders
  console.log('\n--- STEP 3: DELETING 38 NON-PROTECTED ORDERS ---');
  const { error: ordDelErr } = await supabase
    .from('orders')
    .delete()
    .in('id', deletableOrderIds);
  if (ordDelErr) throw new Error(`orders delete failed: ${ordDelErr.message}`);
  console.log(`  -> ${deletableOrderIds.length} orders deleted.`);

  // Step 4: Verification
  console.log('\n===============================================================');
  console.log('                 POST-CLEANUP VERIFICATION                     ');
  console.log('===============================================================\n');

  const { data: postOrders, count: postOrderCount } = await supabase.from('orders').select('*', { count: 'exact' });
  const { data: postAssigns, count: postAssignCount } = await supabase.from('driver_assignments').select('*', { count: 'exact' });
  const { data: postAudits, count: postAuditCount } = await supabase.from('admin_assignment_audit').select('*', { count: 'exact' });
  const { count: custCount } = await supabase.from('customers').select('*', { count: 'exact', head: true });
  const { count: facCount } = await supabase.from('facilities').select('*', { count: 'exact', head: true });
  const { count: srvCount } = await supabase.from('services').select('*', { count: 'exact', head: true });
  const { count: srvCatCount } = await supabase.from('service_categories').select('*', { count: 'exact', head: true });
  const { count: srvPriceCount } = await supabase.from('service_prices').select('*', { count: 'exact', head: true });
  const { count: drvCount } = await supabase.from('drivers').select('*', { count: 'exact', head: true });
  const { count: facEmpCount } = await supabase.from('facility_employees').select('*', { count: 'exact', head: true });
  const { count: profCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });

  console.log(`[VERIFICATION RESULTS]`);
  console.log(`- Orders remaining: ${postOrderCount} (Expected: 4)`);
  console.log(`- Driver Assignments remaining: ${postAssignCount} (Expected: 4)`);
  console.log(`- admin_assignment_audit rows: ${postAuditCount} (Expected: 4)`);
  console.log(`- Customers count: ${custCount} (Expected: 7)`);
  console.log(`- Facilities count: ${facCount} (Expected: 2)`);
  console.log(`- Services count: ${srvCount} (Expected: 134)`);
  console.log(`- Service Categories count: ${srvCatCount} (Expected: 13)`);
  console.log(`- Service Prices count: ${srvPriceCount} (Expected: 263)`);
  console.log(`- Drivers count: ${drvCount} (Expected: 11, unchanged)`);
  console.log(`- Facility Employees count: ${facEmpCount} (Expected: 3, unchanged)`);
  console.log(`- Profiles count: ${profCount} (Expected: 36, unchanged)`);

  console.log('\n[REMAINING 4 PROTECTED ORDERS]:');
  postOrders.forEach(o => {
    console.log(`  Order ID: ${o.id} | ${o.order_number} | Status: ${o.current_status}`);
  });

  console.log('\n[REMAINING 4 PROTECTED DRIVER ASSIGNMENTS]:');
  postAssigns.forEach(a => {
    console.log(`  Assignment ID: ${a.id} | Order ID: ${a.order_id} | Driver ID: ${a.driver_id} | Status: ${a.status}`);
  });
}

executeOrderCleanup().catch(err => {
  console.error('\n*** ERROR DURING CLEANUP EXECUTION ***:', err);
  process.exit(1);
});
