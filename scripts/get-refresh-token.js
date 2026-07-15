const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
const {
  isOAuthClientConfigured,
  generateAuthUrl,
  exchangeCode,
  getOAuthEnv
} = require('../services/google-drive-oauth');

const envPath = path.join(__dirname, '..', '.env');

dotenv.config({ path: envPath, quiet: true });

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function main() {
  const env = getOAuthEnv();
  if (!isOAuthClientConfigured()) {
    console.error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI in .env.');
    process.exit(1);
  }

  console.log('Google Drive OAuth refresh token helper');
  console.log('1) Open this URL in a browser and authorize access:');
  console.log(generateAuthUrl('cli-setup'));
  console.log('');

  const code = await prompt('2) Paste the authorization code here: ');
  if (!code) {
    console.error('Authorization code is required.');
    process.exit(1);
  }

  try {
    const tokens = await exchangeCode(code);
    console.log('\nRefresh token:');
    console.log(tokens.refreshToken || 'NO_REFRESH_TOKEN_RETURNED');
    console.log('\nSave this value to GOOGLE_REFRESH_TOKEN in Render or your .env.');

    const save = await prompt('Save refresh token into .env now? (y/N): ');
    if (save.toLowerCase() === 'y' || save.toLowerCase() === 'yes') {
      const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const entries = envText.split(/\r?\n/).filter(Boolean).filter(line => !line.startsWith('GOOGLE_REFRESH_TOKEN='));
      entries.push(`GOOGLE_REFRESH_TOKEN=${tokens.refreshToken}`);
      fs.writeFileSync(envPath, entries.join('\n') + '\n', 'utf8');
      console.log(`Saved GOOGLE_REFRESH_TOKEN into ${envPath}`);
    }
  } catch (error) {
    console.error('Failed to exchange authorization code:', error.message || error);
    process.exit(1);
  }
}

main();
