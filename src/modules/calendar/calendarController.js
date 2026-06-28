import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';
import { getAuthSession, getCurrentUserName, isCurrentUserAdmin } from '../../auth/session.js';

const MONTHS = [
  '',
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

const TASK_COLORS = {
  "судебное_заседание": '#fff4e6',
  "процессуальный_срок": '#fff0f2',
  "поручение": '#fff0f2',
  "отзыв": '#eaf0ff',
  "рабочая_заметка": '#f1f5ff',
  "личное": '#eaf8f3',
  "иное": '#e8f5f8',
  "делегировано": '#edf0f4'
};

const TASK_ICONS = {
  "судебное_заседание": '⚖️',
  "процессуальный_срок": '⏰',
  "отзыв": '✎',
  "поручение": '!',
  "рабочая_заметка": '📝',
  "личное": '●',
  "иное": '◆',
  "делегировано": '↪'
};

const TASK_ICON_COLORS = {
  "судебное_заседание": '#d77a14',
  "процессуальный_срок": '#d54654',
  "отзыв": '#2557d6',
  "поручение": '#d54654',
  "рабочая_заметка": '#2557d6',
  "личное": '#1d9b72',
  "иное": '#157ea1',
  "делегировано": '#687087'
};

const TASK_LABELS = {
  "судебное_заседание": 'Судебное заседание',
  "процессуальный_срок": 'Процессуальный срок',
  "отзыв": 'Отзыв/жалоба',
  "поручение": 'Контрольное поручение',
  "рабочая_заметка": 'Рабочая заметка',
  "личное": 'Личный план',
  "иное": 'Иное',
  "делегировано": 'Делегировано'
};

const TASK_TYPE_KEYS = Object.keys(TASK_LABELS);
const TASK_TYPE_HEARING = TASK_TYPE_KEYS[0];
const TASK_TYPE_DEADLINE = TASK_TYPE_KEYS[1];
const TASK_TYPE_RESPONSE = TASK_TYPE_KEYS[2];
const TASK_TYPE_ASSIGNMENT = TASK_TYPE_KEYS[3];
const TASK_TYPE_WORK_NOTE = TASK_TYPE_KEYS[4];
const TASK_TYPE_PERSONAL = TASK_TYPE_KEYS[5];
const TASK_TYPE_OTHER = TASK_TYPE_KEYS[6];

const WORK_TASK_TYPES = [
  TASK_TYPE_HEARING,
  TASK_TYPE_DEADLINE,
  TASK_TYPE_RESPONSE,
  TASK_TYPE_ASSIGNMENT,
  TASK_TYPE_WORK_NOTE,
  TASK_TYPE_OTHER
];

const TASK_VISIBLE_FIELDS = {
  [TASK_TYPE_HEARING]: ['court', 'subject', 'date', 'time'],
  [TASK_TYPE_DEADLINE]: ['court', 'subject', 'date', 'time', 'note_text'],
  [TASK_TYPE_RESPONSE]: ['court', 'subject', 'date', 'time', 'note_text'],
  [TASK_TYPE_ASSIGNMENT]: ['court', 'subject', 'assignment', 'date', 'time'],
  [TASK_TYPE_WORK_NOTE]: ['date', 'time', 'note_text'],
  [TASK_TYPE_OTHER]: ['date', 'time', 'desc', 'court', 'subject', 'assignment', 'note_text']
};

let state = {
  initialized: false,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  selectedDate: toIsoDate(new Date()),
  users: ['Администратор'],
  selectedUser: 'Администратор',
  selectedExecutorId: 0,
  calendarExecutors: [],
  tasks: [],
  tasksByDate: new Map(),
  selectedTask: null,
  weekStartDate: getWeekRange(toIsoDate(new Date())).start,
  colorFilters: loadCalendarColorFilters(),
  pendingPlanMove: null,
  pendingGeneralCase: null,
  createOnDateMode: false,
  calendarCollapsed: false,
  draggingWeekTaskId: null,
  weekAutoFlipTimer: null,
  weekAutoFlipDirection: 0,
  weekLastAutoFlipAt: 0,
  weekDragEdgeArmed: true,
  dependentRecalcResolver: null,
  pendingDependentRecalcPlan: [],
  pendingDependentRecalcTargetDate: '',
  viewMode: 'week',
  conflictResolver: null,
  pendingConflicts: [],
  pendingConflictData: null,
  notifiedDelegatedIds: new Set(),
  caseLinkTargetTaskId: 0,
  caseLinkForForm: false,
  caseLinkResults: [],
  confirmResolver: null,
  executionMode: false
};

const CALENDAR_EXECUTOR_STORAGE_PREFIX = 'legal-dashboard-calendar-executor-v1';

function canChooseCalendarExecutor() {
  return Number(getAuthSession()?.role_level || 0) >= 2;
}

function getCalendarExecutorStorageKey() {
  const session = getAuthSession();
  const token = session?.id || session?.full_name || getCurrentUserName() || 'default';
  return `${CALENDAR_EXECUTOR_STORAGE_PREFIX}:${token}`;
}

function loadCalendarExecutorSelection() {
  try {
    return Number(localStorage.getItem(getCalendarExecutorStorageKey()) || 0) || 0;
  } catch {
    return 0;
  }
}

function saveCalendarExecutorSelection(id) {
  try {
    localStorage.setItem(getCalendarExecutorStorageKey(), String(Number(id) || 0));
  } catch {}
}

function getSelectedCalendarExecutor() {
  return state.calendarExecutors.find(user => Number(user.id) === Number(state.selectedExecutorId)) || null;
}

function getCalendarViewLabel() {
  const currentUser = getCurrentUserName() || state.selectedUser || 'Администратор';
  const executor = getSelectedCalendarExecutor();
  return executor?.full_name ? `${currentUser} + ${executor.full_name}` : currentUser;
}

function getTaskExecutorLabel(task) {
  const owner = getTaskUser(task);
  const currentUser = getCurrentUserName();
  return owner && currentUser && owner !== currentUser ? owner : '';
}

export function initCalendarPage() {
  if (state.initialized) return;
  state.initialized = true;

  document.addEventListener('click', event => {
    if (event.target.closest('[data-calendar-prev]')) changeMonth(-1);
    if (event.target.closest('[data-calendar-next]')) changeMonth(1);
    if (event.target.closest('[data-calendar-today]')) goToday();
    if (event.target.closest('[data-calendar-refresh]')) loadCalendarTasks();

    const viewButton = event.target.closest('[data-calendar-view]');
    if (viewButton) {
      setCalendarViewMode(viewButton.dataset.calendarView || 'week');
      return;
    }

    if (event.target.closest('[data-calendar-conflict-cancel]')) {
      resolveCalendarConflict(false);
      return;
    }

    if (event.target.closest('[data-calendar-conflict-confirm]')) {
      confirmCalendarConflict();
      return;
    }

    if (event.target.closest('[data-calendar-collapse-toggle]')) toggleCalendarCollapsed();
    if (event.target.closest('[data-calendar-week-prev]')) changeWeek(-1);
    if (event.target.closest('[data-calendar-week-next]')) changeWeek(1);
    if (event.target.closest('[data-calendar-execution-mode]')) {
      event.preventDefault();
      event.stopPropagation();
      toggleExecutionMode();
      return;
    }

    const planAdd = event.target.closest('[data-calendar-plan-add]');
    if (planAdd) {
      event.preventDefault();
      event.stopPropagation();
      openNewTaskForm(planAdd.dataset.calendarPlanAdd || state.selectedDate);
      return;
    }

    if (event.target.closest('[data-calendar-color-reset]')) resetCalendarColorFilter();

    const cell = event.target.closest('[data-calendar-day]');
    if (cell) selectDate(cell.dataset.calendarDay);

    if (event.target.closest('[data-calendar-new]')) {
      openNewTaskForm();
    }
    if (event.target.closest('[data-calendar-close]')) closeTaskForm();

    if (event.target.closest('[data-calendar-form-link]')) {
      event.preventDefault();
      event.stopPropagation();
      openCalendarCaseLinkDialog(0, true);
      return;
    }

    if (event.target.closest('[data-calendar-form-more]')) {
      event.preventDefault();
      event.stopPropagation();
      openTaskSource();
      return;
    }

    if (event.target.closest('[data-calendar-delete]')) deleteFormTask();

    if (event.target.closest('[data-calendar-case-link-close]')) {
      closeCalendarCaseLinkDialog();
      return;
    }
    if (event.target.closest('[data-calendar-case-link-search]')) {
      searchCalendarCaseLinkDialog();
      return;
    }
    if (event.target.closest('[data-calendar-case-question-no]')) {
      closeCalendarCaseQuestionDialog();
      return;
    }
    if (event.target.closest('[data-calendar-case-question-yes]')) {
      confirmCalendarCaseQuestionDialog();
      return;
    }
    const caseLinkChoice = event.target.closest('[data-calendar-case-link-choice]');
    if (caseLinkChoice) {
      chooseCalendarCaseLink(Number(caseLinkChoice.dataset.calendarCaseLinkChoice || 0));
      return;
    }
    if (event.target.closest('[data-calendar-confirm-cancel]')) {
      resolveCalendarConfirm(false);
      return;
    }
    if (event.target.closest('[data-calendar-confirm-ok]')) {
      resolveCalendarConfirm(true);
      return;
    }

    const planLinkButton = event.target.closest('[data-calendar-plan-link]');
    if (planLinkButton) {
      event.preventDefault();
      event.stopPropagation();
      linkPlanTaskToGeneralCase(Number(planLinkButton.dataset.calendarPlanLink));
      return;
    }

    const weekTask = event.target.closest('[data-calendar-week-task-id]');
    if (weekTask && !event.target.closest('[data-calendar-plan-link]')) {
      event.preventDefault();
      event.stopPropagation();
      if (state.executionMode) {
        toggleTaskDone(Number(weekTask.dataset.calendarWeekTaskId));
        return;
      }
      openCalendarTaskEditor(Number(weekTask.dataset.calendarWeekTaskId));
      return;
    }

    const taskCard = event.target.closest('[data-calendar-task-id]');
    if (taskCard) {
      event.preventDefault();
      event.stopPropagation();
      openCalendarTaskEditor(Number(taskCard.dataset.calendarTaskId));
      return;
    }

    if (event.target.closest('[data-calendar-detail-close]')) closeTaskDetails();
    if (event.target.closest('[data-calendar-detail-delete]')) deleteDetailTask();
    if (event.target.closest('[data-calendar-detail-more]')) openTaskSource();

    if (event.target.closest('[data-calendar-plan-run]')) exportWeeklyPlan();

    if (event.target.closest('[data-calendar-move-cancel]')) cancelPlanMove();
    if (event.target.closest('[data-calendar-move-no]')) confirmPlanMoveWithoutTimeChange();
    if (event.target.closest('[data-calendar-move-yes]')) openPlanMoveTimeDialog();
    if (event.target.closest('[data-calendar-time-move-back]')) backFromPlanMoveTimeDialog();
    if (event.target.closest('[data-calendar-time-move-save]')) savePlanMoveWithNewTime();

    if (event.target.closest('[data-calendar-dependent-close]')) resolveDependentRecalcDialog('skip');
    if (event.target.closest('[data-calendar-dependent-skip]')) resolveDependentRecalcDialog('skip');
    if (event.target.closest('[data-calendar-dependent-auto]')) resolveDependentRecalcDialog('auto');
    if (event.target.closest('[data-calendar-dependent-manual]')) resolveDependentRecalcDialog('manual');
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-calendar-user]')) {
      state.selectedExecutorId = Number(event.target.value || 0) || 0;
      saveCalendarExecutorSelection(state.selectedExecutorId);
      loadCalendarTasks();
    }

    if (event.target.matches('[data-calendar-color-filter]')) {
      syncColorPickerFromFilter();
    }

    if (event.target.matches('[data-calendar-color-picker]')) {
      updateCalendarColorFilter();
    }

    if (event.target.matches('[name="event_scope"]')) {
      syncCalendarScopeUi();
    }

    if (event.target.matches('[name="type"]')) {
      syncCalendarScopeUi();
      maybeAskToLinkGeneralCaseForType(event.target.value);
    }
  });

  document.addEventListener('input', event => {
    if (event.target.matches('[data-calendar-time]')) {
      formatTimeInput(event.target);
    }
    if (event.target.matches('[data-calendar-task-form] input, [data-calendar-task-form] textarea, [data-calendar-task-form] select')) {
      clearCalendarFormError();
    }
    if (event.target.matches('[data-calendar-case-link-query]')) {
      clearCalendarCaseLinkError();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.executionMode) {
      setExecutionMode(false);
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-calendar-case-link-query]')) {
      event.preventDefault();
      searchCalendarCaseLinkDialog();
    }
  });


