const base = 'https://serviceportal.onrender.com';

async function main() {
  const statusRes = await fetch(`${base}/api/line/status`);
  const status = await statusRes.json();
  console.log('status', JSON.stringify(status, null, 2));

  const body = JSON.stringify({ events: [] });
  const unsigned = await fetch(`${base}/api/line/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  console.log('unsigned', unsigned.status, await unsigned.text());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
