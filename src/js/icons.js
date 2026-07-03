function svgData(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg.trim());
}

const ICON_BASE = 'src/assets/icons/';
const STROKE = '#1c1917';

const CARET_RIGHT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const ICON = {
  pin: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`),
  chevron: `${ICON_BASE}chevron.svg`,
  plus: `${ICON_BASE}plus.svg`,
  lock: `${ICON_BASE}lock.svg`,
  logo: `${ICON_BASE}logo.svg`
};

const STEP_ICONS = {
  preassess: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c0-3.5 2.9-6.5 6.5-6.5s6.5 3 6.5 6.5"/></svg>`),
  assess: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z"/></svg>`),
  score: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`),
  payment: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>`),
  feedback: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.9 5.9 6.6.9-4.8 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.5 9.8l6.6-.9L12 3z"/></svg>`)
};

function applyStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const src = ICON[el.dataset.icon];
    if (src) el.src = src;
  });
}
