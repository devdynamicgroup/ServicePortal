/**
 * One-time local helper: print the Google Drive OAuth URL.
 * Prefer visiting /auth/google on a running server, then copy GOOGLE_REFRESH_TOKEN.
 *
 * Usage:
 *   node scripts/authorize-google-drive.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const {
  isOAuthClientConfigured,
  generateAuthUrl,
  getOAuthEnv
} = require('../services/google-drive-oauth');

function main() {
  const env = getOAuthEnv();
  if (!isOAuthClientConfigured()) {
    console.error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI');
    process.exit(1);
  }

  console.log('Google Drive OAuth setup');
  console.log('------------------------');
  console.log('1. Ensure GOOGLE_REDIRECT_URI is allow-listed in Google Cloud Console.');
  console.log(`   Current redirect: ${env.redirectUri}`);
  console.log('2. Start the app (yarn start / node server.js).');
  console.log('3. Open this URL in a browser (or /auth/google on the running app):\n');
  console.log(generateAuthUrl('cli-setup'));
  console.log('\n4. After consent, copy GOOGLE_REFRESH_TOKEN from the callback page into Render/.env');
  console.log('5. Redeploy / restart, then POST /api/drive/images will use the owner My Drive.');
}

main();
