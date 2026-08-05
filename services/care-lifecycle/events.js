'use strict';

const CARE_EVENT_TYPES = Object.freeze({
  REINSPECTION_6MO: 'care.reinspection_6mo'
});

const CARE_AUDIT_STATUS = Object.freeze({
  PLANNED: 'planned',
  DRY_RUN: 'dry_run',
  SKIPPED: 'skipped',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed'
});

const DESTINATION_TYPES = Object.freeze({
  CASE_LINE: 'case_line',
  CUSTOMER_LINE: 'customer_line'
});

const TEMPLATE_VERSIONS = Object.freeze({
  REINSPECTION_6MO: 'reinspection_6mo.v1'
});

module.exports = {
  CARE_EVENT_TYPES,
  CARE_AUDIT_STATUS,
  DESTINATION_TYPES,
  TEMPLATE_VERSIONS
};
