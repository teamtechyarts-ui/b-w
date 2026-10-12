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

async function inspectOrdersAndAudit() {
  const { data: allOrders, error: ordErr } = await supabase.from('orders').select('id, order_number, current_status, customer_id, created_at');
  if (ordErr) console.error('ordErr:', ordErr);

  const { data: auditRows, error: audErr } = await supabase.from('admin_assignment_audit').select('*');
  if (audErr) console.error('audErr:', audErr);

  if (allOrders && auditRows) {
    const auditOrderIds = new Set(auditRows.map(r => r.order_id));
    console.log(`Total orders in DB: ${allOrders.length}`);
    console.log(`Orders referenced by immutable admin_assignment_audit (${auditOrderIds.size}):`, [...auditOrderIds]);
    
    const deletableOrders = allOrders.filter(o => !auditOrderIds.has(o.id));
    console.log(`Unconstrained orders (${deletableOrders.length}):`);
    deletableOrders.forEach(o => console.log(`  - ${o.order_number} (${o.id}) [Status: ${o.current_status}]`));
  }
}

inspectOrdersAndAudit();
