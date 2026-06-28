import { dbApi } from '../../api/dbApi.js';
import { getCurrentUserName } from '../../auth/session.js';

let initialized = false;
let timer = 0;

export function initDashboardTodaySync() {
  if (initialized) return;
  initialized = true;

  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(refresh, 120);
  };

  window.addEventListener('app:view-changed', schedule);
  window.addEventListener('calendar:updated', schedule);
  window.addEventListener('calendar:reload', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}

async function refresh() {
  const board = document.querySelector('[data-calendar-kanban-board]');
  const column = board?.querySelector('.calendar-widget-kanban-column.today');
  const list = column?.querySelector('.calendar-widget-kanban-list');
  const count = column?.querySelector('.calendar-widget-kanban-column-head span');
  if (!list || !count) return;

  const today = isoToday();
  let rows = [];
  try {
    rows = await dbApi.getCalendarTasks({ start: today, end: today, user: getCurrentUserName() });
  } catch {
    return;
  }

  const tasks = (Array.isArray(rows) ? rows : [])
    .filter(row => taskDate(row) === today)
    .sort((a, b) => taskTime(a).localeCompare(taskTime(b)));

  count.textContent = String(tasks.length);
  list.innerHTML = tasks.length ? tasks.map(renderTask).join('') : '<div class="calendar-widget-kanban-empty">Пусто</div>';
}

function renderTask(task) {
  const id = task.id ?? task.task_id ?? '';
  const title = task.description || task.desc || task.assignment || task.subject || 'Без описания';
  const subtitle = task.court || task.subject || '';
  const type = task.task_type || task.type || 'задача';
  const done = isDone(task);
  return `<article class="calendar-widget-kanban-task${done ? ' is-done' : ''}" data-calendar-widget-kanban-task="${escapeHtml(id)}"><div class="calendar-widget-kanban-task-top"><b>${escapeHtml(taskTime(task))}</b><span>${escapeHtml(type)}</span></div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(subtitle)}</p>${done ? '<em>Исполнено</em>' : ''}</article>`;
}

function taskDate(task) {
  const value = String(task?.date_str || task?.date || task?.start_date || task?.deadline || '').trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return ru ? `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}` : '';
}

function taskTime(task) {
  return String(task?.time_val || task?.time || task?.start_time || '').trim();
}

function isDone(task) {
  if (Number(task?.done || task?.is_done || task?.completed || 0) === 1) return true;
  return ['done', 'completed', 'выполнено', 'исполнено'].includes(String(task?.status || '').toLocaleLowerCase('ru-RU').trim());
}

function isoToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
