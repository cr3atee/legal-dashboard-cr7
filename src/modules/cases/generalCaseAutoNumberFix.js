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
    if (currentNumber || isExternalCaseNumber(currentNumber)) {
      return createGeneralCase(data);
    }

    const reserved = await reserveNextNumber();
    const caseNumber = String(reserved?.case_no || '').trim();
    if (!caseNumber) throw new Error('Не удалось автоматически присвоить № ПК');

    const form = document.querySelector('[data-general-form]');
    if (form?.elements?.case_no) form.elements.case_no.value = caseNumber;

    return createGeneralCase({
      ...data,
      case_no: caseNumber
    });
  };

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-general-new]')) {
      window.setTimeout(configureNewCaseNumberField, 0);
      window.setTimeout(configureNewCaseNumberField, 100);
    }
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
  const field = form?.querySelector('input[name="case_no"], input[name="pk_number"], input[name="case_number"]');
  if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)) return;

  const editing = Boolean(String(form.elements?.id?.value || '').trim());
  field.readOnly = true;
  field.setAttribute('aria-readonly', 'true');

  if (editing) {
    field.classList.add('is-pk-locked');
    field.placeholder = '';
    field.title = '№ ПК нельзя изменить после создания дела';
    return;
  }

  field.value = '';
  field.classList.remove('is-pk-locked');
  field.placeholder = 'Присваивается автоматически при сохранении';
  field.title = '№ ПК будет присвоен автоматически после нажатия «Сохранить»';
}

function isExternalCaseNumber(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU') === EXTERNAL_CASE_LABEL.toLocaleLowerCase('ru-RU');
}
