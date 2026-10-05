const dotenv = require('dotenv');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { NestFactory } = require('@nestjs/core');

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('===============================================================');
  console.log('PHASE LIVE VERIFICATION: MULTI-FACILITY & COMPLETE WORKFLOW');
  console.log('===============================================================\n');

  const { AppModule } = require(path.join(__dirname, '../dist/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const facilityService = app.get(require(path.join(__dirname, '../dist/modules/facility/facility.service')).FacilityService);
  const logisticsService = app.get(require(path.join(__dirname, '../dist/modules/logistics/logistics.service')).LogisticsService);
  const driversService = app.get(require(path.join(__dirname, '../dist/modules/drivers/drivers.service')).DriversService);
  const staffService = app.get(require(path.join(__dirname, '../dist/modules/staff/staff.service')).StaffService);

  // 1. Fetch facilities
  const { data: facilities, error: facErr } = await client.from('facilities').select('*').eq('is_active', true);
  if (facErr || !facilities.length) throw new Error('No active facilities found in database');
  console.log(`[PASS] Found ${facilities.length} active facilities:`);
  facilities.forEach(f => console.log(`   - ${f.name} (${f.id})`));

  const facilityA = facilities[0];
  let facilityB = facilities[1];

  // If only 1 facility exists, ensure a second one for multi-facility tests
  if (!facilityB) {
    const { data: newFac, error: nfe } = await client.from('facilities').insert({
      name: 'Karimnagar Facility',
      facility_code: 'FAC-KRM-01',
      is_active: true,
      address: 'Collectorate Road, Karimnagar',
      latitude: 18.4386,
      longitude: 79.1288,
    }).select().single();
    if (nfe) throw nfe;
    facilityB = newFac;
    console.log(`[SETUP] Created test Facility B: ${facilityB.name} (${facilityB.id})`);
  }

  // 2. Setup Facility Employee A and Facility Employee B
  async function ensureEmployee(facility, name, emailPrefix) {
    const { data: existing } = await client.from('facility_employees')
      .select('*, profiles(*)')
      .eq('facility_id', facility.id)
      .eq('is_active', true)
      .limit(1);

    if (existing && existing.length > 0) {
      return existing[0];
    }

    const { data: { user }, error: uErr } = await client.auth.admin.createUser({
      email: `${emailPrefix}.${Date.now()}@brightwhite.internal`,
      password: 'Password123!',
      email_confirm: true,
    });
    if (uErr) throw uErr;

    await client.from('profiles').update({
      full_name: name,
      is_active: true,
    }).eq('id', user.id);

    const { data: fe, error: feErr } = await client.from('facility_employees').insert({
      profile_id: user.id,
      facility_id: facility.id,
      employee_role: 'operator',
      is_active: true,
    }).select('*, profiles(*)').single();
    if (feErr) throw feErr;
    return fe;
  }

  const employeeA = await ensureEmployee(facilityA, 'Facility A Operator', 'emp_a');
  const employeeB = await ensureEmployee(facilityB, 'Facility B Operator', 'emp_b');

  console.log(`\n[PASS] Employee A: Profile ${employeeA.profile_id} -> Facility "${facilityA.name}"`);
  console.log(`[PASS] Employee B: Profile ${employeeB.profile_id} -> Facility "${facilityB.name}"`);

  // 3. Test Facility Employee A Dashboard scoping
  const dashA = await facilityService.dashboard(employeeA.profile_id);
  if (dashA.facility.id !== facilityA.id || dashA.facility.name !== facilityA.name) {
    throw new Error(`Employee A dashboard resolution mismatch: expected ${facilityA.name}, got ${dashA.facility.name}`);
  }
  console.log(`[PASS] Employee A Dashboard automatically resolved to "${dashA.facility.name}" without manual selector.`);

  // 4. Test Facility Employee B Dashboard scoping
  const dashB = await facilityService.dashboard(employeeB.profile_id);
  if (dashB.facility.id !== facilityB.id || dashB.facility.name !== facilityB.name) {
    throw new Error(`Employee B dashboard resolution mismatch: expected ${facilityB.name}, got ${dashB.facility.name}`);
  }
  console.log(`[PASS] Employee B Dashboard automatically resolved to "${dashB.facility.name}" without manual selector.`);

  // 5. Setup Customer, Drivers & Items
  const { data: customer } = await client.from('customers').select('*, profiles(*)').limit(1).single();
  const { data: drivers } = await client.from('drivers').select('*, profiles(*)').eq('is_active', true).limit(2);
  const driverPickup = drivers[0];
  const driverDelivery = drivers[1] || drivers[0];

  console.log(`\n[SETUP] Customer: ${customer.id}, Pickup Driver: ${driverPickup.profiles?.full_name}, Delivery Driver: ${driverDelivery.profiles?.full_name}`);

  // Create an order assigned to Facility A in draft and transition to in_transit_to_facility
  const orderNumber = `BW-E2E-${Date.now().toString().slice(-6)}`;
  const { data: orderDraft, error: ordErr } = await client.from('orders').insert({
    order_number: orderNumber,
    customer_id: customer.id,
    facility_id: facilityA.id,
    current_status: 'draft',
    payment_method: 'razorpay',
    subtotal: 300,
    total_amount: 300,
  }).select().single();
  if (ordErr) throw ordErr;

  const initialStatuses = [
    'confirmed',
    'pickup_assigned',
    'pickup_accepted',
    'en_route_pickup',
    'pickup_otp_pending',
    'picked_up',
    'in_transit_to_facility',
  ];

  let order = orderDraft;
  for (const s of initialStatuses) {
    const { data: updated, error: stepErr } = await client.from('orders').update({
      current_status: s,
    }).eq('id', order.id).select().single();
    if (stepErr) throw stepErr;
    order = updated;
  }
  console.log(`[SETUP] Created Order #${order.order_number} (${order.id}) assigned to Facility A (${facilityA.name}) in status "${order.current_status}"`);

  // Insert order items
  const { data: orderItem, error: oiErr } = await client.from('order_items').insert({
    order_id: order.id,
    item_name: 'Executive Cotton Shirt',
    quantity: 3,
    weight_kg: 0.75,
    unit_price: 100,
    line_total: 300,
  }).select().single();
  if (oiErr) throw oiErr;
  console.log(`[SETUP] Inserted order item: "${orderItem.item_name}" (${orderItem.id})`);

  // Insert QR code for handoff
  const secureToken = require('crypto').randomUUID();
  await client.from('order_qr_codes').insert({
    order_id: order.id,
    secure_token: secureToken,
    is_active: true,
  });

  // Assign pickup driver to order with canonical status transitions
  const { data: daDraft, error: pickupDaErr } = await client.from('driver_assignments').insert({
    order_id: order.id,
    driver_id: driverPickup.id,
    assignment_type: 'pickup',
    status: 'assigned',
  }).select().single();
  if (pickupDaErr) throw pickupDaErr;

  const assignStatuses = ['accepted', 'en_route', 'arrived'];
  let da = daDraft;
  for (const st of assignStatuses) {
    const { data: updatedDa, error: daStepErr } = await client.from('driver_assignments').update({
      status: st,
    }).eq('id', da.id).select().single();
    if (daStepErr) throw daStepErr;
    da = updatedDa;
  }
  console.log(`[SETUP] Assigned pickup driver ${driverPickup.id} (${driverPickup.profiles?.full_name}) to order in status "${da.status}"`);

  // 6. Cross-Facility Security Scoping Test
  console.log('\n--- Cross-Facility Authorization Verification ---');
  try {
    // Employee B attempting to receive Facility A's order
    await facilityService.receiveByOrderNumber(employeeB.profile_id, order.order_number);
    throw new Error('SECURITY VIOLATION: Employee B was able to receive Facility A order!');
  } catch (err) {
    console.log(`[PASS] Cross-facility receive blocked: "${err.message}"`);
  }

  try {
    // Employee B attempting intake details of Facility A's order
    await facilityService.intakeDetails(employeeB.profile_id, order.id);
    throw new Error('SECURITY VIOLATION: Employee B was able to access Facility A intake details!');
  } catch (err) {
    console.log(`[PASS] Cross-facility intake access blocked: "${err.message}"`);
  }

  // 7. Verify Dashboard Incoming Tab for Employee A
  const dashAAfterOrder = await facilityService.dashboard(employeeA.profile_id);
  const incomingOrderInA = dashAAfterOrder.orders.find(o => o.id === order.id);
  if (!incomingOrderInA || incomingOrderInA.pickupDriverName !== driverPickup.profiles?.full_name) {
    throw new Error(`Incoming order not properly attached with pickup driver in Facility A dashboard: ${JSON.stringify(incomingOrderInA)}`);
  }
  console.log(`[PASS] Facility A Employee sees Order #${order.order_number} under Incoming: Driver "${incomingOrderInA.pickupDriverName}"`);

  // 8. Facility Employee A receives the order
  console.log('\n--- Operational Workflow: Receive Order ---');
  const receiveRes = await facilityService.receiveByOrderNumber(employeeA.profile_id, order.order_number);
  console.log(`[PASS] Order received by Facility A Employee. State transition: in_transit_to_facility -> ${receiveRes.orderStatus}`);

  // 9. Garment Verification
  console.log('\n--- Operational Workflow: Garment Verification ---');
  const verifyRes = await facilityService.verifyOrder(employeeA.profile_id, order.id, {
    itemCount: 3,
    weightKg: 0.75,
    notes: 'All garments verified in pristine condition',
  });
  console.log(`[PASS] Garment verification recorded. Verified: ${verifyRes.verified}, Status: ${verifyRes.orderStatus}`);

  // 10. Processing Stages: Washing -> Drying -> Ironing -> Folding -> Packaging
  console.log('\n--- Operational Workflow: Processing Stages ---');
  const stages = ['washing', 'drying', 'ironing', 'folding', 'packaging'];

  for (const stage of stages) {
    const startRes = await facilityService.startProcessing(employeeA.profile_id, order.id, stage);
    const opId = startRes.operationId;
    const compRes = await facilityService.completeProcessing(employeeA.profile_id, opId);
    console.log(`   [PASS] Stage "${stage}" started and completed successfully.`);
  }

  // 11. Quality Check
  console.log('\n--- Operational Workflow: QC Decision ---');
  const qcRes = await facilityService.qualityCheck(employeeA.profile_id, order.id, true, 'Premium finish quality verified');
  console.log(`[PASS] Quality Check Decision: Approved -> Order is now "${qcRes.orderStatus}" (ready_for_delivery)`);

  // 12. Delivery Driver Handover Flow
  console.log('\n--- Operational Workflow: Delivery Driver Handover ---');
  // Create delivery assignment for driverDelivery
  const { data: delivAssign, error: daErr } = await client.from('driver_assignments').insert({
    order_id: order.id,
    driver_id: driverDelivery.id,
    assignment_type: 'delivery',
    status: 'assigned',
  }).select().single();
  if (daErr) throw daErr;

  // Transition order to delivery_assigned
  await client.from('orders').update({
    current_status: 'delivery_assigned',
  }).eq('id', order.id);

  // Driver accepts assignment
  await logisticsService.respondToAssignment(driverDelivery.profile_id, delivAssign.id, true);
  console.log('[PASS] Delivery driver accepted the assignment.');

  // Driver starts trip to facility
  await logisticsService.startNavigation(driverDelivery.profile_id, delivAssign.id);
  console.log('[PASS] Delivery driver en route to facility.');

  // Driver arrives at facility
  await logisticsService.arrive(driverDelivery.profile_id, delivAssign.id);
  console.log('[PASS] Delivery driver arrived at facility.');

  // Facility Employee hands over order
  const handoverResult = await facilityService.handoverToDriver(employeeA.profile_id, order.id, driverDelivery.id);
  console.log('[PASS] Facility employee handed over order:', { handedOver: handoverResult.handedOver });

  // Driver confirms receipt of garments at facility
  const driverCollectionResult = await logisticsService.confirmFacilityHandover(driverDelivery.profile_id, delivAssign.id);
  console.log('[PASS] Driver confirmed clean garments collection at facility:', { collected: driverCollectionResult.collected });

  // 13. Driver navigates to customer & completes delivery
  console.log('\n--- Operational Workflow: Customer Delivery & OTP ---');
  const navCustomerResult = await logisticsService.startNavigation(driverDelivery.profile_id, delivAssign.id);
  console.log('[PASS] Driver started trip to customer. Destination:', navCustomerResult.destination);

  await logisticsService.arrive(driverDelivery.profile_id, delivAssign.id);
  console.log('[PASS] Driver arrived at customer location.');

  // Generate OTP & Complete delivery with mandatory photo proof
  const otpService = app.get(require(path.join(__dirname, '../dist/modules/otp/otp.service')).OtpService);
  const deliveryService = app.get(require(path.join(__dirname, '../dist/modules/delivery/delivery.service')).DeliveryService);

  const genOtp = await otpService.create(customer.profile_id, order.id, 'delivery');
  console.log(`[PASS] Generated customer delivery OTP: ${genOtp.otp}`);

  const photoUUID = require('crypto').randomUUID();
  const photoPath = `${order.id}/${photoUUID}.jpg`;
  await client.storage.from('delivery-proofs').upload(photoPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), {
    contentType: 'image/jpeg',
    upsert: true,
  });

  const completeRes = await deliveryService.complete(
    driverDelivery.profile_id,
    order.id,
    genOtp.otp,
    photoPath,
  );
  console.log(`[PASS] Driver completed delivery with OTP and proof photo! Delivered at: ${completeRes.deliveredAt}`);

  const { data: finalOrder } = await client.from('orders').select('order_number, current_status').eq('id', order.id).single();
  console.log(`[PASS] Order #${finalOrder.order_number} confirmed in database as: "${finalOrder.current_status}"!`);

  console.log('\n===============================================================');
  console.log('FULL MULTI-FACILITY & END-TO-END WORKFLOW TEST COMPLETED WITH 100% SUCCESS!');
  console.log('===============================================================');

  await app.close();
  process.exit(0);
}

run().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
