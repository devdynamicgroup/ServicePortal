const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');
const partials = [
  'src/pages/login.html',
  'src/pages/dashboard.html',
  'src/pages/job.html',
  'src/pages/preassessment.html',
  'src/pages/assessment.html',
  'src/pages/tap-photo.html',
  'src/pages/visual-check.html',
  'src/pages/meter-readings.html',
  'src/pages/chlorine-test.html',
  'src/pages/pressure-flow.html',
  'src/pages/infrastructure.html',
  'src/pages/score.html',
  'src/pages/payment.html',
  'src/pages/feedback.html',
  'src/pages/partials/modals.html',
  'src/pages/partials/package-sheet.html'
];

const html = fs.readFileSync(path.join(root, 'src/pages/payment.html'), 'utf8');
const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function() { this.scrollTop = 0; };
}
window.scrollTo = () => {};

const scripts = [
  'src/js/state.js',
  'src/js/navigation.js',
  'src/js/flows/auth.js',
  'src/js/flows/dashboard.js',
  'src/js/flows/job.js',
  'src/js/flows/preassessment.js',
  'src/js/flows/assessment.js',
  'src/js/flows/score.js',
  'src/js/flows/payment.js',
  'src/js/flows/feedback.js',
  'src/js/common.js'
];

const ctx = {
  console,
  document,
  window,
  localStorage: { getItem: () => 'en', setItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
  performance: { now: () => Date.now() },
  requestAnimationFrame: fn => setTimeout(() => fn(Date.now()), 0)
};
window.localStorage = ctx.localStorage;
ctx.navigator = { clipboard: { writeText: async () => {} } };
window.location = { pathname: '/', protocol: 'http:' };
vm.createContext(ctx);

let loadError = null;
for (const file of scripts) {
  try {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  } catch (error) {
    loadError = { file, error };
    break;
  }
}

if (loadError) {
  console.error('LOAD_FAIL', loadError.file, loadError.error.stack);
  process.exit(1);
}

const screen = document.getElementById('s-payment') || document.querySelector('#s-payment');
const before = {
  exists: !!screen,
  innerLen: screen?.innerHTML?.length || 0,
  hasSummary: !!document.getElementById('pay-summary-title'),
  hasHdr: !!screen?.querySelector('.hdr-title')
};

try {
  const _orig = ctx.goScreen;
  ctx.window.goScreen = function(id) {
    _orig(id);
    if (id === 's-payment') ctx.updatePaymentScreen();
  };
  ctx.window.goScreen('s-payment');
} catch (error) {
  console.error('GO_SCREEN_FAIL', error.stack);
  process.exit(2);
}

const after = {
  active: screen?.classList.contains('active'),
  innerLen: screen?.innerHTML?.length || 0,
  summary: document.getElementById('pay-summary-title')?.textContent,
  cash: document.getElementById('pm-cash-amt')?.textContent,
  hasHdr: !!screen?.querySelector('.hdr-title'),
  hasPkg: !!document.getElementById('pay-toggle-full'),
  preview: (screen?.innerHTML || '').slice(0, 180).replace(/\s+/g, ' ')
};

console.log(JSON.stringify({ before, after }, null, 2));

if (!after.active || after.innerLen < 500 || !after.hasHdr) {
  console.error('ASSERT_FAIL payment screen blank or missing markup');
  process.exit(3);
}

console.log('PASS payment screen has content after goScreen');
