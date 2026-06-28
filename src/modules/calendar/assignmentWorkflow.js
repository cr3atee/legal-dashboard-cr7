import { dbApi } from '../../api/dbApi.js';
import { getAuthSession, getCurrentUserName } from '../../auth/session.js';

const ASSIGNMENT_TYPE = 'поручение';
const PARTICIPANT_ROLE_LEVEL = 1;
const ASSIGNMENT_MANAGER_ROLE_LEVEL = 2;
const ASSIGNMENT_READS_KEY = 'legal-dashboard-assignment-notification-reads-v1';

const state = {
  initialized: false,
  quickMode: false,
  assignees: [],
  assigneesLoaded: false,
  assignmentTasks: new Map(),
};

export function initCalendarAssignmentWorkflow() {
  if (state.initialized) return;
  state.initialized = true;

  wrapCalendarTaskApi();
  wrapNotificationsApi();
  syncCalendarAssignmentButton();
  renameCalendarTimeField();

  document.addEventListener('click', handleDocumentClickCapture, true);
  document.addEventListener('change', handleDocumentChange);
  document.addEventListener('submit', validateAssignmentSubmit, true);

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId !== 'calendar') return;
    syncCalendarAssignmentButton();
    renameCalendarTimeField();
  });

  window.addEventListener('calendar:edit-task', event => {
    state.quickMode = false;
    const task = event.detail?.task || null;
    setTimeout(() => {
      restoreStandardCalendarForm();
      restoreCalendarFormInteractivity();
      hideAssigneeField();
      if (isDelegatedToCurrentUser(task)) makeDelegatedTaskReadOnly(task);
    }, 0);
  });
}

function isAssignmentManager() {
  return Number(getAuthSession()?.role_level || 0) >= ASSIGNMENT_MANAGER_ROLE_LEVEL;
}

function handleDocumentClickCapture(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const assignmentNotificationButton = target.closest(
    '[data-notification-open][data-source-type="calendar_assignment"]'
  );
  if (assignmentNotificationButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openAssignmentNotification(assignmentNotificationButton);
    return;
  }

  if (target.closest('.topbar-assignments-btn') && isAssignmentManager()) {
    state.quickMode = true;
    setTimeout(() => {
      syncCalendarAssignmentButton();
      document.querySelector('[data-calendar-new]')?.click();
    }, 0);
    return;
  }

  if (target.closest('[data-calendar-new]')) {
    restoreCalendarFormInteractivity();
    if (isAssignmentManager()) {
      state.quickMode = true;
      setTimeout(() => configureQuickAssignmentForm(), 0);
    } else {
      state.quickMode = false;
      setTimeout(() => restoreStandardCalendarForm(), 0);
    }
    return;
  }

  if (target.closest('[data-calendar-plan-add], [data-calendar-task-id], [data-calendar-week-task-id]')) {
    state.quickMode = false;
    restoreCalendarFormInteractivity();
    setTimeout(() => restoreStandardCalendarForm(), 0);
  }
}

function handleDocumentChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('[data-calendar-assignee]')) {
    updateQuickAssignmentSubtitle();
    return;
  }

  if (target.matches('[data-calendar-task-form] [name="type"], [data-calendar-task-form] [name="event_scope"]')) {
    setTimeout(() => {
      if (state.quickMode) configureQuickAssignmentForm({ preserveFocus: true });
      else syncAssigneeFieldVisibility();
    }, 0);
  }
}

function syncCalendarAssignmentButton() {
  const button = document.querySelector('[data-calendar-new]');
  if (!button) return;

  if (isAssignmentManager()) {
    button.textContent = 'Поручение';
    button.title = 'Создать контрольное поручение сотруднику';
    button.setAttribute('aria-label', 'Создать контрольное поручение');
  } else {
    button.textContent = 'Новая запись';
    button.removeAttribute('title');
    button.removeAttribute('aria-label');
  }
}

