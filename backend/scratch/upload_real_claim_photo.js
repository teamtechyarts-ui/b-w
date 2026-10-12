const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, 'node_modules/sharp'));
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('=== REAL WEBP CLAIM PHOTO ENCODING & UPLOAD ===');
  const sourceJpg = 'C:\\Users\\pavan\\.gemini\\antigravity-ide\\brain\\cdba879e-9d2c-450b-bc89-d02ef39cefdb\\claim_evidence_garment_1791451963421.jpg';
  
  if (!fs.existsSync(sourceJpg)) {
    throw new Error('Source JPG not found at ' + sourceJpg);
  }

  const originalBuf = fs.readFileSync(sourceJpg);
  console.log('Original JPG Size:', originalBuf.length, 'bytes');

  // Compress to WebP targeting 50-70 KB (< 80 KB limit)
  const webpBuf = await sharp(originalBuf)
    .resize(1024, 768, { fit: 'inside' })
    .webp({ quality: 78, effort: 5 })
    .toBuffer();

  console.log('Generated WebP Size:', webpBuf.length, 'bytes');

  if (webpBuf.length >= 81920) {
    throw new Error(`WebP buffer is too large: ${webpBuf.length} bytes (must be < 81920)`);
  }

  // Magic bytes check
  const riff = webpBuf.subarray(0, 4).toString('ascii');
  const webp = webpBuf.subarray(8, 12).toString('ascii');
  console.log('Magic Bytes Check:', { riff, webp, valid: riff === 'RIFF' && webp === 'WEBP' });
  if (riff !== 'RIFF' || webp !== 'WEBP') {
    throw new Error('Invalid WebP magic bytes');
  }

  // Decode check via sharp metadata
  const meta = await sharp(webpBuf).metadata();
  console.log('Decoded WebP Metadata:', {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    channels: meta.channels,
    size: webpBuf.length,
  });

  const storagePath = '4c79d1db-ab9c-4b4a-b353-ac743a152a1b/15cb592b-0a0a-4c3d-a3a1-aa51515ed00b/00000000-0000-4000-8000-000000000001.webp';
  console.log('\nUploading real WebP photo to Supabase Storage at:', storagePath);

  const { data: uploadData, error: uErr } = await supabase.storage
    .from('customer-claim-photos')
    .upload(storagePath, webpBuf, {
      contentType: 'image/webp',
      upsert: true,
    });

  if (uErr) {
    console.error('Upload Error:', uErr);
    throw uErr;
  }
  console.log('Upload successful:', uploadData);

  // Verify signed read URL
  const { data: signedData, error: sErr } = await supabase.storage
    .from('customer-claim-photos')
    .createSignedUrl(storagePath, 3600);

  if (sErr || !signedData?.signedUrl) {
    throw new Error('Failed to generate signed URL: ' + JSON.stringify(sErr));
  }

  console.log('Generated Signed Read URL successfully.');
  const testFetch = await fetch(signedData.signedUrl);
  console.log('Signed URL HTTP Test:', {
    status: testFetch.status,
    statusText: testFetch.statusText,
    contentType: testFetch.headers.get('content-type'),
    contentLength: testFetch.headers.get('content-length'),
  });

  const downloadedBuf = Buffer.from(await testFetch.arrayBuffer());
  console.log('Downloaded Byte Size:', downloadedBuf.length);
  const downloadMeta = await sharp(downloadedBuf).metadata();
  console.log('Downloaded Image Metadata:', {
    format: downloadMeta.format,
    width: downloadMeta.width,
    height: downloadMeta.height,
  });
}

main().catch(console.error);
