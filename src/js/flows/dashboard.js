let weekBase = getMonday(new Date());
function getMonday(d) {
  const day = d.getDay(), diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m = new Date(d); m.setDate(diff); m.setHours(0,0,0,0); return m;
}
function shiftWeek(dir) { weekBase.setDate(weekBase.getDate() + dir*7); renderCalendar(); }

/* ── Date helpers (job.date is the source of truth) ───────────── */
// Local calendar date -> 'YYYY-MM-DD' (no timezone shift).
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Monday=0 ... Sunday=6 for a 'YYYY-MM-DD' string.
function weekdayFromIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}
// Actual date shown in calendar cell `i` of the displayed week.
function cellDate(i) {
  const d = new Date(weekBase); d.setDate(weekBase.getDate() + i);
  return formatDate(d);
}
// The real date currently selected in the dashboard.
function selectedDateIso() {
  return cellDate(S.selDay);
}
// A job belongs to a date by its real job.date. Legacy jobs (CSV/mock) that
// have no date fall back to weekday matching so they still render.
function jobMatchesDate(job, iso) {
  if (job.date) return job.date === iso;
  return job.day === weekdayFromIso(iso);
}
function jobsOnDate(iso) {
  return JOBS.filter(j => j.status !== 'cancelled' && jobMatchesDate(j, iso));
}

