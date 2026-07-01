function sendClientLink() {
  showToast(S.lang === 'th' ? 'ส่งลิงก์ให้ลูกค้าทาง LINE แล้ว' : 'Link sent to client via LINE');
}

let propertySuggestion = null;

const PREASSESS_REQUIRED_FIELDS = [
  'ci-fname', 'ci-lname', 'ci-phone', 'ci-line', 'ci-email',
  'ci-city', 'ci-addr', 'ci-proptype', 'ci-propage',
  'ci-filter', 'ci-source'
];

const PREASSESS_FIELD_LABELS = {
  'ci-fname': 'First name',
  'ci-lname': 'Last name',
  'ci-phone': 'Mobile number',
  'ci-line': 'LINE ID',
  'ci-email': 'Email address',
  'ci-city': 'Province / city',
  'ci-postal': 'Postal code',
  'ci-addr': 'Address',
  'ci-proptype': 'Property type',
  'ci-propage': 'Property age',
  'ci-filter': 'Current filter',
  'ci-source': 'Source',
  'ci-contact': 'Contact person',
  'ci-contact-ph': 'Contact mobile number'
};

function digitsOnly(value) {
  return (value || '').replace(/\D/g, '');
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  if (el.tagName === 'SELECT') {
    const selected = [...el.options].find(option => option.selected);
    return (el.value || selected?.value || selected?.textContent || S.activeJob?.draft?.fields?.[id] || '').trim();
  }
  return (el.value || S.activeJob?.draft?.fields?.[id] || '').trim();
}

function setFieldInvalid(id, invalid) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('invalid', invalid);
  const wrap = el.closest('.field') || el.closest('.province-picker')?.closest('.field');
  wrap?.classList.toggle('field-invalid', invalid);
}

function validatePhoneField(id, errors) {
  const digits = digitsOnly(getFieldValue(id));
  if (!digits) {
    errors.push(`${PREASSESS_FIELD_LABELS[id]} is required`);
    return false;
  }
  if (digits.length > 10) {
    errors.push(`${PREASSESS_FIELD_LABELS[id]} must not exceed 10 digits`);
    return false;
  }
  if (digits.length < 9) {
    errors.push(`${PREASSESS_FIELD_LABELS[id]} must be at least 9 digits`);
    return false;
  }
  return true;
}

function validateLineId(value) {
  return /^[A-Za-z0-9._-]{4,30}$/.test(value);
}

function validatePreassessment({ showErrors = false } = {}) {
  const errors = [];
  const invalidIds = new Set();

  PREASSESS_REQUIRED_FIELDS.forEach(id => {
    const value = getFieldValue(id);
    if (!value || value === 'Please select') {
      errors.push(`${PREASSESS_FIELD_LABELS[id]} is required`);
      invalidIds.add(id);
    }
  });

  if (!validatePhoneField('ci-phone', errors)) invalidIds.add('ci-phone');

  const lineId = getFieldValue('ci-line');
  if (lineId && !validateLineId(lineId)) {
    errors.push('LINE ID can use 4-30 letters, numbers, dot, underscore, or dash');
    invalidIds.add('ci-line');
  }

  const email = getFieldValue('ci-email').toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Email format is invalid');
    invalidIds.add('ci-email');
  }

  const postal = digitsOnly(getFieldValue('ci-postal'));
  if (postal && postal.length !== 5) {
    errors.push('Postal code must be 5 digits');
    invalidIds.add('ci-postal');
  }

  const owner = document.querySelector('#owner-radios input:checked')?.value || 'yes';
  if (owner !== 'yes') {
    ['ci-contact', 'ci-contact-ph'].forEach(id => {
      if (!getFieldValue(id)) {
        errors.push(`${PREASSESS_FIELD_LABELS[id]} is required`);
        invalidIds.add(id);
      }
    });
    if (getFieldValue('ci-contact-ph') && !validatePhoneField('ci-contact-ph', errors)) {
      invalidIds.add('ci-contact-ph');
    }
  }

  if (!getFieldValue('ci-consent')) {
    errors.push('Consent is required');
    invalidIds.add('ci-consent');
  }

  [...PREASSESS_REQUIRED_FIELDS, 'ci-contact', 'ci-contact-ph', 'ci-consent'].forEach(id => {
    setFieldInvalid(id, invalidIds.has(id) && showErrors);
  });

  const btn = document.getElementById('btn-preassess-done');
  if (btn) btn.disabled = errors.length > 0;
  return { valid: errors.length === 0, errors };
}

