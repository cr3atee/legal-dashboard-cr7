import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let syncing = false;
let lifecycleSyncing = false;
let controlledRowsCache = [];
let generalRowsCache = [];

const INTERNAL_STANDALONE_PK = '№0';
const EXTERNAL_CASE_LABEL = 'Без № ПК';

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

function isExternalCaseNumber(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU') === EXTERNAL_CASE_LABEL.toLocaleLowerCase('ru-RU');
}

function pkFromGeneral(row = {}) {
  return row.case_no || row.pk_number || row.case_number || '';
}

function findGeneralByPk(rows, value, excludeId = 0) {
  const key = normalizePk(value);
  if (!key || isExternalCaseNumber(value)) return null;
  return (Array.isArray(rows) ? rows : []).find(row =>
    !isExternalCaseNumber(pkFromGeneral(row))
    && normalizePk(pkFromGeneral(row)) === key
    && Number(row.id || 0) !== Number(excludeId || 0)
  ) || null;
}

function findById(rows, id) {
  return (Array.isArray(rows) ? rows : []).find(row => Number(row.id || 0) === Number(id || 0)) || null;
}

function linkedControlledByGeneralId(rows, generalCaseId) {
  return (Array.isArray(rows) ? rows : []).find(row => Number(row.general_case_id || 0) === Number(generalCaseId || 0)) || null;
}

function mergeDefined(base = {}, patch = {}) {
  const result = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined && value !== null) result[key] = value;
  });
  return result;
}

function controlledToGeneral(row = {}, current = {}) {
  return {
    ...current,
    case_no: current.case_no || EXTERNAL_CASE_LABEL,
    plaintiff: row.plaintiff || '',
    defendant: row.defendant || '',
    claim_subject: row.subject || row.claim_subject || '',
    executor: row.representative || row.executor || '',
    court_no: row.court_case_number || row.court_no || '',
    court: row.court || '',
    control_flag: 1
  };
}

function generalToControlled(row = {}, current = {}) {
  return {
    ...current,
    case_number: isExternalCaseNumber(row.case_no) ? '' : (row.case_no || ''),
    plaintiff: row.plaintiff || '',
    defendant: row.defendant || '',
    subject: row.claim_subject || row.subject || '',
    representative: row.executor || row.representative || '',
    court_case_number: row.court_no || row.court_case_number || '',
    court: row.court || '',
    general_case_id: Number(row.id || current.general_case_id || 0) || null
  };
}

async function getGeneralRows() {
  generalRowsCache = await dbApi.getGeneralCases().catch(() => generalRowsCache || []);
  return generalRowsCache;
}

async function getControlledRows() {
  controlledRowsCache = await dbApi.getControlledCases().catch(() => controlledRowsCache || []);
  return controlledRowsCache;
}

async function assertUniqueGeneralPk(value, excludeId = 0) {
  const key = normalizePk(value);
  if (!key || isExternalCaseNumber(value)) throw new Error('Укажите уникальный № ПК');
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
  if (!normalizePk(pk) || pk === INTERNAL_STANDALONE_PK || isExternalCaseNumber(pk)) return null;
  const rows = await getGeneralRows();
  return Number(findGeneralByPk(rows, pk)?.id || 0) || null;
}

function getFieldContainer(field) {
  return field?.closest('label, .form-field, .field, .controlled-form-field') || field?.parentElement || null;
}

function getControlledFormState(form) {
  const id = Number(form?.elements?.id?.value || 0);
  const row = findById(controlledRowsCache, id);
  const external = !id || !String(row?.case_number || '').trim();
  return { id, row, external };
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

  const { external } = getControlledFormState(form);
  const container = getFieldContainer(field);

  if (external) {
    if (container) {
      container.hidden = true;
      container.setAttribute('aria-hidden', 'true');
      container.dataset.externalControlledPk = '1';
      container.style.setProperty('display', 'none', 'important');
    }
    field.value = INTERNAL_STANDALONE_PK;
    field.readOnly = true;
    field.tabIndex = -1;
    field.classList.remove('is-pk-locked');
    field.removeAttribute('title');
    field.dataset.externalControlled = '1';
    delete field.dataset.lockedPk;
    return;
  }

  if (container) {
    container.hidden = false;
    container.removeAttribute('aria-hidden');
    delete container.dataset.externalControlledPk;
    container.style.removeProperty('display');
  }
  field.tabIndex = 0;
  field.readOnly = true;
  field.classList.add('is-pk-locked');
  field.title = '№ ПК связан с карточкой общего перечня и не может быть изменён';
  field.dataset.lockedPk = field.value;
  delete field.dataset.externalControlled;
}

function prepareExternalControlledSubmit(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const { external } = getControlledFormState(form);
  if (!external) return;
  const field = form.querySelector('input[name="case_number"], input[name="case_no"], input[name="pk_number"]');
  if (field instanceof HTMLInputElement) field.value = INTERNAL_STANDALONE_PK;
}

