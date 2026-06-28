import { dbApi } from '../../api/dbApi.js';

const state = {
  initialized: false,
  timer: null,
  observer: null,
  refreshing: false,
  hearings: new Map(),
  remaining: new Map(),
  controlled: [],
  dialogItems: new Map()
};

export function initReportsDayDataFix() {
  if (state.initialized) return;
  state.initialized = true;

  ensureDialog();
  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', event => {
    if (event.target.closest?.('[data-reports-root]')) scheduleRefresh(260);
  });
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') scheduleRefresh(300);
  });
  observeGrid();
  scheduleRefresh(400);
}

function observeGrid() {
  const grid = document.querySelector('[data-reports-employee-cards]');
  if (!grid || state.observer) return;
  state.observer = new MutationObserver(() => {
    if (!state.refreshing) scheduleRefresh(120);
  });
  state.observer.observe(grid, { childList: true, subtree: true });
}

function scheduleRefresh(delay = 120) {
  clearTimeout(state.timer);
  state.timer = window.setTimeout(refresh, delay);
}

async function refresh() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || root.dataset.reportsMode !== 'day') return;
  const cards = [...root.querySelectorAll('.reports-employee-card')];
  if (!cards.length) return;

  state.refreshing = true;
  try {
    const date = root.querySelector('[data-reports-date]')?.value || todayIso();
    const names = cards.map(card => String(card.querySelector('h4')?.textContent || '').trim()).filter(Boolean);
    const [scheduleRows, controlledRows, ...taskLists] = await Promise.all([
      dbApi.getCourtSchedule().catch(() => []),
      dbApi.getControlledCases().catch(() => []),
      ...names.map(name => dbApi.getCalendarTasks({ date, user: name }).catch(() => []))
    ]);

    state.hearings.clear();
    state.remaining.clear();

    cards.forEach((card, index) => {
      const name = names[index] || '';
      const hearings = array(scheduleRows).filter(row => isScheduleCase(row) && sameDate(scheduleDate(row), date) && samePerson(schedulePerson(row), name));
      const tasks = array(taskLists[index]).filter(task => sameDate(taskDate(task), date) && !isPersonal(task) && !isHearingTask(task));
      const done = tasks.filter(isDoneTask);
      const remaining = tasks.filter(task => !isDoneTask(task));
      const key = normalize(name);
      state.hearings.set(key, hearings);
      state.remaining.set(key, remaining);
      patchEmployeeCard(card, name, hearings, tasks, done, remaining);
    });

    const selectedNames = new Set(names.map(normalize));
    state.controlled = array(controlledRows).filter(row => {
      const owner = controlledPerson(row);
      const dateValue = controlledDate(row);
      return selectedNames.has(normalize(owner)) && sameDate(dateValue, date);
    });
    patchControlledList(root, state.controlled);
  } finally {
    state.refreshing = false;
  }
}

function patchEmployeeCard(card, name, hearings, tasks, done, remaining) {
  const total = tasks.length;
  const percent = total ? Math.round((done.length / total) * 100) : 0;
  const plan = card.querySelector('.reports-plan-card');
  if (plan) {
    const strong = plan.querySelector('.reports-plan-main strong');
    const text = plan.querySelector('.reports-plan-main p');
    const percentNode = plan.querySelector('.reports-plan-percent');
    const bar = plan.querySelector('.reports-plan-progress > span');
    if (strong) strong.textContent = `Выполнение плана: ${done.length} из ${total}`;
    if (text) text.textContent = `Осталось выполнить: ${remaining.length}`;
    if (percentNode) percentNode.textContent = `${percent}%`;
    if (bar) bar.style.width = `${percent}%`;
    let button = plan.querySelector('[data-reports-day-remaining]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn tiny reports-day-drilldown';
      button.dataset.reportsDayRemaining = normalize(name);
      button.textContent = 'Показать невыполненные задачи';
      plan.append(button);
    }
    button.disabled = remaining.length === 0;
    button.textContent = remaining.length ? `Невыполненные задачи: ${remaining.length}` : 'Невыполненных задач нет';
  }

  const hearingsCard = card.querySelector('.reports-hearings-card');
  if (hearingsCard) {
    hearingsCard.innerHTML = `
      <div class="reports-section-title-row">
        <h5>Судебные заседания на выбранную дату</h5>
        <button class="reports-day-count-button" type="button" data-reports-day-hearings="${escapeAttr(normalize(name))}" ${hearings.length ? '' : 'disabled'}>${hearings.length}</button>
      </div>
      ${hearings.length
        ? '<p class="reports-day-hint">Нажмите на количество, чтобы открыть список заседаний.</p>'
        : '<div class="reports-hearings-empty"><i aria-hidden="true">⚖</i><strong>Судебные заседания на выбранную дату отсутствуют</strong></div>'}
    `;
  }
}

function patchControlledList(root, rows) {
  const node = root.querySelector('[data-reports-controlled]');
  if (!node) return;
  node.classList.add('reports-controlled-two-columns');
  node.innerHTML = rows.length ? rows.map(row => {
    const id = Number(row.id || row.controlled_case_id || row.case_id || 0);
    const number = row.case_number || row.court_case_number || row.case_no || row.pk_number || 'Без номера';
    const subject = row.subject || row.result || row.history_text || '';
    return `<button class="reports-list-row reports-controlled-row" type="button" data-reports-controlled-id="${id}" title="Открыть в перечне контрольных дел"><strong>${escapeHtml(number)}</strong><span>${escapeHtml(controlledPerson(row) || 'Исполнитель не указан')}</span><p>${escapeHtml(subject)}</p></button>`;
  }).join('') : '<div class="reports-empty-state">Контрольные дела на выбранную дату отсутствуют.</div>';
}

