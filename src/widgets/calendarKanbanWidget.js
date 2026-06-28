import { dbApi } from '../api/dbApi.js';
import { getCurrentUserName } from '../auth/session.js';

let state = {
  tasks: [],
  pendingDeleteId: null,
  clickTimer: null
};

export function renderCalendarKanbanWidget() {
  requestAnimationFrame(loadKanbanWidget);

  return `
    <div class="calendar-widget-kanban-plan" data-calendar-kanban-widget>
      <div class="calendar-widget-kanban-board" data-calendar-kanban-board>
        <div class="muted">Загрузка плана...</div>
      </div>

      <dialog class="calendar-widget-delete-dialog" data-calendar-widget-delete-dialog>
        <div class="calendar-widget-delete-head">
          <h3>Удалить запись?</h3>
        </div>
        <div class="calendar-widget-delete-actions">
          <button class="btn danger" data-calendar-widget-delete-yes type="button">Да</button>
          <button class="btn" data-calendar-widget-delete-no type="button">Нет</button>
          <button class="btn" data-calendar-widget-delete-back type="button">Назад</button>
        </div>
      </dialog>
    </div>
  `;
}

document.addEventListener('click', event => {
  const card = event.target.closest('[data-calendar-widget-kanban-task]');
  if (card) {
    const id = Number(card.dataset.calendarWidgetKanbanTask);
    clearTimeout(state.clickTimer);
    state.clickTimer = setTimeout(() => editTask(id), 220);
  }

  if (event.target.closest('[data-calendar-widget-delete-yes]')) confirmDeleteTask();
  if (event.target.closest('[data-calendar-widget-delete-no]') || event.target.closest('[data-calendar-widget-delete-back]')) closeDeleteDialog();
});

document.addEventListener('dblclick', event => {
  const card = event.target.closest('[data-calendar-widget-kanban-task]');
  if (!card) return;
  event.preventDefault();
  clearTimeout(state.clickTimer);
  state.pendingDeleteId = Number(card.dataset.calendarWidgetKanbanTask);
  document.querySelector('[data-calendar-widget-delete-dialog]')?.showModal();
});

window.addEventListener('calendar:updated', loadKanbanWidget);
window.addEventListener('calendar:reload', loadKanbanWidget);

window.addEventListener('app:view-changed', event => {
  const viewId = event.detail?.viewId || '';
  if (viewId === 'dashboard') loadKanbanWidget();
});

async function loadKanbanWidget() {
  if (!document.querySelector('[data-calendar-kanban-widget]')) return;

  const today = toIsoDate(new Date());
  const start = offsetIso(-370);
  const end = offsetIso(1);
  const user = getCurrentUserName();

  try {
    const [rangeRows, todayRows] = await Promise.all([
      dbApi.getCalendarTasks({ start, end, user }),
      dbApi.getCalendarTasks({ date: today, user })
    ]);

    state.tasks = mergeTasks(rangeRows, todayRows);
    renderKanban();
  } catch {
    const board = document.querySelector('[data-calendar-kanban-board]');
    if (board) board.innerHTML = '<div class="muted">Данные загрузятся после открытия календаря.</div>';
  }
}

