import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let syncing = false;

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

function pkFromGeneral(row = {}) {
  return row.case_no || row.pk_number || row.case_number || '';
}

function pkFromControlled(row = {}) {
  return row.case_number || row.case_no || row.pk_number || '';
}

function findByPk(rows, value, getter, excludeId = 0) {
  const key = normalizePk(value);
  if (!key) return null;
  return (Array.isArray(rows) ? rows : []).find(row =>
    normalizePk(getter(row)) === key && Number(row.id || 0) !== Number(excludeId || 0)
  ) || null;
}

function findById(rows, id) {
  return (Array.isArray(rows) ? rows : []).find(row => Number(row.id || 0) === Number(id || 0)) || null;
}

async function inspectPk(value) {
  const key = normalizePk(value);
  if (!key) throw new Error('Укажите уникальный № ПК');
  const [generalRows, controlledRows] = await Promise.all([
    dbApi.getGeneralCases().catch(() => []),
    dbApi.getControlledCases().catch(() => [])
  ]);
  return { generalRows, controlledRows };
}

function assertPkUnchanged(currentValue, nextValue) {
  if (normalizePk(currentValue) !== normalizePk(nextValue)) {
    throw new Error('№ ПК является уникальным идентификатором дела и не может быть изменён после создания');
  }
}

function generalToControlled(row = {}) {
  return {
    general_case_id: Number(row.id || row.general_case_id || 0) || null,
    case_number: displayPk(pkFromGeneral(row)),
    plaintiff: row.plaintiff || '',
    defendant: row.defendant || '',
    subject: row.claim_subject || row.subject || '',
    representative: row.executor || row.representative || '',
    court_case_number: row.court_no || row.court_case_number || '',
    court: row.court || ''
  };
}

function controlledToGeneral(row = {}) {
  return {
    controlled_case_id: Number(row.id || row.controlled_case_id || 0) || null,
    case_no: displayPk(pkFromControlled(row)),
    plaintiff: row.plaintiff || '',
    defendant: row.defendant || '',
    claim_subject: row.subject || row.claim_subject || '',
    executor: row.representative || row.executor || '',
    court_no: row.court_case_number || row.court_no || '',
    court: row.court || '',
    control_flag: 1
  };
}

function mergeDefined(base = {}, patch = {}) {
  const result = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined && value !== null) result[key] = value;
  });
  return result;
}

async function syncGeneralToControlled(saved, source = {}) {
  const pk = pkFromGeneral(saved) || pkFromGeneral(source);
  if (!normalizePk(pk)) return null;
  const controlledRows = await dbApi.getControlledCases().catch(() => []);
  const existing = controlledRows.find(row => Number(row.general_case_id || 0) === Number(saved.id || 0))
    || findByPk(controlledRows, pk, pkFromControlled);
  const payload = generalToControlled(mergeDefined(source, saved));

  if (existing) {
    return originals.updateControlledCase(existing.id, mergeDefined(existing, payload));
  }
  return originals.createControlledCase(payload);
}

async function syncControlledToGeneral(saved, source = {}) {
  const pk = pkFromControlled(saved) || pkFromControlled(source);
  if (!normalizePk(pk)) return null;
  const generalRows = await dbApi.getGeneralCases().catch(() => []);
  const existing = generalRows.find(row => Number(row.controlled_case_id || 0) === Number(saved.id || 0))
    || findByPk(generalRows, pk, pkFromGeneral);
  const payload = controlledToGeneral(mergeDefined(source, saved));

  if (existing) {
    return originals.updateGeneralCase(existing.id, mergeDefined(existing, payload));
  }
  return originals.createGeneralCase(payload);
}

async function resolveGeneralCaseId(data = {}) {
  const explicit = Number(data.general_case_id || data.generalCaseId || 0);
  if (explicit) return explicit;
  const pk = data.case_no || data.pk_number || data.case_number || data.control_case_number || '';
  if (!normalizePk(pk)) return null;
  const rows = await dbApi.getGeneralCases().catch(() => []);
  return Number(findByPk(rows, pk, pkFromGeneral)?.id || 0) || null;
}

function lockPkField(form, field) {
  if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)) return;
  const id = String(form.elements?.id?.value || '').trim();
  const editing = Boolean(id);

  if (editing) {
    field.readOnly = true;
    field.classList.add('is-pk-locked');
    field.title = '№ ПК нельзя изменить после создания дела';
    field.setAttribute('aria-readonly', 'true');
    field.dataset.lockedPk = field.value;
  } else {
    field.readOnly = false;
    field.classList.remove('is-pk-locked');
    field.removeAttribute('title');
    field.setAttribute('aria-readonly', 'false');
    delete field.dataset.lockedPk;
  }
}

