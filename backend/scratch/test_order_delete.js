const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.substring(1, v.length - 1);
      }
      env[k] = v;
    }
  }
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

async function testSingleOrderDelete() {
  const testOrderId = '8798467d-b96e-4e2c-a801-d38bc79223fc'; // BW-20261008-40237D8A

  console.log('1. Deleting non-cascading navigation events for test order...');
  const { error: navErr } = await supabase.from('driver_navigation_events').delete().eq('order_id', testOrderId);
  if (navErr) console.error('navErr:', navErr);

  console.log('2. Deleting qr scan logs for test order...');
  const { error: qrErr } = await supabase.from('qr_scan_logs').delete().eq('order_id', testOrderId);
  if (qrErr) console.error('qrErr:', qrErr);

  console.log('3. Deleting test order...');
  const { error: ordErr } = await supabase.from('orders').delete().eq('id', testOrderId);
  if (ordErr) {
    console.error('ordErr:', ordErr);
  } else {
    console.log('SUCCESS: Order deleted cleanly with all cascading children!');
  }
}

testSingleOrderDelete();
