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

  async function handleNotificationAction(item, action) {
    const Actions = global.OperatorNotificationTypes.NOTIFICATION_ACTION;
    await global.OperatorNotificationService?.markRead?.(item.id);

    if (action === Actions.OPEN_CASE && item.caseId) {
      const job = findJobByCaseId(item.caseId);
      closeNotifModal();
      if (job && typeof global.openJob === 'function') global.openJob(job.id);
      else if (typeof global.showToast === 'function') {
        global.showToast(th() ? 'ไม่พบเคสในรายการ' : 'Case not found in list');
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
        await global.OperatorNotificationService?.markRead?.(id);
        await refreshNotificationUi();
      }
    });

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
})(typeof globalThis !== 'undefined' ? globalThis : window);
