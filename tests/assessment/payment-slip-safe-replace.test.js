/**
 * Payment slip replacement must keep a committed file ID until the new
 * upload succeeds. Drive is mocked. No payment processor or Production Case
 * is contacted.
 * Run: node tests/assessment/payment-slip-safe-replace.test.js
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

function control() {
  const readers = [];
  function FileReader() {}
  FileReader.prototype.readAsDataURL = function readAsDataURL(file) {
    const reader = this;
    const finish = () => {
      reader.result = file.dataUrl;
      if (typeof reader.onload === 'function') reader.onload();
    };
    if (driveControl.deferRead) readers.push({ finish });
    else Promise.resolve().then(finish);
  };
  const driveControl = {
    pending: [],
    compressPending: [],
    enqueued: [],
    readers,
    mode: 'hold',
    deferCompress: false,
    deferRead: false,
    inflightOps: new Set(),
    seq: 0,
    failCode: 'UPLOAD_FAILED',
    failMessage: 'Upload failed'
  };
  driveControl.FileReader = FileReader;
  return driveControl;
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
      getElementById: () => ({
        src: '',
        style: { display: '' },
        classList: { add() {}, remove() {}, toggle() {} },
        closest: () => null,
        addEventListener() {},
        dataset: {}
      }),
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ classList: { add() {}, remove() {} }, addEventListener() {} })
    },
    FileReader: driveControl.FileReader,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    S: {
      activeTap: 0,
      taps: ['Tap 1'],
      tapData: [{ tasks: {}, photos: {}, standardMeasurement: { ph: 7.2 } }],
      activeJob: { notionId: 'case-test', id: 'case-test' },
      pkg: 'full',
      user: { username: 'qa' },
      paymentSlipPhoto: {
        fileId: 'SLIP_OLD',
        purpose: 'payment',
        contentUrl: 'https://files.example/slip-old',
        name: 'slip-old.jpg'
      }
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
    buildFilename: () => 'payment-slip.jpg',
    compress: (dataUrl) => {
      if (driveControl.deferCompress) {
        return new Promise((resolve) => {
          driveControl.compressPending.push({ dataUrl, resolve });
        });
      }
      return Promise.resolve(dataUrl);
    },
    resolveActiveCustomerContext: () => ({ notionId: 'case-test', customerName: 'Test', jobId: 'case-test', customerFolderId: null }),
    resolveClientCategory: () => 'Payment',
    resolveClientSubCategory: () => 'Slip',
    purposeToFolder: () => 'main',
    dequeue: async () => {},
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

async function main() {
  console.log('Payment slip safe replacement\n');

  const during = control();
  during.mode = 'hold';
  during.deferCompress = true;
  const client = loadClient(during);
  const first = client.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_A');
  await settle();
  check(client.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'the old slip file ID remains while compression is pending');
  check(client.S.paymentSlipPhoto.uploading === true, 'the slip can show an upload in progress');
  const opA = client.S.paymentSlipPhoto.uploadOp;
  const second = client.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_B');
  await settle();
  check(client.S.paymentSlipPhoto.uploadOp !== opA, 'a newer slip selection owns the slot before the older compression finishes');
  check(client.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'the old slip file ID remains while the newer selection is compressing');
  during.compressPending[0].resolve(during.compressPending[0].dataUrl);
  await settle();
  check(client.S.paymentSlipPhoto.uploadOp !== opA && during.pending.length === 0, 'a late slip compression cannot upload or reclaim the slot');
  during.compressPending[1].resolve(during.compressPending[1].dataUrl);
  await settle();
  check(during.pending.length === 1, 'only the newer slip selection uploads');
  check(String(during.pending[0].request.inflightKey).indexOf(client.S.paymentSlipPhoto.uploadOp) !== -1, 'the slip in-flight key belongs to the current operation');
  during.pending[0].resolve({
    fileId: 'SLIP_B_FILE',
    filename: 'slip-b.jpg',
    contentUrl: 'https://files.example/slip-b',
    mimeType: 'image/jpeg',
    purpose: 'payment',
    createdTime: '2026-10-19T09:00:00.000Z'
  });
  await Promise.all([first, second, settle()]);
  check(client.S.paymentSlipPhoto.fileId === 'SLIP_B_FILE', 'the newer slip upload replaces the committed file ID');

  const failCtl = control();
  failCtl.mode = 'fail';
  failCtl.failCode = 'UPLOAD_FAILED';
  const failClient = loadClient(failCtl);
  await failClient.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_BAD');
  check(failClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a failed slip upload keeps the previous file ID');
  check(failClient.S.paymentSlipPhoto.uploading !== true, 'a failed slip upload is not left uploading');
  check(failCtl.enqueued.length === 0, 'a non-retryable slip failure is not queued');

  const timedOut = control();
  timedOut.mode = 'fail';
  timedOut.failCode = 'UPLOAD_TIMEOUT';
  timedOut.failMessage = 'Upload timed out';
  const timeoutClient = loadClient(timedOut);
  await timeoutClient.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_SLOW');
  check(timeoutClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a slip timeout keeps the previous file ID');
  check(timedOut.enqueued.length === 1, 'a slip timeout is queued once');
  await timeoutClient.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_SLOW');
  check(timeoutClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a second slip timeout still keeps the previous file ID');

  const blocked = control();
  blocked.mode = 'fail';
  blocked.failCode = 'UPLOAD_IN_FLIGHT';
  blocked.failMessage = 'Upload already in progress';
  const blockedClient = loadClient(blocked);
  await blockedClient.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_BLOCKED');
  check(blockedClient.S.paymentSlipPhoto.uploading !== true, 'slip UPLOAD_IN_FLIGHT does not stay uploading');
  check(blockedClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'slip UPLOAD_IN_FLIGHT keeps the previous file ID');

  const reloadCtl = control();
  reloadCtl.mode = 'hold';
  const reloadClient = loadClient(reloadCtl);
  const inflight = reloadClient.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_RELOAD');
  await settle();
  reloadClient.S.paymentSlipPhoto = reloadClient.normalizeInterruptedPhoto(reloadClient.S.paymentSlipPhoto);
  check(reloadClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'reload keeps the committed slip file ID');
  check(reloadClient.S.paymentSlipPhoto.uploading !== true, 'reload clears the slip uploading flag');
  reloadCtl.pending[0].resolve({
    fileId: 'SLIP_STALE',
    filename: 'stale.jpg',
    contentUrl: 'https://files.example/slip-stale',
    mimeType: 'image/jpeg',
    purpose: 'payment',
    createdTime: '2026-10-19T09:05:00.000Z'
  });
  await Promise.all([inflight, settle()]);
  check(reloadClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a stale slip response after reload cannot replace the committed file');

  const snap = AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1'],
    tapData: reloadClient.S.tapData,
    revision: 2,
    updatedAt: '2026-10-19T09:06:00.000Z'
  });
  check(!JSON.stringify(snap).includes('SLIP_OLD') && !JSON.stringify(snap).includes('data:'), 'the assessment snapshot does not store the slip preview or treat it as a tap photo');

  function slipFile(dataUrl) {
    return { size: 100, name: 'slip.jpg', dataUrl };
  }

  const picked = control();
  picked.mode = 'hold';
  picked.deferCompress = true;
  picked.deferRead = true;
  const pickClient = loadClient(picked);
  pickClient.handleSlipUpload({ files: [slipFile('data:image/jpeg;base64,PICK')] });
  check(pickClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'choosing a file does not clear the slip file ID before the file is read');
  picked.readers[0].finish();
  await settle();
  check(pickClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'handleSlipUpload keeps the committed file ID while the replacement is prepared');
  check(pickClient.S.paymentSlipPhoto.contentUrl === 'https://files.example/slip-old', 'handleSlipUpload keeps the committed content URL');
  check(String(pickClient.S.paymentSlipPhoto.previewUrl).indexOf('PICK') !== -1, 'handleSlipUpload attaches the new preview');
  const pickedRef = AssessmentSnapshot.compactPhotoRef(pickClient.S.paymentSlipPhoto);
  check(pickedRef.fileId === 'SLIP_OLD' && !JSON.stringify(pickedRef).includes('data:'), 'serialization of the in-progress slip keeps the file ID and drops the preview');

  const captured = control();
  captured.mode = 'hold';
  captured.deferCompress = true;
  const captureClient = loadClient(captured);
  captureClient.handleSlipCapture('data:image/jpeg;base64,CAP_A');
  await settle();
  check(captureClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'handleSlipCapture keeps the committed file ID during compression');
  check(String(captureClient.S.paymentSlipPhoto.previewUrl).indexOf('CAP_A') !== -1, 'handleSlipCapture shows the captured preview');
  const captureOpA = captureClient.S.paymentSlipPhoto.uploadOp;
  captureClient.handleSlipCapture('data:image/jpeg;base64,CAP_B');
  await settle();
  const owned = captureClient.S.paymentSlipPhoto;
  check(owned.uploadOp !== captureOpA && String(owned.previewUrl).indexOf('CAP_B') !== -1, 'the newer capture owns the slip slot');
  check(owned.fileId === 'SLIP_OLD', 'the newer capture still has the old file ID before upload success');
  captured.compressPending[0].resolve(captured.compressPending[0].dataUrl);
  await settle();
  check(captureClient.S.paymentSlipPhoto.uploadOp === owned.uploadOp, 'a late slip compression cannot reclaim the newer capture');
  check(String(captureClient.S.paymentSlipPhoto.previewUrl).indexOf('CAP_B') !== -1, 'a late slip compression cannot restore the older preview');
  check(captured.pending.length === 0 && captureClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a late slip compression does not upload or replace the file');
  captured.compressPending[1].resolve(captured.compressPending[1].dataUrl);
  await settle();
  check(captured.pending.length === 1, 'only the newer slip capture uploads');
  captured.pending[0].resolve({
    fileId: 'SLIP_CAP_B',
    filename: 'cap-b.jpg',
    contentUrl: 'https://files.example/slip-cap-b',
    mimeType: 'image/jpeg',
    purpose: 'payment',
    createdTime: '2026-10-19T09:11:00.000Z'
  });
  await settle();
  check(captureClient.S.paymentSlipPhoto.fileId === 'SLIP_CAP_B', 'the newer slip capture becomes the committed file');

  const race = control();
  race.mode = 'hold';
  const raceClient = loadClient(race);
  raceClient.handleSlipCapture('data:image/jpeg;base64,RACE_A');
  await settle();
  raceClient.handleSlipCapture('data:image/jpeg;base64,RACE_B');
  await settle();
  const raceOwned = raceClient.S.paymentSlipPhoto;
  const staleError = new Error('older capture failed');
  staleError.code = 'UPLOAD_FAILED';
  race.pending[0].reject(staleError);
  await settle();
  check(raceClient.S.paymentSlipPhoto.uploadOp === raceOwned.uploadOp, 'a stale slip failure cannot take the slot back');
  check(raceClient.S.paymentSlipPhoto.previewUrl === raceOwned.previewUrl, 'a stale slip failure cannot restore the older preview');
  check(!raceClient.S.paymentSlipPhoto.uploadError && raceClient.S.paymentSlipPhoto.uploading === true, 'a stale slip failure cannot change the newer loading state');
  check(raceClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a stale slip failure cannot replace the committed file ID');

  const captureOk = control();
  captureOk.mode = 'hold';
  const okClient = loadClient(captureOk);
  okClient.handleSlipCapture('data:image/jpeg;base64,CAP_OK');
  await settle();
  check(okClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'the captured slip is not committed before Drive returns');
  captureOk.pending[0].resolve({
    fileId: 'SLIP_CAP',
    filename: 'cap.jpg',
    contentUrl: 'https://files.example/slip-cap',
    mimeType: 'image/jpeg',
    purpose: 'payment',
    createdTime: '2026-10-19T09:10:00.000Z'
  });
  await settle();
  check(okClient.S.paymentSlipPhoto.fileId === 'SLIP_CAP', 'handleSlipCapture commits the new file ID only after upload success');

  const captureFail = control();
  captureFail.mode = 'fail';
  captureFail.failCode = 'UPLOAD_FAILED';
  const captureFailClient = loadClient(captureFail);
  captureFailClient.handleSlipCapture('data:image/jpeg;base64,CAP_BAD');
  await settle();
  check(captureFailClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD' && captureFailClient.S.paymentSlipPhoto.uploading !== true, 'a failed handleSlipCapture keeps the old file ID');

  const captureTimeout = control();
  captureTimeout.mode = 'fail';
  captureTimeout.failCode = 'UPLOAD_TIMEOUT';
  captureTimeout.failMessage = 'Upload timed out';
  const captureTimeoutClient = loadClient(captureTimeout);
  captureTimeoutClient.handleSlipCapture('data:image/jpeg;base64,CAP_SLOW');
  await settle();
  check(captureTimeoutClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD' && captureTimeoutClient.S.paymentSlipPhoto.uploading !== true, 'a timed-out handleSlipCapture keeps the old file ID');

  const captureBlocked = control();
  captureBlocked.mode = 'fail';
  captureBlocked.failCode = 'UPLOAD_IN_FLIGHT';
  captureBlocked.failMessage = 'Upload already in progress';
  const captureBlockedClient = loadClient(captureBlocked);
  captureBlockedClient.handleSlipCapture('data:image/jpeg;base64,CAP_BLOCKED');
  await settle();
  check(captureBlockedClient.S.paymentSlipPhoto.uploading !== true, 'handleSlipCapture does not stay uploading after UPLOAD_IN_FLIGHT');
  check(captureBlockedClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'handleSlipCapture keeps the old file ID after UPLOAD_IN_FLIGHT');

  const slipScoped = control();
  slipScoped.mode = 'hold';
  const slipScopedClient = loadClient(slipScoped);
  slipScopedClient.handleSlipCapture('data:image/jpeg;base64,SLIP_LIVE');
  await settle();
  slipScoped.inflightOps.add(slipScopedClient.S.paymentSlipPhoto.uploadOp);
  const liveSlip = slipScopedClient.S.paymentSlipPhoto;
  const matchingSlip = slipScopedClient.normalizeInterruptedPhoto(liveSlip);
  check(matchingSlip === liveSlip && matchingSlip.uploading === true && matchingSlip.fileId === 'SLIP_OLD', 'the matching slip operation stays in flight');
  slipScopedClient.S.paymentSlipPhoto = {
    fileId: 'SLIP_OLD',
    contentUrl: 'https://files.example/slip-old',
    purpose: 'payment',
    uploading: true,
    uploadOp: 'upl_stale_slip',
    previewUrl: 'data:image/jpeg;base64,SLIP_STALE_OTHER'
  };
  const clearedSlip = slipScopedClient.normalizeInterruptedPhoto(slipScopedClient.S.paymentSlipPhoto);
  check(clearedSlip.uploading !== true && clearedSlip.uploadOp == null && clearedSlip.fileId === 'SLIP_OLD', 'a stale slip operation is cleared while another operation stays in flight');
  check(!JSON.stringify(AssessmentSnapshot.compactPhotoRef(clearedSlip)).includes('data:'), 'scoped slip recovery does not commit the preview');

  const slipEmpty = control();
  const slipEmptyClient = loadClient(slipEmpty);
  slipEmptyClient.S.paymentSlipPhoto = {
    fileId: 'SLIP_OLD',
    contentUrl: 'https://files.example/slip-old',
    purpose: 'payment',
    uploading: true,
    uploadOp: 'upl_slip_reload',
    previewUrl: 'data:image/jpeg;base64,SLIP_RELOAD_FLAG'
  };
  slipEmptyClient.S.paymentSlipPhoto = slipEmptyClient.normalizeInterruptedPhoto(slipEmptyClient.S.paymentSlipPhoto);
  check(slipEmpty.inflightOps.size === 0 && slipEmptyClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD' && slipEmptyClient.S.paymentSlipPhoto.uploading !== true, 'an empty in-flight set clears the slip upload flag');

  const slipLate = control();
  slipLate.mode = 'hold';
  const slipLateClient = loadClient(slipLate);
  slipLateClient.handleSlipCapture('data:image/jpeg;base64,SLIP_LATE_FAIL');
  await settle();
  const slipRecovered = slipLateClient.normalizeInterruptedPhoto(slipLateClient.S.paymentSlipPhoto);
  slipLateClient.S.paymentSlipPhoto = slipRecovered;
  const slipLateError = new Error('stale slip failure');
  slipLateError.code = 'UPLOAD_FAILED';
  slipLate.pending[0].reject(slipLateError);
  await settle();
  check(slipLateClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD' && slipLateClient.S.paymentSlipPhoto.previewUrl === slipRecovered.previewUrl && slipLateClient.S.paymentSlipPhoto.uploadError === slipRecovered.uploadError, 'a stale slip failure after recovery cannot replace the recovered slip');

  const slipRetry = control();
  slipRetry.mode = 'hold';
  slipRetry.inflightOps.add('upl_other_photo');
  const slipRetryClient = loadClient(slipRetry);
  slipRetryClient.S.paymentSlipPhoto = {
    fileId: 'SLIP_OLD',
    contentUrl: 'https://files.example/slip-old',
    purpose: 'payment',
    uploading: true,
    uploadOp: 'upl_slip_retry',
    previewUrl: 'data:image/jpeg;base64,SLIP_RETRY'
  };
  await slipRetryClient.uploadSlipPhotoToDrive('data:image/jpeg;base64,SLIP_RETRY');
  check(slipRetry.pending.length === 0, 'a stale slip uploading flag blocks a same-capture retry');
  slipRetryClient.S.paymentSlipPhoto = slipRetryClient.normalizeInterruptedPhoto(slipRetryClient.S.paymentSlipPhoto);
  check(slipRetryClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD' && slipRetryClient.S.paymentSlipPhoto.uploading !== true, 'scoped slip recovery clears the blocked slip');
  slipRetryClient.handleSlipCapture(slipRetryClient.S.paymentSlipPhoto.previewUrl);
  await settle();
  check(slipRetry.pending.length === 1 && slipRetryClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'handleSlipCapture after scoped recovery keeps the old file ID');
  slipRetry.pending[0].resolve({
    fileId: 'SLIP_RETRIED',
    filename: 'retried.jpg',
    contentUrl: 'https://files.example/slip-retried',
    mimeType: 'image/jpeg',
    purpose: 'payment',
    createdTime: '2026-10-19T09:20:00.000Z'
  });
  await settle();
  check(slipRetryClient.S.paymentSlipPhoto.fileId === 'SLIP_RETRIED', 'the retried slip capture commits only after upload success');

  const slipCompress = control();
  slipCompress.mode = 'hold';
  slipCompress.deferCompress = true;
  slipCompress.inflightOps.add('upl_other_live');
  const slipCompressClient = loadClient(slipCompress);
  slipCompressClient.handleSlipUpload({ files: [slipFile('data:image/jpeg;base64,SLIP_COMPRESS')] });
  await settle();
  check(slipCompressClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'handleSlipUpload keeps the file ID during compression while another operation is in flight');
  slipCompressClient.S.paymentSlipPhoto = slipCompressClient.normalizeInterruptedPhoto(slipCompressClient.S.paymentSlipPhoto);
  check(slipCompressClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD' && slipCompressClient.S.paymentSlipPhoto.uploading !== true, 'slip recovery during compression cancels that attempt and keeps the file');
  slipCompress.compressPending[0].resolve(slipCompress.compressPending[0].dataUrl);
  await settle();
  check(slipCompress.pending.length === 0 && slipCompressClient.S.paymentSlipPhoto.fileId === 'SLIP_OLD', 'a cancelled slip compression cannot upload');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
