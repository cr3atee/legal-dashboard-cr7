import { dbApi } from '../../api/dbApi.js';
import { getAuthSession, getCurrentUserName } from '../../auth/session.js';

const state = {
  initialized: false,
  timer: 0,
  reportRows: new Map(),
  reportDialogKind: '',
  reportDialogEmployee: '',
  dashboardTasks: [],
  notificationObserver: null
};

export function initLatestUserRequirements() {
  if (state.initialized) return;
  state.initialized = true;

  ensureDialogs();
  applyRolePolicy();
  scheduleRefresh(50);

  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', event => {
    if (event.target.matches('[data-calendar-user], [data-reports-date], [data-reports-users], [data-reports-mode]')) scheduleRefresh(180);
  }, true);
  window.addEventListener('app:view-changed', () => scheduleRefresh(180));
  window.addEventListener('calendar:updated', event => {
    if (Array.isArray(event.detail?.tasks)) state.dashboardTasks = event.detail.tasks;
    scheduleRefresh(80);
  });
  window.addEventListener('general-cases:updated', () => scheduleRefresh(180));
  window.addEventListener('reports:reload', () => scheduleRefresh(180));

  new MutationObserver(() => scheduleRefresh(120)).observe(document.body, { childList: true, subtree: true });
}

function scheduleRefresh(delay = 100) {
  clearTimeout(state.timer);
  state.timer = window.setTimeout(async () => {
    applyRolePolicy();
    await ensureCalendarExecutor();
    await fixDashboardTodayColumn();
    await fixDailyReports();
    await injectAssignmentNotifications();
  }, delay);
}

function roleLevel() {
  return Number(getAuthSession()?.role_level || 0);
}

