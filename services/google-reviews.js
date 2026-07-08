const crypto = require('crypto');
const {
  getNotionClient,
  isNotionConfigured,
  getDataSourceSchema
} = require('./notion/client');
const { findPropertyKey } = require('./notion/props');

function requireEnv(names) {
  const missing = names.filter(name => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Missing environment variables: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

function fingerprint(parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex');
}

function starRatingToNumber(value) {
  if (typeof value === 'number') return value;
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[value] || Number(value) || 0;
}

async function fetchBusinessProfileReviews() {
  requireEnv(['GOOGLE_BUSINESS_ACCESS_TOKEN', 'GOOGLE_BUSINESS_ACCOUNT_ID', 'GOOGLE_BUSINESS_LOCATION_ID']);
  const parent = `accounts/${process.env.GOOGLE_BUSINESS_ACCOUNT_ID}/locations/${process.env.GOOGLE_BUSINESS_LOCATION_ID}`;
  const url = new URL(`https://mybusiness.googleapis.com/v4/${parent}/reviews`);
  url.searchParams.set('pageSize', process.env.GOOGLE_REVIEWS_PAGE_SIZE || '50');
  url.searchParams.set('orderBy', 'updateTime desc');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.GOOGLE_BUSINESS_ACCESS_TOKEN}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Google Business Profile reviews request failed');

  return (data.reviews || []).map(review => {
    const reviewedAt = review.updateTime || review.createTime || new Date().toISOString();
    return {
      id: review.reviewId || review.name || fingerprint([review.reviewer?.displayName, review.starRating, review.comment, reviewedAt]),
      source: 'Google Business Profile',
      author: review.reviewer?.displayName || 'Google reviewer',
      rating: starRatingToNumber(review.starRating),
      text: review.comment || '',
      reviewedAt,
      url: review.name ? `https://www.google.com/search?q=${encodeURIComponent(process.env.GOOGLE_BUSINESS_LOCATION_NAME || 'Google review')}` : ''
    };
  });
}

async function fetchPlaceReviews() {
  requireEnv(['GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACE_ID']);
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', process.env.GOOGLE_PLACE_ID);
  url.searchParams.set('fields', 'name,rating,user_ratings_total,reviews,url');
  url.searchParams.set('reviews_sort', 'newest');
  url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.status !== 'OK') throw new Error(data.error_message || data.status || 'Google Places reviews request failed');

  return (data.result?.reviews || []).map(review => {
    const reviewedAt = review.time ? new Date(review.time * 1000).toISOString() : new Date().toISOString();
    return {
      id: fingerprint([review.author_name, review.rating, review.text, reviewedAt]),
      source: 'Google Places',
      author: review.author_name || 'Google reviewer',
      rating: Number(review.rating) || 0,
      text: review.text || '',
      reviewedAt,
      url: review.author_url || data.result?.url || ''
    };
  });
}

async function fetchGoogleReviews() {
  if (process.env.GOOGLE_BUSINESS_ACCESS_TOKEN) return fetchBusinessProfileReviews();
  return fetchPlaceReviews();
}

function text(value) {
  return [{ text: { content: String(value || '').slice(0, 2000) } }];
}

function setProperty(properties, schema, aliases, value) {
  if (value === undefined || value === null || value === '') return;
  const key = findPropertyKey(schema, aliases);
  if (!key) return;
  const type = schema[key]?.type;
  if (type === 'title') properties[key] = { title: text(value) };
  if (type === 'rich_text') properties[key] = { rich_text: text(value) };
  if (type === 'number') properties[key] = { number: Number(value) || 0 };
  if (type === 'url') properties[key] = { url: String(value) };
  if (type === 'date') properties[key] = { date: { start: String(value) } };
  if (type === 'select') properties[key] = { select: { name: String(value) } };
}

function buildReviewProperties(review, schema) {
  const properties = {};
  setProperty(properties, schema, ['Name', 'Title', 'Review Title'], `${review.rating || '-'} stars - ${review.author}`);
  setProperty(properties, schema, ['Google Review ID', 'Review ID', 'Google ID'], review.id);
  setProperty(properties, schema, ['Author', 'Reviewer', 'Reviewer Name'], review.author);
  setProperty(properties, schema, ['Rating', 'Stars', 'Google Rating'], review.rating);
  setProperty(properties, schema, ['Review', 'Comment', 'Review Text'], review.text || '(No comment)');
  setProperty(properties, schema, ['Source', 'Channel'], review.source);
  setProperty(properties, schema, ['Reviewed At', 'Review Date', 'Date'], review.reviewedAt);
  setProperty(properties, schema, ['Review URL', 'URL', 'Link'], review.url);
  if (!Object.values(properties).some(prop => prop.title)) {
    const titleKey = Object.keys(schema).find(key => schema[key]?.type === 'title');
    if (titleKey) properties[titleKey] = { title: text(`${review.rating || '-'} stars - ${review.author}`) };
  }
  return properties;
}

async function reviewExists(notion, dataSourceId, schema, reviewId) {
  const key = findPropertyKey(schema, ['Google Review ID', 'Review ID', 'Google ID']);
  if (!key) return false;
  if (schema[key]?.type !== 'rich_text') return false;
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: { property: key, rich_text: { equals: reviewId } },
    page_size: 1
  });
  return (response.results || []).length > 0;
}

async function syncReviewsToNotion() {
  if (!isNotionConfigured()) throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  const reviews = await fetchGoogleReviews();
  const notion = getNotionClient();
  const { dataSourceId, properties: schema } = await getDataSourceSchema();
  const results = [];

  for (const review of reviews) {
    const exists = await reviewExists(notion, dataSourceId, schema, review.id);
    if (exists) {
      results.push({ id: review.id, status: 'skipped' });
      continue;
    }

    const page = await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: buildReviewProperties(review, schema)
    });
    results.push({ id: review.id, status: 'created', notionPageId: page.id });
  }

  return {
    source: process.env.GOOGLE_BUSINESS_ACCESS_TOKEN ? 'google-business-profile' : 'google-places',
    total: reviews.length,
    created: results.filter(item => item.status === 'created').length,
    skipped: results.filter(item => item.status === 'skipped').length,
    results
  };
}

function getGoogleReviewIntegrationStatus() {
  return {
    notionConfigured: isNotionConfigured(),
    hasGoogleMapsApiKey: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    hasGooglePlaceId: Boolean(process.env.GOOGLE_PLACE_ID),
    hasGoogleBusinessOAuth: Boolean(process.env.GOOGLE_BUSINESS_ACCESS_TOKEN && process.env.GOOGLE_BUSINESS_ACCOUNT_ID && process.env.GOOGLE_BUSINESS_LOCATION_ID)
  };
}

module.exports = {
  fetchGoogleReviews,
  syncReviewsToNotion,
  getGoogleReviewIntegrationStatus
};
