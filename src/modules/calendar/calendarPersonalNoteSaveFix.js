import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';
import { getCurrentUserName } from '../../auth/session.js';

let initialized = false;
let scheduleOrderTimer = 0;
let calendarActionTimer = 0;

const PERSONAL_TYPE = 'личное';

export function initCalendarPersonalNoteSaveFix() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('submit', async event => {
    const form = event.target.closest?.('[data-calendar-task-form]');
    if (!(form instanceof HTMLFormElement)) return;
    if (!isPersonalForm(form)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    await savePersonalNote(form);
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-schedule-case-form], [data-schedule-case-dialog], [data-schedule-row], [data-schedule-date-add], [data-schedule-case-add]')) {
      scheduleScheduleDialogOrderFix();
    }
    if (event.target.closest?.('[data-calendar-task-form], [data-calendar-task-dialog], [data-calendar-new], [data-calendar-task-id], [data-calendar-week-task-id]')) {
      scheduleCalendarActionRowFix();
    }
  }, true);

  window.addEventListener('calendar:reload', () => {
    refreshCalendarSafely();
    scheduleCalendarActionRowFix();
  });
  window.addEventListener('general-cases:updated', refreshCalendarSafely);
  window.addEventListener('court-schedule:updated', refreshCalendarSafely);
  window.addEventListener('calendar:edit-task', scheduleCalendarActionRowFix);
  window.addEventListener('calendar:create-for-case', scheduleCalendarActionRowFix);
  window.addEventListener('app:view-changed', () => {
    scheduleScheduleDialogOrderFix();
    scheduleCalendarActionRowFix();
  });

  scheduleScheduleDialogOrderFix();
  scheduleCalendarActionRowFix();
}

function refreshCalendarSafely() {
  window.setTimeout(() => {
    const refreshButton = document.querySelector('[data-calendar-refresh]');
    if (refreshButton instanceof HTMLButtonElement) refreshButton.click();
  }, 80);
}

function scheduleCalendarActionRowFix() {
  window.clearTimeout(calendarActionTimer);
  calendarActionTimer = window.setTimeout(fixCalendarActionRow, 60);
  window.setTimeout(fixCalendarActionRow, 180);
}

function fixCalendarActionRow() {
  const form = document.querySelector('[data-calendar-task-form]');
  const actions = form?.querySelector('.calendar-task-dialog-actions');
  if (!(form instanceof HTMLFormElement) || !actions) return;

  const linkButton = form.querySelector('[data-calendar-form-link]');
  const moreButton = form.querySelector('[data-calendar-form-more]');
  const deleteButton = form.querySelector('[data-calendar-delete]');
  const submitButton = form.querySelector('button[type="submit"]');

  actions.dataset.calendarActionsInline = '1';

  if (linkButton) {
    linkButton.classList.add('calendar-inline-link-action');
    if (String(linkButton.textContent || '').trim() === 'Связать с общим перечнем') {
      linkButton.textContent = 'Изменить связь с общим перечнем';
    }
  }

  if (moreButton) {
    moreButton.classList.add('calendar-more-dots-action', 'more-dots-button');
    moreButton.innerHTML = '<span aria-hidden="true">•••</span>';
    moreButton.title = 'Подробнее';
    moreButton.setAttribute('aria-label', 'Подробнее');
  }

  if (deleteButton) deleteButton.classList.add('calendar-inline-delete-action');
  if (submitButton) submitButton.classList.add('calendar-inline-save-action');
}

function scheduleScheduleDialogOrderFix() {
  window.clearTimeout(scheduleOrderTimer);
  scheduleOrderTimer = window.setTimeout(fixScheduleDialogOrder, 60);
  window.setTimeout(fixScheduleDialogOrder, 180);
}

function fixScheduleDialogOrder() {
  const form = document.querySelector('[data-schedule-case-form]');
  const grid = form?.querySelector('.schedule-form-grid');
  if (!(form instanceof HTMLFormElement) || !grid) return;

  const court = getScheduleField(form, 'court');
  const result = getScheduleField(form, 'category');
  const plaintiff = getScheduleField(form, 'plaintiff');
  const defendant = getScheduleField(form, 'defendant');
  const subject = getScheduleField(form, 'result');
  const representativeInput = form.querySelector('input[name="representative"]');
  const dateInput = form.querySelector('input[name="hearing_date"]');
  const timeInput = form.querySelector('input[name="time"]');
  const todayButton = form.querySelector('[data-schedule-hearing-today]');

  if (!court || !result || !plaintiff || !defendant || !subject || !representativeInput || !dateInput || !timeInput) return;

  subject.classList.add('wide');

  const metaRow = ensureScheduleMetaRow(form, grid);
  const representativeField = rebuildScheduleMetaLabel('schedule-representative-field', 'Представитель', representativeInput);
  const dateField = rebuildScheduleMetaLabel('schedule-hearing-date-field', 'Дата судебного заседания', dateInput);
  const timeField = rebuildScheduleMetaLabel('schedule-hearing-time-field', 'Время', timeInput);

  [court, result, plaintiff, defendant, subject].forEach(node => grid.appendChild(node));
  metaRow.replaceChildren(representativeField, dateField, timeField);
  if (todayButton) {
    todayButton.classList.add('schedule-hearing-today-button');
    metaRow.appendChild(todayButton);
  }
  grid.appendChild(metaRow);

  removeBrokenScheduleWrappers(form);
}

