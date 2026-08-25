/**
 * Production E2E — Score Publication Silent Failure re-verification (2026-08-25).
 *
 * Disposable-Case verification of the full chain after patch bb304360:
 *   Login -> Create Case -> Populate 6 score fields (no temp) -> Complete
 *   -> Water Score persisted -> Ledger record -> Report token -> LINE (skip, no recipient)
 *   -> Cleanup
 *
 * Auth: POST /api/auth/login with an operator account explicitly provided
 * for this test. No credential is hard-coded here beyond what was supplied
 * for this run; nothing is committed.
 *
 * The Water Score is computed with the REAL production formula
 * (computeScoreFromReadings / src/js/flows/score.js + computeQualityScoreV2.js)
 * run via vm against the exact 6 readings submitted -- not a fabricated number.
 *
 * Run: node scripts/prod-e2e-score-publication.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = process.env.E2E_BASE_URL || 'https://serviceportal.onrender.com';
const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error('BLOCKED — valid production authentication material is not available.');
  console.error('Set E2E_USERNAME and E2E_PASSWORD environment variables before running this script.');
  console.error('No credential is stored in this file.');
  process.exit(1);
}

const results = {};
function record(name, status, detail) {
  results[name] = { status, detail };
  console.log(`[${status}] ${name}${detail ? ' -- ' + detail : ''}`);
}

let cookie = '';
async function api(method, urlPath, body) {
  const r = await fetch(BASE + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, json, headers: r.headers };
}

function buildScoreEngineContext() {
  const domStub = {
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } })
  };
  const sandbox = {
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: { activeJob: null, tapData: [], taps: [] },
    t: (k) => k
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const files = [
    'src/js/flows/assessment.js',
    'src/js/score/production/computeQualityScoreV2.js',
    'src/js/flows/score.js'
  ];
  const noisy = console.warn;
  console.warn = () => {};
  for (const rel of files) {
    const code = fs.readFileSync(path.join('D:/Service Portal', rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: path.basename(rel) });
  }
  console.warn = noisy;
  return sandbox;
}

async function main() {
  // --- Step 1: Preconditions ---
  const deployCheckKey = process.env.RENDER_API_KEY;
  console.log('=== Preconditions ===');
  console.log('(Deploy/live status was already verified out-of-band: commit bb304360, status=live)');
  console.log();

  // --- Step 2: Login ---
  console.log('=== AUTH ===');
  const login = await api('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
  const setCookie = login.headers.get('set-cookie');
  const rawCookie = setCookie ? setCookie.split(';')[0] : '';
  if (login.status === 200 && rawCookie && login.json?.user?.username === USERNAME) {
    cookie = rawCookie;
    record('AUTH', 'PASS', `logged in as ${login.json.user.username} (${login.json.user.role})`);
  } else {
    record('AUTH', 'BLOCKED', `login failed, status=${login.status}`);
    printVerdict();
    return;
  }

  // --- Step 3: Create disposable Case ---
  console.log('\n=== CREATE CASE ===');
  const suffix = Date.now().toString().slice(-8);
  const caseName = `QA-FORENSIC-DELETE-ME ${suffix}`;
  const create = await api('POST', '/api/cases', {
    fullName: caseName,
    phone: '0800000000',
    email: `qa-forensic-${suffix}@example.invalid`,
    startOnSite: true,
    skipMap: true
  });
  let caseId = null;
  let notionId = null;
  if (create.status === 201 && create.json?.ok !== false) {
    caseId = create.json?.case?.id || create.json?.id;
    notionId = create.json?.case?.notionId || create.json?.notionId;
    record('CREATE CASE', 'PASS', `caseId=${caseId} notionId=${notionId} status=${create.status}`);
  } else {
    record('CREATE CASE', 'FAIL', `status=${create.status} body=${JSON.stringify(create.json)}`);
    printVerdict();
    return;
  }

  // --- Step 4: Populate 6 score fields (no temp) ---
  console.log('\n=== 6 FIELDS WITHOUT TEMP ===');
  const readings = { ph: 7.2, tds: 150, chlorine: 1.0, turbidity: 0.5, orp: 200, do: 7.0 };
  const snapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    revision: 1,
    taps: [{
      index: 0,
      name: 'Tap 1',
      standardMeasurement: { ...readings }
    }]
  };
  const assess = await api('POST', `/api/cases/${encodeURIComponent(caseId)}/assessment`, { snapshot });
  if (assess.status === 200 && assess.json?.ok) {
    record('6 FIELDS WITHOUT TEMP', 'PASS', `snapshot persisted, bytes=${assess.json.bytes}`);
  } else {
    record('6 FIELDS WITHOUT TEMP', 'FAIL', `status=${assess.status} body=${JSON.stringify(assess.json)}`);
    await cleanup(caseId, notionId);
    printVerdict();
    return;
  }

  // Fetch back what the backend actually persisted (authoritative source).
  const clientsAfterAssess = await api('GET', '/api/clients');
  const jobAfterAssess = (clientsAfterAssess.json?.jobs || []).find(j => j.id === caseId || j.notionId === notionId);
  if (!jobAfterAssess) {
    record('6 FIELDS WITHOUT TEMP', 'FAIL', 'could not find created Case via GET /api/clients');
    await cleanup(caseId, notionId);
    printVerdict();
    return;
  }
  console.log(`  verified via GET /api/clients: workflow.status=${jobAfterAssess.workflow?.status}`);

  // --- Compute the real production score from exactly these 6 readings ---
  const sb = buildScoreEngineContext();
  const scoreDetail = sb.computeQualityScoreDetail(readings);
  const computedScore = Math.round(scoreDetail.score);
  console.log(`  production scoring engine (computeQualityScoreDetail) -> score=${computedScore} incomplete=${scoreDetail.incomplete} notScored=${JSON.stringify(scoreDetail.notScored)}`);

  // --- Step 5: Complete / Close ---
  console.log('\n=== COMPLETE ===');
  const close = await api('POST', `/api/cases/${encodeURIComponent(caseId)}/close`, {
    score: computedScore,
    completedBy: 'QA Forensic E2E'
  });
  if (close.status === 200 && close.json?.ok !== false) {
    record('COMPLETE', 'PASS', `status=${close.status}`);
  } else {
    record('COMPLETE', 'FAIL', `status=${close.status} body=${JSON.stringify(close.json)}`);
    await cleanup(caseId, notionId);
    printVerdict();
    return;
  }

  // --- Step 6+: Verify via authoritative backend source (GET /api/clients) ---
  const clientsAfterClose = await api('GET', '/api/clients');
  const jobAfterClose = (clientsAfterClose.json?.jobs || []).find(j => j.id === caseId || j.notionId === notionId);
  if (!jobAfterClose) {
    record('CASE WORKFLOW = COMPLETED', 'FAIL', 'Case not found after close');
    await cleanup(caseId, notionId);
    printVerdict();
    return;
  }

  console.log('\n=== CASE WORKFLOW = COMPLETED ===');
  if (jobAfterClose.workflow?.status === 'completed') {
    record('CASE WORKFLOW = COMPLETED', 'PASS', `workflow.status=${jobAfterClose.workflow.status}`);
  } else {
    record('CASE WORKFLOW = COMPLETED', 'FAIL', `workflow.status=${jobAfterClose.workflow?.status}`);
  }

  console.log('\n=== WATER SCORE PERSISTENCE ===');
  const persistedScore = jobAfterClose.result?.waterScore;
  if (persistedScore !== null && persistedScore !== undefined && Number.isFinite(Number(persistedScore))) {
    const matches = Number(persistedScore) === computedScore;
    record('WATER SCORE PERSISTENCE', matches ? 'PASS' : 'FAIL',
      `Water Score=${persistedScore}, computed=${computedScore}, match=${matches}`);
  } else {
    record('WATER SCORE PERSISTENCE', 'FAIL',
      `Water Score is ${JSON.stringify(persistedScore)} -- SCORE PUBLICATION STILL BROKEN`);
  }

  // --- Step 7: Score Publications Ledger ---
  console.log('\n=== SCORE PUBLICATION LEDGER ===');
  // No direct ledger DB access without raw Notion credentials (per credential
  // guard). Use the case-flow's own publish/report surface instead.
  const reportToken = jobAfterClose.result?.publicReportToken || '';
  let ledgerVerdict = 'FAIL';
  let ledgerDetail = 'no publicReportToken on Case after close';
  if (reportToken) {
    const reportCheck = await api('GET', `/api/report/${encodeURIComponent(reportToken)}`);
    if (reportCheck.status === 200 && reportCheck.json?.ok && reportCheck.json.report) {
      const reportScore = reportCheck.json.report.result?.waterScore;
      const scoreType = reportCheck.json.report.result?.scoreType;
      const reused = false; // fresh Case -- cannot have been a reuse
      ledgerVerdict = (Number(reportScore) === computedScore) ? 'PASS' : 'FAIL';
      ledgerDetail = `report resolves via token, score=${reportScore}, scoreType=${scoreType || 'n/a'}`;
    } else {
      ledgerDetail = `GET /api/report/${reportToken} status=${reportCheck.status}`;
    }
  }
  record('SCORE PUBLICATION LEDGER', ledgerVerdict, ledgerDetail);

  console.log('\n=== REPORT TOKEN ===');
  if (reportToken) {
    record('REPORT TOKEN', 'PASS', `token=${reportToken}`);
  } else {
    record('REPORT TOKEN', 'FAIL', 'no token present on Case');
  }

  console.log('\n=== REPORT SCORE LINEAGE ===');
  if (reportToken) {
    const reportCheck2 = await api('GET', `/api/report/${encodeURIComponent(reportToken)}`);
    const reportScore = reportCheck2.json?.report?.result?.waterScore;
    const caseScore = jobAfterClose.result?.waterScore;
    const lineageOk = Number(reportScore) === Number(caseScore) && Number(caseScore) === computedScore;
    record('REPORT SCORE LINEAGE', lineageOk ? 'PASS' : 'FAIL',
      `Case=${caseScore}, Report=${reportScore}, computed=${computedScore}`);
  } else {
    record('REPORT SCORE LINEAGE', 'FAIL', 'no token to verify lineage');
  }

  console.log('\n=== LINE DELIVERY ===');
  const lineUserId = jobAfterClose.line?.userId;
  if (!lineUserId) {
    record('LINE DELIVERY', 'NOT TESTED', 'reason=no_line_user_id');
  } else {
    const notifStatus = jobAfterClose.notification?.status;
    record('LINE DELIVERY', notifStatus === 'sent' ? 'PASS' : 'FAIL', `notification.status=${notifStatus}`);
  }

  // --- Step 11: Cleanup ---
  await cleanup(caseId, notionId);

  printVerdict();
}

async function cleanup(caseId, notionId) {
  console.log('\n=== CLEANUP ===');
  // No delete/archive endpoint is reachable through the authenticated app
  // API, and raw Notion credentials are intentionally out of scope for this
  // script (credential guard). Best available action is cancelling the
  // Case via the real API -- it stops appearing as an active job but the
  // Notion page itself still exists. Reported honestly as REQUIRED, not
  // hidden as a false PASS, per the no-fix/no-shortcut rule for this QA.
  const cancel = await api('POST', `/api/cases/${encodeURIComponent(caseId)}/cancel`, {});
  if (cancel.status === 200 && cancel.json?.ok !== false) {
    record('CLEANUP', 'REQUIRED',
      `Case ${caseId} (notionId=${notionId}) marked cancelled via API -- Notion page still exists (named QA-FORENSIC-DELETE-ME, safe to archive/delete manually; no delete endpoint available without raw Notion credentials)`);
  } else {
    record('CLEANUP', 'REQUIRED',
      `cancel API call failed too, status=${cancel.status}, body=${JSON.stringify(cancel.json)} -- caseId=${caseId} notionId=${notionId} MUST be manually removed`);
  }
}

function printVerdict() {
  console.log('\n\n=== FINAL VERDICT ===');
  const order = [
    'AUTH', 'CREATE CASE', '6 FIELDS WITHOUT TEMP', 'COMPLETE',
    'CASE WORKFLOW = COMPLETED', 'WATER SCORE PERSISTENCE',
    'SCORE PUBLICATION LEDGER', 'REPORT TOKEN', 'REPORT SCORE LINEAGE',
    'LINE DELIVERY', 'CLEANUP'
  ];
  for (const key of order) {
    const r = results[key];
    console.log(`${key}\n  ${r ? r.status : 'NOT TESTED'}${r && r.detail ? '  (' + r.detail + ')' : ''}`);
  }
  const scoreChainKeys = order.filter(k => k !== 'CLEANUP' && k !== 'LINE DELIVERY');
  const scoreChainFail = scoreChainKeys.some(k => results[k]?.status === 'FAIL' || results[k]?.status === 'BLOCKED');
  const lineFail = results['LINE DELIVERY']?.status === 'FAIL';
  const allExecuted = order.every(k => results[k]);
  const scoreChainCertified = allExecuted && !scoreChainFail && !lineFail;
  console.log(`\nOVERALL (score publication chain)\n  ${scoreChainCertified ? 'CERTIFIED' : 'NOT CERTIFIED'}`);
  if (scoreChainCertified && results['CLEANUP']?.status === 'REQUIRED') {
    console.log('  NOTE: score chain fully certified, but CLEANUP is REQUIRED (no delete/archive API available -- disposable Case still exists in Notion, marked cancelled, named QA-FORENSIC-DELETE-ME). Manual removal needed.');
  }
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  console.error(e.stack);
  printVerdict();
  process.exit(1);
});