function syncPkFieldLocks() {
  const generalForm = document.querySelector('[data-general-form]');
  const generalPk = generalForm?.querySelector('input[name="case_no"], input[name="pk_number"], input[name="case_number"]');
  lockPkField(generalForm, generalPk);

  const controlledForm = document.querySelector('[data-controlled-form]');
  const controlledPk = controlledForm?.querySelector('input[name="case_number"], input[name="case_no"], input[name="pk_number"]');
  lockPkField(controlledForm, controlledPk);
}

function schedulePkFieldLocks() {
  setTimeout(syncPkFieldLocks, 0);
  setTimeout(syncPkFieldLocks, 60);
  setTimeout(syncPkFieldLocks, 180);
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
    if (syncing) return originals.createGeneralCase(data);
    const pk = pkFromGeneral(data);
    const { generalRows } = await inspectPk(pk);
    const duplicateGeneral = findByPk(generalRows, pk, pkFromGeneral);
    if (duplicateGeneral) {
      throw new Error(`Дело с № ПК ${displayPk(pk)} уже существует в общем перечне`);
    }

    const saved = await originals.createGeneralCase({ ...data, case_no: displayPk(pk) });
    syncing = true;
    try {
      await syncGeneralToControlled(saved, data);
    } finally {
      syncing = false;
    }
    window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
    schedulePkFieldLocks();
    return saved;
  };

  dbApi.updateGeneralCase = async (id, data) => {
    if (syncing) return originals.updateGeneralCase(id, data);
    const { generalRows } = await inspectPk(pkFromGeneral(data));
    const current = findById(generalRows, id);
    const originalPk = pkFromGeneral(current) || pkFromGeneral(data);
    assertPkUnchanged(originalPk, pkFromGeneral(data));

    const duplicateGeneral = findByPk(generalRows, originalPk, pkFromGeneral, id);
    if (duplicateGeneral) {
      throw new Error(`Другое дело с № ПК ${displayPk(originalPk)} уже существует в общем перечне`);
    }

    const saved = await originals.updateGeneralCase(id, { ...data, case_no: displayPk(originalPk) });
    syncing = true;
    try {
      await syncGeneralToControlled(saved, data);
    } finally {
      syncing = false;
    }
    window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
    schedulePkFieldLocks();
    return saved;
  };

  dbApi.createControlledCase = async data => {
    if (syncing) return originals.createControlledCase(data);
    const pk = pkFromControlled(data);
    const { generalRows, controlledRows } = await inspectPk(pk);
    const duplicateControlled = findByPk(controlledRows, pk, pkFromControlled);
    if (duplicateControlled) {
      throw new Error(`Дело с № ПК ${displayPk(pk)} уже существует в контрольных делах`);
    }

    syncing = true;
    try {
      let general = findByPk(generalRows, pk, pkFromGeneral);
      if (general) {
        general = await originals.updateGeneralCase(general.id, mergeDefined(general, controlledToGeneral(data)));
      } else {
        general = await originals.createGeneralCase(controlledToGeneral(data));
      }

      const saved = await originals.createControlledCase({
        ...data,
        case_number: displayPk(pk),
        general_case_id: general.id
      });

      await originals.updateGeneralCase(general.id, mergeDefined(general, {
        ...controlledToGeneral(saved),
        controlled_case_id: saved.id,
        control_flag: 1
      }));

      window.dispatchEvent(new CustomEvent('general-cases:reload'));
      schedulePkFieldLocks();
      return saved;
    } finally {
      syncing = false;
    }
  };

  dbApi.updateControlledCase = async (id, data) => {
    if (syncing) return originals.updateControlledCase(id, data);
    const { controlledRows } = await inspectPk(pkFromControlled(data));
    const current = findById(controlledRows, id);
    const originalPk = pkFromControlled(current) || pkFromControlled(data);
    assertPkUnchanged(originalPk, pkFromControlled(data));

    const duplicateControlled = findByPk(controlledRows, originalPk, pkFromControlled, id);
    if (duplicateControlled) {
      throw new Error(`Другое дело с № ПК ${displayPk(originalPk)} уже существует в контрольных делах`);
    }

    const saved = await originals.updateControlledCase(id, {
      ...data,
      case_number: displayPk(originalPk),
      general_case_id: current?.general_case_id || data.general_case_id || null
    });

    syncing = true;
    try {
      await syncControlledToGeneral(saved, data);
    } finally {
      syncing = false;
    }
    window.dispatchEvent(new CustomEvent('general-cases:reload'));
    schedulePkFieldLocks();
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
      schedulePkFieldLocks();
    }
  }, true);

  document.addEventListener('input', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.classList.contains('is-pk-locked')) return;
    if (field.dataset.lockedPk != null && field.value !== field.dataset.lockedPk) {
      field.value = field.dataset.lockedPk;
    }
  }, true);

  window.addEventListener('general-cases:updated', schedulePkFieldLocks);
  window.addEventListener('controlled-cases:updated', schedulePkFieldLocks);
  schedulePkFieldLocks();
}
