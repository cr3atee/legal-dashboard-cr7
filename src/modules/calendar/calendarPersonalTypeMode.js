import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let scheduled = false;
let applyTimer = 0;

const PERSONAL_TYPE = 'личное';
const TYPE_LABELS = {
  'судебное_заседание': 'Судебное заседание',
  'процессуальный_срок': 'Процессуальный срок',
  'отзыв': 'Подготовка отзыва/жалобы',
  'поручение': 'Контрольное поручение',
  'рабочая_заметка': 'Рабочая заметка',
  'иное': 'Иное',
  'личное': 'Личное'
};

export function initCalendarPersonalTypeMode() {
  if (initialized) return;
  initialized = true;

  const createCalendarTask = dbApi.createCalendarTask.bind(dbApi);
  const updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);
  dbApi.createCalendarTask = data => createCalendarTask(normalizePersonalPayload(data));
  dbApi.updateCalendarTask = (id, data) => updateCalendarTask(id, normalizePersonalPayload(data));

  document.addEventListener('click', event => {
    if (event.target.closest('[data-calendar-new], [data-calendar-task-id], [data-calendar-week-task-id], [data-calendar-plan-add]')) scheduleFixes();
  }, true);

  document.addEventListener('change', event => {
    const form = event.target.closest('[data-calendar-task-form]');
    if (!(form instanceof HTMLFormElement)) return;

    if (event.target.matches('input[name="type"], input[name="event_scope"]')) {
      syncScopeFromType(form);
      fixVisibleFields(form);
      syncSubmitButton(form);
    }
    scheduleFixes();
  }, true);

  document.addEventListener('input', event => {
    const form = event.target.closest('[data-calendar-task-form]');
    if (!(form instanceof HTMLFormElement)) return;
    if (isPersonalMode(form)) syncSubmitButton(form);
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-calendar-task-form]');
    if (!(form instanceof HTMLFormElement)) return;
    syncScopeFromType(form);
    preparePersonalNoteForSubmit(form);
    syncSubmitButton(form);
  }, true);

  window.addEventListener('calendar:edit-task', scheduleFixes);
  window.addEventListener('calendar:create-for-case', scheduleFixes);
  window.addEventListener('calendar:reload', scheduleFixes);
  window.addEventListener('app:view-changed', scheduleFixes);

  scheduleFixes();
}

function scheduleFixes() {
  if (scheduled) return;
  scheduled = true;
  window.clearTimeout(applyTimer);
  applyTimer = window.setTimeout(() => {
    scheduled = false;
    applyCalendarPersonalTypeMode();
  }, 40);
}

function applyCalendarPersonalTypeMode() {
  const form = document.querySelector('[data-calendar-task-form]');
  if (!(form instanceof HTMLFormElement)) return;

  hideScopeButtons(form);
  ensurePersonalOption(form);
  renameTypeLabels(form);
  checkPersonalOptionForExistingTask(form);
  syncScopeFromType(form);
  fixVisibleFields(form);
  syncSubmitButton(form);
}

function hideScopeButtons(form) {
  const scope = form.querySelector('.calendar-event-scope');
  if (scope) scope.hidden = true;
}

function ensurePersonalOption(form) {
  const list = form.querySelector('.calendar-task-types');
  if (!list) return;
  if (list.querySelector('input[name="type"][value="' + PERSONAL_TYPE + '"]')) return;

  const label = document.createElement('label');
  label.className = 'calendar-personal-type-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'type';
  input.value = PERSONAL_TYPE;

  const span = document.createElement('span');
  span.textContent = 'Личное';

  label.appendChild(input);
  label.appendChild(span);
  list.appendChild(label);
}

function renameTypeLabels(form) {
  Object.keys(TYPE_LABELS).forEach(value => {
    const input = form.querySelector('input[name="type"][value="' + value + '"]');
    const span = input?.closest('label')?.querySelector('span');
    if (span) span.textContent = TYPE_LABELS[value];
  });
}

function checkPersonalOptionForExistingTask(form) {
  if (getSelectedType(form)) return;
  if (getScopeValue(form) !== 'personal') return;
  const input = form.querySelector('input[name="type"][value="' + PERSONAL_TYPE + '"]');
  if (input instanceof HTMLInputElement) input.checked = true;
}

