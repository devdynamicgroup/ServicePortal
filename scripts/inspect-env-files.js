const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function listEnvFiles() {
  return fs.readdirSync(root)
    .filter(name => name === '.env' || name.startsWith('.env'))
    .map(name => {
      const full = path.join(root, name);
      const stat = fs.statSync(full);
      return { name, full, size: stat.size, mtime: stat.mtime.toISOString() };
    });
}

function parseEnvKeys(filePath) {
  const text = fs.readFileSync(filePath);
  const bom = text[0] === 0xEF && text[1] === 0xBB && text[2] === 0xBF;
  const lines = text.toString('utf8').split(/\r?\n/);
  const keys = [];
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx);
    keys.push({
      key,
      trimmed: key.trim(),
      leadingWs: key !== key.trimStart(),
      keyBytes: Buffer.from(key, 'utf8').toJSON().data,
      hasValue: line.slice(idx + 1).trim().length > 0
    });
  }
  return { bom, keys };
}

const files = listEnvFiles();
console.log(JSON.stringify({
  cwd: process.cwd(),
  resolveEnv: path.resolve(root, '.env'),
  envFiles: files,
  parse: files.map(file => ({ file: file.name, ...parseEnvKeys(file.full) })),
  processHas: {
    GOOGLE_BUSINESS_CLIENT_ID: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_ID),
    GOOGLE_BUSINESS_CLIENT_SECRET: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_SECRET),
    GOOGLE_BUSINESS_REDIRECT_URI: process.env.GOOGLE_BUSINESS_REDIRECT_URI || null,
    NOTION_FEEDBACK_DATABASE_ID: Boolean(process.env.NOTION_FEEDBACK_DATABASE_ID)
  }
}, null, 2));
