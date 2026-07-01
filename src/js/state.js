const S = {
  screen: 's-login', prev: null,
  pkg: 'essential',
  rating: 3,
  payMethod: 'cash',
  weekOffset: 0,
  selDay: new Date().getDay() === 0 ? 6 : new Date().getDay() - 1,
  activeJob: null,
  taps: ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'],
  activeTap: 0,
  tapData: null,
  searchQuery: '',
  lang: localStorage.getItem('wm-lang') || 'en',
  monthPickerDate: new Date(),
  actionJobId: null,
  scoreTapFilter: 'all',
  stepsDone: { preassess: false, assess: false, score: false, payment: false, feedback: false },
  scoreVal: null,
  scoreDetail: {}
};

const KTB_LOGO = 'src/assets/ktb-logo.png';
const CARET_RIGHT = '<img src="https://www.figma.com/api/mcp/asset/8f8f14ee-d74b-416a-b51b-d6e8ec34735b" alt="" width="16" height="16">';
const ICON = {
  camera: 'https://www.figma.com/api/mcp/asset/8cb60dca-0412-42cc-9f34-4e298132274c',
  cameraUpload: 'https://www.figma.com/api/mcp/asset/eb39453e-3204-459a-b196-cbb1fb0648d9',
  drop: 'https://www.figma.com/api/mcp/asset/a0c8402e-bd80-462d-83a0-452c06a843a8',
  info: 'https://www.figma.com/api/mcp/asset/ae04e09b-c252-464a-9bd8-567ea2f770c6',
  pin: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>')
};
const BACK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
const STEP_ICONS = {
  preassess: 'https://www.figma.com/api/mcp/asset/f620f2ed-7fed-4ee3-b634-cd41f065b118',
  assess: 'https://www.figma.com/api/mcp/asset/2b27f4ee-3807-4e2e-a003-626b01077771',
  score: 'https://www.figma.com/api/mcp/asset/a0c8402e-bd80-462d-83a0-452c06a843a8',
  payment: 'https://www.figma.com/api/mcp/asset/4732c08b-4ab7-4ad4-a251-baa7346141a9',
  feedback: 'https://www.figma.com/api/mcp/asset/bbcef7df-4008-4afb-b404-899bf4227094'
};
const POSTAL_DATA = [
  { label:'คลองตันเหนือ เขตวัฒนา 10110', code:'10110' },
  { label:'คลองตัน เขตวัฒนา 10110', code:'10110' },
  { label:'พระโขนงเหนือ เขตวัฒนา 10110', code:'10110' },
  { label:'พระโขนง เขตคลองเตย 10110', code:'10110' },
  { label:'คลองเตย เขตคลองเตย 10110', code:'10110' },
  { label:'มหาพฤฒาราม เขตบางรัก 10500', code:'10500' },
  { label:'สีลม เขตบางรัก 10500', code:'10500' },
  { label:'สุริยวงศ์ เขตบางรัก 10500', code:'10500' },
  { label:'ลุมพินี เขตปทุมวัน 10330', code:'10330' },
  { label:'ปทุมวัน เขตปทุมวัน 10330', code:'10330' },
  { label:'อารีย์ เขตพญาไท 10400', code:'10400' },
  { label:'สามเสนใน เขตพญาไท 10400', code:'10400' }
];
const JOBS = [
  { id:1, name:'Saranya C.', addr:'12 Sukhumvit Soi 11, Wattana', timeStart:'9:00AM', timeEnd:'10:00AM', day:0, pkg:'essential', status:'in_progress', meta:'Single house · 5–10 yrs · Owner–present' },
  { id:2, name:'Vasinee K.', addr:'111 Ari Sampan Soi 4, Samsen', timeStart:'11:00AM', timeEnd:'12:00PM', day:0, pkg:'essential', status:'new', meta:'Single house · 20+ yrs · Owner–present' },
  { id:3, name:'Maetud T.', addr:'19 Navin Village, Sathorn', timeStart:'2:00PM', timeEnd:'3:00PM', day:0, pkg:'full', status:'new', meta:'Townhome · 1–5 yrs · Owner–away', contact:'K.Fon' },
];

