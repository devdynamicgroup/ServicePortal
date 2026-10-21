/**
 * Free Case postcard photo selection. Does not render the plate.
 * Run: node tests/score/free-case-postcard-photo.test.js
 */
const fs = require('fs');
const path = require('path');
const { cardOptionsFromJob, resolvePhotoDataUri } = require('../../services/score-share-card');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function job(id, photo, latestId) {
  return {
    id,
    pkg: 'essential',
    result: { waterScore: 71 },
    drive: latestId ? { latestFileId: latestId, latestFileUrl: `https://drive.example/${latestId}` } : {},
    draft: {
      tapData: photo ? [{
        photos: { tapphoto: photo }
      }] : [{ photos: {} }]
    }
  };
}

console.log('\n1. Case photo is preferred over the latest upload');
{
  const options = cardOptionsFromJob(job('case-a', { fileId: 'tap-a', contentUrl: 'https://files.example/a.jpg' }, 'meter-a'));
  assert(options.photoFileId === 'tap-a', 'tap photo file id is used');
  assert(options.photoUrl === 'https://files.example/a.jpg', 'tap photo url is used');
  assert(options.score === 71, 'score is unchanged');
}

console.log('\n2. Consecutive cases keep their own photos');
{
  const first = cardOptionsFromJob(job('case-a', { fileId: 'tap-a' }, 'meter-a'));
  const second = cardOptionsFromJob(job('case-b', { fileId: 'tap-b' }, 'meter-b'));
  const visualOnly = cardOptionsFromJob({
    result: { waterScore: 71 },
    drive: { latestFileId: 'meter-x' },
    draft: { tapData: [{ photos: { visual: { fileId: 'visual-b' }, meter: { fileId: 'meter-photo' } } }] }
  });
  assert(visualOnly.photoFileId === 'visual-b', 'visual photo is used when the tap photo is absent');
  assert(first.photoFileId === 'tap-a' && second.photoFileId === 'tap-b', 'case B does not reuse case A');
  assert(second.photoUrl === '' || !second.photoUrl.includes('tap-a'), 'case B url is not case A');
}

console.log('\n3. Every case is selected on its own');
{
  const cases = ['tap-1', 'tap-2', 'tap-3'].map((fileId, index) => cardOptionsFromJob(job(`case-${index}`, { fileId })));
  assert(cases.map((item) => item.photoFileId).join(',') === 'tap-1,tap-2,tap-3', 'three cases keep three different photos');
  const laterTap = cardOptionsFromJob({
    result: { waterScore: 71 },
    draft: { tapData: [{ photos: {} }, { photos: { tapphoto: { fileId: 'tap-room-2' } } }] }
  });
  assert(laterTap.photoFileId === 'tap-room-2', 'a photo on a later tap still belongs to that case');
  const meterSession = cardOptionsFromJob({
    result: { waterScore: 71 },
    draft: { tapData: [{ photos: {}, meterImages: [{ id: 'm1', photo: { contentUrl: '/api/drive/images/meter-session/content' } }] }] }
  });
  assert(meterSession.photoFileId === 'meter-session', 'a meter-session photo is used when the tap photo is absent');
  const latestOnly = cardOptionsFromJob(job('case-empty', null, 'latest-c'));
  assert(latestOnly.photoFileId === 'latest-c', 'a case with no site photo keeps its previous file');
  const none = cardOptionsFromJob({ id: 'case-none', result: { waterScore: 71 }, draft: { tapData: [{}] } });
  assert(none.photoFileId === '' && none.photoUrl === '', 'a case with no photo at all leaves the stock fallback');
}

console.log('\n4. Failed or absent bytes resolve to the stock photo, not another case');
(async () => {
  const stock = await resolvePhotoDataUri({});
  const unusable = await resolvePhotoDataUri({ photoUrl: 'not-a-url' });
  const caseA = await resolvePhotoDataUri({ photoDataUri: 'data:image/jpeg;base64,QQ==' });
  const caseB = await resolvePhotoDataUri({ photoDataUri: 'data:image/jpeg;base64,Qg==' });
  assert(stock.startsWith('data:image/'), 'empty selection uses the stock photo');
  assert(unusable === stock, 'unusable url uses the stock photo');
  assert(caseA === 'data:image/jpeg;base64,QQ==' && caseB === 'data:image/jpeg;base64,Qg==', 'explicit photos are not replaced or reused');

  console.log('\n5. Full Assessment share still skips the postcard');
  const scoreJs = fs.readFileSync(path.join(__dirname, '../../src/js/flows/score.js'), 'utf8');
  assert(scoreJs.includes('shareCard: false'), 'every package shares the score page link');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
