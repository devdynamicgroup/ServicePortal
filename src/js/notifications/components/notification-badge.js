(function initNotificationBadge(global) {
  function ensureBadgeEl() {
    const btn = document.querySelector('.dash-actions .dash-icon-btn[aria-label="Notifications"], .dash-actions button[onclick*="openNotifModal"]');
    if (!btn) return null;
    btn.classList.add('dash-notif-btn');
    let badge = btn.querySelector('.notif-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notif-badge';
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
      btn.appendChild(badge);
    }
    return badge;
  }

  function renderNotificationBadge(count) {
    const badge = ensureBadgeEl();
    if (!badge) return;
    const n = Number(count) || 0;
    if (n <= 0) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    badge.hidden = false;
    badge.textContent = n > 99 ? '99+' : String(n);
  }

  global.renderNotificationBadge = renderNotificationBadge;
})(typeof globalThis !== 'undefined' ? globalThis : window);
