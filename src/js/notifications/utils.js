(function initNotificationUtils(global) {
  function newNotificationId() {
    return `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isoDateOnly(value) {
    const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }

  function todayIsoLocal(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDaysIso(iso, days) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return todayIsoLocal(dt);
  }

  function parseJobStartMs(job) {
    const iso = isoDateOnly(job?.date);
    if (!iso) return null;
    const raw = String(job.timeStart || '').trim();
    let hour;
    let minute = 0;
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
    return new Date(y, m - 1, d, hour, minute).getTime();
  }

  function caseKey(job) {
    if (!job) return '';
    return String(job.notionId || job.id || '').trim();
  }

  function packageLabel(job) {
    if (!job) return '';
    const campaign = String(job.campaignOffer || job.offer?.name || '').trim();
    if (campaign) return campaign;
    const pkg = String(job.pkg || job.packageHistory || '').toLowerCase();
    if (pkg === 'full') return 'Full Assessment';
    if (pkg === 'essential') return 'Essential';
    if (pkg.includes('free') || pkg.includes('launch')) return job.pkg || job.packageHistory;
    return job.pkg || job.packageHistory || 'Water Check';
  }

  function formatTimeLabel(job) {
    return String(job?.timeStart || '').trim() || '—';
  }

  function relativeHoursOverdue(startMs, now = Date.now()) {
    if (!Number.isFinite(startMs) || startMs >= now) return 0;
    return Math.max(1, Math.round((now - startMs) / (60 * 60 * 1000)));
  }

  global.OperatorNotificationUtils = {
    newNotificationId,
    escapeHtml,
    isoDateOnly,
    todayIsoLocal,
    addDaysIso,
    parseJobStartMs,
    caseKey,
    packageLabel,
    formatTimeLabel,
    relativeHoursOverdue
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
