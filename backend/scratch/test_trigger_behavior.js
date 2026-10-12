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

async function testTriggerBehavior() {
  // Check first row of admin_assignment_audit
  const { data: rows } = await supabase.from('admin_assignment_audit').select('id').limit(1);
  if (rows && rows.length > 0) {
    const targetId = rows[0].id;
    console.log('Testing delete on actual audit row:', targetId);
    const { error } = await supabase.from('admin_assignment_audit').delete().eq('id', targetId);
    console.log('Result:', error ? `Blocked by trigger as expected: [${error.code}] ${error.message}` : 'Deleted successfully');
  }
}

testTriggerBehavior();
