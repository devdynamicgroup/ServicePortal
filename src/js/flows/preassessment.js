function sendClientLink() {
  const jobId = S.activeJob?.id || S.activeJob?.notionId || 'new';
  const link = `${window.location.origin}${window.location.pathname}?preassessment=${jobId}`;
  const title = t('preassess.sendLinkTitle');
  const actions = [
    {
      label: t('preassess.sendLine'),
      fn: async () => {
        closeActionSheet();
        if (navigator.share) {
          await navigator.share({ title: 'Water Motion pre-assessment', text: 'Please complete this form before the visit.', url: link }).catch(() => {});
        } else {
          window.open(`https://line.me/R/msg/text/?${encodeURIComponent(link)}`, '_blank');
        }
        showToast(t('preassess.sendLineReady'));
      }
    },
    {
      label: t('preassess.copyLink'),
      fn: async () => {
        closeActionSheet();
        await navigator.clipboard?.writeText(link).catch(() => {});
        showToast(t('preassess.linkCopied'));
      }
    }
  ];
  document.getElementById('action-sheet-title').textContent = title;
  document.getElementById('action-sheet-actions').innerHTML = actions.map(a => `<button class="modal-action" type="button">${a.label}</button>`).join('');
  document.getElementById('action-sheet-actions').querySelectorAll('.modal-action').forEach((btn, i) => btn.onclick = actions[i].fn);
  document.getElementById('action-sheet-overlay').classList.remove('hidden');
}

let propertySuggestion = null;

const PREASSESS_REQUIRED_FIELDS = [
  'ci-fname', 'ci-lname',
  'ci-city', 'ci-addr', 'ci-proptype', 'ci-propage',
  'ci-filter', 'ci-source'
];

const PREASSESS_SELECT_IDS = new Set(['ci-proptype', 'ci-propage', 'ci-filter', 'ci-source']);

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

// A customer typing their number in international format (+66812345678 or
// 66812345678) used to fail validation outright -- the field only ever
// recognized the domestic 0xxxxxxxxx shape it displays as a placeholder.
// Rewrite the +66/66 prefix to the leading 0 this form already expects,
// rather than teaching validation a second accepted shape.
function normalizeThaiPhoneDigits(rawValue) {
  const digits = digitsOnly(rawValue);
  if (digits.length === 13 && digits.startsWith('0066')) {
    return `0${digits.slice(4)}`;
  }
  if (digits.length === 11 && digits.startsWith('66')) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  if (el.tagName === 'SELECT') {
    const selected = [...el.options].find(option => option.selected);
    return (el.value || selected?.value || selected?.textContent || S.activeJob?.draft?.fields?.[id] || '').trim();
  }
  if (id === 'ci-phone' || id === 'ci-contact-ph') return normalizeThaiPhoneDigits(el.value);
  if (id === 'ci-city') return (el.value || 'Bangkok').trim();
  return (el.value || S.activeJob?.draft?.fields?.[id] || '').trim();
}

function isEmptyFieldValue(id, value) {
  if (value === false || value === 0) return false;
  if (!value) return true;
  if (PREASSESS_SELECT_IDS.has(id)) return !value || value === 'Please select' || value === 'กรุณาเลือก';
  return false;
}

function preassessFieldLabel(id) {
  const map = {
    'ci-fname': 'preassess.fname',
    'ci-lname': 'preassess.lname',
    'ci-phone': 'preassess.phone',
    'ci-line': 'preassess.line',
    'ci-email': 'preassess.email',
    'ci-city': 'preassess.city',
    'ci-postal': 'preassess.postal',
    'ci-addr': 'preassess.addr',
    'ci-proptype': 'preassess.proptype',
    'ci-propage': 'preassess.propage',
    'ci-filter': 'preassess.filter',
    'ci-source': 'preassess.source',
    'ci-contact': 'preassess.contact'
  };
  const key = map[id];
  return key && typeof t === 'function' ? t(key) : (PREASSESS_FIELD_LABELS[id] || id);
}

function setFieldInvalid(id, invalid) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('invalid', invalid);
  const wrap = el.closest('.field')
    || el.closest('.province-picker')?.closest('.field')
    || el.closest('.consent-label');
  wrap?.classList.toggle('field-invalid', invalid);
}

