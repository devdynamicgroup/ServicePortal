const {
  getNotionClient,
  isNotionConfigured,
  resolveDataSourceId,
  getDataSourceSchema
} = require('./client');
const { findPropertyKey } = require('./props');
const { FIELD_ALIASES, notionPageToJob } = require('./mapper');

const CASE_FLOW_REQUIREMENTS = {
  line: [
    { key: 'lineDisplayName', label: 'LINE Display Name', required: true },
    { key: 'lineUserId', label: 'LINE User ID', required: true },
    { key: 'lineLinked', label: 'LINE Linked', required: true },
    { key: 'lineLinkedAt', label: 'LINE Linked At', required: false }
  ],
  workflow: [
    { key: 'caseWorkflowStatus', label: 'Case Workflow Status', required: true },
    { key: 'serviceStartedAt', label: 'Service Started At', required: false },
    { key: 'serviceCompletedAt', label: 'Service Completed At', required: true },
    { key: 'closedAt', label: 'Closed At', required: true },
    { key: 'completedBy', label: 'Completed By', required: false }
  ],
  result: [
    { key: 'latestWaterScore', label: 'Latest Water Score', required: true },
    { key: 'resultSummary', label: 'Result Summary', required: true },
    { key: 'recommendations', label: 'Recommendations', required: false },
    { key: 'reportUrl', label: 'Report URL', required: true },
    { key: 'publicReportToken', label: 'Public Report Token', required: true }
  ],
  feedback: [
    { key: 'feedbackToken', label: 'Feedback Token', required: true },
    { key: 'feedbackUrl', label: 'Feedback URL', required: true },
    { key: 'feedbackStatus', label: 'Feedback Status', required: true },
    { key: 'feedbackRating', label: 'Feedback Rating', required: false },
    { key: 'feedbackComment', label: 'Feedback Comment', required: false },
    { key: 'feedbackSubmittedAt', label: 'Feedback Submitted At', required: false }
  ],
  review: [
    { key: 'reviewUrl', label: 'Review URL', required: true },
    { key: 'reviewRequestedAt', label: 'Review Requested At', required: false },
    { key: 'reviewStatus', label: 'Review Status', required: true }
  ],
  notification: [
    { key: 'resultSentAt', label: 'Result Sent At', required: false },
    { key: 'notificationStatus', label: 'Notification Status', required: true },
    { key: 'lineMessageId', label: 'LINE Message ID', required: false },
    { key: 'lastNotificationError', label: 'Last Notification Error', required: false }
  ]
};

async function queryAllPages() {
  const notion = getNotionClient();
  if (!notion) throw new Error('Notion client is not configured');

  const dataSourceId = await resolveDataSourceId();
  const pages = [];
  let startCursor;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: startCursor,
      page_size: 100
    });
    pages.push(...(response.results || []));
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);

  return pages;
}

async function getAllClients() {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const pages = await queryAllPages();
  return pages
    .filter(page => page.object === 'page' && !page.archived && !page.in_trash)
    .map((page, index) => notionPageToJob(page, index));
}

async function getClient(pageId) {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const notion = getNotionClient();
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!page || page.archived) return null;
  return notionPageToJob(page, 0);
}

