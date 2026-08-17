/**
 * Canonical Score Model V7 skeleton entry.
 * Pure simulation only. Does not import Notion, Case, Q-V3, or country engines.
 */
const constants = require('./constants');
const profiles = require('./profiles');
const simulate = require('./simulate');

module.exports = {
  ...constants,
  ...profiles,
  ...simulate
};
