import { dbApi } from '../../api/dbApi.js';

const META_START = '\u2063\u2063\u200d';
const META_END = '\u200d\u2063\u2063';
const META_ZERO = '\u200b';
const META_ONE = '\u200c';
const EXTERNAL_CASE_LABEL = 'Без № ПК';

let initialized = false;
let internalSync = false;
const original = {};

export function initLinkedCaseMultiSourceSync() {
  if (initialized) return;
  initialized = true;

  original.updateGeneralCase = dbApi.updateGeneralCase.bind(dbApi);
  original.updateControlledCase = dbApi.updateControlledCase.bind(dbApi);
  original.createCourtScheduleCase = dbApi.createCourtScheduleCase.bind(dbApi);
  original.updateCourtSchedule = dbApi.updateCourtSchedule.bind(dbApi);
  original.updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.updateGeneralCase = async (id, data) => {
    if (internalSync) return original.updateGeneralCase(id, data);

    internalSync = true;
    try {
      const saved = await original.updateGeneralCase(id, data);
      await syncDerivedRowsFromGeneral(saved);
      dispatchReloads();
      return saved;
    } finally {
      internalSync = false;
    }
  };

  dbApi.updateControlledCase = async (id, data) => {
    if (internalSync) return original.updateControlledCase(id, data);

    internalSync = true;
    try {
      const saved = await original.updateControlledCase(id, data);
      const general = await getGeneralCase(saved?.general_case_id || data?.general_case_id);
      if (general) await syncDerivedRowsFromGeneral(general);
      dispatchReloads();
      return saved;
    } finally {
      internalSync = false;
    }
  };

  dbApi.createCourtScheduleCase = async data => {
    const context = await getScheduleContext(data);
    const normalized = normalizeHistorySchedulePayload(data, context);
    const saved = await original.createCourtScheduleCase(normalized);

    if (!internalSync && Number(saved?.general_case_id || normalized.general_case_id || 0)) {
      internalSync = true;
      try {
        await syncCaseBackFromSchedule(saved, context);
        dispatchReloads();
      } finally {
        internalSync = false;
      }
    }

    return saved;
  };

  dbApi.updateCourtSchedule = async (id, data) => {
    const existing = await getScheduleRow(id);
    const context = await getScheduleContext({ ...existing, ...data });
    const normalized = normalizeHistorySchedulePayload({ ...existing, ...data }, context);
    const saved = await original.updateCourtSchedule(id, normalized);

    if (!internalSync && Number(saved?.general_case_id || normalized.general_case_id || 0)) {
      internalSync = true;
      try {
        await syncCaseBackFromSchedule(saved, context);
        dispatchReloads();
      } finally {
        internalSync = false;
      }
    }

    return saved;
  };

  setTimeout(repairExistingLinkedRows, 1000);
}

async function syncDerivedRowsFromGeneral(general = {}) {
  const generalCaseId = Number(general.id || 0);
  if (!generalCaseId) return;

  const controlledRows = await dbApi.getControlledCases().catch(() => []);
  const controlled = controlledRows.find(row => Number(row.general_case_id || 0) === generalCaseId) || null;
  const shared = sharedCaseData(general, controlled);

  await syncScheduleRows(generalCaseId, shared, controlled);
  await syncCalendarRows(generalCaseId, shared, controlled);
}

async function syncScheduleRows(generalCaseId, shared, controlled) {
  const rows = await dbApi.getCourtSchedule().catch(() => []);
  const linked = rows.filter(row =>
    Number(row.general_case_id || 0) === Number(generalCaseId)
    && Number(row.is_date_row || 0) !== 1
  );

  for (const row of linked) {
    const marker = getHistoryScheduleMarker(row);
    const history = marker.meta ? findControlledHistoryEntry(controlled?.result, marker.meta.key) : null;
    const note = history?.note ?? row.category ?? '';
    const subject = shared.subject || marker.visible || cleanMeta(row.result || '');

    await original.updateCourtSchedule(row.id, {
      ...row,
      court: shared.court,
      representative: shared.representative,
      plaintiff: shared.plaintiff,
      defendant: shared.defendant,
      category: marker.meta ? note : row.category,
      result: marker.meta ? `${subject}${marker.token}` : subject,
      general_case_id: generalCaseId
    }).catch(error => console.warn('Не удалось обновить связанную запись графика:', error));
  }
}