document.addEventListener('dragstart', event => {
  const task = event.target.closest('[data-calendar-week-task-id]');
  if (!task) return;
  if (state.executionMode) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData('text/plain', task.dataset.calendarWeekTaskId);
  event.dataTransfer.effectAllowed = 'move';
  state.draggingWeekTaskId = task.dataset.calendarWeekTaskId;
  state.weekDragEdgeArmed = true;
  task.classList.add('dragging');
});

document.addEventListener('dragend', event => {
  event.target.closest('[data-calendar-week-task-id]')?.classList.remove('dragging');
  state.draggingWeekTaskId = null;
  state.weekDragEdgeArmed = true;
  clearWeekAutoFlipTimer();
  document.querySelectorAll('[data-calendar-plan-day], [data-calendar-week-plan-grid]').forEach(node => {
    node.classList.remove('drag-over', 'edge-prev', 'edge-next');
  });
});

document.addEventListener('dragover', event => {
  const weekGrid = document.querySelector('[data-calendar-week-plan-grid]');
  const outsideEdgeShift = getWeekPlanOutsideEdgeShift(event, weekGrid);
  if (state.draggingWeekTaskId && outsideEdgeShift) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    markWeekPlanEdge(weekGrid, outsideEdgeShift);
    scheduleWeekAutoFlip(outsideEdgeShift);
    return;
  }

  if (state.draggingWeekTaskId) {
    clearWeekAutoFlipTimer();
    state.weekDragEdgeArmed = true;
    clearWeekPlanEdge(weekGrid);
  }

  const dropTarget = event.target.closest('[data-calendar-plan-day]');
  if (!dropTarget) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  dropTarget.classList.add('drag-over');
});

document.addEventListener('dragleave', event => {
  const dropTarget = event.target.closest('[data-calendar-plan-day]');
  if (dropTarget && !dropTarget.contains(event.relatedTarget)) dropTarget.classList.remove('drag-over');
});

document.addEventListener('drop', event => {
  const dropTarget = event.target.closest('[data-calendar-plan-day]');
  if (!dropTarget) return;

  event.preventDefault();
  clearWeekAutoFlipTimer();
  clearWeekPlanEdge(document.querySelector('[data-calendar-week-plan-grid]'));
  dropTarget.classList.remove('drag-over');
  const taskId = event.dataTransfer.getData('text/plain') || state.draggingWeekTaskId;
  state.draggingWeekTaskId = null;
  state.weekDragEdgeArmed = true;

  startPlanTaskMove(taskId, dropTarget.dataset.calendarPlanDay);
});

function getWeekPlanOutsideEdgeShift(event, weekGrid) {
  if (!weekGrid || !state.draggingWeekTaskId) return 0;
  const rect = weekGrid.getBoundingClientRect();
  if (!rect.width || !rect.height) return 0;
  const verticalTolerance = 96;
  if (event.clientY < rect.top - verticalTolerance || event.clientY > rect.bottom + verticalTolerance) {
    return 0;
  }
  if (event.clientX < rect.left) return -1;
  if (event.clientX > rect.right) return 1;
  return 0;
}

function scheduleWeekAutoFlip(direction) {
  if (!direction || !state.draggingWeekTaskId || !state.weekDragEdgeArmed) return;

  const now = Date.now();
  if (now - state.weekLastAutoFlipAt < 850) return;

  if (state.weekAutoFlipTimer && state.weekAutoFlipDirection === direction) return;
  clearWeekAutoFlipTimer();
  state.weekAutoFlipDirection = direction;
  state.weekAutoFlipTimer = window.setTimeout(() => flipWeekDuringDrag(direction), 520);
}

async function flipWeekDuringDrag(direction) {
  if (!state.draggingWeekTaskId || !state.weekDragEdgeArmed) return;
  clearWeekAutoFlipTimer();
  state.weekDragEdgeArmed = false;
  state.weekLastAutoFlipAt = Date.now();

  const next = new Date(state.weekStartDate || state.selectedDate);
  next.setDate(next.getDate() + direction * 7);
  const nextIso = toIsoDate(next);
  state.weekStartDate = getWeekRange(nextIso).start;
  state.selectedDate = state.weekStartDate;
  const selected = new Date(state.selectedDate);
  state.currentYear = selected.getFullYear();
  state.currentMonth = selected.getMonth() + 1;

  await loadCalendarTasks();
  markWeekPlanEdge(document.querySelector('[data-calendar-week-plan-grid]'), direction);
}

function clearWeekAutoFlipTimer() {
  if (state.weekAutoFlipTimer) {
    window.clearTimeout(state.weekAutoFlipTimer);
  }
  state.weekAutoFlipTimer = null;
  state.weekAutoFlipDirection = 0;
}

function markWeekPlanEdge(weekGrid, edgeShift) {
  if (!weekGrid) return;
  weekGrid.classList.remove('edge-prev', 'edge-next');
  weekGrid.classList.add('drag-over', edgeShift < 0 ? 'edge-prev' : 'edge-next');
}

function clearWeekPlanEdge(weekGrid) {
  if (!weekGrid) return;
  weekGrid.classList.remove('drag-over', 'edge-prev', 'edge-next');
}

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-calendar-task-form]')) {
      event.preventDefault();
      if (event.target.dataset.saving === '1') return;
      saveTask(event.target);
    }
  });

  window.addEventListener('calendar:reload', loadCalendarTasks);
  window.addEventListener('calendar:open-general-case', event => {
    const generalCaseId = Number(event.detail?.generalCaseId || event.detail?.general_case_id || 0);
    if (generalCaseId) openCalendarByGeneralCaseId(generalCaseId);
  });

  window.addEventListener('calendar:create-for-case', event => {
    const row = event.detail?.case;
    if (!row?.id) return;
    state.pendingGeneralCase = row;
    state.selectedDate = toIsoDate(new Date());
    state.weekStartDate = getWeekRange(state.selectedDate).start;
    openTaskForm(null, state.selectedDate);
    const form = document.querySelector('[data-calendar-task-form]');
    if (form) {
      state.pendingGeneralCase = row;
      applyGeneralCaseToTaskForm(form, row);
      form.elements.event_scope.value = 'work';
      form.elements.type.value = 'рабочая_заметка';
      form.elements.desc.value = form.elements.desc.value || `Заметка по делу № ${row.case_no || row.court_no || row.id}`;
      syncCalendarScopeUi();
      syncCalendarFormLinkButton();
    }
  });

window.addEventListener('calendar:select-date', event => {
  const date = event.detail?.date;
  if (!date) return;
  selectDate(date);
});

window.addEventListener('calendar:edit-task', event => {
  const task = event.detail?.task;
  if (!task) return;
  state.selectedDate = getTaskDate(task) || state.selectedDate;
  state.weekStartDate = getWeekRange(state.selectedDate).start;
  openTaskForm(task);
});

window.addEventListener('app:view-changed', event => {
  if (event.detail?.viewId !== 'calendar') setExecutionMode(false);
});



  bootstrapCalendar();
}

async function bootstrapCalendar() {
  await loadUsers();
  await loadCourts();
  syncUserSelects();
  await loadCalendarTasks();
  syncCalendarCollapsed();
}


async function loadUsers() {
  const currentUserName = getCurrentUserName();
  state.selectedUser = currentUserName;

  try {
    const users = await dbApi.getUsers();
    state.users = users.length ? users : [currentUserName || 'Администратор'];
  } catch {
    state.users = [currentUserName || 'Администратор'];
  }

  if (!canChooseCalendarExecutor()) {
    state.calendarExecutors = [];
    state.selectedExecutorId = 0;
    return;
  }

  try {
    const users = await dbApi.getCalendarUsers();
    state.calendarExecutors = users.length ? users : [];
  } catch {
    state.calendarExecutors = [];
  }

  const stored = loadCalendarExecutorSelection();
  state.selectedExecutorId = state.calendarExecutors.some(user => Number(user.id) === stored) ? stored : 0;
}

async function loadCourts() {
  const node = document.querySelector('#calendarCourtsList');
  if (!node) return;

  try {
    const courts = await dbApi.getOptions('court');
    node.innerHTML = courts.map(court => `<option value="${escapeHtml(court)}"></option>`).join('');
  } catch {
    node.innerHTML = '';
  }
}


function syncUserSelects() {
  const pageSelect = document.querySelector('[data-calendar-user]');
  const filterWrap = pageSelect?.closest('.calendar-user-filter');
  const canSelect = canChooseCalendarExecutor();

  if (!pageSelect) return;
  if (filterWrap) filterWrap.hidden = !canSelect;
  if (!canSelect) {
    pageSelect.innerHTML = '<option value="0">Только мой календарь</option>';
    pageSelect.value = '0';
    state.selectedExecutorId = 0;
    return;
  }

  const options = ['<option value="0">Только мой календарь</option>']
    .concat(state.calendarExecutors.map(user => `<option value="${escapeHtml(String(user.id))}">${escapeHtml(user.full_name)}</option>`))
    .join('');

  pageSelect.innerHTML = options;
  pageSelect.value = String(state.selectedExecutorId || 0);
}

