const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');

function run(env, code) {
  const cleaned = { ...process.env, ...env };
  Object.keys(env).forEach(key => {
    if (env[key] === '' || env[key] == null) delete cleaned[key];
    else cleaned[key] = env[key];
  });
  ['AUTH_SESSION_SECRET', 'SESSION_SECRET', 'RENDER', 'RENDER_SERVICE_ID', 'NODE_ENV'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(env, key) && !env[key]) delete cleaned[key];
  });
  return spawnSync(process.execPath, ['-e', code], {
    cwd: root,
    env: cleaned,
    encoding: 'utf8'
  });
}

const missing = run(
  { NODE_ENV: 'production', AUTH_SESSION_SECRET: '', SESSION_SECRET: '', RENDER: '', RENDER_SERVICE_ID: '' },
  'require("./services/app-auth")'
);
console.log('prod_missing_exit', missing.status);
console.log('prod_missing_has_fatal', /AUTH_SESSION_SECRET/.test(String(missing.stderr || '') + String(missing.stdout || '')));

const unsetNode = run(
  { NODE_ENV: '', AUTH_SESSION_SECRET: '', SESSION_SECRET: '', RENDER: '', RENDER_SERVICE_ID: '' },
  'require("./services/app-auth"); console.log("local_ok")'
);
console.log('unset_nodeenv_exit', unsetNode.status, (unsetNode.stdout || '').trim().split('\n').pop());

const dev = run(
  { NODE_ENV: 'development', AUTH_SESSION_SECRET: '', SESSION_SECRET: '', RENDER: '', RENDER_SERVICE_ID: '' },
  'require("./services/app-auth"); console.log("dev_ok")'
);
console.log('dev_exit', dev.status, (dev.stdout || '').trim().split('\n').pop());

const prodOk = run(
  { NODE_ENV: 'production', AUTH_SESSION_SECRET: 'unit-test-secret-value-32chars!!', RENDER: '', RENDER_SERVICE_ID: '' },
  'const a=require("./services/app-auth"); console.log("prod_ok", !!a.createSessionToken({username:"a",name:"a",role:"r"}))'
);
console.log('prod_secret_exit', prodOk.status, (prodOk.stdout || '').trim());

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
console.log('env_gitignored', /^\.env\b/m.test(gitignore) && /^\.env\.\*/m.test(gitignore));
