import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';
import { getCurrentUserName } from '../../auth/session.js';

let initialized = false;

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