function decorateExternalControlledCards() {
  const byId = new Map(controlledRowsCache.map(row => [Number(row.id || 0), row]));
  document.querySelectorAll('[data-controlled-card]').forEach(card => {
    const row = byId.get(Number(card.dataset.controlledCard || 0));
    if (!row || String(row.case_number || '').trim()) return;
    const kicker = card.querySelector('.controlled-case-kicker');
    const title = card.querySelector('.controlled-case-card-head h4');
    if (kicker) kicker.textContent = 'Контрольное дело другого комитета';
    if (title) title.textContent = EXTERNAL_CASE_LABEL;
  });
}

function scheduleUiSync() {
  setTimeout(() => {
    lockGeneralPkField();
    configureControlledPkField();
    decorateExternalControlledCards();
  }, 0);
  setTimeout(() => {
    lockGeneralPkField();
    configureControlledPkField();
    decorateExternalControlledCards();
  }, 80);
  setTimeout(configureControlledPkField, 220);
}

function archiveData(row = {}) {
  if (row?.data && typeof row.data === 'object') return row.data;
  try { return JSON.parse(row?.data || '{}'); } catch { return {}; }
}

function dispatchCaseReloads() {
  window.dispatchEvent(new CustomEvent('general-cases:reload'));
  window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
}

const originals = {};