function mergeTasks(...groups) {
  const result = [];
  const seen = new Set();

  for (const group of groups) {
    for (const task of Array.isArray(group) ? group : []) {
      const id = task.id ?? task.task_id;
      const key = id != null
        ? `id:${id}`
        : `${getTaskDate(task)}|${getTaskTime(task)}|${getTaskDescription(task)}|${task.user_name || task.user || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(task);
    }
  }

  return result;
}

function renderKanban() {
  const board = document.querySelector('[data-calendar-kanban-board]');
  if (!board) return;

  const columns = buildColumns();

  board.innerHTML = columns.map(column => `
    <section class="calendar-widget-kanban-column ${column.key}">
      <div class="calendar-widget-kanban-column-head">
        <strong>${column.title}</strong>
        <span>${column.tasks.length}</span>
      </div>
      <div class="calendar-widget-kanban-list">
        ${column.tasks.map(renderTaskCard).join('') || '<div class="calendar-widget-kanban-empty">Пусто</div>'}
      </div>
    </section>
  `).join('');
}

function buildColumns() {
  const today = toIsoDate(new Date());
  const tomorrow = offsetIso(1);

  const columns = [
    { key: 'today', title: 'Сегодня', tasks: [] },
    { key: 'tomorrow', title: 'Завтра', tasks: [] },
    { key: 'overdue', title: 'Просрочено', tasks: [] }
  ];

  for (const task of state.tasks) {
    const date = getTaskDate(task);
    if (!date) continue;

    if (date === today) {
      columns[0].tasks.push(task);
      continue;
    }

    if (isDone(task)) continue;
    if (isOverdue(task, today)) columns[2].tasks.push(task);
    else if (date === tomorrow) columns[1].tasks.push(task);
  }

  for (const column of columns) {
    column.tasks.sort((a, b) => `${getTaskDate(a)} ${getTaskTime(a)}`.localeCompare(`${getTaskDate(b)} ${getTaskTime(b)}`));
  }

  return columns;
}

function renderTaskCard(task) {
  const id = task.id ?? task.task_id;
  const done = isDone(task);
  return `
    <article class="calendar-widget-kanban-task ${done ? 'is-done' : ''}" data-calendar-widget-kanban-task="${id}">
      <div class="calendar-widget-kanban-task-top">
        <b>${escapeHtml(getTaskTime(task) || formatRuDate(getTaskDate(task)))}</b>
        <span>${escapeHtml(getTaskType(task) || 'задача')}</span>
      </div>
      <strong>${escapeHtml(getTaskDescription(task) || task.assignment || task.subject || 'Без описания')}</strong>
      <p>${escapeHtml(task.court || task.subject || task.assignment || '')}</p>
      ${done ? '<em>Исполнено</em>' : ''}
    </article>
  `;
}

function editTask(id) {
  const task = state.tasks.find(item => Number(item.id ?? item.task_id) === Number(id));
  if (!task) return;
  window.openView?.('calendar');
  window.dispatchEvent(new CustomEvent('calendar:edit-task', { detail: { task } }));
}

async function confirmDeleteTask() {
  const id = state.pendingDeleteId;
  if (!id) return;

  try {
    await dbApi.deleteCalendarTask(id);
    closeDeleteDialog();
    await loadKanbanWidget();
    window.dispatchEvent(new CustomEvent('calendar:reload'));
  } catch (error) {
    alert('Не удалось удалить запись:\n' + error.message);
  }
}

function closeDeleteDialog() {
  state.pendingDeleteId = null;
  document.querySelector('[data-calendar-widget-delete-dialog]')?.close();
}

function isOverdue(task, today) {
  const date = getTaskDate(task);
  if (date < today) return true;
  if (date !== today) return false;

  const time = getTaskTime(task);
  if (!time) return false;

  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;

  const now = new Date();
  const taskTime = new Date();
  taskTime.setHours(hours, minutes, 0, 0);
  return taskTime < now;
}

function isDone(task) {
  if (Number(task?.done || task?.is_done || task?.completed || 0) === 1) return true;
  const status = String(task?.status || '').toLocaleLowerCase('ru-RU').trim();
  return ['done', 'completed', 'выполнено', 'исполнено'].includes(status)
    || String(task?.done || '').toLowerCase() === 'true';
}

function getTaskDate(task) {
  return normalizeDate(task?.date_str || task?.date || task?.start_date || task?.deadline || task?.event_date || '');
}
function getTaskTime(task) { return task?.time_val || task?.time || task?.start_time || ''; }
function getTaskType(task) { return task?.task_type || task?.type || ''; }
function getTaskDescription(task) { return task?.description || task?.desc || task?.title || ''; }

function normalizeDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return ru ? `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}` : '';
}

function offsetIso(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return toIsoDate(date);
}

function toIsoDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function formatRuDate(value) {
  const [y, m, d] = String(value || '').split('-');
  return d && m && y ? `${d}.${m}.${y}` : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
