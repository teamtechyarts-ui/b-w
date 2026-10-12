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

async function inspectOnlyProfileRoles() {
  const { data: prs, error: prErr } = await supabase.from('profile_roles').select('profile_id, role_id, roles(name, id)');
  console.log('=== PROFILE ROLES COUNT:', prs?.length);
  prs.forEach(r => {
    console.log(`Profile: ${r.profile_id} -> Role: ${r.roles?.name} (${r.role_id})`);
  });
}

inspectOnlyProfileRoles();
