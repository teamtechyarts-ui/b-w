const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkPostState() {
  const tables = [
    'orders', 'order_items', 'order_status_history', 'driver_assignments',
    'admin_assignment_audit', 'facility_order_operations', 'garment_inspections',
    'order_qr_codes', 'order_otps', 'payment_orders', 'delivery_proofs',
    'driver_navigation_events', 'driver_trip_locations', 'customers', 'facilities',
    'services', 'service_categories', 'service_prices', 'drivers', 'facility_employees', 'profiles'
  ];

  console.log('=== POST-CLEANUP EXACT ROW COUNTS ===');
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${t.padEnd(28)}: ${count}`);
  }
}

checkPostState().catch(console.error);
