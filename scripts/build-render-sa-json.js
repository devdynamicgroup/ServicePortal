const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'render-google-service-account-env.txt');
const saPath = path.join(root, 'solar-bolt-501808-u9-5fa018d4a911.json');
const outPath = path.join(root, 'render-google-service-account-json-only.txt');

function stripWrappers(raw) {
  let payload = String(raw || '').replace(/^\uFEFF/, '').trim();
  const diag = {
    sourceBytes: Buffer.byteLength(payload, 'utf8'),
    startsWithEnvKey: /^GOOGLE_SERVICE_ACCOUNT_JSON\s*=/.test(payload),
    hasMarkdownFence: /```/.test(payload),
    leadingChar: payload[0] || '',
    trailingChar: payload.slice(-1) || ''
  };

  if (diag.startsWithEnvKey) {
    payload = payload.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON\s*=\s*/, '');
  }
  payload = payload.trim();

  if (
    (payload.startsWith('"') && payload.endsWith('"'))
    || (payload.startsWith("'") && payload.endsWith("'"))
  ) {
    payload = payload.slice(1, -1).trim();
  }

  if (payload.startsWith('```')) {
    payload = payload
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  return { payload, diag };
}

function loadObject() {
  // Prefer the service-account *.json in the workspace (canonical source).
  if (fs.existsSync(saPath)) {
    const obj = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    return { obj, diag: { sourceFile: saPath }, source: 'sa-json' };
  }

  if (!fs.existsSync(srcPath)) {
    throw new Error('No service-account JSON or render env txt found');
  }

  const raw = fs.readFileSync(srcPath, 'utf8');
  const { payload, diag } = stripWrappers(raw);

  try {
    return { obj: JSON.parse(payload), diag, source: 'env-txt' };
  } catch (err) {
    throw new Error(`Could not parse env txt (${err.message}) and SA file missing`);
  }
}

const { obj, diag, source } = loadObject();

if (obj.type !== 'service_account' || !obj.private_key || !obj.client_email) {
  console.log(JSON.stringify({
    ok: false,
    stage: 'fields',
    hasType: obj.type === 'service_account',
    hasPrivateKey: Boolean(obj.private_key),
    hasClientEmail: Boolean(obj.client_email)
  }));
  process.exit(1);
}

// Compact JSON; JSON.stringify escapes newlines in private_key as \n
const compact = JSON.stringify(obj);
JSON.parse(compact); // must succeed

fs.writeFileSync(outPath, compact, 'utf8');

const reloaded = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (reloaded.type !== 'service_account' || !reloaded.private_key || !reloaded.client_email) {
  console.log(JSON.stringify({ ok: false, stage: 'reload' }));
  process.exit(1);
}

const pkSegment = compact.match(/"private_key":"((?:\\.|[^"\\])*)"/);
const escapedNewlineCount = pkSegment
  ? (pkSegment[1].match(/\\n/g) || []).length
  : 0;

console.log(JSON.stringify({
  ok: true,
  source,
  outPath,
  outBytes: Buffer.byteLength(compact, 'utf8'),
  startsWithBrace: compact[0] === '{',
  endsWithBrace: compact.endsWith('}'),
  hasEnvPrefix: compact.startsWith('GOOGLE_SERVICE_ACCOUNT_JSON'),
  hasMarkdown: compact.includes('```'),
  typeOk: reloaded.type === 'service_account',
  hasPrivateKey: Boolean(reloaded.private_key),
  hasClientEmail: Boolean(reloaded.client_email),
  privateKeyNewlinesAfterParse: reloaded.private_key.includes('\n'),
  escapedNewlineCountInPrivateKeyField: escapedNewlineCount,
  diagnostics: diag
}, null, 2));
