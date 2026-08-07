/**
 * Maps domain events → Notification records (copy only; no business rules beyond presentation).
 */
(function initNotificationMapper(global) {
  const Types = () => global.OperatorNotificationTypes;
  const Utils = () => global.OperatorNotificationUtils;
  const Events = () => global.OperatorNotificationEvents.NOTIFICATION_EVENTS;

  function lang() {
    return (global.S && global.S.lang) || 'en';
  }

  function th() {
    return lang() === 'th';
  }

  function mapEventToNotification(eventName, payload = {}) {
    const { NOTIFICATION_TYPES, TYPE_META, NOTIFICATION_ACTION } = Types();
    const { newNotificationId, packageLabel, formatTimeLabel } = Utils();
    const E = Events();

    const base = {
      id: newNotificationId(),
      caseId: payload.caseId || null,
      customerName: payload.customerName || '',
      createdAt: Date.now(),
      read: false,
      readAt: null,
      dedupeKey: payload.dedupeKey || null,
      payload: payload.payload || {}
    };

    switch (eventName) {
      case E.CASE_CREATED: {
        const meta = TYPE_META.NEW_CASE;
        const pkg = payload.packageLabel || '';
        const time = payload.timeLabel || '';
        return {
          ...base,
          type: NOTIFICATION_TYPES.NEW_CASE,
          priority: meta.priority,
          action: meta.action,
          title: th() ? 'มีเคสใหม่' : 'New case',
          message: th()
            ? `ลูกค้า: ${base.customerName || '—'}\nPackage: ${pkg || '—'}\nเวลา: ${time || '—'}`
            : `Customer: ${base.customerName || '—'}\nPackage: ${pkg || '—'}\nTime: ${time || '—'}`
        };
      }
      case E.CASE_ASSIGNED: {
        const meta = TYPE_META.CASE_ASSIGNED;
        const byOther = Boolean(payload.assignedToOther);
        const assignee = payload.assigneeName || 'Water Motion Specialist';
        return {
          ...base,
          type: NOTIFICATION_TYPES.CASE_ASSIGNED,
          priority: meta.priority,
          action: meta.action,
          title: th() ? 'รับเคสแล้ว' : 'Case assigned',
          message: byOther
            ? (th() ? `เคสนี้ถูกรับโดย\n${assignee}` : `This case was accepted by\n${assignee}`)
            : (th() ? 'คุณรับเคสนี้แล้ว' : 'You accepted this case')
        };
      }
      case E.TOMORROW_REMINDER: {
        const meta = TYPE_META.TOMORROW_REMINDER;
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        const body = lines.length
          ? lines.join('\n')
          : (th() ? 'ไม่มีรายละเอียดนัด' : 'No appointment details');
        return {
          ...base,
          type: NOTIFICATION_TYPES.TOMORROW_REMINDER,
          priority: meta.priority,
          action: meta.action,
          title: th() ? 'พรุ่งนี้มีนัดหมาย' : 'Appointments tomorrow',
          message: body
        };
      }
      case E.TODAY_JOBS: {
        const meta = TYPE_META.TODAY_JOBS;
        const count = Number(payload.count) || 0;
        const firstTime = payload.firstTime || '—';
        return {
          ...base,
          type: NOTIFICATION_TYPES.TODAY_JOBS,
          priority: meta.priority,
          action: meta.action,
          title: th() ? 'งานวันนี้' : "Today's jobs",
          message: th()
            ? `วันนี้มีงานทั้งหมด\n${count} เคส\nเริ่มเวลา ${firstTime}`
            : `You have ${count} case(s) today\nFirst start: ${firstTime}`
        };
      }
      case E.RESULT_SENT: {
        const meta = TYPE_META.RESULT_SENT;
        return {
          ...base,
          type: NOTIFICATION_TYPES.RESULT_SENT,
          priority: meta.priority,
          action: meta.action,
          title: th() ? 'ส่งผลตรวจเรียบร้อยแล้ว' : 'Results sent',
          message: th()
            ? `ลูกค้า\n${base.customerName || '—'}`
            : `Customer\n${base.customerName || '—'}`
        };
      }
      case E.LINE_FAILED: {
        const meta = TYPE_META.LINE_FAILED;
        const reason = payload.reason || '';
        const noLine = /no_line|not.?link|skipped/i.test(reason);
        return {
          ...base,
          type: NOTIFICATION_TYPES.LINE_FAILED,
          priority: meta.priority,
          action: noLine ? NOTIFICATION_ACTION.OPEN_CASE : meta.action,
          title: th() ? 'ไม่สามารถส่งผลตรวจผ่าน LINE' : 'LINE delivery failed',
          message: noLine
            ? (th()
              ? `สาเหตุ\nลูกค้ายังไม่ได้เชื่อม LINE\n\nลูกค้า: ${base.customerName || '—'}`
              : `Reason\nCustomer has not linked LINE\n\nCustomer: ${base.customerName || '—'}`)
            : (th()
              ? `LINE Delivery Failed\n${reason || 'unknown'}\n\nลูกค้า: ${base.customerName || '—'}`
              : `LINE Delivery Failed\n${reason || 'unknown'}\n\nCustomer: ${base.customerName || '—'}`)
        };
      }
      case E.OVERDUE: {
        const meta = TYPE_META.OVERDUE;
        const hours = Number(payload.hoursOverdue) || 1;
        return {
          ...base,
          type: NOTIFICATION_TYPES.OVERDUE,
          priority: meta.priority,
          action: meta.action,
          title: th() ? 'เคสนี้เลยเวลานัดแล้ว' : 'Appointment overdue',
          message: th()
            ? `${base.customerName || '—'}\nเลยมาแล้ว ${hours} ชั่วโมง`
            : `${base.customerName || '—'}\n${hours} hour(s) overdue`
        };
      }
      default:
        return null;
    }
  }

  function fromJobCreated(job) {
    const { caseKey, packageLabel, formatTimeLabel } = Utils();
    const id = caseKey(job);
    return {
      caseId: id,
      customerName: job.name || '',
      packageLabel: packageLabel(job),
      timeLabel: formatTimeLabel(job),
      dedupeKey: `new_case:${id}`,
      payload: { date: job.date || '', pkg: job.pkg || '' }
    };
  }

  global.OperatorNotificationMapper = {
    mapEventToNotification,
    fromJobCreated
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
