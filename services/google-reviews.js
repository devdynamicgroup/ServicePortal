const {
  getNotionClient,
  isNotionConfigured
} = require('./notion/client');
const { getNotionConfig } = require('../config/env');
const { findPropertyKey } = require('./notion/props');
const {
  listReviews,
  starRatingToNumber,
  isBusinessProfileConfigured,
  recordSyncResult,
  recordSyncError,
  getSyncState,
  getBusinessDebugStatus
} = require('./google-business');

const REQUIRED_NOTION_PROPERTIES = [
  { name: 'Google Review ID', aliases: ['Google Review ID'] },
  { name: 'Rating', aliases: ['Rating'] },
  { name: 'Comment', aliases: ['Comment'] },
  { name: 'Reviewer', aliases: ['Reviewer'] },
  { name: 'Review Date', aliases: ['Review Date', 'Date'] }
];

function log(step, message, extra) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[google-reviews] ${step}: ${message}${suffix}`);
}

function getReviewDatabaseId() {
  const databaseId = process.env.NOTION_FEEDBACK_DATABASE_ID || '';
  if (!databaseId) {
    const error = new Error('NOTION_FEEDBACK_DATABASE_ID is required');
    error.statusCode = 400;
    throw error;
  }
  return databaseId;
}

function isReviewNotionConfigured() {
  const { apiKey } = getNotionConfig();
  return Boolean(apiKey && process.env.NOTION_FEEDBACK_DATABASE_ID);
}

async function getReviewDataSourceSchema(notion) {
  const databaseId = getReviewDatabaseId();
  const override = process.env.NOTION_FEEDBACK_DATA_SOURCE_ID;

  if (override) {
    const detail = await notion.dataSources.retrieve({ data_source_id: override });
    return { databaseId, dataSourceId: override, properties: detail.properties || {} };
  }

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSources = database.data_sources || [];
  if (!dataSources.length) throw new Error('Notion feedback database has no data sources');

  const dataSourceId = dataSources[0].id;
  const detail = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  return { databaseId, dataSourceId, properties: detail.properties || {} };
}

function validateNotionSchema(schema) {
  const missing = [];
  const resolved = {};

  for (const item of REQUIRED_NOTION_PROPERTIES) {
    const key = findPropertyKey(schema, item.aliases);
    if (!key) {
      missing.push(item.name);
    } else {
      resolved[item.name] = key;
    }
  }

  return { ok: missing.length === 0, missing, resolved };
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
  if (type === 'date') properties[key] = { date: { start: String(value).slice(0, 10) } };
  if (type === 'select') properties[key] = { select: { name: String(value) } };
}

function buildReviewProperties(review, schema) {
  const properties = {};
  const rating = starRatingToNumber(review.starRating);
  const reviewDate = (review.updateTime || review.createTime || '').slice(0, 10);

  setProperty(properties, schema, ['Google Review ID'], review.reviewId);
  setProperty(properties, schema, ['Rating'], rating);
  setProperty(properties, schema, ['Comment'], review.comment || '(No comment)');
  setProperty(properties, schema, ['Reviewer'], review.reviewerName);
  setProperty(properties, schema, ['Review Date', 'Date'], reviewDate);

  if (!Object.values(properties).some(prop => prop.title)) {
    const titleKey = Object.keys(schema).find(key => schema[key]?.type === 'title');
    if (titleKey) {
      properties[titleKey] = { title: text(`${rating || '-'} stars - ${review.reviewerName}`) };
    }
  }

  return properties;
}

async function reviewExists(notion, dataSourceId, schema, reviewId) {
  const key = findPropertyKey(schema, ['Google Review ID']);
  if (!key) return false;

  const type = schema[key]?.type;
  if (type === 'rich_text') {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: key, rich_text: { equals: reviewId } },
      page_size: 1
    });
    return (response.results || []).length > 0;
  }

  if (type === 'title') {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: key, title: { equals: reviewId } },
      page_size: 1
    });
    return (response.results || []).length > 0;
  }

  return false;
}

async function fetchGoogleReviews() {
  const result = await listReviews({ fetchAll: true });
  return result.reviews;
}

async function syncReviewsToNotion() {
  if (!isReviewNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_FEEDBACK_DATABASE_ID must be configured');
  }
  if (!isBusinessProfileConfigured()) {
    throw new Error('Google Business Profile OAuth, account, and location must be configured');
  }

  const notion = getNotionClient();
  const { dataSourceId, databaseId, properties: schema } = await getReviewDataSourceSchema(notion);
  const schemaCheck = validateNotionSchema(schema);
  if (!schemaCheck.ok) {
    const error = new Error(`Notion feedback database is missing required properties: ${schemaCheck.missing.join(', ')}`);
    error.statusCode = 400;
    error.missingProperties = schemaCheck.missing;
    recordSyncError(error);
    throw error;
  }

  const reviews = await fetchGoogleReviews();
  log('sync', 'reviews fetched', { count: reviews.length });
  const results = [];

  for (const review of reviews) {
    if (!review.reviewId) {
      log('sync', 'skipped review without reviewId');
      results.push({ reviewId: null, status: 'skipped', reason: 'missing-review-id' });
      continue;
    }

    const exists = await reviewExists(notion, dataSourceId, schema, review.reviewId);
    if (exists) {
      log('sync', 'skipped duplicate', { reviewId: review.reviewId });
      results.push({ reviewId: review.reviewId, status: 'skipped' });
      continue;
    }

    const page = await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: buildReviewProperties(review, schema)
    });
    log('sync', 'inserted', { reviewId: review.reviewId, notionPageId: page.id });
    results.push({ reviewId: review.reviewId, status: 'created', notionPageId: page.id });
  }

  const summary = {
    source: 'google-business-profile',
    notionDatabaseId: databaseId,
    notionDataSourceId: dataSourceId,
    total: reviews.length,
    created: results.filter(item => item.status === 'created').length,
    skipped: results.filter(item => item.status === 'skipped').length,
    results
  };

  recordSyncResult(summary);
  log('sync', 'completed', {
    total: summary.total,
    inserted: summary.created,
    skipped: summary.skipped
  });
  return summary;
}

function getGoogleReviewIntegrationStatus() {
  return {
    notionConfigured: isReviewNotionConfigured(),
    reviewDatabaseConfigured: Boolean(process.env.NOTION_FEEDBACK_DATABASE_ID),
    businessProfileConfigured: isBusinessProfileConfigured(),
    hasGoogleBusinessClientId: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_ID),
    hasGoogleBusinessClientSecret: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_SECRET),
    hasGoogleBusinessRefreshToken: Boolean(process.env.GOOGLE_BUSINESS_REFRESH_TOKEN),
    hasGoogleBusinessAccountId: Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID),
    hasGoogleBusinessLocationId: Boolean(process.env.GOOGLE_BUSINESS_LOCATION_ID),
    schedulerIntervalMinutes: Number(process.env.GOOGLE_REVIEW_SYNC_INTERVAL_MINUTES || 15),
    lastSync: getSyncState().lastSyncAt,
    lastError: getSyncState().lastError
  };
}

async function getNotionFeedbackDebug() {
  if (!isReviewNotionConfigured()) {
    return {
      databaseConnected: false,
      error: 'NOTION_API_KEY or NOTION_FEEDBACK_DATABASE_ID is not configured'
    };
  }

  const notion = getNotionClient();
  const databaseId = getReviewDatabaseId();
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const databaseTitle = (database.title || []).map(part => part.plain_text).join('') || '(no title)';
  const { dataSourceId, properties } = await getReviewDataSourceSchema(notion);
  const schemaCheck = validateNotionSchema(properties);

  return {
    databaseConnected: true,
    databaseTitle,
    databaseId,
    dataSourceId,
    schemaReady: schemaCheck.ok,
    missingProperties: schemaCheck.missing,
    resolvedProperties: schemaCheck.resolved,
    properties: Object.entries(properties).map(([name, prop]) => ({ name, type: prop.type }))
  };
}

module.exports = {
  fetchGoogleReviews,
  syncReviewsToNotion,
  getGoogleReviewIntegrationStatus,
  getNotionFeedbackDebug,
  getBusinessDebugStatus,
  validateNotionSchema,
  REQUIRED_NOTION_PROPERTIES
};