function applyRolePolicy() {
  const participant = roleLevel() === 1;
  document.querySelectorAll('#cases [data-general-new], #cases [data-general-add], #cases .general-case-add-button').forEach(button => {
    button.hidden = participant;
    button.setAttribute('aria-hidden', participant ? 'true' : 'false');
  });

  const dayRadio = document.querySelector('#reports [data-reports-mode][value="day"]');
  const dayLabel = dayRadio?.closest('label');
  if (dayLabel) dayLabel.hidden = participant;
  if (participant) {
    const quarterRadio = document.querySelector('#reports [data-reports-mode][value="quarter"]');
    if (quarterRadio && !quarterRadio.checked) {
      quarterRadio.checked = true;
      quarterRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

async function ensureCalendarExecutor() {
  const row = document.querySelector('#calendar .calendar-week-new-row');
  const executionButton = row?.querySelector('[data-calendar-execution-mode]');
  let label = document.querySelector('#calendar .calendar-user-filter');
  if (!row || !executionButton) return;

  if (!label) {
    label = document.createElement('label');
    label.className = 'calendar-user-filter calendar-executor-inline';
    label.innerHTML = '<span>Исполнители</span><select data-calendar-user><option value="0">Только мой календарь</option></select>';
  }
  label.querySelector('span')?.replaceChildren(document.createTextNode('Исполнители'));
  label.classList.add('calendar-executor-inline');
  if (label.parentElement !== row || label.nextElementSibling !== executionButton) row.insertBefore(label, executionButton);

  const allowed = roleLevel() >= 2;
  label.hidden = !allowed;
  if (!allowed) return;

  const select = label.querySelector('[data-calendar-user]');
  if (!select || select.dataset.loaded === '1') return;
  try {
    const users = await dbApi.getCalendarUsers();
    const current = select.value || '0';
    select.innerHTML = '<option value="0">Только мой календарь</option>' + (Array.isArray(users) ? users : [])
      .filter(user => Number(user.role_level || 1) === 1)
      .map(user => `<option value="${escapeAttr(user.id)}">${escapeHtml(user.full_name)}</option>`).join('');
    select.value = [...select.options].some(option => option.value === current) ? current : '0';
    select.dataset.loaded = '1';
  } catch (error) {
    select.dataset.loaded = '0';
    console.warn('Не удалось загрузить исполнителей календаря:', error);
  }
}

async function fixDashboardTodayColumn() {
  const board = document.querySelector('[data-calendar-kanban-board]');
  if (!board) return;
  const today = todayIso();
  let tasks = state.dashboardTasks;
  if (!tasks.length) {
    try {
      tasks = await dbApi.getCalendarTasks({ start: today, end: today, user: getCurrentUserName() });
    } catch { return; }
  }
  const todayTasks = tasks.filter(task => normalizeDate(task.date || task.date_str || task.start_date) === today && !isDone(task));
  const todayColumn = board.querySelector('.calendar-widget-kanban-column.today');
  const list = todayColumn?.querySelector('.calendar-widget-kanban-list');
  const count = todayColumn?.querySelector('.calendar-widget-kanban-column-head span');
  if (!list || !count || todayTasks.length === 0) return;
  count.textContent = String(todayTasks.length);
  list.innerHTML = todayTasks.sort(taskSort).map(task => `
    <article class="calendar-widget-kanban-task" data-latest-calendar-task-id="${escapeAttr(task.id || task.task_id)}">
      <div class="calendar-widget-kanban-task-top"><b>${escapeHtml(task.time || task.time_val || '')}</b><span>${escapeHtml(task.type || task.task_type || 'задача')}</span></div>
      <strong>${escapeHtml(task.description || task.desc || task.assignment || task.subject || 'Без описания')}</strong>
      <p>${escapeHtml(task.court || task.subject || '')}</p>
    </article>`).join('');
  todayTasks.forEach(task => state.reportRows.set(`dashboard:${task.id || task.task_id}`, task));
}

async function fixDailyReports() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || root.dataset.reportsMode === 'quarter' || roleLevel() === 1) return;
  const date = root.querySelector('[data-reports-date]')?.value || todayIso();
  const cards = [...root.querySelectorAll('.reports-employee-card')];
  if (!cards.length) return;

  let scheduleRows = [];
  try { scheduleRows = await dbApi.getCourtSchedule(); } catch {}

  for (const card of cards) {
    const employee = String(card.querySelector('h4')?.textContent || '').trim();
    if (!employee) continue;
    let allTasks = [];
    try {
      allTasks = await dbApi.getCalendarTasks({ start: '2000-01-01', end: date, user: employee });
    } catch {}
    const todayTasks = allTasks.filter(task => normalizeDate(task.date || task.date_str || task.start_date || task.deadline) === date);
    const planTasks = todayTasks.filter(task => !isHearingTask(task) && !isPersonal(task));
    const done = planTasks.filter(isDone);
    const remaining = planTasks.filter(task => !isDone(task));
    const overdue = allTasks.filter(task => !isDone(task) && normalizeDate(task.date || task.date_str || task.start_date || task.deadline) < date);
    const hearings = (Array.isArray(scheduleRows) ? scheduleRows : []).filter(row => hearingMatches(row, date, employee));

    state.reportRows.set(`hearings:${employee}`, hearings);
    state.reportRows.set(`remaining:${employee}`, remaining);
    state.reportRows.set(`completed:${employee}`, done);
    state.reportRows.set(`overdue:${employee}`, overdue);

    patchHearings(card, employee, date, hearings);
    patchPlan(card, employee, planTasks, done, remaining);
    patchOverdue(card, employee, overdue);
  }
}

function patchHearings(card, employee, date, rows) {
  const section = card.querySelector('.reports-hearings-card');
  if (!section) return;
  section.innerHTML = `<div class="reports-section-title-row"><h5>Судебные заседания ${escapeHtml(formatRuDate(date))}</h5><button type="button" class="reports-linked-count" data-latest-report-list="hearings" data-employee="${escapeAttr(employee)}">${rows.length}</button></div><p class="reports-linked-hint">${rows.length ? 'Нажмите на количество, чтобы открыть список заседаний.' : 'На выбранную дату заседаний нет.'}</p>`;
}

function patchPlan(card, employee, tasks, done, remaining) {
  const section = card.querySelector('.reports-plan-card');
  if (!section) return;
  const percent = tasks.length ? Math.round(done.length * 100 / tasks.length) : 0;
  section.innerHTML = `<h5>Выполнение плана</h5><div class="reports-plan-main"><div><strong>${done.length} из ${tasks.length} задач выполнено</strong><div class="latest-report-actions"><button type="button" class="btn tiny" data-latest-report-list="completed" data-employee="${escapeAttr(employee)}">Посмотреть выполненные</button><button type="button" class="btn tiny" data-latest-report-list="remaining" data-employee="${escapeAttr(employee)}">Невыполнено: ${remaining.length}</button></div></div><span class="reports-plan-percent">${percent}%</span></div><div class="reports-plan-progress"><span style="width:${percent}%"></span></div>`;
}

function patchOverdue(card, employee, rows) {
  const candidates = [...card.querySelectorAll('button, article, div')].filter(node => normalize(node.textContent).includes('просроченные задачи'));
  const target = candidates.sort((a, b) => a.childElementCount - b.childElementCount)[0];
  if (!target) return;
  target.dataset.latestReportList = 'overdue';
  target.dataset.employee = employee;
  target.setAttribute('role', 'button');
  target.setAttribute('tabindex', '0');
  const count = [...target.querySelectorAll('strong, b, span')].find(node => /^\d+$/.test(String(node.textContent || '').trim()));
  if (count) count.textContent = String(rows.length);
}

function hearingMatches(row, date, employee) {
  const rowDate = normalizeDate(row.session_date || row.hearing_date || row.date || row.date_str);
  const names = [row.representative, row.case_executor, row.executor, row.employee, row.full_name].map(normalize).filter(Boolean);
  const target = normalize(employee);
  return rowDate === date && names.some(name => name === target || name.includes(target) || target.includes(name));
}

function handleClick(event) {
  const task = event.target.closest('[data-latest-calendar-task-id]');
  if (task) {
    const row = state.reportRows.get(`dashboard:${task.dataset.latestCalendarTaskId}`);
    if (row) openCalendarTask(row);
    return;
  }

  const report = event.target.closest('[data-latest-report-list]');
  if (report) {
    event.preventDefault();
    const kind = report.dataset.latestReportList;
    const employee = report.dataset.employee || '';
    if (kind === 'completed') {
      openEmployeeCalendar(employee);
      return;
    }
    openReportDialog(kind, employee);
    return;
  }

  const rowButton = event.target.closest('[data-latest-report-row]');
  if (rowButton) {
    const rows = state.reportRows.get(`${state.reportDialogKind}:${state.reportDialogEmployee}`) || [];
    const row = rows[Number(rowButton.dataset.latestReportRow)];
    document.querySelector('[data-latest-report-dialog]')?.close();
    if (state.reportDialogKind === 'hearings') openHearing(row);
    else openCalendarTask(row);
    return;
  }

  if (event.target.closest('[data-latest-dialog-close]')) document.querySelector('[data-latest-report-dialog]')?.close();
}

function openReportDialog(kind, employee) {
  const rows = state.reportRows.get(`${kind}:${employee}`) || [];
  state.reportDialogKind = kind;
  state.reportDialogEmployee = employee;
  const dialog = ensureDialogs();
  const titles = { hearings: 'Судебные заседания', remaining: 'Невыполненные задачи', overdue: 'Просроченные задачи' };
  dialog.querySelector('[data-latest-dialog-title]').textContent = `${titles[kind] || 'Задачи'} — ${employee}`;
  const body = dialog.querySelector('[data-latest-dialog-body]');
  body.innerHTML = rows.length ? rows.map((row, index) => `<button type="button" data-latest-report-row="${index}"><strong>${escapeHtml(row.description || row.desc || row.assignment || row.subject || row.case_number || row.case_no || row.court || 'Запись')}</strong><span>${escapeHtml([row.time || row.time_val, row.date || row.date_str || row.session_date, row.type || row.task_type].filter(Boolean).join(' · '))}</span></button>`).join('') : '<div class="reports-empty">Записи не найдены.</div>';
  if (!dialog.open) dialog.showModal();
}

function openEmployeeCalendar(employee) {
  window.openView?.('calendar');
  setTimeout(() => {
    const select = document.querySelector('[data-calendar-user]');
    if (!select) return;
    const option = [...select.options].find(item => normalize(item.textContent) === normalize(employee));
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, 250);
}

function openCalendarTask(task) {
  if (!task) return;
  window.openView?.('calendar');
  const date = normalizeDate(task.date || task.date_str || task.start_date || task.deadline) || todayIso();
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('calendar:select-date', { detail: { date } }));
    window.dispatchEvent(new CustomEvent('calendar:edit-task', { detail: { task } }));
  }, 120);
}

