import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

let initialized = false;
let users = [];
let activeTaskId = '';
let previousTasks = new Map();
const LOG_PREFIX = 'legal-dashboard-calendar-audit-v2:';

function isCalendarAdmin() {
  const level = Number(getAuthSession()?.role_level || 0);
  return level >= 2 && level <= 3;
}

function taskIdFromForm(form) {
  return String(
    form?.querySelector('[name="id"]')?.value
    || form?.querySelector('[name="task_id"]')?.value
    || form?.dataset.calendarTaskId
    || form?.dataset.taskId
    || ''
  ).trim();
}

function taskLogKey(id) {
  return `${LOG_PREFIX}id:${String(id || '').trim()}`;
}

function readLogById(id) {
  if (!id) return [];
  try {
    return JSON.parse(localStorage.getItem(taskLogKey(id)) || '[]');
  } catch {
    return [];
  }
}

function writeLogById(id, rows) {
  if (!id) return;
  try {
    localStorage.setItem(taskLogKey(id), JSON.stringify(rows.slice(-100)));
  } catch {}
}

function appendLogById(id, entry) {
  if (!id) return;
  const rows = readLogById(id);
  const previous = rows[rows.length - 1];
  const next = { recorded_at: new Date().toISOString(), ...entry };
  if (previous
    && previous.date === next.date
    && previous.time === next.time
    && previous.type === next.type
    && previous.executor === next.executor
    && previous.action === next.action) return;
  rows.push(next);
  writeLogById(id, rows);
}

function currentSnapshot(form) {
  const date = form.querySelector('[name="date"], [name="date_str"]')?.value || '';
  const time = form.querySelector('[name="time"], [data-calendar-time]')?.value || '';
  const typeSelect = form.querySelector('[name="type"]');
  const type = typeSelect?.selectedOptions?.[0]?.textContent?.trim() || typeSelect?.value || '';
  const executorSelect = form.querySelector('[data-calendar-executor-field]');
  const executor = executorSelect?.selectedOptions?.[0]?.textContent?.trim() || executorSelect?.value || '';
  return { date, time, type, executor, action: 'Изменение карточки' };
}

function appendFormLog(form) {
  const id = taskIdFromForm(form);
  if (!id) return;
  appendLogById(id, currentSnapshot(form));
}

function taskSnapshot(task = {}) {
  return {
    date: String(task.date || task.date_str || task.start_date || task.session_date || ''),
    time: String(task.time || task.start_time || ''),
    type: String(task.type || task.task_type || task.kind || ''),
    executor: String(task.executor || task.user_name || task.user || task.assignee || ''),
  };
}

function trackCalendarChanges(tasks = []) {
  const nextMap = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = String(task?.id || '').trim();
    if (!id) continue;
    const next = taskSnapshot(task);
    nextMap.set(id, next);
    const previous = previousTasks.get(id);
    if (!previous) continue;

    const dateChanged = previous.date !== next.date;
    const timeChanged = previous.time !== next.time;
    const typeChanged = previous.type !== next.type;
    const executorChanged = previous.executor !== next.executor;
    if (!dateChanged && !timeChanged && !typeChanged && !executorChanged) continue;

    appendLogById(id, {
      ...next,
      action: dateChanged ? `Перенос: ${previous.date || 'без даты'} → ${next.date || 'без даты'}` : 'Изменение календарной записи',
      previous_date: previous.date,
      previous_time: previous.time,
      previous_type: previous.type,
    });
  }
  previousTasks = nextMap;
}

