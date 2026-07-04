import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let internalDelete = false;
const original = {};

export function initLinkedCaseDeletionSync() {
  if (initialized) return;
  initialized = true;

  original.archiveGeneralCase = dbApi.archiveGeneralCase.bind(dbApi);
  original.archiveControlledCase = dbApi.archiveControlledCase.bind(dbApi);
  original.deleteCourtSchedule = dbApi.deleteCourtSchedule.bind(dbApi);
  original.deleteCalendarTask = dbApi.deleteCalendarTask.bind(dbApi);

  dbApi.archiveGeneralCase = async id => {
    if (internalDelete) return original.archiveGeneralCase(id);
    return deleteLinkedCaseEverywhere({ generalCaseId: Number(id || 0), origin: 'general' });
  };

  dbApi.archiveControlledCase = async id => {
    if (internalDelete) return original.archiveControlledCase(id);
    return deleteLinkedCaseEverywhere({ controlledCaseId: Number(id || 0), origin: 'controlled' });
  };

  dbApi.deleteCourtSchedule = async id => {
    if (internalDelete) return original.deleteCourtSchedule(id);
    const context = await resolveFromSchedule(Number(id || 0));
    if (!context.generalCaseId && !context.controlledCaseId) return original.deleteCourtSchedule(id);
    return deleteLinkedCaseEverywhere({ ...context, scheduleId: Number(id || 0), origin: 'schedule' });
  };

  dbApi.deleteCalendarTask = async id => {
    if (internalDelete) return original.deleteCalendarTask(id);
    const context = await resolveFromCalendar(Number(id || 0));
    if (!context.generalCaseId && !context.controlledCaseId) return original.deleteCalendarTask(id);
    return deleteLinkedCaseEverywhere({ ...context, calendarTaskId: Number(id || 0), origin: 'calendar' });
  };
}

async function deleteLinkedCaseEverywhere(context = {}) {
  if (internalDelete) return null;
  internalDelete = true;

  try {
    const resolved = await resolveLinkedCase(context);
    const generalCaseId = Number(resolved.generalCaseId || 0);
    const controlledCaseId = Number(resolved.controlledCaseId || 0);

    if (!generalCaseId && !controlledCaseId) {
      if (resolved.scheduleId) return await original.deleteCourtSchedule(resolved.scheduleId);
      if (resolved.calendarTaskId) return await original.deleteCalendarTask(resolved.calendarTaskId);
      return null;
    }

    await deleteLinkedCalendarTasks({ generalCaseId, controlledCaseId });
    await deleteLinkedScheduleRows({ generalCaseId, controlledCaseId });

    let generalResult = null;
    if (generalCaseId) {
      generalResult = await original.archiveGeneralCase(generalCaseId).catch(error => {
        if (!isAlreadyDeletedError(error)) throw error;
        return null;
      });
    }

    if (controlledCaseId) {
      await original.archiveControlledCase(controlledCaseId).catch(error => {
        if (!isAlreadyDeletedError(error)) throw error;
      });
    }

    dispatchDeletionReloads();
    return generalResult || { ok: true, general_case_id: generalCaseId || null, controlled_case_id: controlledCaseId || null };
  } finally {
    internalDelete = false;
  }
}

async function resolveLinkedCase(context = {}) {
  let generalCaseId = Number(context.generalCaseId || context.general_case_id || 0) || 0;
  let controlledCaseId = Number(context.controlledCaseId || context.controlled_case_id || 0) || 0;

  const controlledRows = await dbApi.getControlledCases().catch(() => []);

  if (controlledCaseId && !generalCaseId) {
    const controlled = controlledRows.find(row => Number(row.id || 0) === controlledCaseId);
    generalCaseId = Number(controlled?.general_case_id || 0) || 0;
  }

  if (generalCaseId && !controlledCaseId) {
    const controlled = controlledRows.find(row => Number(row.general_case_id || 0) === generalCaseId);
    controlledCaseId = Number(controlled?.id || 0) || 0;
  }

  return {
    ...context,
    generalCaseId,
    controlledCaseId
  };
}

