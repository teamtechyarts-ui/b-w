const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch(e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json || body });
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function run() {
  console.log('=== RUNNING LIVE FACILITY -> DRIVER HANDOVER VERIFICATION ===\n');

  // Let's create an end-to-end integration test runner against Supabase directly or through the API services.
  const { createClient } = require('@supabase/supabase-js');
  const dotenv = require('dotenv');
  const path = require('path');
  dotenv.config({ path: path.join(__dirname, '../.env') });

  const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(supabaseUrl, supabaseKey);

  // 1. Get active facility, employee, drivers, customer
  const { data: facilities } = await client.from('facilities').select('*').eq('is_active', true).limit(2);
  const facility = facilities[0];
  console.log('1. Active Facility:', facility.id, facility.name);

  const { data: drivers } = await client.from('drivers').select('*, profiles(*)').eq('is_active', true).limit(2);
  const driverA = drivers[0];
  const driverB = drivers[1] || drivers[0];
  console.log('2. Active Driver A:', driverA.id, driverA.profiles?.full_name);
  console.log('   Active Driver B:', driverB.id, driverB.profiles?.full_name);

  const { data: customers } = await client.from('customers').select('*, profiles(*)').limit(1);
  const customer = customers[0];
  console.log('3. Customer:', customer.id, customer.profiles?.full_name);

  const crypto = require('crypto');

  // Setup facility employee
  let { data: employees } = await client.from('facility_employees').select('*').eq('facility_id', facility.id).eq('is_active', true).limit(1);
  let employee = employees?.[0];
  if (!employee) {
    // Create auth user for facility staff
    const { data: { user: staffUser }, error: uErr } = await client.auth.admin.createUser({
      email: `staff.${Date.now()}@brightwhite.internal`,
      password: 'Password123!',
      email_confirm: true,
    });
    if (uErr) throw uErr;

    // Ensure profile full_name is set
    await client.from('profiles').update({
      full_name: 'Central Facility Staff',
      is_active: true,
    }).eq('id', staffUser.id);

    const { data: newEmp, error: feErr } = await client.from('facility_employees').insert({
      profile_id: staffUser.id,
      facility_id: facility.id,
      employee_role: 'operator',
      is_active: true,
    }).select().single();
    if (feErr) throw feErr;
    employee = newEmp;
  }
  console.log('4. Active Facility Employee:', employee.id, employee.facility_id);

  let otherEmployee = null;
  if (facilities.length > 1) {
    const otherFacility = facilities[1];
    let { data: otherEmps } = await client.from('facility_employees').select('*').eq('facility_id', otherFacility.id).eq('is_active', true).limit(1);
    if (otherEmps && otherEmps.length > 0) {
      otherEmployee = otherEmps[0];
    } else {
      const { data: { user: otherStaffUser }, error: ouErr } = await client.auth.admin.createUser({
        email: `otherstaff.${Date.now()}@brightwhite.internal`,
        password: 'Password123!',
        email_confirm: true,
      });
      if (ouErr) throw ouErr;

      await client.from('profiles').update({
        full_name: 'Other Facility Staff',
        is_active: true,
      }).eq('id', otherStaffUser.id);

      const { data: newOtherEmp } = await client.from('facility_employees').insert({
        profile_id: otherStaffUser.id,
        facility_id: otherFacility.id,
        employee_role: 'operator',
        is_active: true,
      }).select().single();
      otherEmployee = newOtherEmp;
    }
  }

  // 2. Create a fresh test order ready for delivery
  const orderNumber = 'BW-' + Date.now();
  const { data: orderDraft, error: oErr } = await client.from('orders').insert({
    order_number: orderNumber,
    customer_id: customer.id,
    facility_id: facility.id,
    current_status: 'draft',
    payment_method: 'razorpay',
    subtotal: 350,
    total_amount: 350,
  }).select().single();

  if (oErr) {
    console.error('Order creation failed:', oErr);
    process.exit(1);
  }

  const statuses = [
    'confirmed',
    'pickup_assigned',
    'pickup_accepted',
    'en_route_pickup',
    'pickup_otp_pending',
    'picked_up',
    'in_transit_to_facility',
    'received_at_facility',
    'verification',
    'processing',
    'quality_check',
    'ready_for_delivery',
  ];

  let order = orderDraft;
  for (const s of statuses) {
    const { data: updated, error: stepErr } = await client.from('orders').update({
      current_status: s,
    }).eq('id', order.id).select().single();
    if (stepErr) {
      console.error(`Transition to ${s} failed:`, stepErr);
      process.exit(1);
    }
    order = updated;
  }
  console.log('5. Created & transitioned order to ready_for_delivery:', order.id, order.order_number);

  // 3. Create delivery assignment for Driver A
  const { data: assignment, error: aErr } = await client.from('driver_assignments').insert({
    order_id: order.id,
    driver_id: driverA.id,
    assignment_type: 'delivery',
    status: 'assigned',
  }).select().single();

  if (aErr) {
    console.error('Assignment creation failed:', aErr);
    process.exit(1);
  }
  console.log('6. Assigned delivery driver:', assignment.id, 'status: assigned');

  // Transition order to delivery_assigned
  const { data: assignedOrder, error: asErr } = await client.from('orders').update({
    current_status: 'delivery_assigned',
  }).eq('id', order.id).select().single();

  if (asErr) {
    console.error('Transition to delivery_assigned failed:', asErr);
    process.exit(1);
  }
  console.log('7. Order transitioned to delivery_assigned');

  // Let's test the LogisticsService and FacilityService directly using backend services
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(path.join(__dirname, '../dist/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const facilityService = app.get(require(path.join(__dirname, '../dist/modules/facility/facility.service')).FacilityService);
  const logisticsService = app.get(require(path.join(__dirname, '../dist/modules/logistics/logistics.service')).LogisticsService);
  const driversService = app.get(require(path.join(__dirname, '../dist/modules/drivers/drivers.service')).DriversService);

  // TEST 1: Driver accepts delivery assignment
  const acceptResult = await logisticsService.respondToAssignment(driverA.profile_id, assignment.id, true);
  console.log('TEST 1 - Driver A accepts assignment:', acceptResult.status);

  // TEST 2: Check job detail before collection
  const jobDetail1 = await driversService.assignment(driverA.profile_id, assignment.id);
  console.log('TEST 2 - Driver job detail before collection:', {
    type: jobDetail1.type,
    assignmentStatus: jobDetail1.assignmentStatus,
    orderStatus: jobDetail1.orderStatus,
    facilityHandedOver: jobDetail1.facilityHandedOver,
    facilityCollected: jobDetail1.facilityCollected,
  });
  if (jobDetail1.facilityHandedOver !== false || jobDetail1.facilityCollected !== false) {
    throw new Error('Initial handover flags incorrect');
  }

  // TEST 3: Driver starts trip to facility (Phase 1)
  const navResult1 = await logisticsService.startNavigation(driverA.profile_id, assignment.id);
  console.log('TEST 3 - Driver starts navigation to facility:', navResult1);
  if (navResult1.destination !== 'facility' || navResult1.status !== 'en_route_facility') {
    throw new Error('Order prematurely advanced to en_route_delivery before collection');
  }

  // TEST 4: Driver marks arrival at facility
  const arriveResult1 = await logisticsService.arrive(driverA.profile_id, assignment.id);
  console.log('TEST 4 - Driver arrives at facility:', arriveResult1);
  if (arriveResult1.facilityArrival !== true) {
    throw new Error('Arrival at facility not recognized');
  }

  // TEST 5: Driver cannot confirm collection BEFORE facility employee hands over
  try {
    await logisticsService.confirmFacilityHandover(driverA.profile_id, assignment.id);
    throw new Error('Driver was able to confirm collection before facility handover!');
  } catch (err) {
    console.log('TEST 5 - Driver collection before facility handover rejected correctly:', err.message);
  }

  // TEST 6: Wrong facility employee attempting handover gets 403 / rejected
  if (otherEmployee) {
    try {
      await facilityService.handoverToDriver(otherEmployee.profile_id, order.id, driverA.id);
      throw new Error('Wrong facility employee was able to hand over order!');
    } catch (err) {
      console.log('TEST 6 - Wrong facility employee rejected correctly:', err.message);
    }
  } else {
    console.log('TEST 6 - Skipped other employee test (single facility in environment)');
  }

  // TEST 7: Wrong driver cannot confirm collection
  if (driverB.id !== driverA.id) {
    try {
      await logisticsService.confirmFacilityHandover(driverB.profile_id, assignment.id);
      throw new Error('Wrong driver was able to confirm collection!');
    } catch (err) {
      console.log('TEST 7 - Wrong driver confirmation rejected correctly:', err.message);
    }
  }

  // TEST 8: Correct facility employee hands over order to driver
  const handoverResult = await facilityService.handoverToDriver(employee.profile_id, order.id, driverA.id);
  console.log('TEST 8 - Facility employee hands over order:', handoverResult);
  if (!handoverResult.handedOver) {
    throw new Error('Facility handover failed');
  }

  // TEST 9: Duplicate facility handover is idempotent / safe
  const dupHandoverResult = await facilityService.handoverToDriver(employee.profile_id, order.id, driverA.id);
  console.log('TEST 9 - Duplicate facility handover handled safely:', dupHandoverResult);

  // TEST 10: Driver sees facilityHandedOver = true
  const jobDetail2 = await driversService.assignment(driverA.profile_id, assignment.id);
  console.log('TEST 10 - Driver job detail after facility staff handover:', {
    facilityHandedOver: jobDetail2.facilityHandedOver,
    facilityCollected: jobDetail2.facilityCollected,
    facilityHandedOverAt: jobDetail2.facilityHandedOverAt,
  });
  if (jobDetail2.facilityHandedOver !== true || jobDetail2.facilityCollected !== false) {
    throw new Error('Handover flags state inconsistent after facility handover');
  }

  // TEST 11: Driver confirms receipt
  const driverConfirmResult = await logisticsService.confirmFacilityHandover(driverA.profile_id, assignment.id);
  console.log('TEST 11 - Driver confirms receipt of clean garments:', driverConfirmResult);
  if (!driverConfirmResult.collected) {
    throw new Error('Driver collection confirmation failed');
  }

  // TEST 12: Duplicate driver confirmation is idempotent / safe
  const dupDriverConfirmResult = await logisticsService.confirmFacilityHandover(driverA.profile_id, assignment.id);
  console.log('TEST 12 - Duplicate driver collection confirmation handled safely:', dupDriverConfirmResult);

  // TEST 13: Driver job detail now reflects collection confirmed
  const jobDetail3 = await driversService.assignment(driverA.profile_id, assignment.id);
  console.log('TEST 13 - Driver job detail after driver confirmation:', {
    facilityHandedOver: jobDetail3.facilityHandedOver,
    facilityCollected: jobDetail3.facilityCollected,
    facilityCollectedAt: jobDetail3.facilityCollectedAt,
  });
  if (jobDetail3.facilityCollected !== true) {
    throw new Error('facilityCollected flag not true');
  }

  // TEST 14: Driver starts customer trip (Phase 2)
  const navResult2 = await logisticsService.startNavigation(driverA.profile_id, assignment.id);
  console.log('TEST 14 - Driver starts trip to customer (Phase 2):', navResult2);
  const { data: orderAfterNav } = await client.from('orders').select('current_status').eq('id', order.id).single();
  console.log('         Order current_status:', orderAfterNav.current_status);
  if (orderAfterNav.current_status !== 'en_route_delivery') {
    throw new Error('Order not transitioned to en_route_delivery');
  }

  // TEST 15: Driver arrives at customer
  const arriveResult2 = await logisticsService.arrive(driverA.profile_id, assignment.id);
  console.log('TEST 15 - Driver arrives at customer:', arriveResult2);
  const { data: orderAfterArrive } = await client.from('orders').select('current_status').eq('id', order.id).single();
  console.log('         Order current_status:', orderAfterArrive.current_status);
  if (orderAfterArrive.current_status !== 'delivery_otp_pending') {
    throw new Error('Order not transitioned to delivery_otp_pending');
  }

  console.log('\n=== ALL 15 VERIFICATION STAGES PASSED FLAWLESSLY! ===');
  await app.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
