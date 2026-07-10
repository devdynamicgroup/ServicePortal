/**
 * One-shot diagnostic for Google Reviews → Notion sync.
 * Run: node scripts/debug-google-reviews.js
 */
require('../config/env');

function mask(value, showStart = 4, showEnd = 0) {
  if (!value) return '(missing)';
  const s = String(value);
  if (s.length <= showStart + showEnd) return '*'.repeat(s.length);
  return s.slice(0, showStart) + '*'.repeat(Math.max(4, s.length - showStart - showEnd)) + (showEnd ? s.slice(-showEnd) : '');
}

function sep(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

async function step1() {
  sep('STEP 1: Environment Variables');
  const keys = {
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    GOOGLE_PLACE_ID: process.env.GOOGLE_PLACE_ID,
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    NOTION_FEEDBACK_DATABASE_ID: process.env.NOTION_FEEDBACK_DATABASE_ID,
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID
  };
  console.log('GOOGLE_API_KEY            =', mask(keys.GOOGLE_API_KEY));
  console.log('GOOGLE_MAPS_API_KEY       =', mask(keys.GOOGLE_MAPS_API_KEY), '(used by current code)');
  console.log('GOOGLE_PLACE_ID           =', mask(keys.GOOGLE_PLACE_ID, 4, 4));
  console.log('NOTION_API_KEY            =', mask(keys.NOTION_API_KEY));
  console.log('NOTION_FEEDBACK_DATABASE_ID =', mask(keys.NOTION_FEEDBACK_DATABASE_ID, 0, 4));
  console.log('NOTION_DATABASE_ID        =', mask(keys.NOTION_DATABASE_ID, 0, 4), '(fallback if feedback id missing)');

  const missing = [];
  if (!keys.GOOGLE_API_KEY && !keys.GOOGLE_MAPS_API_KEY) missing.push('GOOGLE_API_KEY or GOOGLE_MAPS_API_KEY');
  if (!keys.GOOGLE_PLACE_ID) missing.push('GOOGLE_PLACE_ID');
  if (!keys.NOTION_API_KEY) missing.push('NOTION_API_KEY');
  if (!keys.NOTION_FEEDBACK_DATABASE_ID) missing.push('NOTION_FEEDBACK_DATABASE_ID');

  if (missing.length) {
    console.log('\n⚠ MISSING (per diagnostic spec):', missing.join(', '));
  }
  return keys;
}

async function step2(keys) {
  sep('STEP 2: Google Places API (v1)');
  const apiKey = keys.GOOGLE_API_KEY || keys.GOOGLE_MAPS_API_KEY;
  const placeId = keys.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    console.log('SKIPPED: missing API key or GOOGLE_PLACE_ID');
    return null;
  }

  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews'
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  console.log('HTTP Status:', response.status);
  if (!response.ok) {
    console.log('Error (full):', JSON.stringify(data, null, 2));
    return null;
  }

  console.log('Display Name:', data.displayName?.text || data.displayName || '(none)');
  console.log('Rating:', data.rating ?? '(none)');
  console.log('User Rating Count:', data.userRatingCount ?? '(none)');
  const reviews = data.reviews || [];
  console.log('Review Count:', reviews.length);
  reviews.forEach((r, i) => {
    console.log(`\nReview #${i + 1}:`);
    console.log('  Author:', r.authorAttribution?.displayName || r.authorAttribution?.uri || '(unknown)');
    console.log('  Rating:', r.rating);
    console.log('  Publish Time:', r.publishTime);
    console.log('  Text:', (r.text?.text || r.originalText?.text || '').slice(0, 200));
  });
  return reviews;
}

async function step2Legacy(keys) {
  sep('STEP 2b: Google Places API (legacy - what code actually uses)');
  const apiKey = keys.GOOGLE_MAPS_API_KEY;
  const placeId = keys.GOOGLE_PLACE_ID;
  if (!apiKey || !placeId) {
    console.log('SKIPPED: missing GOOGLE_MAPS_API_KEY or GOOGLE_PLACE_ID');
    return null;
  }
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,rating,user_ratings_total,reviews,url');
  url.searchParams.set('key', apiKey);
  const response = await fetch(url);
  const data = await response.json();
  console.log('HTTP Status:', response.status);
  console.log('API Status:', data.status);
  if (data.error_message) console.log('Error:', data.error_message);
  if (data.status === 'OK') {
    console.log('Display Name:', data.result?.name);
    console.log('Rating:', data.result?.rating);
    console.log('User Rating Count:', data.result?.user_ratings_total);
    console.log('Review Count:', (data.result?.reviews || []).length);
    (data.result?.reviews || []).forEach((r, i) => {
      console.log(`\nReview #${i + 1}:`);
      console.log('  Author:', r.author_name);
      console.log('  Rating:', r.rating);
      console.log('  Publish Time:', r.time ? new Date(r.time * 1000).toISOString() : '(none)');
      console.log('  Text:', (r.text || '').slice(0, 200));
    });
    return data.result?.reviews || [];
  }
  return null;
}