function validatePhoneField(id, errors) {
  const digits = digitsOnly(getFieldValue(id));
  if (!digits) {
    errors.push(typeof t === 'function' ? t('preassess.err.phoneRequired') : `${PREASSESS_FIELD_LABELS[id]} is required`);
    return false;
  }
  if (digits.length !== 10) {
    errors.push(typeof t === 'function' ? t('preassess.err.phoneExact') : 'Mobile number must be exactly 10 digits');
    return false;
  }
  return true;
}

function validateLineId(value) {
  const text = (value || '').trim();
  if (!text) return true;
  return text.length <= 50;
}

function validatePreassessment({ showErrors = true } = {}) {
  const errors = [];
  const invalidIds = new Set();

  PREASSESS_REQUIRED_FIELDS.forEach(id => {
    const value = getFieldValue(id);
    if (isEmptyFieldValue(id, value)) {
      errors.push(`${preassessFieldLabel(id)} — ${t('preassess.err.isRequired')}`);
      invalidIds.add(id);
    }
  });

  if (!validatePhoneField('ci-phone', errors)) invalidIds.add('ci-phone');

  const lineId = getFieldValue('ci-line');
  if (lineId && !validateLineId(lineId)) {
    errors.push(typeof t === 'function' ? t('preassess.err.lineIdLong') : 'LINE ID is too long');
    invalidIds.add('ci-line');
  }

  const email = getFieldValue('ci-email').toLowerCase();
  if (!email) {
    errors.push(`${preassessFieldLabel('ci-email')} — ${t('preassess.err.isRequired')}`);
    invalidIds.add('ci-email');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(typeof t === 'function' ? t('preassess.err.email') : 'Email format is invalid');
    invalidIds.add('ci-email');
  }

  const postal = digitsOnly(getFieldValue('ci-postal'));
  if (postal && postal.length !== 5) {
    errors.push(typeof t === 'function' ? t('preassess.err.postal') : 'Postal code must be 5 digits');
    invalidIds.add('ci-postal');
  }

  const owner = document.querySelector('#owner-radios input:checked')?.value || 'yes';
  if (owner !== 'yes') {
    ['ci-contact', 'ci-contact-ph'].forEach(id => {
      if (!getFieldValue(id)) {
        errors.push(`${preassessFieldLabel(id)} — ${t('preassess.err.isRequired')}`);
        invalidIds.add(id);
      }
    });
    if (getFieldValue('ci-contact-ph') && !validatePhoneField('ci-contact-ph', errors)) {
      invalidIds.add('ci-contact-ph');
    }
  }

  if (!getFieldValue('ci-consent')) {
    errors.push(typeof t === 'function' ? t('preassess.err.consent') : 'Consent is required');
    invalidIds.add('ci-consent');
  }

  const trackedIds = [...PREASSESS_REQUIRED_FIELDS, 'ci-phone', 'ci-email', 'ci-line', 'ci-postal', 'ci-contact', 'ci-contact-ph', 'ci-consent'];
  trackedIds.forEach(id => setFieldInvalid(id, showErrors && invalidIds.has(id)));

  const btn = document.getElementById('btn-preassess-done');
  if (btn) btn.disabled = false;
  return { valid: errors.length === 0, errors, invalidIds };
}

function updatePreassessmentCompletionState() {
  validatePreassessment({ showErrors: true });
}

function initPreassessmentValidation() {
  const ids = ['ci-fname', 'ci-lname', 'ci-phone', 'ci-email', 'ci-line', 'ci-postal', ...PREASSESS_REQUIRED_FIELDS, 'ci-contact', 'ci-contact-ph', 'ci-consent'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    ['input', 'change', 'blur'].forEach(evt => el.addEventListener(evt, () => {
      // markContactFieldDirtyIfChanged only stamps when the value actually
      // differs from what was last loaded -- firing on blur too is harmless,
      // it just no-ops when nothing changed since baseline.
      if (typeof markContactFieldDirtyIfChanged === 'function') {
        markContactFieldDirtyIfChanged(id, typeof readField === 'function' ? readField(id) : el.value);
      }
      updatePreassessmentCompletionState();
    }));
  });
  ['ci-phone', 'ci-contact-ph'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      // Truncating to 10 raw digits on every keystroke (the original behavior)
      // silently mangled an international-format number before there were
      // ever enough digits typed to recognize the 66-prefix -- normalize
      // first, then cap, so +66/66-prefixed input still lands on the correct
      // domestic 0xxxxxxxxx form instead of a truncated garbage string.
      const digits = normalizeThaiPhoneDigits(el.value).slice(0, 10);
      if (el.value !== digits) el.value = digits;
      updatePreassessmentCompletionState();
    });
  });
  document.querySelectorAll('#owner-radios input').forEach(el => {
    el.addEventListener('change', updatePreassessmentCompletionState);
  });
  const consent = document.getElementById('ci-consent');
  if (consent) consent.addEventListener('change', updatePreassessmentCompletionState);
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

