import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let syncing = false;
let controlledRowsCache = [];

const EXTERNAL_PK_PREFIX = '__EXTERNAL_CONTROL__';

function normalizePk(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^№+/u, '')
    .toLocaleLowerCase('ru-RU');
}

function displayPk(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('№') ? raw : `№${raw}`;
}

function isTechnicalExternalPk(value) {
  return String(value || '').toUpperCase().includes(EXTERNAL_PK_PREFIX);
}

function makeTechnicalExternalPk() {
  return `${EXTERNAL_PK_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pkFromGeneral(row = {}) {
  return row.case_no || row.pk_number || row.case_number || '';
}

function findGeneralByPk(rows, value, excludeId = 0) {
  const key = normalizePk(value);
  if (!key) return null;
  return (Array.isArray(rows) ? rows : []).find(row =>
    normalizePk(pkFromGeneral(row)) === key && Number(row.id || 0) !== Number(excludeId || 0)
  ) || null;
}

function findById(rows, id) {
  return (Array.isArray(rows) ? rows : []).find(row => Number(row.id || 0) === Number(id || 0)) || null;
}

function mergeDefined(base = {}, patch = {}) {
  const result = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined && value !== null) result[key] = value;
  });
  return result;
}

function controlledToGeneral(row = {}) {
  return {
    plaintiff: row.plaintiff || '',
    defendant: row.defendant || '',
    claim_subject: row.subject || row.claim_subject || '',
    executor: row.representative || row.executor || '',
    court_no: row.court_case_number || row.court_no || '',
    court: row.court || '',
    control_flag: 1
  };
}

async function getGeneralRows() {
  return dbApi.getGeneralCases().catch(() => []);
}

async function assertUniqueGeneralPk(value, excludeId = 0) {
  const key = normalizePk(value);
  if (!key) throw new Error('Укажите уникальный № ПК');
  const rows = await getGeneralRows();
  const duplicate = findGeneralByPk(rows, value, excludeId);
  if (duplicate) {
    throw new Error(`Дело с № ПК ${displayPk(value)} уже существует в общем перечне`);
  }
  return rows;
}

function assertPkUnchanged(currentValue, nextValue) {
  if (normalizePk(currentValue) !== normalizePk(nextValue)) {
    throw new Error('№ ПК является уникальным идентификатором дела и не может быть изменён после создания');
  }
}

async function resolveGeneralCaseId(data = {}) {
  const explicit = Number(data.general_case_id || data.generalCaseId || 0);
  if (explicit) return explicit;
  const pk = data.case_no || data.pk_number || data.case_number || data.control_case_number || '';
  if (!normalizePk(pk) || isTechnicalExternalPk(pk)) return null;
  const rows = await getGeneralRows();
  return Number(findGeneralByPk(rows, pk)?.id || 0) || null;
}

function getFieldContainer(field) {
  return field?.closest('label, .form-field, .field, .controlled-form-field') || field?.parentElement || null;
}

function lockGeneralPkField() {
  const form = document.querySelector('[data-general-form]');
  const field = form?.querySelector('input[name="case_no"], input[name="pk_number"], input[name="case_number"]');
  if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)) return;

  const editing = Boolean(String(form.elements?.id?.value || '').trim());
  field.readOnly = editing;
  field.classList.toggle('is-pk-locked', editing);
  field.setAttribute('aria-readonly', editing ? 'true' : 'false');
  field.title = editing ? '№ ПК нельзя изменить после создания дела' : '';
  if (editing) field.dataset.lockedPk = field.value;
  else delete field.dataset.lockedPk;
}

function configureControlledPkField() {
  const form = document.querySelector('[data-controlled-form]');
  const field = form?.querySelector('input[name="case_number"], input[name="case_no"], input[name="pk_number"]');
  if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)) return;

  const id = Number(form.elements?.id?.value || 0);
  const row = findById(controlledRowsCache, id);
  const linked = Boolean(Number(row?.general_case_id || 0));
  const container = getFieldContainer(field);

  if (!id || !linked) {
    container?.setAttribute('hidden', '');
    field.readOnly = false;
    field.classList.remove('is-pk-locked');
    field.removeAttribute('title');
    if (!isTechnicalExternalPk(field.value)) field.value = makeTechnicalExternalPk();
    field.dataset.externalControlled = '1';
    delete field.dataset.lockedPk;
    return;
  }

  container?.removeAttribute('hidden');
  field.readOnly = true;
  field.classList.add('is-pk-locked');
  field.title = '№ ПК связан с карточкой общего перечня и не может быть изменён';
  field.dataset.lockedPk = field.value;
  delete field.dataset.externalControlled;
}

function decorateStandaloneControlledCards() {
  const byId = new Map(controlledRowsCache.map(row => [Number(row.id || 0), row]));
  document.querySelectorAll('[data-controlled-card]').forEach(card => {
    const row = byId.get(Number(card.dataset.controlledCard || 0));
    if (!row || Number(row.general_case_id || 0)) return;
    const kicker = card.querySelector('.controlled-case-kicker');
    const title = card.querySelector('.controlled-case-card-head h4');
    if (kicker) kicker.textContent = 'Контрольное дело другого комитета';
    if (title && (!row.case_number || isTechnicalExternalPk(row.case_number))) {
      title.textContent = row.court_case_number || row.subject || 'Без № ПК';
    }
  });
}

function scheduleUiSync() {
  setTimeout(() => {
    lockGeneralPkField();
    configureControlledPkField();
    decorateStandaloneControlledCards();
  }, 0);
  setTimeout(() => {
    lockGeneralPkField();
    configureControlledPkField();
    decorateStandaloneControlledCards();
  }, 80);
}

const originals = {};

export function initCasePkLinking() {
  if (initialized) return;
  initialized = true;

  originals.createGeneralCase = dbApi.createGeneralCase.bind(dbApi);
  originals.updateGeneralCase = dbApi.updateGeneralCase.bind(dbApi);
  originals.createControlledCase = dbApi.createControlledCase.bind(dbApi);
  originals.updateControlledCase = dbApi.updateControlledCase.bind(dbApi);
  originals.createCourtScheduleCase = dbApi.createCourtScheduleCase.bind(dbApi);
  originals.updateCourtSchedule = dbApi.updateCourtSchedule.bind(dbApi);
  originals.createCalendarTask = dbApi.createCalendarTask.bind(dbApi);
  originals.updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.createGeneralCase = async data => {
    const pk = pkFromGeneral(data);
    await assertUniqueGeneralPk(pk);
    return originals.createGeneralCase({ ...data, case_no: displayPk(pk) });
  };

  dbApi.updateGeneralCase = async (id, data) => {
    const rows = await getGeneralRows();
    const current = findById(rows, id);
    const originalPk = pkFromGeneral(current) || pkFromGeneral(data);
    assertPkUnchanged(originalPk, pkFromGeneral(data));
    await assertUniqueGeneralPk(originalPk, id);
    return originals.updateGeneralCase(id, { ...data, case_no: displayPk(originalPk) });
  };

  dbApi.createControlledCase = async data => {
    const standalone = !Number(data.general_case_id || 0);
    const payload = {
      ...data,
      case_number: standalone && isTechnicalExternalPk(data.case_number) ? '' : data.case_number
    };
    return originals.createControlledCase(payload);
  };

  dbApi.updateControlledCase = async (id, data) => {
    const current = findById(controlledRowsCache, id)
      || (await dbApi.getControlledCases().catch(() => [])).find(row => Number(row.id || 0) === Number(id));
    const generalCaseId = Number(current?.general_case_id || data.general_case_id || 0);
    const standalone = !generalCaseId;

    const saved = await originals.updateControlledCase(id, {
      ...data,
      case_number: standalone && isTechnicalExternalPk(data.case_number) ? '' : data.case_number,
      general_case_id: generalCaseId || null
    });

    if (!standalone && !syncing) {
      syncing = true;
      try {
        const generalRows = await getGeneralRows();
        const general = findById(generalRows, generalCaseId);
        if (general) {
          await originals.updateGeneralCase(general.id, mergeDefined(general, controlledToGeneral(saved)));
          window.dispatchEvent(new CustomEvent('general-cases:reload'));
        }
      } finally {
        syncing = false;
      }
    }

    return saved;
  };

  dbApi.createCourtScheduleCase = async data => originals.createCourtScheduleCase({
    ...data,
    general_case_id: await resolveGeneralCaseId(data)
  });

  dbApi.updateCourtSchedule = async (id, data) => originals.updateCourtSchedule(id, {
    ...data,
    general_case_id: await resolveGeneralCaseId(data)
  });

  dbApi.createCalendarTask = async data => originals.createCalendarTask({
    ...data,
    general_case_id: await resolveGeneralCaseId(data)
  });

  dbApi.updateCalendarTask = async (id, data) => originals.updateCalendarTask(id, {
    ...data,
    general_case_id: await resolveGeneralCaseId(data)
  });

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-general-new], [data-general-open], [data-controlled-new], [data-controlled-open], [data-controlled-row], [data-controlled-card]')) {
      scheduleUiSync();
    }
  }, true);

  document.addEventListener('input', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.classList.contains('is-pk-locked')) return;
    if (field.dataset.lockedPk != null && field.value !== field.dataset.lockedPk) {
      field.value = field.dataset.lockedPk;
    }
  }, true);

  window.addEventListener('general-cases:updated', scheduleUiSync);
  window.addEventListener('controlled-cases:updated', event => {
    controlledRowsCache = Array.isArray(event.detail) ? event.detail : [];
    scheduleUiSync();
  });

  scheduleUiSync();
}
