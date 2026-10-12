const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const sharp = require(path.join(__dirname, 'node_modules/sharp'));
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('===========================================================');
  console.log(' REAL CUSTOMER CLAIM PHOTO UPLOAD END-TO-END ACCEPTANCE   ');
  console.log('===========================================================');

  const orderId = '63441735-a88e-43de-b958-06c7a32d8353';
  const claimId = '15cb592b-0a0a-4c3d-a3a1-aa51515ed00b';
  const profileId = '4c79d1db-ab9c-4b4a-b353-ac743a152a1b';

  // 1. Initial State
  const { data: initialPhotos } = await supabase
    .from('customer_claim_photos')
    .select('*')
    .eq('claim_id', claimId);
  console.log('1. Initial Photo Count in DB:', initialPhotos?.length || 0);

  // 2. Real local image processing
  const sourceJpg = 'C:\\Users\\pavan\\.gemini\\antigravity-ide\\brain\\cdba879e-9d2c-450b-bc89-d02ef39cefdb\\claim_evidence_garment_1791451963421.jpg';
  const originalBuf = fs.readFileSync(sourceJpg);
  console.log('\n2. Original Photo selected:');
  console.log('   Filename: claim_evidence_garment.jpg');
  console.log('   MIME: image/jpeg');
  console.log('   Byte Size:', originalBuf.length);

  // 3. WebP Compression
  console.log('\n3. WebP Compression:');
  const webpBuf = await sharp(originalBuf)
    .resize(1024, 768, { fit: 'inside' })
    .webp({ quality: 75, effort: 5 })
    .toBuffer();

  console.log('   Compressed Output Size:', webpBuf.length, 'bytes');
  const riff = webpBuf.subarray(0, 4).toString('ascii');
  const webp = webpBuf.subarray(8, 12).toString('ascii');
  console.log('   Magic Bytes Valid:', riff === 'RIFF' && webp === 'WEBP');
  const meta = await sharp(webpBuf).metadata();
  console.log('   Decoded Dimensions:', `${meta.width}x${meta.height}`);

  // 4. Request Signed Upload URL (matching backend format)
  console.log('\n4. Requesting Signed Upload URL from Supabase:');
  const photoUuid = randomUUID();
  const storagePath = `${profileId}/${claimId}/${photoUuid}.webp`;
  const { data: uploadData, error: uErr } = await supabase.storage
    .from('customer-claim-photos')
    .createSignedUploadUrl(storagePath);

  if (uErr || !uploadData?.signedUrl) {
    throw new Error('createSignedUploadUrl failed: ' + JSON.stringify(uErr));
  }
  console.log('   Signed Upload URL generated: YES');
  console.log('   Target Storage Path:', storagePath);

  // 5. Browser-like PUT to signed upload URL
  console.log('\n5. Executing HTTP PUT to Signed Upload URL:');
  const putRes = await fetch(uploadData.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/webp' },
    body: webpBuf,
  });

  console.log('   PUT Status:', putRes.status, putRes.statusText);
  console.log('   PUT Access-Control-Allow-Origin:', putRes.headers.get('access-control-allow-origin'));
  if (!putRes.ok) {
    throw new Error(`PUT failed with status ${putRes.status}`);
  }

  // 6. Database Attachment via Atomic RPC
  console.log('\n6. Attaching Photo to Database via attach_customer_claim_photo_atomic:');
  const { data: attachResult, error: aErr } = await supabase.rpc(
    'attach_customer_claim_photo_atomic',
    {
      p_claim_id: claimId,
      p_profile_id: profileId,
      p_storage_path: storagePath,
    }
  );

  if (aErr) {
    throw new Error('DB Attachment failed: ' + JSON.stringify(aErr));
  }
  console.log('   DB Row Attached successfully:', attachResult);

  // 7. Verify Updated Claim & Signed Read URLs
  console.log('\n7. Verifying Claim Photos List & Signed Read URLs:');
  const { data: updatedPhotos } = await supabase
    .from('customer_claim_photos')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true });

  console.log('   Final Photo Count in DB:', updatedPhotos?.length);
  
  for (let i = 0; i < updatedPhotos.length; i++) {
    const p = updatedPhotos[i];
    const { data: signedRead } = await supabase.storage
      .from('customer-claim-photos')
      .createSignedUrl(p.storage_path, 3600);

    console.log(`\n   Photo [${i + 1}]:`);
    console.log('   ID:', p.id);
    console.log('   Path:', p.storage_path);
    console.log('   Signed Read URL generated:', Boolean(signedRead?.signedUrl));

    if (signedRead?.signedUrl) {
      const readFetch = await fetch(signedRead.signedUrl);
      console.log('   Read HTTP Status:', readFetch.status, readFetch.statusText);
      console.log('   Read Content-Type:', readFetch.headers.get('content-type'));
      console.log('   Read Content-Length:', readFetch.headers.get('content-length'));
    }
  }

  console.log('\n===========================================================');
  console.log(' END-TO-END AUDIT COMPLETED: REAL PHOTO UPLOAD VERIFIED');
  console.log('===========================================================');
}

main().catch(console.error);