function renameCalendarTimeField() {
  const label = document.querySelector('[data-calendar-field="time"] > span');
  if (label) label.textContent = 'Время';
}

async function configureQuickAssignmentForm({ preserveFocus = false } = {}) {
  if (!isAssignmentManager()) return;

  const form = document.querySelector('[data-calendar-task-form]');
  const dialog = document.querySelector('[data-calendar-task-dialog]');
  if (!form || !dialog?.open) return;

  state.quickMode = true;
  form.dataset.controlAssignment = '1';
  restoreCalendarFormInteractivity();
  renameCalendarTimeField();

  const workScope = form.querySelector('[name="event_scope"][value="work"]');
  if (workScope && !workScope.checked) workScope.checked = true;

  const assignmentType = form.querySelector(`[name="type"][value="${ASSIGNMENT_TYPE}"]`);
  if (assignmentType && !assignmentType.checked) {
    assignmentType.checked = true;
    assignmentType.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const assigneeField = ensureAssigneeField();
  await loadAssignees();
  populateAssigneeSelect(assigneeField?.querySelector('[data-calendar-assignee]'));

  form.querySelector('.calendar-event-scope')?.setAttribute('hidden', '');
  form.querySelector('[data-calendar-work-fields]')?.setAttribute('hidden', '');

  const visibleFields = new Set(['date', 'time', 'assignment', 'assignee']);
  form.querySelectorAll('[data-calendar-field]').forEach(field => {
    field.hidden = !visibleFields.has(field.dataset.calendarField || '');
  });

  const caseFields = form.querySelector('[data-calendar-case-fields]');
  if (caseFields) caseFields.hidden = false;

  const assignmentInput = form.elements.assignment;
  if (assignmentInput) assignmentInput.required = true;

  const assigneeSelect = form.querySelector('[data-calendar-assignee]');
  if (assigneeSelect) assigneeSelect.required = true;

  const title = document.querySelector('[data-calendar-dialog-title]');
  if (title) title.textContent = 'Поручение';
  updateQuickAssignmentSubtitle();

  document.querySelector('[data-calendar-form-link]')?.setAttribute('hidden', '');
  document.querySelector('[data-calendar-form-more]')?.setAttribute('hidden', '');

  if (!preserveFocus) setTimeout(() => assignmentInput?.focus(), 0);
}

function restoreStandardCalendarForm() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form || form.dataset.controlAssignment !== '1') return;

  delete form.dataset.controlAssignment;
  form.querySelector('.calendar-event-scope')?.removeAttribute('hidden');
  form.querySelector('[data-calendar-work-fields]')?.removeAttribute('hidden');

  const assignmentInput = form.elements.assignment;
  if (assignmentInput) assignmentInput.required = false;

  const assigneeSelect = form.querySelector('[data-calendar-assignee]');
  if (assigneeSelect) assigneeSelect.required = false;
  hideAssigneeField();
}

function restoreCalendarFormInteractivity() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form) return;

  delete form.dataset.delegatedReadonly;
  form.querySelectorAll('input, select, textarea, button').forEach(control => {
    control.disabled = false;
  });
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.hidden = false;
}

function ensureAssigneeField() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form) return null;

  let field = form.querySelector('[data-calendar-assignee-field]');
  if (field) return field;

  field = document.createElement('label');
  field.className = 'calendar-full-field';
  field.dataset.calendarField = 'assignee';
  field.dataset.calendarAssigneeField = '';
  field.innerHTML = `
    <span>Исполнитель</span>
    <select name="assignment_assignee" data-calendar-assignee autocomplete="off">
      <option value="">Выберите сотрудника</option>
    </select>
  `;

  const caseFields = form.querySelector('[data-calendar-case-fields]');
  if (caseFields) caseFields.append(field);
  else form.querySelector('.calendar-dialog-body')?.append(field);
  return field;
}

function hideAssigneeField() {
  const field = document.querySelector('[data-calendar-assignee-field]');
  if (field) field.hidden = true;
}

