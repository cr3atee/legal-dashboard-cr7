import { dbApi } from '../../api/dbApi.js';
import { getCurrentUserName } from '../../auth/session.js';

let initialized = false;
let ownersLoaded = false;
let owners = [];

export function initCalendarInlineDateTimeRow() {
  if (initialized) return;
  initialized = true;

  const createCalendarTask = dbApi.createCalendarTask.bind(dbApi);
  const updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.createCalendarTask = data => createCalendarTask(normalizeCalendarPayloadDate(applyOwnerFromForm(data)));
  dbApi.updateCalendarTask = (id, data) => updateCalendarTask(id, normalizeCalendarPayloadDate(applyOwnerFromForm(data)));

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-calendar-new], [data-calendar-plan-add], [data-calendar-task-id], [data-calendar-week-task-id]')) {
      scheduleFormFixes(event.target.closest?.('[data-calendar-new]') ? 'new' : 'open');
    }
  }, true);

  document.addEventListener('input', event => {
    if (event.target.matches?.('[data-calendar-date-text]')) {
      formatRuDateInput(event.target);
    }
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-calendar-task-form]');
    if (!(form instanceof HTMLFormElement)) return;
    normalizeCalendarFormDateForSubmit(form);
  }, true);

  document.addEventListener('change', event => {
    if (event.target.matches?.('[name="type"], [name="event_scope"]')) scheduleFormFixes('open');
  }, true);

  window.addEventListener('calendar:edit-task', () => scheduleFormFixes('open'));
  window.addEventListener('calendar:create-for-case', () => scheduleFormFixes('new'));

  scheduleFormFixes('open');
}

function scheduleFormFixes(mode) {
  window.setTimeout(() => fixCalendarForm(mode), 0);
  window.setTimeout(() => fixCalendarForm(mode), 80);
  window.setTimeout(() => fixCalendarForm(mode), 220);
}

async function fixCalendarForm(mode = 'open') {
  const dialog = document.querySelector('[data-calendar-task-dialog]');
  const form = document.querySelector('[data-calendar-task-form]');
  if (!dialog || !form || !dialog.open) return;

  await fillOwnerSelect(form);
  keepDateTimeRowVisible(form);

  const isNew = !String(form.elements?.id?.value || '').trim();
  const todayIsoValue = todayIso();
  const todayRuValue = isoToRuDate(todayIsoValue);
  const dateField = form.elements?.date;

  if (dateField && /^\d{4}-\d{2}-\d{2}$/.test(String(dateField.value || ''))) {
    dateField.value = isoToRuDate(dateField.value);
  }

  if (isNew && mode === 'new') {
    if (dateField) dateField.value = todayRuValue;
    if (form.elements?.end_date) form.elements.end_date.value = todayIsoValue;
  }

  if (isNew && !dateField?.value) {
    if (dateField) dateField.value = todayRuValue;
    if (form.elements?.end_date) form.elements.end_date.value = todayIsoValue;
  }

  const ownerSelect = form.elements?.executor;
  if (ownerSelect && isNew && !ownerSelect.dataset.userChanged) ownerSelect.value = '';
}

async function fillOwnerSelect(form) {
  const select = form.elements?.executor;
  if (!(select instanceof HTMLSelectElement)) return;

  if (!select.dataset.ownerChangeBound) {
    select.dataset.ownerChangeBound = '1';
    select.addEventListener('change', () => {
      select.dataset.userChanged = '1';
    });
  }

  const isNew = !String(form.elements?.id?.value || '').trim();

  if (!ownersLoaded) {
    ownersLoaded = true;
    owners = await loadOwners();
  }

  const currentValue = select.value;
  const currentUser = getCurrentUserName() || '';
  const optionValues = unique([currentUser, ...owners].filter(Boolean));

  select.innerHTML = `<option value="">Не выбран</option>${optionValues
    .map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
    .join('')}`;

  if (isNew && !select.dataset.userChanged) {
    select.value = '';
    return;
  }

  const existingTaskOwner = isNew ? '' : getOwnerFromSubtitle();
  const targetValue = currentValue || existingTaskOwner || '';
  select.value = optionValues.includes(targetValue) ? targetValue : '';
}

async function loadOwners() {
  const values = [];
  try {
    const users = await dbApi.getUsers();
    if (Array.isArray(users)) values.push(...users.map(item => typeof item === 'string' ? item : item?.full_name).filter(Boolean));
  } catch {}

  try {
    const calendarUsers = await dbApi.getCalendarUsers();
    if (Array.isArray(calendarUsers)) values.push(...calendarUsers.map(item => item?.full_name || item?.name).filter(Boolean));
  } catch {}

  return unique(values);
}

function keepDateTimeRowVisible(form) {
  ['executor', 'date', 'time'].forEach(name => {
    const node = form.querySelector(`[data-calendar-field="${name}"]`);
    if (node) node.hidden = false;
  });
}

function normalizeCalendarFormDateForSubmit(form) {
  const dateField = form.elements?.date;
  if (!(dateField instanceof HTMLInputElement)) return;

  const iso = ruDateToIso(dateField.value) || dateField.value;
  dateField.value = iso;
  if (form.elements?.end_date && !form.elements.end_date.value) form.elements.end_date.value = iso;
}

function applyOwnerFromForm(data = {}) {
  const form = document.querySelector('[data-calendar-task-form]');
  const selectedOwner = String(form?.elements?.executor?.value || '').trim();
  if (!selectedOwner) return data;
  return {
    ...data,
    user: selectedOwner,
    user_name: selectedOwner
  };
}

function normalizeCalendarPayloadDate(data = {}) {
  const date = ruDateToIso(data.date) || data.date;
  const endDate = ruDateToIso(data.end_date) || data.end_date || date;
  return {
    ...data,
    date,
    date_str: date,
    end_date: endDate
  };
}

function getOwnerFromSubtitle() {
  const text = document.querySelector('[data-calendar-dialog-subtitle]')?.textContent || '';
  const marker = 'Владелец:';
  const index = text.indexOf(marker);
  if (index < 0) return '';
  return text.slice(index + marker.length).trim();
}

function todayIso() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function formatRuDateInput(input) {
  const digits = String(input.value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) {
    input.value = digits;
    return;
  }
  if (digits.length <= 4) {
    input.value = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    return;
  }
  input.value = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

function ruDateToIso(value) {
  const match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function isoToRuDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '';
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function unique(values) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
