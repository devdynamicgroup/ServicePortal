'use strict';

/**
 * M9.2 read-only Care outcome rollups.
 * Does not send LINE or enable CARE_SEND.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_DIR } = require('./audit');
const {
  measureCareOutcome,
  RESPONSE_STATUS
} = require('./outcomes');

function loadAuditEvents(dir = DEFAULT_DIR) {
  const eventsPath = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  const lines = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // skip bad lines
    }
  }
  return rows;
}

/** Prefer latest record per audit id (jsonl appends). */
function latestAuditsById(events) {
  const map = new Map();
  for (const row of events) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    map.set(id, row);
  }
  return [...map.values()];
}

function redactId(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * @param {{
 *   dir?: string,
 *   jobs?: object[],
 *   lineByCaseNotionId?: Record<string, string>,
 *   now?: Date
 * }} [options]
 */
function buildCareOutcomeReport(options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const jobs = options.jobs || [];
  const lineByCase = options.lineByCaseNotionId || {};
  const now = options.now || new Date();

  const events = latestAuditsById(loadAuditEvents(dir));
  const delivery = {
    sent: 0,
    failed: 0,
    skipped: 0,
    dry_run: 0,
    sending: 0,
    planned: 0,
    other: 0
  };
  const response = {
    unknown: 0,
    no_response: 0,
    utm_click: 0,
    rebooked: 0,
    opted_out: 0
  };

  const measured = [];
  for (const audit of events) {
    const status = String(audit.status || '');
    if (Object.prototype.hasOwnProperty.call(delivery, status)) delivery[status] += 1;
    else delivery.other += 1;

    const sourceNotionId = String(audit.caseNotionId || audit.caseId || '').trim();
    const sourceLine = lineByCase[sourceNotionId]
      || (jobs.find(j => String(j?.notionId || '') === sourceNotionId)?.line?.userId)
      || '';

    const outcome = measureCareOutcome(audit, {
      jobs,
      sourceLineUserId: sourceLine,
      now
    });

    const rs = outcome.responseStatus || RESPONSE_STATUS.UNKNOWN;
    if (Object.prototype.hasOwnProperty.call(response, rs)) response[rs] += 1;
    else response.unknown += 1;

    measured.push({
      careAuditId: outcome.careAuditId,
      deliveryStatus: outcome.deliveryStatus,
      responseStatus: outcome.responseStatus,
      rebookWithin30d: outcome.rebookWithin30d,
      linkedCaseIdAfter: outcome.linkedCaseIdAfter
        ? redactId(outcome.linkedCaseIdAfter)
        : null,
      caseNotionId: redactId(sourceNotionId),
      measuredAt: outcome.measuredAt
    });
  }

  const sent = delivery.sent;
  const rebooked = response.rebooked;
  const rebookRate = sent > 0 ? Number((rebooked / sent).toFixed(4)) : null;

  return {
    generatedAt: now.toISOString(),
    dir,
    auditCount: events.length,
    delivery,
    response,
    rebookRate,
    samples: measured.slice(0, 50),
    note: 'Read-only report. Does not enable CARE_LIFECYCLE_SEND or write Case notification state.'
  };
}

function writeOutcomeReport(report, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const fullPath = path.join(dir, `outcome-report-${stamp}.json`);
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'latest-outcome-report.json'), JSON.stringify(report, null, 2), 'utf8');
  return { fullPath };
}

module.exports = {
  loadAuditEvents,
  latestAuditsById,
  buildCareOutcomeReport,
  writeOutcomeReport
};
