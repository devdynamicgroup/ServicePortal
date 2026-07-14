const { getNotionClient } = require('./notion/client');
const { getNotionConfig } = require('../config/env');
const { findPropertyKey, getPropertyValue } = require('./notion/props');
const { findClientByFeedbackToken, getClient, updateClient } = require('./notion/clients');

const FEEDBACK_ALIASES = {
  title: ['Name', 'Client Feedback', 'Feedback', 'Title'],
  feedbackToken: ['Feedback Token', 'feedbackToken'],
  clientPageId: ['Client Page ID', 'Client Notion ID', 'clientPageId'],
  clientName: ['Client Name', 'Client', 'clientName'],
  clientPhone: ['Client Phone', 'Phone', 'clientPhone'],
  caseId: ['Case ID', 'Case', 'caseId'],
  reportUrl: ['Report URL', 'Report Url', 'reportUrl'],
  feedbackUrl: ['Feedback URL', 'Feedback Url', 'feedbackUrl'],
  rating: ['Rating', 'Feedback Rating', 'rating'],
  comment: ['Comment', 'Feedback Comment', 'comment'],
  email: ['Email', 'Client Email', 'email'],
  submittedAt: ['Submitted At', 'Feedback Submitted At', 'submittedAt', 'Created At', 'created_at'],
  feedbackStatus: ['Feedback Status', 'Status', 'feedbackStatus'],
  reviewUrl: ['Review URL', 'Google Review URL', 'reviewUrl'],
  reviewStatus: ['Review Status', 'reviewStatus'],
  reviewRequestedAt: ['Review Requested At', 'reviewRequestedAt']
};

const FEEDBACK_SCHEMA = [
  { key: 'feedbackToken', name: 'Feedback Token', schema: { rich_text: {} }, required: true },
  { key: 'clientPageId', name: 'Client Page ID', schema: { rich_text: {} }, required: true },
  { key: 'clientName', name: 'Client Name', schema: { rich_text: {} }, required: true },
  { key: 'clientPhone', name: 'Client Phone', schema: { phone_number: {} }, required: false },
  { key: 'caseId', name: 'Case ID', schema: { rich_text: {} }, required: false },
  { key: 'reportUrl', name: 'Report URL', schema: { url: {} }, required: false },
  { key: 'feedbackUrl', name: 'Feedback URL', schema: { url: {} }, required: true },
  { key: 'rating', name: 'Rating', schema: { number: { format: 'number' } }, required: false },
  { key: 'comment', name: 'Comment', schema: { rich_text: {} }, required: false },
  { key: 'email', name: 'Email', schema: { email: {} }, required: false },
  { key: 'submittedAt', name: 'Submitted At', schema: { date: {} }, required: false },
  {
    key: 'feedbackStatus',
    name: 'Feedback Status',
    schema: { select: { options: ['pending', 'submitted'].map(name => ({ name, color: name === 'pending' ? 'yellow' : 'green' })) } },
    required: true
  },
  { key: 'reviewUrl', name: 'Review URL', schema: { url: {} }, required: true },
  {
    key: 'reviewStatus',
    name: 'Review Status',
    schema: { select: { options: ['not_requested', 'requested', 'completed'].map(name => ({ name, color: name === 'completed' ? 'green' : 'gray' })) } },
    required: true
  },
  { key: 'reviewRequestedAt', name: 'Review Requested At', schema: { date: {} }, required: false }
];

function getFeedbackDatabaseId() {
  return process.env.NOTION_CLIENT_FEEDBACK_DATABASE_ID
    || process.env.NOTION_FEEDBACK_DATABASE_ID
    || '';
}

function isClientFeedbackConfigured() {
  const { apiKey } = getNotionConfig();
  return Boolean(apiKey && getFeedbackDatabaseId());
}

async function getFeedbackDataSourceSchema() {
  if (!isClientFeedbackConfigured()) {
    const error = new Error('NOTION_CLIENT_FEEDBACK_DATABASE_ID or NOTION_FEEDBACK_DATABASE_ID is required');
    error.statusCode = 503;
    throw error;
  }

  const notion = getNotionClient();
  const databaseId = getFeedbackDatabaseId();
  const override = process.env.NOTION_CLIENT_FEEDBACK_DATA_SOURCE_ID || process.env.NOTION_FEEDBACK_DATA_SOURCE_ID;

  if (override) {
    const detail = await notion.dataSources.retrieve({ data_source_id: override });
    return { databaseId, dataSourceId: override, properties: detail.properties || {} };
  }

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error('Client Feedback database has no data sources');
  const detail = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  return { databaseId, dataSourceId, properties: detail.properties || {} };
}

