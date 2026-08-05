'use strict';

const { getNotionClient } = require('../notion/client');
const { findPropertyKey, getPropertyValue } = require('../notion/props');
const { withRetry } = require('../retry');
const { CUSTOMER_FIELD_ALIASES, CUSTOMER_STATUS } = require('./aliases');
const {
  getCustomersDatabaseId,
  getCustomersDataSourceIdOverride,
  isCustomersDbConfigured
} = require('./config');
const { createEmptyCustomer, createCustomerId, isValidCustomerId } = require('./model');
const { normalizeEmail, normalizePhone } = require('./validate');

let cachedCustomersDataSourceId = null;

function isConfigured() {
  return isCustomersDbConfigured();
}

function resetCustomersDataSourceCache() {
  cachedCustomersDataSourceId = null;
}

async function resolveCustomersDataSourceId() {
  if (cachedCustomersDataSourceId) return cachedCustomersDataSourceId;

  const override = getCustomersDataSourceIdOverride();
  if (override) {
    cachedCustomersDataSourceId = override;
    return cachedCustomersDataSourceId;
  }

  const notion = getNotionClient();
  if (!notion) throw new Error('Notion client is not configured');

  const databaseId = getCustomersDatabaseId();
  if (!databaseId) throw new Error('NOTION_CUSTOMERS_DATABASE_ID is not configured');

  const database = await withRetry(() => notion.databases.retrieve({ database_id: databaseId }));
  const dataSources = database.data_sources || [];
  if (!dataSources.length) {
    throw new Error('Customers database has no data sources');
  }

  if (dataSources.length === 1) {
    cachedCustomersDataSourceId = dataSources[0].id;
    return cachedCustomersDataSourceId;
  }

  let best = null;
  let bestCount = -1;
  for (const ds of dataSources) {
    try {
      const detail = await withRetry(() => notion.dataSources.retrieve({ data_source_id: ds.id }));
      const count = Object.keys(detail.properties || {}).length;
      if (count > bestCount) {
        bestCount = count;
        best = ds.id;
      }
    } catch (error) {
      console.warn('[customer-domain] Could not inspect customers data source', ds.id, error.message);
    }
  }

  cachedCustomersDataSourceId = best || dataSources[0].id;
  return cachedCustomersDataSourceId;
}

async function getSchema() {
  if (!isConfigured()) {
    const error = new Error('NOTION_CUSTOMERS_DATABASE_ID is required');
    error.statusCode = 503;
    throw error;
  }

  const notion = getNotionClient();
  const databaseId = getCustomersDatabaseId();
  const dataSourceId = await resolveCustomersDataSourceId();
  const detail = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  return {
    databaseId,
    dataSourceId,
    properties: detail.properties || {}
  };
}

function notionPageToCustomer(page) {
  if (!page || page.object !== 'page') return null;
  const props = page.properties || {};

  const lifetimeRaw = getPropertyValue(props, CUSTOMER_FIELD_ALIASES.lifetimeScore, '');
  const lifetimeScore = lifetimeRaw === '' || lifetimeRaw == null ? null : Number(lifetimeRaw);

  return createEmptyCustomer({
    customerId: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.customerId, ''),
    notionPageId: page.id || null,
    displayName: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.displayName, ''),
    phone: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.phone, ''),
    email: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.email, ''),
    primaryAddress: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.primaryAddress, ''),
    lineId: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.lineId, ''),
    lineDisplayName: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.lineDisplayName, ''),
    lineUserId: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.lineUserId, ''),
    lineLinked: Boolean(getPropertyValue(props, CUSTOMER_FIELD_ALIASES.lineLinked, false)),
    lineLinkedAt: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.lineLinkedAt, '') || null,
    status: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.status, CUSTOMER_STATUS.ACTIVE) || CUSTOMER_STATUS.ACTIVE,
    lifetimeScore: Number.isFinite(lifetimeScore) ? lifetimeScore : null,
    consentMarketing: Boolean(getPropertyValue(props, CUSTOMER_FIELD_ALIASES.consentMarketing, false)),
    consentLine: Boolean(getPropertyValue(props, CUSTOMER_FIELD_ALIASES.consentLine, false)),
    consentMarketingAt: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.consentMarketingAt, '') || null,
    consentLineAt: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.consentLineAt, '') || null,
    preferredLocale: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.preferredLocale, ''),
    mergedIntoCustomerId: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.mergedIntoCustomerId, '') || null,
    sourceFingerprint: getPropertyValue(props, CUSTOMER_FIELD_ALIASES.sourceFingerprint, ''),
    createdTime: page.created_time || null,
    lastEditedTime: page.last_edited_time || null
  });
}