export function initCasePkLinking() {
  if (initialized) return;
  initialized = true;

  originals.createGeneralCase = dbApi.createGeneralCase.bind(dbApi);
  originals.updateGeneralCase = dbApi.updateGeneralCase.bind(dbApi);
  originals.archiveGeneralCase = dbApi.archiveGeneralCase.bind(dbApi);
  originals.restoreGeneralCase = dbApi.restoreGeneralCase.bind(dbApi);
  originals.createControlledCase = dbApi.createControlledCase.bind(dbApi);
  originals.updateControlledCase = dbApi.updateControlledCase.bind(dbApi);
  originals.archiveControlledCase = dbApi.archiveControlledCase.bind(dbApi);
  originals.restoreControlledCase = dbApi.restoreControlledCase.bind(dbApi);
  originals.deleteControlledArchiveCase = dbApi.deleteControlledArchiveCase.bind(dbApi);
  originals.createCourtScheduleCase = dbApi.createCourtScheduleCase.bind(dbApi);
  originals.updateCourtSchedule = dbApi.updateCourtSchedule.bind(dbApi);
  originals.createCalendarTask = dbApi.createCalendarTask.bind(dbApi);
  originals.updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.createGeneralCase = async data => {
    const pk = pkFromGeneral(data);
    await assertUniqueGeneralPk(pk);
    const saved = await originals.createGeneralCase({ ...data, case_no: displayPk(pk) });
    await Promise.all([getGeneralRows(), getControlledRows()]);
    return saved;
  };

  dbApi.updateGeneralCase = async (id, data) => {
    const [generalRows, controlledRows] = await Promise.all([getGeneralRows(), getControlledRows()]);
    const current = findById(generalRows, id);
    const linked = linkedControlledByGeneralId(controlledRows, id);
    const external = Boolean(linked && isExternalCaseNumber(pkFromGeneral(current)));

    let caseNo;
    if (external) {
      caseNo = EXTERNAL_CASE_LABEL;
    } else {
      const originalPk = pkFromGeneral(current) || pkFromGeneral(data);
      assertPkUnchanged(originalPk, pkFromGeneral(data));
      await assertUniqueGeneralPk(originalPk, id);
      caseNo = displayPk(originalPk);
    }

    const saved = await originals.updateGeneralCase(id, { ...data, case_no: caseNo });
    await Promise.all([getGeneralRows(), getControlledRows()]);
    return saved;
  };

  dbApi.createControlledCase = async data => {
    const explicitGeneralCaseId = Number(data.general_case_id || 0);
    if (explicitGeneralCaseId) {
      return originals.createControlledCase({ ...data, case_number: data.case_number || '' });
    }

    syncing = true;
    try {
      const general = await originals.createGeneralCase({
        ...controlledToGeneral(data),
        case_no: EXTERNAL_CASE_LABEL,
        control_flag: 1,
        skip_linked: true
      });

      const controlled = await originals.createControlledCase({
        ...data,
        case_number: '',
        general_case_id: general.id
      });

      await Promise.all([getGeneralRows(), getControlledRows()]);
      dispatchCaseReloads();
      return controlled;
    } finally {
      syncing = false;
    }
  };

  dbApi.updateControlledCase = async (id, data) => {
    const currentRows = await getControlledRows();
    let current = findById(currentRows, id);
    let generalCaseId = Number(current?.general_case_id || data.general_case_id || 0);

    if (!generalCaseId) {
      const general = await originals.createGeneralCase({
        ...controlledToGeneral(data),
        case_no: EXTERNAL_CASE_LABEL,
        control_flag: 1,
        skip_linked: true
      });
      generalCaseId = Number(general.id);
    }

    const generalRows = await getGeneralRows();
    const general = findById(generalRows, generalCaseId);
    const external = isExternalCaseNumber(general?.case_no) || !String(current?.case_number || '').trim();

    const saved = await originals.updateControlledCase(id, {
      ...data,
      case_number: external ? '' : (general?.case_no || data.case_number || ''),
      general_case_id: generalCaseId
    });

    if (!syncing) {
      syncing = true;
      try {
        await originals.updateGeneralCase(generalCaseId, {
          ...controlledToGeneral(saved, general || {}),
          case_no: external ? EXTERNAL_CASE_LABEL : (general?.case_no || ''),
          skip_linked: true
        });
      } finally {
        syncing = false;
      }
    }

    await Promise.all([getGeneralRows(), getControlledRows()]);
    dispatchCaseReloads();
    return saved;
  };

  dbApi.archiveGeneralCase = async id => {
    if (lifecycleSyncing) return originals.archiveGeneralCase(id);
    lifecycleSyncing = true;
    try {
      const linked = linkedControlledByGeneralId(await getControlledRows(), id);
      if (linked) await originals.archiveControlledCase(linked.id);
      const result = await originals.archiveGeneralCase(id);
      dispatchCaseReloads();
      return result;
    } finally {
      lifecycleSyncing = false;
    }
  };

  dbApi.archiveControlledCase = async id => {
    if (lifecycleSyncing) return originals.archiveControlledCase(id);
    lifecycleSyncing = true;
    try {
      const row = findById(await getControlledRows(), id);
      const result = await originals.archiveControlledCase(id);
      if (Number(row?.general_case_id || 0)) await originals.archiveGeneralCase(row.general_case_id);
      dispatchCaseReloads();
      return result;
    } finally {
      lifecycleSyncing = false;
    }
  };

  dbApi.restoreControlledCase = async archiveId => {
    if (lifecycleSyncing) return originals.restoreControlledCase(archiveId);
    lifecycleSyncing = true;
    try {
      const controlledArchive = (await dbApi.getArchivedControlledCases()).find(row => Number(row.id) === Number(archiveId));
      const controlledData = archiveData(controlledArchive);
      const oldGeneralId = Number(controlledData.general_case_id || 0);
      let restoredGeneral = null;

      if (oldGeneralId) {
        const generalArchive = (await dbApi.getArchivedGeneralCases()).find(row => Number(row.source_id || 0) === oldGeneralId);
        if (generalArchive) restoredGeneral = await originals.restoreGeneralCase(generalArchive.id);
      }

      const restoredControlled = await originals.restoreControlledCase(archiveId);
      if (restoredGeneral?.id && restoredControlled?.id) {
        await originals.updateControlledCase(restoredControlled.id, {
          ...restoredControlled,
          general_case_id: restoredGeneral.id,
          case_number: isExternalCaseNumber(restoredGeneral.case_no) ? '' : restoredGeneral.case_no
        });
      }
      dispatchCaseReloads();
      return restoredControlled;
    } finally {
      lifecycleSyncing = false;
    }
  };

  dbApi.restoreGeneralCase = async archiveId => {
    if (lifecycleSyncing) return originals.restoreGeneralCase(archiveId);
    lifecycleSyncing = true;
    try {
      const generalArchive = (await dbApi.getArchivedGeneralCases()).find(row => Number(row.id) === Number(archiveId));
      const oldGeneralId = Number(generalArchive?.source_id || 0);
      const controlledArchive = (await dbApi.getArchivedControlledCases()).find(row => Number(archiveData(row).general_case_id || 0) === oldGeneralId);
      const restoredGeneral = await originals.restoreGeneralCase(archiveId);

      if (controlledArchive && restoredGeneral?.id) {
        const restoredControlled = await originals.restoreControlledCase(controlledArchive.id);
        if (restoredControlled?.id) {
          await originals.updateControlledCase(restoredControlled.id, {
            ...restoredControlled,
            general_case_id: restoredGeneral.id,
            case_number: isExternalCaseNumber(restoredGeneral.case_no) ? '' : restoredGeneral.case_no
          });
        }
      }
      dispatchCaseReloads();
      return restoredGeneral;
    } finally {
      lifecycleSyncing = false;
    }
  };

  dbApi.deleteControlledArchiveCase = async archiveId => {
    const result = await originals.deleteControlledArchiveCase(archiveId);
    dispatchCaseReloads();
    return result;
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

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-controlled-form]');
    if (form) prepareExternalControlledSubmit(form);
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-general-new], [data-general-open], [data-controlled-new], [data-controlled-open], [data-controlled-row], [data-controlled-card], [data-controlled-clear]')) {
      scheduleUiSync();
    }
  }, true);

  document.addEventListener('input', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.classList.contains('is-pk-locked')) return;
    if (field.dataset.lockedPk != null && field.value !== field.dataset.lockedPk) field.value = field.dataset.lockedPk;
  }, true);

  window.addEventListener('general-cases:updated', event => {
    if (Array.isArray(event.detail)) generalRowsCache = event.detail;
    scheduleUiSync();
  });
  window.addEventListener('controlled-cases:updated', event => {
    controlledRowsCache = Array.isArray(event.detail) ? event.detail : [];
    scheduleUiSync();
  });

  scheduleUiSync();
}
