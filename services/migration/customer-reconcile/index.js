'use strict';

/**
 * M8.7 Customer identity reconciliation & ops (offline migration tooling).
 */

const scanner = require('./scanner');
const repair = require('./repair');
const report = require('./report');
const run = require('./run');

module.exports = {
  ...scanner,
  ...repair,
  ...report,
  ...run
};
