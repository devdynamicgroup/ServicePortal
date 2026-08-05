'use strict';

/**
 * Case ↔ Customer linker.
 * Writes ONLY additive Case fields: Customer ID, Customer Page ID.
 */

const { updateClient } = require('../notion/clients');

/**
 * @param {string} caseNotionId
 * @param {{ customerId: string, notionPageId: string }} customer
 */
async function linkCaseToCustomer(caseNotionId, customer) {
  const pageId = String(caseNotionId || '').trim();
  const customerId = String(customer?.customerId || '').trim();
  const customerPageId = String(customer?.notionPageId || '').trim();

  if (!pageId) {
    const error = new Error('caseNotionId is required to link Customer');
    error.code = 'missing_case_id';
    throw error;
  }
  if (!customerId || !customerPageId) {
    const error = new Error('customerId and notionPageId are required to link Case');
    error.code = 'missing_customer_link';
    throw error;
  }

  const job = await updateClient(pageId, {
    customerId,
    customerPageId
  });

  return {
    caseId: job?.notionId || pageId,
    customerId,
    customerPageId,
    job
  };
}

module.exports = {
  linkCaseToCustomer
};