function syncAssigneeFieldVisibility() {
  const form = document.querySelector('[data-calendar-task-form]');
  const field = ensureAssigneeField();
  if (!form || !field) return;

  const selectedType = form.querySelector('[name="type"]:checked')?.value || '';
  const show = isAssignmentManager() && selectedType === ASSIGNMENT_TYPE;
  field.hidden = !show;
  const select = field.querySelector('[data-calendar-assignee]');
  if (select) select.required = show;
  if (show) {
    loadAssignees().then(() => populateAssigneeSelect(select));
  }
}

async function loadAssignees() {
  if (state.assigneesLoaded) return state.assignees;
  state.assigneesLoaded = true;

  try {
    const response = await dbApi.getReportUsers();
    const users = Array.isArray(response?.users) ? response.users : [];
    state.assignees = users
      .filter(user => Number(user.role_level) === PARTICIPANT_ROLE_LEVEL)
      .filter(user => Number(user.is_active ?? 1) === 1)
      .filter(user => String(user.full_name || '').trim())
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ru'));
  } catch (error) {
    console.warn('assignment assignees load error', error);
    state.assignees = [];
    state.assigneesLoaded = false;
  }

  return state.assignees;
}

function populateAssigneeSelect(select) {
  if (!select) return;
  const previousValue = select.value;
  const options = state.assignees.map(user => (
    `<option value="${escapeHtml(user.full_name)}" data-user-id="${Number(user.id) || ''}">${escapeHtml(user.full_name)}</option>`
  ));
  select.innerHTML = [
    `<option value="">${options.length ? 'Выберите сотрудника' : 'Нет активных сотрудников с ролью 1'}</option>`,
    ...options,
  ].join('');
  select.disabled = options.length === 0;
  if (previousValue && state.assignees.some(user => user.full_name === previousValue)) {
    select.value = previousValue;
  }
}

function validateAssignmentSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-calendar-task-form]')) return;
  if (form.dataset.controlAssignment !== '1' || !isAssignmentManager()) return;

  const selectedType = form.querySelector('[name="type"]:checked')?.value || '';
  if (selectedType !== ASSIGNMENT_TYPE) return;

  const assignee = String(form.querySelector('[data-calendar-assignee]')?.value || '').trim();
  const assignment = String(form.elements.assignment?.value || '').trim();
  if (assignee && assignment) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  showCalendarFormError(!assignee ? 'Выберите исполнителя поручения' : 'Укажите текст поручения');
  (!assignee
    ? form.querySelector('[data-calendar-assignee]')
    : form.elements.assignment
  )?.focus();
}

function getActiveAssignmentDraft(data = {}) {
  if (!isAssignmentManager() || data.type !== ASSIGNMENT_TYPE) return null;
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form || form.dataset.controlAssignment !== '1') return null;
  const assignee = String(form.querySelector('[data-calendar-assignee]')?.value || '').trim();
  if (!assignee) return null;
  return { assignee };
}

function wrapCalendarTaskApi() {
  if (dbApi.__assignmentWorkflowWrapped) return;
  dbApi.__assignmentWorkflowWrapped = true;

  const createCalendarTask = dbApi.createCalendarTask.bind(dbApi);
  const updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.createCalendarTask = async data => {
    const draft = getActiveAssignmentDraft(data);
    const saved = await createCalendarTask(data);
    if (!draft || !saved?.id) return saved;

    await dbApi.delegateCalendarTasks({
      source_event_id: Number(saved.id),
      ids: [Number(saved.id)],
      delegated_to: draft.assignee,
    });
    window.dispatchEvent(new CustomEvent('notifications:refresh'));
    return {
      ...saved,
      delegated_to: draft.assignee,
      delegated_by: getCurrentUserName(),
      delegation_status: 'active',
      delegation_source_event_id: Number(saved.id),
    };
  };

  dbApi.updateCalendarTask = async (id, data) => {
    const draft = getActiveAssignmentDraft(data);
    const saved = await updateCalendarTask(id, data);
    if (!draft || !id) return saved;

    await dbApi.delegateCalendarTasks({
      source_event_id: Number(id),
      ids: [Number(id)],
      delegated_to: draft.assignee,
    });
    window.dispatchEvent(new CustomEvent('notifications:refresh'));
    return {
      ...saved,
      delegated_to: draft.assignee,
      delegated_by: getCurrentUserName(),
      delegation_status: 'active',
      delegation_source_event_id: Number(id),
    };
  };
}

