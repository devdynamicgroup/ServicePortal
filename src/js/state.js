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
  scoreDetail: {},
  googleReviewUrl: 'https://g.page/r/Ce0EFhVtUyRpEAE/review'
};

const KTB_LOGO = 'src/assets/ktb-logo.png';
const POSTAL_DATA = [
  { label:'Khlong Tan Nuea, Watthana, Bangkok 10110', labelTh:'คลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110', code:'10110', city:'Bangkok' },
  { label:'Khlong Tan, Khlong Toei, Bangkok 10110', labelTh:'คลองเตย เขตคลองเตย กรุงเทพมหานคร 10110', code:'10110', city:'Bangkok' },
  { label:'Silom, Bang Rak, Bangkok 10500', labelTh:'สีลม เขตบางรัก กรุงเทพมหานคร 10500', code:'10500', city:'Bangkok' },
  { label:'Lumphini, Pathum Wan, Bangkok 10330', labelTh:'ลุมพินี เขตปทุมวัน กรุงเทพมหานคร 10330', code:'10330', city:'Bangkok' },
  { label:'Ari, Phaya Thai, Bangkok 10400', labelTh:'อารีย์ เขตพญาไท กรุงเทพมหานคร 10400', code:'10400', city:'Bangkok' },
  { label:'Mueang Chiang Mai, Chiang Mai 50000', labelTh:'เมืองเชียงใหม่ จังหวัดเชียงใหม่ 50000', code:'50000', city:'Chiang Mai' },
  { label:'Mueang Phuket, Phuket 83000', labelTh:'เมืองภูเก็ต จังหวัดภูเก็ต 83000', code:'83000', city:'Phuket' },
  { label:'Mueang Chonburi, Chonburi 20000', labelTh:'เมืองชลบุรี จังหวัดชลบุรี 20000', code:'20000', city:'Chonburi' },
  { label:'Mueang Nonthaburi, Nonthaburi 11000', labelTh:'เมืองนนทบุรี จังหวัดนนทบุรี 11000', code:'11000', city:'Nonthaburi' },
  { label:'Mueang Pathum Thani, Pathum Thani 12000', labelTh:'เมืองปทุมธานี จังหวัดปทุมธานี 12000', code:'12000', city:'Pathum Thani' },
  { label:'Mueang Samut Prakan, Samut Prakan 10270', labelTh:'เมืองสมุทรปราการ จังหวัดสมุทรปราการ 10270', code:'10270', city:'Samut Prakan' },
  { label:'Pak Kret, Nonthaburi 11000', labelTh:'ปากเกร็ด นนทบุรี 11000', code:'11000', city:'Nonthaburi' },
  { label:'Mueang Pathum Thani, Pathum Thani 12000', labelTh:'เมืองปทุมธานี ปทุมธานี 12000', code:'12000', city:'Pathum Thani' },
  { label:'Nakhon Pathom, Nakhon Pathom 73000', labelTh:'นครปฐม นครปฐม 73000', code:'73000', city:'Nakhon Pathom' }
];
const JOBS = [
  { id:1, name:'Saranya C.', addr:'12 Sukhumvit Soi 11, Wattana', timeStart:'9:00AM', timeEnd:'10:00AM', day:0, pkg:'essential', status:'in_progress', meta:'Single house - 5-10 yrs - Owner present' },
  { id:2, name:'Vasinee K.', addr:'111 Ari Sampan Soi 4, Samsen', timeStart:'11:00AM', timeEnd:'12:00PM', day:0, pkg:'essential', status:'new', meta:'Single house - 20+ yrs - Owner present' },
  { id:3, name:'Maetud T.', addr:'19 Navin Village, Sathorn', timeStart:'2:00PM', timeEnd:'3:00PM', day:0, pkg:'full', status:'new', meta:'Townhome - 1-5 yrs - Owner away', contact:'K.Fon' },
];