async function loadCalendarTasks() {
  const title = document.querySelector('[data-calendar-month-title]');
  if (title) title.textContent = `${MONTHS[state.currentMonth]} ${state.currentYear}`;

  try {
    const { start, end } = getVisibleDateRange();
    const currentUserName = getCurrentUserName() || state.selectedUser || 'Администратор';
    const selectedExecutor = getSelectedCalendarExecutor();
    const requests = [
      dbApi.getCalendarTasks({
        start,
        end,
        user: currentUserName
      })
    ];

    if (selectedExecutor?.full_name) {
      requests.push(dbApi.getCalendarTasks({
        start,
        end,
        user: selectedExecutor.full_name,
        scope: 'work'
      }));
    }

    const results = await Promise.allSettled(requests);
    const merged = [];
    const seen = new Set();
    for (const result of results) {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
      for (const task of result.value) {
        const key = String(task?.id || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(task);
      }
    }
    state.tasks = merged.sort((a, b) => `${getTaskDate(a)} ${getTaskTime(a)} ${a.id}`.localeCompare(`${getTaskDate(b)} ${getTaskTime(b)} ${b.id}`));
  } catch (error) {
    state.tasks = [];
    console.warn('calendar load error', error);
  }

  state.tasksByDate = groupTasksByDate(state.tasks);
  notifyAboutDelegatedTasks();
  renderCalendar();
  renderSelectedTasks();
  renderWeeklyPlan();
  renderDayAndListViews();
  syncCalendarViewMode();
  syncExecutionModeUi();

  window.dispatchEvent(new CustomEvent('calendar:updated', {
    detail: {
      tasks: state.tasks,
      currentYear: state.currentYear,
      currentMonth: state.currentMonth,
      selectedDate: state.selectedDate,
      weekStartDate: state.weekStartDate
    }
  }));
}

function notifyAboutDelegatedTasks() {
  const currentUser = getCurrentUserName();
  const fresh = state.tasks.filter(task =>
    String(task.delegated_to || '') === String(currentUser)
    && String(task.delegation_status || 'active') !== 'cancelled'
    && !state.notifiedDelegatedIds.has(String(task.id))
  );
  for (const task of fresh) {
    state.notifiedDelegatedIds.add(String(task.id));
    const title = getTaskDescription(task) || getTaskDisplayLabel(task);
    showNotification(`Вам делегировано событие: ${title}`);
  }
}

function groupTasksByDate(tasks) {
  const map = new Map();

  tasks.forEach(task => {
    const startDate = getTaskDate(task);
    const endDate = task?.end_date || startDate;
    if (!startDate) return;
    const cursor = new Date(startDate);
    const last = new Date(endDate || startDate);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return;
    let guard = 0;
    while (cursor <= last && guard < 370) {
      const date = toIsoDate(cursor);
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(task);
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  });

  for (const list of map.values()) {
    list.sort((a, b) => String(getTaskTime(a)).localeCompare(String(getTaskTime(b))));
  }

  return map;
}
function renderCalendar() {
  const grid = document.querySelector('[data-calendar-grid]');
  const title = document.querySelector('[data-calendar-month-title]');
  if (!grid) return;

  if (title) title.textContent = `${MONTHS[state.currentMonth]} ${state.currentYear}`;

  const first = new Date(state.currentYear, state.currentMonth - 1, 1);
  const daysInMonth = new Date(state.currentYear, state.currentMonth, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const today = toIsoDate(new Date());

  const cells = [];

  for (let index = 0; index < totalCells; index++) {
    const dayNumber = index - startOffset + 1;

    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cells.push('<button class="calendar-day-cell empty" type="button" disabled></button>');
      continue;
    }

    const date = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
    const tasks = state.tasksByDate.get(date) || [];
    const primaryTask = tasks.find(task => getTaskType(task) === 'поручение') || tasks[0] || null;
    const bg = tasks.length > 1 ? '#f8f9fc' : (primaryTask ? getTaskBg(primaryTask) : '#ffffff');
    const icon = primaryTask ? getTaskIcon(primaryTask) : '';
    const iconColor = primaryTask ? getTaskIconColor(primaryTask) : '#687087';

    cells.push(`
      <button
        class="calendar-day-cell ${date === today ? 'today' : ''} ${date === state.selectedDate ? 'selected' : ''} ${tasks.length ? 'has-tasks' : ''}"
        data-calendar-day="${date}"
        style="--task-bg: ${bg}; --task-icon-color: ${iconColor};"
        type="button"
      >
        <span class="calendar-day-number">${dayNumber}</span>
        ${tasks.length ? `<span class="calendar-task-count">${tasks.length}</span>` : ''}
        ${icon ? `<span class="calendar-day-icon">${escapeHtml(icon)}</span>` : ''}
      </button>
    `);
  }

  grid.innerHTML = cells.join('');
}

function renderSelectedTasks() {
  const title = document.querySelector('[data-calendar-side-title]');
  const list = document.querySelector('[data-calendar-task-list]');
  if (!list) return;

  if (title) title.textContent = `События: ${getCalendarViewLabel()} (${formatRuDate(state.selectedDate)})`;

  const tasks = state.tasksByDate.get(state.selectedDate) || [];

  if (!tasks.length) {
    list.innerHTML = '<div class="calendar-empty-task">На эту дату события не назначены</div>';
    return;
  }

  list.innerHTML = tasks.map(task => {
    const type = getTaskType(task);
    const time = getTaskTime(task);
    const note = getTaskNote(task);
    const executorLabel = getTaskExecutorLabel(task);
    return `
      <article class="calendar-task-card ${isTaskDelegated(task) ? 'is-delegated' : ''}" data-calendar-task-id="${task.id}" style="--task-bg: ${getTaskBg(task)}; --task-icon-color: ${getTaskIconColor(task)};">
        <div class="calendar-task-icon">${escapeHtml(getTaskIcon(task))}</div>
        <div>
          <b>${escapeHtml(getTaskDescription(task) || TASK_LABELS[type] || 'Событие')}</b>
          <span>${time ? `[${escapeHtml(time)}] · ` : ''}${escapeHtml(getTaskDisplayLabel(task))}</span>
          ${task.court && !task.is_private_masked ? `<p>${escapeHtml(task.court)}</p>` : ''}
          ${note ? `<p class="calendar-task-note">${escapeHtml(note)}</p>` : ''}
          ${executorLabel ? `<small>Исполнитель: ${escapeHtml(executorLabel)}</small>` : ''}
          ${isTaskDelegated(task) ? `<small>Делегировано: ${escapeHtml(task.delegated_to || '')}</small>` : ''}
        </div>
      </article>
    `;
  }).join('');
}
function selectDate(date) {
  state.selectedDate = date;
  state.weekStartDate = getWeekRange(date).start;
  loadCalendarTasks();
}

function changeMonth(delta) {
  state.currentMonth += delta;

  if (state.currentMonth > 12) {
    state.currentMonth = 1;
    state.currentYear += 1;
  } else if (state.currentMonth < 1) {
    state.currentMonth = 12;
    state.currentYear -= 1;
  }

  const daysInMonth = new Date(state.currentYear, state.currentMonth, 0).getDate();
  const currentSelected = new Date(state.selectedDate);
  const selectedDay = Math.min(currentSelected.getDate() || 1, daysInMonth);
  state.selectedDate = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
  state.weekStartDate = getWeekRange(state.selectedDate).start;

  loadCalendarTasks();
}

function goToday() {
  const today = new Date();
  state.currentYear = today.getFullYear();
  state.currentMonth = today.getMonth() + 1;
  state.selectedDate = toIsoDate(today);
  state.weekStartDate = getWeekRange(state.selectedDate).start;
  loadCalendarTasks();
}

function getCalendarTaskOwner(task = null) {
  return getTaskUser(task) || getCurrentUserName() || state.selectedUser || 'Администратор';
}

function openNewTaskForm(dateOverride = null) {
  state.pendingGeneralCase = null;
  const targetDate = dateOverride || state.selectedDate || toIsoDate(new Date());
  state.selectedDate = targetDate;
  state.weekStartDate = getWeekRange(targetDate).start;
  openTaskForm(null, targetDate);
}

function openTaskForm(task = null, dateOverride = null) {
  const dialog = document.querySelector('[data-calendar-task-dialog]');
  const form = document.querySelector('[data-calendar-task-form]');
  if (!dialog || !form) return;

  if (task?.is_private_masked) {
    openTaskDetails(task.id);
    return;
  }

  state.selectedTask = task || null;
  if (task) state.pendingGeneralCase = null;
  state.createOnDateMode = !task;
  form.reset();
  clearCalendarFormError();
  setTaskFormSaving(form, false);

  const storedScope = String(task?.event_scope || '');
  const scope = getTaskScope(task) === 'personal' ? 'personal' : 'work';
  const rawType = getTaskType(task);
  let type = '';
  if (task && scope === 'work') {
    if (storedScope === 'note' || rawType === TASK_TYPE_WORK_NOTE) {
      type = TASK_TYPE_WORK_NOTE;
    } else {
      type = WORK_TASK_TYPES.includes(rawType) ? rawType : TASK_TYPE_OTHER;
    }
  }
  const owner = getCalendarTaskOwner(task);

  form.elements.id.value = task?.id || '';
  form.elements.date.value = getTaskDate(task) || dateOverride || state.selectedDate;
  form.elements.end_date.value = task?.end_date || getTaskDate(task) || dateOverride || state.selectedDate;
  form.elements.event_scope.value = scope;
  Array.from(form.elements.type || []).forEach(input => {
    input.checked = Boolean(type) && input.value === type;
  });
  form.dataset.initialType = type;
  form.dataset.caseQuestionShownTypes = '';
  form.elements.personal_kind.value = task?.personal_kind || 'Личное событие';
  form.elements.desc.value = getTaskDescription(task) || '';
  form.elements.time.value = getTaskTime(task) || '';
  form.elements.end_time.value = task?.end_time || '';
  form.elements.court.value = task?.court || '';
  form.elements.subject.value = task?.subject || '';
  form.elements.assignment.value = task?.assignment || '';
  form.elements.note_text.value = scope === 'personal' ? (task?.private_note || '') : (task?.note_text || '');

  const title = document.querySelector('[data-calendar-dialog-title]');
  const subtitle = document.querySelector('[data-calendar-dialog-subtitle]');
  const deleteButton = document.querySelector('[data-calendar-delete]');
  const linkButton = document.querySelector('[data-calendar-form-link]');
  const moreButton = document.querySelector('[data-calendar-form-more]');
  const hasLink = Boolean(task?.general_case_id || task?.meeting_id || state.pendingGeneralCase?.id);

  if (title) title.textContent = task ? 'Изменить событие' : 'Новое событие';
  if (subtitle) subtitle.textContent = 'Дата: ' + formatRuDate(form.elements.date.value) + ' | Владелец: ' + owner;
  if (deleteButton) deleteButton.hidden = !task;
  if (linkButton) linkButton.hidden = true;
  if (moreButton) {
    moreButton.hidden = !task?.id || !hasLink;
    moreButton.textContent = 'Подробнее';
  }

  if (state.pendingGeneralCase && !task) applyGeneralCaseToTaskForm(form, state.pendingGeneralCase);
  syncCalendarScopeUi();
  syncCalendarFormLinkButton();
  dialog.showModal();
}

function closeTaskForm() {
  state.pendingGeneralCase = null;
  state.createOnDateMode = false;
  document.querySelector('[data-calendar-task-dialog]')?.close();
}

function openCalendarTaskEditor(id) {
  const task = state.tasks.find(item => Number(item.id) === Number(id));
  if (!task) return;
  state.selectedDate = getTaskDate(task) || state.selectedDate;
  state.weekStartDate = getWeekRange(state.selectedDate).start;
  if (task.is_private_masked || (isTaskDelegated(task) && String(getTaskUser(task)) !== String(getCurrentUserName()) && !isCurrentUserAdmin())) openTaskDetails(task.id);
  else openTaskForm(task);
}

function requestCalendarConfirm(title, message) {
  const dialog = document.querySelector('[data-calendar-confirm-dialog]');
  const titleNode = document.querySelector('[data-calendar-confirm-title]');
  const messageNode = document.querySelector('[data-calendar-confirm-message]');
  if (!dialog) return Promise.resolve(false);
  if (titleNode) titleNode.textContent = title || 'Подтверждение';
  if (messageNode) messageNode.textContent = message || '';
  dialog.showModal();
  return new Promise(resolve => { state.confirmResolver = resolve; });
}

function resolveCalendarConfirm(result) {
  const resolver = state.confirmResolver;
  state.confirmResolver = null;
  document.querySelector('[data-calendar-confirm-dialog]')?.close();
  if (resolver) resolver(Boolean(result));
}

function setTaskFormSaving(form, saving) {
  if (!form) return;
  form.dataset.saving = saving ? '1' : '0';
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = Boolean(saving);
  if (!saving) syncCalendarSubmitState(form);
}

function syncCalendarSubmitState(form = document.querySelector('[data-calendar-task-form]')) {
  if (!form || form.dataset.saving === '1') return;
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) return;
  const scope = form.elements.event_scope?.value === 'personal' ? 'personal' : 'work';
  const selectedType = form.elements.type?.value || '';
  submit.disabled = scope === 'work' && !selectedType;
}

function showCalendarFormError(message) {
  const error = document.querySelector('[data-calendar-form-error]');
  if (!error) return;
  error.textContent = message || '';
  error.hidden = !message;
}

function clearCalendarFormError() {
  showCalendarFormError('');
}

function preserveCalendarTaskEndDate(task, nextStartDate) {
  if (!nextStartDate) return '';
  const previousStart = parseIsoDate(getTaskDate(task));
  const previousEnd = parseIsoDate(task?.end_date || '');
  const nextStart = parseIsoDate(nextStartDate);
  if (!previousStart || !previousEnd || !nextStart || previousEnd < previousStart) return nextStartDate;

  const durationDays = Math.max(0, Math.round((previousEnd.getTime() - previousStart.getTime()) / 86400000));
  const nextEnd = new Date(nextStart);
  nextEnd.setDate(nextEnd.getDate() + durationDays);
  return toIsoDate(nextEnd);
}

async function saveTask(form) {
  clearCalendarFormError();
  const existingTask = form.elements.id.value
    ? state.tasks.find(item => String(item.id) === String(form.elements.id.value))
    : null;
  const time = String(form.elements.time.value || '').trim();
  const endTime = String(existingTask?.end_time || '');

  for (const [value, label] of [[time, 'Время начала']]) {
    const clean = value.replace(':', '');
    if (value && (clean.length !== 4 || !/^\d+$/.test(clean))) {
      showCalendarFormError(label + ' должно быть в формате ЧЧ:ММ, например 14:30');
      return;
    }
  }

  const currentUserName = getCurrentUserName();
  const scope = form.elements.event_scope.value === 'personal' ? 'personal' : 'work';
  const personalKind = form.elements.personal_kind.value || 'Личное событие';
  const startDate = form.elements.date.value;
  const endDate = preserveCalendarTaskEndDate(existingTask, startDate);

  if (!startDate) {
    showCalendarFormError('Выберите дату');
    return;
  }

  const selectedType = form.elements.type.value || '';
  if (scope === 'work' && !WORK_TASK_TYPES.includes(selectedType)) {
    showCalendarFormError('Выберите тип записи');
    return;
  }
  const type = scope === 'personal' ? TASK_TYPE_PERSONAL : selectedType;
  const rawNote = form.elements.note_text.value.trim();
  const owner = existingTask ? getCalendarTaskOwner(existingTask) : (currentUserName || state.selectedUser || 'Администратор');
  const defaultTitle = scope === 'personal' ? personalKind : getTaskDisplayLabel({ type, task_type: type });
  const isOtherType = scope !== 'personal' && selectedType === TASK_TYPE_OTHER;
  const isApplicableField = name => {
    if (isOtherType) return true;
    const field = document.querySelector('[data-calendar-field="' + name + '"]');
    return Boolean(field && !field.hidden);
  };
  const keepOrRead = (name, key = name) => isApplicableField(name)
    ? String(form.elements[name]?.value || '').trim()
    : String(existingTask?.[key] || '');
  const descValue = isApplicableField('desc')
    ? (form.elements.desc.value.trim() || defaultTitle || 'Событие')
    : (getTaskDescription(existingTask) || defaultTitle || 'Событие');
  const noteValue = keepOrRead('note_text');
  const data = {
    id: form.elements.id.value || '',
    date: startDate,
    end_date: endDate,
    user: owner,
    event_scope: scope,
    personal_kind: scope === 'personal' ? personalKind : '',
    type,
    desc: descValue,
    time,
    end_time: endTime,
    court: scope === 'personal' ? '' : keepOrRead('court'),
    subject: scope === 'personal' ? '' : keepOrRead('subject'),
    assignment: scope === 'personal' ? '' : keepOrRead('assignment'),
    note_text: scope === 'personal' ? '' : noteValue,
    private_note: scope === 'personal' ? rawNote : '',
    conflict_override: 0,
    done: form.elements.id.value ? (existingTask?.done || 0) : 0,
    meeting_id: existingTask?.meeting_id || null,
    general_case_id: scope === 'personal' ? null : (state.pendingGeneralCase?.id || existingTask?.general_case_id || null),
    delegated_to: existingTask?.delegated_to || '',
    delegated_by: existingTask?.delegated_by || '',
    delegation_status: existingTask?.delegation_status || '',
    delegation_source_event_id: existingTask?.delegation_source_event_id || null
  };

  let conflictDecision = { confirmed: true, delegatedTo: '', conflicts: [] };
  if (scope === 'personal') {
    const conflicts = await findPersonalEventConflicts(data, data.id);
    if (conflicts.length) {
      conflictDecision = await requestCalendarConflictResolution(conflicts, data);
      if (!conflictDecision?.confirmed) return;
      data.conflict_override = 1;
    }
  }

  setTaskFormSaving(form, true);
  try {
    let savedTask = null;
    if (data.id) {
      savedTask = await dbApi.updateCalendarTask(data.id, data);
      if (existingTask && getTaskDate(existingTask) !== data.date && getTaskType(existingTask) === TASK_TYPE_HEARING) {
        const recalculationSourceTask = {
          ...existingTask,
          general_case_id: data.general_case_id || existingTask.general_case_id || null,
          date: getTaskDate(existingTask),
          date_str: getTaskDate(existingTask)
        };
        await maybeRecalculateDependentTasksAfterHearingMove(recalculationSourceTask, data.date);
      }
      showNotification('Событие обновлено');
    } else {
      savedTask = await dbApi.createCalendarTask(data);
      showNotification(scope === 'personal' ? 'Личный план сохранён' : 'Рабочее событие сохранено');
    }

    const sourceEventId = Number(savedTask?.id || data.id || 0);
    if (sourceEventId && (scope === 'personal' || getTaskScope(existingTask) === 'personal')) {
      await dbApi.delegateCalendarTasks({
        source_event_id: sourceEventId,
        ids: conflictDecision.delegatedTo ? conflictDecision.conflicts.map(item => item.id) : [],
        delegated_to: conflictDecision.delegatedTo || ''
      });
      if (conflictDecision.delegatedTo) showNotification('Конфликтующие рабочие события делегированы: ' + conflictDecision.delegatedTo);
    }

    state.selectedDate = data.date;
    state.weekStartDate = getWeekRange(data.date).start;
    state.selectedUser = currentUserName;
    syncUserSelects();
    closeTaskForm();
    await loadCalendarTasks();
  } catch (error) {
    showCalendarFormError('Не удалось сохранить: ' + error.message);
  } finally {
    setTaskFormSaving(form, false);
  }
}

async function deleteFormTask() {
  const form = document.querySelector('[data-calendar-task-form]');
  const id = Number(form?.elements.id.value || 0);
  if (!id) return;

  const confirmed = await requestCalendarConfirm('\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u044d\u0442\u043e \u0434\u0435\u043b\u043e?', '\u0417\u0430\u043f\u0438\u0441\u044c \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u0430 \u0438\u0437 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044f.');
  if (!confirmed) return;

  await deleteTask(id);
  closeTaskForm();
}

function isCaseLinkableCalendarType(type) {
  return [TASK_TYPE_HEARING, TASK_TYPE_DEADLINE, TASK_TYPE_RESPONSE, TASK_TYPE_ASSIGNMENT].includes(type);
}

function maybeAskToLinkGeneralCaseForType(type) {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form || form.elements.event_scope?.value === 'personal') return;
  if (!isCaseLinkableCalendarType(type)) return;
  if (state.pendingGeneralCase?.id || state.selectedTask?.general_case_id) return;
  const shown = String(form.dataset.caseQuestionShownTypes || '').split('|').filter(Boolean);
  if (shown.includes(type)) return;
  form.dataset.caseQuestionShownTypes = [...shown, type].join('|');
  openCalendarCaseQuestionDialog();
}

