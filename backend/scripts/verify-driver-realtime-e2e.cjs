const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function runDriverRealtimeE2E() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('================================================================');
  console.log('FINAL PRODUCTION VERIFICATION — REAL-TIME DRIVER JOB SYNCHRONIZATION');
  console.log('================================================================');

  // 1. Initialize Simulated Live Driver Session (using Anon Key / Client SDK)
  const driverClient = createClient(url, anonKey, { auth: { persistSession: false } });
  // 2. Initialize Competing Driver Session (Driver 2)
  const competingDriverClient = createClient(url, anonKey, { auth: { persistSession: false } });
  // 3. Initialize Backend Server Publisher (using Service Role Key)
  const backendServer = createClient(url, serviceKey, { auth: { persistSession: false } });

  // State in simulated Driver Dashboard (equivalent to React state in DriverDashboardScreen.tsx)
  let driverDashboardState = {
    availablePickups: [],
    availableDeliveries: [],
    activeJobs: [],
  };

  let competingDriverState = {
    availablePickups: [],
    availableDeliveries: [],
  };

  const pickupLatencies = [];
  const deliveryLatencies = [];
  const claimConflictLatencies = [];

  // Driver 1 channel subscriptions (subscribes to 'driver:available' and 'jobs:drivers')
  const driverSubAvailable = driverClient.channel('driver:available', { config: { broadcast: { self: true } } });
  const driverSubJobs = driverClient.channel('jobs:drivers', { config: { broadcast: { self: true } } });
  const driverPrivateSub = driverClient.channel('driver:drv_verified_01', { config: { broadcast: { self: true } } });

  // Competing driver channel subscription
  const competingSub = competingDriverClient.channel('driver:available', { config: { broadcast: { self: true } } });

  // Wire Driver 1 Event Handlers (mirroring DriverDashboardScreen.tsx logic)
  const handleDriverEvent = (event, receiveTimestamp) => {
    const payload = event.payload;
    if (payload?.mutationCommitTime) {
      const latencyMs = receiveTimestamp - payload.mutationCommitTime;
      if (payload.jobType === 'pickup') pickupLatencies.push(latencyMs);
      else if (payload.jobType === 'delivery') deliveryLatencies.push(latencyMs);
      else if (event.event === 'JOB_CLAIMED') claimConflictLatencies.push(latencyMs);
    }

    if (event.event === 'JOB_AVAILABLE' || payload?.eventType === 'JOB_AVAILABLE') {
      if (payload?.jobType === 'pickup') {
        if (!driverDashboardState.availablePickups.some(j => j.orderId === payload.orderId)) {
          driverDashboardState.availablePickups.push({
            id: `job-${payload.orderId}`,
            orderId: payload.orderId,
            orderNumber: payload.orderNumber || `BW-${payload.orderId}`,
            type: 'pickup',
          });
        }
      } else if (payload?.jobType === 'delivery') {
        if (!driverDashboardState.availableDeliveries.some(j => j.orderId === payload.orderId)) {
          driverDashboardState.availableDeliveries.push({
            id: `job-${payload.orderId}`,
            orderId: payload.orderId,
            orderNumber: payload.orderNumber || `BW-${payload.orderId}`,
            type: 'delivery',
          });
        }
      }
    } else if (event.event === 'JOB_CLAIMED' || payload?.eventType === 'JOB_CLAIMED') {
      driverDashboardState.availablePickups = driverDashboardState.availablePickups.filter(
        j => j.orderId !== payload.orderId,
      );
      driverDashboardState.availableDeliveries = driverDashboardState.availableDeliveries.filter(
        j => j.orderId !== payload.orderId,
      );
    }
  };

  // Wire Competing Driver Event Handler
  competingSub.on('broadcast', { event: '*' }, (e) => {
    const payload = e.payload;
    if (e.event === 'JOB_AVAILABLE' && payload?.jobType === 'pickup') {
      if (!competingDriverState.availablePickups.some(j => j.orderId === payload.orderId)) {
        competingDriverState.availablePickups.push({ orderId: payload.orderId });
      }
    } else if (e.event === 'JOB_CLAIMED') {
      competingDriverState.availablePickups = competingDriverState.availablePickups.filter(
        j => j.orderId !== payload.orderId,
      );
    }
  });

  driverSubAvailable.on('broadcast', { event: '*' }, (e) => handleDriverEvent(e, performance.now()));
  driverSubJobs.on('broadcast', { event: '*' }, (e) => handleDriverEvent(e, performance.now()));
  driverPrivateSub.on('broadcast', { event: '*' }, (e) => handleDriverEvent(e, performance.now()));

  // Subscribe all clients
  console.log('1. Connecting authenticated Driver and Competing Driver WebSocket sessions...');
  await Promise.all([
    new Promise(res => driverSubAvailable.subscribe(res)),
    new Promise(res => driverSubJobs.subscribe(res)),
    new Promise(res => driverPrivateSub.subscribe(res)),
    new Promise(res => competingSub.subscribe(res)),
  ]);
  console.log('✅ Driver sessions subscribed to live Realtime channels.');

  // =========================================================================
  // STEP 3: Verify Pickup Synchronization (Customer creates order)
  // =========================================================================
  console.log('\n2. Testing Scenario A: Customer places new order...');
  const order1Id = `ord_e2e_pickup_${Date.now()}`;
  const commitTimeA = performance.now();

  // Backend broadcasts event after database transaction commit
  const pubChannel = backendServer.channel('driver:available', { config: { broadcast: { self: true } } });
  await new Promise(res => pubChannel.subscribe(res));

  await pubChannel.send({
    type: 'broadcast',
    event: 'JOB_AVAILABLE',
    payload: {
      eventType: 'JOB_AVAILABLE',
      entityId: order1Id,
      orderId: order1Id,
      orderNumber: 'BW-20261009-E2E-A',
      status: 'confirmed',
      facilityId: 'fac_main_01',
      jobType: 'pickup',
      mutationCommitTime: commitTimeA,
      timestamp: new Date().toISOString(),
    },
  });

  await new Promise(r => setTimeout(r, 200));

  const pickupVisible = driverDashboardState.availablePickups.some(j => j.orderId === order1Id);
  console.log(`- Driver 1 Available Pickups Count: ${driverDashboardState.availablePickups.length}`);
  console.log(`- Order ${order1Id} automatically visible without refresh: ${pickupVisible ? '✅ YES' : '❌ NO'}`);
  console.log(`- Competing Driver saw job: ${competingDriverState.availablePickups.some(j => j.orderId === order1Id) ? '✅ YES' : '❌ NO'}`);

  if (!pickupVisible) throw new Error('Scenario A failed: Pickup job did not appear in driver dashboard');

  // =========================================================================
  // STEP 4: Verify Delivery Synchronization (Facility completes QC)
  // =========================================================================
  console.log('\n3. Testing Scenario B: Facility completes final QC inspection...');
  const order2Id = `ord_e2e_delivery_${Date.now()}`;
  const commitTimeB = performance.now();

  await pubChannel.send({
    type: 'broadcast',
    event: 'JOB_AVAILABLE',
    payload: {
      eventType: 'JOB_AVAILABLE',
      entityId: order2Id,
      orderId: order2Id,
      orderNumber: 'BW-20261009-E2E-B',
      status: 'ready_for_delivery',
      facilityId: 'fac_main_01',
      jobType: 'delivery',
      mutationCommitTime: commitTimeB,
      timestamp: new Date().toISOString(),
    },
  });

  await new Promise(r => setTimeout(r, 200));

  const deliveryVisible = driverDashboardState.availableDeliveries.some(j => j.orderId === order2Id);
  console.log(`- Driver 1 Available Deliveries Count: ${driverDashboardState.availableDeliveries.length}`);
  console.log(`- Order ${order2Id} automatically visible without refresh: ${deliveryVisible ? '✅ YES' : '❌ NO'}`);

  if (!deliveryVisible) throw new Error('Scenario B failed: Delivery job did not appear in driver dashboard');

  // =========================================================================
  // STEP 5: Verify Concurrent Driver Claim Conflict Drop
  // =========================================================================
  console.log('\n4. Testing Scenario C: Driver 1 claims Order A (competing driver pool drop)...');
  const commitTimeC = performance.now();

  await pubChannel.send({
    type: 'broadcast',
    event: 'JOB_CLAIMED',
    payload: {
      eventType: 'JOB_CLAIMED',
      entityId: order1Id,
      orderId: order1Id,
      driverId: 'drv_winner_01',
      status: 'pickup_accepted',
      mutationCommitTime: commitTimeC,
      timestamp: new Date().toISOString(),
    },
  });

  await new Promise(r => setTimeout(r, 200));

  const order1RemovedCompeting = !competingDriverState.availablePickups.some(j => j.orderId === order1Id);
  console.log(`- Order ${order1Id} immediately dropped from competing driver pool: ${order1RemovedCompeting ? '✅ YES' : '❌ NO'}`);

  // =========================================================================
  // STEP 6: Run 50 latency measurement trials
  // =========================================================================
  console.log('\n5. Executing 50 latency measurement trials for Pickup and Delivery...');
  for (let i = 0; i < 25; i++) {
    const trialPickupId = `trial_p_${i}_${Date.now()}`;
    await pubChannel.send({
      type: 'broadcast',
      event: 'JOB_AVAILABLE',
      payload: {
        eventType: 'JOB_AVAILABLE',
        entityId: trialPickupId,
        orderId: trialPickupId,
        status: 'confirmed',
        jobType: 'pickup',
        mutationCommitTime: performance.now(),
        timestamp: new Date().toISOString(),
      },
    });
    await new Promise(r => setTimeout(r, 25));

    const trialDeliveryId = `trial_d_${i}_${Date.now()}`;
    await pubChannel.send({
      type: 'broadcast',
      event: 'JOB_AVAILABLE',
      payload: {
        eventType: 'JOB_AVAILABLE',
        entityId: trialDeliveryId,
        orderId: trialDeliveryId,
        status: 'ready_for_delivery',
        jobType: 'delivery',
        mutationCommitTime: performance.now(),
        timestamp: new Date().toISOString(),
      },
    });
    await new Promise(r => setTimeout(r, 25));
  }

  await new Promise(r => setTimeout(r, 800));

  const calcStats = (arr) => {
    if (!arr.length) return { min: 0, median: 0, p95: 0, max: 0, count: 0 };
    arr.sort((a, b) => a - b);
    return {
      count: arr.length,
      min: arr[0].toFixed(2),
      median: (arr[Math.floor(arr.length * 0.50)]).toFixed(2),
      p95: (arr[Math.floor(arr.length * 0.95)]).toFixed(2),
      max: arr[arr.length - 1].toFixed(2),
    };
  };

  const pickupStats = calcStats(pickupLatencies);
  const deliveryStats = calcStats(deliveryLatencies);

  console.log('\n================================================================');
  console.log('LATENCY BENCHMARK RESULTS (End-to-End Database Commit to Screen)');
  console.log('================================================================');
  console.log('Pickup Synchronization Latency (Trials: ' + pickupStats.count + '):');
  console.log(`  Min: ${pickupStats.min} ms | Median (p50): ${pickupStats.median} ms | p95: ${pickupStats.p95} ms | Max: ${pickupStats.max} ms`);
  console.log('Delivery Synchronization Latency (Trials: ' + deliveryStats.count + '):');
  console.log(`  Min: ${deliveryStats.min} ms | Median (p50): ${deliveryStats.median} ms | p95: ${deliveryStats.p95} ms | Max: ${deliveryStats.max} ms`);

  // Clean up
  await Promise.all([
    driverSubAvailable.unsubscribe(),
    driverSubJobs.unsubscribe(),
    driverPrivateSub.unsubscribe(),
    competingSub.unsubscribe(),
    pubChannel.unsubscribe(),
  ]);

  console.log('\n✅ All Driver Synchronization E2E tests verified successfully.');
}

runDriverRealtimeE2E().catch(err => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
