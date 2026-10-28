const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read backend .env manually
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('--- SUPABASE PUSH & USER AUDIT ---');
  const { data: tokens, error: tokenErr } = await supabase
    .from('device_tokens')
    .select('id, profile_id, push_token, platform, is_active, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(10);

  if (tokenErr) {
    console.error('Error fetching device_tokens:', tokenErr);
    return;
  }

  console.log('\n[DEVICE_TOKENS] (Masked):');
  tokens.forEach(t => {
    const masked = t.push_token ? `${t.push_token.slice(0, 10)}...${t.push_token.slice(-6)}` : 'null';
    console.log(`id: ${t.id} | profile_id: ${t.profile_id} | platform: ${t.platform} | is_active: ${t.is_active} | updated: ${t.updated_at} | token: ${masked}`);
  });

  const profileIds = [...new Set(tokens.map(t => t.profile_id).filter(Boolean))];
  if (profileIds.length > 0) {
    const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
    if (users && users.users) {
      console.log('\n[AUTH USERS]:');
      users.users.filter(u => profileIds.includes(u.id)).forEach(u => {
        console.log(`id: ${u.id} | email: ${u.email} | phone: ${u.phone} | role: ${u.user_metadata?.role || u.role}`);
      });
    }
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .in('id', profileIds);
    console.log('\n[PROFILES TABLE]:', profiles, pErr?.message);

    const { data: customers, error: cErr } = await supabase
      .from('customers')
      .select('*')
      .in('id', profileIds);
    console.log('\n[CUSTOMERS TABLE]:', customers, cErr?.message);
  }

  console.log('\n[RECENT_NOTIFICATIONS]:');
  const { data: notifs, error: notifErr } = await supabase
    .from('notifications')
    .select('id, profile_id, title, message, status, event_type, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (notifErr) {
    console.error('Error fetching notifications:', notifErr);
  } else {
    notifs.forEach(n => {
      console.log(`id: ${n.id} | profile: ${n.profile_id} | status: ${n.status} | event: ${n.event_type} | title: "${n.title}" | msg: "${n.message}" | at: ${n.created_at}`);
    });
  }
}

main().catch(console.error);
