const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkOrder() {
  const orderId = '3a467513-a2a3-4bf3-814c-f8f67b4a93d2';
  console.log('Inspecting order:', orderId);

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
  console.log('ORDER:', JSON.stringify(order, null, 2));

  const { data: operations } = await supabase
    .from('facility_order_operations')
    .select('*')
    .eq('order_id', orderId);
  console.log('FACILITY_ORDER_OPERATIONS:', JSON.stringify(operations, null, 2));

  const { data: packings } = await supabase
    .from('facility_packings')
    .select('*')
    .eq('order_id', orderId);
  console.log('FACILITY_PACKINGS:', JSON.stringify(packings, null, 2));

  const { data: qc } = await supabase
    .from('facility_qc_decisions')
    .select('*')
    .eq('order_id', orderId);
  console.log('FACILITY_QC_DECISIONS:', JSON.stringify(qc, null, 2));

  const { data: policy } = await supabase
    .from('facility_packing_policy_orders')
    .select('*')
    .eq('order_id', orderId);
  console.log('FACILITY_PACKING_POLICY_ORDERS:', JSON.stringify(policy, null, 2));

  const { data: discrepancies } = await supabase
    .from('facility_intake_discrepancies')
    .select('*')
    .eq('order_id', orderId);
  console.log('FACILITY_INTAKE_DISCREPANCIES:', JSON.stringify(discrepancies, null, 2));
}

checkOrder().catch(console.error);