function openCalendarCaseQuestionDialog() {
  document.querySelector('[data-calendar-case-question-dialog]')?.showModal();
}

function closeCalendarCaseQuestionDialog() {
  document.querySelector('[data-calendar-case-question-dialog]')?.close();
}

function confirmCalendarCaseQuestionDialog() {
  closeCalendarCaseQuestionDialog();
  openCalendarCaseLinkDialog(0, true);
}

function openCalendarCaseLinkDialog(taskId = 0, forForm = false) {
  state.caseLinkTargetTaskId = Number(taskId || 0);
  state.caseLinkForForm = Boolean(forForm);
  state.caseLinkResults = [];
  const dialog = document.querySelector('[data-calendar-case-link-dialog]');
  const query = document.querySelector('[data-calendar-case-link-query]');
  const results = document.querySelector('[data-calendar-case-link-results]');
  if (query) query.value = '';
  if (results) results.innerHTML = '<div class="calendar-case-link-empty">Введите № ПК, суд, сторону или предмет.</div>';
  clearCalendarCaseLinkError();
  dialog?.showModal();
  setTimeout(() => query?.focus(), 0);
}

function closeCalendarCaseLinkDialog() {
  document.querySelector('[data-calendar-case-link-dialog]')?.close();
  state.caseLinkTargetTaskId = 0;
  state.caseLinkForForm = false;
  state.caseLinkResults = [];
}

function showCalendarCaseLinkError(message) {
  const error = document.querySelector('[data-calendar-case-link-error]');
  if (!error) return;
  error.textContent = message || '';
  error.hidden = !message;
}

function clearCalendarCaseLinkError() {
  showCalendarCaseLinkError('');
}

function filterGeneralCasesForCalendar(cases, query) {
  const normalizedQuery = normalizePk(query);
  return (Array.isArray(cases) ? cases : [])
    .filter(row => {
      if (!normalizedQuery) return true;
      return [row.case_no, row.court_no, row.court, row.plaintiff, row.defendant, row.claim_subject]
        .some(value => normalizePk(value).includes(normalizedQuery));
    })
    .slice(0, 20);
}

async function searchCalendarCaseLinkDialog() {
  const query = document.querySelector('[data-calendar-case-link-query]')?.value || '';
  const results = document.querySelector('[data-calendar-case-link-results]');
  clearCalendarCaseLinkError();
  if (results) results.innerHTML = '<div class="calendar-case-link-empty">Поиск...</div>';
  try {
    const list = filterGeneralCasesForCalendar(await dbApi.getGeneralCases(), query);
    state.caseLinkResults = list;
    if (!results) return;
    if (!list.length) {
      results.innerHTML = '<div class="calendar-case-link-empty">Дело из общего перечня не найдено.</div>';
      return;
    }
    results.innerHTML = list.map((row, index) => '<button class="calendar-case-link-choice" data-calendar-case-link-choice="' + index + '" type="button"><b>' + escapeHtml(formatGeneralCaseChoice(row)) + '</b><span>' + escapeHtml(row.claim_subject || row.category || '') + '</span></button>').join('');
  } catch (error) {
    console.error('Не удалось загрузить общий перечень дел:', error);
    if (results) results.innerHTML = '';
    showCalendarCaseLinkError('Не удалось загрузить общий перечень дел.');
  }
}

