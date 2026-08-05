'use strict';

/**
 * Customer Domain — Notion property aliases (Customers DB).
 * Additive only; never rename production Case/Clients properties.
 */

const CUSTOMER_FIELD_ALIASES = {
  displayName: ['Full Name', 'Name', 'Display Name', 'Customer Name'],
  customerId: ['Customer ID', 'CustomerId', 'customerId'],
  phone: ['Phone', 'phone', 'Mobile'],
  email: ['Email', 'email'],
  primaryAddress: ['Primary Address', 'Address', 'address', 'Property Address'],
  lineId: ['LINE ID', 'LINE', 'Line ID', 'lineId'],
  lineDisplayName: ['LINE Display Name', 'Line Display Name', 'LINE Name', 'lineDisplayName'],
  lineUserId: ['LINE User ID', 'Line User ID', 'LINE UID', 'lineUserId'],
  lineLinked: ['LINE Linked', 'Line Linked', 'lineLinked'],
  lineLinkedAt: ['LINE Linked At', 'Line Linked At', 'lineLinkedAt'],
  status: ['Status', 'Customer Status', 'status'],
  lifetimeScore: ['Lifetime Score', 'lifetimeScore'],
  consentMarketing: ['Consent Marketing', 'consentMarketing'],
  consentLine: ['Consent LINE', 'Consent Line', 'consentLine'],
  consentMarketingAt: ['Consent Marketing At', 'consentMarketingAt'],
  consentLineAt: ['Consent LINE At', 'Consent Line At', 'consentLineAt'],
  preferredLocale: ['Preferred Locale', 'Locale', 'preferredLocale'],
  mergedIntoCustomerId: ['Merged Into Customer ID', 'Merged Into', 'mergedIntoCustomerId'],
  sourceFingerprint: ['Source Fingerprint', 'sourceFingerprint']
};

const CUSTOMER_STATUS = Object.freeze({
  ACTIVE: 'active',
  MERGED: 'merged',
  ANONYMIZED: 'anonymized',
  BLOCKED: 'blocked',
  UNVERIFIED: 'unverified'
});

module.exports = {
  CUSTOMER_FIELD_ALIASES,
  CUSTOMER_STATUS
};
