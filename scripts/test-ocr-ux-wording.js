#!/usr/bin/env node
'use strict';

/**
 * OCR UX wording — ensure Drive backup copy is separated from OCR / file-read.
 * Does not hit network or change runtime behavior.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const i18nPath = path.join(root, 'src/js/i18n.js');
const assessmentPath = path.join(root, 'src/js/flows/assessment.js');

const i18n = fs.readFileSync(i18nPath, 'utf8');
const assessment = fs.readFileSync(assessmentPath, 'utf8');

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`PASS  ${name}`);
}
function fail(name, err) {
  console.error(`FAIL  ${name}: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
}

try {
  assert.match(i18n, /'photo\.readFailed':\s*'Unable to read this image\.'/);
  assert.match(i18n, /'photo\.backupFailed':\s*'Photo backup failed\.'/);
  assert.match(i18n, /'photo\.backupFailedRetry':\s*'Backup failed · Tap to retry'/);
  assert.doesNotMatch(i18n, /Photo saved locally — Drive upload failed/);
  assert.doesNotMatch(i18n, /Upload failed · Tap to retry/);
  ok('1. i18n EN keys use read/backup wording (no Drive==OCR copy)');
} catch (e) {
  fail('1. i18n EN keys', e);
}

try {
  assert.match(i18n, /'photo\.readFailed':\s*'ไม่สามารถอ่านรูปนี้ได้'/);
  assert.match(i18n, /'photo\.backupFailed':\s*'สำรองรูปไม่สำเร็จ'/);
  ok('2. i18n TH read/backup keys present');
} catch (e) {
  fail('2. i18n TH keys', e);
}

try {
  assert.match(assessment, /t\('photo\.readFailed'\)/);
  assert.match(assessment, /reader\.onerror/);
  ok('3. FileReader uses photo.readFailed');
} catch (e) {
  fail('3. FileReader uses photo.readFailed', e);
}

try {
  const meterFn = assessment.slice(assessment.indexOf('async function uploadMeterSessionImage'));
  assert.match(meterFn, /t\('photo\.backupFailed'\)/);
  assert.match(assessment, /t\('photo\.backupFailedRetry'\)/);
  assert.match(assessment, /meter-thumb-backup-label/);
  ok('4. Meter Drive fail + badge use backup wording');
} catch (e) {
  fail('4. Meter Drive fail + badge', e);
}

try {
  // OCR outcome toasts still present and ordered before Drive upload call.
  const ocrToast = assessment.indexOf("t('meter.toastFilled')");
  const driveCall = assessment.indexOf('uploadMeterSessionImage(tapIndex, entry.id, imageSrc)');
  assert.ok(ocrToast > 0 && driveCall > ocrToast, 'OCR toast must precede Drive upload call');
  assert.match(assessment, /OCR always runs when imageSrc exists/);
  ok('5. OCR success toast still precedes Drive upload (sequence unchanged)');
} catch (e) {
  fail('5. OCR before Drive sequence', e);
}

try {
  assert.doesNotMatch(
    assessment.slice(assessment.indexOf('async function uploadMeterSessionImage')),
    /showToast\(\s*error\.message/
  );
  ok('6. Meter/task/slip no longer toast raw Drive OAuth error.message as primary');
} catch (e) {
  fail('6. No raw error.message toast in upload helpers', e);
}

console.log(`\n${passed}/6 passed`);
