let weekBase = getMonday(new Date());
// The Case a notification navigated to, if any — rendered with a highlight
// and scrolled into view the next time the appointment list renders. Cleared
// by any manual date change so it never lingers past its purpose.
let highlightJobId = null;
function setHighlightedCase(jobId) { highlightJobId = jobId || null; }
function clearHighlightedCase() { highlightJobId = null; }
function getMonday(d) {
  const day = d.getDay(), diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m = new Date(d); m.setDate(diff); m.setHours(0,0,0,0); return m;
}
function shiftWeek(dir) { clearHighlightedCase(); weekBase.setDate(weekBase.getDate() + dir*7); renderCalendar(); }

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
  return JOBS.filter(j => j.status !== 'cancelled' && !j.manualPending && jobMatchesDate(j, iso));
}

// Move the calendar's selected week/day to an arbitrary ISO date without
// touching screen state. Parses y/m/d components directly (no `new Date(iso)`)
// so a UTC-midnight parse can't shift the date in negative-UTC-offset zones.
function goToCalendarDate(iso) {
  const parsed = isoDateOnly(iso);
  if (!parsed) return false;
  const [y, m, day] = parsed.split('-').map(Number);
  const picked = new Date(y, m - 1, day);
  if (Number.isNaN(picked.getTime())) return false;
  weekBase = getMonday(picked);
  S.selDay = (picked.getDay() + 6) % 7;
  return true;
}