const SERVICE_PROVINCES = ['Bangkok', 'Nonthaburi', 'Pathum Thani', 'Samut Prakan', 'Nakhon Pathom', 'Samut Sakhon', 'Samut Songkhram'];
const METRO_CITIES = new Set(SERVICE_PROVINCES);

let googlePlacesAutocomplete = null;
let googleMapsReady = false;
let addressSearchTimer = null;
let addressSearchSeq = 0;

function serviceProvinces() {
  return THAI_PROVINCES.filter(p => SERVICE_PROVINCES.includes(p.en));
}

const PROPERTY_SUGGESTIONS = [
  { label:'12 Sukhumvit Soi 11, Wattana, Bangkok 10110', code:'10110', city:'Bangkok', propertyType:'Single House', propertyAge:'5-10 yrs' },
  { label:'111 Ari Sampan Soi 4, Samsen, Bangkok 10400', code:'10400', city:'Bangkok', propertyType:'Single House', propertyAge:'20+ yrs' },
  { label:'19 Navin Village, Sathorn, Bangkok 10500', code:'10500', city:'Bangkok', propertyType:'Townhome', propertyAge:'1-5 yrs' },
  { label:'Sukhumvit / Wattana, Bangkok 10110', code:'10110', city:'Bangkok' },
  { label:'Silom / Bang Rak, Bangkok 10500', code:'10500', city:'Bangkok' },
  { label:'Ari / Phaya Thai, Bangkok 10400', code:'10400', city:'Bangkok' },
  { label:'Lumphini / Pathum Wan, Bangkok 10330', code:'10330', city:'Bangkok' },
  { label:'Thonglor, Watthana, Bangkok 10110', code:'10110', city:'Bangkok' },
  { label:'On Nut, Suan Luang, Bangkok 10250', code:'10250', city:'Bangkok' },
  { label:'Bang Na, Bangkok 10260', code:'10260', city:'Bangkok' },
  { label:'Pak Kret, Nonthaburi 11000', code:'11000', city:'Nonthaburi' },
  { label:'Mueang Pathum Thani, Pathum Thani 12000', code:'12000', city:'Pathum Thani' },
  { label:'Mueang Samut Prakan, Samut Prakan 10270', code:'10270', city:'Samut Prakan' },
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

const METRO_POSTAL_CODES = {
  Bangkok: '10110',
  Nonthaburi: '11000',
  'Pathum Thani': '12000',
  'Samut Prakan': '10270',
  'Nakhon Pathom': '73000',
  'Samut Sakhon': '74000',
  'Samut Songkhram': '75000'
};

function getSelectedProvince() {
  return document.getElementById('ci-city')?.value || 'Bangkok';
}

function extractPostalCode(label, code) {
  if (code && /^\d{5}$/.test(String(code))) return String(code);
  const match = String(label || '').match(/\b(\d{5})\b/);
  return match ? match[1] : '';
}

function normalisePropertyText(value) {
  return (value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function metroProvinceLabel() {
  return typeof t === 'function' ? t('preassess.metro') : 'Bangkok & Vicinity';
}

function provinceName(en) {
  const province = THAI_PROVINCES.find(p => p.en === en || p.th === en);
  if (!province) return en || 'Bangkok';
  return S.lang === 'th' ? province.th : province.en;
}

function setProvinceValue(value) {
  const el = document.getElementById('ci-city');
  if (!el) return;
  const metroCity = METRO_CITIES.has(value) ? value : 'Bangkok';
  el.value = metroCity;
  const display = document.getElementById('province-display');
  if (display) display.textContent = provinceName(metroCity);
}

function setPostalForProvince(provinceEn, force = false) {
  const postal = document.getElementById('ci-postal');
  if (!postal) return;
  const code = METRO_POSTAL_CODES[provinceEn] || DEFAULT_POSTAL_CODES[provinceEn] || POSTAL_DATA.find(item => item.city === provinceEn)?.code || '';
  if (code && (force || !postal.value.trim())) postal.value = code;
}

function updateProvinceOptions() {
  const el = document.getElementById('ci-city');
  const menu = document.getElementById('province-menu');
  if (!el) return;
  setProvinceValue(el.value || 'Bangkok');
  if (!menu) return;
  menu.innerHTML = serviceProvinces().map(p => `
    <button class="province-option${p.en === el.value ? ' sel' : ''}" type="button" onclick="selectProvince('${p.en.replace(/'/g, '\\\'')}')">
      <span class="province-option-main">${S.lang === 'th' ? p.th : p.en}</span>
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
  if (!SERVICE_PROVINCES.includes(provinceEn)) provinceEn = 'Bangkok';
  setProvinceValue(provinceEn);
  setPostalForProvince(provinceEn, true);
  closeProvincePicker();
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

  if (label.includes(q)) score += 12;
  if (code.startsWith(q)) score += 10;

  q.split(' ').filter(Boolean).forEach(part => {
    if (part.length < 1) return;
    if (code.startsWith(part)) score += 6;
    else if (code.includes(part)) score += 4;
    if (label.includes(part)) score += 4;
  });

  return score;
}

function renderPropertySuggestion(match) {
  const bar = document.getElementById('property-suggest-bar');
  if (!bar) return;

  propertySuggestion = match || null;
  bar.classList.add('hidden');
  bar.innerHTML = '';
}

function suggestProperty() {}

function addressSuggestionPool() {
  const province = getSelectedProvince();
  const fromPostal = POSTAL_DATA
    .filter(p => p.city === province)
    .map(p => ({ label: p.label, labelTh: p.labelTh, code: p.code, city: p.city }));
  return [...PROPERTY_SUGGESTIONS, ...fromPostal]
    .filter(item => !item.city || item.city === province);
}

function localAddressMatches(query) {
  const q = normalisePropertyText(query);
  if (q.length < 2) return [];
  const parts = q.split(' ').filter(Boolean);
  return addressSuggestionPool()
    .map(item => {
      const label = normalisePropertyText([item.label, item.labelTh, item.city].filter(Boolean).join(' '));
      const code = item.code || '';
      let score = scorePropertyMatch(item, query);
      if (label.includes(q)) score = Math.max(score, 12);
      if (code.includes(q)) score = Math.max(score, 10);
      parts.forEach(part => {
        if (part.length >= 2 && (label.includes(part) || code.includes(part))) score = Math.max(score, 5);
      });
      return { item, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(entry => entry.item);
}

let lastAddressResults = [];

function renderAddressDropdown(items, options = {}) {
  const dd = document.getElementById('address-dropdown');
  if (!dd) return;
  if (options.loading && !items.length) {
    dd.innerHTML = `<div class="postal-item postal-loading"><span class="postal-rest">${S.lang === 'th' ? 'กำลังค้นหา...' : 'Searching...'}</span></div>`;
    dd.classList.remove('hidden');
    return;
  }
  const list = items.length ? items : (options.keepPrevious ? lastAddressResults : []);
  if (!list.length) {
    dd.classList.add('hidden');
    return;
  }
  lastAddressResults = list;
  dd.innerHTML = list.map(item => {
    const label = S.lang === 'th' && item.labelTh ? item.labelTh : item.label;
    const safeLabel = (label || '').replace(/'/g, '\\\'');
    const safeCity = (item.city || getSelectedProvince()).replace(/'/g, '\\\'');
    const safeCode = (item.code || extractPostalCode(label, '')).replace(/'/g, '\\\'');
    return `<div class="postal-item" onmousedown="event.preventDefault();selectAddressSuggestion('${safeLabel}','${safeCode}','${safeCity}')"><img class="postal-pin" src="${ICON.pin}" alt=""><span class="postal-rest">${label}</span></div>`;
  }).join('');
  dd.classList.remove('hidden');
}

function filterAddressSuggest(query) {
  const q = (query || '').trim();
  clearTimeout(addressSearchTimer);
  if (q.length < 2) {
    lastAddressResults = [];
    document.getElementById('address-dropdown')?.classList.add('hidden');
    return;
  }

  const local = localAddressMatches(q);
  renderAddressDropdown(local, { keepPrevious: false, loading: !local.length });
  addressSearchTimer = setTimeout(() => searchAddressSuggestions(q), 220);
}

async function searchAddressSuggestions(query) {
  const seq = ++addressSearchSeq;
  const q = (query || '').trim();
  if (q.length < 2) return;

  const merged = new Map();
  const province = getSelectedProvince();

  try {
    const res = await fetch(`/api/address-search?q=${encodeURIComponent(q)}&province=${encodeURIComponent(province)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Address search failed');
    const remote = await res.json();
    if (seq !== addressSearchSeq) return;
    (Array.isArray(remote) ? remote : []).forEach(item => {
      if (item?.label) merged.set(item.label, item);
    });
  } catch (error) {
    console.warn('Online address search unavailable', error);
  }

  localAddressMatches(q).forEach(item => {
    if (!merged.has(item.label)) merged.set(item.label, item);
  });

  if (seq !== addressSearchSeq) return;
  const input = document.getElementById('ci-addr');
  if (!input || input.value.trim() !== q) return;
  renderAddressDropdown([...merged.values()].slice(0, 8), { keepPrevious: false });
}

function selectAddressSuggestion(label, code, city) {
  const addr = document.getElementById('ci-addr');
  if (addr) addr.value = label;

  const province = city && METRO_CITIES.has(city) ? city : getSelectedProvince();
  setProvinceValue(province);
  setPostalForProvince(province, true);

  const postalCode = extractPostalCode(label, code);
  const postal = document.getElementById('ci-postal');
  if (postal && postalCode) postal.value = postalCode;

  document.getElementById('address-dropdown')?.classList.add('hidden');
  updatePreassessmentCompletionState();
}

function filterPostal() {}

function applyPropertySuggestion() {
  if (!propertySuggestion) return;
  setProvinceValue(propertySuggestion.city || 'Bangkok');
  document.getElementById('ci-postal').value = propertySuggestion.code;
  document.getElementById('ci-addr').value = S.lang === 'th' && propertySuggestion.labelTh ? propertySuggestion.labelTh : propertySuggestion.label;
  setSelectValue('ci-proptype', propertySuggestion.propertyType);
  setSelectValue('ci-propage', propertySuggestion.propertyAge);
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

let dropdownHideTimer = null;

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
  document.addEventListener('mousedown', e => {
    if (e.target.closest('.postal-item')) return;
    if (!e.target.closest('.postal-wrap')) {
      clearTimeout(dropdownHideTimer);
      dropdownHideTimer = setTimeout(() => {
        document.getElementById('address-dropdown')?.classList.add('hidden');
      }, 180);
    } else {
      clearTimeout(dropdownHideTimer);
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.ms-wrap')) document.querySelectorAll('.ms-menu').forEach(m => m.classList.add('hidden'));
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
  initAddressAutocomplete();
  initMapsLinkField();
}

function loadGoogleMapsScript(apiKey, lang) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }
    const existing = document.getElementById('google-maps-sdk');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-maps-sdk';
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=${lang === 'th' ? 'th' : 'en'}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
}

function applyGooglePlaceSelection(place) {
  const addr = document.getElementById('ci-addr');
  const postal = document.getElementById('ci-postal');
  const maps = document.getElementById('ci-maps');
  if (addr && place.formatted_address) addr.value = place.formatted_address;
  const postalComp = place.address_components?.find(c => c.types.includes('postal_code'));
  if (postal && postalComp) postal.value = postalComp.long_name;
  if (maps && place.geometry?.location) {
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    maps.value = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  setProvinceValue('Bangkok');
  document.getElementById('address-dropdown')?.classList.add('hidden');
  updatePreassessmentCompletionState();
}

/** Pure link builder -- single source of truth for the ci-maps URL format. */
function buildMapsSearchLink(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * A named-place link (Google's own documented "Place Search" URL scheme --
 * https://developers.google.com/maps/documentation/urls/get-started#search-action).
 * Opens exactly like a normal Google Maps search result (place card, name,
 * photo) instead of a bare coordinate pin. Used whenever a real place is
 * known (search selection); coordinate-only links (GPS, map click/drag)
 * fall back to buildMapsSearchLink() since there's no name to show there.
 */
function buildMapsPlaceLink(address, placeId) {
  const trimmed = String(address || '').trim();
  if (!trimmed) return '';
  const base = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
  const pid = String(placeId || '').trim();
  return pid ? `${base}&query_place_id=${encodeURIComponent(pid)}` : base;
}

/**
 * Parse an existing ci-maps value (pasted, or previously generated by this
 * form) back into coordinates, so re-opening a Case with a link already
 * set can still center the picker map on the right spot. Returns null for
 * anything that isn't a recognizable "query=lat,lng" link -- never guesses.
 */
function parseLatLngFromMapsLink(value) {
  const match = String(value || '').match(/[?&]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Counterpart to parseLatLngFromMapsLink() for the OTHER link shape this
 * form itself writes -- buildMapsPlaceLink()'s named-place link
 * (query=<address text>, optionally &query_place_id=<id>), which carries no
 * coordinates at all. Extracts the address/place-id text only; resolving it
 * to a pin position is geocodeMapsPlaceQuery()'s job, kept separate so this
 * stays a pure, synchronous parse -- never guesses on anything that isn't a
 * recognizable query= link, same discipline as parseLatLngFromMapsLink.
 * (2026-08-31: re-opening a Case whose ci-maps was set via place search
 * left the picker pin stuck at the Bangkok default instead of the actual
 * saved location -- this is the missing half.)
 */
function parsePlaceQueryFromMapsLink(value) {
  const str = String(value || '');
  const match = str.match(/[?&]query=([^&]+)/);
  if (!match) return null;
  let query;
  try {
    query = decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
  } catch {
    return null;
  }
  if (!query) return null;
  // A coordinate query is parseLatLngFromMapsLink's job, not this one.
  if (/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(query)) return null;
  const placeIdMatch = str.match(/[?&]query_place_id=([^&]+)/);
  let placeId = '';
  if (placeIdMatch) {
    try { placeId = decodeURIComponent(placeIdMatch[1]); } catch { placeId = ''; }
  }
  return { query, placeId };
}

/**
 * Resolves a parsePlaceQueryFromMapsLink() result to coordinates via the
 * Google Maps JS SDK's own Geocoder -- already loaded alongside `places`
 * (loadGoogleMapsScript), no new API key/endpoint. Only ever moves the
 * visible picker pin; never rewrites the ci-maps field itself, so the
 * link the user already has stays exactly as they set it. Resolves null on
 * any failure (no SDK, no match, network error) -- caller falls back to the
 * existing Bangkok default rather than guessing.
 */
function geocodeMapsPlaceQuery({ query, placeId } = {}) {
  return new Promise((resolve) => {
    if (!window.google?.maps?.Geocoder) { resolve(null); return; }
    const geocoder = new google.maps.Geocoder();
    const request = placeId ? { placeId } : { address: query };
    geocoder.geocode(request, (results, status) => {
      const loc = status === 'OK' ? results?.[0]?.geometry?.location : null;
      resolve(loc ? { lat: loc.lat(), lng: loc.lng() } : null);
    });
  });
}

// Holds the live google.maps.Map/Marker instances once the picker has been
// shown, so later updates (search selection, GPS, drag) can move the same
// map instead of re-creating it. Module-scoped, not persisted -- purely a
// UI convenience for the current form session.
let mapsPreviewState = null;

/**
 * Reverse-geocodes a coordinate to a real address via the same Geocoder
 * geocodeMapsPlaceQuery() already uses -- no new API key/endpoint. Resolves
 * null on any failure (no SDK, no match, network error).
 */
function reverseGeocodeLatLng(lat, lng) {
  return new Promise((resolve) => {
    if (!window.google?.maps?.Geocoder) { resolve(null); return; }
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      const result = status === 'OK' ? results?.[0] : null;
      resolve(result ? { address: result.formatted_address, placeId: result.place_id } : null);
    });
  });
}

/**
 * Single place that writes to ci-maps AND keeps the visible picker map in
 * sync, no matter which of the three triggers (place search, "use my
 * location", or dragging/tapping the map itself) caused the change --
 * avoids the three call sites drifting into three slightly different
 * behaviors (2026-08-25, map-picker follow-up).
 */
function setMapsLinkFromCoords(lat, lng, { recenterMap = true, address = '', placeId = '' } = {}) {
  const input = document.getElementById('ci-maps');
  if (!input || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const trimmedAddress = String(address || '').trim();
  // A named place (search selection) gets the "Place Search" link, which
  // opens looking exactly like a normal Google Maps result -- name, photo,
  // card -- not a bare coordinate pin. GPS/map-click has no name to give
  // up front, so those start with the coordinate-only link...
  const coordLink = buildMapsSearchLink(lat, lng);
  input.value = trimmedAddress ? buildMapsPlaceLink(trimmedAddress, placeId) : coordLink;
  if (recenterMap) showMapsPreview(lat, lng);
  updatePreassessmentCompletionState();

  // ...then reverse-geocode in the background and upgrade to a real place
  // link once resolved. A bare coordinate link opens Google Maps almost
  // empty (Plus Code + "Add missing place", no name/photo/info) -- staff
  // reported this looking broken (2026-09-04). Only overwrite if the field
  // still holds the coordinate link we just set, so a newer edit wins.
  if (!trimmedAddress) {
    reverseGeocodeLatLng(lat, lng).then((resolved) => {
      if (!resolved?.address || input.value !== coordLink) return;
      input.value = buildMapsPlaceLink(resolved.address, resolved.placeId);
      updatePreassessmentCompletionState();
    });
  }
}

/**
 * Shows (creating on first use) a real, draggable-pin Google Map so the
 * user can see and click/drag to set the exact spot, not just paste/search
 * a link blind. Requires the Maps JS SDK to already be loaded (via
 * wireMapsLinkPlaceSearch()) -- safe no-op otherwise, so this can be
 * called speculatively (e.g. from GPS success) without checking readiness
 * everywhere.
 */
function showMapsPreview(lat, lng) {
  if (!window.google?.maps) return;
  const container = document.getElementById('maps-preview');
  const hint = document.getElementById('maps-preview-hint');
  if (!container) return;
  hint?.classList.remove('hidden');

  if (!mapsPreviewState) {
    container.innerHTML = ''; // clear the "Loading map…" placeholder
    const map = new google.maps.Map(container, {
      center: { lat, lng },
      zoom: 16,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false
    });
    const marker = new google.maps.Marker({ position: { lat, lng }, map, draggable: true });
    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      if (pos) setMapsLinkFromCoords(pos.lat(), pos.lng(), { recenterMap: false });
    });
    map.addListener('click', (event) => {
      const pos = event.latLng;
      if (!pos) return;
      marker.setPosition(pos);
      setMapsLinkFromCoords(pos.lat(), pos.lng(), { recenterMap: false });
    });
    mapsPreviewState = { map, marker };
    return;
  }

  mapsPreviewState.map.setCenter({ lat, lng });
  mapsPreviewState.marker.setPosition({ lat, lng });
}

/**
 * Fill ci-maps only -- deliberately does NOT touch ci-addr/ci-postal like
 * applyGooglePlaceSelection() does, so searching a place in the Maps Link
 * field can never silently overwrite an address the user already typed
 * elsewhere on the form (2026-08-25, Maps Link field usability fix).
 */
function applyGooglePlaceToMapsField(place) {
  const location = place?.geometry?.location;
  if (!location) return;
  setMapsLinkFromCoords(location.lat(), location.lng(), {
    address: place.formatted_address || place.name || '',
    placeId: place.place_id || ''
  });
}

/**
 * Wires real Google Places Autocomplete onto #ci-maps (typing shows
 * Google's own suggestion dropdown; picking one fills an accurate link and
 * shows the picker map) -- loaded lazily on first focus so the SDK is
 * never fetched for a form the user doesn't touch. GOOGLE_MAPS_API_KEY /
 * /api/maps-config are the existing, already-configured infrastructure
 * this reuses unchanged.
 */
function setMapsPreviewMessage(text) {
  // Only replaces the placeholder while it's still the placeholder -- never
  // clobbers a real map that's already been created.
  if (mapsPreviewState) return;
  const placeholder = document.getElementById('maps-preview-placeholder');
  if (placeholder) placeholder.textContent = text;
}

async function wireMapsLinkPlaceSearch() {
  const input = document.getElementById('ci-maps');
  if (!input || input.dataset.placesReady) return;
  input.dataset.placesReady = 'loading';
  try {
    const configRes = await fetch('/api/maps-config', { cache: 'no-store' });
    const config = await configRes.json().catch(() => ({}));
    if (!config.apiKey) {
      input.dataset.placesReady = '';
      setMapsPreviewMessage(t('preassess.mapsUnavailable'));
      return;
    }
    await loadGoogleMapsScript(config.apiKey, S.lang);
    if (!window.google?.maps?.places) {
      input.dataset.placesReady = '';
      setMapsPreviewMessage(t('preassess.mapsUnavailable'));
      return;
    }
    const autocomplete = new google.maps.places.Autocomplete(input, { types: ['geocode', 'establishment'] });
    autocomplete.addListener('place_changed', () => {
      applyGooglePlaceToMapsField(autocomplete.getPlace());
    });
    input.dataset.placesReady = 'google';
    // Show the picker map right away, centered on an existing link if the
    // field already has one (editing a Case), otherwise a sensible default
    // (Bangkok) -- so there's always a map to click on, not just search.
    const existing = parseLatLngFromMapsLink(input.value);
    if (existing) {
      showMapsPreview(existing.lat, existing.lng);
    } else {
      const placeQuery = parsePlaceQueryFromMapsLink(input.value);
      if (placeQuery) {
        // A named-place link (query=<address>) has no coordinates to read
        // synchronously -- geocode it so the pin lands where the link
        // actually points instead of the Bangkok default (2026-08-31 fix).
        const coords = await geocodeMapsPlaceQuery(placeQuery);
        showMapsPreview(coords?.lat ?? 13.7563, coords?.lng ?? 100.5018);
      } else {
        showMapsPreview(13.7563, 100.5018);
      }
    }
  } catch (error) {
    console.warn('[preassessment] Maps Link place search unavailable', error);
    input.dataset.placesReady = '';
    setMapsPreviewMessage(t('preassess.mapsUnavailable'));
  }
}

/**
 * "Use my current location" button for the Maps Link field.
 * User-gesture-triggered only (button click) -- the browser's own
 * permission prompt is the real gate, nothing here bypasses it.
 * Coordinates are placed directly into the Maps link the user can see and
 * edit (and shown as a draggable pin); nothing is sent to Water Motion's
 * own backend from this handler.
 */
function useMyLocationForMaps() {
  const input = document.getElementById('ci-maps');
  if (!input) return;
  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
    if (typeof showToast === 'function') showToast(t('preassess.mapsLocateUnavailable'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position?.coords?.latitude;
      const lng = position?.coords?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (typeof showToast === 'function') showToast(t('preassess.mapsLocateUnavailable'));
        return;
      }
      // Ensure the Maps SDK is loading/loaded before trying to show the
      // picker map, in case the user tapped "use my location" without
      // ever focusing the text field first (showMapsPreview() itself
      // still fails safe if this doesn't finish in time).
      if (typeof wireMapsLinkPlaceSearch === 'function') await wireMapsLinkPlaceSearch();
      setMapsLinkFromCoords(lat, lng);
    },
    () => { // denied / unavailable / timeout -- all treated the same, no retry
      if (typeof showToast === 'function') showToast(t('preassess.mapsLocateUnavailable'));
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  );
}

function initMapsLinkField() {
  const btn = document.getElementById('btn-maps-locate');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', useMyLocationForMaps);
  }
  // Load eagerly (not on focus) so the map is visible below the field as
  // soon as the form opens, not only after the user interacts with it --
  // wireMapsLinkPlaceSearch() has its own placesReady guard, so this is
  // still safe to call more than once if initChipGroups() re-runs.
  wireMapsLinkPlaceSearch();
}

async function initAddressAutocomplete() {
  const input = document.getElementById('ci-addr');
  if (!input || input.dataset.placesReady) return;
  input.dataset.placesReady = 'custom';
}
