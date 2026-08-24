(function initNotificationCenter(global) {
  let bound = false;
  let filter = 'all';

  function th() {
    return global.S?.lang === 'th';
  }

  async function refreshNotificationUi() {
    if (typeof global.renderNotificationBadge === 'function') {
      const count = await global.OperatorNotificationService?.unreadCount?.() || 0;
      global.renderNotificationBadge(count);
    }
    const overlay = document.getElementById('notif-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      await renderNotificationCenter();
    }
  }

  async function renderNotificationCenter() {
    const list = document.getElementById('notif-list');
    if (!list || !global.OperatorNotificationService) return;

    const items = await global.OperatorNotificationService.list(filter);
    document.querySelectorAll('.notif-filter-btn').forEach(btn => {
      const type = btn.dataset.type || 'all';
      btn.classList.toggle('sel', type === filter);
    });

    const empty = th() ? 'ยังไม่มีการแจ้งเตือน' : 'No notifications yet';
    if (!items.length) {
      list.innerHTML = `<p class="notif-empty">${empty}</p>`;
      return;
    }

    list.innerHTML = items.map(item => global.renderNotificationItem(item)).join('');
  }

  async function setNotifFilter(type) {
    filter = type || 'all';
    global.OperatorNotificationStore?.setFilter(filter);
    await renderNotificationCenter();
  }

  async function openNotifModal() {
    filter = filter || 'all';
    await global.OperatorNotificationService?.refreshStore?.();
    await renderNotificationCenter();
    document.getElementById('notif-overlay')?.classList.remove('hidden');
  }

  function closeNotifModal() {
    document.getElementById('notif-overlay')?.classList.add('hidden');
  }

  async function markAllNotificationsRead() {
    await global.OperatorNotificationService?.markAllRead?.();
    await refreshNotificationUi();
  }

  async function clearReadNotifications() {
    await global.OperatorNotificationService?.clearRead?.();
    await refreshNotificationUi();
  }

  function findJobByCaseId(caseId) {
    if (!caseId || !Array.isArray(global.JOBS)) return null;
    const needle = String(caseId);
    return global.JOBS.find(job =>
      String(job.notionId || '') === needle
      || String(job.id || '') === needle
      || String(job.id || '') === needle.replace(/-/g, '')
    ) || null;
  }

  // Case's own appointment date (source of truth is job.date; see dashboard.js).
  // Reused as a fallback only when the notification itself doesn't already
  // carry a date — never a new date source.
  function isoDateOnly(value) {
    const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  // General navigation-target resolver: a notification never says "open this
  // Case", it says "here is the date to land the Calendar on, and which Case
  // card to bring into view there". Future notification types can return
  // other target shapes here without any caller needing a type-by-type branch.
  function resolveNavigationTarget(item) {
    const job = findJobByCaseId(item?.caseId);
    const fromPayload = isoDateOnly(item?.payload?.date);
    const fromCase = isoDateOnly(job?.date);
    return {
      type: 'calendar',
      date: fromPayload || fromCase,
      caseId: item?.caseId || null,
      jobId: job?.id || null
    };
  }

  async function handleNotificationAction(item, action) {
    const Actions = global.OperatorNotificationTypes.NOTIFICATION_ACTION;
    await global.OperatorNotificationService?.markRead?.(item.id);

    if (action === Actions.OPEN_CASE && item.caseId) {
      const target = resolveNavigationTarget(item);
      closeNotifModal();
      if (typeof global.navigateToCalendarDate === 'function') {
        global.navigateToCalendarDate(target.date, target.jobId);
      } else if (typeof global.goScreen === 'function') {
        global.goScreen('s-dash');
      }
      await refreshNotificationUi();
      return;
    }

    if (action === Actions.OPEN_CASE_LIST || action === Actions.VIEW_SCHEDULE) {
      closeNotifModal();
      if (typeof global.goScreen === 'function') global.goScreen('s-dash');
      await refreshNotificationUi();
      return;
    }

    if (action === Actions.RETRY_LINE && item.caseId) {
      try {
        const response = await fetch('/api/cases/repair-notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ caseId: item.caseId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          global.showToast?.(payload.error || (th() ? 'ลองส่งใหม่ไม่สำเร็จ' : 'Retry failed'));
        } else if (payload.line?.ok || payload.action === 'sent' || payload.line?.status === 'sent') {
          global.showToast?.(th() ? 'ส่งผลผ่าน LINE แล้ว' : 'LINE result sent');
          await global.OperatorNotificationBridge?.emitFromCloseResult?.(
            { ...(findJobByCaseId(item.caseId) || {}), name: item.customerName, notification: { status: 'sent' } },
            payload
          );
        } else {
          global.showToast?.(th() ? 'ยังส่งไม่สำเร็จ' : 'Still not sent');
        }
      } catch (error) {
        global.showToast?.(th() ? 'ลองส่งใหม่ไม่สำเร็จ' : 'Retry failed');
      }
      await refreshNotificationUi();
    }
  }

  function bindNotificationCenter() {
    if (bound) return;
    bound = true;

    // Capture phase (the `true` below), not bubble: `.notif-sheet` calls
    // event.stopPropagation() on every click (so tapping inside the modal
    // doesn't also trigger the overlay's own backdrop-click-to-close). A
    // bubble-phase listener on document never sees ANY click inside the
    // notification modal because of that -- neither this row handler nor
    // the action-button handler below it ever fired. Capture runs top-down
    // BEFORE that stopPropagation() call happens, so it isn't affected by it.
    document.addEventListener('click', async (event) => {
      const actionBtn = event.target.closest('[data-notif-action]');
      if (actionBtn) {
        event.preventDefault();
        event.stopPropagation();
        const id = actionBtn.dataset.notifId;
        const action = actionBtn.dataset.notifAction;
        const state = global.OperatorNotificationStore?.getState?.();
        const item = state?.items?.find(n => n.id === id);
        if (item) await handleNotificationAction(item, action);
        return;
      }

      const row = event.target.closest('.notif-item[data-notif-id]');
      if (row && row.closest('#notif-list')) {
        const id = row.dataset.notifId;
        const state = global.OperatorNotificationStore?.getState?.();
        const item = state?.items?.find(n => n.id === id);
        // Tapping anywhere on the card should do the same thing as its own
        // action button, not just silently mark it read — a notification
        // that only "shows" with no visible response to a tap reads as
        // broken. Falls back to mark-read only when there's genuinely
        // nothing to navigate to (no action, e.g. a plain info notice).
        if (item && item.action && item.action !== 'NONE') {
          await handleNotificationAction(item, item.action);
        } else {
          await global.OperatorNotificationService?.markRead?.(id);
          await refreshNotificationUi();
        }
      }
    }, true);

    global.OperatorNotificationStore?.subscribe?.(() => {
      refreshNotificationUi();
    });
  }

  async function initOperatorNotificationCenter() {
    bindNotificationCenter();
    await global.OperatorNotificationService?.refreshStore?.();
    await refreshNotificationUi();
  }

  // Public API used by dashboard HTML onclick handlers
  global.openNotifModal = openNotifModal;
  global.closeNotifModal = closeNotifModal;
  global.setNotifFilter = setNotifFilter;
  global.markAllNotificationsRead = markAllNotificationsRead;
  global.clearReadNotifications = clearReadNotifications;
  global.renderNotificationCenter = renderNotificationCenter;
  global.refreshNotificationUi = refreshNotificationUi;
  global.initOperatorNotificationCenter = initOperatorNotificationCenter;
  global.resolveNavigationTarget = resolveNavigationTarget;
  global.handleNotificationAction = handleNotificationAction;
})(typeof globalThis !== 'undefined' ? globalThis : window);