function getScheduleField(form, inputName) {
  return form.querySelector(`[name="${inputName}"]`)?.closest('label') || null;
}

function ensureScheduleMetaRow(form, grid) {
  let row = form.querySelector('.schedule-meta-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'schedule-meta-row wide';
  }
  row.className = 'schedule-meta-row wide';
  if (row.parentElement !== grid) grid.appendChild(row);
  return row;
}

function rebuildScheduleMetaLabel(className, title, input) {
  const oldLabel = input.closest('label');
  const label = document.createElement('label');
  label.className = className;

  const span = document.createElement('span');
  span.textContent = title;
  label.appendChild(span);
  label.appendChild(input);

  if (oldLabel && oldLabel !== label && oldLabel.parentElement) oldLabel.remove();
  return label;
}

function removeBrokenScheduleWrappers(form) {
  form.querySelectorAll('[data-schedule-hearing-date-wrap], .schedule-date-input-row, label').forEach(node => {
    if (node.matches?.('label') && !node.querySelector('input, select, textarea')) node.remove();
    if (node.matches?.('div') && !node.querySelector('input, button, select, textarea')) node.remove();
  });
}

async function savePersonalNote(form) {
  if (form.dataset.saving === '1') return;

  const date = normalizeDate(form.elements?.date?.value || '');
  const time = String(form.elements?.time?.value || '').trim();
  const note = String(form.elements?.note_text?.value || '').trim();
  const id = String(form.elements?.id?.value || '').trim();

  if (!date) {
    showFormError('Укажите дату');
    return;
  }

  if (time) {
    const clean = time.replace(':', '');
    if (clean.length !== 4 || !/^\d+$/.test(clean)) {
      showFormError('Время должно быть в формате ЧЧ:ММ, например 14:30');
      return;
    }
  }

  const title = note || 'Личная заметка';
  const payload = {
    id,
    date,
    date_str: date,
    end_date: date,
    user: getCurrentUserName() || '',
    user_name: getCurrentUserName() || '',
    event_scope: 'personal',
    personal_kind: 'Личное событие',
    type: PERSONAL_TYPE,
    task_type: PERSONAL_TYPE,
    desc: title,
    description: title,
    time,
    time_val: time,
    end_time: '',
    court: '',
    subject: '',
    assignment: '',
    note_text: note,
    private_note: note,
    metadata_json: '{}',
    delegated_to: '',
    delegated_by: '',
    delegation_status: '',
    delegation_source_event_id: null,
    conflict_override: 0,
    done: 0,
    meeting_id: null,
    general_case_id: null
  };

  setSaving(form, true);
  try {
    if (id) {
      await dbApi.updateCalendarTask(id, payload);
      showNotification('Личная заметка обновлена');
    } else {
      await dbApi.createCalendarTask(payload);
      showNotification('Личная заметка сохранена');
    }

    form.closest('dialog')?.close();
    window.dispatchEvent(new CustomEvent('calendar:reload'));
  } catch (error) {
    showFormError('Не удалось сохранить личную заметку: ' + (error?.message || 'ошибка'));
  } finally {
    setSaving(form, false);
  }
}

function isPersonalForm(form) {
  const selectedType = form.querySelector('input[name="type"]:checked')?.value || '';
  const scope = form.elements?.event_scope?.value || '';
  return selectedType === PERSONAL_TYPE || scope === 'personal' || form.dataset.calendarPersonalMode === '1';
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function setSaving(form, saving) {
  form.dataset.saving = saving ? '1' : '0';
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = Boolean(saving);
}

function showFormError(message) {
  const error = document.querySelector('[data-calendar-form-error]');
  if (!error) {
    showNotification(message, 'error');
    return;
  }
  error.textContent = message || '';
  error.hidden = !message;
}
