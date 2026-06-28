import { dbApi } from '../../api/dbApi.js';
import { getAuthSession, isCurrentUserAdmin } from '../../auth/session.js';

let initialized = false;

export function initCalendarExecutorControl() {
  if (initialized) return;
  initialized = true;

  const refresh = () => window.setTimeout(renderControl, 0);
  window.addEventListener('app:view-changed', refresh);
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
  refresh();
}

async function renderControl() {
  const row = document.querySelector('#calendar .calendar-week-new-row');
  const executionButton = row?.querySelector('[data-calendar-execution-mode]');
  if (!row || !executionButton) return;

  const session = getAuthSession() || window.legalDashboardSession || {};
  const level = Number(session.role_level ?? session.roleLevel ?? session.level ?? 0);
  const allowed = level >= 2 || Number(session.is_admin || 0) === 1 || isCurrentUserAdmin();

  let label = row.querySelector('[data-calendar-executor-control]');
  if (!label) {
    label = document.createElement('label');
    label.className = 'calendar-user-filter calendar-executor-inline';
    label.dataset.calendarExecutorControl = '1';
    label.innerHTML = '<span>Исполнители</span><select data-calendar-user><option value="0">Только мой календарь</option></select>';
    row.insertBefore(label, executionButton);
  }

  label.hidden = !allowed;
  if (!allowed) return;

  const select = label.querySelector('[data-calendar-user]');
  if (!select || select.dataset.loading === '1' || select.dataset.loaded === '1') return;
  select.dataset.loading = '1';
  try {
    const users = await dbApi.getCalendarUsers();
    const options = Array.isArray(users) ? users : [];
    select.innerHTML = '<option value="0">Только мой календарь</option>' + options
      .filter(user => Number(user.role_level ?? 1) === 1)
      .map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name || '')}</option>`)
      .join('');
    select.dataset.loaded = '1';
  } catch (error) {
    console.error('Не удалось загрузить исполнителей календаря', error);
  } finally {
    delete select.dataset.loading;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