function updatePreassessmentCompletionState() {
  validatePreassessment({ showErrors: false });
}

function initPreassessmentValidation() {
  const ids = [...PREASSESS_REQUIRED_FIELDS, 'ci-contact', 'ci-contact-ph', 'ci-consent'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    ['input', 'change', 'blur'].forEach(evt => el.addEventListener(evt, updatePreassessmentCompletionState));
  });
  document.querySelectorAll('#owner-radios input').forEach(el => {
    el.addEventListener('change', updatePreassessmentCompletionState);
  });
  updatePreassessmentCompletionState();
}

const THAI_PROVINCES = [
  ['Bangkok', 'กรุงเทพมหานคร'],
  ['Amnat Charoen', 'อำนาจเจริญ'],
  ['Ang Thong', 'อ่างทอง'],
  ['Bueng Kan', 'บึงกาฬ'],
  ['Buriram', 'บุรีรัมย์'],
  ['Chachoengsao', 'ฉะเชิงเทรา'],
  ['Chai Nat', 'ชัยนาท'],
  ['Chaiyaphum', 'ชัยภูมิ'],
  ['Chanthaburi', 'จันทบุรี'],
  ['Chiang Mai', 'เชียงใหม่'],
  ['Chiang Rai', 'เชียงราย'],
  ['Chonburi', 'ชลบุรี'],
  ['Chumphon', 'ชุมพร'],
  ['Kalasin', 'กาฬสินธุ์'],
  ['Kamphaeng Phet', 'กำแพงเพชร'],
  ['Kanchanaburi', 'กาญจนบุรี'],
  ['Khon Kaen', 'ขอนแก่น'],
  ['Krabi', 'กระบี่'],
  ['Lampang', 'ลำปาง'],
  ['Lamphun', 'ลำพูน'],
  ['Loei', 'เลย'],
  ['Lopburi', 'ลพบุรี'],
  ['Mae Hong Son', 'แม่ฮ่องสอน'],
  ['Maha Sarakham', 'มหาสารคาม'],
  ['Mukdahan', 'มุกดาหาร'],
  ['Nakhon Nayok', 'นครนายก'],
  ['Nakhon Pathom', 'นครปฐม'],
  ['Nakhon Phanom', 'นครพนม'],
  ['Nakhon Ratchasima', 'นครราชสีมา'],
  ['Nakhon Sawan', 'นครสวรรค์'],
  ['Nakhon Si Thammarat', 'นครศรีธรรมราช'],
  ['Nan', 'น่าน'],
  ['Narathiwat', 'นราธิวาส'],
  ['Nong Bua Lamphu', 'หนองบัวลำภู'],
  ['Nong Khai', 'หนองคาย'],
  ['Nonthaburi', 'นนทบุรี'],
  ['Pathum Thani', 'ปทุมธานี'],
  ['Pattani', 'ปัตตานี'],
  ['Phang Nga', 'พังงา'],
  ['Phatthalung', 'พัทลุง'],
  ['Phayao', 'พะเยา'],
  ['Phetchabun', 'เพชรบูรณ์'],
  ['Phetchaburi', 'เพชรบุรี'],
  ['Phichit', 'พิจิตร'],
  ['Phitsanulok', 'พิษณุโลก'],
  ['Phra Nakhon Si Ayutthaya', 'พระนครศรีอยุธยา'],
  ['Phrae', 'แพร่'],
  ['Phuket', 'ภูเก็ต'],
  ['Prachinburi', 'ปราจีนบุรี'],
  ['Prachuap Khiri Khan', 'ประจวบคีรีขันธ์'],
  ['Ranong', 'ระนอง'],
  ['Ratchaburi', 'ราชบุรี'],
  ['Rayong', 'ระยอง'],
  ['Roi Et', 'ร้อยเอ็ด'],
  ['Sa Kaeo', 'สระแก้ว'],
  ['Sakon Nakhon', 'สกลนคร'],
  ['Samut Prakan', 'สมุทรปราการ'],
  ['Samut Sakhon', 'สมุทรสาคร'],
  ['Samut Songkhram', 'สมุทรสงคราม'],
  ['Saraburi', 'สระบุรี'],
  ['Satun', 'สตูล'],
  ['Sing Buri', 'สิงห์บุรี'],
  ['Sisaket', 'ศรีสะเกษ'],
  ['Songkhla', 'สงขลา'],
  ['Sukhothai', 'สุโขทัย'],
  ['Suphan Buri', 'สุพรรณบุรี'],
  ['Surat Thani', 'สุราษฎร์ธานี'],
  ['Surin', 'สุรินทร์'],
  ['Tak', 'ตาก'],
  ['Trang', 'ตรัง'],
  ['Trat', 'ตราด'],
  ['Ubon Ratchathani', 'อุบลราชธานี'],
  ['Udon Thani', 'อุดรธานี'],
  ['Uthai Thani', 'อุทัยธานี'],
  ['Uttaradit', 'อุตรดิตถ์'],
  ['Yala', 'ยะลา'],
  ['Yasothon', 'ยโสธร']
].map(([en, th]) => ({ en, th }));