function addCaseForSelectedDay() {
  const dayIndex = S.selDay;
  const d = new Date(weekBase);
  d.setDate(weekBase.getDate() + dayIndex);
  const iso = formatDate(d);
  const sameDayJobs = jobsOnDate(iso);
  const maxId = JOBS.reduce((m, j) => Math.max(m, j.id), 0);
  const hour = Math.min(17, 9 + sameDayJobs.length);
  const endHour = Math.min(18, hour + 1);
  JOBS.push({
    id: maxId + 1,
    name: `New Client ${maxId + 1}`,
    addr: 'Address to confirm',
    timeStart: `${String(hour).padStart(2, '0')}:00`,
    timeEnd: `${String(endHour).padStart(2, '0')}:00`,
    day: dayIndex,
    date: iso,
    pkg: 'essential',
    status: 'new',
    meta: `Case ${sameDayJobs.length + 1} for this day · Owner-present`
  });
  ensureJobDraft(JOBS[JOBS.length - 1]);
  persistJobs();
  renderCalendar();
  showToast(`Added case for ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
}

function addNextDayAppt() {
  let dayIndex = S.selDay + 1;
  if (dayIndex > 6) {
    weekBase.setDate(weekBase.getDate() + 7);
    dayIndex = 0;
  }
  S.selDay = dayIndex;
  const d = new Date(weekBase);
  d.setDate(weekBase.getDate() + dayIndex);
  const maxId = JOBS.reduce((m, j) => Math.max(m, j.id), 0);
  JOBS.push({
    id: maxId + 1,
    name: `New Client ${maxId + 1}`,
    addr: 'Address to confirm',
    timeStart: '9:00AM',
    timeEnd: '10:00AM',
    day: dayIndex,
    date: formatDate(d),
    pkg: 'essential',
    status: 'new',
    meta: 'New appointment · Owner–present'
  });
  ensureJobDraft(JOBS[JOBS.length - 1]);
  persistJobs();
  renderCalendar();
  showToast(`Added for ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
}
function renderCalendar() {
  const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  const today = new Date(); today.setHours(0,0,0,0);
  const strip = document.getElementById('day-strip');
  strip.innerHTML = '';
  for(let i=0;i<7;i++) {
    const d = new Date(weekBase); d.setDate(weekBase.getDate()+i);
    const hasJobs = jobsOnDate(cellDate(i)).length > 0;
    const isPast = d < today;
    const isWeekend = i >= 5;
    const chip = document.createElement('div');
    let cls = 'day-chip';
    const isHoliday = i === 2 || i === 6;
    if (isHoliday) cls += ' holiday';
    if(d.getTime()===today.getTime()) cls += ' today';
    if (i === S.selDay) cls += ' sel';
    if (i !== S.selDay && (isPast || isWeekend) && !hasJobs) cls += ' muted weekend';
    chip.className = cls;
    chip.innerHTML = `<span class="dc-dow">${DOW[i]}</span><span class="dc-d">${d.getDate()}</span><span class="dc-dot"></span>`;
    if(!hasJobs && !(d.getTime()===today.getTime())) chip.querySelector('.dc-dot').style.visibility = 'hidden';
    chip.onclick = () => { S.selDay = i; renderCalendar(); };
    strip.appendChild(chip);
  }
  const d = new Date(weekBase); d.setDate(weekBase.getDate() + S.selDay);
  document.getElementById('wn-month').textContent = d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  renderJobs();
}
const PIN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const MENU_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const NOTIFICATIONS = [
  { type: 'schedule', title: 'New appointment', sub: 'Vasinee K. - Today 11:00 AM' },
  { type: 'schedule', title: 'Changed appointment', sub: 'Maetud T. rescheduled to 2:00 PM' },
  { type: 'service', title: 'Upcoming service', sub: 'Saranya C. starts in 1 hour' },
  { type: 'billing', title: 'Payment pending', sub: 'Full Assessment payment needs confirmation' }
];
let notifFilter = 'all';
function statusLabel(s) {
  if (s === 'in_progress') return t('dash.status.in_progress');
  if (s === 'overdue') return t('dash.status.overdue');
  if (s === 'done') return t('dash.status.done');
  return t('dash.status.new');
}
function renderJobs(filter) {
  const q = (filter ?? S.searchQuery).toLowerCase().trim();
  let jobs = JOBS.filter(j => jobMatchesDate(j, selectedDateIso()) && j.status !== 'cancelled');
  if(q) jobs = jobs.filter(j => j.name.toLowerCase().includes(q) || j.addr.toLowerCase().includes(q));
  const list = document.getElementById('appt-list');
  document.getElementById('appt-count').textContent = q ? `${t('dash.results')} (${jobs.length})` : t('dash.appointments');
  if (!jobs.length) {
    list.innerHTML = `<div class="appt-empty">${q ? t('dash.noMatches') : t('dash.empty')}<span class="appt-empty-hint">${t('dash.emptyHint')}</span></div>`;
    return;
  }
  list.innerHTML = jobs.map(j => `
    <div class="appt-card ${j.pkg === 'full' ? 'stripe-full' : ''}" onclick="openJob(${j.id})">
      <div class="ac-top">
        <div class="ac-left">
          <div class="ac-tags">
            <span class="tag ${j.pkg === 'full' ? 'tag-full-assessment' : 'tag-essential'}">${j.pkg === 'full' ? t('dash.pkg.full') : t('dash.pkg.essential')}</span>
            ${j.status === 'in_progress' ? `<span class="tag tag-progress">${t('dash.status.in_progress')}</span>` : ''}
          </div>
          <div class="ac-name">${j.name}</div>
        </div>
        <div class="ac-times">
          <div class="ac-time-start">${j.timeStart}</div>
          <div class="ac-time-end">${j.timeEnd}</div>
        </div>
      </div>
      <div class="ac-addr">${PIN_SVG}<span>${j.addr}</span></div>
      <div class="ac-meta">
        <span>${j.meta}${j.contact ? '<br>' + t('dash.contact') + ': ' + j.contact : ''}</span>
        <button class="ac-menu" type="button" onclick="event.stopPropagation();showApptMenu(${j.id})" aria-label="More">${MENU_SVG}</button>
      </div>
    </div>`).join('');
}

function showApptMenu(id) {
  const job = JOBS.find(j=>j.id===id);
  S.actionJobId = id;
  document.getElementById('action-sheet-title').textContent = job.name;
  const actions = [
    { label: t('dash.menu.start'), fn: () => { closeActionSheet(); openJob(id); } },
    { label: t('dash.menu.reschedule'), fn: () => { closeActionSheet(); showToast('Reschedule request sent'); } },
    { label: t('dash.menu.contact'), fn: () => { closeActionSheet(); showToast('Calling ' + job.name); } },
    { label: t('dash.menu.preassess'), fn: () => { closeActionSheet(); openJob(id); goScreen('s-preassess'); } }
  ];
  document.getElementById('action-sheet-actions').innerHTML = actions.map(a=>`<button class="modal-action" type="button">${a.label}</button>`).join('');
  document.getElementById('action-sheet-actions').querySelectorAll('.modal-action').forEach((btn,i)=>btn.onclick=actions[i].fn);
  document.getElementById('action-sheet-overlay').classList.remove('hidden');
}

function closeActionSheet(){ document.getElementById('action-sheet-overlay').classList.add('hidden'); }
function cancelCase(id = S.activeJob?.id) {
  const job = JOBS.find(j => j.id === id);
  if (!job) return;
  if (!confirm(`Cancel case for ${job.name}?`)) return;
  const index = JOBS.findIndex(j => j.id === id);
  if (index >= 0) JOBS.splice(index, 1);
  if (S.activeJob?.id === id) S.activeJob = null;
  persistJobs();
  renderCalendar();
  goScreen('s-dash');
  showToast('Case cancelled');
}
function openSearchModal(){ document.getElementById('search-overlay').classList.remove('hidden'); document.getElementById('search-input').value=S.searchQuery; document.getElementById('search-input').focus(); filterAppointments(S.searchQuery); }
function closeSearchModal(){ document.getElementById('search-overlay').classList.add('hidden'); }
function filterAppointments(q){ S.searchQuery=q; renderJobs(q); const jobs=JOBS.filter(j=>j.status!=='cancelled'&&jobMatchesDate(j,selectedDateIso())&&(j.name.toLowerCase().includes(q.toLowerCase())||j.addr.toLowerCase().includes(q.toLowerCase()))); document.getElementById('search-results').innerHTML=jobs.map(j=>`<div class="appt-card" style="margin-top:8px" onclick="closeSearchModal();openJob(${j.id})"><div class="ac-name">${j.name}</div><div class="ac-addr" style="font-size:12px;color:var(--muted)">${j.addr}</div></div>`).join('')||'<p style="color:var(--muted);font-size:14px">No matches</p>'; }
function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  document.querySelectorAll('.notif-filter-btn').forEach(btn => {
    const type = btn.dataset.type;
    const count = type === 'all' ? NOTIFICATIONS.length : NOTIFICATIONS.filter(item => item.type === type).length;
    btn.classList.toggle('sel', type === notifFilter);
    btn.textContent = `${t('notif.' + type)} (${count})`;
  });
  const items = notifFilter === 'all'
    ? NOTIFICATIONS
    : NOTIFICATIONS.filter(item => item.type === notifFilter);
  list.innerHTML = items.map(item => `
    <div class="notif-item">
      <span class="notif-type">${t('notif.type.' + item.type)}</span>
      <div class="notif-title">${item.title}</div>
      <div class="notif-sub">${item.sub}</div>
    </div>
  `).join('');
}
function setNotifFilter(type) { notifFilter = type || 'all'; renderNotifications(); }
function openNotifModal(){ notifFilter = notifFilter || 'all'; renderNotifications(); document.getElementById('notif-overlay').classList.remove('hidden'); }
function closeNotifModal(){ document.getElementById('notif-overlay').classList.add('hidden'); }
function openLangModal(){ document.getElementById('lang-overlay').classList.remove('hidden'); }
function closeLangModal(){ document.getElementById('lang-overlay').classList.add('hidden'); }
function openSignoutModal(){ document.getElementById('signout-overlay').classList.remove('hidden'); }
function closeSignoutModal(){ document.getElementById('signout-overlay').classList.add('hidden'); }
function confirmSignout(){ closeSignoutModal(); S.activeJob=null; localStorage.removeItem('wm-session'); goScreen('s-login'); showToast('Signed out'); }
function openMonthPicker(){ S.monthPickerDate=new Date(weekBase); S.monthPickerDate.setDate(weekBase.getDate()+S.selDay); renderMonthGrid(); document.getElementById('month-overlay').classList.remove('hidden'); }
function closeMonthPicker(){ document.getElementById('month-overlay').classList.add('hidden'); }
function shiftMonth(dir){ S.monthPickerDate.setMonth(S.monthPickerDate.getMonth()+dir); renderMonthGrid(); }
function renderMonthGrid(){
  const d=S.monthPickerDate; const y=d.getFullYear(), m=d.getMonth();
  document.getElementById('month-picker-title').textContent=d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  const today=new Date(); today.setHours(0,0,0,0);
  const selDate=new Date(weekBase); selDate.setDate(weekBase.getDate()+S.selDay); selDate.setHours(0,0,0,0);
  let html=['<span class="mg-hdr">M</span><span class="mg-hdr">T</span><span class="mg-hdr">W</span><span class="mg-hdr">T</span><span class="mg-hdr">F</span><span class="mg-hdr">S</span><span class="mg-hdr">S</span>'];
  for(let i=0;i<start;i++) html.push('<span class="month-day other"></span>');
  for(let day=1;day<=days;day++){
    const cd=new Date(y,m,day); cd.setHours(0,0,0,0);
    const isToday=cd.getTime()===today.getTime();
    const isSel=cd.getTime()===selDate.getTime();
    html.push(`<span class="month-day${isToday?' today':''}${isSel?' sel':''}" onclick="pickMonthDay(${y},${m},${day})">${day}</span>`);
  }
  document.getElementById('month-grid').innerHTML=html.join('');
}
function pickMonthDay(y,m,day){
  const picked=new Date(y,m,day); weekBase=getMonday(picked); S.selDay=(picked.getDay()+6)%7;
  closeMonthPicker(); renderCalendar();
}