async function syncCalendarRows(generalCaseId, shared, controlled) {
  const rows = await dbApi.getCalendarTasks({ generalCaseId }).catch(() => []);
  for (const row of rows) {
    const metadata = parseJson(row.metadata_json || row.metadata || '{}');
    if (metadata.source !== 'controlled_history') continue;

    const history = findControlledHistoryEntry(controlled?.result, metadata.history_key);
    const note = history?.note || row.note_text || row.description || row.desc || '';
    const assignment = buildCalendarAssignment(shared, note);

    await original.updateCalendarTask(row.id, {
      ...row,
      date: row.date_str || row.date || '',
      time: row.time_val || row.time || '',
      type: row.task_type || row.type || (metadata.history_type === 'hearing' ? 'судебное_заседание' : 'поручение'),
      desc: row.description || row.desc || note,
      court: shared.court,
      subject: shared.subject,
      assignment,
      note_text: note,
      metadata_json: row.metadata_json || JSON.stringify(metadata),
      general_case_id: generalCaseId
    }).catch(error => console.warn('Не удалось обновить связанное событие календаря:', error));
  }
}

async function syncCaseBackFromSchedule(schedule = {}, initialContext = {}) {
  const generalCaseId = Number(schedule.general_case_id || initialContext.general?.id || 0);
  if (!generalCaseId) return;

  const context = await getScheduleContext(schedule);
  const marker = getHistoryScheduleMarker(schedule);
  const subject = marker.meta ? marker.visible : cleanMeta(schedule.result || '');
  const sharedPatch = {
    court: schedule.court || '',
    representative: schedule.representative || '',
    plaintiff: schedule.plaintiff || '',
    defendant: schedule.defendant || '',
    subject
  };

  let controlled = context.controlled;
  if (controlled) {
    let result = controlled.result || '';
    if (marker.meta?.key) {
      result = updateControlledHistoryEntry(result, marker.meta.key, {
        date: schedule.session_date || '',
        time: schedule.time || '',
        note: schedule.category || '',
        scheduleId: Number(schedule.id || 0) || null
      });
    }

    controlled = await original.updateControlledCase(controlled.id, {
      ...controlled,
      court: sharedPatch.court,
      representative: sharedPatch.representative,
      plaintiff: sharedPatch.plaintiff,
      defendant: sharedPatch.defendant,
      subject: sharedPatch.subject,
      result,
      general_case_id: generalCaseId
    });
  } else if (context.general) {
    await original.updateGeneralCase(generalCaseId, {
      ...context.general,
      court: sharedPatch.court,
      executor: sharedPatch.representative,
      plaintiff: sharedPatch.plaintiff,
      defendant: sharedPatch.defendant,
      claim_subject: sharedPatch.subject,
      case_no: context.general.case_no
    });
  }

  const refreshedGeneral = await getGeneralCase(generalCaseId);
  if (refreshedGeneral) await syncDerivedRowsFromGeneral(refreshedGeneral);
}