async function step4(keys) {
  sep('STEP 4: Notion Database');
  const { getNotionClient } = require('../services/notion/client');
  const dbId = keys.NOTION_FEEDBACK_DATABASE_ID || keys.NOTION_DATABASE_ID;
  if (!keys.NOTION_API_KEY || !dbId) {
    console.log('SKIPPED: missing NOTION_API_KEY or database id');
    return null;
  }
  const notion = getNotionClient();
  try {
    const db = await notion.databases.retrieve({ database_id: dbId });
    const title = (db.title || []).map(t => t.plain_text).join('') || '(no title)';
    console.log('Database Title:', title);
    console.log('Database ID:', db.id);
    console.log('Data Sources:', (db.data_sources || []).map(ds => `${ds.name} (${ds.id})`).join(', ') || '(none)');
    if (db.data_sources?.length) {
      for (const ds of db.data_sources) {
        const detail = await notion.dataSources.retrieve({ data_source_id: ds.id });
        console.log(`\nProperties in data source "${ds.name}":`);
        Object.entries(detail.properties || {}).forEach(([k, v]) => console.log(`  - ${k} (${v.type})`));
      }
    }
    return { db, title };
  } catch (e) {
    console.log('Error (full):', e.message);
    if (e.body) console.log('Body:', JSON.stringify(e.body, null, 2));
    return null;
  }
}

async function step5(notionInfo) {
  sep('STEP 5: Property Mapping');
  if (!notionInfo) {
    console.log('SKIPPED: no Notion database info');
    return null;
  }
  const { getReviewDataSourceSchema } = require('../services/google-reviews');
  const notion = require('../services/notion/client').getNotionClient();
  const { properties } = await getReviewDataSourceSchema(notion);
  const expected = {
    'Customer Name': ['Name', 'Title', 'Review Title'],
    'Rating': ['Rating', 'Stars', 'Google Rating'],
    'Comment': ['Review', 'Comment', 'Review Text', 'Feedback'],
    'Created Time': ['Reviewed At', 'Review Date', 'Date'],
    'Google Review ID': ['Google Review ID', 'Review ID', 'Google ID']
  };
  const { findPropertyKey } = require('../services/notion/props');
  for (const [label, aliases] of Object.entries(expected)) {
    const hit = findPropertyKey(properties, aliases);
    console.log(`${label}: ${hit ? `✓ "${hit}"` : '✗ NOT FOUND (aliases: ' + aliases.join(', ') + ')'}`);
  }
  return properties;
}

async function step6(keys, reviews) {
  sep('STEP 6: Test Insert (first review)');
  if (!reviews?.length) {
    console.log('SKIPPED: no reviews from Google');
    return null;
  }
  const { syncReviewsToNotion } = require('../services/google-reviews');
  try {
    const result = await syncReviewsToNotion();
    console.log('Sync Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    console.log('Error (full):', e.message);
    if (e.body) console.log('Body:', JSON.stringify(e.body, null, 2));
    return null;
  }
}

async function step7() {
  sep('STEP 7: Scheduler');
  const { getGoogleReviewIntegrationStatus } = require('../services/google-reviews');
  const status = getGoogleReviewIntegrationStatus();
  const intervalMin = Number(process.env.GOOGLE_REVIEW_SYNC_INTERVAL_MINUTES || 15);
  console.log('Scheduler Enabled:', process.env.GOOGLE_REVIEW_SYNC_ENABLED !== 'false');
  console.log('Run on Startup:', process.env.GOOGLE_REVIEW_SYNC_RUN_ON_START !== 'false');
  console.log('Interval:', intervalMin, 'minute(s)');
  console.log('Ready to Sync:', status.notionConfigured && (status.hasGoogleBusinessOAuth || (status.hasGoogleMapsApiKey && status.hasGooglePlaceId)));
  console.log('Integration Status:', JSON.stringify(status, null, 2));
}

async function step8() {
  sep('STEP 8: Duplicate Key');
  console.log('Unique key: SHA1 fingerprint of [author, rating, text, reviewedAt] for Places API');
  console.log('              OR reviewId/name from Business Profile API');
  console.log('Dedup query: rich_text equals on "Google Review ID" property');
  console.log('Note: If "Google Review ID" property missing or not rich_text, dedup is skipped → duplicates possible');
}

(async () => {
  const keys = await step1();
  const reviewsV1 = await step2(keys);
  const reviewsLegacy = await step2Legacy(keys);
  const reviews = reviewsV1 || reviewsLegacy;

  sep('STEP 3: New Review Check');
  if (!reviews?.length) {
    console.log('Google Places API returned 0 reviews (or API not called).');
    console.log('CONCLUSION: Cannot verify new user review — Google may not have sent it yet, or API/config blocked.');
  } else {
    console.log(`Google returned ${reviews.length} review(s). Compare manually with the review you just wrote.`);
  }

  const notionInfo = await step4(keys);
  await step5(notionInfo);
  await step6(keys, reviews);
  await step7();
  await step8();

  sep('STEP 10: Summary pointers');
  console.log('Re-run with GOOGLE_PLACE_ID and NOTION_FEEDBACK_DATABASE_ID set for full pipeline test.');
})().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
