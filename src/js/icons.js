const ICON_BASE = 'src/assets/icons/';

const CARET_RIGHT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const ICON = {
  pin: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'),
  chevron: `${ICON_BASE}chevron.svg`,
  plus: `${ICON_BASE}plus.svg`,
  lock: `${ICON_BASE}lock.svg`,
  logo: `${ICON_BASE}logo.svg`
};

const STEP_ICONS = {
  preassess: `${ICON_BASE}step-preassess.svg`,
  assess: `${ICON_BASE}step-assess.svg`,
  score: `${ICON_BASE}step-score.svg`,
  payment: `${ICON_BASE}step-payment.svg`,
  feedback: `${ICON_BASE}step-feedback.svg`
};

function applyStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const src = ICON[el.dataset.icon];
    if (src) el.src = src;
  });
}
