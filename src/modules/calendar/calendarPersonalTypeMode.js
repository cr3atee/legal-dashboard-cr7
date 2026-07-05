let initialized = false;
let scheduled = false;

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

  document.addEventListener('click', event => {
    if (event.target.closest('[data-calendar-new], [data-calendar-task-id], [data-calendar-week-task-id], [data-calendar-plan-add]')) scheduleFixes();
  }, true);

  document.addEventListener('change', event => {
    if (event.target.closest('[data-calendar-task-form]')) scheduleFixes();
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-calendar-task-form]');
    if (form instanceof HTMLFormElement) syncScopeFromType(form);
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
  window.setTimeout(() => {
    scheduled = false;
    applyCalendarPersonalTypeMode();
  }, 0);
  window.setTimeout(applyCalendarPersonalTypeMode, 120);
  window.setTimeout(applyCalendarPersonalTypeMode, 320);
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
}

function fixVisibleFields(form) {
  const personal = getSelectedType(form) === PERSONAL_TYPE || getScopeValue(form) === 'personal';
  const typeBlock = form.querySelector('[data-calendar-work-fields]');
  if (typeBlock) typeBlock.hidden = false;

  setFieldVisible(form, 'executor', true);
  setFieldVisible(form, 'date', true);
  setFieldVisible(form, 'time', true);

  const hint = form.querySelector('[data-calendar-privacy-hint]');
  if (hint) hint.hidden = !personal;

  const noteLabel = form.querySelector('[data-calendar-note-label]');
  if (noteLabel) noteLabel.textContent = personal ? 'Приватная заметка' : 'Заметка / напоминание';

  if (!personal) return;

  setFieldVisible(form, 'desc', true);
  setFieldVisible(form, 'note_text', true);
  setFieldVisible(form, 'court', false);
  setFieldVisible(form, 'subject', false);
  setFieldVisible(form, 'assignment', false);

  const caseFields = form.querySelector('[data-calendar-case-fields]');
  if (caseFields) caseFields.hidden = true;
  const linkButton = form.querySelector('[data-calendar-form-link]');
  if (linkButton) linkButton.hidden = true;
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
