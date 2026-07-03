import { dbApi } from '../../api/dbApi.js';

const EXTERNAL_CASE_LABEL = 'Без № ПК';
let initialized = false;
let reserving = null;

export function initGeneralCaseAutoNumberFix() {
  if (initialized) return;
  initialized = true;

  const createGeneralCase = dbApi.createGeneralCase.bind(dbApi);

  dbApi.createGeneralCase = async data => {
    const currentNumber = String(data?.case_no || data?.pk_number || data?.case_number || '').trim();
    if (currentNumber && !isAutoNumberPlaceholder(currentNumber)) {
      return createGeneralCase(data);
    }

    const reserved = await reserveNextNumber();
    const caseNumber = String(reserved?.case_no || '').trim();
    if (!caseNumber) throw new Error('Не удалось автоматически присвоить № ПК');

    const form = document.querySelector('[data-general-form]');
    const field = findNumberField(form);
    if (field) field.value = caseNumber;

    return createGeneralCase({
      ...data,
      case_no: caseNumber
    });
  };

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-general-new]')) {
      window.setTimeout(configureNewCaseNumberField, 0);
      window.setTimeout(configureNewCaseNumberField, 100);
      window.setTimeout(configureNewCaseNumberField, 260);
      return;
    }

    const submit = event.target.closest?.('[data-general-form] button[type="submit"], [data-general-save]');
    if (submit) configureNewCaseNumberField();
  }, true);

  document.addEventListener('invalid', event => {
    const form = event.target.closest?.('[data-general-form]');
    const field = findNumberField(form);
    if (!form || event.target !== field) return;
    if (String(form.elements?.id?.value || '').trim()) return;

    event.preventDefault();
    configureNewCaseNumberField();
    window.setTimeout(() => form.requestSubmit(), 0);
  }, true);

  window.addEventListener('general-cases:updated', configureNewCaseNumberField);
  configureNewCaseNumberField();
}

async function reserveNextNumber() {
  if (reserving) return reserving;

  reserving = requestNextNumber();
  try {
    return await reserving;
  } finally {
    reserving = null;
  }
}

async function requestNextNumber() {
  const response = await fetch('/api/general-cases/next-number', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authorizationHeader()
    },
    body: '{}'
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

function authorizationHeader() {
  try {
    const raw = sessionStorage.getItem('legal-dashboard-auth-session-v1');
    const token = raw ? JSON.parse(raw)?.token || '' : '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function configureNewCaseNumberField() {
  const form = document.querySelector('[data-general-form]');
  const field = findNumberField(form);
  if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)) return;

  rememberOriginalValidation(field);

  const editing = Boolean(String(form.elements?.id?.value || '').trim());
  field.readOnly = true;
  field.setAttribute('aria-readonly', 'true');

  if (editing) {
    field.disabled = false;
    restoreRequired(field);
    field.classList.add('is-pk-locked');
    field.placeholder = '';
    field.title = '№ ПК нельзя изменить после создания дела';
    return;
  }

  field.value = '';
  field.disabled = true;
  field.required = false;
  field.removeAttribute('required');
  field.setCustomValidity('');
  field.classList.remove('is-pk-locked');
  field.placeholder = 'Присваивается автоматически при сохранении';
  field.title = '№ ПК будет присвоен автоматически после нажатия «Сохранить»';
}

function findNumberField(form) {
  return form?.querySelector?.('input[name="case_no"], input[name="pk_number"], input[name="case_number"]') || null;
}

function rememberOriginalValidation(field) {
  if (field.dataset.autoNumberOriginalRequired == null) {
    field.dataset.autoNumberOriginalRequired = field.required || field.hasAttribute('required') ? '1' : '0';
  }
}

function restoreRequired(field) {
  const required = field.dataset.autoNumberOriginalRequired === '1';
  field.required = required;
  if (required) field.setAttribute('required', '');
  else field.removeAttribute('required');
}

function isAutoNumberPlaceholder(value) {
  return !String(value || '').trim();
}

function isExternalCaseNumber(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU') === EXTERNAL_CASE_LABEL.toLocaleLowerCase('ru-RU');
}
