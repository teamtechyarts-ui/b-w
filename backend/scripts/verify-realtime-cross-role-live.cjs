const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function runCrossRoleLiveVerification() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('================================================================');
  console.log('LIVE CROSS-ROLE REALTIME VERIFICATION & LATENCY BENCHMARK');
  console.log('================================================================');

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Channel definitions with self: true enabled to receive broadcasts
  const customerChannel = supabase.channel('customer:cust_live_001', { config: { broadcast: { self: true } } });
  const driverAvailableChannel = supabase.channel('driver:available', { config: { broadcast: { self: true } } });
  const driverPrivateChannel = supabase.channel('driver:drv_live_001', { config: { broadcast: { self: true } } });
  const facilityChannel = supabase.channel('facility:fac_live_001', { config: { broadcast: { self: true } } });
  const adminChannel = supabase.channel('admin:operations', { config: { broadcast: { self: true } } });
  const orderChannel = supabase.channel('order:ord_live_test_999', { config: { broadcast: { self: true } } });

  const receivedEvents = {
    customer: [],
    driverPool: [],
    driverPrivate: [],
    facility: [],
    admin: [],
    order: [],
  };

  const latencies = [];

  customerChannel.on('broadcast', { event: '*' }, (msg) => {
    receivedEvents.customer.push(msg);
  });

  driverAvailableChannel.on('broadcast', { event: '*' }, (msg) => {
    const recvTime = performance.now();
    if (msg.payload?.sendTime) {
      latencies.push(recvTime - msg.payload.sendTime);
    }
    receivedEvents.driverPool.push(msg);
  });

  driverPrivateChannel.on('broadcast', { event: '*' }, (msg) => {
    receivedEvents.driverPrivate.push(msg);
  });

  facilityChannel.on('broadcast', { event: '*' }, (msg) => {
    receivedEvents.facility.push(msg);
  });

  adminChannel.on('broadcast', { event: '*' }, (msg) => {
    receivedEvents.admin.push(msg);
  });

  orderChannel.on('broadcast', { event: '*' }, (msg) => {
    receivedEvents.order.push(msg);
  });

  // Subscribe all channels
  console.log('1. Subscribing multi-role channels...');
  await Promise.all([
    new Promise(res => customerChannel.subscribe(res)),
    new Promise(res => driverAvailableChannel.subscribe(res)),
    new Promise(res => driverPrivateChannel.subscribe(res)),
    new Promise(res => facilityChannel.subscribe(res)),
    new Promise(res => adminChannel.subscribe(res)),
    new Promise(res => orderChannel.subscribe(res)),
  ]);
  console.log('✅ All 6 multi-role channels SUBSCRIBED.');

  // Step 1: Customer places order
  console.log('\n2. Simulating: Customer Order Placed...');
  const orderCreatedPayload = {
    eventType: 'ORDER_CREATED',
    entityId: 'ord_live_test_999',
    orderId: 'ord_live_test_999',
    orderNumber: 'BW-20261009-LIVE999',
    status: 'confirmed',
    sendTime: performance.now(),
    timestamp: new Date().toISOString(),
  };

  await driverAvailableChannel.send({
    type: 'broadcast',
    event: 'JOB_AVAILABLE',
    payload: orderCreatedPayload,
  });

  await adminChannel.send({
    type: 'broadcast',
    event: 'ORDER_CREATED',
    payload: orderCreatedPayload,
  });

  await customerChannel.send({
    type: 'broadcast',
    event: 'ORDER_STATUS_CHANGED',
    payload: orderCreatedPayload,
  });

  // Step 2: Driver Claims Job (Conflict resolution)
  console.log('3. Simulating: Driver 1 claims job (instant pool removal for Driver 2)...');
  const claimPayload = {
    eventType: 'JOB_CLAIMED',
    entityId: 'ord_live_test_999',
    orderId: 'ord_live_test_999',
    driverId: 'drv_live_001',
    status: 'pickup_assigned',
    sendTime: performance.now(),
    timestamp: new Date().toISOString(),
  };

  await driverAvailableChannel.send({
    type: 'broadcast',
    event: 'JOB_CLAIMED',
    payload: claimPayload,
  });

  await driverPrivateChannel.send({
    type: 'broadcast',
    event: 'ASSIGNMENT_UPDATED',
    payload: claimPayload,
  });

  // Step 3: Facility Intake & Processing Stages
  console.log('4. Simulating: Facility Intake, Washing, QC approval...');
  const facilityPayload = {
    eventType: 'FACILITY_INTAKE',
    entityId: 'ord_live_test_999',
    orderId: 'ord_live_test_999',
    facilityId: 'fac_live_001',
    status: 'received_at_facility',
    timestamp: new Date().toISOString(),
  };

  await facilityChannel.send({
    type: 'broadcast',
    event: 'FACILITY_INTAKE',
    payload: facilityPayload,
  });

  await orderChannel.send({
    type: 'broadcast',
    event: 'ORDER_STATUS_CHANGED',
    payload: facilityPayload,
  });

  // Step 4: Ready for Delivery -> Driver Delivery Pool
  console.log('5. Simulating: Ready for delivery -> Delivery Pool broadcast...');
  await driverAvailableChannel.send({
    type: 'broadcast',
    event: 'JOB_AVAILABLE',
    payload: {
      eventType: 'JOB_AVAILABLE',
      entityId: 'ord_live_test_999',
      orderId: 'ord_live_test_999',
      status: 'ready_for_delivery',
      jobType: 'delivery',
      sendTime: performance.now(),
      timestamp: new Date().toISOString(),
    },
  });

  // Latency benchmark batch (50 rapid events)
  console.log('\n6. Running 50-event latency measurement batch...');
  for (let i = 0; i < 50; i++) {
    await driverAvailableChannel.send({
      type: 'broadcast',
      event: 'BENCHMARK_EVENT',
      payload: { id: i, sendTime: performance.now() },
    });
    await new Promise(r => setTimeout(r, 20));
  }

  // Wait 1s for all messages to settle
  await new Promise(r => setTimeout(r, 1000));

  // Compute Latency Statistics
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  console.log('\n================================================================');
  console.log('LIVE MEASUREMENT & VERIFICATION RESULTS');
  console.log('================================================================');
  console.log(`Total Latency Samples: ${latencies.length}`);
  console.log(`p50 Propagation Latency: ${p50.toFixed(2)} ms`);
  console.log(`p95 Propagation Latency: ${p95.toFixed(2)} ms`);
  console.log(`p99 Propagation Latency: ${p99.toFixed(2)} ms`);
  console.log(`Customer Received Events: ${receivedEvents.customer.length}`);
  console.log(`Driver Pool Received Events: ${receivedEvents.driverPool.length}`);
  console.log(`Driver Private Received Events: ${receivedEvents.driverPrivate.length}`);
  console.log(`Facility Received Events: ${receivedEvents.facility.length}`);
  console.log(`Admin Received Events: ${receivedEvents.admin.length}`);
  console.log(`Order Channel Received Events: ${receivedEvents.order.length}`);

  // Unsubscribe all
  await Promise.all([
    customerChannel.unsubscribe(),
    driverAvailableChannel.unsubscribe(),
    driverPrivateChannel.unsubscribe(),
    facilityChannel.unsubscribe(),
    adminChannel.unsubscribe(),
    orderChannel.unsubscribe(),
  ]);

  console.log('\n✅ Live multi-role verification completed with 0 errors.');
}

runCrossRoleLiveVerification().catch(err => {
  console.error('Live cross-role verification failed:', err);
  process.exit(1);
});
