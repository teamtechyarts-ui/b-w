const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkBackendLogic() {
  const orderId = '3a467513-a2a3-4bf3-814c-f8f67b4a93d2';

  // 1. Emulate processingHistory logic
  const { data: operations } = await supabase
    .from('facility_order_operations')
    .select('id,operation_type,current_status,started_at,completed_at,performed_by,notes')
    .eq('order_id', orderId)
    .order('started_at', { ascending: true })
    .order('id', { ascending: true });

  const stages = (operations ?? [])
    .filter((operation) =>
      ['washing', 'drying', 'ironing', 'folding', 'packaging'].includes(
        operation.operation_type,
      ),
    )
    .map((operation) => ({
      id: operation.id,
      operation_type: operation.operation_type,
      current_status: operation.current_status,
      started_at: operation.started_at,
      completed_at: operation.completed_at,
      started_by: operation.performed_by,
      completed_by: operation.completed_at ? operation.performed_by : null,
      performed_by: operation.performed_by,
      rewash_cycle: 0,
    }));

  console.log('Backend Processing stages:', stages);

  // 2. Emulate packingDetails logic
  const [packings, policy] = await Promise.all([
    supabase.from('facility_packings').select('id,cycle_number').eq('order_id', orderId),
    supabase.from('facility_packing_policy_orders').select('order_id').eq('order_id', orderId).maybeSingle()
  ]);

  const packingRequired = !!policy.data;
  console.log('packingRequired from backend packingDetails:', packingRequired);
  console.log('packings history length:', (packings.data || []).length);
}

checkBackendLogic().catch(console.error);