async function chooseCalendarCaseLink(index) {
  const selected = state.caseLinkResults[index];
  if (!selected?.id) return;

  const taskId = Number(state.caseLinkTargetTaskId || 0);
  const form = document.querySelector('[data-calendar-task-form]');
  if (state.caseLinkForForm) {
    if (!form) return;
    state.pendingGeneralCase = selected;
    applyGeneralCaseToTaskForm(form, selected);
    syncCalendarFormLinkButton();
    closeCalendarCaseLinkDialog();
    showNotification('Дело выбрано. Суд и предмет заполнены из общего перечня.');
    return;
  }

  const task = state.tasks.find(item => Number(item.id) === taskId);
  if (!task) return;
  try {
    await dbApi.updateCalendarTask(task.id, calendarTaskPayload(task, {
      court: selected.court || task.court || '',
      subject: selected.claim_subject || selected.category || task.subject || '',
      general_case_id: selected.id
    }));

    state.selectedTask = { ...task, general_case_id: selected.id };
    const moreButton = document.querySelector('[data-calendar-form-more]');
    const linkButton = document.querySelector('[data-calendar-form-link]');
    if (moreButton) moreButton.hidden = false;
    if (linkButton) {
      linkButton.hidden = false;
      linkButton.textContent = 'Связано: ' + formatGeneralCaseChoice(selected);
    }

    closeCalendarCaseLinkDialog();
    showNotification('План закреплен');
    await loadCalendarTasks();
  } catch (error) {
    console.error('Не удалось закрепить план:', error);
    showCalendarCaseLinkError('План не закреплен. Проверьте данные.');
  }
}

function applyGeneralCaseToTaskForm(form, row) {
  if (!form || !row) return;
  form.elements.court.value = row.court || '';
  form.elements.subject.value = row.claim_subject || row.category || '';
}

function syncCalendarFormLinkButton() {
  const linkButton = document.querySelector('[data-calendar-form-link]');
  if (!linkButton) return;
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form || form.elements.event_scope?.value === 'personal') { linkButton.hidden = true; return; }
  const selected = state.pendingGeneralCase;
  const currentTask = state.selectedTask;
  const selectedType = form.elements.type?.value || '';
  const hasLink = Boolean(selected?.id || currentTask?.general_case_id);
  linkButton.hidden = !hasLink && !isCaseLinkableCalendarType(selectedType);
  if (linkButton.hidden) return;
  if (selected) {
    linkButton.textContent = 'Связано: ' + formatGeneralCaseChoice(selected);
  } else if (currentTask?.general_case_id) {
    linkButton.textContent = 'Изменить связь с общим перечнем';
  } else {
    linkButton.textContent = 'Связать с общим перечнем';
  }
}

function formatGeneralCaseChoice(row) {
  return [
    row.case_no ? '№ ПК ' + row.case_no : '',
    row.court || '',
    row.plaintiff || '',
    row.defendant || ''
  ].filter(Boolean).join(' | ') || 'ID ' + row.id;
}

async function linkPlanTaskToGeneralCase(taskId) {
  openCalendarCaseLinkDialog(taskId);
}

function openPlanTaskMore(taskId) {
  const task = state.tasks.find(item => Number(item.id) === Number(taskId));
  if (!task) return;

  if (task.meeting_id) {
    openLinkedMeetingFromCalendar(task);
    return;
  }

  if (task.general_case_id) {
    openLinkedGeneralCaseFromCalendar(task);
    return;
  }

  openTaskDetails(taskId);
}


async function openCalendarByGeneralCaseId(generalCaseId) {
  const id = Number(generalCaseId || 0);
  if (!id) return;

  if (!state.tasks.length) {
    await loadCalendarTasks();
  }

  const task = state.tasks.find(item => Number(item.general_case_id || 0) === id);
  if (!task) {
    showNotification('В календаре не найдено заседание для этого явочного дела', 'error');
    return;
  }

  const taskDate = getTaskDate(task);
  if (taskDate) selectDate(taskDate);
  openTaskDetails(task.id);
  showNotification('Открыто связанное заседание в календаре');
}

function normalizePk(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function openTaskDetails(id) {
  const task = state.tasks.find(item => Number(item.id) === Number(id));
  if (!task) return;

  state.selectedTask = task;

  const dialog = document.querySelector('[data-calendar-detail-dialog]');
  const date = document.querySelector('[data-calendar-detail-date]');
  const body = document.querySelector('[data-calendar-detail-body]');
  const moreButton = document.querySelector('[data-calendar-detail-more]');
  const deleteButton = document.querySelector('[data-calendar-detail-delete]');
  const hasLink = Boolean(task?.general_case_id || task?.meeting_id);
  const canDelete = !task?.is_private_masked && (isCurrentUserAdmin() || String(getTaskUser(task)) === String(getCurrentUserName()));

  if (date) date.textContent = formatTaskPeriod(task);
  if (moreButton) moreButton.hidden = !hasLink;
  if (deleteButton) deleteButton.hidden = !canDelete;

  if (body) {
    body.innerHTML = `
      ${renderDetailField('Тип', getTaskDisplayLabel(task))}
      ${renderDetailField('Событие', getTaskDescription(task))}
      ${renderDetailField('Период', formatTaskPeriod(task))}
      ${renderDetailField('Время', [getTaskTime(task), task.end_time].filter(Boolean).join(' — '))}
      ${task.is_private_masked ? '' : renderDetailField('Суд', task.court)}
      ${task.is_private_masked ? '' : renderDetailField('Предмет', task.subject)}
      ${task.is_private_masked ? '' : renderDetailField('Поручение', task.assignment)}
      ${task.is_private_masked ? '' : renderDetailField(getTaskScope(task) === 'personal' ? 'Приватная заметка' : 'Заметка', getTaskNote(task))}
      ${isTaskDelegated(task) ? renderDetailField('Делегировано', task.delegated_to) : ''}
    `;
  }

  dialog?.showModal();
}

function renderDetailField(label, value) {
  return `
    <div class="calendar-detail-field">
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(value || '—')}</p>
    </div>
  `;
}

function closeTaskDetails() {
  document.querySelector('[data-calendar-detail-dialog]')?.close();
}

function openLinkedGeneralCaseFromCalendar(task) {
  const id = Number(task?.general_case_id || 0);
  if (!id) return;

  closeTaskDetails();
  closeTaskForm();
  document.querySelector('[data-view="cases"]')?.click();
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('general-cases:open-case', { detail: { id, sourceView: 'calendar' } }));
  }, 120);
  showNotification('Открываю карточку связанного дела в общем перечне');
}

function openLinkedMeetingFromCalendar(task) {
  const id = Number(task?.meeting_id || 0);
  if (!id) return;

  closeTaskDetails();
  closeTaskForm();
  document.querySelector('[data-view="meetings"]')?.click();
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('meetings:open-meeting', { detail: { id } }));
  }, 160);
  showNotification('Открываю связанное совещание');
}

async function deleteDetailTask() {
  if (!state.selectedTask?.id) return;
  const confirmed = await requestCalendarConfirm('Удалить это событие?', 'Запись будет удалена из календаря.');
  if (!confirmed) return;

  await deleteTask(state.selectedTask.id);
  closeTaskDetails();
}

async function deleteTask(id) {
  try {
    await dbApi.deleteCalendarTask(id);
    showNotification('Дело удалено из календаря');
    await loadCalendarTasks();
  } catch (error) {
    showNotification('Не удалось удалить событие: ' + error.message, 'error');
  }
}

function openTaskSource() {
  const task = state.selectedTask;
  if (!task) return;

  if (task.meeting_id) {
    openLinkedMeetingFromCalendar(task);
    return;
  }

  if (task.general_case_id) {
    openLinkedGeneralCaseFromCalendar(task);
    return;
  }

  showNotification('У этой записи нет связи с общим перечнем дел или совещанием.', 'error');
}

function openPlanDialog() {
  const dialog = document.querySelector('[data-calendar-plan-dialog]');
  const input = document.querySelector('[data-calendar-plan-date]');
  if (input) input.value = state.selectedDate || toIsoDate(new Date());
  updatePlanRange();
  dialog?.showModal();
}

function closePlanDialog() {
  document.querySelector('[data-calendar-plan-dialog]')?.close();
}

function updatePlanRange() {
  const input = document.querySelector('[data-calendar-plan-date]');
  const node = document.querySelector('[data-calendar-plan-range]');
  if (!input || !node) return;

  const { start, end } = getWeekRange(input.value || state.selectedDate);
  node.textContent = `${formatRuDate(start)} — ${formatRuDate(end)}`;
}

