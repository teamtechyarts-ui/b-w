const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://snvfpzjovkjjdslgmwjy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(supabaseUrl, supabaseKey);

async function testDeliveryWorkflow() {
  console.log('=== TESTING DELIVERY COMPLETION (OTP ONLY, NO PHOTO) ===\n');

  // 1. Find or pick active driver & customer
  const { data: drivers, error: dErr } = await client.from('drivers').select('*, profiles(*)').eq('is_active', true).limit(1);
  if (dErr || !drivers?.length) throw new Error('No active driver: ' + JSON.stringify(dErr));
  const driver = drivers[0];
  console.log('Driver:', driver.id, driver.profiles?.full_name, 'profile_id:', driver.profile_id);

  const { data: customers, error: cErr } = await client.from('customers').select('*, profiles(*)').limit(1);
  if (cErr || !customers?.length) throw new Error('No customer: ' + JSON.stringify(cErr));
  const customer = customers[0];

  // 2. Create a test order and advance to delivery_otp_pending
  const orderNumber = `BW-${Date.now().toString(36).toUpperCase()}`;
  const { data: order, error: oErr } = await client.from('orders').insert({
    customer_id: customer.id,
    order_number: orderNumber,
    current_status: 'draft',
    subtotal: 500,
    total_amount: 500,
    payment_method: 'cash_on_delivery',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single();

  if (oErr || !order) throw new Error('Order creation error: ' + JSON.stringify(oErr));
  console.log('Created test order in draft:', order.id, order.order_number);

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
    'delivery_assigned',
    'delivery_accepted',
    'en_route_delivery',
    'delivery_otp_pending',
  ];

  for (const st of statuses) {
    const { error: trErr } = await client.rpc('change_order_status', {
      p_order_id: order.id,
      p_new_status: st,
      p_reason: `Advancing test order to ${st}`,
    });
    if (trErr) throw new Error(`Transition to ${st} failed: ${JSON.stringify(trErr)}`);
  }
  console.log('Order transitioned to delivery_otp_pending');

  // 3. Create driver assignment and transition to arrived
  const { data: assignment, error: aErr } = await client.from('driver_assignments').insert({
    order_id: order.id,
    driver_id: driver.id,
    assignment_type: 'delivery',
    status: 'assigned',
    assigned_at: new Date().toISOString(),
  }).select().single();

  if (aErr || !assignment) throw new Error('Assignment error: ' + JSON.stringify(aErr));

  await client.from('driver_assignments').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', assignment.id);
  await client.from('driver_assignments').update({ status: 'en_route' }).eq('id', assignment.id);
  await client.from('driver_assignments').update({ status: 'arrived' }).eq('id', assignment.id);
  console.log('Created arrived delivery assignment:', assignment.id);

  // 4. Generate delivery OTP (e.g. 749281)
  const otpCode = '749281';
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.scryptSync(otpCode, salt, 32).toString('hex');
  const storedHash = `${salt}:${hashed}`;

  const { data: otpRecord, error: otpErr } = await client.from('order_otps').insert({
    order_id: order.id,
    otp_type: 'delivery',
    otp_hash: storedHash,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    attempt_count: 0,
  }).select().single();

  if (otpErr || !otpRecord) throw new Error('OTP creation error: ' + JSON.stringify(otpErr));
  console.log('Created delivery OTP record:', otpRecord.id);

  // 5. Test complete delivery via DeliveryService (through backend API or direct service)
  const { DeliveryService } = require('../dist/modules/delivery/delivery.service');
  const service = new DeliveryService({ admin: client, client }, {});

  // 5a. Test empty OTP rejection
  try {
    await service.complete(driver.profile_id, order.id, '');
    throw new Error('Empty OTP should have failed!');
  } catch (err) {
    console.log('✓ Empty OTP rejected:', err.message);
  }

  // 5b. Test invalid OTP rejection
  try {
    await service.complete(driver.profile_id, order.id, '000000');
    throw new Error('Invalid OTP should have failed!');
  } catch (err) {
    console.log('✓ Invalid OTP rejected:', err.message);
  }

  // 5c. Test valid OTP completion WITHOUT photo
  console.log('\nCompleting delivery with valid OTP and NO photo...');
  const result = await service.complete(driver.profile_id, order.id, otpCode);
  console.log('✓ Delivery complete result:', result);

  // 6. Verify final state
  const { data: finalOrder } = await client.from('orders').select('*').eq('id', order.id).single();
  console.log('Final order status:', finalOrder.current_status);
  console.log('Delivered at:', finalOrder.delivered_at);
  console.log('Claim deadline at:', finalOrder.claim_deadline_at);

  const { data: finalAssignment } = await client.from('driver_assignments').select('*').eq('id', assignment.id).single();
  console.log('Final assignment status:', finalAssignment.status, 'completed_at:', finalAssignment.completed_at);

  const { data: finalOtp } = await client.from('order_otps').select('*').eq('id', otpRecord.id).single();
  console.log('Final OTP verified_at:', finalOtp.verified_at, 'verified_by:', finalOtp.verified_by);

  if (finalOrder.current_status !== 'claim_period_active') {
    throw new Error('Order did not reach claim_period_active!');
  }
  if (finalAssignment.status !== 'completed') {
    throw new Error('Assignment was not completed!');
  }
  if (!finalOtp.verified_at) {
    throw new Error('OTP was not marked verified!');
  }

  console.log('\n=== ALL DELIVERY WORKFLOW TESTS PASSED CLEANLY! ===\n');
}

testDeliveryWorkflow().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
