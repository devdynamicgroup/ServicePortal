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

/** Render/Cloudflare edge transient failures — not app 404s. */
const TRANSIENT_PAGE_STATUS = new Set([502, 503, 520, 521, 522, 523, 524]);
const PAGE_FETCH_ATTEMPTS = 3;
const PAGE_FETCH_RETRY_MS = 400;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPagePartial(url, path) {
  let lastError = null;
  for (let attempt = 1; attempt <= PAGE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) return response.text();

      lastError = new Error(`Unable to load ${path} (HTTP ${response.status})`);
      const transient = TRANSIENT_PAGE_STATUS.has(response.status);
      if (!transient || attempt >= PAGE_FETCH_ATTEMPTS) throw lastError;

      console.warn('[page-loader] transient page fetch failure — retrying', {
        path,
        status: response.status,
        attempt,
        nextAttemptInMs: PAGE_FETCH_RETRY_MS * attempt
      });
      await sleep(PAGE_FETCH_RETRY_MS * attempt);
    } catch (error) {
      if (error && error.message && error.message.startsWith('Unable to load ')) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= PAGE_FETCH_ATTEMPTS) {
        throw new Error(`Unable to load ${path}`);
      }
      console.warn('[page-loader] page fetch network error — retrying', {
        path,
        attempt,
        message: lastError.message
      });
      await sleep(PAGE_FETCH_RETRY_MS * attempt);
    }
  }
  throw lastError || new Error(`Unable to load ${path}`);
}

async function loadPagePartials() {
  const app = document.getElementById('app');
  const pathName = window.location.pathname;
  const appBase = pathName.endsWith('/')
    ? pathName
    : pathName.includes('.')
      ? pathName.slice(0, pathName.lastIndexOf('/') + 1)
      : '/';
  const cacheBust = Date.now();
  const pages = await Promise.all(PAGE_PARTIALS.map((path) => (
    fetchPagePartial(`${appBase}${path}?v=${cacheBust}`, path)
  )));
  app.innerHTML = pages.join('\n');
}
