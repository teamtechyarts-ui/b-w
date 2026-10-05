const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== VERIFYING PROCESSING HISTORY & STAGE STATES ===');

  // Find active test order
  const { data: orders, error: orderErr } = await supabase
    .from('orders')
    .select('id,order_number,facility_id,current_status')
    .limit(5);

  if (orderErr || !orders.length) {
    console.error('No orders found:', orderErr);
    process.exit(1);
  }

  console.log(`[PASS] Found ${orders.length} sample orders`);

  // Test selecting facility_order_operations with canonical columns
  const { data: operations, error: opErr } = await supabase
    .from('facility_order_operations')
    .select('id,operation_type,current_status,started_at,completed_at,performed_by,notes')
    .limit(5);

  if (opErr) {
    console.error('[FAIL] Querying facility_order_operations failed:', opErr);
    process.exit(1);
  }

  console.log('[PASS] Querying facility_order_operations with canonical columns succeeded:', operations.length, 'operations');

  // Verify QC decisions table query
  const { data: qc, error: qcErr } = await supabase
    .from('facility_qc_decisions')
    .select('id,operation_id,cycle_number,approved,rewash_required,defect_code,reason,affected_item_ids,decided_by,created_at')
    .limit(5);

  if (qcErr) {
    console.error('[FAIL] Querying facility_qc_decisions failed:', qcErr);
    process.exit(1);
  }

  console.log('[PASS] Querying facility_qc_decisions succeeded:', qc.length, 'decisions');

  // Verify intake discrepancies table query
  const { data: disc, error: discErr } = await supabase
    .from('facility_intake_discrepancies')
    .select('id,order_id,kind,expected_quantity,counted_quantity,status')
    .limit(5);

  if (discErr) {
    console.error('[FAIL] Querying facility_intake_discrepancies failed:', discErr);
    process.exit(1);
  }

  console.log('[PASS] Querying facility_intake_discrepancies succeeded:', disc.length, 'discrepancies');

  console.log('=== ALL DATABASE QUERIES VERIFIED CLEANLY ===');
}

run();
