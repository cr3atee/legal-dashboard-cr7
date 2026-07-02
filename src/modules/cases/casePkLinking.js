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

async function ensureUniquePk({ value, generalId = 0, controlledId = 0 }) {
  const key = normalizePk(value);
  if (!key) throw new Error('Укажите уникальный № ПК');

  const [generalRows, controlledRows] = await Promise.all([
    dbApi.getGeneralCases().catch(() => []),
    dbApi.getControlledCases().catch(() => [])
  ]);

  const duplicateGeneral = findByPk(generalRows, value, pkFromGeneral, generalId);
  const duplicateControlled = findByPk(controlledRows, value, pkFromControlled, controlledId);

  if (duplicateGeneral && Number(duplicateGeneral.id) !== Number(generalId || 0)) {
    throw new Error(`Дело с № ПК ${displayPk(value)} уже существует в общем перечне`);
  }
  if (duplicateControlled && Number(duplicateControlled.id) !== Number(controlledId || 0)) {
    const linkedGeneralId = Number(duplicateControlled.general_case_id || 0);
    if (!generalId || linkedGeneralId !== Number(generalId)) {
      throw new Error(`Дело с № ПК ${displayPk(value)} уже существует в контрольных делах`);
    }
  }

  return { generalRows, controlledRows };
}

async function syncGeneralToControlled(saved, source = {}) {
  const pk = pkFromGeneral(saved) || pkFromGeneral(source);
  if (!normalizePk(pk)) return;
  const controlledRows = await dbApi.getControlledCases().catch(() => []);
  const existing = findByPk(controlledRows, pk, pkFromControlled);
  const payload = generalToControlled(mergeDefined(source, saved));

  if (existing) {
    await originals.updateControlledCase(existing.id, mergeDefined(existing, payload));
  } else {
    await originals.createControlledCase(payload);
  }
}

async function syncControlledToGeneral(saved, source = {}) {
  const pk = pkFromControlled(saved) || pkFromControlled(source);
  if (!normalizePk(pk)) return;
  const generalRows = await dbApi.getGeneralCases().catch(() => []);
  const existing = findByPk(generalRows, pk, pkFromGeneral);
  const payload = controlledToGeneral(mergeDefined(source, saved));

  if (existing) {
    await originals.updateGeneralCase(existing.id, mergeDefined(existing, payload));
  } else {
    await originals.createGeneralCase(payload);
  }
}

async function resolveGeneralCaseId(data = {}) {
  const explicit = Number(data.general_case_id || data.generalCaseId || 0);
  if (explicit) return explicit;
  const pk = data.case_no || data.pk_number || data.case_number || data.control_case_number || '';
  if (!normalizePk(pk)) return null;
  const rows = await dbApi.getGeneralCases().catch(() => []);
  return Number(findByPk(rows, pk, pkFromGeneral)?.id || 0) || null;
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
    await ensureUniquePk({ value: pk });
    const saved = await originals.createGeneralCase({ ...data, case_no: displayPk(pk) });
    syncing = true;
    try {
      await syncGeneralToControlled(saved, data);
    } finally {
      syncing = false;
    }
    window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
    return saved;
  };

  dbApi.updateGeneralCase = async (id, data) => {
    if (syncing) return originals.updateGeneralCase(id, data);
    const pk = pkFromGeneral(data);
    const controlledRows = await dbApi.getControlledCases().catch(() => []);
    const linked = controlledRows.find(row => Number(row.general_case_id || 0) === Number(id))
      || findByPk(controlledRows, pk, pkFromControlled);
    await ensureUniquePk({ value: pk, generalId: id, controlledId: linked?.id || 0 });
    const saved = await originals.updateGeneralCase(id, { ...data, case_no: displayPk(pk) });
    syncing = true;
    try {
      await syncGeneralToControlled(saved, data);
    } finally {
      syncing = false;
    }
    window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
    return saved;
  };

  dbApi.createControlledCase = async data => {
    if (syncing) return originals.createControlledCase(data);
    const pk = pkFromControlled(data);
    await ensureUniquePk({ value: pk });
    syncing = true;
    try {
      const general = await originals.createGeneralCase(controlledToGeneral(data));
      const saved = await originals.createControlledCase({
        ...data,
        case_number: displayPk(pk),
        general_case_id: general.id
      });
      await originals.updateGeneralCase(general.id, mergeDefined(general, {
        controlled_case_id: saved.id,
        control_flag: 1
      }));
      window.dispatchEvent(new CustomEvent('general-cases:reload'));
      return saved;
    } finally {
      syncing = false;
    }
  };

  dbApi.updateControlledCase = async (id, data) => {
    if (syncing) return originals.updateControlledCase(id, data);
    const pk = pkFromControlled(data);
    const generalRows = await dbApi.getGeneralCases().catch(() => []);
    const linkedGeneral = generalRows.find(row => Number(row.controlled_case_id || 0) === Number(id))
      || findByPk(generalRows, pk, pkFromGeneral);
    await ensureUniquePk({ value: pk, controlledId: id, generalId: linkedGeneral?.id || 0 });
    const saved = await originals.updateControlledCase(id, {
      ...data,
      case_number: displayPk(pk),
      general_case_id: linkedGeneral?.id || data.general_case_id || null
    });
    syncing = true;
    try {
      await syncControlledToGeneral(saved, data);
    } finally {
      syncing = false;
    }
    window.dispatchEvent(new CustomEvent('general-cases:reload'));
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
}
