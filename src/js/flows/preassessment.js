function sendClientLink() { showToast('Link sent to client via LINE'); }
let propertySuggestion = null;
const PROPERTY_SUGGESTIONS = [
  { label:'12 Sukhumvit Soi 11, Wattana, Bangkok 10110', code:'10110', city:'Bangkok', propertyType:'Single House', propertyAge:'5-10 yrs' },
  { label:'111 Ari Sampan Soi 4, Samsen, Bangkok 10400', code:'10400', city:'Bangkok', propertyType:'Single House', propertyAge:'20+ yrs' },
  { label:'19 Navin Village, Sathorn, Bangkok 10500', code:'10500', city:'Bangkok', propertyType:'Townhome', propertyAge:'1-5 yrs' },
  { label:'Sukhumvit / Wattana, Bangkok 10110', code:'10110', city:'Bangkok' },
  { label:'Silom / Bang Rak, Bangkok 10500', code:'10500', city:'Bangkok' },
  { label:'Ari / Phaya Thai, Bangkok 10400', code:'10400', city:'Bangkok' },
  { label:'Lumphini / Pathum Wan, Bangkok 10330', code:'10330', city:'Bangkok' }
];

function normalisePropertyText(value) {
  return (value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function getPropertyQuery() {
  return [
    document.getElementById('ci-postal')?.value,
    document.getElementById('ci-addr')?.value,
    document.getElementById('ci-maps')?.value
  ].filter(Boolean).join(' ');
}

function scorePropertyMatch(item, query) {
  const q = normalisePropertyText(query);
  if (q.length < 2) return 0;

  const label = normalisePropertyText([item.label, item.city, item.propertyType, item.propertyAge].filter(Boolean).join(' '));
  const code = item.code || '';
  let score = 0;

  q.split(' ').filter(Boolean).forEach(part => {
    if (part.length < 2) return;
    if (code.startsWith(part)) score += 6;
    else if (code.includes(part)) score += 4;
    if (label.includes(part)) score += 3;
  });

  return score;
}

function renderPropertySuggestion(match) {
  const bar = document.getElementById('property-suggest-bar');
  if (!bar) return;

  propertySuggestion = match || null;
  if (!match) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  const area = match.label.replace(match.code, '').replace(/^[\s,./-]+/, '').trim();
  const meta = [match.city, match.propertyType, match.propertyAge].filter(Boolean).join(' · ');
  bar.innerHTML = `
    <div class="ps-copy">
      <div class="ps-title">Suggested property details</div>
      <div class="ps-sub">${match.code} ${area}${meta ? ' · ' + meta : ''}</div>
    </div>
    <button class="ps-dismiss" type="button" onclick="dismissPropertySuggestion()" aria-label="Dismiss">x</button>
    <button class="ps-use" type="button" onclick="applyPropertySuggestion()">Use</button>
  `;
  bar.classList.remove('hidden');
}

function suggestProperty() {
  const query = getPropertyQuery();
  const candidates = [...PROPERTY_SUGGESTIONS, ...POSTAL_DATA.map(item => ({ ...item, city:'Bangkok' }))];
  const best = candidates
    .map(item => ({ ...item, score: scorePropertyMatch(item, query) }))
    .sort((a, b) => b.score - a.score)[0];

  renderPropertySuggestion(best && best.score >= 4 ? best : null);
}

function filterPostal(q) {
  const dd = document.getElementById('postal-dropdown');
  if (!q || q.length < 2) { dd.classList.add('hidden'); suggestProperty(); return; }
  const matches = POSTAL_DATA.filter(p => p.code.includes(q) || p.label.includes(q));
  if (!matches.length) { dd.classList.add('hidden'); suggestProperty(); return; }
  dd.innerHTML = matches.map(p => {
    const code = p.code;
    const rest = p.label.replace(code, '').replace(/^[\s,./-]+/, '').trim();
    const codeDisplay = code.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'i'), '<span class="postal-match">$1</span>');
    return `<div class="postal-item" onclick="selectPostal('${p.label.replace(/'/g,"\\'")}')"><img class="postal-pin" src="${ICON.pin}" alt=""><span>${codeDisplay} <span class="postal-rest">${rest}</span></span></div>`;
  }).join('');
  dd.classList.remove('hidden');
  suggestProperty();
}

function selectPostal(label) {
  const code = (label.match(/\d{5}/) || [''])[0];
  document.getElementById('ci-postal').value = code;
  document.getElementById('ci-addr').value = label;
  document.getElementById('postal-dropdown').classList.add('hidden');
  renderPropertySuggestion(null);
}

function applyPropertySuggestion() {
  if (!propertySuggestion) return;
  document.getElementById('ci-city').value = propertySuggestion.city || 'Bangkok';
  document.getElementById('ci-postal').value = propertySuggestion.code;
  document.getElementById('ci-addr').value = propertySuggestion.label;
  setSelectValue('ci-proptype', propertySuggestion.propertyType);
  setSelectValue('ci-propage', propertySuggestion.propertyAge);
  document.getElementById('postal-dropdown')?.classList.add('hidden');
  renderPropertySuggestion(null);
  showToast('Property details filled');
}

function dismissPropertySuggestion() { renderPropertySuggestion(null); }

function setSelectValue(id, value) {
  if (!value) return;
  const el = document.getElementById(id);
  if (!el) return;
  const option = [...el.options].find(opt => normalisePropertyText(opt.textContent) === normalisePropertyText(value));
  if (option) el.value = option.value || option.textContent;
}

function toggleMs(id) {
  const wrap = document.getElementById(id);
  const menu = wrap.querySelector('.ms-menu');
  document.querySelectorAll('.ms-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
  menu.classList.toggle('hidden');
}

function updateMsDisplay(id) {
  const wrap = document.getElementById(id);
  const valEl = wrap.querySelector('.ms-value');
  const checked = [...wrap.querySelectorAll('input:checked')].map(i => i.value);
  if (!checked.length) {
    valEl.className = 'ms-value ms-placeholder';
    valEl.textContent = typeof t === 'function' ? t('preassess.selectPh') : 'Please select';
    return;
  }
  valEl.className = 'ms-value ms-tags';
  valEl.innerHTML = checked.map(v => `<span class="ms-tag">${v}</span>`).join('');
}

function initMultiSelect() {
  document.querySelectorAll('.ms-wrap').forEach(wrap => {
    const max = parseInt(wrap.dataset.max || '0', 10);
    wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.onchange = () => {
        const checked = wrap.querySelectorAll('input:checked');
        if (max && checked.length > max) { cb.checked = false; showToast(`Select up to ${max}`); return; }
        updateMsDisplay(wrap.id);
      };
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.ms-wrap')) document.querySelectorAll('.ms-menu').forEach(m => m.classList.add('hidden'));
    if (!e.target.closest('.postal-wrap')) document.getElementById('postal-dropdown')?.classList.add('hidden');
  });
}

function initOwnerRadios() {
  document.querySelectorAll('#owner-radios .radio-item').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('#owner-radios .radio-item').forEach(r => r.classList.remove('sel'));
      el.classList.add('sel');
      el.querySelector('input').checked = true;
      const v = el.dataset.val;
      document.getElementById('contact-person-wrap').classList.toggle('hidden', v === 'yes');
    };
  });
}

function initChipGroups() { initMultiSelect(); }