function handleClick(event) {
  const hearingButton = event.target.closest?.('[data-reports-day-hearings]');
  if (hearingButton) {
    event.preventDefault();
    openItemsDialog('Судебные заседания', state.hearings.get(hearingButton.dataset.reportsDayHearings) || [], 'hearing');
    return;
  }
  const remainingButton = event.target.closest?.('[data-reports-day-remaining]');
  if (remainingButton) {
    event.preventDefault();
    openItemsDialog('Невыполненные задачи', state.remaining.get(remainingButton.dataset.reportsDayRemaining) || [], 'task');
    return;
  }
  const item = event.target.closest?.('[data-reports-day-item]');
  if (item) {
    event.preventDefault();
    const payload = state.dialogItems.get(item.dataset.reportsDayItem);
    closeDialog();
    if (payload?.kind === 'hearing') openScheduleItem(payload.row);
    if (payload?.kind === 'task') openCalendarTask(payload.row);
    return;
  }
  if (event.target.closest?.('[data-reports-day-dialog-close]')) {
    event.preventDefault();
    closeDialog();
  }
}

function ensureDialog() {
  let dialog = document.querySelector('[data-reports-day-dialog]');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'reports-day-dialog';
  dialog.dataset.reportsDayDialog = '1';
  dialog.innerHTML = `<div class="reports-day-dialog-card"><div class="reports-day-dialog-head"><h3 data-reports-day-dialog-title></h3><button class="icon-button" type="button" data-reports-day-dialog-close>×</button></div><div class="reports-day-dialog-list" data-reports-day-dialog-list></div></div>`;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog();
  });
  document.body.append(dialog);
  return dialog;
}

function openItemsDialog(title, rows, kind) {
  const dialog = ensureDialog();
  const titleNode = dialog.querySelector('[data-reports-day-dialog-title]');
  const list = dialog.querySelector('[data-reports-day-dialog-list]');
  if (titleNode) titleNode.textContent = title;
  state.dialogItems.clear();
  list.innerHTML = rows.length ? rows.map((row, index) => {
    const token = `${kind}:${index}:${Date.now()}`;
    state.dialogItems.set(token, { kind, row });
    const heading = kind === 'hearing'
      ? `${row.time || row.start_time || 'Время не указано'} · ${row.court || 'Суд не указан'}`
      : row.description || row.desc || row.assignment || row.subject || 'Задача';
    const subtitle = kind === 'hearing'
      ? [row.case_no || row.court_no || row.case_number, row.subject || row.result].filter(Boolean).join(' · ')
      : [taskDate(row), row.time || row.start_time].filter(Boolean).join(' · ');
    return `<button type="button" data-reports-day-item="${escapeAttr(token)}"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(subtitle)}</span></button>`;
  }).join('') : '<div class="reports-empty-state">Данные отсутствуют.</div>';
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  const dialog = document.querySelector('[data-reports-day-dialog]');
  if (dialog?.open) dialog.close();
  state.dialogItems.clear();
}

function openScheduleItem(row) {
  const id = Number(row.id || row.schedule_id || 0);
  window.openView?.('schedule');
  if (!id) return;
  retry(() => {
    const node = document.querySelector(`[data-schedule-row="${id}"]`);
    if (!node) return false;
    node.click();
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  });
}

function openCalendarTask(task) {
  window.openView?.('calendar');
  const date = taskDate(task);
  window.setTimeout(() => {
    if (date) window.dispatchEvent(new CustomEvent('calendar:select-date', { detail: { date: normalizeDate(date) } }));
    window.dispatchEvent(new CustomEvent('calendar:edit-task', { detail: { task } }));
  }, 120);
}

function retry(callback, attempt = 0) {
  if (callback() || attempt >= 10) return;
  window.setTimeout(() => retry(callback, attempt + 1), 180);
}

function isScheduleCase(row) {
  return Number(row?.is_date_row || 0) !== 1;
}
function scheduleDate(row) { return row.session_date || row.hearing_date || row.date || ''; }
function schedulePerson(row) { return row.representative || row.case_executor || row.executor || row.employee || ''; }
function controlledPerson(row) { return row.executor || row.representative || row.employee || row.responsible || row.full_name || ''; }
function controlledDate(row) { return row.control_date || row.deadline || row.hearing_date || row.next_date || row.date || row.session_date || ''; }
function taskDate(row) { return row.date || row.date_str || row.start_date || row.due_date || row.deadline || ''; }
function isPersonal(row) { return normalize(row.event_scope || row.scope || row.type) === 'personal' || normalize(row.type).includes('личн'); }
function isHearingTask(row) { return normalize(row.type || row.task_type).includes('судебное заседание') || normalize(row.type || row.task_type) === 'судебное_заседание'; }
function isDoneTask(row) { return Number(row.done || row.completed || 0) === 1 || ['done', 'completed', 'исполнено', 'выполнено'].includes(normalize(row.status)); }
function samePerson(a, b) { return normalize(a) && normalize(a) === normalize(b); }
function sameDate(a, b) { return normalizeDate(a) && normalizeDate(a) === normalizeDate(b); }
function array(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' '); }
function normalizeDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${String(ru[2]).padStart(2, '0')}-${String(ru[1]).padStart(2, '0')}`;
  return '';
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#096;'); }
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}