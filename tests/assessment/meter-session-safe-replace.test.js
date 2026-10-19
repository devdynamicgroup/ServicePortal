/**
 * Meter Session replacement must keep a committed photo until the new
 * upload succeeds, including when an older compress or response finishes late.
 *
 * Drive and Notion are mocked. No Production Case is read or written.
 * Run: node tests/assessment/meter-session-safe-replace.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const AssessmentSnapshot = require(path.join(ROOT, 'src/js/assessment-snapshot'));

let passed = 0;
let failed = 0;
function check(cond, name, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`);
  }
}

const READINGS = { ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400 };

function photoRow(extra) {
  return {
    tasks: {},
    photos: {},
    standardMeasurement: { ...READINGS },
    ...(extra || {})
  };
}

function meterEntry(id, fileId, extra) {
  return {
    id,
    photo: {
      fileId,
      purpose: 'meter',
      contentUrl: `https://files.example/${fileId}`,
      name: `${id}.jpg`
    },
    detected: { ph: id === 'm2' ? 6.4 : 7.1 },
    ocrStatus: 'done',
    ...(extra || {})
  };
}

function tapWithMeters(images) {
  return [
    photoRow(),
    photoRow({ meterImages: images }),
    photoRow()
  ];
}

function buildFrom(tapData, revision) {
  return AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1', 'Tap 2', 'Tap 3'],
    tapData,
    revision: revision || 4,
    updatedAt: '2026-10-19T07:00:00.000Z'
  });
}

function imageOf(snapshot, id) {
  const tap = (snapshot.taps || []).find((item) => item.index === 1);
  return (tap?.meterImages || []).find((entry) => entry.id === id);
}

function control() {
  return {
    pending: [],
    compressPending: [],
    enqueued: [],
    dequeued: 0,
    mode: 'hold',
    deferCompress: false,
    inflightOps: new Set(),
    seq: 0,
    failCode: 'UPLOAD_FAILED',
    failMessage: 'Upload failed'
  };
}

function loadClient(driveControl) {
  const sandbox = {
    console,
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      if (timer.unref) timer.unref();
      return timer;
    },
    clearTimeout,
    navigator: { userAgent: '' },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ classList: { add() {}, remove() {} }, addEventListener() {} })
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    S: {
      activeTap: 1,
      taps: ['Tap 1', 'Tap 2', 'Tap 3'],
      tapData: tapWithMeters([meterEntry('m1', 'METER_OLD'), meterEntry('m2', 'METER_OTHER')]),
      activeJob: { notionId: 'case-test', id: 'case-test' },
      pkg: 'full',
      user: { username: 'qa' }
    },
    t: (key) => key,
    showToast() {},
    goScreen() {},
    processAssessmentPhoto: async () => {},
    saveActiveJobState() {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.DrivePhoto = {
    isUploaded: (photo) => Boolean(photo && typeof photo === 'object' && photo.fileId),
    isMeta: (photo) => Boolean(photo && typeof photo === 'object' && (photo.fileId || photo.uploading || photo.uploadError)),
    previewSrc: (photo) => (photo && typeof photo === 'object' ? photo.previewUrl || '' : ''),
    compress: (dataUrl) => {
      if (driveControl.deferCompress) {
        return new Promise((resolve) => {
          driveControl.compressPending.push({ dataUrl, resolve });
        });
      }
      return Promise.resolve(dataUrl);
    },
    resolveActiveCustomerContext: () => ({ notionId: 'case-test', customerName: 'Test', jobId: 'case-test', customerFolderId: null }),
    resolveClientCategory: () => 'Site Inspection',
    resolveClientSubCategory: () => 'meter',
    purposeToFolder: () => 'main',
    dequeue: async () => { driveControl.dequeued += 1; },
    enqueue: async (item) => { driveControl.enqueued.push(item); },
    isRetryableError: (error) => error && (error.code === 'UPLOAD_TIMEOUT' || error.code === 'NETWORK_ERROR'),
    hasInflight: () => driveControl.inflightOps.size > 0,
    operationInFlight: (uploadOp) => driveControl.inflightOps.has(String(uploadOp)),
    uploadOnce: (request) => new Promise((resolve, reject) => {
      driveControl.pending.push({ request, resolve, reject });
      if (driveControl.mode === 'fail') {
        const error = new Error(driveControl.failMessage || 'Upload failed');
        error.code = driveControl.failCode || 'UPLOAD_FAILED';
        reject(error);
      } else if (driveControl.mode === 'auto') {
        driveControl.seq += 1;
        resolve({
          fileId: `METER_${driveControl.seq}`,
          filename: `meter-${driveControl.seq}.jpg`,
          contentUrl: `https://files.example/meter-${driveControl.seq}`,
          mimeType: 'image/jpeg',
          createdTime: '2026-10-19T07:01:00.000Z'
        });
      }
    })
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/assessment-snapshot.js'), 'utf8'), sandbox, { filename: 'assessment-snapshot.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/flows/assessment.js'), 'utf8'), sandbox, { filename: 'assessment.js' });
  return sandbox;
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function entry(sandbox, id) {
  return sandbox.S.tapData[1].meterImages.find((item) => item.id === id);
}

function storedFile(meta) {
  return {
    fileId: meta.fileId,
    filename: meta.filename,
    contentUrl: meta.contentUrl,
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T07:02:00.000Z'
  };
}

async function main() {
  console.log('Meter Session safe replacement\n');

  const base = buildFrom(tapWithMeters([meterEntry('m1', 'METER_OLD'), meterEntry('m2', 'METER_OTHER')]));
  const incomplete = buildFrom(tapWithMeters([
    {
      id: 'm1',
      photo: { uploading: true, purpose: 'meter', previewUrl: 'data:image/jpeg;base64,NEW' },
      detected: { ph: 7.1 }
    },
    meterEntry('m2', 'METER_OTHER')
  ]), 5);
  const kept = AssessmentSnapshot.mergeSnapshots(base, incomplete);
  check(imageOf(kept, 'm1').photo.fileId === 'METER_OLD', 'an incomplete meter entry does not replace a committed photo');
  check(imageOf(kept, 'm2').photo.fileId === 'METER_OTHER', 'the other meter entry stays in place');
  check(kept.taps.find((tap) => tap.index === 1).meterImages.map((item) => item.id).join(',') === 'm1,m2', 'meter entry order is unchanged');

  const replaced = AssessmentSnapshot.mergeSnapshots(kept, buildFrom(tapWithMeters([
    meterEntry('m1', 'METER_NEW'),
    meterEntry('m2', 'METER_OTHER')
  ]), 6));
  check(imageOf(replaced, 'm1').photo.fileId === 'METER_NEW', 'a valid new meter file ID replaces the committed photo');
  check(imageOf(replaced, 'm2').photo.fileId === 'METER_OTHER', 'a replacement of one entry does not change the other');

  const slow = control();
  slow.mode = 'hold';
  slow.deferCompress = true;
  const slowClient = loadClient(slow);
  const first = slowClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_A');
  await settle();
  check(entry(slowClient, 'm1').photo.fileId === 'METER_OLD', 'the old meter file ID remains while compression is pending');
  check(entry(slowClient, 'm1').photo.uploading === true, 'the meter entry can show an upload in progress');
  check(entry(slowClient, 'm2').photo.fileId === 'METER_OTHER', 'the second meter entry is untouched during compression');
  const midSnap = buildFrom(slowClient.S.tapData);
  check(imageOf(midSnap, 'm1').photo.fileId === 'METER_OLD', 'a snapshot during meter compression keeps the committed file');
  check(!JSON.stringify(midSnap).includes('data:'), 'a meter snapshot during compression has no data URL');
  const opA = entry(slowClient, 'm1').photo.uploadOp;
  const second = slowClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_B');
  await settle();
  check(entry(slowClient, 'm1').photo.uploadOp !== opA, 'the newer meter selection owns the entry');
  check(entry(slowClient, 'm1').photo.previewUrl.indexOf('METER_B') !== -1, 'the newer meter preview is the current one');
  check(entry(slowClient, 'm2').photo.fileId === 'METER_OTHER', 'selecting a replacement does not change the other entry');
  slow.compressPending[0].resolve(slow.compressPending[0].dataUrl);
  await settle();
  check(entry(slowClient, 'm1').photo.uploadOp !== opA, 'a late meter compression cannot reclaim the entry');
  check(entry(slowClient, 'm1').photo.fileId === 'METER_OLD', 'a late meter compression does not commit a file');
  check(slow.pending.length === 0, 'a late meter compression does not upload');
  slow.compressPending[1].resolve(slow.compressPending[1].dataUrl);
  await settle();
  check(slow.pending.length === 1, 'only the newer meter selection uploads');
  check(imageOf(buildFrom(slowClient.S.tapData), 'm1').photo.fileId === 'METER_OLD', 'the snapshot keeps the old meter file until success');
  slow.pending[0].resolve(storedFile({
    fileId: 'METER_B_FILE',
    filename: 'meter-b.jpg',
    contentUrl: 'https://files.example/meter-b'
  }));
  await Promise.all([first, second, settle()]);
  check(entry(slowClient, 'm1').photo.fileId === 'METER_B_FILE', 'the newer meter upload becomes the committed file');
  check(entry(slowClient, 'm2').photo.fileId === 'METER_OTHER', 'success on one entry leaves the other entry intact');
  check(entry(slowClient, 'm1').detected.ph === 7.1, 'replacing the photo keeps the entry readings');

  const okCtl = control();
  okCtl.mode = 'auto';
  const okClient = loadClient(okCtl);
  await okClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_OK');
  check(entry(okClient, 'm1').photo.fileId === 'METER_1', 'a successful meter replacement stores the new file ID');
  check(entry(okClient, 'm1').photo.purpose === 'meter', 'the replacement keeps purpose meter');
  check(entry(okClient, 'm2').photo.fileId === 'METER_OTHER', 'automatic success does not alter the second entry');

  const failCtl = control();
  failCtl.mode = 'fail';
  failCtl.failCode = 'UPLOAD_FAILED';
  const failClient = loadClient(failCtl);
  await failClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_BAD');
  check(entry(failClient, 'm1').photo.fileId === 'METER_OLD', 'a failed meter upload keeps the previous file ID');
  check(Boolean(entry(failClient, 'm1').photo.uploadError), 'a failed meter upload records an error');
  check(entry(failClient, 'm1').photo.uploading !== true, 'a failed meter upload is not left uploading');
  check(imageOf(buildFrom(failClient.S.tapData), 'm1').photo.fileId === 'METER_OLD', 'a failed meter upload does not sync an incomplete photo');
  check(entry(failClient, 'm2').photo.fileId === 'METER_OTHER', 'a failed replacement leaves the other entry intact');
  check(failCtl.enqueued.length === 0, 'a non-retryable meter failure is not queued');

  const timeoutCtl = control();
  timeoutCtl.mode = 'fail';
  timeoutCtl.failCode = 'UPLOAD_TIMEOUT';
  timeoutCtl.failMessage = 'Upload timed out';
  const timeoutClient = loadClient(timeoutCtl);
  await timeoutClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_SLOW');
  check(entry(timeoutClient, 'm1').photo.fileId === 'METER_OLD', 'a meter timeout keeps the previous file ID');
  check(timeoutCtl.enqueued.length === 1, 'a meter timeout is queued for retry');
  await timeoutClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_SLOW');
  check(entry(timeoutClient, 'm1').photo.fileId === 'METER_OLD', 'a second meter timeout still keeps the previous file ID');
  check(imageOf(buildFrom(timeoutClient.S.tapData), 'm1').photo.fileId === 'METER_OLD', 'meter retry exhaustion does not write a new file ID');
  check(entry(timeoutClient, 'm2').photo.fileId === 'METER_OTHER', 'meter retries do not change the other entry');

  const race = control();
  race.mode = 'hold';
  const raceClient = loadClient(race);
  const older = raceClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_FIRST');
  await settle();
  const newer = raceClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_SECOND');
  await settle();
  check(race.pending.length === 2, 'the second meter selection starts its own upload');
  check(entry(raceClient, 'm1').photo.fileId === 'METER_OLD', 'both in-flight meter uploads leave the old file committed');
  race.pending[0].resolve(storedFile({
    fileId: 'METER_STALE',
    filename: 'stale.jpg',
    contentUrl: 'https://files.example/meter-stale'
  }));
  await Promise.all([older, settle()]);
  check(entry(raceClient, 'm1').photo.fileId === 'METER_OLD', 'a stale meter response cannot replace the newer selection');
  check(entry(raceClient, 'm1').photo.previewUrl.indexOf('METER_SECOND') !== -1, 'a stale meter response cannot restore the older preview');
  race.pending[1].resolve(storedFile({
    fileId: 'METER_SECOND_FILE',
    filename: 'second.jpg',
    contentUrl: 'https://files.example/meter-second'
  }));
  await Promise.all([newer, settle()]);
  check(entry(raceClient, 'm1').photo.fileId === 'METER_SECOND_FILE', 'the newer meter response becomes the committed file');
  check(entry(raceClient, 'm2').photo.fileId === 'METER_OTHER' && entry(raceClient, 'm2').detected.ph === 6.4, 'the untouched meter entry keeps its file and readings');

  const explicitEmpty = {
    version: 1,
    updatedAt: '2026-10-19T08:00:00.000Z',
    revision: 9,
    taps: [{ index: 1, name: 'Tap 2', meterImages: [] }]
  };
  const cleared = AssessmentSnapshot.mergeSnapshots(base, explicitEmpty);
  check(!cleared.taps.find((tap) => tap.index === 1).meterImages, 'an explicit empty meter-image list still clears the stored entries');

  const reloadCtl = control();
  reloadCtl.mode = 'hold';
  reloadCtl.deferCompress = true;
  const reloadClient = loadClient(reloadCtl);
  const abandoned = reloadClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_RELOAD');
  await settle();
  entry(reloadClient, 'm1').photo = reloadClient.normalizeInterruptedPhoto(entry(reloadClient, 'm1').photo);
  check(entry(reloadClient, 'm1').photo.fileId === 'METER_OLD', 'reload during a meter replacement keeps the committed file');
  check(entry(reloadClient, 'm1').photo.uploading !== true, 'reload clears the meter uploading flag');
  check(entry(reloadClient, 'm2').photo.fileId === 'METER_OTHER', 'reload does not change the other meter entry');
  check(imageOf(buildFrom(reloadClient.S.tapData), 'm1').photo.fileId === 'METER_OLD', 'snapshot after meter reload names the committed file');
  check(!JSON.stringify(buildFrom(reloadClient.S.tapData)).includes('data:'), 'snapshot after meter reload has no preview data URL');
  reloadCtl.compressPending[0].resolve(reloadCtl.compressPending[0].dataUrl);
  await Promise.all([abandoned, settle()]);
  check(entry(reloadClient, 'm1').photo.fileId === 'METER_OLD' && reloadCtl.pending.length === 0, 'a late meter response after reload cannot replace the file');
  reloadCtl.deferCompress = false;
  const retry = reloadClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_RELOAD');
  await settle();
  check(reloadCtl.pending.length === 1 && entry(reloadClient, 'm1').photo.fileId === 'METER_OLD', 'meter retry after reload uploads once and keeps the old file ID');
  const secondRetry = reloadClient.uploadMeterSessionImage(1, 'm1', entry(reloadClient, 'm1').photo.previewUrl);
  await secondRetry;
  check(reloadCtl.pending.length === 1, 'a second meter retry does not start a duplicate upload');

  const scoped = control();
  scoped.mode = 'hold';
  const scopedClient = loadClient(scoped);
  const liveMeter = scopedClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_LIVE');
  await settle();
  scoped.inflightOps.add(entry(scopedClient, 'm1').photo.uploadOp);
  entry(scopedClient, 'm2').photo = {
    ...entry(scopedClient, 'm2').photo,
    uploading: true,
    uploadOp: 'upl_stale_meter',
    previewUrl: 'data:image/jpeg;base64,METER_STALE'
  };
  const keptMeter = scopedClient.normalizeInterruptedPhoto(entry(scopedClient, 'm1').photo);
  const clearedMeter = scopedClient.normalizeInterruptedPhoto(entry(scopedClient, 'm2').photo);
  entry(scopedClient, 'm2').photo = clearedMeter;
  check(keptMeter === entry(scopedClient, 'm1').photo && keptMeter.uploading === true && keptMeter.fileId === 'METER_OLD', 'the matching meter operation stays in flight');
  check(clearedMeter.uploading !== true && clearedMeter.uploadOp == null && clearedMeter.fileId === 'METER_OTHER', 'the other meter entry loses only its stale upload flag');
  check(entry(scopedClient, 'm2').detected.ph === 6.4, 'scoped meter recovery keeps the other entry readings');
  check(scopedClient.S.tapData[1].meterImages.map((item) => item.id).join(',') === 'm1,m2', 'scoped meter recovery keeps entry order');

  const emptyMeter = control();
  const emptyMeterClient = loadClient(emptyMeter);
  entry(emptyMeterClient, 'm1').photo = { ...entry(emptyMeterClient, 'm1').photo, uploading: true, uploadOp: 'upl_m1_gone', previewUrl: 'data:image/jpeg;base64,M1' };
  entry(emptyMeterClient, 'm2').photo = { ...entry(emptyMeterClient, 'm2').photo, uploading: true, uploadOp: 'upl_m2_gone', previewUrl: 'data:image/jpeg;base64,M2' };
  entry(emptyMeterClient, 'm1').photo = emptyMeterClient.normalizeInterruptedPhoto(entry(emptyMeterClient, 'm1').photo);
  entry(emptyMeterClient, 'm2').photo = emptyMeterClient.normalizeInterruptedPhoto(entry(emptyMeterClient, 'm2').photo);
  check(emptyMeter.inflightOps.size === 0 && entry(emptyMeterClient, 'm1').photo.fileId === 'METER_OLD' && entry(emptyMeterClient, 'm1').photo.uploading !== true, 'an empty in-flight set clears the first meter flag');
  check(entry(emptyMeterClient, 'm2').photo.fileId === 'METER_OTHER' && entry(emptyMeterClient, 'm2').photo.uploading !== true && entry(emptyMeterClient, 'm2').detected.ph === 6.4, 'an empty in-flight set clears the second meter flag and keeps its readings');

  const meterLate = control();
  meterLate.mode = 'hold';
  const meterLateClient = loadClient(meterLate);
  const meterLateUpload = meterLateClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_LATE_FAIL');
  await settle();
  const meterRecovered = meterLateClient.normalizeInterruptedPhoto(entry(meterLateClient, 'm1').photo);
  entry(meterLateClient, 'm1').photo = meterRecovered;
  const meterLateError = new Error('stale meter failure');
  meterLateError.code = 'UPLOAD_FAILED';
  meterLate.pending[0].reject(meterLateError);
  await Promise.all([meterLateUpload, settle()]);
  check(entry(meterLateClient, 'm1').photo.fileId === 'METER_OLD' && entry(meterLateClient, 'm1').photo.previewUrl === meterRecovered.previewUrl && entry(meterLateClient, 'm1').photo.uploadError === meterRecovered.uploadError, 'a stale meter failure after recovery cannot replace the recovered entry');
  check(entry(meterLateClient, 'm2').photo.fileId === 'METER_OTHER' && entry(meterLateClient, 'm2').detected.ph === 6.4, 'a stale meter failure leaves the other entry intact');

  const meterRetry = control();
  meterRetry.mode = 'hold';
  meterRetry.inflightOps.add('upl_other_meter');
  const meterRetryClient = loadClient(meterRetry);
  entry(meterRetryClient, 'm1').photo = {
    ...entry(meterRetryClient, 'm1').photo,
    uploading: true,
    uploadOp: 'upl_meter_retry',
    previewUrl: 'data:image/jpeg;base64,METER_RETRY'
  };
  await meterRetryClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_RETRY');
  check(meterRetry.pending.length === 0, 'a stale meter uploading flag blocks a same-capture retry');
  entry(meterRetryClient, 'm1').photo = meterRetryClient.normalizeInterruptedPhoto(entry(meterRetryClient, 'm1').photo);
  check(entry(meterRetryClient, 'm1').photo.fileId === 'METER_OLD' && entry(meterRetryClient, 'm1').photo.uploading !== true, 'scoped meter recovery clears the blocked entry');
  meterRetryClient.uploadMeterSessionImage(1, 'm1', entry(meterRetryClient, 'm1').photo.previewUrl);
  await settle();
  check(meterRetry.pending.length === 1 && entry(meterRetryClient, 'm1').photo.fileId === 'METER_OLD', 'meter retry after scoped recovery keeps the old file ID');
  meterRetry.pending[0].resolve(storedFile({
    fileId: 'METER_RETRIED',
    filename: 'retried.jpg',
    contentUrl: 'https://files.example/meter-retried'
  }));
  await settle();
  check(entry(meterRetryClient, 'm1').photo.fileId === 'METER_RETRIED' && entry(meterRetryClient, 'm2').photo.fileId === 'METER_OTHER', 'the retried meter upload commits only its own entry');

  const meterCompress = control();
  meterCompress.mode = 'hold';
  meterCompress.deferCompress = true;
  meterCompress.inflightOps.add('upl_other_live');
  const meterCompressClient = loadClient(meterCompress);
  const meterCompressUpload = meterCompressClient.uploadMeterSessionImage(1, 'm1', 'data:image/jpeg;base64,METER_COMPRESS');
  await settle();
  entry(meterCompressClient, 'm1').photo = meterCompressClient.normalizeInterruptedPhoto(entry(meterCompressClient, 'm1').photo);
  check(entry(meterCompressClient, 'm1').photo.fileId === 'METER_OLD' && entry(meterCompressClient, 'm1').photo.uploading !== true, 'meter recovery during compression keeps the committed file');
  meterCompress.compressPending[0].resolve(meterCompress.compressPending[0].dataUrl);
  await Promise.all([meterCompressUpload, settle()]);
  check(meterCompress.pending.length === 0 && entry(meterCompressClient, 'm1').photo.fileId === 'METER_OLD' && entry(meterCompressClient, 'm2').detected.ph === 6.4, 'a cancelled meter compression cannot upload or change the other entry');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
