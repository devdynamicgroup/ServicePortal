const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const {
  getLineChannelSecret,
  verifyLineSignature
} = require('../services/line-notifications');

const base = 'https://serviceportal.onrender.com';
const body = Buffer.from(JSON.stringify({ events: [] }), 'utf8');
const secret = getLineChannelSecret();

if (!secret) {
  console.log('SKIP: no local LINE_CHANNEL_SECRET for signed probe');
  process.exit(0);
}

const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
console.log('local secretLength', secret.length, 'local verify', verifyLineSignature(body, signature));

fetch(`${base}/api/line/webhook`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Line-Signature': signature
  },
  body
})
  .then(async res => {
    const text = await res.text();
    console.log('signed POST', res.status, text);
  })
  .catch(err => console.error(err));
