const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function parseWebPHeader(buf) {
  if (buf.length < 30) return null;
  const riff = buf.subarray(0, 4).toString('ascii');
  const webp = buf.subarray(8, 12).toString('ascii');
  if (riff !== 'RIFF' || webp !== 'WEBP') return null;
  return {
    valid: true,
    riff,
    webp,
    size: buf.length,
    chunk: buf.subarray(12, 16).toString('ascii')
  };
}

async function main() {
  console.log('=== REAL CUSTOMER CLAIM PHOTO VERIFICATION ===');
  const claimId = '15cb592b-0a0a-4c3d-a3a1-aa51515ed00b';
  const profileId = '4c79d1db-ab9c-4b4a-b353-ac743a152a1b';

  // 1. Fetch current photos in DB
  const { data: photos, error: pErr } = await supabase
    .from('customer_claim_photos')
    .select('*')
    .eq('claim_id', claimId);

  console.log('Current DB Photos for claim:', photos);

  for (const photo of photos || []) {
    console.log(`\nInspecting DB photo: ${photo.id}, path: ${photo.storage_path}`);
    const { data: signed } = await supabase.storage
      .from('customer-claim-photos')
      .createSignedUrl(photo.storage_path, 3600);

    if (signed?.signedUrl) {
      const res = await fetch(signed.signedUrl);
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      console.log('Current Object Size:', buf.length, 'bytes');
      console.log('WebP Header:', parseWebPHeader(buf));
    }
  }
}

main().catch(console.error);
