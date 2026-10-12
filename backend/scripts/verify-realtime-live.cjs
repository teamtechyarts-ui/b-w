const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  console.log(`Connecting to Supabase: ${url}`);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const tablesToVerify = [
    'orders',
    'driver_assignments',
    'order_status_history',
    'customer_order_claims',
    'refund_requests',
    'facility_order_operations',
    'drivers',
    'notifications',
  ];

  console.log('\n--- VERIFYING EXACT TABLE EXISTENCE & ACCESS ---');
  for (const table of tablesToVerify) {
    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.log(`❌ Table [${table}]: ERROR -> ${error.message} (Code: ${error.code})`);
    } else {
      console.log(`✅ Table [${table}]: Verified Accessible (Row count: ${count ?? 0})`);
    }
  }

  console.log('\n--- VERIFYING CHANNEL BROADCAST CAPABILITY ---');
  const channel = supabase.channel('verify-broadcast-test');
  const subscriptionStatus = await new Promise((resolve) => {
    channel.subscribe((status) => {
      resolve(status);
    });
  });
  console.log(`Channel subscription status: ${subscriptionStatus}`);

  const broadcastResult = await channel.send({
    type: 'broadcast',
    event: 'VERIFY_EVENT',
    payload: { test: true, timestamp: new Date().toISOString() },
  });
  console.log(`Broadcast send result: ${broadcastResult}`);

  await channel.unsubscribe();
  console.log('\nLive verification script finished successfully.');
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
