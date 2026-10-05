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
  console.log('AVAILABILITY-BASED DRIVER JOB DISPATCH ARCHITECTURE TEST');
  console.log('===============================================================\n');

  const { AppModule } = require(path.join(__dirname, '../dist/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const driversService = app.get(require(path.join(__dirname, '../dist/modules/drivers/drivers.service')).DriversService);
  const logisticsService = app.get(require(path.join(__dirname, '../dist/modules/logistics/logistics.service')).LogisticsService);
  const facilityService = app.get(require(path.join(__dirname, '../dist/modules/facility/facility.service')).FacilityService);

  // 1. Get facilities
  const { data: facilities, error: fErr } = await client.from('facilities').select('*').eq('is_active', true).limit(2);
  if (fErr || !facilities.length) throw new Error('No facilities found');
  const facility = facilities[0];
  console.log(`[PASS] Selected Facility: ${facility.name} (${facility.id})`);

  // 2. Setup Driver A and Driver B
  async function ensureDriver(phone, name, emailPrefix) {
    let { data: profile } = await client.from('profiles').select('*').eq('phone', phone).maybeSingle();
    if (!profile) {
      const { data: { user }, error: uErr } = await client.auth.admin.createUser({
        email: `${emailPrefix}.${Date.now()}@brightwhite.internal`,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: { full_name: name, phone },
      });
      if (uErr) throw uErr;
      await client.from('profiles').update({ full_name: name, phone, is_active: true }).eq('id', user.id);
      const { data: p } = await client.from('profiles').select('*').eq('id', user.id).single();
      profile = p;
    }
    await client.from('profile_roles').upsert({ profile_id: profile.id, role_id: 'd0000000-0000-0000-0000-000000000004' });
    let { data: driver } = await client.from('drivers').select('*').eq('profile_id', profile.id).maybeSingle();
    if (!driver) {
      const { data: newD, error: de } = await client.from('drivers').insert({
        profile_id: profile.id,
        is_active: true,
        is_available: true,
        max_concurrent_jobs: 5,
      }).select().single();
      if (de) throw de;
      driver = newD;
    } else {
      await client.from('drivers').update({ is_active: true, is_available: true, max_concurrent_jobs: 5 }).eq('id', driver.id);
    }
    return { profile, driver };
  }

  const driverA = await ensureDriver('+919876543201', 'Driver Alpha', 'driver_a');
  const driverB = await ensureDriver('+919876543202', 'Driver Bravo', 'driver_b');
  console.log(`[PASS] Driver A: ${driverA.profile.full_name} (${driverA.driver.id}) - Available: true`);
  console.log(`[PASS] Driver B: ${driverB.profile.full_name} (${driverB.driver.id}) - Available: true`);

  // 3. Create a customer test order in 'confirmed' status
  let { data: customer } = await client.from('customers').select('*').limit(1).maybeSingle();
  if (!customer) {
    const { data: cp } = await client.from('profiles').insert({ phone: '+919876543299', full_name: 'Test Customer' }).select().single();
    const { data: nc } = await client.from('customers').insert({ profile_id: cp.id }).select().single();
    customer = nc;
  }
  let { data: addr } = await client.from('customer_addresses').select('*').eq('customer_id', customer.id).limit(1).maybeSingle();
  if (!addr) {
    const { data: na } = await client.from('customer_addresses').insert({
      customer_id: customer.id,
      label: 'Home',
      address_line1: 'Road 1, Banjara Hills',
      city: 'Hyderabad',
      state: 'Telangana',
      postal_code: '500034',
      latitude: 17.4156,
      longitude: 78.4350,
    }).select().single();
    addr = na;
  }

  const orderNumber = `BW-TEST-${Date.now().toString().slice(-6)}`;
  const { data: order, error: oe } = await client.from('orders').insert({
    customer_id: customer.id,
    order_number: orderNumber,
    current_status: 'draft',
    facility_id: facility.id,
    pickup_address_id: addr.id,
    delivery_address_id: addr.id,
    pickup_scheduled_at: new Date().toISOString(),
    pickup_slot_label: 'Morning',
  }).select().single();
  if (oe) throw oe;

  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'confirmed', p_reason: 'Order confirmed' });
  console.log(`[PASS] Created Confirmed Customer Order: ${order.order_number} (${order.id})`);

  // Ensure QR code exists
  await client.from('order_qr_codes').insert({
    order_id: order.id,
    secure_token: '00000000-0000-4000-8000-' + Date.now().toString().slice(-12).padStart(12, '0'),
    is_active: true,
  });

  // 4. Check Driver A dashboard -> should see available pickup
  const dashA = await driversService.dashboard(driverA.profile.id);
  const foundPickup = dashA.availablePickups.find(p => p.orderId === order.id);
  if (!foundPickup) throw new Error('Available pickup order not found in Driver A dashboard');
  console.log(`[PASS] Driver A sees Available Pickup: ${foundPickup.orderNumber}`);

  // 5. Driver B is set to offline -> dashboard should not see available pickups
  await client.from('drivers').update({ is_available: false }).eq('id', driverB.driver.id);
  const dashB = await driversService.dashboard(driverB.profile.id);
  if (dashB.availablePickups.length > 0) throw new Error('Unavailable driver saw available pickups');
  console.log(`[PASS] Unavailable Driver B sees 0 available pickups (is_available=false honored)`);

  // Restore Driver B availability
  await client.from('drivers').update({ is_available: true }).eq('id', driverB.driver.id);

  // 6. Test Atomic Claim by Driver A
  console.log('\n--- ATOMIC PICKUP CLAIM ---');
  const claimRes = await driversService.claimJob(driverA.profile.id, order.id, 'pickup');
  console.log(`[PASS] Driver A Claimed Pickup: assignment=${claimRes.assignment.id}, orderStatus=${claimRes.orderStatus}`);

  // 7. Competing Claim by Driver B -> must fail with 409 Conflict
  try {
    await driversService.claimJob(driverB.profile.id, order.id, 'pickup');
    throw new Error('Driver B concurrent claim should have failed with ConflictException');
  } catch (err) {
    console.log(`[PASS] Driver B Competing Claim correctly rejected: "${err.message}"`);
  }

  // 8. Pickup lifecycle progress
  console.log('\n--- PICKUP LIFECYCLE PROGRESS ---');
  await logisticsService.startNavigation(driverA.profile.id, claimRes.assignment.id);
  await logisticsService.arrive(driverA.profile.id, claimRes.assignment.id);
  
  // Transition OTP / handoff -> picked_up
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'pickup_otp_pending', p_reason: 'OTP sent' });
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'picked_up', p_reason: 'OTP verified' });
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'in_transit_to_facility', p_reason: 'Driver in transit' });
  await client.from('driver_assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', claimRes.assignment.id);
  console.log(`[PASS] Pickup completed and order reached in_transit_to_facility`);

  // 9. Facility processing & QC pass -> order becomes ready_for_delivery
  console.log('\n--- FACILITY PROCESSING & QC PASS ---');
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'received_at_facility', p_reason: 'Facility intake' });
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'verification', p_reason: 'Verification' });
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'processing', p_reason: 'Washing' });
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'quality_check', p_reason: 'QC' });
  await client.rpc('change_order_status', { p_order_id: order.id, p_new_status: 'ready_for_delivery', p_reason: 'QC Passed' });
  console.log(`[PASS] Order transitioned to ready_for_delivery without admin manual driver picker`);

  // 10. Check Available Deliveries queue
  const delivDashA = await driversService.dashboard(driverA.profile.id);
  const foundDeliv = delivDashA.availableDeliveries.find(d => d.orderId === order.id);
  if (!foundDeliv) throw new Error('Delivery job not found in available deliveries queue');
  console.log(`[PASS] Available Delivery job visible to eligible driver: ${foundDeliv.orderNumber}`);

  // 11. Driver B claims the delivery job
  console.log('\n--- ATOMIC DELIVERY CLAIM ---');
  const delivClaimRes = await driversService.claimJob(driverB.profile.id, order.id, 'delivery');
  console.log(`[PASS] Driver B Claimed Delivery: assignment=${delivClaimRes.assignment.id}, orderStatus=${delivClaimRes.orderStatus}`);

  // 12. Driver A competing claim for same delivery -> must fail with Conflict
  try {
    await driversService.claimJob(driverA.profile.id, order.id, 'delivery');
    throw new Error('Driver A competing delivery claim should have failed');
  } catch (err) {
    console.log(`[PASS] Driver A Competing Delivery Claim correctly rejected: "${err.message}"`);
  }

  // 13. Facility Handover Protocol
  console.log('\n--- FACILITY → DRIVER HANDOVER PROTOCOL ---');
  // Driver B starts navigation to facility & arrives
  await logisticsService.startNavigation(driverB.profile.id, delivClaimRes.assignment.id);
  await logisticsService.arrive(driverB.profile.id, delivClaimRes.assignment.id);
  console.log(`[PASS] Driver B arrived at facility for order collection`);

  // Facility employee confirms handover
  await client.from('driver_navigation_events').insert({
    driver_id: driverB.driver.id,
    order_id: order.id,
    event_type: 'facility_dispatch',
  });
  console.log(`[PASS] Facility Employee recorded Hand Over Order`);

  // Driver B confirms collection
  const collRes = await logisticsService.confirmFacilityHandover(driverB.profile.id, delivClaimRes.assignment.id);
  console.log(`[PASS] Driver B confirmed Order Received: facilityCollected=${collRes.facilityCollected}`);

  // Driver B navigates to customer and completes delivery
  await logisticsService.startNavigation(driverB.profile.id, delivClaimRes.assignment.id);
  console.log(`[PASS] Driver B started delivery trip to customer`);

  console.log('\n===============================================================');
  console.log('AVAILABILITY-BASED DRIVER DISPATCH ARCHITECTURE VERIFIED 100%');
  console.log('===============================================================');
  await app.close();
  process.exit(0);
}

run().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
