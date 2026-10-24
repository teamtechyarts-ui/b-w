const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config({ path: 'D:/techyArts/B-W/backend/.env' });

const host = process.env.SMTP_HOST || 'smtp.zoho.in';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
const secure = process.env.SMTP_SECURE === 'true' || port === 465;
const user = process.env.SMTP_USER;
const pass = (process.env.SMTP_PASS || process.env.SMTP_APP_PASSWORD || '').replace(/\s+/g, '');

console.log('Sending probe email to:', user, 'via', host);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

transporter.sendMail(
  {
    from: `"Bright and White Laundry" <${user}>`,
    to: user,
    subject: 'Bright and White SMTP Diagnostic Probe',
    text: 'This is a test probe to verify outgoing Zoho SMTP delivery.',
  },
  (err, info) => {
    if (err) {
      console.error('SMTP Send Failure:', err.message, 'code:', err.code, 'response:', err.response);
    } else {
      console.log('SMTP Send Success! messageId:', info.messageId, 'response:', info.response);
    }
    process.exit(err ? 1 : 0);
  },
);