function openHearing(row) {
  if (!row) return;
  window.openView?.('schedule');
  const generalCaseId = Number(row.general_case_id || row.case_id || 0);
  setTimeout(() => {
    if (generalCaseId) window.dispatchEvent(new CustomEvent('schedule:open-general-case', { detail: { generalCaseId } }));
    else document.querySelector(`[data-schedule-row="${cssEscape(row.id || row.schedule_id || '')}"]`)?.click();
  }, 180);
}

async function injectAssignmentNotifications() {
  if (roleLevel() !== 1) return;
  const list = document.querySelector('[data-notifications-list]');
  if (!list) return;
  let cases = [];
  try { cases = await dbApi.getGeneralCases(); } catch { return; }
  const user = normalize(getCurrentUserName());
  const assigned = (Array.isArray(cases) ? cases : []).filter(row => normalize(row.executor || row.representative || row.employee) === user && (Number(row.attendance_flag || 0) === 1 || Number(row.control_flag || 0) === 1 || Number(row.review_show_flag || 0) === 1 || Number(row.emergency_fund_flag || 0) === 1));
  list.querySelectorAll('[data-assignment-notification]').forEach(node => node.remove());
  assigned.slice(0, 20).forEach(row => {
    const flags = [Number(row.attendance_flag) ? 'явочное дело' : '', Number(row.control_flag) ? 'контрольное дело' : '', Number(row.review_show_flag) ? 'отзыв показать' : '', Number(row.emergency_fund_flag) ? 'аварийный фонд' : ''].filter(Boolean).join(', ');
    list.insertAdjacentHTML('afterbegin', `<article class="notification-card notification-info is-unread" data-assignment-notification><div class="notification-card-head"><span class="notification-severity-icon">📌</span><div><b>Вам назначено дело</b><small>${escapeHtml(flags)}</small></div></div><span>Дело № ${escapeHtml(row.case_no || row.court_no || row.id)}</span><div class="notification-card-actions"><button class="btn small" type="button" data-latest-open-case="${escapeAttr(row.id)}">Открыть</button></div></article>`);
  });
}

