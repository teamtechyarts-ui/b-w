const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('=== TESTING SIGNED UPLOAD URL GENERATION & PUT ===');
  const claimId = '15cb592b-0a0a-4c3d-a3a1-aa51515ed00b';
  const profileId = '4c79d1db-ab9c-4b4a-b353-ac743a152a1b';
  const fileName = 'test-upload.webp';
  const storagePath = `${profileId}/${claimId}/${Date.now()}.webp`;

  console.log('1. Calling createSignedUploadUrl for:', storagePath);
  const { data, error } = await supabase.storage
    .from('customer-claim-photos')
    .createSignedUploadUrl(storagePath);

  console.log('Result:', { data, error });

  if (!data?.signedUrl) {
    console.error('Failed to create signed upload URL');
    return;
  }

  console.log('\n2. Inspecting signed URL:');
  const urlObj = new URL(data.signedUrl);
  console.log('Hostname:', urlObj.hostname);
  console.log('Pathname:', urlObj.pathname);
  console.log('Token parameter present:', urlObj.searchParams.has('token'));

  // Let's create a 50 KB dummy or real buffer
  const sampleBuf = Buffer.alloc(1000, 0x41);

  console.log('\n3. Testing PUT to signed upload URL:');
  const putRes = await fetch(data.signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/webp',
    },
    body: sampleBuf,
  });

  console.log('PUT Status:', putRes.status, putRes.statusText);
  console.log('PUT Response Headers:', Object.fromEntries(putRes.headers.entries()));
  const respText = await putRes.text();
  console.log('PUT Response Body:', respText);
}

main().catch(console.error);