function wrapNotificationsApi() {
  if (dbApi.__assignmentNotificationsWrapped) return;
  dbApi.__assignmentNotificationsWrapped = true;

  const getNotifications = dbApi.getNotifications.bind(dbApi);
  const markNotificationsRead = dbApi.markNotificationsRead.bind(dbApi);

  dbApi.getNotifications = async () => {
    const base = await getNotifications();
    const assignmentItems = await loadAssignmentNotificationItems();
    const items = [...(Array.isArray(base?.items) ? base.items : []), ...assignmentItems];
    return {
      ...base,
      items,
      unread_count: items.filter(item => Number(item.unread) === 1).length,
      active_count: items.filter(item => item.status === 'active').length,
      overdue_count: items.filter(item => item.status === 'overdue').length,
    };
  };

  dbApi.markNotificationsRead = async keys => {
    const result = await markNotificationsRead(keys);
    rememberAssignmentReads(keys);
    return result;
  };
}

async function loadAssignmentNotificationItems() {
  const userName = String(getCurrentUserName() || '').trim();
  if (!userName) return [];

  let tasks = [];
  try {
    tasks = await dbApi.getCalendarTasks({
      start: shiftIsoDate(-90),
      end: shiftIsoDate(730),
      user: userName,
    });
  } catch (error) {
    console.warn('assignment notifications load error', error);
    return [];
  }

  const readKeys = loadAssignmentReadKeys();
  state.assignmentTasks.clear();

  return (Array.isArray(tasks) ? tasks : [])
    .filter(task => getTaskType(task) === ASSIGNMENT_TYPE)
    .filter(task => String(task.delegated_to || '').trim() === userName)
    .filter(task => String(task.delegation_status || 'active') !== 'cancelled')
    .filter(task => Number(task.done || 0) !== 1)
    .map(task => {
      const id = Number(task.id || 0);
      const key = `assignment:${id}:${task.created_at || getTaskDate(task) || ''}`;
      state.assignmentTasks.set(id, task);
      const overdue = isTaskOverdue(task);
      const author = String(task.delegated_by || '').trim();
      const text = String(task.assignment || task.description || task.desc || 'Контрольное поручение').trim();
      const dueText = formatAssignmentDue(task);
      return {
        key,
        status: overdue ? 'overdue' : 'active',
        severity: 'assignment',
        title: 'Вы получили новое поручение',
        message: `${author ? `От: ${author}. ` : ''}${text}${dueText ? ` Срок: ${dueText}.` : ''}`,
        due_at: task.created_at || buildTaskDateTime(task)?.toISOString() || new Date().toISOString(),
        source_type: 'calendar_assignment',
        source_id: id,
        general_case_id: task.general_case_id || null,
        unread: readKeys.has(key) ? 0 : 1,
      };
    });
}

async function openAssignmentNotification(button) {
  const taskId = Number(button.dataset.sourceId || 0);
  closeUtilityPanels();
  window.openView?.('calendar');

  let task = state.assignmentTasks.get(taskId) || null;
  if (!task && taskId) {
    try {
      const tasks = await dbApi.getCalendarTasks({
        start: shiftIsoDate(-90),
        end: shiftIsoDate(730),
        user: getCurrentUserName(),
      });
      task = (Array.isArray(tasks) ? tasks : []).find(item => Number(item.id) === taskId) || null;
    } catch (error) {
      console.warn('assignment notification open error', error);
    }
  }

  if (!task) return;
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('calendar:edit-task', { detail: { task } }));
  }, 120);
}