function normalizeHistorySchedulePayload(data = {}, context = {}) {
  const resultMarker = extractMeta(data.result || '');
  const categoryMarker = extractMeta(data.category || '');
  const marker = isHistoryScheduleMeta(resultMarker.meta)
    ? resultMarker
    : (isHistoryScheduleMeta(categoryMarker.meta) ? categoryMarker : null);

  if (!marker) return data;

  const subject = String(context.controlled?.subject || context.general?.claim_subject || '').trim();
  const history = findControlledHistoryEntry(context.controlled?.result, marker.meta.key);
  const resultVisible = resultMarker.visible.trim();
  const categoryVisible = categoryMarker.visible.trim();

  let note = history?.note || '';
  let resolvedSubject = subject;

  if (isSameText(resultVisible, subject)) {
    note = categoryVisible || note;
    resolvedSubject = resultVisible || subject;
  } else if (isSameText(categoryVisible, subject)) {
    note = resultVisible || note;
    resolvedSubject = categoryVisible || subject;
  } else if (marker === categoryMarker) {
    note = categoryVisible || note;
    resolvedSubject = resultVisible || subject;
  } else {
    note = resultVisible || note;
    resolvedSubject = subject || categoryVisible;
  }

  return {
    ...data,
    category: note,
    result: `${resolvedSubject}${marker.token}`,
    general_case_id: Number(data.general_case_id || context.general?.id || context.controlled?.general_case_id || 0) || null
  };
}

async function getScheduleContext(data = {}) {
  const generalCaseId = Number(data.general_case_id || 0);
  const controlledRows = await dbApi.getControlledCases().catch(() => []);
  const marker = getHistoryScheduleMarker(data);
  const controlled = marker.meta?.controlledId
    ? controlledRows.find(row => Number(row.id || 0) === Number(marker.meta.controlledId))
    : controlledRows.find(row => Number(row.general_case_id || 0) === generalCaseId);
  const general = await getGeneralCase(generalCaseId || controlled?.general_case_id);
  return { general, controlled };
}

async function getGeneralCase(id) {
  const generalCaseId = Number(id || 0);
  if (!generalCaseId) return null;
  const rows = await dbApi.getGeneralCases().catch(() => []);
  return rows.find(row => Number(row.id || 0) === generalCaseId) || null;
}

async function getScheduleRow(id) {
  const rows = await dbApi.getCourtSchedule().catch(() => []);
  return rows.find(row => Number(row.id || 0) === Number(id || 0)) || null;
}

function sharedCaseData(general = {}, controlled = {}) {
  return {
    caseNumber: isExternalCaseNumber(general.case_no) ? '' : (general.case_no || controlled.case_number || ''),
    courtCaseNumber: general.court_no || controlled.court_case_number || '',
    court: general.court || controlled.court || '',
    representative: general.executor || controlled.representative || '',
    plaintiff: general.plaintiff || controlled.plaintiff || '',
    defendant: general.defendant || controlled.defendant || '',
    subject: general.claim_subject || controlled.subject || ''
  };
}

function buildCalendarAssignment(shared, note = '') {
  return [
    shared.caseNumber ? `№ ПК: ${shared.caseNumber}` : '№ ПК: Без № ПК',
    shared.courtCaseNumber ? `№ дела в суде: ${shared.courtCaseNumber}` : '',
    shared.plaintiff ? `Истец: ${shared.plaintiff}` : '',
    shared.defendant ? `Ответчик: ${shared.defendant}` : '',
    shared.representative ? `Представитель: ${shared.representative}` : '',
    note ? `Запись: ${note}` : ''
  ].filter(Boolean).join('\n');
}

function getHistoryScheduleMarker(row = {}) {
  const fromResult = extractMeta(row.result || '');
  if (isHistoryScheduleMeta(fromResult.meta)) return fromResult;
  const fromCategory = extractMeta(row.category || '');
  if (isHistoryScheduleMeta(fromCategory.meta)) return fromCategory;
  return { visible: cleanMeta(row.result || ''), meta: null, token: '' };
}

function isHistoryScheduleMeta(meta) {
  return meta?.source === 'controlled_history_schedule' && Boolean(meta?.key);
}

function findControlledHistoryEntry(resultText, key) {
  if (!key) return null;
  const rows = parseControlledHistory(resultText);
  return rows.find(row => row.meta?.key === key) || null;
}

function updateControlledHistoryEntry(resultText, key, patch = {}) {
  const rows = parseControlledHistory(resultText);
  let changed = false;

  const next = rows.map(row => {
    if (row.meta?.key !== key) return row.raw;
    changed = true;
    const meta = {
      ...row.meta,
      scheduleId: patch.scheduleId || row.meta.scheduleId || null
    };
    const visible = buildHistoryLine(
      patch.time ?? row.time,
      patch.date ?? row.date,
      patch.note ?? row.note
    );
    return `${visible}${encodeMeta(meta)}`;
  });

  return changed ? next.join('\n') : String(resultText || '');
}