function buildCustomerProperties(payload, schemaProperties = {}) {
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
    if (value === undefined) return;
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

  setText(CUSTOMER_FIELD_ALIASES.displayName, payload.displayName);
  setText(CUSTOMER_FIELD_ALIASES.customerId, payload.customerId);
  setText(CUSTOMER_FIELD_ALIASES.phone, payload.phone);
  setText(CUSTOMER_FIELD_ALIASES.email, payload.email);
  setText(CUSTOMER_FIELD_ALIASES.primaryAddress, payload.primaryAddress);
  setText(CUSTOMER_FIELD_ALIASES.lineId, payload.lineId);
  setText(CUSTOMER_FIELD_ALIASES.lineDisplayName, payload.lineDisplayName);
  setText(CUSTOMER_FIELD_ALIASES.lineUserId, payload.lineUserId);
  setCheckbox(CUSTOMER_FIELD_ALIASES.lineLinked, payload.lineLinked);
  setDate(CUSTOMER_FIELD_ALIASES.lineLinkedAt, payload.lineLinkedAt);
  setSelect(CUSTOMER_FIELD_ALIASES.status, payload.status);
  setNumber(CUSTOMER_FIELD_ALIASES.lifetimeScore, payload.lifetimeScore);
  setCheckbox(CUSTOMER_FIELD_ALIASES.consentMarketing, payload.consentMarketing);
  setCheckbox(CUSTOMER_FIELD_ALIASES.consentLine, payload.consentLine);
  setDate(CUSTOMER_FIELD_ALIASES.consentMarketingAt, payload.consentMarketingAt);
  setDate(CUSTOMER_FIELD_ALIASES.consentLineAt, payload.consentLineAt);
  setText(CUSTOMER_FIELD_ALIASES.preferredLocale, payload.preferredLocale);
  setText(CUSTOMER_FIELD_ALIASES.mergedIntoCustomerId, payload.mergedIntoCustomerId);
  setText(CUSTOMER_FIELD_ALIASES.sourceFingerprint, payload.sourceFingerprint);

  return properties;
}

function equalsFilter(schemaProperties, aliases, value) {
  const key = findPropertyKey(schemaProperties, aliases);
  if (!key) return null;
  const type = schemaProperties[key]?.type;
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (type === 'title') return { property: key, title: { equals: normalized } };
  if (type === 'rich_text') return { property: key, rich_text: { equals: normalized } };
  if (type === 'phone_number') return { property: key, phone_number: { equals: normalized } };
  if (type === 'email') return { property: key, email: { equals: normalized } };
  return null;
}

async function queryFirstByFilter(filter) {
  if (!filter) return null;
  const notion = getNotionClient();
  const dataSourceId = await resolveCustomersDataSourceId();
  const result = await withRetry(() => notion.dataSources.query({
    data_source_id: dataSourceId,
    filter,
    page_size: 1
  }));
  const page = (result.results || []).find(item => item.object === 'page' && !item.archived && !item.in_trash);
  return page ? notionPageToCustomer(page) : null;
}

async function findByCustomerId(customerId) {
  if (!isConfigured()) return null;
  const id = String(customerId || '').trim();
  if (!isValidCustomerId(id)) return null;
  const { properties } = await getSchema();
  return queryFirstByFilter(equalsFilter(properties, CUSTOMER_FIELD_ALIASES.customerId, id));
}

async function findByNotionPageId(notionPageId) {
  if (!isConfigured()) return null;
  const pageId = String(notionPageId || '').trim();
  if (!pageId) return null;
  const notion = getNotionClient();
  const page = await withRetry(() => notion.pages.retrieve({ page_id: pageId }));
  if (!page || page.archived) return null;
  return notionPageToCustomer(page);
}

async function findByLineUserId(lineUserId) {
  const rows = await findAllByLineUserId(lineUserId, { limit: 1 });
  return rows[0] || null;
}

