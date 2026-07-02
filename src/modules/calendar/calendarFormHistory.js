import { getAuthSession } from '../../auth/session.js';

let initialized = false;
const LOG_PREFIX = 'legal-dashboard-calendar-audit-v3:';

function canViewHistory() {
  const level = Number(getAuthSession()?.role_level || 0);
  return level >= 2 && level <= 3;
}

function taskId(form) {
  return String(
    form?.querySelector('[name="id"]')?.value
    || form?.querySelector('[name="task_id"]')?.value
    || form?.dataset.calendarTaskId
    || form?.dataset.taskId
    || ''
  ).trim();
}

function readRows(id) {
  if (!id) return [];
  try {
    return JSON.parse(localStorage.getItem(`${LOG_PREFIX}id:${id}`) || '[]');
  } catch {
    return [];
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

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('ru-RU');
}

function renderRows(rows) {
  if (!rows.length) return '<div class="calendar-audit-empty">История изменений пока отсутствует.</div>';
  return rows.slice().reverse().map(row => `
    <div class="calendar-audit-row">
      <strong>${escapeHtml(row.action || 'Изменение')}</strong>
      <small>${escapeHtml(formatDateTime(row.recorded_at))}</small>
      <span>Дата: ${escapeHtml(row.date || 'не указана')}</span>
      <span>Время: ${escapeHtml(row.time || 'не указано')}</span>
      <span>Тип записи: ${escapeHtml(row.type || 'не указан')}</span>
      ${row.executor ? `<span>Исполнитель: ${escapeHtml(row.executor)}</span>` : ''}
    </div>
  `).join('');
}

function inject(form) {
  if (!canViewHistory()) return;
  const id = taskId(form);
  const existing = form.querySelector('[data-calendar-form-history]');
  if (!id) {
    existing?.remove();
    return;
  }

  const rows = readRows(id);
  const section = existing || document.createElement('section');
  section.className = 'calendar-inline-history calendar-form-history';
  section.dataset.calendarFormHistory = '1';
  section.innerHTML = `
    <div class="calendar-inline-history-head">
      <h4>История записи</h4>
      <span>${rows.length}</span>
    </div>
    <div class="calendar-audit-list">${renderRows(rows)}</div>
  `;

  if (!existing) {
    const actions = form.querySelector('.form-actions, [data-calendar-form-actions], footer');
    if (actions) actions.insertAdjacentElement('beforebegin', section);
    else form.append(section);
  }
}

function refresh(root = document) {
  root.querySelectorAll?.('[data-calendar-task-form]').forEach(inject);
}

export function initCalendarFormHistory() {
  if (initialized) return;
  initialized = true;
  refresh();

  const observer = new MutationObserver(() => refresh());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('calendar:updated', () => refresh());
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-calendar-task-id], [data-calendar-week-task-id], [data-calendar-save]')) {
      setTimeout(() => refresh(), 80);
      setTimeout(() => refresh(), 220);
    }
  }, true);
}