async function loadUsers() {
  try {
    const payload = await dbApi.getUsers();
    users = (Array.isArray(payload) ? payload : payload?.users || payload?.items || [])
      .map(user => ({
        name: String(user.full_name || user.name || user.login || '').trim(),
        active: Number(user.is_active ?? 1) === 1,
      }))
      .filter(user => user.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  } catch {
    users = [];
  }
}

function existingExecutorValue(form) {
  return form.querySelector('[name="executor"]:not([data-calendar-executor-field])')?.value
    || form.querySelector('[name="user_name"]')?.value
    || form.querySelector('[name="assignee"]')?.value
    || '';
}

function injectExecutor(form) {
  if (form.querySelector('[data-calendar-executor-field]')) return;
  const dateField = form.querySelector('[name="date"], [name="date_str"]');
  const anchor = dateField?.closest('label, .form-field, .field') || dateField?.parentElement;
  if (!anchor?.parentElement) return;

  const label = document.createElement('label');
  label.className = 'calendar-executor-field';
  label.innerHTML = '<span>Исполнитель</span><select name="executor" data-calendar-executor-field><option value="">Не выбран</option></select>';
  anchor.insertAdjacentElement('beforebegin', label);

  const select = label.querySelector('select');
  const current = existingExecutorValue(form);
  select.innerHTML = '<option value="">Не выбран</option>' + users.map(user =>
    `<option value="${escapeAttr(user.name)}" ${user.name === current ? 'selected' : ''}>${escapeHtml(user.name)}${user.active ? '' : ' — заблокирован'}</option>`
  ).join('');

  select.addEventListener('change', () => {
    const hidden = form.querySelector('[name="user_name"], [name="assignee"]');
    if (hidden) hidden.value = select.value;
  });
}

function ensureDialog() {
  let dialog = document.querySelector('[data-calendar-audit-dialog]');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'calendar-audit-dialog';
  dialog.dataset.calendarAuditDialog = '1';
  document.body.append(dialog);
  return dialog;
}

function showLogById(id) {
  const dialog = ensureDialog();
  const rows = readLogById(id).slice().reverse();
  dialog.innerHTML = `
    <div class="calendar-audit-card">
      <div class="calendar-audit-head">
        <div><h3>Лог календарной записи</h3><p>История даты, времени и типа записи</p></div>
        <button type="button" class="icon-button" data-calendar-audit-close>×</button>
      </div>
      <div class="calendar-audit-list">
        ${rows.length ? rows.map(row => `
          <div class="calendar-audit-row">
            <strong>${escapeHtml(row.action || 'Изменение')}</strong>
            <small>${escapeHtml(formatDateTime(row.recorded_at))}</small>
            <span>Дата записи: ${escapeHtml(row.date || 'не указана')}</span>
            <span>Время: ${escapeHtml(row.time || 'не указано')}</span>
            <span>Тип записи: ${escapeHtml(row.type || 'не указан')}</span>
            ${row.executor ? `<span>Исполнитель: ${escapeHtml(row.executor)}</span>` : ''}
          </div>
        `).join('') : '<div class="calendar-audit-empty">История изменений пока отсутствует.</div>'}
      </div>
      <div class="calendar-audit-actions"><button type="button" class="btn primary" data-calendar-audit-close>Закрыть</button></div>
    </div>`;
  dialog.querySelectorAll('[data-calendar-audit-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  if (!dialog.open) dialog.showModal();
}

function injectLogButton(form) {
  const id = taskIdFromForm(form);
  if (!isCalendarAdmin() || form.querySelector('[data-calendar-audit-open]') || !id) return;
  const actions = form.querySelector('.form-actions, [data-calendar-form-actions], footer') || form;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary calendar-audit-button';
  button.dataset.calendarAuditOpen = '1';
  button.textContent = 'Лог изменений';
  button.addEventListener('click', () => showLogById(id));
  actions.append(button);
}

function injectDetailLogButton() {
  if (!isCalendarAdmin() || !activeTaskId) return;
  const dialog = document.querySelector('[data-calendar-detail-dialog]');
  if (!dialog || dialog.querySelector('[data-calendar-detail-audit]')) return;
  const actions = dialog.querySelector('.form-actions, .dialog-actions, footer') || dialog;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary calendar-audit-button';
  button.dataset.calendarDetailAudit = '1';
  button.textContent = 'Лог изменений';
  button.addEventListener('click', () => showLogById(activeTaskId));
  actions.append(button);
}

function enhanceForms(root = document) {
  root.querySelectorAll?.('[data-calendar-task-form]').forEach(form => {
    injectExecutor(form);
    injectLogButton(form);
  });
  injectDetailLogButton();
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('ru-RU');
}

export function initCalendarExecutorAudit() {
  if (initialized) return;
  initialized = true;
  void loadUsers().finally(() => enhanceForms());

  const observer = new MutationObserver(() => enhanceForms());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('calendar:updated', event => {
    trackCalendarChanges(event.detail?.tasks || []);
    enhanceForms();
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-calendar-task-form]');
    if (!form) return;
    setTimeout(() => appendFormLog(form), 0);
  }, true);

  document.addEventListener('click', event => {
    const taskNode = event.target.closest?.('[data-calendar-task-id], [data-calendar-week-task-id]');
    if (taskNode) {
      activeTaskId = String(taskNode.dataset.calendarTaskId || taskNode.dataset.calendarWeekTaskId || '');
      setTimeout(() => injectDetailLogButton(), 0);
    }

    if (event.target.closest?.('[data-calendar-task-form] [type="submit"], [data-calendar-task-form] [data-calendar-save]')) {
      const form = event.target.closest('[data-calendar-task-form]');
      if (form) setTimeout(() => appendFormLog(form), 80);
    }
  }, true);
}
