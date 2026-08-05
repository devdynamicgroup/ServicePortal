'use strict';

const { getNotionClient } = require('../notion/client');
const { findPropertyKey } = require('../notion/props');
const { withRetry } = require('../retry');
const { CUSTOMER_FIELD_ALIASES, CUSTOMER_STATUS } = require('./aliases');
const customerRepository = require('./repository');

/**
 * Desired Customers DB properties (additive sync).
 * Does not touch Clients/Case DB.
 */
const CUSTOMER_PROPERTY_DEFINITIONS = [
  {
    key: 'displayName',
    name: 'Full Name',
    schema: { title: {} },
    required: true
  },
  {
    key: 'customerId',
    name: 'Customer ID',
    schema: { rich_text: {} },
    required: true
  },
  {
    key: 'phone',
    name: 'Phone',
    schema: { phone_number: {} },
    required: false
  },
  {
    key: 'email',
    name: 'Email',
    schema: { email: {} },
    required: false
  },
  {
    key: 'primaryAddress',
    name: 'Primary Address',
    schema: { rich_text: {} },
    required: false
  },
  {
    key: 'lineId',
    name: 'LINE ID',
    schema: { rich_text: {} },
    required: false
  },
  {
    key: 'lineDisplayName',
    name: 'LINE Display Name',
    schema: { rich_text: {} },
    required: false
  },
  {
    key: 'lineUserId',
    name: 'LINE User ID',
    schema: { rich_text: {} },
    required: false
  },
  {
    key: 'lineLinked',
    name: 'LINE Linked',
    schema: { checkbox: {} },
    required: false
  },
  {
    key: 'lineLinkedAt',
    name: 'LINE Linked At',
    schema: { date: {} },
    required: false
  },
  {
    key: 'status',
    name: 'Status',
    schema: {
      select: {
        options: [
          { name: CUSTOMER_STATUS.ACTIVE, color: 'green' },
          { name: CUSTOMER_STATUS.UNVERIFIED, color: 'yellow' },
          { name: CUSTOMER_STATUS.MERGED, color: 'gray' },
          { name: CUSTOMER_STATUS.ANONYMIZED, color: 'brown' },
          { name: CUSTOMER_STATUS.BLOCKED, color: 'red' }
        ]
      }
    },
    required: true
  },
  {
    key: 'lifetimeScore',
    name: 'Lifetime Score',
    schema: { number: { format: 'number' } },
    required: false
  },
  {
    key: 'consentMarketing',
    name: 'Consent Marketing',
    schema: { checkbox: {} },
    required: false
  },
  {
    key: 'consentLine',
    name: 'Consent LINE',
    schema: { checkbox: {} },
    required: false
  },
  {
    key: 'consentMarketingAt',
    name: 'Consent Marketing At',
    schema: { date: {} },
    required: false
  },
  {
    key: 'consentLineAt',
    name: 'Consent LINE At',
    schema: { date: {} },
    required: false
  },
  {
    key: 'preferredLocale',
    name: 'Preferred Locale',
    schema: { rich_text: {} },
    required: false
  },
  {
    key: 'mergedIntoCustomerId',
    name: 'Merged Into Customer ID',
    schema: { rich_text: {} },
    required: false
  },
  {
    key: 'sourceFingerprint',
    name: 'Source Fingerprint',
    schema: { rich_text: {} },
    required: false
  }
];

function getCustomerSchemaStatus(properties = {}) {
  const fields = CUSTOMER_PROPERTY_DEFINITIONS.map(def => {
    const present = Boolean(findPropertyKey(properties, CUSTOMER_FIELD_ALIASES[def.key] || [def.name]));
    return {
      key: def.key,
      name: def.name,
      required: def.required,
      present
    };
  });

  const missingRequired = fields.filter(f => f.required && !f.present);
  return {
    ok: missingRequired.length === 0,
    fields,
    missingRequired: missingRequired.map(f => f.name)
  };
}

/**
 * Additive schema ensure for Customers DB only.
 * Intended for ops/scripts — not called on app startup in M8.1.
 */
async function ensureCustomersSchema() {
  if (!customerRepository.isConfigured()) {
    const error = new Error('NOTION_CUSTOMERS_DATABASE_ID is required');
    error.statusCode = 503;
    throw error;
  }

  const notion = getNotionClient();
  const { databaseId, dataSourceId, properties } = await customerRepository.getSchema();
  const missing = CUSTOMER_PROPERTY_DEFINITIONS.filter(
    item => !findPropertyKey(properties, CUSTOMER_FIELD_ALIASES[item.key] || [item.name])
  );

  if (missing.length) {
    await withRetry(() => notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: missing.reduce((acc, item) => {
        acc[item.name] = item.schema;
        return acc;
      }, {})
    }));
  }

  const fresh = missing.length
    ? await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }))
    : { properties };

  const status = getCustomerSchemaStatus(fresh.properties || properties);
  return {
    databaseId,
    dataSourceId,
    created: missing.map(item => item.name),
    status,
    properties: fresh.properties || properties
  };
}

module.exports = {
  CUSTOMER_PROPERTY_DEFINITIONS,
  getCustomerSchemaStatus,
  ensureCustomersSchema
};
