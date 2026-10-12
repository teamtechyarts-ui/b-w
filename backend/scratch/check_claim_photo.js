const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('--- 1. Fetching customer_claim_photos row ---');
  const { data: photos, error: pErr } = await supabase
    .from('customer_claim_photos')
    .select('*');
  console.log('Photos in DB:', photos, 'Error:', pErr);

  if (!photos || photos.length === 0) {
    console.log('No photos found in table');
    return;
  }

  for (const photo of photos) {
    console.log('\n--- 2. Checking photo object in storage ---', photo.storage_path);
    const { data: signedData, error: signedErr } = await supabase
      .storage
      .from('customer-claim-photos')
      .createSignedUrl(photo.storage_path, 3600);
    
    console.log('Signed URL result:', {
      signedUrlGenerated: Boolean(signedData?.signedUrl),
      error: signedErr,
    });

    if (signedData?.signedUrl) {
      console.log('--- 3. Testing signed URL HTTP fetch ---');
      try {
        const resp = await fetch(signedData.signedUrl);
        console.log('Fetch Status:', resp.status, resp.statusText);
        console.log('Content-Type:', resp.headers.get('content-type'));
        console.log('Content-Length:', resp.headers.get('content-length'));
        const arrayBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        console.log('Actual Received Bytes:', buf.length);
        console.log('First 16 bytes (hex):', buf.subarray(0, 16).toString('hex'));
        console.log('First 16 bytes (ascii):', buf.subarray(0, 16).toString('ascii').replace(/[^\x20-\x7E]/g, '.'));
        const isWebP = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
        console.log('Is valid WebP container header:', isWebP);
      } catch (fErr) {
        console.error('Fetch error:', fErr);
      }
    }
  }
}

main().catch(console.error);
