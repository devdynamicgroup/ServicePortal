const FIGMA = id => `https://www.figma.com/api/mcp/asset/${id}`;

const CARET_RIGHT = `<img src="${FIGMA('8f8f14ee-d74b-416a-b51b-d6e8ec34735b')}" alt="" width="16" height="16">`;

const ICON = {
  pin: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'),
  chevron: FIGMA('8f8f14ee-d74b-416a-b51b-d6e8ec34735b'),
  plus: FIGMA('0f2886f8-d4aa-45dc-a175-261d13001604'),
  lock: FIGMA('2ba60753-5b7b-46ed-9107-34c483d1b152'),
  logo: FIGMA('07f522fa-90f9-426a-a58a-28ffb301712e')
};

const STEP_ICONS = {
  preassess: FIGMA('f620f2ed-7fed-4ee3-b634-cd41f065b118'),
  assess: FIGMA('2b27f4ee-3807-4e2e-a003-626b01077771'),
  score: FIGMA('a0c8402e-bd80-462d-83a0-452c06a843a8'),
  payment: FIGMA('4732c08b-4ab7-4ad4-a251-baa7346141a9'),
  feedback: FIGMA('bbcef7df-4008-4afb-b404-899bf4227094')
};

function applyStaticIcons() {
  if (typeof ICON === 'undefined') return;
  document.querySelectorAll('[data-icon]').forEach(el => {
    const src = ICON[el.dataset.icon];
    if (src) el.src = src;
  });
}
