let initialized = false;
let activeMoveTaskId = '';
let taskSnapshots = new Map();
const LOG_PREFIX = 'legal-dashboard-calendar-audit-v3:';

function snapshot(task = {}) {
  return {
    id: String(task.id || ''),
    date: String(task.date || task.date_str || task.start_date || task.session_date || ''),
    time: String(task.time || task.start_time || ''),
    type: String(task.type || task.task_type || task.kind || ''),
    executor: String(task.executor || task.user_name || task.user || task.assignee || ''),
  };
}

function readRows(id) {
  try {
    return JSON.parse(localStorage.getItem(`${LOG_PREFIX}id:${id}`) || '[]');
  } catch {
    return [];
  }
}

function appendMove(id, targetDate, targetTime) {
  const before = taskSnapshots.get(String(id)) || {};
  const rows = readRows(id);
  const entry = {
    recorded_at: new Date().toISOString(),
    action: `Перенесено: ${before.date || 'без даты'} → ${targetDate || 'без даты'}`,
    date: targetDate || before.date || '',
    time: targetTime || before.time || '',
    type: before.type || '',
    executor: before.executor || '',
    previous_date: before.date || '',
    previous_time: before.time || '',
  };
  const last = rows[rows.length - 1];
  if (last && last.action === entry.action && last.date === entry.date && last.time === entry.time) return;
  rows.push(entry);
  try {
    localStorage.setItem(`${LOG_PREFIX}id:${id}`, JSON.stringify(rows.slice(-100)));
  } catch {}
  window.dispatchEvent(new CustomEvent('calendar:audit-updated', { detail: { taskId: String(id) } }));
}

function captureTaskFromNode(node) {
  const taskNode = node?.closest?.('[data-calendar-week-task-id], [data-calendar-task-id]');
  if (!taskNode) return;
  activeMoveTaskId = String(taskNode.dataset.calendarWeekTaskId || taskNode.dataset.calendarTaskId || '');
}

function getTargetDate() {
  const explicit = document.querySelector('[data-calendar-move-time-date]')?.textContent?.trim()
    || document.querySelector('[data-calendar-move-date]')?.textContent?.trim()
    || '';
  const ru = explicit.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return explicit;
}

export function initCalendarMoveAuditBridge() {
  if (initialized) return;
  initialized = true;

  window.addEventListener('calendar:updated', event => {
    const next = new Map();
    for (const task of Array.isArray(event.detail?.tasks) ? event.detail.tasks : []) {
      const item = snapshot(task);
      if (item.id) next.set(item.id, item);
    }
    taskSnapshots = next;
  });

  document.addEventListener('dragstart', event => captureTaskFromNode(event.target), true);
  document.addEventListener('pointerdown', event => captureTaskFromNode(event.target), true);
  document.addEventListener('mousedown', event => captureTaskFromNode(event.target), true);

  document.addEventListener('click', event => {
    const saveWithTime = event.target.closest?.('[data-calendar-time-move-save]');
    const saveWithoutTime = event.target.closest?.('[data-calendar-move-no]');
    if (!saveWithTime && !saveWithoutTime) return;
    const id = activeMoveTaskId;
    if (!id) return;
    const targetDate = getTargetDate();
    const targetTime = saveWithTime
      ? String(document.querySelector('[data-calendar-move-time-input]')?.value || '').trim()
      : String(taskSnapshots.get(id)?.time || '');
    setTimeout(() => appendMove(id, targetDate, targetTime), 120);
  }, true);
}
