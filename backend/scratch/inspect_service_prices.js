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

async function checkServicePrices() {
  const { data: globalPrices } = await supabase.from('service_prices').select('id, service_id, facility_id, price').is('facility_id', null);
  const { data: facilityPrices } = await supabase.from('service_prices').select('id, service_id, facility_id, price').not('facility_id', 'is', null);

  console.log(`Global service prices (facility_id IS NULL): ${globalPrices?.length || 0}`);
  console.log(`Facility-specific service prices (facility_id IS NOT NULL): ${facilityPrices?.length || 0}`);
  if (facilityPrices?.length > 0) {
    console.log('Sample facility-specific prices:', facilityPrices.slice(0, 5));
  }
}

checkServicePrices();
