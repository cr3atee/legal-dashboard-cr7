import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

let initialized = false;
let users = [];
let activeTaskId = '';
let activeMoveTaskId = '';
let taskSnapshots = new Map();
const LOG_PREFIX = 'legal-dashboard-calendar-move-history-v1:';

function canViewHistory() {
  return Number(getAuthSession()?.role_level || 0) >= 2;
}

function snapshotTask(task = {}) {
  return {
    id: String(task.id || ''),
    date: String(task.date || task.date_str || task.start_date || task.session_date || ''),
    time: String(task.time || task.start_time || ''),
    type: String(task.type || task.task_type || task.kind || ''),
    executor: String(task.executor || task.user_name || task.user || task.assignee || ''),
  };
}

function historyKey(id) {
  return `${LOG_PREFIX}${String(id || '').trim()}`;
}

function readHistory(id) {
  if (!id) return [];
  try {
    return JSON.parse(localStorage.getItem(historyKey(id)) || '[]');
  } catch {
    return [];
  }
}

function writeHistory(id, rows) {
  if (!id) return;
  try {
    localStorage.setItem(historyKey(id), JSON.stringify(rows.slice(-100)));
  } catch {}
}

function addMoveHistory(id, targetDate, targetTime) {
  const before = taskSnapshots.get(String(id));
  if (!before || !targetDate || before.date === targetDate && before.time === targetTime) return;

  const rows = readHistory(id);
  const entry = {
    changed_at: new Date().toISOString(),
    old_date: before.date,
    new_date: targetDate,
    old_time: before.time,
    new_time: targetTime || before.time || '',
    type: before.type,
    executor: before.executor,
  };
  const last = rows[rows.length - 1];
  if (last && last.old_date === entry.old_date && last.new_date === entry.new_date && last.new_time === entry.new_time) return;
  rows.push(entry);
  writeHistory(id, rows);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '—');
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('ru-RU');
}

function getFormTaskId(form) {
  return String(
    form?.querySelector('[name="id"]')?.value
    || form?.querySelector('[name="task_id"]')?.value
    || activeTaskId
    || ''
  ).trim();
}

function renderHistory(form) {
  if (!canViewHistory() || !form) return;
  const id = getFormTaskId(form);
  if (!id) return;

  form.querySelector('[data-calendar-move-history]')?.remove();
  const rows = readHistory(id).slice().reverse();
  const section = document.createElement('section');
  section.className = 'calendar-move-history';
  section.dataset.calendarMoveHistory = '1';
  section.innerHTML = `
    <div class="calendar-move-history-head">
      <h4>История переносов</h4>
      <span>${rows.length}</span>
    </div>
    <div class="calendar-move-history-list">
      ${rows.length ? rows.map(row => `
        <div class="calendar-move-history-row">
          <strong>${escapeHtml(formatDate(row.old_date))} → ${escapeHtml(formatDate(row.new_date))}</strong>
          <small>${escapeHtml(formatDateTime(row.changed_at))}</small>
          <span>Время: ${escapeHtml(row.old_time || 'не указано')} → ${escapeHtml(row.new_time || 'не указано')}</span>
          ${row.type ? `<span>Тип записи: ${escapeHtml(row.type)}</span>` : ''}
          ${row.executor ? `<span>Исполнитель: ${escapeHtml(row.executor)}</span>` : ''}
        </div>
      `).join('') : '<div class="calendar-move-history-empty">Переносов пока не было.</div>'}
    </div>`;

  const actions = form.querySelector('.form-actions, [data-calendar-form-actions], footer');
  if (actions) actions.insertAdjacentElement('beforebegin', section);
  else form.append(section);
}

async function loadUsers() {
  try {
    const payload = await dbApi.getUsers();
    users = (Array.isArray(payload) ? payload : payload?.users || payload?.items || [])
      .map(user => String(user.full_name || user.name || user.login || '').trim())
      .filter(Boolean)
      .filter((name, index, list) => list.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b, 'ru'));
  } catch {
    users = [];
  }
}

function injectExecutor(form) {
  if (!form || form.querySelector('[data-calendar-executor-field]')) return;
  const dateInput = form.querySelector('[name="date"], [name="date_str"]');
  const anchor = dateInput?.closest('label, .form-field, .field') || dateInput?.parentElement;
  if (!anchor?.parentElement) return;

  const current = form.querySelector('[name="executor"], [name="user_name"], [name="assignee"]')?.value || '';
  const label = document.createElement('label');
  label.className = 'calendar-executor-field';
  label.innerHTML = `<span>Исполнитель</span><select name="executor" data-calendar-executor-field>
    <option value="">Не выбран</option>
    ${users.map(name => `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
  </select>`;
  anchor.insertAdjacentElement('beforebegin', label);
}

function enhanceOpenForm() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form) return;
  injectExecutor(form);
  renderHistory(form);
}

function captureTaskNode(node) {
  const taskNode = node?.closest?.('[data-calendar-week-task-id], [data-calendar-task-id]');
  if (!taskNode) return;
  const id = String(taskNode.dataset.calendarWeekTaskId || taskNode.dataset.calendarTaskId || '');
  if (!id) return;
  activeTaskId = id;
  activeMoveTaskId = id;
}

function readTargetDate() {
  const text = document.querySelector('[data-calendar-move-time-date]')?.textContent?.trim()
    || document.querySelector('[data-calendar-move-date]')?.textContent?.trim()
    || '';
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

export function initCalendarMoveHistory() {
  if (initialized) return;
  initialized = true;
  void loadUsers();

  window.addEventListener('calendar:updated', event => {
    const next = new Map();
    for (const task of Array.isArray(event.detail?.tasks) ? event.detail.tasks : []) {
      const item = snapshotTask(task);
      if (item.id) next.set(item.id, item);
    }
    taskSnapshots = next;
  });

  window.addEventListener('calendar:edit-task', event => {
    activeTaskId = String(event.detail?.task?.id || activeTaskId || '');
    setTimeout(enhanceOpenForm, 60);
  });

  document.addEventListener('pointerdown', event => captureTaskNode(event.target), true);
  document.addEventListener('dragstart', event => captureTaskNode(event.target), true);

  document.addEventListener('click', event => {
    const taskNode = event.target.closest?.('[data-calendar-week-task-id], [data-calendar-task-id]');
    if (taskNode) {
      captureTaskNode(taskNode);
      setTimeout(enhanceOpenForm, 60);
      setTimeout(enhanceOpenForm, 180);
      return;
    }

    if (event.target.closest?.('[data-calendar-new-task], [data-calendar-add], [data-calendar-day-add]')) {
      activeTaskId = '';
      setTimeout(enhanceOpenForm, 80);
      return;
    }

    const saveWithTime = event.target.closest?.('[data-calendar-time-move-save]');
    const saveWithoutTime = event.target.closest?.('[data-calendar-move-no]');
    if (!saveWithTime && !saveWithoutTime) return;

    const id = activeMoveTaskId;
    const targetDate = readTargetDate();
    const before = taskSnapshots.get(id);
    const targetTime = saveWithTime
      ? String(document.querySelector('[data-calendar-move-time-input]')?.value || '').trim()
      : String(before?.time || '');
    addMoveHistory(id, targetDate, targetTime);
  }, true);
}