function buildNotionProperties(payload, schemaProperties = {}) {
  const properties = {};
  const setText = (aliases, value) => {
    if (value === undefined || value === null || value === '') return;
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key) return;
    const type = schemaProperties[key]?.type;
    const text = String(value);
    if (type === 'title') properties[key] = { title: [{ text: { content: text } }] };
    else if (type === 'rich_text') properties[key] = { rich_text: [{ text: { content: text } }] };
    else if (type === 'phone_number') properties[key] = { phone_number: text };
    else if (type === 'email') properties[key] = { email: text };
    else if (type === 'url') properties[key] = { url: text };
  };
  const setSelect = (aliases, value) => {
    if (!value) return;
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key || schemaProperties[key]?.type !== 'select') return;
    properties[key] = { select: { name: String(value) } };
  };
  const setCheckbox = (aliases, value) => {
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key || schemaProperties[key]?.type !== 'checkbox') return;
    properties[key] = { checkbox: Boolean(value) };
  };
  const setNumber = (aliases, value) => {
    if (value === undefined || value === null || value === '') return;
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key || schemaProperties[key]?.type !== 'number') return;
    const number = Number(value);
    if (Number.isFinite(number)) properties[key] = { number };
  };
  const setDate = (aliases, value) => {
    if (!value) return;
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key || schemaProperties[key]?.type !== 'date') return;
    properties[key] = { date: { start: String(value) } };
  };

  setText(FIELD_ALIASES.fullName, payload.fullName);
  setText(FIELD_ALIASES.address, payload.address);
  setText(FIELD_ALIASES.phone, payload.phone);
  setText(FIELD_ALIASES.email, payload.email);
  setText(FIELD_ALIASES.lineId, payload.lineId);
  setText(FIELD_ALIASES.lineDisplayName, payload.lineDisplayName);
  setText(FIELD_ALIASES.lineUserId, payload.lineUserId);
  setCheckbox(FIELD_ALIASES.lineLinked, payload.lineLinked);
  setDate(FIELD_ALIASES.lineLinkedAt, payload.lineLinkedAt);
  setText(FIELD_ALIASES.waterConcerns, payload.waterConcerns);
  setSelect(FIELD_ALIASES.packageHistory, payload.packageHistory);
  setSelect(FIELD_ALIASES.propertyType, payload.propertyType);
  setSelect(FIELD_ALIASES.source, payload.source);
  setSelect(FIELD_ALIASES.currentFilter, payload.currentFilter);
  setSelect(FIELD_ALIASES.stage, payload.stage);
  setSelect(FIELD_ALIASES.status, payload.status);
  setSelect(FIELD_ALIASES.caseWorkflowStatus, payload.caseWorkflowStatus);
  setDate(FIELD_ALIASES.serviceStartedAt, payload.serviceStartedAt);
  setDate(FIELD_ALIASES.serviceCompletedAt, payload.serviceCompletedAt);
  setDate(FIELD_ALIASES.closedAt, payload.closedAt);
  setText(FIELD_ALIASES.completedBy, payload.completedBy);
  setNumber(FIELD_ALIASES.latestWaterScore, payload.latestWaterScore);
  setText(FIELD_ALIASES.resultSummary, payload.resultSummary);
  setText(FIELD_ALIASES.recommendations, payload.recommendations);
  setText(FIELD_ALIASES.reportUrl, payload.reportUrl);
  setText(FIELD_ALIASES.publicReportToken, payload.publicReportToken);
  setText(FIELD_ALIASES.feedbackToken, payload.feedbackToken);
  setText(FIELD_ALIASES.feedbackUrl, payload.feedbackUrl);
  setSelect(FIELD_ALIASES.feedbackStatus, payload.feedbackStatus);
  setNumber(FIELD_ALIASES.feedbackRating, payload.feedbackRating);
  setText(FIELD_ALIASES.feedbackComment, payload.feedbackComment);
  setDate(FIELD_ALIASES.feedbackSubmittedAt, payload.feedbackSubmittedAt);
  setText(FIELD_ALIASES.reviewUrl, payload.reviewUrl);
  setDate(FIELD_ALIASES.reviewRequestedAt, payload.reviewRequestedAt);
  setSelect(FIELD_ALIASES.reviewStatus, payload.reviewStatus);
  setDate(FIELD_ALIASES.resultSentAt, payload.resultSentAt);
  setSelect(FIELD_ALIASES.notificationStatus, payload.notificationStatus);
  setText(FIELD_ALIASES.lineMessageId, payload.lineMessageId);
  setText(FIELD_ALIASES.lastNotificationError, payload.lastNotificationError);
  setCheckbox(FIELD_ALIASES.consentSigned, payload.consentSigned);

  return properties;
}

async function createClient(payload = {}) {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const notion = getNotionClient();
  const { dataSourceId, properties: schema } = await getDataSourceSchema();
  const properties = buildNotionProperties(payload, schema);

  const page = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties
  });

  return notionPageToJob(page, 0);
}

async function updateClient(pageId, payload = {}) {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const notion = getNotionClient();
  const { properties: schema } = await getDataSourceSchema();
  const properties = buildNotionProperties(payload, schema);

  const page = await notion.pages.update({
    page_id: pageId,
    properties
  });

  return notionPageToJob(page, 0);
}

function getIntegrationStatus() {
  const { getNotionConfig } = require('../../config/env');
  const { apiKey, databaseId } = getNotionConfig();
  return {
    configured: Boolean(apiKey && databaseId),
    hasApiKey: Boolean(apiKey),
    hasDatabaseId: Boolean(databaseId)
  };
}

async function getCaseFlowDatasetStatus() {
  if (!isNotionConfigured()) {
    return {
      configured: false,
      complete: false,
      error: 'NOTION_API_KEY and NOTION_DATABASE_ID must be configured',
      groups: {},
      missingRequired: [],
      missingOptional: []
    };
  }

  const { dataSourceId, properties } = await getDataSourceSchema();
  const groups = {};
  const missingRequired = [];
  const missingOptional = [];

  Object.entries(CASE_FLOW_REQUIREMENTS).forEach(([groupName, fields]) => {
    groups[groupName] = fields.map(field => {
      const aliases = FIELD_ALIASES[field.key] || [field.label];
      const propertyKey = findPropertyKey(properties, aliases);
      const found = Boolean(propertyKey);
      const item = {
        label: field.label,
        required: field.required,
        found,
        propertyKey: propertyKey || null,
        type: propertyKey ? properties[propertyKey]?.type || null : null,
        aliases
      };

      if (!found && field.required) missingRequired.push(field.label);
      if (!found && !field.required) missingOptional.push(field.label);
      return item;
    });
  });

  return {
    configured: true,
    complete: missingRequired.length === 0,
    dataSourceId,
    propertyCount: Object.keys(properties || {}).length,
    groups,
    missingRequired,
    missingOptional
  };
}

module.exports = {
  getAllClients,
  getClient,
  createClient,
  updateClient,
  getIntegrationStatus,
  getCaseFlowDatasetStatus,
  CASE_FLOW_REQUIREMENTS
};