function parseControlledHistory(resultText) {
  return String(resultText || '')
    .split(/\r?\n/)
    .map(raw => {
      const decoded = extractMeta(raw);
      const parsed = parseHistoryLine(decoded.visible);
      return { raw, ...decoded, ...parsed };
    });
}

function parseHistoryLine(line) {
  const value = String(line || '').trim();
  let date = '';
  let time = '';
  let note = value;

  if (/^\d{2}:\d{2}/.test(value)) {
    time = value.slice(0, 5);
    let rest = value.slice(5).trim();
    if (/^\d{2}\.\d{2}\./.test(rest)) {
      date = rest.slice(0, 10);
      rest = rest.slice(10).trim();
    }
    note = rest.replace(/^[-–—/]\s*/, '');
  } else if (/^\d{2}\.\d{2}\./.test(value)) {
    date = value.slice(0, 10);
    let rest = value.slice(10).trim();
    if (/^\d{2}:\d{2}/.test(rest)) {
      time = rest.slice(0, 5);
      rest = rest.slice(5).trim();
    }
    note = rest.replace(/^[-–—/]\s*/, '');
  }

  return { date, time, note };
}

function buildHistoryLine(time, date, note) {
  const left = [time, date].map(value => String(value || '').trim()).filter(Boolean).join(' ');
  const text = String(note || '').trim();
  if (left && text) return `${left} - ${text}`;
  return left || text;
}

function extractMeta(value) {
  const text = String(value || '');
  const start = text.indexOf(META_START);
  if (start < 0) return { visible: text, meta: null, token: '' };
  const end = text.indexOf(META_END, start + META_START.length);
  if (end < 0) return { visible: text, meta: null, token: '' };

  const token = text.slice(start, end + META_END.length);
  const encoded = text.slice(start + META_START.length, end);
  const visible = `${text.slice(0, start)}${text.slice(end + META_END.length)}`;

  try {
    const binary = encoded.replaceAll(META_ZERO, '0').replaceAll(META_ONE, '1');
    const bytes = [];
    for (let index = 0; index + 7 < binary.length; index += 8) {
      bytes.push(parseInt(binary.slice(index, index + 8), 2));
    }
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    return { visible, meta, token };
  } catch {
    return { visible, meta: null, token };
  }
}

function encodeMeta(meta) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(meta));
    let bits = '';
    bytes.forEach(byte => {
      bits += byte.toString(2).padStart(8, '0').replaceAll('0', META_ZERO).replaceAll('1', META_ONE);
    });
    return `${META_START}${bits}${META_END}`;
  } catch {
    return '';
  }
}

function cleanMeta(value) {
  return extractMeta(value).visible.trim();
}

function parseJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isExternalCaseNumber(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU') === EXTERNAL_CASE_LABEL.toLocaleLowerCase('ru-RU');
}

function isSameText(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function dispatchReloads() {
  window.dispatchEvent(new CustomEvent('general-cases:reload'));
  window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
  window.dispatchEvent(new CustomEvent('schedule:reload'));
  window.dispatchEvent(new CustomEvent('calendar:reload'));
}

async function repairExistingLinkedRows() {
  if (internalSync) return;
  internalSync = true;
  try {
    const generalRows = await dbApi.getGeneralCases().catch(() => []);
    for (const general of generalRows) {
      const controlledRows = await dbApi.getControlledCases().catch(() => []);
      const controlled = controlledRows.find(row => Number(row.general_case_id || 0) === Number(general.id));
      if (!controlled) continue;
      await syncDerivedRowsFromGeneral(general);
    }
    dispatchReloads();
  } catch (error) {
    console.warn('Не удалось проверить существующие связи дел:', error);
  } finally {
    internalSync = false;
  }
}
