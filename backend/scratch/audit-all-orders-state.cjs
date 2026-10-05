const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAll() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id,order_number,current_status,created_at')
    .order('created_at', { ascending: false });

  console.log(`Total orders in DB: ${orders.length}`);

  for (const o of orders) {
    const { data: ops } = await supabase
      .from('facility_order_operations')
      .select('operation_type,current_status,completed_at,started_at')
      .eq('order_id', o.id)
      .order('started_at', { ascending: true });

    const { data: qcs } = await supabase
      .from('facility_qc_decisions')
      .select('id,approved,created_at')
      .eq('order_id', o.id);

    const { data: packs } = await supabase
      .from('facility_packings')
      .select('id,parcel_id,packed_at')
      .eq('order_id', o.id);

    const hasQcOp = ops?.some(op => op.operation_type === 'quality_check');
    const hasPackOp = ops?.some(op => op.operation_type === 'packaging' && op.completed_at);

    console.log(`Order ${o.order_number} [${o.current_status}]: Operations=${ops?.length ?? 0}, hasPackOp=${hasPackOp}, hasQcOp=${hasQcOp}, QC_Decisions=${qcs?.length ?? 0}, Packings=${packs?.length ?? 0}`);
  }
}
checkAll();
