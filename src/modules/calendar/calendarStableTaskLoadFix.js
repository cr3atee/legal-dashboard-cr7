import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

let initialized = false;

export function initCalendarStableTaskLoadFix() {
  if (initialized) return;
  initialized = true;

  const getCalendarTasks = dbApi.getCalendarTasks.bind(dbApi);
  dbApi.getCalendarTasks = params => getCalendarTasks(normalizeCalendarTaskQuery(params));

  window.addEventListener('calendar:reload', refreshCalendarSafely);
  window.addEventListener('general-cases:updated', refreshCalendarSafely);
  window.addEventListener('court-schedule:updated', refreshCalendarSafely);
}

function normalizeCalendarTaskQuery(params = {}) {
  const next = { ...(params || {}) };

  if (!shouldUseStableAdminCalendarQuery(next)) return next;

  delete next.user;
  delete next.scope;
  return next;
}

function shouldUseStableAdminCalendarQuery(params = {}) {
  const session = getAuthSession();
  const roleLevel = Number(session?.role_level || 0);
  const permissions = Array.isArray(session?.permissions) ? session.permissions : [];
  const canViewAny = roleLevel >= 3 || permissions.includes('calendar.view.any');

  if (!canViewAny) return false;
  if (params.generalCaseId || params.general_case_id) return false;
  if (!params.start && !params.end && !params.date) return false;

  return true;
}

function refreshCalendarSafely() {
  window.setTimeout(() => {
    const refreshButton = document.querySelector('[data-calendar-refresh]');
    if (refreshButton instanceof HTMLButtonElement) {
      refreshButton.click();
    }
  }, 80);
}