const PROPERTY_SUGGESTIONS = [
  { label:'12 Sukhumvit Soi 11, Wattana, Bangkok 10110', code:'10110', city:'Bangkok', propertyType:'Single House', propertyAge:'5-10 yrs' },
  { label:'111 Ari Sampan Soi 4, Samsen, Bangkok 10400', code:'10400', city:'Bangkok', propertyType:'Single House', propertyAge:'20+ yrs' },
  { label:'19 Navin Village, Sathorn, Bangkok 10500', code:'10500', city:'Bangkok', propertyType:'Townhome', propertyAge:'1-5 yrs' },
  { label:'Sukhumvit / Wattana, Bangkok 10110', code:'10110', city:'Bangkok' },
  { label:'Silom / Bang Rak, Bangkok 10500', code:'10500', city:'Bangkok' },
  { label:'Ari / Phaya Thai, Bangkok 10400', code:'10400', city:'Bangkok' },
  { label:'Lumphini / Pathum Wan, Bangkok 10330', code:'10330', city:'Bangkok' },
  { label:'Nimman, Chiang Mai 50000', code:'50000', city:'Chiang Mai' },
  { label:'Mueang Phuket, Phuket 83000', code:'83000', city:'Phuket' }
];

const PREASSESS_OPTION_TEXT = {
  'ci-proptype': {
    '': ['Please select', 'กรุณาเลือก'],
    'Single House': ['Single House', 'บ้านเดี่ยว'],
    Townhome: ['Townhome', 'ทาวน์โฮม'],
    'Twin House': ['Twin House', 'บ้านแฝด'],
    Apartment: ['Apartment', 'อพาร์ตเมนต์'],
    Condominium: ['Condominium', 'คอนโดมิเนียม'],
    Other: ['Other', 'อื่น ๆ']
  },
  'ci-propage': {
    '': ['Please select', 'กรุณาเลือก'],
    '0-5 yrs': ['0-5 yrs', '0-5 ปี'],
    '5-10 yrs': ['5-10 yrs', '5-10 ปี'],
    '10-20 yrs': ['10-20 yrs', '10-20 ปี'],
    '20+ yrs': ['20+ yrs', '20+ ปี'],
    'Not sure': ['Not sure', 'ไม่แน่ใจ']
  },
  'ci-filter': {
    '': ['Please select', 'กรุณาเลือก'],
    'Drinking water filter': ['Drinking water filter', 'เครื่องกรองน้ำดื่ม'],
    'RO system': ['RO system', 'ระบบ RO'],
    'Whole-house filter': ['Whole-house filter', 'เครื่องกรองทั้งบ้าน'],
    'Building/condo filter': ['Building/condo filter', 'เครื่องกรองอาคาร/คอนโด'],
    None: ['None', 'ไม่มี'],
    'Not sure': ['Not sure', 'ไม่แน่ใจ']
  },
  'ci-source': {
    '': ['Please select', 'กรุณาเลือก'],
    Instagram: ['Instagram', 'Instagram'],
    Facebook: ['Facebook', 'Facebook'],
    'Google Search': ['Google Search', 'Google Search'],
    'Google Maps': ['Google Maps', 'Google Maps'],
    LINE: ['LINE', 'LINE'],
    'AI recommendation': ['AI recommendation', 'คำแนะนำจาก AI'],
    'Friend / Family': ['Friend / Family', 'เพื่อน / ครอบครัว'],
    'Building / Condo': ['Building / Condo', 'อาคาร / คอนโด'],
    'Real estate agent': ['Real estate agent', 'ตัวแทนอสังหาฯ'],
    'Saw team on-site': ['Saw team on-site', 'เห็นทีมหน้างาน'],
    Other: ['Other', 'อื่น ๆ']
  }
};