async function resolveFromSchedule(scheduleId) {
  if (!scheduleId) return {};
  const rows = await dbApi.getCourtSchedule().catch(() => []);
  const row = rows.find(item => Number(item.id || 0) === Number(scheduleId));
  if (!row || Number(row.is_date_row || 0) === 1) return {};

  const marker = getHistoryScheduleMarker(row);
  return {
    scheduleId,
    generalCaseId: Number(row.general_case_id || 0) || 0,
    controlledCaseId: Number(marker?.controlledId || 0) || 0
  };
}

async function resolveFromCalendar(calendarTaskId) {
  if (!calendarTaskId) return {};
  const rows = await dbApi.getCalendarTasks().catch(() => []);
  const task = rows.find(item => Number(item.id || 0) === Number(calendarTaskId));
  if (!task) return {};

  const metadata = parseJson(task.metadata_json || task.metadata || '{}');
  return {
    calendarTaskId,
    generalCaseId: Number(task.general_case_id || metadata.general_case_id || 0) || 0,
    controlledCaseId: Number(metadata.controlled_case_id || 0) || 0
  };
}

async function deleteLinkedScheduleRows({ generalCaseId = 0, controlledCaseId = 0 } = {}) {
  const rows = await dbApi.getCourtSchedule().catch(() => []);
  const targets = rows.filter(row => {
    if (Number(row.is_date_row || 0) === 1) return false;
    if (generalCaseId && Number(row.general_case_id || 0) === Number(generalCaseId)) return true;
    const marker = getHistoryScheduleMarker(row);
    return Boolean(controlledCaseId && Number(marker?.controlledId || 0) === Number(controlledCaseId));
  });

  for (const row of targets) {
    await original.deleteCourtSchedule(row.id).catch(error => {
      if (!isAlreadyDeletedError(error)) console.warn('Не удалось удалить строку графика связанного дела:', error);
    });
  }
}

async function deleteLinkedCalendarTasks({ generalCaseId = 0, controlledCaseId = 0 } = {}) {
  const rows = await dbApi.getCalendarTasks().catch(() => []);
  const targets = rows.filter(task => {
    if (generalCaseId && Number(task.general_case_id || 0) === Number(generalCaseId)) return true;
    const metadata = parseJson(task.metadata_json || task.metadata || '{}');
    return Boolean(controlledCaseId && Number(metadata.controlled_case_id || 0) === Number(controlledCaseId));
  });

  for (const task of targets) {
    await original.deleteCalendarTask(task.id).catch(error => {
      if (!isAlreadyDeletedError(error)) console.warn('Не удалось удалить событие календаря связанного дела:', error);
    });
  }
}

function getHistoryScheduleMarker(row = {}) {
  const fromResult = extractHiddenMeta(row.result || '');
  if (fromResult?.source === 'controlled_history_schedule') return fromResult;
  const fromCategory = extractHiddenMeta(row.category || '');
  if (fromCategory?.source === 'controlled_history_schedule') return fromCategory;
  return null;
}

function extractHiddenMeta(value) {
  const text = String(value || '');
  const startToken = '\u2063\u2063\u200d';
  const endToken = '\u200d\u2063\u2063';
  const zero = '\u200b';
  const one = '\u200c';
  const start = text.indexOf(startToken);
  if (start < 0) return null;
  const end = text.indexOf(endToken, start + startToken.length);
  if (end < 0) return null;

  const encoded = text.slice(start + startToken.length, end);
  try {
    const binary = encoded.replaceAll(zero, '0').replaceAll(one, '1');
    const bytes = [];
    for (let index = 0; index + 7 < binary.length; index += 8) {
      bytes.push(parseInt(binary.slice(index, index + 8), 2));
    }
    const decoded = new TextDecoder().decode(new Uint8Array(bytes));
    const meta = JSON.parse(decoded);
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

function parseJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isAlreadyDeletedError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('not found')
    || message.includes('404')
    || message.includes('не найден')
    || message.includes('not_found')
    || message.includes('record_not_found');
}

function dispatchDeletionReloads() {
  window.dispatchEvent(new CustomEvent('general-cases:reload'));
  window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
  window.dispatchEvent(new CustomEvent('schedule:reload'));
  window.dispatchEvent(new CustomEvent('calendar:reload'));
  window.dispatchEvent(new CustomEvent('reports:reload'));
}
