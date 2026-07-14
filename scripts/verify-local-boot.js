const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env, NODE_ENV: 'production' };
delete env.AUTH_SESSION_SECRET;
delete env.SESSION_SECRET;
delete env.RENDER;
delete env.RENDER_SERVICE_ID;

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
child.stdout.on('data', d => { out += d.toString(); });
child.stderr.on('data', d => { out += d.toString(); });

let settled = false;
function finish(exitCode) {
  if (settled) return;
  settled = true;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  console.log('had_fatal', /\[FATAL\]/.test(out));
  console.log('saw_dev_warn', /WARNING: AUTH_SESSION_SECRET|Using NODE_ENV=development|defaulting to development/i.test(out));
  const lines = out.split(/\r?\n/).filter(l =>
    /FATAL|NODE_ENV|auth\]|ENV DEBUG|WARNING|Using NODE_ENV|listening|port|Server/i.test(l)
  ).slice(0, 20);
  console.log(lines.join('\n'));
  process.exit(exitCode);
}

setTimeout(() => {
  // Still running after 3s => success for local boot
  finish(/\[FATAL\]/.test(out) ? 1 : 0);
}, 3500);

child.on('exit', (code) => {
  if (settled) return;
  finish(code && /\[FATAL\]/.test(out) ? 1 : (code || 0));
});
