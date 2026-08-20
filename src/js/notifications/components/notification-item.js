(function initNotificationItem(global) {
  const Utils = () => global.OperatorNotificationUtils;
  const Types = () => global.OperatorNotificationTypes;

  function typeLabel(type) {
    const key = `notif.type.${String(type || '').toLowerCase()}`;
    if (typeof global.t === 'function') {
      const translated = global.t(key);
      if (translated && translated !== key) return translated;
    }
    const map = {
      NEW_CASE: 'New case',
      CASE_ASSIGNED: 'Assigned',
      TOMORROW_REMINDER: 'Tomorrow',
      TODAY_JOBS: 'Today',
      RESULT_SENT: 'Result',
      LINE_FAILED: 'LINE',
      OVERDUE: 'Overdue'
    };
    return map[type] || type;
  }

  function actionLabel(action) {
    const th = global.S?.lang === 'th';
    switch (action) {
      case Types().NOTIFICATION_ACTION.OPEN_CASE: return th ? 'ดูในปฏิทิน' : 'View on calendar';
      case Types().NOTIFICATION_ACTION.OPEN_CASE_LIST: return th ? 'ดูทั้งหมด' : 'View all';
      case Types().NOTIFICATION_ACTION.RETRY_LINE: return th ? 'ลองส่งใหม่' : 'Retry';
      case Types().NOTIFICATION_ACTION.VIEW_SCHEDULE: return th ? 'ดูตาราง' : 'View schedule';
      default: return '';
    }
  }

  function renderNotificationItem(item) {
    const { escapeHtml } = Utils();
    const priority = String(item.priority || 'INFO').toLowerCase();
    const unread = item.read ? '' : ' is-unread';
    const messageHtml = escapeHtml(item.message || '').replace(/\n/g, '<br>');
    const action = item.action && item.action !== 'NONE'
      ? `<button type="button" class="notif-action-btn" data-notif-action="${escapeHtml(item.action)}" data-notif-id="${escapeHtml(item.id)}">${escapeHtml(actionLabel(item.action))}</button>`
      : '';

    return `
      <article class="notif-item priority-${priority}${unread}" data-notif-id="${escapeHtml(item.id)}" data-case-id="${escapeHtml(item.caseId || '')}">
        <div class="notif-item-top">
          <span class="notif-type">${escapeHtml(typeLabel(item.type))}</span>
          ${item.read ? '' : '<span class="notif-unread-dot" aria-hidden="true"></span>'}
        </div>
        <div class="notif-title">${escapeHtml(item.title || '')}</div>
        <div class="notif-sub">${messageHtml}</div>
        ${action}
      </article>
    `;
  }

  global.renderNotificationItem = renderNotificationItem;
})(typeof globalThis !== 'undefined' ? globalThis : window);
