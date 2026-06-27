import { dbApi } from '../../api/dbApi.js';

const state = { initialized: false, tasks: [], timer: null, overlay: null, timeline: null, open: false };

export function initReportsDayTasksOverlay() {
  if (state.initialized) return;
  state.initialized = true;
  const root = document.querySelector('[data-reports-root]');
  if (!root) return;

  root.addEventListener('submit', () => schedule(520), true);
  root.addEventListener('change', event => {
    if (event.target.closest('[data-reports-filters]')) schedule(520);
  }, true);
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reports-refresh], [data-reports-reset]')) schedule(520);
  }, true);
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') schedule(420);
    else hideOverlay();
  });
  window.addEventListener('resize', positionOverlay);
  document.addEventListener('scroll', positionOverlay, true);
  document.addEventListener('click', handleOverlayClick, true);
  schedule(650);
}

function schedule(delay = 300) {
  clearTimeout(state.timer);
  state.timer = setTimeout(loadTasks, delay);
}

async function loadTasks() {
  const root = document.querySelector('[data-reports-root]');
  const dayMode = root?.querySelector('[data-reports-mode]:checked')?.value !== 'quarter';
  if (!root || !dayMode || !root.classList.contains('active')) {
    hideOverlay();
    return;
  }

  const date = root.querySelector('[data-reports-date]')?.value || todayIso();
  const session = await dbApi.getCurrentSession().catch(() => ({}));
  const users = selectedUsers(root, session);
  const groups = users.length
    ? await Promise.all(users.map(user => dbApi.getCalendarTasks({ date, user }).catch(() => [])))
    : [await dbApi.getCalendarTasks({ date }).catch(() => [])];

  const map = new Map();
  groups.flat().forEach(task => {
    if (String(task.event_scope || 'work') === 'personal') return;
    if (!coversDate(task, date)) return;
    const key = String(task.id || `${taskDate(task)}|${taskTime(task)}|${task.description || task.desc}`);
    map.set(key, task);
  });
  state.tasks = [...map.values()].sort((a, b) => String(taskTime(a)).localeCompare(String(taskTime(b))));
  if (!state.tasks.length) state.open = false;
  renderOverlay(date);
}

function selectedUsers(root, session) {
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  const canManage = Number(session.role_level || 0) >= 2 || permissions.includes('reports.manageAll');
  if (!canManage) return [String(session.full_name || '').trim()].filter(Boolean);
  if (root.querySelector('[data-reports-all-users]')?.checked) return [];
  const select = root.querySelector('[data-reports-users]');
  return select ? [...select.selectedOptions].map(option => option.textContent?.split('—')[0].trim()).filter(Boolean) : [];
}

function renderOverlay(date) {
  const root = document.querySelector('[data-reports-root]');
  const timeline = root?.querySelector('[data-reports-timeline]');
  if (!timeline) return;
  state.timeline = timeline;
  timeline.style.visibility = 'hidden';
  timeline.style.minHeight = state.open ? `${Math.min(530, 205 + state.tasks.length * 70)}px` : '190px';
  const overlay = ensureOverlay();
  overlay.hidden = false;
  overlay.innerHTML = `
    <div class="reports-day-task-summary">
      <button class="reports-day-task-count" type="button" data-reports-day-task-toggle aria-expanded="${state.open ? 'true' : 'false'}">
        <strong>${state.tasks.length}</strong><span>${declineTasks(state.tasks.length)} за ${formatDate(date)}</span>
      </button>
      <p>${state.tasks.length ? 'Нажмите на количество, чтобы открыть список задач из плана календаря.' : 'На выбранную дату задач в календаре нет.'}</p>
      <div class="reports-day-task-list" ${state.open && state.tasks.length ? '' : 'hidden'}>
        ${state.tasks.map(task => `<button type="button" data-reports-day-task-id="${escapeAttr(task.id)}">
          <b>${escapeHtml(taskTime(task) || 'Без времени')}</b>
          <span>${escapeHtml(task.description || task.desc || task.assignment || 'Задача')}</span>
          <small>${escapeHtml(taskLabel(task))}${taskOwner(task) ? ` · ${escapeHtml(taskOwner(task))}` : ''}</small>
        </button>`).join('')}
      </div>
    </div>`;
  positionOverlay();
}

function ensureOverlay() {
  if (state.overlay?.isConnected) return state.overlay;
  const node = document.createElement('div');
  node.className = 'reports-day-task-overlay';
  node.hidden = true;
  document.body.append(node);
  state.overlay = node;
  return node;
}

function handleOverlayClick(event) {
  if (!state.overlay?.contains(event.target)) return;
  const toggle = event.target.closest('[data-reports-day-task-toggle]');
  if (toggle) {
    state.open = !state.open;
    renderOverlay(document.querySelector('[data-reports-date]')?.value || todayIso());
    return;
  }
  const button = event.target.closest('[data-reports-day-task-id]');
  if (!button) return;
  const task = state.tasks.find(item => String(item.id) === String(button.dataset.reportsDayTaskId));
  if (!task) return;
  hideOverlay();
  if (typeof window.openView === 'function') window.openView('calendar');
  else document.querySelector('[data-view="calendar"]')?.click();
  setTimeout(() => window.dispatchEvent(new CustomEvent('calendar:select-date', { detail: { date: taskDate(task) } })), 120);
  setTimeout(() => window.dispatchEvent(new CustomEvent('calendar:edit-task', { detail: { task } })), 360);
}

function positionOverlay() {
  if (!state.overlay || state.overlay.hidden || !state.timeline?.isConnected) return;
  const rect = state.timeline.getBoundingClientRect();
  state.overlay.style.left = `${rect.left + window.scrollX}px`;
  state.overlay.style.top = `${rect.top + window.scrollY}px`;
  state.overlay.style.width = `${rect.width}px`;
  state.overlay.style.minHeight = `${Math.max(190, rect.height)}px`;
}

function hideOverlay() {
  if (state.overlay) state.overlay.hidden = true;
  if (state.timeline) {
    state.timeline.style.visibility = '';
    state.timeline.style.minHeight = '';
  }
}

function coversDate(task, date) {
  const start = taskDate(task);
  const end = normalizeDate(task.end_date) || start;
  return Boolean(start && start <= date && end >= date);
}
function taskDate(task) { return normalizeDate(task.date_str || task.date || task.start_date); }
function normalizeDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function taskTime(task) { return String(task.time_val || task.time || '').trim(); }
function taskOwner(task) { return String(task.user_name || task.user || task.delegated_to || '').trim(); }
function taskLabel(task) { return String(task.task_type || task.type || 'Рабочая задача').replaceAll('_', ' '); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function formatDate(value) { const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : value; }
function declineTasks(value) { const n = Math.abs(Number(value)); const last = n % 10; const lastTwo = n % 100; return last === 1 && lastTwo !== 11 ? 'задача' : [2,3,4].includes(last) && ![12,13,14].includes(lastTwo) ? 'задачи' : 'задач'; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function escapeAttr(value) { return escapeHtml(value); }
