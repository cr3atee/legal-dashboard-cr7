import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';

let initialized = false;
const unlockTimers = new WeakMap();

export function initCaseCreationGuard() {
  if (initialized) return;
  initialized = true;

  const createGeneralCase = dbApi.createGeneralCase.bind(dbApi);
  const updateGeneralCase = dbApi.updateGeneralCase.bind(dbApi);
  const createControlledCase = dbApi.createControlledCase.bind(dbApi);
  const updateControlledCase = dbApi.updateControlledCase.bind(dbApi);

  dbApi.createGeneralCase = data => runGuardedApi('general', createGeneralCase, data);
  dbApi.updateGeneralCase = (id, data) => runGuardedApi('general', payload => updateGeneralCase(id, payload), data);
  dbApi.createControlledCase = data => runGuardedApi('controlled', createControlledCase, data);
  dbApi.updateControlledCase = (id, data) => runGuardedApi('controlled', payload => updateControlledCase(id, payload), data);

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-general-form], [data-controlled-form]');
    if (!(form instanceof HTMLFormElement)) return;

    if (form.dataset.caseSubmitLocked === '1') {
      event.preventDefault();
      event.stopImmediatePropagation();
      showNotification('Сохранение уже выполняется');
      return;
    }

    lockForm(form);
    window.setTimeout(() => {
      if (form.dataset.caseApiStarted !== '1') unlockForm(form);
    }, 700);
  }, true);

  window.addEventListener('general-cases:updated', () => unlockForm(getForm('general')));
  window.addEventListener('controlled-cases:updated', () => unlockForm(getForm('controlled')));

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-general-new], [data-controlled-new], [data-controlled-clear]')) {
      unlockForm(event.target.closest?.('[data-general-new]') ? getForm('general') : getForm('controlled'));
    }
  }, true);
}

async function runGuardedApi(kind, operation, data) {
  const form = getForm(kind);
  if (form) form.dataset.caseApiStarted = '1';

  try {
    const result = await operation(data);
    if (form) form.dataset.caseApiCompleted = '1';
    return result;
  } catch (error) {
    unlockForm(form);
    throw error;
  }
}

function getForm(kind) {
  return document.querySelector(kind === 'general' ? '[data-general-form]' : '[data-controlled-form]');
}

function lockForm(form) {
  if (!(form instanceof HTMLFormElement)) return;
  form.dataset.caseSubmitLocked = '1';
  form.dataset.caseApiStarted = '0';
  form.dataset.caseApiCompleted = '0';
  setSubmitDisabled(form, true);

  clearTimeout(unlockTimers.get(form));
  unlockTimers.set(form, window.setTimeout(() => unlockForm(form), 30000));
}

function unlockForm(form) {
  if (!(form instanceof HTMLFormElement)) return;
  clearTimeout(unlockTimers.get(form));
  unlockTimers.delete(form);
  delete form.dataset.caseSubmitLocked;
  delete form.dataset.caseApiStarted;
  delete form.dataset.caseApiCompleted;
  setSubmitDisabled(form, false);
}

function setSubmitDisabled(form, disabled) {
  form.querySelectorAll('button[type="submit"], [data-general-save], [data-controlled-save]').forEach(button => {
    button.disabled = Boolean(disabled);
    button.setAttribute('aria-busy', disabled ? 'true' : 'false');
  });
}
