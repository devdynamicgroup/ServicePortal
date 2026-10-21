'use strict';

/**
 * Admin-only alert when a new Case is created.
 *
 * Sends one LINE text to the ids in OPS_ALERT_LINE_TO (user ids for the
 * personal test, or a group id later). Does not write Case notificationStatus,
 * does not message the customer, and never throws — a LINE failure must not
 * fail case creation.
 */

const { sendLinePush } = require('./line-notifications');
const { logEvent } = require('./observability');

let deps = { sendLinePush };

function setOpsCaseAlertDependencies(overrides = {}) {
  deps = { ...deps, ...overrides };
}

function resetOpsCaseAlertDependencies() {
  deps = { sendLinePush };
}

function listOpsAlertTargets(raw = process.env.OPS_ALERT_LINE_TO) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function field(job, key) {
  return String(job?.draft?.fields?.[key] || '').trim();
}

function displayName(job) {
  const full = [field(job, 'ci-fname'), field(job, 'ci-lname')].filter(Boolean).join(' ');
  return full || String(job?.name || '').trim() || '-';
}

function displayAddress(job) {
  const raw = field(job, 'ci-addr');
  if (raw) return raw;
  const addr = String(job?.addr || '').trim();
  if (!addr || addr === 'Address to confirm') return '-';
  return addr;
}

function displayWhen(job) {
  const time = [job?.timeStart, job?.timeEnd].filter(Boolean).join('–');
  return [job?.date, time].filter(Boolean).join(' ') || '-';
}

function buildOpsCaseAlertText(job = {}) {
  const lines = [
    'มีเคสใหม่',
    `ชื่อ: ${displayName(job)}`,
    `เบอร์: ${field(job, 'ci-phone') || '-'}`,
    `นัด: ${displayWhen(job)}`,
    `ที่อยู่: ${displayAddress(job)}`,
    `ช่องทาง: ${field(job, 'ci-source') || '-'}`
  ];
  const lineId = field(job, 'ci-line');
  if (lineId) lines.push(`LINE: ${lineId}`);
  const caseId = String(job?.id || job?.notionId || '').trim();
  if (caseId) lines.push(`เคส: ${caseId}`);
  return lines.join('\n');
}

async function notifyAdminsOfNewCase(job, context = {}) {
  const targets = listOpsAlertTargets();
  if (!targets.length) {
    return { ok: true, skipped: true, reason: 'no_targets', results: [] };
  }

  const text = buildOpsCaseAlertText(job);
  const results = [];
  for (const to of targets) {
    try {
      const sent = await deps.sendLinePush(to, [{ type: 'text', text }], {
        caseId: job?.id || null,
        notionId: job?.notionId || null
      });
      results.push({ ok: Boolean(sent?.ok), status: sent?.status || 'unknown' });
    } catch (error) {
      results.push({ ok: false, status: 'failed', error: error?.message || 'failed' });
    }
  }

  logEvent(results.some(row => row.ok) ? 'info' : 'warn', 'ops_case_alert', {
    correlationId: context.correlationId || null,
    source: context.source || null,
    notionId: job?.notionId || null,
    targetCount: targets.length,
    sentCount: results.filter(row => row.ok).length
  });

  return {
    ok: results.some(row => row.ok),
    skipped: false,
    results
  };
}

module.exports = {
  listOpsAlertTargets,
  buildOpsCaseAlertText,
  notifyAdminsOfNewCase,
  setOpsCaseAlertDependencies,
  resetOpsCaseAlertDependencies
};
