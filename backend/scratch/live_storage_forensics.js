const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function parseWebPDimensions(buffer) {
  // Check RIFF header and WEBP signature
  if (buffer.length < 30) return null;
  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');
  if (riff !== 'RIFF' || webp !== 'WEBP') return null;

  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType === 'VP8 ') {
    // Lossy VP8
    // 3 bytes sync code at offset 23: 0x9d 0x01 0x2a
    const startCode = buffer.subarray(23, 26);
    if (startCode[0] === 0x9d && startCode[1] === 0x01 && startCode[2] === 0x2a) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { format: 'VP8 (Lossy)', width, height };
    }
  } else if (chunkType === 'VP8L') {
    // Lossless VP8L
    // 1 byte signature 0x2f at offset 20
    if (buffer[20] === 0x2f) {
      const b1 = buffer[21];
      const b2 = buffer[22];
      const b3 = buffer[23];
      const b4 = buffer[24];
      const width = 1 + (((b2 & 0x3f) << 8) | b1);
      const height = 1 + ((((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)));
      return { format: 'VP8L (Lossless)', width, height };
    }
  } else if (chunkType === 'VP8X') {
    // Extended VP8X
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { format: 'VP8X (Extended)', width, height };
  }
  return { format: chunkType, width: 0, height: 0 };
}

async function main() {
  console.log('====================================================');
  console.log(' LIVE SUPABASE PRODUCTION STORAGE FORENSIC AUDIT   ');
  console.log('====================================================');
  console.log('Supabase URL:', supabaseUrl);
  const projectIdMatch = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  console.log('Supabase Project ID:', projectIdMatch ? projectIdMatch[1] : 'unknown');

  // 1. Check Bucket
  console.log('\n--- 1. Bucket Inspection: customer-claim-photos ---');
  const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
  if (bErr) {
    console.error('listBuckets error:', bErr);
  }
  const claimBucket = buckets?.find(b => b.name === 'customer-claim-photos');
  console.log('Bucket exists:', Boolean(claimBucket));
  if (claimBucket) {
    console.log('Bucket details:', {
      id: claimBucket.id,
      name: claimBucket.name,
      public: claimBucket.public,
      file_size_limit: claimBucket.file_size_limit,
      allowed_mime_types: claimBucket.allowed_mime_types,
    });
  }

  // 2. Query DB customer_claim_photos table
  console.log('\n--- 2. Database Record: customer_claim_photos ---');
  const { data: dbPhotos, error: pErr } = await supabase
    .from('customer_claim_photos')
    .select('*, customer_order_claims(*)');
  console.log('DB Photos count:', dbPhotos?.length || 0);
  console.log('DB Photos:', JSON.stringify(dbPhotos, null, 2));

  // 3. Inspect Storage Objects
  console.log('\n--- 3. Storage Objects Inspection ---');
  if (dbPhotos && dbPhotos.length > 0) {
    for (const photo of dbPhotos) {
      console.log(`\nInspecting Photo [${photo.id}]:`);
      console.log('Storage path:', photo.storage_path);

      // Generate signed URL
      const { data: signedData, error: sErr } = await supabase.storage
        .from('customer-claim-photos')
        .createSignedUrl(photo.storage_path, 3600);

      console.log('Signed URL generated:', Boolean(signedData?.signedUrl));
      if (sErr) console.error('createSignedUrl error:', sErr);

      if (signedData?.signedUrl) {
        const signedUrlObj = new URL(signedData.signedUrl);
        console.log('Signed URL Hostname:', signedUrlObj.hostname);
        console.log('Signed URL Pathname:', signedUrlObj.pathname);
        console.log('Signed URL Token param present:', signedUrlObj.searchParams.has('token'));

        // Test direct HTTP fetch
        const resp = await fetch(signedData.signedUrl);
        console.log('HTTP Status:', resp.status, resp.statusText);
        console.log('Content-Type:', resp.headers.get('content-type'));
        console.log('Content-Length:', resp.headers.get('content-length'));

        const arrayBuf = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        console.log('Actual Bytes Received:', buffer.length);
        const dimensions = parseWebPDimensions(buffer);
        console.log('Parsed WebP Header / Dimensions:', dimensions);

        const isTestObject = buffer.length < 500 || (dimensions && (dimensions.width <= 10 || dimensions.height <= 10));
        console.log('Is minimal test object vs real photo:', isTestObject ? 'MINIMAL TEST OBJECT' : 'REAL PHOTOGRAPH');
      }
    }
  }

  // 4. Test Render Production Endpoint vs Localhost Backend
  console.log('\n--- 4. Backend Endpoints Health Check ---');
  try {
    const renderResp = await fetch('https://b-w-pxi8.onrender.com/v1/health').catch(e => ({ status: 'fetch_failed', message: e.message }));
    console.log('Render Production Backend (/v1/health):', renderResp.status || renderResp);
  } catch (err) {
    console.log('Render Production Backend check failed:', err.message);
  }

  try {
    const localResp = await fetch('http://127.0.0.1:3000/v1/health').catch(e => ({ status: 'fetch_failed', message: e.message }));
    console.log('Localhost Backend (/v1/health):', localResp.status || localResp);
  } catch (err) {
    console.log('Localhost Backend check failed:', err.message);
  }
}

main().catch(console.error);
