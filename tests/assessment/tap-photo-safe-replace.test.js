/**
 * Tap Photo replacement must not let an in-progress upload or a delayed
 * snapshot replace a committed Drive file ID.
 *
 * Drive and Notion are mocked. No Production Case is read or written.
 * Run: node tests/assessment/tap-photo-safe-replace.test.js
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
const OLD_ID = 'OLD_TAP1_FILE';
const METER_ID = 'METER_FILE';
const CHLORINE_ID = 'CHLORINE_FILE';
const TAP0_ID = 'TAP0_FILE';
const TAP2_ID = 'TAP2_FILE';

function photoRow(extra) {
  return {
    tasks: {},
    photos: {},
    standardMeasurement: { ...READINGS },
    ...(extra || {})
  };
}

function buildFrom(tapData) {
  return AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1', 'Tap 2', 'Tap 3'],
    tapData,
    revision: 8,
    updatedAt: '2026-10-19T06:00:00.000Z'
  });
}

function tapPhoto(snapshot, index, key) {
  const tap = (snapshot.taps || []).find((item) => item.index === index);
  return tap?.photos?.[key];
}

function makeImg() {
  return {
    src: '',
    style: { display: '' },
    classList: { add() {}, remove() {}, toggle() {} },
    closest: () => null,
    dataset: {},
    addEventListener() {},
    removeEventListener() {}
  };
}

function loadClient(control) {
  const elements = {
    'tap-photo-preview': makeImg(),
    'meter-photo-preview': makeImg(),
    'cl-photo-preview': makeImg()
  };
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
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ classList: { add() {}, remove() {} }, addEventListener() {} })
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    S: {
      activeTap: 1,
      taps: ['Tap 1', 'Tap 2', 'Tap 3'],
      tapData: [
        photoRow({ photos: { tapphoto: { fileId: TAP0_ID, purpose: 'tapphoto', contentUrl: 'https://files.example/tap0' } } }),
        photoRow({
          photos: {
            tapphoto: {
              fileId: OLD_ID,
              purpose: 'tapphoto',
              contentUrl: 'https://files.example/old',
              name: 'old.jpg'
            },
            meter: { fileId: METER_ID, purpose: 'meter', contentUrl: 'https://files.example/meter' },
            chlorine: { fileId: CHLORINE_ID, purpose: 'chlorine', contentUrl: 'https://files.example/chlorine' }
          }
        }),
        photoRow({ photos: { tapphoto: { fileId: TAP2_ID, purpose: 'tapphoto', contentUrl: 'https://files.example/tap2' } } })
      ],
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
    previewSrc: (photo) => {
      if (!photo) return '';
      if (typeof photo === 'string') return photo;
      return photo.previewUrl || '';
    },
    compress: (dataUrl) => {
      if (control.deferCompress) {
        return new Promise((resolve) => {
          control.compressPending.push({ dataUrl, resolve });
        });
      }
      return Promise.resolve(dataUrl);
    },
    resolveActiveCustomerContext: () => ({ notionId: 'case-test', customerName: 'Test', jobId: 'case-test', customerFolderId: null }),
    resolveClientCategory: () => 'Site Inspection',
    resolveClientSubCategory: (_task, _type) => 'tapphoto',
    purposeToFolder: () => 'main',
    dequeue: async () => { control.dequeued += 1; },
    enqueue: async (item) => { control.enqueued.push(item); },
    isRetryableError: (error) => error && (error.code === 'UPLOAD_TIMEOUT' || error.code === 'NETWORK_ERROR'),
    hasInflight: () => control.inflightOps.size > 0,
    operationInFlight: (uploadOp) => control.inflightOps.has(String(uploadOp)),
    uploadOnce: (request) => new Promise((resolve, reject) => {
      const entry = { request, resolve, reject };
      control.pending.push(entry);
      if (control.mode === 'fail') {
        const error = new Error(control.failMessage || 'Upload failed');
        error.code = control.failCode || 'UPLOAD_FAILED';
        reject(error);
      } else if (control.mode === 'auto') {
        control.seq += 1;
        resolve({
          fileId: `FILE_${control.seq}`,
          filename: `file-${control.seq}.jpg`,
          contentUrl: `https://files.example/${control.seq}`,
          mimeType: 'image/jpeg',
          createdTime: '2026-10-19T06:23:48.153Z'
        });
      }
    })
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/assessment-snapshot.js'), 'utf8'), sandbox, { filename: 'assessment-snapshot.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/flows/assessment.js'), 'utf8'), sandbox, { filename: 'assessment.js' });
  return sandbox;
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

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function live(sandbox, tapIndex, key) {
  return sandbox.S.tapData[tapIndex].photos[key];
}

async function main() {
  console.log('Tap Photo safe replacement\n');

  const uploading = {
    uploading: true,
    purpose: 'tapphoto',
    previewUrl: 'data:image/jpeg;base64,NEW',
    uploadedAt: null
  };
  check(
    AssessmentSnapshot.compactPhotoRef(uploading) === undefined,
    'purpose-only in-progress object is not a snapshot photo'
  );
  check(
    AssessmentSnapshot.compactPhotoRef({
      fileId: OLD_ID,
      purpose: 'tapphoto',
      previewUrl: 'data:image/jpeg;base64,NEW',
      uploading: true
    }).fileId === OLD_ID,
    'a preserved fileId is what the snapshot emits'
  );
  const withPreview = AssessmentSnapshot.compactPhotoRef({
    fileId: OLD_ID,
    purpose: 'tapphoto',
    previewUrl: 'data:image/jpeg;base64,NEW',
    contentUrl: 'data:image/jpeg;base64,NEW'
  });
  check(!JSON.stringify(withPreview).includes('data:'), 'snapshot photo drops data URLs');

  const base = buildFrom([
    photoRow(),
    photoRow({ photos: { tapphoto: { fileId: OLD_ID, purpose: 'tapphoto', contentUrl: 'https://files.example/old' } } }),
    photoRow()
  ]);
  const incomplete = AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1', 'Tap 2', 'Tap 3'],
    tapData: [photoRow(), photoRow({ photos: { tapphoto: uploading } }), photoRow()],
    revision: 9,
    updatedAt: '2026-10-19T06:23:52.311Z'
  });
  const kept = AssessmentSnapshot.mergeSnapshots(base, incomplete);
  check(tapPhoto(kept, 1, 'tapphoto').fileId === OLD_ID, 'newer incomplete snapshot does not replace a file ID');

  const replacement = AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1', 'Tap 2', 'Tap 3'],
    tapData: [photoRow(), photoRow({ photos: { tapphoto: { fileId: 'NEW_FILE', purpose: 'tapphoto', contentUrl: 'https://files.example/new' } } }), photoRow()],
    revision: 10,
    updatedAt: '2026-10-19T06:24:00.000Z'
  });
  const replaced = AssessmentSnapshot.mergeSnapshots(kept, replacement);
  check(tapPhoto(replaced, 1, 'tapphoto').fileId === 'NEW_FILE', 'a later valid file ID replaces the committed photo');
  check(tapPhoto(replaced, 1, 'tapphoto').purpose === 'tapphoto', 'replacement keeps purpose tapphoto');

  const stale = AssessmentSnapshot.mergeSnapshots(replaced, base);
  check(tapPhoto(stale, 1, 'tapphoto').fileId === 'NEW_FILE', 'an older snapshot cannot roll the file ID back');

  const sandbox = loadClient(control());
  const during = buildFrom(sandbox.S.tapData);
  check(tapPhoto(during, 0, 'tapphoto').fileId === TAP0_ID, 'Tap 0 reference is present before the upload');
  check(tapPhoto(during, 2, 'tapphoto').fileId === TAP2_ID, 'Tap 2 reference is present before the upload');
  check(tapPhoto(during, 1, 'meter').fileId === METER_ID, 'Tap 1 meter reference is present before the upload');
  check(tapPhoto(during, 1, 'chlorine').fileId === CHLORINE_ID, 'Tap 1 chlorine reference is present before the upload');

  const begin = control();
  begin.mode = 'hold';
  const client = loadClient(begin);
  client.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,NEXT');
  await settle();
  const mid = live(client, 1, 'tapphoto');
  check(mid.fileId === OLD_ID, 'existing fileId remains while the upload is in progress');
  check(mid.uploading === true, 'the UI state can show that an upload is in progress');
  check(mid.purpose === 'tapphoto', 'in-progress state keeps purpose tapphoto');
  const midSnap = buildFrom(client.S.tapData);
  check(tapPhoto(midSnap, 1, 'tapphoto').fileId === OLD_ID, 'snapshot during upload still names the previous file');
  check(!JSON.stringify(midSnap).includes('data:'), 'in-progress snapshot does not contain a data URL');
  check(tapPhoto(midSnap, 0, 'tapphoto').fileId === TAP0_ID, 'Tap 0 is unchanged while Tap 1 uploads');
  check(tapPhoto(midSnap, 2, 'tapphoto').fileId === TAP2_ID, 'Tap 2 is unchanged while Tap 1 uploads');
  check(tapPhoto(midSnap, 1, 'meter').fileId === METER_ID, 'meter photo is unchanged');
  check(tapPhoto(midSnap, 1, 'chlorine').fileId === CHLORINE_ID, 'chlorine photo is unchanged');

  begin.pending[0].resolve({
    fileId: 'NEW_FILE',
    filename: 'new.jpg',
    contentUrl: 'https://files.example/new',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:23:48.153Z'
  });
  await settle();
  const done = live(client, 1, 'tapphoto');
  check(done.fileId === 'NEW_FILE' && done.purpose === 'tapphoto' && done.uploading !== true, 'successful upload replaces the committed file ID');
  const doneSnap = buildFrom(client.S.tapData);
  check(tapPhoto(doneSnap, 1, 'tapphoto').fileId === 'NEW_FILE', 'snapshot after success names the new file');
  check(tapPhoto(doneSnap, 1, 'tapphoto').index === undefined, 'photo ref itself is not a tap index');
  check(doneSnap.taps[1].index === 1, 'the photo stays on tap index 1');

  const reloaded = {};
  AssessmentSnapshot.applySnapshotToDraft(reloaded, doneSnap);
  check(reloaded.tapData[1].photos.tapphoto.fileId === 'NEW_FILE', 'reload restores the committed file ID');
  check(!reloaded.tapData[1].photos.tapphoto.previewUrl, 'reload does not restore a preview data URL');
  check(!reloaded.tapData[1].photos.tapphoto.uploading, 'reload does not restore upload-in-progress state');

  const failCtl = control();
  failCtl.mode = 'fail';
  failCtl.failCode = 'UPLOAD_FAILED';
  const failClient = loadClient(failCtl);
  failClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,BAD');
  await settle();
  const failedPhoto = live(failClient, 1, 'tapphoto');
  check(failedPhoto.fileId === OLD_ID, 'a failed upload keeps the previous file ID');
  check(Boolean(failedPhoto.uploadError), 'failure is visible without replacing the file ID');
  check(tapPhoto(buildFrom(failClient.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'failed upload does not sync an incomplete reference');
  check(failCtl.enqueued.length === 0, 'a non-retryable failure is not queued again');

  const timeoutCtl = control();
  timeoutCtl.mode = 'fail';
  timeoutCtl.failCode = 'UPLOAD_TIMEOUT';
  timeoutCtl.failMessage = 'Upload timed out';
  const timeoutClient = loadClient(timeoutCtl);
  timeoutClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,SLOW');
  await settle();
  check(live(timeoutClient, 1, 'tapphoto').fileId === OLD_ID, 'timeout keeps the previous file ID');
  check(timeoutCtl.enqueued.length === 1, 'timeout is queued for retry');
  timeoutCtl.mode = 'fail';
  await timeoutClient.uploadTaskPhotoToDrive('tapphoto', 'tap-photo-preview', 'data:image/jpeg;base64,SLOW');
  await settle();
  check(live(timeoutClient, 1, 'tapphoto').fileId === OLD_ID, 'a second timeout still keeps the previous file ID');
  check(tapPhoto(buildFrom(timeoutClient.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'retry exhaustion does not write a new committed file ID');

  const race = control();
  race.mode = 'hold';
  const raceClient = loadClient(race);
  raceClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,FIRST');
  await settle();
  check(race.pending.length === 1, 'first replacement upload is in flight');
  raceClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,SECOND');
  await settle();
  check(race.pending.length === 2, 'second selection starts its own upload');
  check(live(raceClient, 1, 'tapphoto').fileId === OLD_ID, 'both in-flight uploads still leave the previous file ID committed');
  race.pending[0].resolve({
    fileId: 'STALE_FILE',
    filename: 'stale.jpg',
    contentUrl: 'https://files.example/stale',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:23:48.153Z'
  });
  await settle();
  check(live(raceClient, 1, 'tapphoto').fileId === OLD_ID, 'the first upload cannot overwrite the second selection');
  race.pending[1].resolve({
    fileId: 'SECOND_FILE',
    filename: 'second.jpg',
    contentUrl: 'https://files.example/second',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:23:49.000Z'
  });
  await settle();
  check(live(raceClient, 1, 'tapphoto').fileId === 'SECOND_FILE', 'the second upload becomes the committed file ID');

  const freshCtl = control();
  freshCtl.mode = 'hold';
  const fresh = loadClient(freshCtl);
  fresh.S.activeTap = 0;
  fresh.S.tapData[0].photos = {};
  fresh.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,FIRSTSHOT');
  await settle();
  const freshLive = live(fresh, 0, 'tapphoto');
  check(!freshLive.fileId && freshLive.uploading === true, 'first photo shows progress without inventing a file ID');
  check(tapPhoto(buildFrom(fresh.S.tapData), 0, 'tapphoto') === undefined, 'first photo is absent from the snapshot until Drive returns an ID');
  check(tapPhoto(buildFrom(fresh.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'starting Tap 0 does not clear Tap 1');
  freshCtl.pending[0].resolve({
    fileId: 'FIRST_FILE',
    filename: 'first.jpg',
    contentUrl: 'https://files.example/first',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T02:05:38.192Z'
  });
  await settle();
  check(live(fresh, 0, 'tapphoto').fileId === 'FIRST_FILE', 'first photo is committed only after a Drive file ID exists');

  const slow = control();
  slow.mode = 'hold';
  slow.deferCompress = true;
  const slowClient = loadClient(slow);
  slowClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,SLOW_A');
  await settle();
  const duringCompress = live(slowClient, 1, 'tapphoto');
  check(Boolean(duringCompress.uploadOp), 'a selection owns the slot before compression finishes');
  check(duringCompress.fileId === OLD_ID && duringCompress.uploading === true, 'the committed file ID stays during compression');
  check(tapPhoto(buildFrom(slowClient.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'a snapshot during compression still names the previous file');
  check(!JSON.stringify(buildFrom(slowClient.S.tapData)).includes('data:'), 'a snapshot during compression has no data URL');
  check(slow.pending.length === 0, 'compression has not started an upload yet');
  const opA = duringCompress.uploadOp;
  slowClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,SLOW_B');
  await settle();
  const duringB = live(slowClient, 1, 'tapphoto');
  check(duringB.uploadOp !== opA && duringB.previewUrl.indexOf('SLOW_B') !== -1, 'the newer selection owns the slot while the older image is still compressing');
  check(duringB.fileId === OLD_ID, 'the previous file ID remains while both compressions are open');
  slow.compressPending[0].resolve(slow.compressPending[0].dataUrl);
  await settle();
  const afterLateCompress = live(slowClient, 1, 'tapphoto');
  check(afterLateCompress.uploadOp === duringB.uploadOp, 'a late compression cannot replace the newer operation');
  check(afterLateCompress.previewUrl.indexOf('SLOW_B') !== -1, 'a late compression cannot restore the older preview');
  check(afterLateCompress.fileId === OLD_ID && slow.pending.length === 0, 'a late compression cannot start or commit the older upload');
  slow.compressPending[1].resolve(slow.compressPending[1].dataUrl);
  await settle();
  check(slow.pending.length === 1, 'only the newer selection uploads');
  check(String(slow.pending[0].request.inflightKey).indexOf(duringB.uploadOp) !== -1, 'the upload in-flight key is specific to the current operation');
  check(tapPhoto(buildFrom(slowClient.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'the snapshot keeps the previous file ID until that upload succeeds');
  slow.pending[0].resolve({
    fileId: 'FILE_B',
    filename: 'b.jpg',
    contentUrl: 'https://files.example/b',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:30:00.000Z'
  });
  await settle();
  check(live(slowClient, 1, 'tapphoto').fileId === 'FILE_B', 'the newer selection becomes the committed file after it succeeds');

  const staleFail = control();
  staleFail.mode = 'hold';
  const staleClient = loadClient(staleFail);
  staleClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,FAIL_A');
  await settle();
  staleClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,FAIL_B');
  await settle();
  const ownedByB = live(staleClient, 1, 'tapphoto');
  const staleError = new Error('older upload failed');
  staleError.code = 'UPLOAD_FAILED';
  staleFail.pending[0].reject(staleError);
  await settle();
  const afterStaleFail = live(staleClient, 1, 'tapphoto');
  check(afterStaleFail.uploadOp === ownedByB.uploadOp, 'a stale failure cannot take the slot back');
  check(afterStaleFail.previewUrl === ownedByB.previewUrl, 'a stale failure cannot restore the older preview');
  check(!afterStaleFail.uploadError && afterStaleFail.uploading === true, 'a stale failure cannot change the newer loading state');
  check(afterStaleFail.fileId === OLD_ID, 'a stale failure cannot replace the committed file ID');
  staleFail.pending[1].resolve({
    fileId: 'FILE_AFTER_STALE',
    filename: 'after.jpg',
    contentUrl: 'https://files.example/after',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:31:00.000Z'
  });
  await settle();
  check(live(staleClient, 1, 'tapphoto').fileId === 'FILE_AFTER_STALE', 'the newer upload still commits after a stale failure');

  const inFlight = control();
  inFlight.mode = 'fail';
  inFlight.failCode = 'UPLOAD_IN_FLIGHT';
  inFlight.failMessage = 'Upload already in progress';
  const inFlightClient = loadClient(inFlight);
  inFlightClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,BLOCKED');
  await settle();
  const blocked = live(inFlightClient, 1, 'tapphoto');
  check(blocked.uploading !== true, 'UPLOAD_IN_FLIGHT does not leave the current operation uploading');
  check(blocked.fileId === OLD_ID, 'UPLOAD_IN_FLIGHT keeps the previous file ID');
  check(blocked.uploadErrorCode === 'UPLOAD_IN_FLIGHT', 'UPLOAD_IN_FLIGHT is recorded as the current error');
  check(inFlight.enqueued.length === 0, 'UPLOAD_IN_FLIGHT does not start a second upload for the same operation');

  function recover(client, tapIndex, key) {
    const next = client.normalizeInterruptedPhoto(live(client, tapIndex, key));
    client.S.tapData[tapIndex].photos[key] = next;
    return next;
  }

  const reloadCompress = control();
  reloadCompress.mode = 'hold';
  reloadCompress.deferCompress = true;
  const reloadCompressClient = loadClient(reloadCompress);
  reloadCompressClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,RELOAD_A');
  await settle();
  const abandonedCompress = recover(reloadCompressClient, 1, 'tapphoto');
  check(abandonedCompress.fileId === OLD_ID, 'reload during compression keeps the committed file ID');
  check(abandonedCompress.uploading !== true, 'reload during compression clears the uploading flag');
  check(tapPhoto(buildFrom(reloadCompressClient.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'snapshot after compression reload names the committed file');
  check(!JSON.stringify(buildFrom(reloadCompressClient.S.tapData)).includes('data:'), 'snapshot after compression reload has no preview data URL');
  reloadCompress.compressPending[0].resolve(reloadCompress.compressPending[0].dataUrl);
  await settle();
  check(live(reloadCompressClient, 1, 'tapphoto').fileId === OLD_ID && reloadCompress.pending.length === 0, 'a compression that finishes after reload cannot upload or replace the file');
  const beforeRetry = reloadCompress.pending.length;
  reloadCompress.deferCompress = false;
  reloadCompressClient.uploadTaskPhotoToDrive('tapphoto', 'tap-photo-preview', abandonedCompress.previewUrl);
  await settle();
  check(reloadCompress.pending.length === beforeRetry + 1, 'retry after reload starts one upload');
  check(live(reloadCompressClient, 1, 'tapphoto').fileId === OLD_ID, 'retry after reload keeps the old file ID until it succeeds');
  const duplicate = reloadCompressClient.uploadTaskPhotoToDrive('tapphoto', 'tap-photo-preview', live(reloadCompressClient, 1, 'tapphoto').previewUrl);
  await duplicate;
  check(reloadCompress.pending.length === beforeRetry + 1, 'a second retry of the same in-flight recovery does not upload again');

  const reloadUpload = control();
  reloadUpload.mode = 'hold';
  const reloadUploadClient = loadClient(reloadUpload);
  reloadUploadClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,RELOAD_UPLOAD');
  await settle();
  check(recover(reloadUploadClient, 1, 'tapphoto').fileId === OLD_ID, 'reload during upload keeps the committed file ID');
  check(live(reloadUploadClient, 1, 'tapphoto').uploading !== true, 'reload during upload clears the uploading flag');
  reloadUpload.pending[0].resolve({
    fileId: 'STALE_AFTER_RELOAD',
    filename: 'stale.jpg',
    contentUrl: 'https://files.example/stale-reload',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:40:00.000Z'
  });
  await settle();
  check(live(reloadUploadClient, 1, 'tapphoto').fileId === OLD_ID, 'a stale upload response after reload cannot replace the committed file');
  check(tapPhoto(buildFrom(reloadUploadClient.S.tapData), 1, 'tapphoto').fileId === OLD_ID, 'snapshot after upload reload still names the committed file');

  const reloadFail = control();
  reloadFail.mode = 'fail';
  reloadFail.failCode = 'UPLOAD_FAILED';
  const reloadFailClient = loadClient(reloadFail);
  reloadFailClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,RELOAD_FAIL');
  await settle();
  const failedBefore = reloadFail.pending.length;
  const failedRecovered = recover(reloadFailClient, 1, 'tapphoto');
  check(failedRecovered.fileId === OLD_ID && failedRecovered.uploading !== true, 'reload after failure keeps the committed file and is not stuck uploading');
  check(reloadFail.pending.length === failedBefore, 'reload after failure does not start another upload');

  const reloadTimeout = control();
  reloadTimeout.mode = 'fail';
  reloadTimeout.failCode = 'UPLOAD_TIMEOUT';
  reloadTimeout.failMessage = 'Upload timed out';
  const reloadTimeoutClient = loadClient(reloadTimeout);
  reloadTimeoutClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,RELOAD_TIMEOUT');
  await settle();
  const timedOut = recover(reloadTimeoutClient, 1, 'tapphoto');
  check(timedOut.fileId === OLD_ID && timedOut.pendingAutoRetry === true, 'reload after timeout keeps the file ID and the retry flag');
  const timeoutCalls = reloadTimeout.pending.length;
  await reloadTimeoutClient.flushPendingDriveUploads();
  check(reloadTimeout.pending.length === timeoutCalls + 1, 'timeout recovery retries once');
  check(live(reloadTimeoutClient, 1, 'tapphoto').fileId === OLD_ID, 'timeout recovery does not replace the committed file ID');

  const liveCtl = control();
  liveCtl.mode = 'hold';
  const liveClient = loadClient(liveCtl);
  liveClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,LIVE');
  await settle();
  const livePhoto = live(liveClient, 1, 'tapphoto');
  liveCtl.inflightOps.add(livePhoto.uploadOp);
  const stillLive = liveClient.normalizeInterruptedPhoto(livePhoto);
  check(stillLive === livePhoto && stillLive.uploading === true && stillLive.fileId === OLD_ID, 'a live in-page upload is not interrupted or replaced');

  const scoped = control();
  scoped.mode = 'hold';
  const scopedClient = loadClient(scoped);
  scopedClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,SLOT_A');
  await settle();
  const slotA = live(scopedClient, 1, 'tapphoto');
  scoped.inflightOps.add(slotA.uploadOp);
  scopedClient.S.tapData[1].photos.chlorine = {
    fileId: CHLORINE_ID,
    contentUrl: 'https://files.example/chlorine',
    purpose: 'chlorine',
    uploading: true,
    uploadOp: 'upl_stale_chlorine',
    previewUrl: 'data:image/jpeg;base64,STALE_CHLORINE'
  };
  const clearedChlorine = scopedClient.normalizeInterruptedPhoto(scopedClient.S.tapData[1].photos.chlorine);
  scopedClient.S.tapData[1].photos.chlorine = clearedChlorine;
  const keptSlot = scopedClient.normalizeInterruptedPhoto(slotA);
  check(keptSlot === slotA && keptSlot.uploading === true && keptSlot.fileId === OLD_ID, 'the matching tap operation stays in flight');
  check(clearedChlorine.uploading !== true && clearedChlorine.uploadOp == null && clearedChlorine.fileId === CHLORINE_ID, 'another slot with a different operation is cleared');
  check(live(scopedClient, 1, 'meter').fileId === METER_ID, 'scoped recovery leaves the meter reference unchanged');
  check(!JSON.stringify(AssessmentSnapshot.compactPhotoRef(clearedChlorine)).includes('data:'), 'scoped recovery does not commit the stale preview');

  const emptyCtl = control();
  const emptyClient = loadClient(emptyCtl);
  emptyClient.S.tapData[1].photos.tapphoto = {
    fileId: OLD_ID,
    contentUrl: 'https://files.example/old',
    purpose: 'tapphoto',
    uploading: true,
    uploadOp: 'upl_reload_tap',
    previewUrl: 'data:image/jpeg;base64,RELOAD_TAP'
  };
  emptyClient.S.tapData[1].photos.chlorine = {
    fileId: CHLORINE_ID,
    contentUrl: 'https://files.example/chlorine',
    purpose: 'chlorine',
    uploading: true,
    uploadOp: 'upl_reload_chlorine',
    previewUrl: 'data:image/jpeg;base64,RELOAD_CHLORINE'
  };
  const emptyTap = emptyClient.normalizeInterruptedPhoto(emptyClient.S.tapData[1].photos.tapphoto);
  const emptyChlorine = emptyClient.normalizeInterruptedPhoto(emptyClient.S.tapData[1].photos.chlorine);
  check(emptyCtl.inflightOps.size === 0 && emptyTap.fileId === OLD_ID && emptyTap.uploading !== true, 'an empty in-flight set clears the tap upload flag');
  check(emptyChlorine.fileId === CHLORINE_ID && emptyChlorine.uploading !== true, 'an empty in-flight set clears the chlorine upload flag');

  const lateFailCtl = control();
  lateFailCtl.mode = 'hold';
  const lateFailClient = loadClient(lateFailCtl);
  lateFailClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,LATE_FAIL');
  await settle();
  const recoveredFail = recover(lateFailClient, 1, 'tapphoto');
  const lateFailError = new Error('stale failure');
  lateFailError.code = 'UPLOAD_FAILED';
  lateFailCtl.pending[0].reject(lateFailError);
  await settle();
  const afterLateFail = live(lateFailClient, 1, 'tapphoto');
  check(afterLateFail.fileId === OLD_ID && afterLateFail.previewUrl === recoveredFail.previewUrl && afterLateFail.uploadError === recoveredFail.uploadError, 'a stale failure after recovery cannot replace the recovered photo');

  const retryCtl = control();
  retryCtl.mode = 'hold';
  retryCtl.inflightOps.add('upl_other_slot');
  const retryClient = loadClient(retryCtl);
  retryClient.S.tapData[1].photos.tapphoto = {
    fileId: OLD_ID,
    contentUrl: 'https://files.example/old',
    purpose: 'tapphoto',
    uploading: true,
    uploadOp: 'upl_needs_retry',
    previewUrl: 'data:image/jpeg;base64,RETRY_TAP'
  };
  await retryClient.uploadTaskPhotoToDrive('tapphoto', 'tap-photo-preview', 'data:image/jpeg;base64,RETRY_TAP');
  check(retryCtl.pending.length === 0, 'a stale uploading flag blocks a same-capture retry');
  const recoveredRetry = recover(retryClient, 1, 'tapphoto');
  check(recoveredRetry.fileId === OLD_ID && recoveredRetry.uploading !== true, 'scoped recovery clears the blocked tap without losing the file');
  retryClient.uploadTaskPhotoToDrive('tapphoto', 'tap-photo-preview', recoveredRetry.previewUrl);
  await settle();
  check(retryCtl.pending.length === 1 && live(retryClient, 1, 'tapphoto').fileId === OLD_ID, 'retry after scoped recovery uploads once and keeps the old file ID');
  retryCtl.pending[0].resolve({
    fileId: 'FILE_RETRIED',
    filename: 'retried.jpg',
    contentUrl: 'https://files.example/retried',
    mimeType: 'image/jpeg',
    createdTime: '2026-10-19T06:45:00.000Z'
  });
  await settle();
  check(live(retryClient, 1, 'tapphoto').fileId === 'FILE_RETRIED', 'the retried tap upload commits only after it succeeds');

  const compressOther = control();
  compressOther.mode = 'hold';
  compressOther.deferCompress = true;
  compressOther.inflightOps.add('upl_other_live');
  const compressClient = loadClient(compressOther);
  compressClient.setPhotoPreview('tap-photo-preview', 'data:image/jpeg;base64,COMPRESS_OTHER');
  await settle();
  check(live(compressClient, 1, 'tapphoto').fileId === OLD_ID && compressOther.pending.length === 0, 'compression has not replaced the file while another slot is in flight');
  const cancelledCompress = recover(compressClient, 1, 'tapphoto');
  check(cancelledCompress.fileId === OLD_ID && cancelledCompress.uploading !== true, 'recovery during compression cancels that attempt and keeps the file');
  compressOther.compressPending[0].resolve(compressOther.compressPending[0].dataUrl);
  await settle();
  check(compressOther.pending.length === 0 && live(compressClient, 1, 'tapphoto').fileId === OLD_ID, 'a cancelled compression cannot upload after another slot stays in flight');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
