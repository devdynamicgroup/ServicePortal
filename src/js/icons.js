function svgData(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg.trim());
}

const ICON_BASE = 'src/assets/icons/';
const STROKE = '#1c1917';
// chevron/plus/lock are plain <img src> files, not inline data URIs like the
// icons below -- browsers cache those aggressively with no way to bust it
// short of a query param, so any future edit to one of those files would
// silently keep showing the old cached version until the cache naturally
// expired (2026-09-02: this is exactly what happened after plus.svg's color
// was fixed -- the fix was live, but old cached copies kept rendering).
const ICON_CACHE_BUST = Date.now();

const CARET_RIGHT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const ICON = {
  pin: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`),
  chevron: `${ICON_BASE}chevron.svg?v=${ICON_CACHE_BUST}`,
  plus: `${ICON_BASE}plus.svg?v=${ICON_CACHE_BUST}`,
  lock: `${ICON_BASE}lock.svg?v=${ICON_CACHE_BUST}`,
  logo: `${ICON_BASE}logo.svg?v=${ICON_CACHE_BUST}`
};

// Phosphor Icons (regular weight, https://github.com/phosphor-icons/core) --
// matches the icon set used in the Figma spec (User / TestTube / DropSimple /
// HandCoins / Star), native 256x256 viewBox and stroke-width kept as-is.
const STEP_ICONS = {
  preassess: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><circle cx="128" cy="96" r="64" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M32,216c19.37-33.47,54.55-56,96-56s76.63,22.53,96,56" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`),
  assess: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><path d="M94.77,213.23a36.77,36.77,0,0,1-52,0h0a36.77,36.77,0,0,1,0-52L172,32l60,60-24,8Z" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M72.82,131.18c9.37-3.65,25.78-6.36,47.18,4.82s37.81,8.47,47.18,4.82" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`),
  score: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><path d="M208,144c0-72-80-128-80-128S48,72,48,144a80,80,0,0,0,160,0Z" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`),
  payment: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><circle cx="204" cy="84" r="28" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M48,208H16a8,8,0,0,1-8-8V160a8,8,0,0,1,8-8H48" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M112,160h32l67-15.41a16.61,16.61,0,0,1,21,16h0a16.59,16.59,0,0,1-9.18,14.85L184,192l-64,16H48V152l25-25a24,24,0,0,1,17-7H140a20,20,0,0,1,20,20h0a20,20,0,0,1-20,20Z" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M176,85.29A28,28,0,1,1,192,58.71" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`),
  feedback: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><path d="M128,189.09l54.72,33.65a8.4,8.4,0,0,0,12.52-9.17l-14.88-62.79,48.7-42A8.46,8.46,0,0,0,224.27,94L160.36,88.8,135.74,29.2a8.36,8.36,0,0,0-15.48,0L95.64,88.8,31.73,94a8.46,8.46,0,0,0-4.79,14.83l48.7,42L60.76,213.57a8.4,8.4,0,0,0,12.52,9.17Z" fill="none" stroke="${STROKE}" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`)
};

function applyStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const src = ICON[el.dataset.icon];
    if (src) el.src = src;
  });
}
