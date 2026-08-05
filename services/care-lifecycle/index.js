'use strict';

/**
 * M9.0 Customer Care Lifecycle — event-driven care messages.
 * Case remains ops SSOT; Customer remains identity; Care owns audit.
 * Does not modify Case notification state machine.
 */

const flags = require('./flags');
const events = require('./events');
const eligibility = require('./eligibility');
const destination = require('./destination');
const audit = require('./audit');
const policy = require('./policy');
const sender = require('./sender');
const run = require('./run');
const outcomes = require('./outcomes');
const outcomeReport = require('./outcome-report');
const reinspectionTemplate = require('./templates/reinspection-6mo');

module.exports = {
  ...flags,
  ...events,
  ...eligibility,
  ...destination,
  ...audit,
  ...policy,
  ...sender,
  ...run,
  ...outcomes,
  ...outcomeReport,
  templates: {
    reinspection6mo: reinspectionTemplate
  }
};
