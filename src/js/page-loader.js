const PAGE_PARTIALS = [
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

async function loadPagePartials() {
  const app = document.getElementById('app');
  const pathName = window.location.pathname;
  const appBase = pathName.endsWith('/')
    ? pathName
    : pathName.includes('.')
      ? pathName.slice(0, pathName.lastIndexOf('/') + 1)
      : '/';
  const cacheBust = Date.now();
  const pages = await Promise.all(PAGE_PARTIALS.map(async (path) => {
    const response = await fetch(`${appBase}${path}?v=${cacheBust}`, { cache: 'reload' });
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.text();
  }));
  app.innerHTML = pages.join('\n');
}