async function findByPhone(phone) {
  const rows = await findAllByPhone(phone, { limit: 1 });
  return rows[0] || null;
}

async function findByEmail(email) {
  const rows = await findAllByEmail(email, { limit: 1 });
  return rows[0] || null;
}

async function queryAllByFilter(filter, { limit = 100 } = {}) {
  if (!filter) return [];
  const notion = getNotionClient();
  const dataSourceId = await resolveCustomersDataSourceId();
  const pages = [];
  let startCursor;
  do {
    const result = await withRetry(() => notion.dataSources.query({
      data_source_id: dataSourceId,
      filter,
      start_cursor: startCursor,
      page_size: 100
    }));
    pages.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
    if (pages.length >= limit) break;
  } while (startCursor);

  return pages
    .slice(0, limit)
    .filter(page => page.object === 'page' && !page.archived && !page.in_trash)
    .map(notionPageToCustomer)
    .filter(Boolean);
}

async function findAllByLineUserId(lineUserId, options) {
  if (!isConfigured()) return [];
  const id = String(lineUserId || '').trim();
  if (!id) return [];
  const { properties } = await getSchema();
  return queryAllByFilter(equalsFilter(properties, CUSTOMER_FIELD_ALIASES.lineUserId, id), options);
}

async function findAllByPhone(phone, options) {
  if (!isConfigured()) return [];
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const { properties } = await getSchema();
  return queryAllByFilter(equalsFilter(properties, CUSTOMER_FIELD_ALIASES.phone, normalized), options);
}

async function findAllByEmail(email, options) {
  if (!isConfigured()) return [];
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const { properties } = await getSchema();
  return queryAllByFilter(equalsFilter(properties, CUSTOMER_FIELD_ALIASES.email, normalized), options);
}

async function listAllCustomers({ limit = 5000 } = {}) {
  if (!isConfigured()) return [];
  const notion = getNotionClient();
  const dataSourceId = await resolveCustomersDataSourceId();
  const pages = [];
  let startCursor;
  do {
    const result = await withRetry(() => notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: startCursor,
      page_size: 100
    }));
    pages.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
    if (pages.length >= limit) break;
  } while (startCursor);

  return pages
    .slice(0, limit)
    .filter(page => page.object === 'page' && !page.archived && !page.in_trash)
    .map(notionPageToCustomer)
    .filter(Boolean);
}

async function create(input = {}) {
  if (!isConfigured()) {
    const error = new Error('NOTION_CUSTOMERS_DATABASE_ID is required');
    error.statusCode = 503;
    throw error;
  }

  const notion = getNotionClient();
  const { dataSourceId, properties: schema } = await getSchema();
  const customer = createEmptyCustomer({
    ...input,
    customerId: input.customerId && isValidCustomerId(input.customerId)
      ? String(input.customerId).trim()
      : createCustomerId()
  });

  const properties = buildCustomerProperties(customer, schema);
  const page = await withRetry(() => notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties
  }));

  return notionPageToCustomer(page) || { ...customer, notionPageId: page.id };
}

async function updateByCustomerId(customerId, patch = {}) {
  if (!isConfigured()) {
    const error = new Error('NOTION_CUSTOMERS_DATABASE_ID is required');
    error.statusCode = 503;
    throw error;
  }

  const existing = await findByCustomerId(customerId);
  if (!existing?.notionPageId) return null;

  const notion = getNotionClient();
  const { properties: schema } = await getSchema();
  const { customerId: _ignored, notionPageId: _page, ...safePatch } = patch;
  const properties = buildCustomerProperties(safePatch, schema);
  if (!Object.keys(properties).length) return existing;

  const page = await withRetry(() => notion.pages.update({
    page_id: existing.notionPageId,
    properties
  }));

  return notionPageToCustomer(page) || existing;
}

const customerRepository = {
  isConfigured,
  getSchema,
  findByCustomerId,
  findByNotionPageId,
  findByLineUserId,
  findByPhone,
  findByEmail,
  findAllByLineUserId,
  findAllByPhone,
  findAllByEmail,
  listAllCustomers,
  create,
  updateByCustomerId,
  resetCustomersDataSourceCache,
  notionPageToCustomer,
  buildCustomerProperties
};

module.exports = customerRepository;