async function ensureClientFeedbackSchema() {
  const notion = getNotionClient();
  const { databaseId, dataSourceId, properties } = await getFeedbackDataSourceSchema();
  const missing = FEEDBACK_SCHEMA.filter(item => !findPropertyKey(properties, FEEDBACK_ALIASES[item.key] || [item.name]));

  if (missing.length) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: missing.reduce((acc, item) => {
        acc[item.name] = item.schema;
        return acc;
      }, {})
    });
  }

  const fresh = missing.length
    ? await notion.dataSources.retrieve({ data_source_id: dataSourceId })
    : { properties };

  return {
    databaseId,
    dataSourceId,
    created: missing.map(item => item.name),
    properties: fresh.properties || properties
  };
}

function text(value) {
  return [{ text: { content: String(value || '').slice(0, 2000) } }];
}

function setProp(output, schema, aliases, value) {
  if (value === undefined || value === null || value === '') return;
  const key = findPropertyKey(schema, aliases);
  if (!key) return;
  const type = schema[key]?.type;
  if (type === 'title') output[key] = { title: text(value) };
  if (type === 'rich_text') output[key] = { rich_text: text(value) };
  if (type === 'phone_number') output[key] = { phone_number: String(value) };
  if (type === 'number') {
    const number = Number(value);
    if (Number.isFinite(number)) output[key] = { number };
  }
  if (type === 'url') output[key] = { url: String(value) };
  if (type === 'email') output[key] = { email: String(value) };
  if (type === 'date') output[key] = { date: { start: String(value) } };
  if (type === 'select') output[key] = { select: { name: String(value) } };
}

function buildFeedbackProperties(payload, schema) {
  const properties = {};
  const titleKey = findPropertyKey(schema, FEEDBACK_ALIASES.title)
    || Object.keys(schema).find(key => schema[key]?.type === 'title');
  if (titleKey) {
    properties[titleKey] = { title: text(payload.title || `Feedback - ${payload.clientName || payload.feedbackToken}`) };
  }

  Object.entries(FEEDBACK_ALIASES).forEach(([key, aliases]) => {
    if (key === 'title') return;
    setProp(properties, schema, aliases, payload[key]);
  });

  return properties;
}

async function findFeedbackByToken(token, schema, dataSourceId) {
  const notion = getNotionClient();
  const key = findPropertyKey(schema, FEEDBACK_ALIASES.feedbackToken);
  if (!key) return null;
  const type = schema[key]?.type;
  const filter = type === 'title'
    ? { property: key, title: { equals: token } }
    : { property: key, rich_text: { equals: token } };
  const result = await notion.dataSources.query({ data_source_id: dataSourceId, filter, page_size: 1 });
  return result.results?.[0] || null;
}

async function upsertFeedbackRecord(payload) {
  const notion = getNotionClient();
  const { dataSourceId, properties: schema } = await ensureClientFeedbackSchema();
  const existing = await findFeedbackByToken(payload.feedbackToken, schema, dataSourceId);
  const properties = buildFeedbackProperties(payload, schema);

  if (existing) {
    const page = await notion.pages.update({ page_id: existing.id, properties });
    return { created: false, pageId: page.id };
  }

  const page = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties
  });
  return { created: true, pageId: page.id };
}

function feedbackPageToPayload(page) {
  const properties = page.properties || {};
  return {
    pageId: page.id,
    feedbackToken: getPropertyValue(properties, FEEDBACK_ALIASES.feedbackToken),
    clientPageId: getPropertyValue(properties, FEEDBACK_ALIASES.clientPageId),
    clientName: getPropertyValue(properties, FEEDBACK_ALIASES.clientName),
    reportUrl: getPropertyValue(properties, FEEDBACK_ALIASES.reportUrl),
    feedbackUrl: getPropertyValue(properties, FEEDBACK_ALIASES.feedbackUrl),
    rating: getPropertyValue(properties, FEEDBACK_ALIASES.rating, null),
    comment: getPropertyValue(properties, FEEDBACK_ALIASES.comment),
    submittedAt: getPropertyValue(properties, FEEDBACK_ALIASES.submittedAt, null),
    feedbackStatus: getPropertyValue(properties, FEEDBACK_ALIASES.feedbackStatus),
    reviewUrl: getPropertyValue(properties, FEEDBACK_ALIASES.reviewUrl),
    reviewStatus: getPropertyValue(properties, FEEDBACK_ALIASES.reviewStatus),
    reviewRequestedAt: getPropertyValue(properties, FEEDBACK_ALIASES.reviewRequestedAt, null)
  };
}

function feedbackLookupDebug(token, extra = {}) {
  return {
    id: 'line_token_debug',
    parsedToken: String(token || '').trim().toLowerCase(),
    feedbackDatabaseId: getFeedbackDatabaseId() || null,
    clientsDatabaseId: process.env.NOTION_DATABASE_ID || null,
    feedbackTokenProperty: 'Feedback Token',
    ...extra
  };
}