const PREASSESS_CHOICE_TEXT = {
  'Adults only': ['Adults only', 'ผู้ใหญ่เท่านั้น'],
  'Child under 3': ['Child under 3', 'เด็กอายุต่ำกว่า 3 ปี'],
  'Children 3-12': ['Children 3-12', 'เด็กอายุ 3-12 ปี'],
  'Elderly family member': ['Elderly family member', 'มีผู้สูงอายุในบ้าน'],
  'Health concerns': ['Someone with allergies, sensitive skin, or health concerns', 'มีผู้แพ้ง่าย ผิวบอบบาง หรือมีข้อกังวลสุขภาพ'],
  Pets: ['Pets', 'สัตว์เลี้ยง'],
  'Taste or smell': ['Taste or smell', 'รสชาติหรือกลิ่น'],
  Chlorine: ['Chlorine', 'คลอรีน'],
  'Heavy metals': ['Heavy metals or contaminants', 'โลหะหนักหรือสิ่งปนเปื้อน'],
  Bacteria: ['Bacteria / safety for drinking', 'แบคทีเรีย / ความปลอดภัยในการดื่ม'],
  'Hard water': ['Hard water / scale on fixtures', 'น้ำกระด้าง / คราบหินปูน'],
  'Skin or hair': ['Skin or hair issues', 'ปัญหาผิวหรือเส้นผม'],
  'Appliance damage': ['Appliance damage', 'ความเสียหายต่อเครื่องใช้'],
  'Not sure': ['Not sure - just want to know', 'ไม่แน่ใจ - ต้องการตรวจสอบ']
};

const DEFAULT_POSTAL_CODES = {
  Bangkok: '10110',
  'Amnat Charoen': '37000',
  'Ang Thong': '14000',
  'Bueng Kan': '38000',
  Buriram: '31000',
  Chachoengsao: '24000',
  'Chai Nat': '17000',
  Chaiyaphum: '36000',
  Chanthaburi: '22000',
  'Chiang Mai': '50000',
  'Chiang Rai': '57000',
  Chonburi: '20000',
  Chumphon: '86000',
  Kalasin: '46000',
  'Kamphaeng Phet': '62000',
  Kanchanaburi: '71000',
  'Khon Kaen': '40000',
  Krabi: '81000',
  Lampang: '52000',
  Lamphun: '51000',
  Loei: '42000',
  Lopburi: '15000',
  'Mae Hong Son': '58000',
  'Maha Sarakham': '44000',
  Mukdahan: '49000',
  'Nakhon Nayok': '26000',
  'Nakhon Pathom': '73000',
  'Nakhon Phanom': '48000',
  'Nakhon Ratchasima': '30000',
  'Nakhon Sawan': '60000',
  'Nakhon Si Thammarat': '80000',
  Nan: '55000',
  Narathiwat: '96000',
  'Nong Bua Lamphu': '39000',
  'Nong Khai': '43000',
  Nonthaburi: '11000',
  'Pathum Thani': '12000',
  Pattani: '94000',
  'Phang Nga': '82000',
  Phatthalung: '93000',
  Phayao: '56000',
  Phetchabun: '67000',
  Phetchaburi: '76000',
  Phichit: '66000',
  Phitsanulok: '65000',
  'Phra Nakhon Si Ayutthaya': '13000',
  Phrae: '54000',
  Phuket: '83000',
  Prachinburi: '25000',
  'Prachuap Khiri Khan': '77000',
  Ranong: '85000',
  Ratchaburi: '70000',
  Rayong: '21000',
  'Roi Et': '45000',
  'Sa Kaeo': '27000',
  'Sakon Nakhon': '47000',
  'Samut Prakan': '10270',
  'Samut Sakhon': '74000',
  'Samut Songkhram': '75000',
  Saraburi: '18000',
  Satun: '91000',
  'Sing Buri': '16000',
  Sisaket: '33000',
  Songkhla: '90000',
  Sukhothai: '64000',
  'Suphan Buri': '72000',
  'Surat Thani': '84000',
  Surin: '32000',
  Tak: '63000',
  Trang: '92000',
  Trat: '23000',
  'Ubon Ratchathani': '34000',
  'Udon Thani': '41000',
  'Uthai Thani': '61000',
  Uttaradit: '53000',
  Yala: '95000',
  Yasothon: '35000'
};

