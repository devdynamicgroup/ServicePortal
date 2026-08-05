'use strict';

const { getNotionConfig } = require('../../config/env');
const { getCustomerDomainFlags } = require('./flags');

function getCustomersDatabaseId() {
  return String(process.env.NOTION_CUSTOMERS_DATABASE_ID || '').trim();
}

function getCustomersDataSourceIdOverride() {
  return String(process.env.NOTION_CUSTOMERS_DATA_SOURCE_ID || '').trim();
}

/**
 * Customers DB is optional while flags are OFF.
 * Required only when Customer Domain flags are enabled (validated at startup as warning).
 */
function isCustomersDbConfigured() {
  const { apiKey } = getNotionConfig();
  return Boolean(apiKey && getCustomersDatabaseId());
}

function getCustomerDomainConfig() {
  return Object.freeze({
    flags: getCustomerDomainFlags(),
    databaseId: getCustomersDatabaseId() || null,
    dataSourceIdOverride: getCustomersDataSourceIdOverride() || null,
    databaseConfigured: isCustomersDbConfigured()
  });
}

module.exports = {
  getCustomersDatabaseId,
  getCustomersDataSourceIdOverride,
  isCustomersDbConfigured,
  getCustomerDomainConfig
};
