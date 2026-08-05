'use strict';

/**
 * Customer Repository interface (contract for persistence adapters).
 * Business code must use customerId; notionPageId is persistence-only.
 *
 * @typedef {import('./model').Customer} Customer
 *
 * @typedef {object} CustomerRepository
 * @property {() => boolean} isConfigured
 * @property {() => Promise<{ databaseId: string, dataSourceId: string, properties: object }>} getSchema
 * @property {(customerId: string) => Promise<Customer|null>} findByCustomerId
 * @property {(notionPageId: string) => Promise<Customer|null>} findByNotionPageId
 * @property {(lineUserId: string) => Promise<Customer|null>} findByLineUserId
 * @property {(phoneNormalized: string) => Promise<Customer|null>} findByPhone
 * @property {(emailNormalized: string) => Promise<Customer|null>} findByEmail
 * @property {(input: Partial<Customer>) => Promise<Customer>} create
 * @property {(customerId: string, patch: Partial<Customer>) => Promise<Customer|null>} updateByCustomerId
 */

/** Marker export so consumers can require interfaces without side effects. */
const CustomerRepositoryInterface = Object.freeze({
  methods: Object.freeze([
    'isConfigured',
    'getSchema',
    'findByCustomerId',
    'findByNotionPageId',
    'findByLineUserId',
    'findByPhone',
    'findByEmail',
    'create',
    'updateByCustomerId'
  ])
});

module.exports = { CustomerRepositoryInterface };