function syncScopeFromType(form) {
  const selected = getSelectedType(form);
  const personal = selected === PERSONAL_TYPE;
  setScopeValue(form, personal ? 'personal' : 'work');
  if (personal && form.elements.personal_kind) form.elements.personal_kind.value = 'Личное событие';
  form.dataset.calendarPersonalMode = personal ? '1' : '0';
}

function fixVisibleFields(form) {
  const personal = isPersonalMode(form);
  form.dataset.calendarPersonalMode = personal ? '1' : '0';

  const typeBlock = form.querySelector('[data-calendar-work-fields]');
  if (typeBlock) typeBlock.hidden = false;

  if (!personal) {
    setFieldVisible(form, 'executor', true);
    setFieldVisible(form, 'date', true);
    setFieldVisible(form, 'time', true);
    return;
  }

  setFieldVisible(form, 'executor', true);
  setFieldVisible(form, 'date', true);
  setFieldVisible(form, 'time', true);
  setFieldVisible(form, 'desc', false);
  setFieldVisible(form, 'court', false);
  setFieldVisible(form, 'subject', false);
  setFieldVisible(form, 'assignment', false);
  setFieldVisible(form, 'note_text', true);

  const hint = form.querySelector('[data-calendar-privacy-hint]');
  if (hint) hint.hidden = true;

  const noteLabel = form.querySelector('[data-calendar-note-label]');
  if (noteLabel) noteLabel.textContent = 'Заметка';

  const caseFields = form.querySelector('[data-calendar-case-fields]');
  if (caseFields) caseFields.hidden = true;
  const linkButton = form.querySelector('[data-calendar-form-link]');
  if (linkButton) linkButton.hidden = true;
  const moreButton = form.querySelector('[data-calendar-form-more]');
  if (moreButton && !form.elements.id?.value) moreButton.hidden = true;
}

function preparePersonalNoteForSubmit(form) {
  if (!isPersonalMode(form)) return;
  const note = String(form.elements.note_text?.value || '').trim();
  if (form.elements.desc) form.elements.desc.value = note || 'Личная заметка';
}

function normalizePersonalPayload(data = {}) {
  const personal = String(data.event_scope || '') === 'personal' || String(data.type || '') === PERSONAL_TYPE;
  if (!personal) return data;

  const note = String(data.private_note || data.note_text || data.desc || '').trim();
  return {
    ...data,
    event_scope: 'personal',
    type: PERSONAL_TYPE,
    task_type: PERSONAL_TYPE,
    personal_kind: data.personal_kind || 'Личное событие',
    desc: note || data.desc || 'Личная заметка',
    description: note || data.description || data.desc || 'Личная заметка',
    note_text: note,
    private_note: note,
    court: '',
    subject: '',
    assignment: '',
    general_case_id: null,
    meeting_id: null
  };
}

function syncSubmitButton(form) {
  const submit = form.querySelector('button[type="submit"]');
  if (!submit || form.dataset.saving === '1') return;
  if (isPersonalMode(form)) {
    submit.disabled = !String(form.elements.date?.value || '').trim();
  }
}

function isPersonalMode(form) {
  return getSelectedType(form) === PERSONAL_TYPE || getScopeValue(form) === 'personal' || form.dataset.calendarPersonalMode === '1';
}

function setFieldVisible(form, name, visible) {
  const field = form.querySelector('[data-calendar-field="' + name + '"]');
  if (field) field.hidden = !visible;
}

function getSelectedType(form) {
  return form.querySelector('input[name="type"]:checked')?.value || '';
}

function getScopeValue(form) {
  const scope = form.elements?.event_scope;
  if (!scope) return 'work';
  return scope.value || 'work';
}

function setScopeValue(form, value) {
  const scope = form.elements?.event_scope;
  if (!scope) return;
  if (scope instanceof RadioNodeList) {
    Array.from(scope).forEach(input => {
      if (input instanceof HTMLInputElement) input.checked = input.value === value;
    });
    return;
  }
  scope.value = value;
}
