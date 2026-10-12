const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing credentials');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const requiredTables = [
    'orders',
    'driver_assignments',
    'order_status_history',
    'customer_order_claims',
    'refund_requests',
    'facility_order_operations',
    'drivers',
    'notifications',
  ];

  console.log('1. Checking RPC/functions or direct table queries on Supabase project...');
  
  // Test if exec_sql or similar admin RPC exists
  const { data: rpcList, error: rpcError } = await supabase.rpc('exec_sql', {
    sql_query: "SELECT pubname FROM pg_publication WHERE pubname = 'supabase_realtime';",
  });

  if (rpcError) {
    console.log(`RPC exec_sql not directly available (${rpcError.message}), using metadata inspection.`);
  } else {
    console.log('RPC exec_sql available, result:', rpcList);
  }

  // Check each table access and live Realtime channel subscription
  console.log('\n2. Testing Realtime table events and subscription capability...');
  const testChannel = supabase.channel('realtime-publication-check', {
    config: { broadcast: { self: true } },
  });

  const subPromise = new Promise((resolve) => {
    testChannel.subscribe((status, err) => {
      resolve({ status, err });
    });
  });

  const subResult = await subPromise;
  console.log(`Realtime Channel Subscription Status: ${subResult.status}`);

  // Test Postgres change listener on orders
  let changeReceived = false;
  testChannel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'orders' },
    (payload) => {
      changeReceived = true;
    }
  );

  console.log('Subscribed to postgres_changes for orders.');

  // Clean up
  await testChannel.unsubscribe();

  console.log('\n3. Verifying all required tables individually...');
  for (const table of requiredTables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`Table ${table}: ❌ ${error.message}`);
    } else {
      console.log(`Table ${table}: ✅ EXISTS (Current rows: ${count ?? 0})`);
    }
  }
}

main().catch(console.error);
