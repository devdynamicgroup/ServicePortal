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
const { publicBaseUrl } = require('./url-builder');

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
  if (!addr || addr === 'Address to confirm') return 'รอยืนยันข้อมูล';
  return addr;
}

function displayDate(job) {
  return String(job?.date || '').trim() || '-';
}

function displayTime(job) {
  const time = [job?.timeStart, job?.timeEnd].filter(Boolean).join('–');
  return time ? `${time} น.` : '-';
}

const SOURCE_LABELS = {
  'cal.com': 'หน้าเว็บ/ระบบจองคิว'
};

function portalHost() {
  try {
    return publicBaseUrl().replace(/^https?:\/\//, '');
  } catch {
    return 'ระบบหลังบ้าน';
  }
}

function displayCreatedFrom(context = {}) {
  if (context.source === 'portal') return portalHost();
  return SOURCE_LABELS[context.source] || '-';
}

function buildOpsCaseAlertText(job = {}, context = {}) {
  const lines = [
    '💧 WATER MOTION | NEW CASE',
    'มี Case ใหม่เข้าสู่ระบบ',
    '----------------------',
    `👤 ชื่อลูกค้า: ${displayName(job)}`,
    `📞 เบอร์โทร: ${field(job, 'ci-phone') || '-'}`,
    `📅 วันนัดหมาย: ${displayDate(job)}`,
    `🕘 เวลา: ${displayTime(job)}`,
    `📍 ที่อยู่: ${displayAddress(job)}`,
    `🛠️ สร้างจาก: ${displayCreatedFrom(context)}`
  ];
  const lineId = field(job, 'ci-line');
  if (lineId) lines.push(`💬 LINE: ${lineId}`);
  lines.push('----------------------');
  const caseId = String(job?.id || job?.notionId || '').trim();
  lines.push(`🆔 Case ID: ${caseId || '-'}`);
  lines.push('');
  lines.push('⚠️ กรุณาตรวจสอบข้อมูลลูกค้าและยืนยันที่อยู่ก่อนดำเนินการ');
  return lines.join('\n');
}

async function notifyAdminsOfNewCase(job, context = {}) {
  const targets = listOpsAlertTargets();
  if (!targets.length) {
    return { ok: true, skipped: true, reason: 'no_targets', results: [] };
  }

  const text = buildOpsCaseAlertText(job, context);
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