function normalisePropertyText(value) {
  return (value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function provinceName(en) {
  const province = THAI_PROVINCES.find(p => p.en === en || p.th === en);
  if (!province) return en || '';
  return S.lang === 'th' ? province.th : province.en;
}

function setProvinceValue(value) {
  const el = document.getElementById('ci-city');
  if (!el) return;
  const province = THAI_PROVINCES.find(p => p.en === value || p.th === value) || THAI_PROVINCES[0];
  el.value = province.en;
  document.getElementById('province-display')?.replaceChildren(document.createTextNode(provinceName(province.en)));
}

function setPostalForProvince(provinceEn, force = false) {
  const postal = document.getElementById('ci-postal');
  if (!postal) return;
  const code = DEFAULT_POSTAL_CODES[provinceEn] || POSTAL_DATA.find(item => item.city === provinceEn)?.code || '';
  if (code && (force || !postal.value.trim())) postal.value = code;
}

function updateProvinceOptions() {
  const el = document.getElementById('ci-city');
  const menu = document.getElementById('province-menu');
  if (!el) return;
  const current = el.value || 'Bangkok';
  setProvinceValue(current);
  if (!menu) return;
  menu.innerHTML = THAI_PROVINCES.map(p => `
    <button class="province-option${p.en === el.value ? ' sel' : ''}" type="button" onclick="selectProvince('${p.en.replace(/'/g, '\\\'')}')">
      <span class="province-option-main">${S.lang === 'th' ? p.th : p.en}</span>
      <span class="province-option-sub">${DEFAULT_POSTAL_CODES[p.en] || ''}</span>
    </button>
  `).join('');
}

function toggleProvincePicker() {
  const picker = document.getElementById('province-picker');
  const menu = document.getElementById('province-menu');
  if (!picker || !menu) return;
  updateProvinceOptions();
  picker.classList.toggle('open');
  menu.classList.toggle('hidden');
}

function closeProvincePicker() {
  document.getElementById('province-picker')?.classList.remove('open');
  document.getElementById('province-menu')?.classList.add('hidden');
}

function selectProvince(provinceEn) {
  setProvinceValue(provinceEn);
  setPostalForProvince(provinceEn, true);
  closeProvincePicker();
  suggestProperty();
  updatePreassessmentCompletionState();
}

function updatePreassessmentOptionText() {
  Object.entries(PREASSESS_OPTION_TEXT).forEach(([id, map]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const idx = S.lang === 'th' ? 1 : 0;
    [...el.options].forEach(option => {
      const key = option.getAttribute('value') ?? '';
      const text = map[key];
      if (text) option.textContent = text[idx];
    });
  });

  document.querySelectorAll('.ms-value.ms-placeholder').forEach(el => {
    el.textContent = t('preassess.selectPh');
  });

  document.querySelectorAll('.ms-opt input[type=checkbox]').forEach(input => {
    const label = input.closest('.ms-opt');
    const text = PREASSESS_CHOICE_TEXT[input.value];
    if (!label || !text) return;
    [...label.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    });
    label.append(document.createTextNode(` ${S.lang === 'th' ? text[1] : text[0]}`));
  });
}

function preassessChoiceLabel(value) {
  const text = PREASSESS_CHOICE_TEXT[value];
  return text ? (S.lang === 'th' ? text[1] : text[0]) : value;
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

  const label = normalisePropertyText([item.label, item.labelTh, item.city, item.propertyType, item.propertyAge].filter(Boolean).join(' '));
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

  const label = S.lang === 'th' && match.labelTh ? match.labelTh : match.label;
  const area = label.replace(match.code, '').replace(/^[\s,./-]+/, '').trim();
  const meta = [provinceName(match.city), match.propertyType, match.propertyAge].filter(Boolean).join(' - ');
  bar.innerHTML = `
    <div class="ps-copy">
      <div class="ps-title">${S.lang === 'th' ? 'แนะนำข้อมูลสถานที่' : 'Suggested property details'}</div>
      <div class="ps-sub">${match.code} ${area}${meta ? ' - ' + meta : ''}</div>
    </div>
    <button class="ps-dismiss" type="button" onclick="dismissPropertySuggestion()" aria-label="Dismiss">x</button>
    <button class="ps-use" type="button" onclick="applyPropertySuggestion()">${S.lang === 'th' ? 'ใช้ข้อมูลนี้' : 'Use'}</button>
  `;
  bar.classList.remove('hidden');
}

function suggestProperty() {
  const query = getPropertyQuery();
  const selectedCity = document.getElementById('ci-city')?.value || 'Bangkok';
  const candidates = [...PROPERTY_SUGGESTIONS, ...POSTAL_DATA.map(item => ({ ...item, city:item.city || selectedCity }))];
  const best = candidates
    .map(item => ({ ...item, score: scorePropertyMatch(item, query) }))
    .sort((a, b) => b.score - a.score)[0];

  renderPropertySuggestion(best && best.score >= 4 ? best : null);
}

function filterPostal(q) {
  const dd = document.getElementById('postal-dropdown');
  if (!dd) return;
  if (!q || q.length < 2) { dd.classList.add('hidden'); suggestProperty(); return; }

  const search = normalisePropertyText(q);
  const matches = POSTAL_DATA.filter(p => {
    const label = S.lang === 'th' ? `${p.label} ${p.labelTh || ''}` : `${p.label} ${p.labelTh || ''}`;
    return p.code.includes(q) || normalisePropertyText(label).includes(search);
  });

  if (!matches.length) { dd.classList.add('hidden'); suggestProperty(); return; }

  dd.innerHTML = matches.map(p => {
    const label = S.lang === 'th' && p.labelTh ? p.labelTh : p.label;
    const code = p.code;
    const rest = label.replace(code, '').replace(/^[\s,./-]+/, '').trim();
    const safeLabel = label.replace(/'/g, '\\\'');
    const codeDisplay = code.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'i'), '<span class="postal-match">$1</span>');
    return `<div class="postal-item" onclick="selectPostal('${safeLabel}')"><img class="postal-pin" src="${ICON.pin}" alt=""><span>${codeDisplay} <span class="postal-rest">${rest}</span></span></div>`;
  }).join('');
  dd.classList.remove('hidden');
  suggestProperty();
}

