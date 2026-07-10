const { execSync } = require('child_process');
const out = execSync(
  "wmic process where \"name='node.exe'\" get ProcessId,CommandLine /FORMAT:CSV",
  { encoding: 'utf8' }
);
console.log(out);
