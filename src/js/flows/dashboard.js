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
// Actual date shown in calendar cell `i` of the displayed week.
function cellDate(i) {
  const d = new Date(weekBase); d.setDate(weekBase.getDate() + i);
  return formatDate(d);
}
function compareJobsBySchedule(a, b) {
  const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
  if (dateCmp) return dateCmp;
  return String(a.timeStart || '').localeCompare(String(b.timeStart || ''));
}
// The real date currently selected in the dashboard.
function selectedDateIso() {
  return cellDate(S.selDay);
}
// Prefer job.date (Notion appointment / Created 1). No createdTime or weekday fallback.
function jobDateIso(job) {
  return isoDateOnly(job?.date);
}
function isoDateOnly(value) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
// A job belongs to a date only when its Notion appointment date matches.
function jobMatchesDate(job, iso) {
  const jobIso = jobDateIso(job);
  if (!jobIso || !iso) return false;
  return jobIso === iso;
}
function jobsOnDate(iso) {
  return JOBS.filter(j => j.status !== 'cancelled' && jobMatchesDate(j, iso));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setupDashboardClickDelegation() {
  if (window.__wmDashboardClicksBound) return;
  window.__wmDashboardClicksBound = true;

  document.addEventListener('click', event => {
    const card = event.target.closest('.appt-card[data-job-id]');
    if (!card) return;

    const jobId = card.dataset.jobId;
    if (!jobId) return;

    if (event.target.closest('.ac-menu')) {
      event.preventDefault();
      event.stopPropagation();
      showApptMenu(jobId);
      return;
    }

    if (card.closest('#search-results')) {
      closeSearchModal();
      openJob(jobId);
      return;
    }

    if (card.closest('#appt-list')) {
      openJob(jobId);
    }
  });
}

setupDashboardClickDelegation();

function addCaseForSelectedDay() {
  const dayIndex = S.selDay;
  const d = new Date(weekBase);
  d.setDate(weekBase.getDate() + dayIndex);
  const iso = formatDate(d);
  const sameDayJobs = jobsOnDate(iso);
  const maxId = JOBS.reduce((m, j) => {
    const legacy = Number(j.legacyNumericId);
    const numeric = Number(j.id);
    const candidate = Number.isFinite(legacy) ? legacy : (Number.isFinite(numeric) ? numeric : 0);
    return Math.max(m, candidate);
  }, 1000);
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
    meta: `Case ${sameDayJobs.length + 1} for this day - Owner present`
  });
  ensureJobDraft(JOBS[JOBS.length - 1]);
  persistJobs();
  const newJob = JOBS[JOBS.length - 1];
  pushNotifEvent('New appointment', `${newJob.name} - ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${newJob.timeStart}`);
  renderCalendar();
  showToast(`Added case for ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
}

// Ad-hoc case created by staff on-site (no scheduled Notion appointment).
// Jumps straight to the Start assessment step and records the actual start time.
function createManualCase() {
  const now = new Date();
  const iso = formatDate(now);
  const maxId = JOBS.reduce((m, j) => {
    const legacy = Number(j.legacyNumericId);
    const numeric = Number(j.id);
    const candidate = Number.isFinite(legacy) ? legacy : (Number.isFinite(numeric) ? numeric : 0);
    return Math.max(m, candidate);
  }, 1000);
  const fmtTime = d => {
    const h = d.getHours() % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() >= 12 ? 'PM' : 'AM'}`;
  };
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  const job = {
    id: maxId + 1,
    name: `New Client ${maxId + 1}`,
    addr: 'Address to confirm',
    timeStart: fmtTime(now),
    timeEnd: fmtTime(end),
    day: (now.getDay() + 6) % 7,
    date: iso,
    pkg: 'essential',
    status: 'new',
    startedAt: now.toISOString(),
    meta: 'Manual case - started on-site'
  };
  JOBS.push(job);
  ensureJobDraft(job);
  persistJobs();
  pushNotifEvent('New appointment', `${job.name} - ${iso} ${job.timeStart}`);
  weekBase = getMonday(now);
  S.selDay = job.day;
  renderCalendar();
  openJob(job.id);
  goScreen('s-assess');
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
  const maxId = JOBS.reduce((m, j) => {
    const legacy = Number(j.legacyNumericId);
    const numeric = Number(j.id);
    const candidate = Number.isFinite(legacy) ? legacy : (Number.isFinite(numeric) ? numeric : 0);
    return Math.max(m, candidate);
  }, 1000);
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
    meta: 'New appointment - Owner present'
  });
  ensureJobDraft(JOBS[JOBS.length - 1]);
  persistJobs();
  const newJob = JOBS[JOBS.length - 1];
  pushNotifEvent('New appointment', `${newJob.name} - ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${newJob.timeStart}`);
  renderCalendar();
  showToast(`Added for ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
}
function renderCalendar() {
  const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  const today = new Date(); today.setHours(0,0,0,0);
  const strip = document.getElementById('day-strip');
  if (!strip) {
    renderJobs();
    return;
  }
  strip.innerHTML = '';
  // Gray/muted styling is fixed to Sunday (0) and Wednesday (3) only.
  // It never depends on JOBS / job.day / job.date / job counts.
  const disabledDays = [0, 3];
  for(let i=0;i<7;i++) {
    const d = new Date(weekBase); d.setDate(weekBase.getDate()+i);
    const dateHasJobs = jobsOnDate(cellDate(i)).length > 0;
    const chip = document.createElement('div');
    let cls = 'day-chip';
    const isHoliday = disabledDays.includes(d.getDay());
    if (isHoliday) cls += ' holiday muted';
    if (dateHasJobs) cls += ' has-jobs';
    if (d.getTime() === today.getTime()) cls += ' today';
    if (i === S.selDay) cls += ' sel';
    chip.className = cls;
    chip.innerHTML = `<span class="dc-dow">${DOW[i]}</span><span class="dc-d">${d.getDate()}</span><span class="dc-dot"></span>`;
    chip.onclick = () => { S.selDay = i; renderCalendar(); };
    strip.appendChild(chip);
  }
  const d = new Date(weekBase); d.setDate(weekBase.getDate() + S.selDay);
  document.getElementById('wn-month').textContent = d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  renderJobs();
}
const PIN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const MENU_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
// Schedule-change log (new / rescheduled / cancelled appointments), newest first.
let notifEvents = [];
function pushNotifEvent(title, sub) {
  notifEvents.unshift({ type: 'schedule', title, sub, ts: Date.now() });
}

// Parse job.date + job.timeStart ("9:00AM" or "09:00") into a Date, or null if unknown.
function parseJobDateTime(job) {
  const iso = jobDateIso(job);
  if (!iso) return null;
  const raw = String(job.timeStart || '').trim();
  let hour, minute = 0;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const hm24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (ampm) {
    hour = Number(ampm[1]) % 12;
    minute = Number(ampm[2]);
    if (/PM/i.test(ampm[3])) hour += 12;
  } else if (hm24) {
    hour = Number(hm24[1]);
    minute = Number(hm24[2]);
  } else {
    return null;
  }
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
}

// Jobs not yet marked done that start within the next hour.
function buildServiceNotifications() {
  const now = Date.now();
  return JOBS.filter(j => j.status !== 'cancelled' && j.status !== 'done').reduce((acc, job) => {
    const start = parseJobDateTime(job);
    if (!start) return acc;
    const diffMs = start.getTime() - now;
    if (diffMs <= 0 || diffMs > 60 * 60 * 1000) return acc;
    const mins = Math.max(1, Math.round(diffMs / 60000));
    acc.push({ type: 'service', title: 'Upcoming service', sub: `${job.name} starts in ${mins} min` });
    return acc;
  }, []);
}

function currentNotifications() {
  return [...notifEvents, ...buildServiceNotifications()];
}
let notifFilter = 'all';
function statusLabel(s) {
  if (s === 'in_progress') return t('dash.status.in_progress');
  if (s === 'overdue') return t('dash.status.overdue');
  if (s === 'done') return t('dash.status.done');
  return t('dash.status.new');
}

function buildApptCard(job) {
  const pkgFull = job.pkg === 'full';
  const pkgTag = pkgFull ? t('dash.pkg.full') : t('dash.pkg.essential');
  const pkgClass = pkgFull ? 'tag-full-assessment' : 'tag-essential';
  const progressTag = job.status === 'in_progress'
    ? '<span class="tag tag-progress">' + t('dash.status.in_progress') + '</span>'
    : '';
  const contactLine = job.contact
    ? '<br>' + t('dash.contact') + ': ' + job.contact
    : '';
  const stripeClass = pkgFull ? ' stripe-full' : '';
  const jobId = escapeHtml(job.id);

  return (
    '<div class="appt-card' + stripeClass + '" data-job-id="' + jobId + '">' +
      '<div class="ac-top">' +
        '<div class="ac-left">' +
          '<div class="ac-tags">' +
            '<span class="tag ' + pkgClass + '">' + pkgTag + '</span>' +
            progressTag +
          '</div>' +
          '<div class="ac-name">' + escapeHtml(job.name) + '</div>' +
        '</div>' +
        '<div class="ac-times">' +
          '<div class="ac-time-start">' + escapeHtml(job.timeStart) + '</div>' +
          '<div class="ac-time-end">' + escapeHtml(job.timeEnd) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ac-addr">' + PIN_SVG + '<span>' + escapeHtml(job.addr) + '</span></div>' +
      '<div class="ac-meta">' +
        '<span>' + escapeHtml(job.meta) + contactLine + '</span>' +
        '<button class="ac-menu" type="button" aria-label="More">' + MENU_SVG + '</button>' +
      '</div>' +
    '</div>'
  );
}

function renderJobs(filter) {
  const q = (filter ?? S.searchQuery).toLowerCase().trim();
  const activeJobs = JOBS.filter(j => j.status !== 'cancelled');
  const selected = selectedDateIso();
  let visibleJobs = activeJobs.filter(job => {
    return jobMatchesDate(job, selected);
  });
  visibleJobs.sort((a, b) => {
    return String(a.timeStart || '').localeCompare(String(b.timeStart || ''));
  });

  if (q) {
    visibleJobs = visibleJobs.filter(j =>
      String(j.name || '').toLowerCase().includes(q) ||
      String(j.addr || '').toLowerCase().includes(q)
    );
  }

  const list = document.getElementById('appt-list');
  const countEl = document.getElementById('appt-count');
  if (!list || !countEl) return;

  countEl.textContent = q
    ? t('dash.results') + ' (' + visibleJobs.length + ')'
    : t('dash.appointments') + ' (' + visibleJobs.length + ')';

  if (!visibleJobs.length) {
    const emptyMsg = q ? t('dash.noMatches') : t('dash.empty');
    list.innerHTML = '<div class="appt-empty">' + emptyMsg + '<span class="appt-empty-hint">' + t('dash.emptyHint') + '</span></div>';
    return;
  }

  list.innerHTML = visibleJobs.map(buildApptCard).join('');
}

function showApptMenu(id) {
  const job = JOBS.find(j => String(j.id) === String(id));
  if (!job) return;
  S.actionJobId = id;
  document.getElementById('action-sheet-title').textContent = job.name;
  const actions = [
    { label: t('dash.menu.start'), fn: () => { closeActionSheet(); openJob(id); } },
    { label: t('dash.menu.reschedule'), fn: () => { closeActionSheet(); pushNotifEvent('Changed appointment', `${job.name} reschedule requested`); showToast('Reschedule request sent'); } },
    { label: t('dash.menu.contact'), fn: () => { closeActionSheet(); showToast('Calling ' + job.name); } },
    { label: t('dash.menu.preassess'), fn: () => { closeActionSheet(); openJob(id); goScreen('s-preassess'); } },
    { label: t('dash.menu.cancel'), fn: () => { closeActionSheet(); cancelCase(id); } }
  ];
  document.getElementById('action-sheet-actions').innerHTML = actions.map(a=>`<button class="modal-action" type="button">${a.label}</button>`).join('');
  document.getElementById('action-sheet-actions').querySelectorAll('.modal-action').forEach((btn,i)=>btn.onclick=actions[i].fn);
  document.getElementById('action-sheet-overlay').classList.remove('hidden');
}

function closeActionSheet(){ document.getElementById('action-sheet-overlay').classList.add('hidden'); }
function cancelCase(id = S.activeJob?.id) {
  const job = JOBS.find(j => String(j.id) === String(id));
  if (!job) return;
  if (!confirm(`Cancel case for ${job.name}?`)) return;
  const index = JOBS.findIndex(j => String(j.id) === String(id));
  if (index >= 0) JOBS.splice(index, 1);
  if (S.activeJob && String(S.activeJob.id) === String(id)) S.activeJob = null;
  pushNotifEvent('Changed appointment', `${job.name} cancelled`);
  persistJobs();
  renderCalendar();
  goScreen('s-dash');
  showToast('Case cancelled');
}
function openSearchModal(){ document.getElementById('search-overlay').classList.remove('hidden'); document.getElementById('search-input').value=S.searchQuery; document.getElementById('search-input').focus(); filterAppointments(S.searchQuery); }
function closeSearchModal(){ document.getElementById('search-overlay').classList.add('hidden'); }
function filterAppointments(q){
  S.searchQuery = q;
  renderJobs(q);
  const needle = q.toLowerCase();
  const visibleJobs = JOBS
    .filter(j => j.status !== 'cancelled')
    .filter(j =>
      String(j.name || '').toLowerCase().includes(needle) ||
      String(j.addr || '').toLowerCase().includes(needle)
    );
  document.getElementById('search-results').innerHTML = visibleJobs.map(j => {
    return (
      '<div class="appt-card" style="margin-top:8px" data-job-id="' + escapeHtml(j.id) + '">' +
        '<div class="ac-name">' + escapeHtml(j.name) + '</div>' +
        '<div class="ac-addr" style="font-size:12px;color:var(--muted)">' + escapeHtml(j.addr) + '</div>' +
      '</div>'
    );
  }).join('') || '<p style="color:var(--muted);font-size:14px">No matches</p>';
}
function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  const notifications = currentNotifications();
  document.querySelectorAll('.notif-filter-btn').forEach(btn => {
    const type = btn.dataset.type;
    const count = type === 'all' ? notifications.length : notifications.filter(item => item.type === type).length;
    btn.classList.toggle('sel', type === notifFilter);
    btn.textContent = `${t('notif.' + type)} (${count})`;
  });
  const items = notifFilter === 'all'
    ? notifications
    : notifications.filter(item => item.type === notifFilter);
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
function openLangModal(){
  const lang = S?.lang || 'en';
  document.getElementById('lang-en')?.classList.toggle('sel', lang === 'en');
  document.getElementById('lang-th')?.classList.toggle('sel', lang === 'th');
  document.getElementById('lang-overlay')?.classList.remove('hidden');
}
function closeLangModal(){ document.getElementById('lang-overlay').classList.add('hidden'); }
function openSignoutModal(){ document.getElementById('signout-overlay').classList.remove('hidden'); }
function closeSignoutModal(){ document.getElementById('signout-overlay').classList.add('hidden'); }
function confirmSignout(){
  closeSignoutModal();
  S.activeJob = null;
  if (typeof clearAppSession === 'function') clearAppSession();
  else localStorage.removeItem('wm-session');
  goScreen('s-login');
  showToast('Signed out');
}
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