function ensureDialogs() {
  let dialog = document.querySelector('[data-latest-report-dialog]');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'latest-report-dialog';
  dialog.dataset.latestReportDialog = '1';
  dialog.innerHTML = '<div class="latest-report-dialog-card"><div class="latest-report-dialog-head"><h3 data-latest-dialog-title>Список</h3><button class="icon-button" data-latest-dialog-close type="button">×</button></div><div class="latest-report-dialog-body" data-latest-dialog-body></div></div>';
  document.body.append(dialog);
  return dialog;
}

function isDone(task) { return Number(task?.done || task?.is_done || task?.completed || 0) === 1 || ['done','completed','выполнено','исполнено'].includes(normalize(task?.status)); }
function isPersonal(task) { return ['personal','личное'].includes(normalize(task?.event_scope || task?.scope)); }
function isHearingTask(task) { const type = normalize(task?.type || task?.task_type); return type.includes('судебное заседание') || type.includes('судебное_заседание'); }
function taskSort(a,b) { return `${a.time || a.time_val || ''}`.localeCompare(`${b.time || b.time_val || ''}`); }
function normalize(value) { return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim(); }
function normalizeDate(value) { const text=String(value||'').trim(); const iso=text.match(/^(\d{4})-(\d{2})-(\d{2})/); if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`; const ru=text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); return ru?`${ru[3]}-${ru[2].padStart(2,'0')}-${ru[1].padStart(2,'0')}`:''; }
function todayIso(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function formatRuDate(value){const [y,m,d]=normalizeDate(value).split('-');return d?`${d}.${m}.${y}`:value;}
function cssEscape(value){return globalThis.CSS?.escape?CSS.escape(String(value)):String(value).replace(/["\\]/g,'\\$&');}
function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function escapeAttr(value){return escapeHtml(value).replaceAll('`','&#096;');}
