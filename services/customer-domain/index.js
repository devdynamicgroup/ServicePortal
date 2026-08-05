'use strict';

/**
 * Customer Domain (Identity) — M8.1 infrastructure entrypoint.
 *
 * Case remains the aggregate root. This module must not own Offer / Workflow /
 * Booking / Feedback / Reports. Production request paths must not call the
 * repository until later milestones enable feature flags.
 */

const { CUSTOMER_FIELD_ALIASES, CUSTOMER_STATUS } = require('./aliases');
const { getCustomerDomainFlags, isAnyCustomerDomainFlagOn } = require('./flags');
const {
  getCustomerDomainConfig,
  isCustomersDbConfigured,
  getCustomersDatabaseId
} = require('./config');
const {
  createCustomerId,
  isValidCustomerId,
  createEmptyCustomer,
  CUSTOMER_ID_PREFIX
} = require('./model');
const { normalizeEmail, normalizePhone, assertValidCustomerId } = require('./validate');
const { CUSTOMER_DOMAIN_EVENTS } = require('./events');
const { CustomerRepositoryInterface } = require('./interfaces');
const customerRepository = require('./repository');
const {
  CUSTOMER_PROPERTY_DEFINITIONS,
  getCustomerSchemaStatus,
  ensureCustomersSchema
} = require('./schema');

let registered = false;

/**
 * Bootstrap registration — loads config/flags only.
 * Does not open Notion connections or mutate data.
 */
function registerCustomerDomain(options = {}) {
  if (registered && !options.force) {
    return getCustomerDomainConfig();
  }

  const config = getCustomerDomainConfig();
  registered = true;

  if (options.log !== false) {
    console.info('[customer-domain] registered', {
      enabled: config.flags.enabled,
      dualWrite: config.flags.dualWrite,
      readLine: config.flags.readLine,
      readLineShadow: config.flags.readLineShadow,
      readNotify: config.flags.readNotify,
      readNotifyShadow: config.flags.readNotifyShadow,
      databaseConfigured: config.databaseConfigured
    });
  }

  return config;
}

function getRegistrationStatus() {
  return {
    registered,
    ...getCustomerDomainConfig()
  };
}

module.exports = {
  registerCustomerDomain,
  getRegistrationStatus,
  getCustomerDomainFlags,
  isAnyCustomerDomainFlagOn,
  getCustomerDomainConfig,
  isCustomersDbConfigured,
  getCustomersDatabaseId,
  CUSTOMER_FIELD_ALIASES,
  CUSTOMER_STATUS,
  CUSTOMER_ID_PREFIX,
  CUSTOMER_DOMAIN_EVENTS,
  CUSTOMER_PROPERTY_DEFINITIONS,
  CustomerRepositoryInterface,
  createCustomerId,
  isValidCustomerId,
  createEmptyCustomer,
  normalizeEmail,
  normalizePhone,
  assertValidCustomerId,
  getCustomerSchemaStatus,
  ensureCustomersSchema,
  repository: customerRepository,
  matcher: require('./matcher'),
  creator: require('./creator'),
  linker: require('./linker'),
  resolver: require('./resolver'),
  merge: require('./merge'),
  lineReader: require('./line-reader'),
  lineReadMetrics: require('./line-read-metrics'),
  notifyReader: require('./notify-reader'),
  notifyReadMetrics: require('./notify-read-metrics')
};
