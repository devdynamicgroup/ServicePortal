const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const out = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
  { encoding: 'utf8' }
);

let rows = [];
try {
  const parsed = JSON.parse(out || 'null');
  rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
} catch {
  console.log('RAW', out);
  process.exit(0);
}

for (const row of rows) {
  const cmd = String(row.CommandLine || '');
  const pid = row.ProcessId;
  const isPortal = /Service Portal|server\.js/i.test(cmd);
  console.log(JSON.stringify({ pid, isPortal, cmd: cmd.slice(0, 240) }));
  if (isPortal) {
    try {
      process.kill(pid);
      console.log('killed', pid);
    } catch (error) {
      console.log('kill-failed', pid, error.message);
    }
  }
}