function makeDelegatedTaskReadOnly(task) {
  const form = document.querySelector('[data-calendar-task-form]');
  const dialog = document.querySelector('[data-calendar-task-dialog]');
  if (!form || !dialog?.open) return;

  form.dataset.delegatedReadonly = '1';
  form.querySelectorAll('input, select, textarea').forEach(control => {
    control.disabled = true;
  });
  form.querySelector('button[type="submit"]')?.setAttribute('hidden', '');
  document.querySelector('[data-calendar-delete]')?.setAttribute('hidden', '');
  document.querySelector('[data-calendar-form-link]')?.setAttribute('hidden', '');

  const title = document.querySelector('[data-calendar-dialog-title]');
  if (title) title.textContent = 'Поручение';
  const subtitle = document.querySelector('[data-calendar-dialog-subtitle]');
  if (subtitle) {
    const author = String(task.delegated_by || '').trim();
    subtitle.textContent = author ? `Поручение от ${author}` : 'Полученное контрольное поручение';
  }
}

function isDelegatedToCurrentUser(task) {
  if (!task) return false;
  const currentUser = String(getCurrentUserName() || '').trim();
  const owner = String(task.user_name || task.user || '').trim();
  return Boolean(currentUser
    && String(task.delegated_to || '').trim() === currentUser
    && owner !== currentUser);
}

function updateQuickAssignmentSubtitle() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!form || form.dataset.controlAssignment !== '1') return;
  const assignee = String(form.querySelector('[data-calendar-assignee]')?.value || '').trim();
  const subtitle = document.querySelector('[data-calendar-dialog-subtitle]');
  if (subtitle) {
    subtitle.textContent = assignee
      ? `Исполнитель: ${assignee}`
      : 'Назначьте контрольное поручение сотруднику';
  }
}

function showCalendarFormError(message) {
  const error = document.querySelector('[data-calendar-form-error]');
  if (!error) return;
  error.textContent = message || '';
  error.hidden = !message;
}

function closeUtilityPanels() {
  document.querySelector('#utilityBackdrop')?.setAttribute('hidden', '');
  document.querySelectorAll('.utility-panel').forEach(panel => {
    panel.classList.remove('open');
    panel.setAttribute('hidden', '');
  });
}

function loadAssignmentReadKeys() {
  try {
    const values = JSON.parse(localStorage.getItem(ASSIGNMENT_READS_KEY) || '[]');
    return new Set(Array.isArray(values) ? values.map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberAssignmentReads(keys = []) {
  const reads = loadAssignmentReadKeys();
  (Array.isArray(keys) ? keys : []).forEach(key => {
    const value = String(key || '');
    if (value.startsWith('assignment:')) reads.add(value);
  });
  localStorage.setItem(ASSIGNMENT_READS_KEY, JSON.stringify([...reads].slice(-1000)));
}

function getTaskType(task = {}) {
  return String(task.type || task.task_type || '').trim();
}

function getTaskDate(task = {}) {
  return String(task.date || task.date_str || '').trim();
}

function buildTaskDateTime(task = {}) {
  const date = getTaskDate(task);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const timeMatch = String(task.time || task.time_val || '').match(/^(\d{1,2}):(\d{2})$/);
  const hours = timeMatch ? Number(timeMatch[1]) : 23;
  const minutes = timeMatch ? Number(timeMatch[2]) : 59;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes, 59, 0);
  return Number.isNaN(value.getTime()) ? null : value;
}

function isTaskOverdue(task = {}) {
  const dueAt = buildTaskDateTime(task);
  return Boolean(dueAt && dueAt.getTime() < Date.now());
}

function formatAssignmentDue(task = {}) {
  const date = getTaskDate(task);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const time = String(task.time || task.time_val || '').trim();
  return `${match[3]}.${match[2]}.${match[1]}${time ? `, ${time}` : ''}`;
}

function shiftIsoDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
