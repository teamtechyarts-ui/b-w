const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAllAssignments() {
  const { data: assignments, error } = await supabase
    .from('driver_assignments')
    .select('*')
    .order('assigned_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching driver_assignments:', error);
    return;
  }
  console.log('All recent assignments:', JSON.stringify(assignments, null, 2));

  if (assignments && assignments.length > 0) {
    for (const a of assignments) {
      console.log(`\n--- Order for assignment ${a.id} (${a.assignment_type}, status: ${a.status}) ---`);
      const { data: order } = await supabase.from('orders').select('*').eq('id', a.order_id).single();
      console.log('Order:', JSON.stringify(order, null, 2));
      const { data: navEvents } = await supabase
        .from('driver_navigation_events')
        .select('*')
        .eq('order_id', a.order_id)
        .order('created_at', { ascending: true });
      console.log('Nav events:', JSON.stringify(navEvents, null, 2));
    }
  }
}

inspectAllAssignments().catch(console.error);
