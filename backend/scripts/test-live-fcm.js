const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const app = admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('[STAGE: START] Querying active token for test user Sushma (d97a05f3-9e7c-4b12-aaa7-55428e364024)...');
  const { data: devices, error } = await supabase
    .from('device_tokens')
    .select('id, push_token, is_active, updated_at')
    .eq('profile_id', 'd97a05f3-9e7c-4b12-aaa7-55428e364024')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !devices || devices.length === 0) {
    console.error('No active device token found:', error);
    process.exit(1);
  }

  const device = devices[0];
  const token = device.push_token;
  const masked = `${token.slice(0, 10)}...${token.slice(-6)}`;
  console.log(`[FCM_TOKEN_FOUND] Device Token ID: ${device.id}, Token: ${masked}`);

  const testTitle = process.argv[2] || 'Test Push Order Update';
  const testBody = process.argv[3] || 'Your laundry is being processed. Order #BW-TEST-101';
  const orderId = 'test-order-101';

  const message = {
    token: token,
    notification: {
      title: testTitle,
      body: testBody,
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'bright_white_notifications',
        priority: 'high',
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
    data: {
      orderId: orderId,
      notificationType: 'order_status_update',
      eventType: 'order_status_update',
      timestamp: Date.now().toString(),
    },
  };

  console.log('[FCM_SEND_STARTED]', JSON.stringify({
    title: message.notification.title,
    body: message.notification.body,
    androidChannel: message.android.notification.channelId,
    data: message.data,
  }));

  try {
    const res = await admin.messaging(app).send(message);
    console.log('[FCM_SEND_ACCEPTED] Firebase Message ID:', res);
  } catch (err) {
    console.error('[FCM_SEND_FAILED]', err);
  }
}

run().catch(console.error);
