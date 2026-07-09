const crypto = require('crypto');
const {
  verifyLineSignature,
  lineSignatureDebug,
  getLineChannelSecret
} = require('../services/line-notifications');

process.env.LINE_CHANNEL_SECRET = 'testsecret';
const body = Buffer.from('{"events":[]}', 'utf8');
const signature = crypto.createHmac('sha256', 'testsecret').update(body).digest('base64');

if (!verifyLineSignature(body, signature)) {
  console.error('FAIL: valid signature rejected');
  process.exit(1);
}

// Render env vars often include a trailing newline; trim should still verify.
process.env.LINE_CHANNEL_SECRET = 'testsecret\n';
if (!verifyLineSignature(body, signature)) {
  console.error('FAIL: signature rejected with trimmed newline secret');
  process.exit(1);
}

process.env.LINE_CHANNEL_SECRET = 'wrongsecret';
if (verifyLineSignature(body, signature)) {
  console.error('FAIL: invalid secret accepted');
  process.exit(1);
}

process.env.LINE_CHANNEL_SECRET = 'testsecret';
if (verifyLineSignature(body, 'not-valid-base64!!!')) {
  console.error('FAIL: invalid signature accepted');
  process.exit(1);
}

const debug = lineSignatureDebug(body, signature);
if (!debug.hasSecret || debug.id !== 'line_sig_debug') {
  console.error('FAIL: debug info', debug);
  process.exit(1);
}

console.log('OK line signature verification');
