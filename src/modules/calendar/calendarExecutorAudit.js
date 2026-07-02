import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

let initialized = false;
let users = [];
const LOG_PREFIX = 'legal-dashboard-calendar-audit-v1:';

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

function logKey(form) {
  const id = taskIdFromForm(form);
  if (id) return `${LOG_PREFIX}id:${id}`;
  const date = form?.querySelector('[name="date"], [name="date_str"]')?.value || '';
  const time = form?.querySelector('[name="time"], [data-calendar-time]')?.value || '';
  const type = form?.querySelector('[name="type"]')?.value || '';
  return `${LOG_PREFIX}draft:${date}|${time}|${type}`;
}

function readLog(form) {
  try {
    return JSON.parse(localStorage.getItem(logKey(form)) || '[]');
  } catch {
    return [];
  }
}

function writeLog(form, rows) {
  try {
    localStorage.setItem(logKey(form), JSON.stringify(rows.slice(-100)));
  } catch {}
}

function currentSnapshot(form) {
  const date = form.querySelector('[name="date"], [name="date_str"]')?.value || '';
  const time = form.querySelector('[name="time"], [data-calendar-time]')?.value || '';
  const typeSelect = form.querySelector('[name="type"]');
  const type = typeSelect?.selectedOptions?.[0]?.textContent?.trim() || typeSelect?.value || '';
  const executorSelect = form.querySelector('[data-calendar-executor-field]');
  const executor = executorSelect?.selectedOptions?.[0]?.textContent?.trim() || executorSelect?.value || '';
  return {
    recorded_at: new Date().toISOString(),
    date,
    time,
    type,
    executor,
  };
}

function appendLog(form) {
  if (!taskIdFromForm(form)) return;
  const rows = readLog(form);
  const next = currentSnapshot(form);
  const previous = rows[rows.length - 1];
  if (previous && previous.date === next.date && previous.time === next.time && previous.type === next.type && previous.executor === next.executor) return;
  rows.push(next);
  writeLog(form, rows);
}

async function loadUsers() {
  try {
    const payload = await dbApi.getUsers();
    users = (Array.isArray(payload) ? payload : payload?.users || payload?.items || [])
      .map(user => ({
        id: Number(user.id || user.user_id || 0),
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

function showLog(form) {
  const dialog = ensureDialog();
  const rows = readLog(form).slice().reverse();
  dialog.innerHTML = `
    <div class="calendar-audit-card">
      <div class="calendar-audit-head">
        <div><h3>Лог календарной записи</h3><p>Дата, время и тип записи</p></div>
        <button type="button" class="icon-button" data-calendar-audit-close>×</button>
      </div>
      <div class="calendar-audit-list">
        ${rows.length ? rows.map(row => `
          <div class="calendar-audit-row">
            <strong>${escapeHtml(formatDateTime(row.recorded_at))}</strong>
            <span>Дата: ${escapeHtml(row.date || 'не указана')}</span>
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
  if (!isCalendarAdmin() || form.querySelector('[data-calendar-audit-open]') || !taskIdFromForm(form)) return;
  const actions = form.querySelector('.form-actions, [data-calendar-form-actions], footer') || form;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary calendar-audit-button';
  button.dataset.calendarAuditOpen = '1';
  button.textContent = 'Лог';
  button.addEventListener('click', () => showLog(form));
  actions.append(button);
}

function enhanceForms(root = document) {
  root.querySelectorAll?.('[data-calendar-task-form]').forEach(form => {
    injectExecutor(form);
    injectLogButton(form);
  });
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

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-calendar-task-form]');
    if (!form) return;
    setTimeout(() => appendLog(form), 0);
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-calendar-task-form] [type="submit"], [data-calendar-task-form] [data-calendar-save]')) {
      const form = event.target.closest('[data-calendar-task-form]');
      if (form) setTimeout(() => appendLog(form), 50);
    }
  }, true);
}