function clientMatchToFeedbackPayload(client, job) {
  const reportToken = String(job?.result?.publicReportToken || '').trim();
  const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.onrender.com').replace(/\/$/, '');
  const reportUrl = reportToken
    ? `${base}/r/${encodeURIComponent(reportToken)}`
    : String(job?.result?.reportUrl || '')
      .replace(/^https?:\/\/serviceportal\.example\.com/i, base);

  return {
    pageId: null,
    feedbackToken: client.feedbackToken,
    clientPageId: client.clientPageId,
    clientName: client.clientName,
    reportUrl,
    feedbackUrl: job?.feedback?.url || '',
    rating: job?.feedback?.rating ?? null,
    comment: job?.feedback?.comment || '',
    submittedAt: job?.feedback?.submittedAt || null,
    feedbackStatus: job?.feedback?.status || '',
    reviewUrl: job?.review?.url || '',
    reviewStatus: job?.review?.status || '',
    reviewRequestedAt: job?.review?.requestedAt || null
  };
}

async function getFeedbackByToken(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!normalized) return null;

  if (isClientFeedbackConfigured()) {
    try {
      const { dataSourceId, properties: schema } = await getFeedbackDataSourceSchema();
      const page = await findFeedbackByToken(normalized, schema, dataSourceId);
      if (page) {
        const payload = feedbackPageToPayload(page);
        console.info('[line_token_debug]', feedbackLookupDebug(normalized, {
          databaseSearched: 'feedback',
          feedbackMatches: 1,
          clientMatches: 0,
          source: 'feedback_db',
          clientPageId: payload.clientPageId || null
        }));
        return payload;
      }
      console.info('[line_token_debug]', feedbackLookupDebug(normalized, {
        databaseSearched: 'feedback',
        feedbackMatches: 0,
        clientMatches: 0,
        source: null
      }));
    } catch (error) {
      console.warn('[line_token_debug] feedback database lookup failed', error.message);
    }
  } else {
    console.info('[line_token_debug]', feedbackLookupDebug(normalized, {
      databaseSearched: 'feedback',
      feedbackDatabaseConfigured: false,
      feedbackMatches: 0
    }));
  }

  const client = await findClientByFeedbackToken(normalized);
  if (client?.clientPageId) {
    let job = null;
    try {
      job = await getClient(client.clientPageId);
    } catch (error) {
      console.warn('[line_token_debug] client feedback detail lookup failed', error.message);
    }
    console.info('[line_token_debug]', feedbackLookupDebug(normalized, {
      databaseSearched: 'clients',
      clientsTokenProperty: client.tokenProperty,
      feedbackMatches: 0,
      clientMatches: 1,
      source: 'clients_db',
      clientPageId: client.clientPageId
    }));
    return clientMatchToFeedbackPayload(client, job);
  }

  console.info('[line_token_debug]', feedbackLookupDebug(normalized, {
    databaseSearched: 'clients',
    feedbackMatches: 0,
    clientMatches: 0,
    source: null
  }));
  return null;
}

async function submitFeedback(token, payload = {}) {
  const current = await getFeedbackByToken(token);
  if (!current) {
    const error = new Error('Feedback link not found');
    error.statusCode = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const rating = Number(payload.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    const error = new Error('Rating must be between 1 and 5');
    error.statusCode = 400;
    throw error;
  }

  const comment = String(payload.comment || '').trim();
  if (!comment) {
    const error = new Error('Comment is required');
    error.statusCode = 400;
    throw error;
  }

  const name = String(payload.name || payload.clientName || '').trim();
  const email = String(payload.email || '').trim();
  const commentWithMeta = email
    ? `${comment}\n\n—\nEmail: ${email}`
    : comment;

  if (isClientFeedbackConfigured()) {
    await upsertFeedbackRecord({
      ...current,
      title: `Feedback - ${name || current.clientName || token}`,
      clientName: name || current.clientName,
      email: email || undefined,
      rating,
      comment: commentWithMeta,
      submittedAt: now,
      feedbackStatus: 'submitted',
      reviewStatus: 'not_requested'
    });
  }

  if (current.clientPageId) {
    await updateClient(current.clientPageId, {
      feedbackRating: rating,
      feedbackComment: commentWithMeta,
      feedbackSubmittedAt: now,
      feedbackStatus: 'submitted',
      reviewStatus: 'not_requested',
      caseWorkflowStatus: 'feedback_submitted'
    });
  }

  return {
    ok: true,
    feedbackToken: current.feedbackToken || token,
    submittedAt: now,
    feedbackStatus: 'submitted',
    reviewStatus: 'not_requested'
  };
}

async function getClientFeedbackStatus() {
  if (!isClientFeedbackConfigured()) {
    return { configured: false, schemaReady: false, missingRequired: [] };
  }
  const { dataSourceId, properties } = await getFeedbackDataSourceSchema();
  const missingRequired = FEEDBACK_SCHEMA
    .filter(item => item.required && !findPropertyKey(properties, FEEDBACK_ALIASES[item.key] || [item.name]))
    .map(item => item.name);
  return {
    configured: true,
    schemaReady: missingRequired.length === 0,
    dataSourceId,
    missingRequired
  };
}

module.exports = {
  ensureClientFeedbackSchema,
  upsertFeedbackRecord,
  getFeedbackByToken,
  submitFeedback,
  getClientFeedbackStatus,
  isClientFeedbackConfigured
};
