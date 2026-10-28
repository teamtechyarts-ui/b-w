const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const adb = 'C:\\Users\\pavan\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';

(async () => {
  console.log('1. Ensuring screen awake and launcher focused...');
  execSync(`"${adb}" shell input keyevent 224`);
  execSync(`"${adb}" shell input keyevent 3`);

  console.log('2. Authenticating customer...');
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: 'pavanamirishetti1@gmail.com'
  });
  const { data: sessionData } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  const token = sessionData.session.access_token;

  console.log('3. Placing live customer order via POST /v1/orders...');
  const idempotencyKey = crypto.randomUUID();
  const orderPayload = JSON.stringify({
    idempotencyKey,
    pickupAddressId: '71e4ffb0-75ed-436b-b4b4-6e0c7fbb005d',
    deliveryAddressId: '71e4ffb0-75ed-436b-b4b4-6e0c7fbb005d',
    pickupScheduledAt: new Date(Date.now() + 86400000).toISOString(),
    pickupSlotLabel: 'Morning (09:00 - 12:00)',
    paymentMethod: 'cash_on_delivery',
    termsAccepted: true,
    items: [
      {
        serviceId: '46d87c27-e75a-4476-a7fb-3862ad3ae815',
        itemName: 'Verified Customer Order Load',
        quantity: 2
      }
    ]
  });

  const req = http.request('http://localhost:3000/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(orderPayload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', async () => {
      console.log('Order creation statusCode:', res.statusCode);
      const json = JSON.parse(body);
      console.log('Order created:', {
        orderId: json.id,
        orderNumber: json.order_number,
        status: json.current_status
      });

      console.log('4. Waiting 4 seconds for Firebase Cloud Messaging delivery to Android...');
      await new Promise(r => setTimeout(r, 4000));

      console.log('5. Checking dumpsys notification for order number...');
      const dumpsysOut = execSync(`"${adb}" shell dumpsys notification --noredact`).toString();
      const hasOrderNotification = dumpsysOut.includes(json.order_number);
      console.log(`Notification for order #${json.order_number} present in dumpsys:`, hasOrderNotification);

      console.log('6. Expanding notification shade and capturing screenshot...');
      execSync(`"${adb}" shell cmd statusbar expand-notifications`);
      await new Promise(r => setTimeout(r, 1200));
      execSync(`"${adb}" shell screencap -p /sdcard/live_order_verified.png`);
      execSync(`"${adb}" pull /sdcard/live_order_verified.png "C:\\Users\\pavan\\.gemini\\antigravity-ide\\brain\\7c384bc7-1792-4919-8bce-5de23f5984f9\\evidence\\live_order_verified.png"`);
      execSync(`"${adb}" shell cmd statusbar collapse`);
      console.log('7. Verification complete! Screenshot saved.');
    });
  });
  req.on('error', (e) => console.log('Request error:', e.message));
  req.write(orderPayload);
  req.end();
})();