function selectPostal(label) {
  const code = (label.match(/\d{5}/) || [''])[0];
  const match = POSTAL_DATA.find(p => p.label === label || p.labelTh === label || p.code === code);
  document.getElementById('ci-postal').value = code;
  document.getElementById('ci-addr').value = label;
  if (match?.city) setProvinceValue(match.city);
  document.getElementById('postal-dropdown').classList.add('hidden');
  renderPropertySuggestion(null);
  updatePreassessmentCompletionState();
}

function applyPropertySuggestion() {
  if (!propertySuggestion) return;
  setProvinceValue(propertySuggestion.city || 'Bangkok');
  document.getElementById('ci-postal').value = propertySuggestion.code;
  document.getElementById('ci-addr').value = S.lang === 'th' && propertySuggestion.labelTh ? propertySuggestion.labelTh : propertySuggestion.label;
  setSelectValue('ci-proptype', propertySuggestion.propertyType);
  setSelectValue('ci-propage', propertySuggestion.propertyAge);
  document.getElementById('postal-dropdown')?.classList.add('hidden');
  renderPropertySuggestion(null);
  updatePreassessmentCompletionState();
  showToast(S.lang === 'th' ? 'กรอกข้อมูลสถานที่แล้ว' : 'Property details filled');
}

function dismissPropertySuggestion() { renderPropertySuggestion(null); }

function setSelectValue(id, value) {
  if (!value) return;
  const el = document.getElementById(id);
  if (!el) return;
  const option = [...el.options].find(opt => opt.value === value || normalisePropertyText(opt.textContent) === normalisePropertyText(value));
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
  valEl.innerHTML = checked.map(v => `<span class="ms-tag">${preassessChoiceLabel(v)}</span>`).join('');
}

function initMultiSelect() {
  document.querySelectorAll('.ms-wrap').forEach(wrap => {
    const max = parseInt(wrap.dataset.max || '0', 10);
    wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.onchange = () => {
        const checked = wrap.querySelectorAll('input:checked');
        if (max && checked.length > max) {
          cb.checked = false;
          showToast(S.lang === 'th' ? `เลือกได้สูงสุด ${max} รายการ` : `Select up to ${max}`);
          return;
        }
        updateMsDisplay(wrap.id);
        updatePreassessmentCompletionState();
      };
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.ms-wrap')) document.querySelectorAll('.ms-menu').forEach(m => m.classList.add('hidden'));
    if (!e.target.closest('.postal-wrap')) document.getElementById('postal-dropdown')?.classList.add('hidden');
    if (!e.target.closest('.province-picker')) closeProvincePicker();
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
      updatePreassessmentCompletionState();
    };
  });
}

function initChipGroups() {
  initMultiSelect();
  updateProvinceOptions();
  setPostalForProvince(document.getElementById('ci-city')?.value || 'Bangkok', false);
  updatePreassessmentOptionText();
}
