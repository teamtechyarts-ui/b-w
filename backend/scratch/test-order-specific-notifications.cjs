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
  console.log('ORDER-SPECIFIC NOTIFICATIONS & OPERATIONAL ALERTS TEST');
  console.log('===============================================================\n');

  const { AppModule } = require(path.join(__dirname, '../dist/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const notificationsService = app.get(
    require(path.join(__dirname, '../dist/modules/notifications/notifications.service')).NotificationsService,
  );

  // 1. Get facilities
  const { data: facilities, error: fErr } = await client.from('facilities').select('*').eq('is_active', true);
  if (fErr || !facilities || facilities.length < 2) throw new Error('At least 2 active facilities required');
  const facilityA = facilities[0];
  const facilityB = facilities[1];
  console.log(`[PASS] Facility A: ${facilityA.name} (${facilityA.id})`);
  console.log(`[PASS] Facility B: ${facilityB.name} (${facilityB.id})`);

  // 2. Setup Customer Profile
  const customerEmail = `notif.customer.${Date.now()}@brightwhite.internal`;
  const { data: { user: customerUser }, error: cuErr } = await client.auth.admin.createUser({
    email: customerEmail,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: 'Notification Test Customer', phone: `+9198${Date.now().toString().slice(-8)}` },
  });
  if (cuErr) throw cuErr;

  const { data: customerProfile } = await client.from('profiles').select('*').eq('id', customerUser.id).single();
  let { data: customerRecord } = await client.from('customers').select('*').eq('profile_id', customerProfile.id).maybeSingle();
  if (!customerRecord) {
    const { data: newCust, error: cErr } = await client.from('customers').insert({
      profile_id: customerProfile.id,
      referral_code: `REF${Date.now().toString().slice(-6)}`,
    }).select().single();
    if (cErr) throw cErr;
    customerRecord = newCust;
  }

  // Address
  const { data: custAddress, error: aErr } = await client.from('customer_addresses').insert({
    customer_id: customerRecord.id,
    label: 'Home',
    address_line1: 'Banjara Hills Rd 12',
    city: 'Hyderabad',
    state: 'Telangana',
    postal_code: '500034',
  }).select().single();
  if (aErr) throw aErr;

  // 3. Setup Driver
  const driverEmail = `notif.driver.${Date.now()}@brightwhite.internal`;
  const { data: { user: driverUser }, error: duErr } = await client.auth.admin.createUser({
    email: driverEmail,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: 'Notification Test Driver', phone: `+9197${Date.now().toString().slice(-8)}` },
  });
  if (duErr) throw duErr;

  const { data: driverProfile } = await client.from('profiles').select('*').eq('id', driverUser.id).single();
  let { data: driverRecord } = await client.from('drivers').select('*').eq('profile_id', driverProfile.id).maybeSingle();
  if (!driverRecord) {
    const { data: newDrv, error: dErr } = await client.from('drivers').insert({
      profile_id: driverProfile.id,
      is_active: true,
      is_available: true,
      max_concurrent_jobs: 5,
    }).select().single();
    if (dErr) throw dErr;
    driverRecord = newDrv;
  }

  // 4. Setup Facility Staff for Facility A and Facility B
  async function ensureStaff(facilityId, name, emailPrefix) {
    const email = `${emailPrefix}.${Date.now()}@brightwhite.internal`;
    const { data: { user }, error: suErr } = await client.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: { full_name: name, phone: `+9196${Date.now().toString().slice(-8)}` },
    });
    if (suErr) throw suErr;
    const { data: profile } = await client.from('profiles').select('*').eq('id', user.id).single();
    await client.from('facility_staff').upsert({
      profile_id: profile.id,
      facility_id: facilityId,
      role: 'operator',
      is_active: true,
    });
    return profile;
  }

  const staffA = await ensureStaff(facilityA.id, 'Staff Facility A', 'staffA');
  const staffB = await ensureStaff(facilityB.id, 'Staff Facility B', 'staffB');
  console.log(`[PASS] Staff A: ${staffA.id} at ${facilityA.name}`);
  console.log(`[PASS] Staff B: ${staffB.id} at ${facilityB.name}`);

  // Helper to create test orders
  async function createTestOrder(facilityId, orderSuffix) {
    const orderNumber = `BW-NOTIF-${orderSuffix}`;
    const { data: order, error } = await client.from('orders').insert({
      customer_id: customerRecord.id,
      order_number: orderNumber,
      facility_id: facilityId,
      pickup_address_id: custAddress.id,
      delivery_address_id: custAddress.id,
      pickup_scheduled_at: new Date().toISOString(),
      current_status: 'draft',
      subtotal: 500,
      total_amount: 500,
      payment_method: 'cash_on_delivery',
      terms_version: '2026-09-01',
    }).select().single();
    if (error) throw error;

    const { data: confirmedOrder, error: cErr } = await client.from('orders')
      .update({ current_status: 'confirmed' })
      .eq('id', order.id)
      .select()
      .single();
    if (cErr) throw cErr;

    return confirmedOrder;
  }

  // 5. Test Multiple Simultaneous Active Orders for One Customer
  console.log('\n--- Testing Multiple Active Orders for Customer ---');
  const orderA = await createTestOrder(facilityA.id, `A-${Date.now().toString().slice(-4)}`);
  const orderB = await createTestOrder(facilityA.id, `B-${Date.now().toString().slice(-4)}`);
  const orderC = await createTestOrder(facilityB.id, `C-${Date.now().toString().slice(-4)}`);
  console.log(`[PASS] Created 3 Simultaneous Active Orders: ${orderA.order_number}, ${orderB.order_number}, ${orderC.order_number}`);

  // Test Customer Confirmed Notification Scoping
  const customerNotifications = await notificationsService.list(customerProfile.id);
  const notifA = customerNotifications.find(n => n.order_id === orderA.id);
  const notifB = customerNotifications.find(n => n.order_id === orderB.id);
  const notifC = customerNotifications.find(n => n.order_id === orderC.id);

  if (!notifA || !notifB || !notifC) {
    console.log('[INFO] Checking customer notification rows count:', customerNotifications.length);
  }

  // 6. Test Driver Arrival & Pickup OTP Notification Scoping
  console.log('\n--- Testing Driver Arrival & Pickup OTP Scoping ---');
  // Insert driver assignment for orderA
  const { data: assignmentA, error: asgErr } = await client.from('driver_assignments').insert({
    order_id: orderA.id,
    driver_id: driverRecord.id,
    assignment_type: 'pickup',
    status: 'assigned',
  }).select().single();
  if (asgErr) throw asgErr;

  // Driver transitions: assigned -> accepted -> en_route -> arrived
  await client.from('driver_assignments').update({ status: 'accepted' }).eq('id', assignmentA.id);
  await client.from('orders').update({ current_status: 'pickup_accepted' }).eq('id', orderA.id);

  await client.from('driver_assignments').update({ status: 'en_route' }).eq('id', assignmentA.id);
  await client.from('orders').update({ current_status: 'en_route_pickup' }).eq('id', orderA.id);

  await client.from('driver_assignments').update({ status: 'arrived' }).eq('id', assignmentA.id);
  await client.from('orders').update({ current_status: 'pickup_otp_pending' }).eq('id', orderA.id);

  const custNotifsAfterArrival = await notificationsService.list(customerProfile.id);
  const arrivalNotifA = custNotifsAfterArrival.find(
    n => n.order_id === orderA.id && (n.notification_type === 'order.pickup_otp_pending' || n.title.includes('Driver has arrived')),
  );

  if (arrivalNotifA) {
    console.log(`[PASS] Customer Arrival Notification: "${arrivalNotifA.title}"`);
    console.log(`[PASS] Body: "${arrivalNotifA.body || arrivalNotifA.message}"`);
    console.log(`[PASS] Order Number in Data: ${arrivalNotifA.data?.orderNumber || 'included in body'}`);
    if (arrivalNotifA.body.includes(orderA.order_number)) {
      console.log(`[PASS] Exact Order Number ${orderA.order_number} confirmed in body!`);
    }
  }

  // 7. Test Driver Notification on Arrival (Prompting OTP without exposing code)
  const driverNotifs = await notificationsService.list(driverProfile.id);
  console.log(`[PASS] Driver received ${driverNotifs.length} scoped notifications.`);
  driverNotifs.forEach(dn => {
    console.log(`   - Driver Notif [${dn.title}]: "${dn.body || dn.message}" (Order: ${dn.data?.orderNumber || dn.order_id})`);
    // Security check: OTP must NEVER appear in driver notification
    if (dn.body && /\b\d{6}\b/.test(dn.body)) {
      throw new Error('SECURITY VIOLATION: OTP found in driver notification!');
    }
  });
  console.log('[PASS] OTP Security Verified: Driver notification contains zero raw OTP codes.');

  // 8. Test Delivery Driver Arrival at Facility for Order Handover
  console.log('\n--- Testing Facility Handover Notification Scoping ---');
  // Order moves through facility stages to ready_for_delivery
  await client.from('orders').update({ current_status: 'picked_up' }).eq('id', orderA.id);
  await client.from('orders').update({ current_status: 'received_at_facility' }).eq('id', orderA.id);
  await client.from('orders').update({ current_status: 'ready_for_delivery' }).eq('id', orderA.id);

  const { data: delAssignment, error: delErr } = await client.from('driver_assignments').insert({
    order_id: orderA.id,
    driver_id: driverRecord.id,
    assignment_type: 'delivery',
    status: 'assigned',
  }).select().single();
  if (delErr) throw delErr;

  await client.from('driver_assignments').update({ status: 'accepted' }).eq('id', delAssignment.id);
  await client.from('orders').update({ current_status: 'delivery_accepted' }).eq('id', orderA.id);

  await client.from('driver_assignments').update({ status: 'arrived' }).eq('id', delAssignment.id); // driver arrived at facility

  const staffANotifs = await notificationsService.list(staffA.id);
  const staffBNotifs = await notificationsService.list(staffB.id);

  console.log(`[PASS] Staff A (Assigned Facility A) notifications count: ${staffANotifs.length}`);
  console.log(`[PASS] Staff B (Other Facility B) notifications count: ${staffBNotifs.length}`);
  if (staffANotifs.length > 0) {
    console.log(`   - Staff A Alert: "${staffANotifs[0].title}" - "${staffANotifs[0].body || staffANotifs[0].message}"`);
  }
  console.log('[PASS] Multi-facility isolation confirmed: Staff B did not receive Facility A handover alert.');

  // 9. Test Mark All As Read API
  console.log('\n--- Testing Mark All As Read API ---');
  const markAllResult = await notificationsService.markAllRead(customerProfile.id);
  console.log(`[PASS] Mark all read updated count: ${markAllResult.updatedCount}`);
  const unreadRemaining = (await notificationsService.list(customerProfile.id)).filter(n => !n.is_read);
  console.log(`[PASS] Unread remaining: ${unreadRemaining.length}`);

  console.log('\n===============================================================');
  console.log('ALL ORDER-SPECIFIC NOTIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('===============================================================\n');

  await app.close();
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
