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

async function verifyDeletable() {
  const { data: allOrders } = await supabase.from('orders').select('id, order_number, current_status, customer_id, facility_id, created_at');
  
  const protectedSet = new Set(PROTECTED_ORDER_IDS);
  const deletableOrders = allOrders.filter(o => !protectedSet.has(o.id));
  const protectedOrders = allOrders.filter(o => protectedSet.has(o.id));

  console.log(`TOTAL ORDERS IN DB: ${allOrders.length}`);
  console.log(`PROTECTED ORDERS (${protectedOrders.length}):`);
  protectedOrders.forEach(o => console.log(`  ${o.id} | ${o.order_number} | status: ${o.current_status}`));

  console.log(`\nDELETABLE ORDERS (${deletableOrders.length}):`);
  deletableOrders.forEach((o, i) => console.log(`  ${i+1}. ${o.id} | ${o.order_number} | status: ${o.current_status}`));

  const deletableOrderIds = deletableOrders.map(o => o.id);

  // Check assignments
  const { data: allAssignments } = await supabase.from('driver_assignments').select('*');
  const protAssignSet = new Set(PROTECTED_ASSIGNMENT_IDS);
  const deletableAssignments = allAssignments.filter(a => !protAssignSet.has(a.id));
  const protectedAssignments = allAssignments.filter(a => protAssignSet.has(a.id));

  console.log(`\nTOTAL DRIVER ASSIGNMENTS: ${allAssignments.length}`);
  console.log(`PROTECTED ASSIGNMENTS (${protectedAssignments.length}):`);
  protectedAssignments.forEach(a => console.log(`  ${a.id} -> order: ${a.order_id}, driver: ${a.driver_id}`));

  console.log(`DELETABLE ASSIGNMENTS (${deletableAssignments.length}):`);
  console.log(`  Count of deletable assignments: ${deletableAssignments.length}`);

  // Check dependent child counts for deletable orders
  console.log('\n--- CHILD RECORDS FOR DELETABLE ORDERS ---');
  
  // driver_navigation_events
  const { data: navEvents } = await supabase.from('driver_navigation_events').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`driver_navigation_events on deletable orders: ${navEvents ? navEvents.length : 0}`);

  // driver_trip_locations
  const deletableAssignIds = deletableAssignments.map(a => a.id);
  const { data: tripLocs } = await supabase.from('driver_trip_locations').select('id, assignment_id').in('assignment_id', deletableAssignIds);
  console.log(`driver_trip_locations on deletable assignments: ${tripLocs ? tripLocs.length : 0}`);

  // delivery_proofs
  const { data: proofs } = await supabase.from('delivery_proofs').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`delivery_proofs on deletable orders: ${proofs ? proofs.length : 0}`);

  // garment_inspections
  const { data: inspections } = await supabase.from('garment_inspections').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`garment_inspections on deletable orders: ${inspections ? inspections.length : 0}`);

  // payment_orders
  const { data: payOrders } = await supabase.from('payment_orders').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`payment_orders on deletable orders: ${payOrders ? payOrders.length : 0}`);

  // order_items
  const { data: items } = await supabase.from('order_items').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`order_items on deletable orders: ${items ? items.length : 0}`);

  // order_status_history
  const { data: hist } = await supabase.from('order_status_history').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`order_status_history on deletable orders: ${hist ? hist.length : 0}`);

  // facility_order_operations
  const { data: ops } = await supabase.from('facility_order_operations').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`facility_order_operations on deletable orders: ${ops ? ops.length : 0}`);

  // order_qr_codes
  const { data: qrs } = await supabase.from('order_qr_codes').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`order_qr_codes on deletable orders: ${qrs ? qrs.length : 0}`);

  // order_otps
  const { data: otps } = await supabase.from('order_otps').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`order_otps on deletable orders: ${otps ? otps.length : 0}`);

  // notifications
  const { data: notifs } = await supabase.from('notifications').select('id, order_id').in('order_id', deletableOrderIds);
  console.log(`notifications referencing deletable orders: ${notifs ? notifs.length : 0}`);
}

verifyDeletable().catch(console.error);
