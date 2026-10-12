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

async function checkAuditTables() {
  const tables = [
    'admin_assignment_audit',
    'admin_staff_action_audit',
    'admin_activity_logs',
    'financial_audit_logs',
    'security_events',
    'qr_scan_logs',
    'order_status_history',
    'facility_order_operations'
  ];

  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`${t}: ERROR (${error.message})`);
    } else {
      console.log(`${t}: ${count} rows`);
    }
  }

  // Check admin_staff_action_audit content
  const { data: staffAudit } = await supabase.from('admin_staff_action_audit').select('*');
  console.log(`\nadmin_staff_action_audit content: ${staffAudit ? staffAudit.length : 0} rows`);
  if (staffAudit && staffAudit.length > 0) {
    console.log(staffAudit.slice(0, 3));
  }
}

checkAuditTables();
