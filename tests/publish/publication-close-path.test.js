/**
 * Gate A regression: closeCase has no direct Latest Water Score write.
 * Run: node tests/publish/publication-close-path.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../services/workflow-service.js'), 'utf8');
const closeStart = source.indexOf('async function closeCase');
const closeEnd = source.indexOf('\nasync function recordFeedback', closeStart);
assert(closeStart >= 0 && closeEnd > closeStart, 'closeCase source is present');

const closeSource = source.slice(closeStart, closeEnd);
assert(closeSource.includes('createOrReusePublication('),
  'closeCase delegates a missing score publication to the immutable publication service');
assert(!closeSource.includes('latestWaterScore:'),
  'closeCase never directly overwrites Latest Water Score');
assert(!closeSource.includes("newToken('rpt')"),
  'closeCase does not mint a replacement historical report token');

console.log('publication-close-path: PASS');
