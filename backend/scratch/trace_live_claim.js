const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const orderId = '63441735-a88e-43de-b958-06c7a32d8353';
  console.log('=== Checking Order and Customer in DB ===');
  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select('*, customers(profile_id, profiles(phone, full_name))')
    .eq('id', orderId)
    .single();

  if (oErr) {
    console.error('Order query error:', oErr);
    return;
  }
  console.log('Order found:', {
    id: order.id,
    order_number: order.order_number,
    status: order.current_status,
    customer_id: order.customer_id,
    profile_id: order.customers?.profile_id,
  });

  const profileId = order.customers?.profile_id;

  // Let's get user from auth.users or create a custom JWT or session to test endpoints
  const { data: authUser, error: uErr } = await supabase.auth.admin.getUserById(profileId);
  console.log('Auth user found:', authUser?.user?.email || authUser?.user?.phone || 'ID: ' + profileId);

  // Sign in or generate token for this profile
  // In Supabase, we can use admin.generateLink or similar, or sign a custom token with JWT secret
  // Or let's test via direct NestJS controller / service or fetch against localhost:3000
  console.log('\n=== Checking Claims via Supabase Query ===');
  const { data: claims, error: cErr } = await supabase
    .from('customer_order_claims')
    .select('*, customer_claim_photos(*)')
    .eq('order_id', orderId);

  console.log('Claims found:', JSON.stringify(claims, null, 2));

  console.log('\n=== Checking Signed URL generation for photos ===');
  for (const claim of claims || []) {
    for (const photo of claim.customer_claim_photos || []) {
      const { data: sData, error: sErr } = await supabase.storage
        .from('customer-claim-photos')
        .createSignedUrl(photo.storage_path, 3600);
      console.log('Photo ID:', photo.id, 'Storage Path:', photo.storage_path);
      console.log('Signed URL data:', sData);
      console.log('Signed URL error:', sErr);

      if (sData?.signedUrl) {
        const fetchRes = await fetch(sData.signedUrl);
        console.log('HTTP Fetch Status:', fetchRes.status, 'Type:', fetchRes.headers.get('content-type'), 'Length:', fetchRes.headers.get('content-length'));
      }
    }
  }

  console.log('\n=== Checking Payment Orders for Order ===');
  const { data: payments, error: payErr } = await supabase
    .from('payment_orders')
    .select('*')
    .eq('order_id', orderId);
  console.log('Payment orders:', payments, 'Error:', payErr);
}

main().catch(console.error);
