'use strict';

/**
 * Canonical Customer Domain event names.
 * Emission is deferred to later milestones — names are stable for M8+.
 */
const CUSTOMER_DOMAIN_EVENTS = Object.freeze({
  CustomerCreated: 'CustomerCreated',
  CustomerMatched: 'CustomerMatched',
  CustomerLinkedToCase: 'CustomerLinkedToCase',
  CustomerUpdated: 'CustomerUpdated',
  CustomerMerged: 'CustomerMerged',
  CustomerLineLinked: 'CustomerLineLinked'
});

module.exports = { CUSTOMER_DOMAIN_EVENTS };
