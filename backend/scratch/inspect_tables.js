const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectTables() {
  console.log('=== PROFILES SAMPLE ===');
  const { data: profs, error: profErr } = await supabase.from('profiles').select('*').limit(3);
  if (profErr) console.error('profErr:', profErr);
  else console.log('profiles sample:', profs);

  console.log('=== DRIVERS SAMPLE ===');
  const { data: drivers, error: drvErr } = await supabase.from('drivers').select('*').limit(3);
  if (drvErr) console.error('drvErr:', drvErr);
  else console.log('drivers sample:', drivers);

  console.log('=== ORDERS SAMPLE ===');
  const { data: orders, error: ordErr } = await supabase.from('orders').select('*').limit(3);
  if (ordErr) console.error('ordErr:', ordErr);
  else console.log('orders sample:', orders);

  console.log('=== DRIVER ASSIGNMENTS SAMPLE ===');
  const { data: assigns, error: assErr } = await supabase.from('driver_assignments').select('*').limit(3);
  if (assErr) console.error('assErr:', assErr);
  else console.log('assignments sample:', assigns);

  console.log('=== CUSTOMERS SAMPLE ===');
  const { data: custs, error: custErr } = await supabase.from('customers').select('*').limit(3);
  if (custErr) console.error('custErr:', custErr);
  else console.log('customers sample:', custs);

  console.log('=== ADMIN ASSIGNMENT AUDIT FULL ===');
  const { data: audits, error: audErr } = await supabase.from('admin_assignment_audit').select('*');
  if (audErr) console.error('audErr:', audErr);
  else console.log('audits full:', audits);
}

inspectTables().catch(console.error);
