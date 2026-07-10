/**
 * Places API v1 reviews diagnostic — logs field mask + full response.
 * Run: node scripts/debug-places-reviews.js
 */
require('../config/env');

const PLACE_ID = process.env.GOOGLE_PLACE_ID || 'ChIJ5fOkWWGVoRQRkrPqNwDnWhU';
const API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

function sep(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function step1and4() {
  sep('STEP 1 + 4: Places API v1 Place Details (full field mask)');
  const fieldMask = 'displayName,id,formattedAddress,googleMapsUri,rating,userRatingCount,reviews';
  const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;

  console.log('Request URL:', url);
  console.log('X-Goog-Api-Key:', API_KEY ? `${API_KEY.slice(0, 8)}...` : '(missing)');
  console.log('X-Goog-FieldMask:', fieldMask);
  console.log('Place ID:', PLACE_ID);

  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': fieldMask
    }
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }

  console.log('\nHTTP Status:', response.status);
  console.log('Response Headers (selected):');
  ['content-type', 'x-goog-fieldmask', 'grpc-status', 'grpc-message'].forEach(h => {
    const v = response.headers.get(h);
    if (v) console.log(`  ${h}: ${v}`);
  });
  console.log('\nFull Response JSON:');
  console.log(JSON.stringify(data, null, 2));

  if (data.reviews) {
    console.log('\nReviews array length:', data.reviews.length);
    data.reviews.forEach((r, i) => {
      console.log(`\nReview #${i + 1}:`);
      console.log('  author:', r.authorAttribution?.displayName);
      console.log('  rating:', r.rating);
      console.log('  publishTime:', r.publishTime);
      console.log('  text:', (r.text?.text || r.originalText?.text || '').slice(0, 120));
    });
  } else {
    console.log('\nreviews key:', data.reviews === undefined ? 'undefined' : JSON.stringify(data.reviews));
  }

  return { response, data, fieldMask };
}

async function step1Variants() {
  sep('STEP 1b: Field mask variants (isolate reviews field)');
  const masks = [
    'reviews',
    'displayName,reviews',
    'rating,userRatingCount,reviews',
    'reviews.authorAttribution,reviews.rating,reviews.publishTime,reviews.text'
  ];

  for (const mask of masks) {
    const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': mask
      }
    });
    const data = await response.json();
    const count = Array.isArray(data.reviews) ? data.reviews.length : 'N/A';
    const err = data.error ? data.error.message || JSON.stringify(data.error) : '';
    console.log(`\nMask: "${mask}"`);
    console.log(`  HTTP ${response.status} | reviews count: ${count}${err ? ` | error: ${err}` : ''}`);
    if (data.reviews?.length) {
      console.log('  First review:', JSON.stringify(data.reviews[0], null, 2).slice(0, 300));
    }
  }
}

async function step2LegacyProbe() {
  sep('STEP 2: Legacy API probe (what code currently uses)');
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', PLACE_ID);
  url.searchParams.set('fields', 'name,rating,user_ratings_total,reviews');
  url.searchParams.set('key', API_KEY);
  const response = await fetch(url);
  const data = await response.json();
  console.log('HTTP Status:', response.status);
  console.log('API status:', data.status);
  console.log('error_message:', data.error_message || '(none)');
  console.log('reviews count:', data.result?.reviews?.length ?? 'N/A');
  console.log('Full response:', JSON.stringify(data, null, 2));
}

async function step2ServiceCheck() {
  sep('STEP 2b: Service Usage API (enabled APIs for project)');
  if (!API_KEY) {
    console.log('SKIPPED: no API key');
    return;
  }
  // Extract project hint from API key restrictions isn't possible client-side.
  // Try common service enablement probe endpoints.
  const probes = [
    { name: 'Places API (New) - searchText', url: 'https://places.googleapis.com/v1/places:searchText', method: 'POST', body: { textQuery: 'test' }, mask: 'places.id' },
    { name: 'Legacy Place Details', url: `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name&key=${API_KEY}`, method: 'GET' },
    { name: 'Legacy Find Place', url: `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=test&inputtype=textquery&fields=place_id&key=${API_KEY}`, method: 'GET' }
  ];

  for (const probe of probes) {
    try {
      const opts = { method: probe.method, headers: { 'X-Goog-Api-Key': API_KEY } };
      if (probe.method === 'POST') {
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['X-Goog-FieldMask'] = probe.mask;
        opts.body = JSON.stringify(probe.body);
      }
      const r = await fetch(probe.url, opts);
      const d = await r.json();
      const err = d.error?.message || d.error_message || d.status || '';
      console.log(`\n${probe.name}:`);
      console.log(`  HTTP ${r.status} | result: ${err || 'OK'}`);
    } catch (e) {
      console.log(`\n${probe.name}: ERROR ${e.message}`);
    }
  }
  console.log('\nNote: Full list of enabled APIs requires GCP Console or Service Usage API with project credentials.');
  console.log('From probes above: Places API (New) responds HTTP 200; Legacy APIs return REQUEST_DENIED.');
}

async function step3RestrictionProbe() {
  sep('STEP 3: API Key restriction inference from error patterns');
  const tests = [
    { label: 'Places v1 details', fn: () => fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}`, { headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'displayName' } }) },
    { label: 'Places v1 searchText', fn: () => fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'places.id' }, body: JSON.stringify({ textQuery: 'Water Motion' }) }) },
    { label: 'Legacy details', fn: () => fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name&key=${API_KEY}`) },
    { label: 'Geocoding (control)', fn: () => fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Bangkok&key=${API_KEY}`) }
  ];

  for (const t of tests) {
    const r = await t.fn();
    const d = await r.json();
    const err = d.error?.message || d.error_message || d.status || 'OK';
    console.log(`${t.label}: HTTP ${r.status} | ${err}`);
  }
  console.log('\nInference: If Places v1 works but Legacy denied → key likely restricted to Places API (New) only, or Legacy not enabled.');
}

(async () => {
  if (!API_KEY) {
    console.error('Missing GOOGLE_API_KEY / GOOGLE_MAPS_API_KEY');
    process.exit(1);
  }
  await step1and4();
  await step1Variants();
  await step2LegacyProbe();
  await step2ServiceCheck();
  await step3RestrictionProbe();
})().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