async function exportWeeklyPlan() {
  const { start, end } = getWeekRange(state.weekStartDate || state.selectedDate);

  let rows = [];
  try {
    const currentUserName = getCurrentUserName() || state.selectedUser || 'Администратор';
    const selectedExecutor = getSelectedCalendarExecutor();
    const requests = [
      dbApi.getCalendarTasks({ start, end, user: currentUserName })
    ];
    if (selectedExecutor?.full_name) {
      requests.push(dbApi.getCalendarTasks({ start, end, user: selectedExecutor.full_name, scope: 'work' }));
    }
    const results = await Promise.allSettled(requests);
    const merged = [];
    const seen = new Set();
    for (const result of results) {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
      for (const task of result.value) {
        const key = String(task?.id || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(task);
      }
    }
    rows = merged.sort((a, b) => `${getTaskDate(a)} ${getTaskTime(a)} ${a.id}`.localeCompare(`${getTaskDate(b)} ${getTaskTime(b)} ${b.id}`));
  } catch (error) {
    showNotification('Не удалось получить задачи: ' + error.message, 'error');
    return;
  }

  const days = [];
  for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
    const iso = toIsoDate(d);
    const tasks = rows.filter(task => getTaskDate(task) === iso);
    days.push({ iso, tasks });
  }
  const meetingSummary = getMeetingAssignmentWeekSummary(rows);

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page Section1 { size: 21cm 29.7cm; margin: 1.5cm; }
  body { font-family: "PT Astra Serif", "Times New Roman", serif; font-size: 11pt; color: #000; }
  h1 { text-align: center; font-size: 14pt; margin: 0 0 12pt; }
  h2 { font-size: 12pt; margin: 12pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #000; padding: 4pt; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
  th { text-align: center; font-weight: bold; }
</style>
</head>
<body>
<div class="Section1">
  <h1>План работы: ${escapeHtml(getCalendarViewLabel())}<br>${formatRuDate(start)} — ${formatRuDate(end)}</h1>
  <h2>Поручения из совещаний</h2>
  <table>
    <thead><tr><th>Выполнено в срок</th><th>Просрочено</th><th>В работе</th></tr></thead>
    <tbody><tr><td>${meetingSummary.doneOnTime}</td><td>${meetingSummary.overdue}</td><td>${meetingSummary.inProgress}</td></tr></tbody>
  </table>
  ${days.map(day => `
    <h2>${formatRuDate(day.iso)}</h2>
    <table>
      <thead><tr><th style="width: 14%;">Время</th><th style="width: 22%;">Тип</th><th>Описание / Суд / Предмет / Поручение</th></tr></thead>
      <tbody>
        ${day.tasks.length ? day.tasks.map(task => `
          <tr>
            <td>${escapeHtml(getTaskTime(task) || '')}</td>
            <td>${escapeHtml(TASK_LABELS[getTaskType(task)] || getTaskType(task) || '')}</td>
            <td>${escapeHtml([getTaskDescription(task), task.court, task.subject, task.assignment].filter(Boolean).join('\\n')).replace(/\\n/g, '<br>')}</td>
          </tr>
        `).join('') : '<tr><td colspan="3">Задач нет</td></tr>'}
      </tbody>
    </table>
  `).join('')}
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `План_${getCalendarViewLabel().replace(/\s+/g, '_')}_${formatRuDate(start).replaceAll('.', '_')}-${formatRuDate(end).replaceAll('.', '_')}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showNotification('План на неделю сформирован');
}

function getMeetingAssignmentWeekSummary(rows = []) {
  const today = toIsoDate(new Date());
  return rows
    .filter(task => Number(task.meeting_id || 0) > 0 && getTaskType(task) === TASK_TYPE_ASSIGNMENT)
    .reduce((summary, task) => {
      const deadline = getTaskDate(task);
      const done = Number(task.done || 0) === 1;
      if (done) {
        const completedAt = String(task.updated_at || '').slice(0, 10);
        if (!deadline || !completedAt || completedAt <= deadline) summary.doneOnTime += 1;
        else summary.overdue += 1;
      } else if (deadline && deadline < today) {
        summary.overdue += 1;
      } else {
        summary.inProgress += 1;
      }
      return summary;
    }, { doneOnTime: 0, overdue: 0, inProgress: 0 });
}

function getVisibleDateRange() {
  const first = new Date(state.currentYear, state.currentMonth - 1, 1);
  const daysInMonth = new Date(state.currentYear, state.currentMonth, 0).getDate();
  const last = new Date(state.currentYear, state.currentMonth - 1, daysInMonth);
  const week = getWeekRange(state.weekStartDate || state.selectedDate);

  const startDate = new Date(Math.min(first.getTime(), new Date(week.start).getTime()));
  const endDate = new Date(Math.max(last.getTime(), new Date(week.end).getTime()));

  return { start: toIsoDate(startDate), end: toIsoDate(endDate) };
}

function getWeekRange(value) {
  const d = new Date(value);
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return { start: toIsoDate(monday), end: toIsoDate(sunday) };
}

function getTaskDate(task) {
  return task?.date_str || task?.date || '';
}

function getTaskType(task) {
  const type = task?.task_type || task?.type || '';
  return type === TASK_TYPE_WORK_NOTE ? TASK_TYPE_WORK_NOTE : type;
}

function getTaskScope(task) {
  const explicit = String(task?.event_scope || '');
  if (explicit === 'note') return 'work';
  if (explicit) return explicit;
  if (getTaskType(task) === TASK_TYPE_PERSONAL) return 'personal';
  return 'work';
}

function getTaskDescription(task) {
  if (task?.is_private_masked) return 'Отсутствие';
  return task?.description || task?.desc || '';
}

function getTaskNote(task) {
  if (task?.is_private_masked) return '';
  return getTaskScope(task) === 'personal' ? (task?.private_note || '') : (task?.note_text || '');
}

function getTaskTime(task) {
  return task?.time_val || task?.time || '';
}

function getTaskUser(task) {
  return task?.user_name || task?.user || '';
}

function calendarTaskPayload(task, overrides = {}) {
  const startDate = overrides.date ?? getTaskDate(task);
  return {
    date: startDate,
    end_date: overrides.end_date ?? task?.end_date ?? startDate,
    user: overrides.user ?? getCalendarTaskOwner(task),
    event_scope: overrides.event_scope ?? getTaskScope(task),
    personal_kind: overrides.personal_kind ?? task?.personal_kind ?? '',
    type: overrides.type ?? getTaskType(task),
    desc: overrides.desc ?? getTaskDescription(task),
    time: overrides.time ?? getTaskTime(task),
    end_time: overrides.end_time ?? task?.end_time ?? '',
    court: overrides.court ?? task?.court ?? '',
    subject: overrides.subject ?? task?.subject ?? '',
    assignment: overrides.assignment ?? task?.assignment ?? '',
    note_text: overrides.note_text ?? task?.note_text ?? '',
    private_note: overrides.private_note ?? task?.private_note ?? '',
    metadata_json: overrides.metadata_json ?? task?.metadata_json ?? JSON.stringify(overrides.metadata || task?.metadata || {}),
    delegated_to: overrides.delegated_to ?? task?.delegated_to ?? '',
    delegated_by: overrides.delegated_by ?? task?.delegated_by ?? '',
    delegation_status: overrides.delegation_status ?? task?.delegation_status ?? '',
    delegation_source_event_id: overrides.delegation_source_event_id ?? task?.delegation_source_event_id ?? null,
    conflict_override: overrides.conflict_override ?? task?.conflict_override ?? 0,
    done: overrides.done ?? task?.done ?? 0,
    meeting_id: overrides.meeting_id ?? task?.meeting_id ?? null,
    general_case_id: overrides.general_case_id ?? task?.general_case_id ?? null
  };
}

function isTaskDelegated(task) {
  return Boolean(String(task?.delegated_to || '').trim() && String(task?.delegation_status || 'active') !== 'cancelled');
}

function getTaskVisualType(task) {
  if (isTaskDelegated(task)) return 'делегировано';
  if (getTaskScope(task) === 'personal') return 'личное';
  if (getTaskScope(task) === 'note') return 'рабочая_заметка';
  return getTaskType(task) || 'иное';
}

function getTaskDisplayLabel(task) {
  if (task?.is_private_masked) return 'Личное событие · занято';
  if (isTaskDelegated(task)) return `Делегировано${task.delegated_to ? ` → ${task.delegated_to}` : ''}`;
  if (getTaskScope(task) === 'personal') return task.personal_kind || 'Личный план';
  return TASK_LABELS[getTaskType(task)] || getTaskType(task) || 'Иное';
}

function getTaskIcon(task) {
  return TASK_ICONS[getTaskVisualType(task)] || '•';
}

function getTaskIconColor(task) {
  return TASK_ICON_COLORS[getTaskVisualType(task)] || '#687087';
}

function getTaskBg(task) {
  return TASK_COLORS[getTaskVisualType(task)] || '#ffffff';
}

function formatTaskPeriod(task) {
  const start = getTaskDate(task);
  const end = task?.end_date || start;
  if (!start) return '';
  return end && end !== start ? `${formatRuDate(start)} — ${formatRuDate(end)}` : formatRuDate(start);
}
function formatTimeInput(input) {
  let digits = String(input.value || '').replace(/\D/g, '').slice(0, 4);
  input.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function toIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function formatRuDate(value) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-');
  return `${d}.${m}.${y}`;
}



function renderWeeklyPlan() {
  const grid = document.querySelector('[data-calendar-week-plan-grid]');
  const rangeNode = document.querySelector('[data-calendar-week-range]');
  if (!grid) return;

  const { start, end } = getWeekRange(state.weekStartDate || state.selectedDate);
  state.weekStartDate = start;

  if (rangeNode) rangeNode.textContent = `${formatRuDate(start)} — ${formatRuDate(end)}`;

  const days = [];
  for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
    const iso = toIsoDate(d);
    days.push({ iso, label: formatWeekDayLabel(d) });
  }

  grid.innerHTML = days.map(day => {
    const tasks = (state.tasksByDate.get(day.iso) || []).sort((a, b) => String(getTaskTime(a)).localeCompare(String(getTaskTime(b))));
    return `
      <section class="calendar-week-day ${day.iso === state.selectedDate ? 'selected' : ''}" data-calendar-plan-day="${day.iso}">
        <div class="calendar-week-day-head">
          <button class="calendar-week-date" data-calendar-day="${day.iso}" type="button">${escapeHtml(day.label)}</button>
          <button class="btn small" data-calendar-plan-add="${day.iso}" type="button" aria-label="Новая запись на ${escapeHtml(day.label)}">+</button>
        </div>
        <div class="calendar-week-day-body" data-calendar-plan-day="${day.iso}">
          ${tasks.length ? tasks.map(renderWeekTask).join('') : '<div class="calendar-week-empty">Свободно</div>'}
        </div>
      </section>
    `;
  }).join('');
}

function renderWeekTask(task) {
  const type = getTaskVisualType(task);
  const customColor = state.colorFilters?.[type] || '';
  const background = customColor || getTaskBg(task);
  const time = getTaskTime(task);
  const linked = Number(task.general_case_id || 0) > 0;
  const done = Number(task.done || 0) === 1;
  const draggable = !state.executionMode && !task.is_private_masked;
  const executorLabel = getTaskExecutorLabel(task);

  return `
    <article class="calendar-week-task ${isTaskDelegated(task) ? 'is-delegated' : ''} ${done ? 'is-done' : ''}" draggable="${draggable ? 'true' : 'false'}" data-calendar-task-id="${task.id}" data-calendar-week-task-id="${task.id}" style="--week-task-bg: ${background}; --task-icon-color: ${getTaskIconColor(task)};">
      <span class="calendar-week-task-time">${escapeHtml(time || '—')}</span>
      <b>${escapeHtml(getTaskDescription(task) || getTaskDisplayLabel(task))}</b>
      <small>${escapeHtml(getTaskDisplayLabel(task))}${linked || Number(task.meeting_id || 0) > 0 ? ' · связано с делом' : ''}</small>
      ${executorLabel ? `<small>Исполнитель: ${escapeHtml(executorLabel)}</small>` : ''}
      ${done ? '<span class="calendar-week-task-done">Исполнено</span>' : ''}
      ${getTaskNote(task) ? `<p>${escapeHtml(getTaskNote(task))}</p>` : ''}
    </article>
  `;
}

function toggleExecutionMode() {
  setExecutionMode(!state.executionMode);
}

function setExecutionMode(active) {
  const next = Boolean(active);
  if (state.executionMode === next) {
    syncExecutionModeUi();
    return;
  }
  state.executionMode = next;
  syncExecutionModeUi();
  renderWeeklyPlan();
}

function syncExecutionModeUi() {
  const button = document.querySelector('[data-calendar-execution-mode]');
  const grid = document.querySelector('[data-calendar-week-plan-grid]');
  if (button) {
    button.classList.toggle('active', state.executionMode);
    button.setAttribute('aria-pressed', state.executionMode ? 'true' : 'false');
  }
  grid?.classList.toggle('execution-mode', state.executionMode);
}

async function toggleTaskDone(taskId) {
  const task = state.tasks.find(item => Number(item.id) === Number(taskId));
  if (!task) return;
  if (task.is_private_masked || (!isCurrentUserAdmin() && String(getTaskUser(task)) !== String(getCurrentUserName()))) {
    showNotification('Нет прав для изменения этой задачи', 'error');
    return;
  }
  try {
    const nextDone = Number(task.done || 0) === 1 ? 0 : 1;
    await dbApi.updateCalendarTask(task.id, calendarTaskPayload(task, { done: nextDone }));
    showNotification(nextDone ? 'Задача отмечена как исполненная' : 'Отметка исполнения снята');
    await loadCalendarTasks();
  } catch (error) {
    showNotification('Не удалось сохранить отметку исполнения: ' + error.message, 'error');
  }
}
function changeWeek(delta) {
  const date = new Date(state.weekStartDate || state.selectedDate);
  date.setDate(date.getDate() + delta * 7);
  state.weekStartDate = getWeekRange(toIsoDate(date)).start;
  state.selectedDate = state.weekStartDate;
  const selected = new Date(state.selectedDate);
  state.currentYear = selected.getFullYear();
  state.currentMonth = selected.getMonth() + 1;
  loadCalendarTasks();
}

function toggleCalendarCollapsed() {
  state.calendarCollapsed = !state.calendarCollapsed;
  syncCalendarCollapsed();
}

function syncCalendarCollapsed() {
  const shell = document.querySelector('[data-calendar-shell]');
  const button = document.querySelector('[data-calendar-collapse-toggle]');
  if (!shell) return;
  shell.classList.toggle('is-calendar-collapsed', Boolean(state.calendarCollapsed));
  if (button) {
    button.textContent = state.calendarCollapsed ? '›' : '‹';
    button.setAttribute('aria-label', state.calendarCollapsed ? 'Показать календарь' : 'Скрыть календарь');
    button.title = state.calendarCollapsed ? 'Показать календарь' : 'Скрыть календарь';
  }
}



function movePlanTaskByWeek(taskId, dayShift) {
  const task = state.tasks.find(item => String(item.id) === String(taskId));
  if (!task || !Number.isFinite(dayShift) || dayShift === 0) return;

  const taskDate = parseIsoDate(getTaskDate(task));
  if (!taskDate) {
    showNotification('У задачи нет даты для переноса между неделями', 'error');
    return;
  }

  const targetDate = toIsoDate(addCalendarDays(taskDate, dayShift));
  startPlanTaskMove(task.id, targetDate);
}
function startPlanTaskMove(taskId, targetDate) {
  const task = state.tasks.find(item => String(item.id) === String(taskId));
  if (!task || !targetDate) return;
  if (getTaskDate(task) === targetDate) return;

  state.pendingPlanMove = {
    taskId: task.id,
    targetDate,
    originalTime: getTaskTime(task) || ''
  };

  const dateNode = document.querySelector('[data-calendar-move-date]');
  if (dateNode) dateNode.textContent = formatRuDate(targetDate);

  document.querySelector('[data-calendar-move-dialog]')?.showModal();
}

function cancelPlanMove() {
  state.pendingPlanMove = null;
  document.querySelector('[data-calendar-move-dialog]')?.close();
  document.querySelector('[data-calendar-move-time-dialog]')?.close();
}

async function confirmPlanMoveWithoutTimeChange() {
  const pending = state.pendingPlanMove;
  if (!pending) return;
  document.querySelector('[data-calendar-move-dialog]')?.close();
  await moveCalendarTaskToDate(pending.taskId, pending.targetDate, pending.originalTime);
}

function openPlanMoveTimeDialog() {
  const pending = state.pendingPlanMove;
  if (!pending) return;

  document.querySelector('[data-calendar-move-dialog]')?.close();

  const dateNode = document.querySelector('[data-calendar-move-time-date]');
  const input = document.querySelector('[data-calendar-move-time-input]');

  if (dateNode) dateNode.textContent = formatRuDate(pending.targetDate);
  if (input) input.value = pending.originalTime || '';

  document.querySelector('[data-calendar-move-time-dialog]')?.showModal();
  setTimeout(() => input?.focus(), 50);
}

function backFromPlanMoveTimeDialog() {
  document.querySelector('[data-calendar-move-time-dialog]')?.close();
  document.querySelector('[data-calendar-move-dialog]')?.showModal();
}

async function savePlanMoveWithNewTime() {
  const pending = state.pendingPlanMove;
  if (!pending) return;

  const input = document.querySelector('[data-calendar-move-time-input]');
  const time = String(input?.value || '').trim();
  const cleanTime = time.replace(':', '');

  if (time && (cleanTime.length !== 4 || !/^\d+$/.test(cleanTime))) {
    showNotification('Время должно быть в формате ЧЧ:ММ, например 14:30', 'error');
    return;
  }

  document.querySelector('[data-calendar-move-time-dialog]')?.close();
  await moveCalendarTaskToDate(pending.taskId, pending.targetDate, time);
}


function parseIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addCalendarDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function isCalendarWorkingDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function moveToNextCalendarWorkingDay(date) {
  const result = new Date(date);
  while (!isCalendarWorkingDay(result)) result.setDate(result.getDate() + 1);
  return result;
}

function daysBetweenIso(leftIso, rightIso) {
  const left = parseIsoDate(leftIso);
  const right = parseIsoDate(rightIso);
  if (!left || !right) return null;
  return Math.round((left.getTime() - right.getTime()) / 86400000);
}

function getDependentRecalculationPlan(hearingTask, targetDate, relatedTasks = state.tasks) {
  const oldDate = getTaskDate(hearingTask);
  const linkedCaseId = Number(hearingTask?.general_case_id || 0);
  if (!linkedCaseId || !oldDate || !targetDate || oldDate === targetDate) return [];
  const oldHearingDate = parseIsoDate(oldDate);
  const newHearingDate = parseIsoDate(targetDate);
  if (!oldHearingDate || !newHearingDate) return [];

  return (Array.isArray(relatedTasks) ? relatedTasks : [])
    .filter(task => String(task.id) !== String(hearingTask.id))
    .filter(task => Number(task.general_case_id || 0) === linkedCaseId)
    .map(task => {
      const originalDate = getTaskDate(task);
      const offset = daysBetweenIso(oldDate, originalDate);
      const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 5;
      const recalculated = moveToNextCalendarWorkingDay(addCalendarDays(newHearingDate, -safeOffset));
      return {
        task,
        originalDate,
        newDate: toIsoDate(recalculated),
        offset: safeOffset
      };
    })
    .filter(item => item.originalDate && item.newDate && item.originalDate !== item.newDate);
}

async function maybeRecalculateDependentTasksAfterHearingMove(hearingTask, targetDate) {
  // Не анализируем текст задачи. Любая запись календаря, связанная с делом общего перечня,
  // при переносе ищет другие календарные записи с тем же general_case_id.
  const linkedCaseId = Number(hearingTask?.general_case_id || 0);
  if (!linkedCaseId) return;

  let relatedTasks = state.tasks;
  try {
    // Берём все календарные записи, а не только текущую видимую неделю/месяц.
    relatedTasks = await dbApi.getCalendarTasks();
  } catch (error) {
    console.warn('Не удалось загрузить все календарные записи для пересчёта зависимых задач:', error);
  }

  const plan = getDependentRecalculationPlan({ ...hearingTask, general_case_id: linkedCaseId }, targetDate, relatedTasks);
  if (!plan.length) return;

  const decision = await askDependentRecalculationDecision(plan, hearingTask, targetDate);
  if (!decision || decision.mode === 'skip') return;

  const updates = plan.map(item => ({
    ...item,
    newDate: decision.mode === 'manual' && decision.manualDate ? decision.manualDate : item.newDate
  }));

  for (const item of updates) {
    const task = item.task;
    await dbApi.updateCalendarTask(task.id, calendarTaskPayload(task, {
      date: item.newDate,
      assignment: `${task.assignment || ''}

${decision.mode === 'manual'
  ? `Дата изменена вручную после переноса связанного заседания на ${formatRuDate(targetDate)}.`
  : `Пересчитано автоматически от заседания ${formatRuDate(targetDate)}: минус ${item.offset} дн., с переносом на ближайший рабочий день при попадании на выходной.`}`.trim()
    }));
  }

  showNotification(`Обновлено связанных задач: ${updates.length}`);
}

function askDependentRecalculationDecision(plan, hearingTask, targetDate) {
  const dialog = document.querySelector('[data-calendar-dependent-dialog]');
  const title = document.querySelector('[data-calendar-dependent-title]');
  const message = document.querySelector('[data-calendar-dependent-message]');
  const list = document.querySelector('[data-calendar-dependent-list]');
  const dateInput = document.querySelector('[data-calendar-dependent-date]');

  const oldText = formatRuDate(getTaskDate(hearingTask));
  const newText = formatRuDate(targetDate);
  const defaultDate = plan[0]?.newDate || targetDate;

  if (!dialog || !dateInput) {
    showNotification('Не удалось открыть окно пересчёта связанных задач. Сроки оставлены без изменений.', 'error');
    return Promise.resolve({ mode: 'skip' });
  }

  if (title) title.textContent = 'Связанные задачи по этому делу';
  if (message) {
    message.textContent = `Дата записи изменена с ${oldText} на ${newText}. Найдены другие записи календаря, связанные с этим же делом общего перечня.`;
  }
  if (list) {
    list.innerHTML = plan.map(item => `
      <li>
        <b>${escapeHtml(getTaskDescription(item.task) || TASK_LABELS[getTaskType(item.task)] || 'Задача')}</b>
        <span>${escapeHtml(formatRuDate(item.originalDate))} → ${escapeHtml(formatRuDate(item.newDate))}</span>
      </li>
    `).join('');
  }

  dateInput.value = defaultDate;
  state.pendingDependentRecalcPlan = plan;
  state.pendingDependentRecalcTargetDate = targetDate;
  dialog.oncancel = event => {
    event.preventDefault();
    resolveDependentRecalcDialog('skip');
  };
  dialog.showModal();

  return new Promise(resolve => {
    state.dependentRecalcResolver = resolve;
  });
}

function resolveDependentRecalcDialog(mode) {
  const dialog = document.querySelector('[data-calendar-dependent-dialog]');
  const dateInput = document.querySelector('[data-calendar-dependent-date]');
  const resolve = state.dependentRecalcResolver;

  if (!resolve) {
    dialog?.close();
    return;
  }

  if (mode === 'manual' && !dateInput?.value) {
    showNotification('Выберите дату для связанных задач', 'error');
    return;
  }

  state.dependentRecalcResolver = null;
  dialog?.close();
  resolve({
    mode,
    manualDate: mode === 'manual' ? dateInput.value : ''
  });
}

async function moveCalendarTaskToDate(taskId, targetDate, time) {
  const task = state.tasks.find(item => String(item.id) === String(taskId));
  if (!task) return;

  const durationDays = Math.max(0, Math.round((new Date(task.end_date || getTaskDate(task)) - new Date(getTaskDate(task))) / 86400000));
  const movedEnd = new Date(targetDate); movedEnd.setDate(movedEnd.getDate() + durationDays);
  const data = {
    date: targetDate,
    end_date: toIsoDate(movedEnd),
    user: getTaskUser(task) || state.selectedUser,
    event_scope: getTaskScope(task),
    personal_kind: task.personal_kind || '',
    type: getTaskType(task),
    desc: getTaskDescription(task),
    time: time || '',
    end_time: task.end_time || '',
    court: task.court || '',
    subject: task.subject || '',
    assignment: task.assignment || '',
    note_text: task.note_text || '',
    private_note: task.private_note || '',
    delegated_to: task.delegated_to || '',
    delegated_by: task.delegated_by || '',
    delegation_status: task.delegation_status || '',
    delegation_source_event_id: task.delegation_source_event_id || null,
    conflict_override: task.conflict_override || 0,
    done: task.done || 0,
    meeting_id: task.meeting_id || null,
    general_case_id: task.general_case_id || null
  };

  try {
    await dbApi.updateCalendarTask(taskId, data);
    await maybeRecalculateDependentTasksAfterHearingMove(task, targetDate);
    state.pendingPlanMove = null;
    state.selectedDate = targetDate;
    state.weekStartDate = getWeekRange(targetDate).start;
    showNotification('Запись перенесена в плане');
    await loadCalendarTasks();
  } catch (error) {
    showNotification('Не удалось перенести запись: ' + error.message, 'error');
  }
}

function syncColorPickerFromFilter() {
  const select = document.querySelector('[data-calendar-color-filter]');
  const picker = document.querySelector('[data-calendar-color-picker]');
  if (!select || !picker) return;
  picker.value = state.colorFilters?.[select.value] || '#dbeafe';
}

function updateCalendarColorFilter() {
  const select = document.querySelector('[data-calendar-color-filter]');
  const picker = document.querySelector('[data-calendar-color-picker]');
  if (!select || !picker || !select.value) return;
  state.colorFilters = { ...(state.colorFilters || {}), [select.value]: picker.value };
  saveCalendarColorFilters();
  renderWeeklyPlan();
}

function resetCalendarColorFilter() {
  const select = document.querySelector('[data-calendar-color-filter]');
  if (!select?.value) return;
  delete state.colorFilters[select.value];
  saveCalendarColorFilters();
  syncColorPickerFromFilter();
  renderWeeklyPlan();
}

function loadCalendarColorFilters() {
  try {
    return JSON.parse(localStorage.getItem('legal-dashboard-calendar-color-filters') || '{}');
  } catch {
    return {};
  }
}

function saveCalendarColorFilters() {
  localStorage.setItem('legal-dashboard-calendar-color-filters', JSON.stringify(state.colorFilters || {}));
}

function formatWeekDayLabel(date) {
  const names = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  return `${names[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function setCalendarViewMode(mode) {
  state.viewMode = ['day', 'week', 'month', 'list'].includes(mode) ? mode : 'week';
  syncCalendarViewMode();
}

function syncCalendarViewMode() {
  document.querySelectorAll('[data-calendar-view]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.calendarView === state.viewMode);
  });
  document.querySelectorAll('[data-calendar-mode-panel]').forEach(panel => {
    panel.hidden = panel.dataset.calendarModePanel !== state.viewMode;
  });
  const side = document.querySelector('.calendar-side-card');
  if (side) side.hidden = state.viewMode === 'list';
  const collapse = document.querySelector('[data-calendar-collapse-toggle]');
  if (collapse) collapse.hidden = !['month', 'week'].includes(state.viewMode);
}

function renderDayAndListViews() {
  const dayTitle = document.querySelector('[data-calendar-day-view-title]');
  const dayList = document.querySelector('[data-calendar-day-view-list]');
  const list = document.querySelector('[data-calendar-list-view-list]');
  if (dayTitle) dayTitle.textContent = `План на ${formatRuDate(state.selectedDate)}`;
  if (dayList) {
    const tasks = state.tasksByDate.get(state.selectedDate) || [];
    dayList.innerHTML = tasks.length
      ? tasks.map(renderUnifiedListItem).join('')
      : '<div class="calendar-empty-task">На выбранный день событий нет</div>';
  }
  if (list) {
    const sorted = [...state.tasks].sort((a, b) => `${getTaskDate(a)} ${getTaskTime(a)}`.localeCompare(`${getTaskDate(b)} ${getTaskTime(b)}`));
    list.innerHTML = sorted.length
      ? sorted.map(renderUnifiedListItem).join('')
      : '<div class="calendar-empty-task">В загруженном периоде событий нет</div>';
  }
}

function renderUnifiedListItem(task) {
  const executorLabel = getTaskExecutorLabel(task);
  return `<article class="calendar-unified-list-item ${isTaskDelegated(task) ? 'is-delegated' : ''}" data-calendar-task-id="${task.id}" style="--task-bg:${getTaskBg(task)};--task-icon-color:${getTaskIconColor(task)}">
    <div class="calendar-unified-list-icon">${escapeHtml(getTaskIcon(task))}</div>
    <div class="calendar-unified-list-main"><span>${escapeHtml(formatTaskPeriod(task))}${getTaskTime(task) ? ` · ${escapeHtml(getTaskTime(task))}` : ''}</span><b>${escapeHtml(getTaskDescription(task) || getTaskDisplayLabel(task))}</b><small>${escapeHtml(getTaskDisplayLabel(task))}</small>${executorLabel ? `<small>Исполнитель: ${escapeHtml(executorLabel)}</small>` : ''}${getTaskNote(task) ? `<p>${escapeHtml(getTaskNote(task))}</p>` : ''}</div>
  </article>`;
}

function setCalendarFieldVisible(name, visible) {
  const field = document.querySelector('[data-calendar-field="' + name + '"]');
  if (field) field.hidden = !visible;
}

function unwrapCalendarOtherFields() {
  document.querySelectorAll('[data-calendar-other-wrapper]').forEach(wrapper => {
    const field = wrapper.querySelector('[data-calendar-field]');
    if (!field) return;
    wrapper.parentNode.insertBefore(field, wrapper);
    wrapper.remove();
  });
}

function syncCalendarOtherFields(isOther) {
  const names = ['desc', 'court', 'subject', 'assignment', 'note_text'];
  if (!isOther) {
    unwrapCalendarOtherFields();
    return;
  }
  names.forEach(name => {
    const field = document.querySelector('[data-calendar-field="' + name + '"]');
    if (!field || field.closest('[data-calendar-other-wrapper]')) return;
    const label = field.querySelector('span')?.textContent || 'Поле';
    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-other-field';
    wrapper.dataset.calendarOtherWrapper = name;
    const button = document.createElement('button');
    button.className = 'calendar-other-toggle';
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `<span>${escapeHtml(label)}</span><b aria-hidden="true">⌄</b>`;
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      button.querySelector('b').textContent = expanded ? '⌄' : '⌃';
      field.hidden = expanded;
    });
    field.parentNode.insertBefore(wrapper, field);
    wrapper.appendChild(button);
    wrapper.appendChild(field);
    field.hidden = true;
  });
}

function syncCalendarScopeUi() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form) return;
  const scope = form.elements.event_scope?.value === 'personal' ? 'personal' : 'work';
  const selectedType = form.elements.type?.value || '';
  const isPersonal = scope === 'personal';
  const isOther = !isPersonal && selectedType === TASK_TYPE_OTHER;
  const workTypes = document.querySelector('[data-calendar-work-fields]');
  const caseFields = document.querySelector('[data-calendar-case-fields]');
  const privacyHint = document.querySelector('[data-calendar-privacy-hint]');
  const noteLabel = document.querySelector('[data-calendar-note-label]');
  const linkButton = document.querySelector('[data-calendar-form-link]');

  syncCalendarOtherFields(isOther);
  if (workTypes) workTypes.hidden = isPersonal;
  if (privacyHint) privacyHint.hidden = !isPersonal;
  if (noteLabel) noteLabel.textContent = isPersonal ? 'Приватная заметка' : 'Заметка / напоминание';

  const configurableFields = ['date', 'time', 'desc', 'court', 'subject', 'assignment', 'note_text'];
  const visibleFields = isPersonal ? ['note_text'] : (TASK_VISIBLE_FIELDS[selectedType] || []);

  if (isOther) {
    setCalendarFieldVisible('date', visibleFields.includes('date'));
    setCalendarFieldVisible('time', visibleFields.includes('time'));
  } else {
    configurableFields.forEach(name => setCalendarFieldVisible(name, visibleFields.includes(name)));
  }
  setCalendarFieldVisible('end_time', false);

  if (caseFields) {
    caseFields.hidden = !['court', 'subject', 'assignment'].some(name => visibleFields.includes(name));
  }

  if (linkButton) linkButton.hidden = true;
  syncCalendarFormLinkButton();
  syncCalendarSubmitState();
}

