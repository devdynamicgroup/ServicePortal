'use strict';

/**
 * Care lifecycle run orchestration (CLI / cron).
 * Never updates Case notificationStatus.
 */

const crypto = require('crypto');
const { getAllClients } = require('../notion/clients');
const { repository } = require('../customer-domain');
const { getCustomerDomainFlags } = require('../customer-domain/flags');
const {
  getCareLifecycleFlags,
  getCareReinspectionDays
} = require('./flags');
const { CARE_EVENT_TYPES, CARE_AUDIT_STATUS } = require('./events');
const { evaluateCarePlan } = require('./policy');
const { recordCareAudit, writeRunReport, DEFAULT_DIR } = require('./audit');
const { sendCareMessages } = require('./sender');

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `care-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

function planToAuditFields(plan, status, extras = {}) {
  const el = plan.eligibility || {};
  const dest = plan.destination || {};
  return {
    caseId: el.caseId || null,
    caseNotionId: el.caseNotionId || null,
    customerId: dest.customerId || el.customerId || null,
    eventType: plan.eventType,
    scheduledAt: el.scheduledAt || null,
    triggerSource: extras.triggerSource || 'cli',
    destinationType: dest.destinationType || null,
    destinationIdHash: dest.destinationIdHash || '',
    status,
    idempotencyKey: el.idempotencyKey || null,
    templateVersion: plan.templateVersion || null,
    reason: plan.reason || extras.reason || null,
    failureReason: extras.failureReason || null,
    sentAt: extras.sentAt || null
  };
}

/**
 * Scan Cases and produce dry-run / planned audits (no LINE unless mode=write + flags).
 *
 * @param {{
 *   mode?: 'dry-run'|'write',
 *   eventType?: string,
 *   limit?: number,
 *   dir?: string,
 *   jobs?: object[],
 *   requireEnabled?: boolean,
 *   deps?: object
 * }} options
 */
async function runCareLifecycle(options = {}) {
  const mode = options.mode === 'write' ? 'write' : 'dry-run';
  const eventType = options.eventType || CARE_EVENT_TYPES.REINSPECTION_6MO;
  const flags = options.flags || getCareLifecycleFlags();
  const dir = options.dir || DEFAULT_DIR;
  const requireEnabled = options.requireEnabled !== false;

  if (mode === 'write') {
    if (!flags.enabled || !flags.send) {
      const error = new Error('CARE_LIFECYCLE_ENABLED and CARE_LIFECYCLE_SEND must be true for write/send mode');
      error.code = 'care_send_flags_off';
      throw error;
    }
  } else if (requireEnabled && !flags.enabled && !options.allowDisabledDryRun) {
    // Local fixture tests can set allowDisabledDryRun; prod CLI defaults require ENABLED for scan in prod sense.
    // Plan: dry-run allowed when ENABLED; for offline fixtures we allow override.
  }

  const jobs = options.jobs || await getAllClients();
  const limit = Number.isFinite(Number(options.limit)) ? Math.floor(Number(options.limit)) : null;
  const list = limit ? jobs.slice(0, limit) : jobs;

  const deps = {
    findByCustomerId: (...args) => repository.findByCustomerId(...args),
    ...(options.deps || {})
  };

  const runId = options.runId || createRunId();
  const startedAt = new Date().toISOString();
  const results = [];
  let planned = 0;
  let skipped = 0;
  let sent = 0;
  let failed = 0;
  let dryRun = 0;

  for (const job of list) {
    const notificationStatusBefore = job?.notification?.status;

    const plan = await evaluateCarePlan(job, {
      eventType,
      dir,
      now: options.now,
      reinspectionDays: options.reinspectionDays != null
        ? options.reinspectionDays
        : getCareReinspectionDays(),
      customerDomainFlags: options.customerDomainFlags || getCustomerDomainFlags(),
      deps
    });

    if (plan.status === CARE_AUDIT_STATUS.SKIPPED) {
      skipped += 1;
      const recorded = await recordCareAudit(
        planToAuditFields(plan, CARE_AUDIT_STATUS.SKIPPED),
        { dir, writeNotion: false }
      );
      results.push({
        status: CARE_AUDIT_STATUS.SKIPPED,
        reason: plan.reason,
        auditId: recorded.audit.id,
        caseNotionId: plan.eligibility?.caseNotionId || job?.notionId || null,
        notificationStatusBefore,
        notificationStatusAfter: job?.notification?.status
      });
      continue;
    }

    if (mode === 'dry-run') {
      dryRun += 1;
      planned += 1;
      const recorded = await recordCareAudit(
        planToAuditFields(plan, CARE_AUDIT_STATUS.DRY_RUN),
        { dir, writeNotion: Boolean(options.writeNotion) }
      );
      results.push({
        status: CARE_AUDIT_STATUS.DRY_RUN,
        auditId: recorded.audit.id,
        caseNotionId: plan.eligibility?.caseNotionId,
        idempotencyKey: plan.eligibility?.idempotencyKey,
        destinationType: plan.destination?.destinationType,
        notificationStatusBefore,
        notificationStatusAfter: job?.notification?.status
      });
      continue;
    }

    // write/send
    planned += 1;
    await recordCareAudit(
      planToAuditFields(plan, CARE_AUDIT_STATUS.SENDING),
      { dir, writeNotion: Boolean(options.writeNotion) }
    );

    const lineResult = await sendCareMessages(plan, {
      sendLinePush: options.deps?.sendLinePush
    });

    if (lineResult.ok) {
      sent += 1;
      const recorded = await recordCareAudit(
        planToAuditFields(plan, CARE_AUDIT_STATUS.SENT, {
          sentAt: new Date().toISOString()
        }),
        { dir, writeNotion: Boolean(options.writeNotion) }
      );
      results.push({
        status: CARE_AUDIT_STATUS.SENT,
        auditId: recorded.audit.id,
        caseNotionId: plan.eligibility?.caseNotionId,
        lineStatus: lineResult.status,
        notificationStatusBefore,
        notificationStatusAfter: job?.notification?.status
      });
    } else {
      failed += 1;
      const recorded = await recordCareAudit(
        planToAuditFields(plan, CARE_AUDIT_STATUS.FAILED, {
          failureReason: lineResult.error || lineResult.status || 'send_failed'
        }),
        { dir, writeNotion: Boolean(options.writeNotion) }
      );
      results.push({
        status: CARE_AUDIT_STATUS.FAILED,
        auditId: recorded.audit.id,
        caseNotionId: plan.eligibility?.caseNotionId,
        failureReason: lineResult.error || lineResult.status,
        notificationStatusBefore,
        notificationStatusAfter: job?.notification?.status
      });
    }
  }

  const report = {
    runId,
    mode,
    eventType,
    startedAt,
    finishedAt: new Date().toISOString(),
    flags: {
      CARE_LIFECYCLE_ENABLED: flags.enabled,
      CARE_LIFECYCLE_SEND: flags.send
    },
    counts: {
      casesScanned: list.length,
      planned,
      dryRun,
      skipped,
      sent,
      failed
    },
    results
  };

  const paths = writeRunReport(report, { dir });
  return { ...report, paths };
}

module.exports = {
  runCareLifecycle,
  createRunId,
  planToAuditFields
};