// Navigation-layer entry point: notifications (and anything else) resolve to
// a target date (and optionally the specific Case's job.id), then call this
// to land on the Calendar/dashboard screen focused there. Never opens a
// Case — the user picks from jobsOnDate(); the target Case is only
// highlighted and scrolled into view (see renderJobs()).
function navigateToCalendarDate(iso, jobId) {
  goToCalendarDate(iso);
  setHighlightedCase(jobId);
  if (typeof goScreen === 'function') goScreen('s-dash');
  else renderCalendar();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Display only -- job.timeStart/timeEnd stay whatever format they're stored
 * in (24h "HH:MM" from Notion, or already-formatted "H:MMAM" from the
 * manual-case flow); this never rewrites the stored value. */
function formatDisplayTime(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  const hour24 = Number(match[1]);
  const hour = hour24 % 12 || 12;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour}:${match[2]}${period}`;
}

function setupDashboardClickDelegation() {
  if (window.__wmDashboardClicksBound) return;
  window.__wmDashboardClicksBound = true;

  // Capture phase (the `true` below), not bubble: #search-results (the
  // Search modal) lives inside a .modal-sheet that calls
  // event.stopPropagation() on every click (src/pages/partials/modals.html)
  // so tapping inside the modal doesn't also trigger the overlay's own
  // backdrop-click-to-close. A bubble-phase listener on document never sees
  // a click on a search result card because of that -- same root cause as
  // the notification click bug (notifications/components/notification-center.js).
  // #appt-list lives outside any modal, so this doesn't change its behavior.
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

    if (card.closest('#history-list')) {
      closeHistoryModal();
      openJob(jobId);
      return;
    }

    if (card.closest('#appt-list')) {
      openJob(jobId);
    }
  }, true);
}

setupDashboardClickDelegation();

function discardUnsavedManualCases() {
  const pendingIds = JOBS.filter(j => j.manualPending && !j.notionId).map(j => String(j.id));
  if (!pendingIds.length) return;
  for (let i = JOBS.length - 1; i >= 0; i--) {
    if (JOBS[i].manualPending && !JOBS[i].notionId) JOBS.splice(i, 1);
  }
  if (S.activeJob && pendingIds.includes(String(S.activeJob.id))) {
    S.activeJob = null;
  }
}

// Ad-hoc case created by staff on-site. Durable Notion identity is required
// before the Case is treated as created / opened.
/**
 * Re-entrancy guard + visible loading state (2026-08-18 fix): the awaited
 * server create call could take a moment with no feedback, which read as
 * "hangs, then suddenly jumps" and invited a double-tap that would create
 * two Cases from one press. The FAB is disabled for the duration instead.
 */
async function createManualCase() {
  if (S._creatingCase) return;
  const fab = document.querySelector('.dash-fab');
  S._creatingCase = true;
  if (fab) fab.disabled = true;
  try {
    discardUnsavedManualCases();
    const now = new Date();
    // The FAB must create the case on whichever day is currently selected on
    // the calendar (cellDate(S.selDay)), not silently on today's date — a
    // real bug: staff would select a future day, tap +, and the case would
    // land on today instead. Only when the selected day IS today do we keep
    // the original "start on-site now" semantics (in_progress + startedAt);
    // a case created for a different, not-yet-arrived day cannot have
    // already started, so it's created as a normal scheduled case instead.
    const selectedIso = typeof selectedDateIso === 'function' ? selectedDateIso() : formatDate(now);
    const isToday = selectedIso === formatDate(now);
    const fmtTime = d => {
      const h = d.getHours() % 12 || 12;
      return `${h}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() >= 12 ? 'PM' : 'AM'}`;
    };
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    if (typeof createDurablePortalCase !== 'function') {
      showToast(S.lang === 'th' ? 'สร้างเคสไม่สำเร็จ' : 'Could not create case');
      return;
    }

    let seed;
    if (isToday) {
      seed = {
        name: 'New Client',
        timeStart: fmtTime(now),
        timeEnd: fmtTime(end),
        day: (now.getDay() + 6) % 7,
        date: selectedIso,
        status: 'in_progress',
        startedAt: now.toISOString(),
        meta: 'Manual case · started on-site'
      };
    } else {
      const sameDayJobs = jobsOnDate(selectedIso);
      const hour = Math.min(17, 9 + sameDayJobs.length);
      const endHour = Math.min(18, hour + 1);
      seed = {
        name: 'New Client',
        timeStart: `${String(hour).padStart(2, '0')}:00`,
        timeEnd: `${String(endHour).padStart(2, '0')}:00`,
        day: S.selDay,
        date: selectedIso,
        status: 'new',
        meta: `Case ${sameDayJobs.length + 1} for this day - Owner present`
      };
    }

    const result = await createDurablePortalCase(seed);
    if (!result?.ok || !result.case?.notionId) {
      showToast(S.lang === 'th'
        ? 'สร้างเคสไม่สำเร็จ — ยังไม่ได้บันทึกบนเซิร์ฟเวอร์'
        : 'Case was not created — server persistence failed');
      return;
    }
    // Keep the calendar on whichever week/day the case was actually created
    // for — never snap back to today's week when a different day was selected.
    if (isToday) weekBase = getMonday(now);
    S.selDay = result.case.day;
    openJob(result.case.id);
  } finally {
    S._creatingCase = false;
    if (fab) fab.disabled = false;
  }
}

function commitManualCaseIfNeeded(job = S.activeJob) {
  if (!job?.manualPending) return false;
  // Never clear pending unless durable identity exists.
  if (!job.notionId) return false;
  delete job.manualPending;
  return true;
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
    chip.onclick = () => { clearHighlightedCase(); S.selDay = i; renderCalendar(); };
    strip.appendChild(chip);
  }
  const d = new Date(weekBase); d.setDate(weekBase.getDate() + S.selDay);
  document.getElementById('wn-month').textContent = d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  renderJobs();
}
const PIN_SVG = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.24,144.53,209,128,222Z"/></svg>';
const MENU_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

function statusLabel(s) {
  if (s === 'in_progress') return t('dash.status.in_progress');
  if (s === 'overdue') return t('dash.status.overdue');
  if (s === 'done') return t('dash.status.done');
  return t('dash.status.new');
}

function buildApptCard(job, opts = {}) {
  const pkgFull = job.pkg === 'full';
  const pkgTag = pkgFull ? t('dash.pkg.full') : t('dash.pkg.essential');
  const pkgClass = pkgFull ? 'tag-full-assessment' : 'tag-essential';
  let statusTag = '';
  if (job.status === 'in_progress') {
    statusTag = '<span class="tag tag-progress">' + t('dash.status.in_progress') + '</span>';
  } else if (opts.showDate && job.status === 'done') {
    statusTag = '<span class="tag tag-done">' + t('dash.status.done') + '</span>';
  } else if (opts.showDate && job.status === 'cancelled') {
    statusTag = '<span class="tag tag-cancelled">' + t('history.cancelled') + '</span>';
  }
  const contactLine = job.contact
    ? '<br>' + t('dash.contact') + ': ' + job.contact
    : '';
  const stripeClass = pkgFull ? ' stripe-full' : '';
  const highlightClass = highlightJobId != null && (
    String(job.id) === String(highlightJobId)
    || (job.notionId && String(job.notionId) === String(highlightJobId))
    || (job.notionId && String(job.notionId).replace(/-/g, '') === String(highlightJobId).replace(/-/g, ''))
  ) ? ' is-notif-target' : '';
  const jobId = escapeHtml(job.id);
  const dateLine = opts.showDate && job.date
    ? '<div class="history-date">' + escapeHtml(job.date) + '</div>'
    : '';

  return (
    '<div class="appt-card' + stripeClass + highlightClass + '" data-job-id="' + jobId + '">' +
      '<button class="ac-menu" type="button" aria-label="More">' + MENU_SVG + '</button>' +
      dateLine +
      '<div class="ac-tags">' +
        '<span class="tag ' + pkgClass + '">' + pkgTag + '</span>' +
        statusTag +
      '</div>' +
      '<div class="ac-top">' +
        '<div class="ac-left">' +
          '<div class="ac-name">' + escapeHtml(job.name) + '</div>' +
          '<div class="ac-addr">' + PIN_SVG + '<span>' + escapeHtml(job.addr) + '</span></div>' +
        '</div>' +
        '<div class="ac-times">' +
          '<div class="ac-time-start">' + escapeHtml(formatDisplayTime(job.timeStart)) + '</div>' +
          '<div class="ac-time-end">' + escapeHtml(formatDisplayTime(job.timeEnd)) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ac-meta">' +
        '<span>' + escapeHtml(job.meta) + contactLine + '</span>' +
      '</div>' +
    '</div>'
  );
}

function renderJobs(filter) {
  const q = (filter ?? S.searchQuery).toLowerCase().trim();
  const activeJobs = JOBS.filter(j => j.status !== 'cancelled' && !j.manualPending);
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

  // Bring the notification's target Case into view — top, middle, or bottom
  // of the list all resolved the same way — without opening it.
  if (highlightJobId != null) {
    const idx = visibleJobs.findIndex(j =>
      String(j.id) === String(highlightJobId)
      || (j.notionId && String(j.notionId) === String(highlightJobId))
      || (j.notionId && String(j.notionId).replace(/-/g, '') === String(highlightJobId).replace(/-/g, ''))
    );
    const cardEl = idx >= 0 ? list.children?.[idx] : null;
    if (cardEl && typeof cardEl.scrollIntoView === 'function') {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function showApptMenu(id) {
  const job = JOBS.find(j => String(j.id) === String(id));
  if (!job) return;
  S.actionJobId = id;
  document.getElementById('action-sheet-title').textContent = job.name;
  const actions = [
    { label: t('dash.menu.start'), fn: () => { closeActionSheet(); openJob(id); } },
    { label: t('dash.menu.reschedule'), fn: () => { closeActionSheet(); showToast('Reschedule request sent'); } },
    { label: t('dash.menu.contact'), fn: () => { closeActionSheet(); showToast('Calling ' + job.name); } },
    { label: t('dash.menu.preassess'), fn: () => { closeActionSheet(); openJob(id); goScreen('s-preassess'); } },
    { label: t('dash.menu.cancel'), fn: () => { closeActionSheet(); cancelCase(id); } }
  ];
  document.getElementById('action-sheet-actions').innerHTML = actions.map(a=>`<button class="modal-action" type="button">${a.label}</button>`).join('');
  document.getElementById('action-sheet-actions').querySelectorAll('.modal-action').forEach((btn,i)=>btn.onclick=actions[i].fn);
  document.getElementById('action-sheet-overlay').classList.remove('hidden');
}

function closeActionSheet(){ document.getElementById('action-sheet-overlay').classList.add('hidden'); }
let _cancelCaseResolve = null;
// Centered app modal instead of the browser's native confirm() dialog
// (2026-08-27, direct request) -- confirm() can't be styled and looks out
// of place next to the rest of the UI's custom modals (e.g. #signout-overlay).
function showCancelCaseConfirm(message) {
  return new Promise(resolve => {
    _cancelCaseResolve = resolve;
    const msgEl = document.getElementById('cancel-case-message');
    if (msgEl) msgEl.textContent = message;
    document.getElementById('cancel-case-overlay')?.classList.remove('hidden');
  });
}
function resolveCancelCase(confirmed) {
  document.getElementById('cancel-case-overlay')?.classList.add('hidden');
  const resolve = _cancelCaseResolve;
  _cancelCaseResolve = null;
  resolve?.(confirmed);
}

async function cancelCase(id = S.activeJob?.id) {
  const job = JOBS.find(j => String(j.id) === String(id));
  if (!job) return;
  const confirmMsg = typeof t === 'function' && S.lang === 'th'
    ? `ยกเลิกเคสของ ${job.name}? การดำเนินการนี้ไม่สามารถย้อนกลับได้`
    : `Cancel case for ${job.name}? This action cannot be undone.`;
  const confirmed = await showCancelCaseConfirm(confirmMsg);
  if (!confirmed) return;

  const caseId = job.notionId || job.id;
  const isNotionJob = Boolean(job.notionId || job.notionSource);
  if (isNotionJob) {
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        showToast(payload.error || (S.lang === 'th' ? 'ยกเลิกนัดไม่สำเร็จ' : 'Could not cancel appointment'));
        return;
      }
    } catch (error) {
      console.warn('cancelCase failed', error);
      showToast(S.lang === 'th' ? 'ยกเลิกนัดไม่สำเร็จ' : 'Could not cancel appointment');
      return;
    }
  }

  job.status = 'cancelled';
  if (job.workflow) job.workflow.status = 'cancelled';
  else job.workflow = { status: 'cancelled' };
  if (S.activeJob && String(S.activeJob.id) === String(id)) S.activeJob = null;
  if (typeof clearActiveCaseRef === 'function') clearActiveCaseRef();
  // Keep the Notion row, but drop it from the local dashboard list immediately.
  for (let i = JOBS.length - 1; i >= 0; i--) {
    if (String(JOBS[i].id) === String(id)
      || (job.notionId && String(JOBS[i].notionId || '') === String(job.notionId))) {
      JOBS.splice(i, 1);
    }
  }
  persistJobs();
  renderCalendar();
  goScreen('s-dash');
  showToast(S.lang === 'th' ? 'ยกเลิกนัดแล้ว' : 'Case cancelled');
}
function openSearchModal(){ document.getElementById('search-overlay').classList.remove('hidden'); document.getElementById('search-input').value=S.searchQuery; document.getElementById('search-input').focus(); filterAppointments(S.searchQuery); }
function closeSearchModal(){
  document.getElementById('search-overlay')?.classList.add('hidden');
  // Closing search must leave the dashboard in appointment mode — not a
  // stale "Results (0)" heading from an uncleared S.searchQuery (UJ-10).
  S.searchQuery = '';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const results = document.getElementById('search-results');
  if (results) results.innerHTML = '';
  renderJobs('');
}
function caseIdentityLabel(job) {
  if (job?.notionId) {
    const compact = String(job.notionId).replace(/-/g, '');
    return compact.length > 8 ? compact.slice(0, 8) : compact;
  }
  if (job?.id != null) return String(job.id);
  return '—';
}
function filterAppointments(q){
  S.searchQuery = q;
  renderJobs(q);
  const needle = String(q || '').toLowerCase().trim();
  const visibleJobs = JOBS
    .filter(j => j.status !== 'cancelled' && !j.manualPending)
    .filter(j => {
      if (!needle) return true;
      const hay = [
        j.name,
        j.addr,
        j.id,
        j.notionId,
        j.date,
        j.meta,
        j.draft?.fields?.['ci-phone'],
        j.phone
      ].map(v => String(v || '').toLowerCase());
      return hay.some(part => part.includes(needle));
    });
  document.getElementById('search-results').innerHTML = visibleJobs.map(j => {
    const identity = caseIdentityLabel(j);
    const dateLabel = j.date || '—';
    const statusLabel = j.status || 'new';
    const timeLabel = j.timeStart ? String(j.timeStart) : '';
    return (
      '<div class="appt-card" style="margin-top:8px" data-job-id="' + escapeHtml(j.id) + '"' +
        (j.notionId ? ' data-notion-id="' + escapeHtml(j.notionId) + '"' : '') + '>' +
        '<div class="ac-name">' + escapeHtml(j.name) + '</div>' +
        '<div class="ac-addr" style="font-size:12px;color:var(--muted)">' + escapeHtml(j.addr) + '</div>' +
        '<div class="ac-meta" style="font-size:11px;color:var(--muted);margin-top:4px">' +
          escapeHtml(dateLabel) + (timeLabel ? ' · ' + escapeHtml(timeLabel) : '') +
          ' · ' + escapeHtml(statusLabel) +
          ' · #' + escapeHtml(identity) +
        '</div>' +
      '</div>'
    );
  }).join('') || '<p style="color:var(--muted);font-size:14px">No matches</p>';
}
function openHistoryModal() {
  document.getElementById('history-overlay').classList.remove('hidden');
  document.getElementById('history-search-input').value = '';
  renderHistory();
}
function closeHistoryModal() {
  document.getElementById('history-overlay')?.classList.add('hidden');
}
function renderHistory() {
  const statusFilter = document.getElementById('history-status-select')?.value || 'done';
  const rangeFilter = document.getElementById('history-range-select')?.value || 'all';
  const needle = String(document.getElementById('history-search-input')?.value || '').toLowerCase().trim();

  const rangeDays = Number(rangeFilter);
  const cutoffIso = Number.isFinite(rangeDays) && rangeDays > 0
    ? isoDateOnly(new Date(Date.now() - rangeDays * 86400000).toISOString())
    : '';

  const jobs = JOBS
    .filter(j => !j.manualPending)
    .filter(j => statusFilter === 'all' ? j.status !== 'new' : j.status === statusFilter)
    .filter(j => {
      if (!cutoffIso) return true;
      const jobIso = jobDateIso(j);
      return jobIso && jobIso >= cutoffIso;
    })
    .filter(j => {
      if (!needle) return true;
      const hay = [j.name, j.addr, j.meta].map(v => String(v || '').toLowerCase());
      return hay.some(part => part.includes(needle));
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.timeStart || '').localeCompare(String(a.timeStart || '')));

  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = jobs.length
    ? jobs.map(j => buildApptCard(j, { showDate: true })).join('')
    : '<p class="appt-empty">' + escapeHtml(t('history.empty')) + '</p>';
}
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
  // clearAppSession() -> resetUserScopedState() (auth.js) owns clearing
  // S.activeJob / wm-active-case-ref / JOBS / notifications centrally now,
  // so every sign-out path (this manual one and the server-triggered
  // handleSessionExpired()) gets the same cleanup instead of drifting.
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
    const hasJobs=jobsOnDate(formatDate(cd)).length>0;
    html.push(`<span class="month-day${isToday?' today':''}${isSel?' sel':''}${hasJobs?' has-jobs':''}" onclick="pickMonthDay(${y},${m},${day})"><span class="mg-day-num">${day}</span><span class="mg-dot"></span></span>`);
  }
  document.getElementById('month-grid').innerHTML=html.join('');
}
function pickMonthDay(y,m,day){
  clearHighlightedCase();
  const picked=new Date(y,m,day); weekBase=getMonday(picked); S.selDay=(picked.getDay()+6)%7;
  closeMonthPicker(); renderCalendar();
}