function rangesOverlap(startA, endA, startB, endB) {
  return String(startA || '') <= String(endB || startB || '') && String(startB || '') <= String(endA || startA || '');
}

function isHardCalendarConflict(task) {
  const type = getTaskType(task);
  const text = `${getTaskDescription(task)} ${task.assignment || ''}`.toLowerCase();
  return type === 'судебное_заседание'
    || type === 'процессуальный_срок'
    || type === 'поручение'
    || text.includes('срок')
    || text.includes('последний день');
}

async function findPersonalEventConflicts(data, ignoredId = '') {
  try {
    const tasks = await dbApi.getCalendarTasks({ start: data.date, end: data.end_date || data.date, user: data.user });
    return (tasks || []).filter(task => {
      if (String(task.id) === String(ignoredId || '')) return false;
      if (getTaskScope(task) === 'personal') return false;
      return rangesOverlap(data.date, data.end_date || data.date, getTaskDate(task), task.end_date || getTaskDate(task));
    }).map(task => ({ ...task, conflictLevel: isHardCalendarConflict(task) ? 'hard' : 'soft' }));
  } catch (error) {
    console.warn('Не удалось проверить конфликты календаря', error);
    return [];
  }
}

function requestCalendarConflictResolution(conflicts, data) {
  const dialog = document.querySelector('[data-calendar-conflict-dialog]');
  const summary = document.querySelector('[data-calendar-conflict-summary]');
  const list = document.querySelector('[data-calendar-conflict-list]');
  const delegate = document.querySelector('[data-calendar-conflict-delegate]');
  const hard = conflicts.filter(item => item.conflictLevel === 'hard');
  state.pendingConflicts = conflicts;
  state.pendingConflictData = data;
  if (summary) summary.textContent = hard.length
    ? `Внимание! В выбранный период найдено жестких конфликтов: ${hard.length}.`
    : `Найдены рабочие заметки или несрочные задачи: ${conflicts.length}.`;
  if (list) list.innerHTML = conflicts.map(item => `<article class="calendar-conflict-item ${item.conflictLevel}"><b>${escapeHtml(item.conflictLevel === 'hard' ? 'Жесткий конфликт' : 'Информация')}</b><span>${escapeHtml(formatTaskPeriod(item))}</span><p>${escapeHtml(getTaskDescription(item) || getTaskDisplayLabel(item))}${item.general_case_id ? ` · дело №${escapeHtml(item.subject || item.general_case_id)}` : ''}</p></article>`).join('');
  if (delegate) {
    const options = state.users.filter(user => user && user !== data.user);
    delegate.innerHTML = `<option value="">${hard.length ? 'Выберите коллегу' : 'Без делегирования'}</option>${options.map(user => `<option value="${escapeHtml(user)}">${escapeHtml(user)}</option>`).join('')}`;
  }
  dialog?.showModal();
  return new Promise(resolve => { state.conflictResolver = resolve; });
}

function confirmCalendarConflict() {
  const hard = state.pendingConflicts.some(item => item.conflictLevel === 'hard');
  const delegatedTo = document.querySelector('[data-calendar-conflict-delegate]')?.value || '';
  if (hard && !delegatedTo) {
    showNotification('\u041f\u0440\u0438 \u0436\u0435\u0441\u0442\u043a\u043e\u043c \u043a\u043e\u043d\u0444\u043b\u0438\u043a\u0442\u0435 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043c\u0435\u0449\u0430\u044e\u0449\u0435\u0433\u043e \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430.', 'error');
    return;
  }
  resolveCalendarConflict({ confirmed: true, delegatedTo, conflicts: delegatedTo ? state.pendingConflicts : [] });
}

function resolveCalendarConflict(result) {
  const resolver = state.conflictResolver;
  state.conflictResolver = null;
  document.querySelector('[data-calendar-conflict-dialog]')?.close();
  if (resolver) resolver(result || { confirmed: false, delegatedTo: '', conflicts: [] });
  state.pendingConflicts = [];
  state.pendingConflictData = null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
