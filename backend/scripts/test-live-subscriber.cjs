const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function testLiveClientSubscription() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('--- TESTING LIVE SEPARATE SUBSCRIBER & PUBLISHER OVER REALTIME WEBSOCKET ---');

  // Client 1: Simulated Mobile Client (using Anon Key / authenticated user session)
  const clientSubscriber = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  // Client 2: Backend Service Publisher (using Service Role Key)
  const backendPublisher = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const channelName = 'order:live_subscription_verification';
  const subChannel = clientSubscriber.channel(channelName);
  const pubChannel = backendPublisher.channel(channelName);

  let receivedEvent = null;
  const eventPromise = new Promise((resolve) => {
    subChannel.on('broadcast', { event: 'ORDER_STATUS_CHANGED' }, (payload) => {
      receivedEvent = payload;
      resolve(payload);
    });
  });

  // Subscribe mobile client
  const subStatus = await new Promise((resolve) => {
    subChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve(status);
    });
  });
  console.log(`Subscriber Channel Status: ${subStatus}`);

  // Subscribe backend publisher
  const pubStatus = await new Promise((resolve) => {
    pubChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve(status);
    });
  });
  console.log(`Publisher Channel Status: ${pubStatus}`);

  // Send message from Backend Publisher to Mobile Subscriber
  const sendResult = await pubChannel.send({
    type: 'broadcast',
    event: 'ORDER_STATUS_CHANGED',
    payload: {
      orderId: 'ord_verification_test_123',
      status: 'in_transit_to_facility',
      timestamp: new Date().toISOString(),
    },
  });
  console.log(`Broadcast Send Status: ${sendResult}`);

  // Wait for delivery to subscriber (with 5s timeout)
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Subscription timeout after 5000ms')), 5000),
  );

  const received = await Promise.race([eventPromise, timeoutPromise]);
  console.log('✅ Realtime Event Successfully Received on Separate Client Subscriber:', received);

  await subChannel.unsubscribe();
  await pubChannel.unsubscribe();

  console.log('--- LIVE REALTIME SUBSCRIPTION VERIFICATION: 100% PASSED ---');
}

testLiveClientSubscription().catch((err) => {
  console.error('Subscription test failed:', err);
  process.exit(1);
});
