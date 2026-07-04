import { dbApi } from '../../api/dbApi.js';

const META_START = '\u2063\u2063\u200d';
const META_END = '\u200d\u2063\u2063';
const META_ZERO = '\u200b';
const META_ONE = '\u200c';

let initialized = false;
let syncing = false;

export function initCalendarLinkedCaseEditSync() {
  if (initialized) return;
  initialized = true;

  const updateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.updateCalendarTask = async (id, data) => {
    const existing = await getCalendarTask(id);
    const saved = await updateCalendarTask(id, data);

    if (!syncing) {
      syncing = true;
      try {
        await syncLinkedCaseFromCalendar({ id, data, existing, saved });
      } catch (error) {
        console.warn('Не удалось синхронизировать правку календаря со связанным делом:', error);
      } finally {
        syncing = false;
      }
    }

    return saved;
  };
}

async function syncLinkedCaseFromCalendar({ data = {}, existing = {}, saved = {} } = {}) {
  const task = { ...existing, ...saved, ...data };
  const metadata = parseJson(existing.metadata_json || existing.metadata || saved.metadata_json || saved.metadata || data.metadata_json || data.metadata || '{}');
  let generalCaseId = Number(task.general_case_id || metadata.general_case_id || 0) || 0;
  let controlledCaseId = Number(metadata.controlled_case_id || metadata.controlledCaseId || 0) || 0;
  const historyKey = metadata.history_key || metadata.key || '';

  const controlledRows = await dbApi.getControlledCases().catch(() => []);
  if (controlledCaseId && !generalCaseId) {
    const controlled = controlledRows.find(row => Number(row.id || 0) === controlledCaseId);
    generalCaseId = Number(controlled?.general_case_id || 0) || 0;
  }
  if (generalCaseId && !controlledCaseId) {
    const controlled = controlledRows.find(row => Number(row.general_case_id || 0) === generalCaseId);
    controlledCaseId = Number(controlled?.id || 0) || 0;
  }

  if (!generalCaseId && !controlledCaseId) return;

  const calendarPatch = getCalendarPatch(task);
  const general = generalCaseId ? await getGeneralCase(generalCaseId) : null;
  const controlled = controlledCaseId ? controlledRows.find(row => Number(row.id || 0) === controlledCaseId) : null;

  if (general) {
    const nextGeneral = {
      ...general,
      court: calendarPatch.court || general.court || '',
      claim_subject: calendarPatch.subject || general.claim_subject || general.subject || '',
      skip_linked: true
    };
    await dbApi.updateGeneralCase(general.id, nextGeneral).catch(error => {
      console.warn('Не удалось обновить общий перечень из календаря:', error);
    });
  }

  if (controlled) {
    const nextControlled = {
      ...controlled,
      court: calendarPatch.court || controlled.court || '',
      subject: calendarPatch.subject || controlled.subject || ''
    };

    if (historyKey) {
      nextControlled.result = updateControlledHistoryEntry(controlled.result || '', historyKey, {
        date: calendarPatch.ruDate,
        time: calendarPatch.time,
        note: calendarPatch.note
      });
    }

    await dbApi.updateControlledCase(controlled.id, nextControlled).catch(error => {
      console.warn('Не удалось обновить контрольное дело из календаря:', error);
    });
  }

  await syncScheduleFromCalendar({ generalCaseId, controlledCaseId, historyKey, patch: calendarPatch });
  dispatchReloads();
}

function getCalendarPatch(task = {}) {
  const isoDate = task.date || task.date_str || '';
  return {
    isoDate,
    ruDate: isoToRuDate(isoDate),
    time: task.time || task.time_val || '',
    court: task.court || '',
    subject: task.subject || '',
    note: task.note_text || task.description || task.desc || task.assignment || ''
  };
}

async function syncScheduleFromCalendar({ generalCaseId = 0, controlledCaseId = 0, historyKey = '', patch = {} } = {}) {
  const rows = await dbApi.getCourtSchedule().catch(() => []);
  const activeRows = rows.filter(row => Number(row.is_date_row || 0) !== 1);

  let targets = [];
  if (historyKey) {
    targets = activeRows.filter(row => {
      const marker = getHistoryScheduleMarker(row);
      return marker.meta?.key === historyKey
        || (controlledCaseId && Number(marker.meta?.controlledId || 0) === Number(controlledCaseId));
    });
  }

  if (!targets.length && generalCaseId) {
    const byGeneral = activeRows.filter(row => Number(row.general_case_id || 0) === Number(generalCaseId));
    targets = historyKey ? byGeneral.filter(row => getHistoryScheduleMarker(row).meta?.key === historyKey) : (byGeneral.length === 1 ? byGeneral : []);
  }

  for (const row of targets) {
    const marker = getHistoryScheduleMarker(row);
    const nextSubject = patch.subject || marker.visible || cleanMeta(row.result || '');
    const nextDate = patch.ruDate || row.session_date || row.hearing_date || '';
    const nextNote = patch.note || row.category || '';

    await dbApi.updateCourtSchedule(row.id, {
      ...row,
      session_date: nextDate,
      hearing_date: nextDate,
      time: patch.time || row.time || '',
      court: patch.court || row.court || '',
      category: nextNote,
      result: marker.meta ? `${nextSubject}${marker.token}` : nextSubject,
      general_case_id: generalCaseId || row.general_case_id || null
    }).catch(error => {
      console.warn('Не удалось обновить график из календаря:', error);
    });
  }
}

async function getCalendarTask(id) {
  const taskId = Number(id || 0);
  if (!taskId) return null;
  const rows = await dbApi.getCalendarTasks().catch(() => []);
  return (Array.isArray(rows) ? rows : []).find(row => Number(row.id || 0) === taskId) || null;
}

async function getGeneralCase(id) {
  const generalCaseId = Number(id || 0);
  if (!generalCaseId) return null;
  const rows = await dbApi.getGeneralCases().catch(() => []);
  return (Array.isArray(rows) ? rows : []).find(row => Number(row.id || 0) === generalCaseId) || null;
}

function updateControlledHistoryEntry(resultText, key, patch = {}) {
  if (!key) return String(resultText || '');
  const rows = String(resultText || '').split(/\r?\n/);
  let changed = false;

  const next = rows.map(row => {
    const decoded = extractMeta(row);
    if (decoded.meta?.key !== key) return row;
    changed = true;
    const parsed = parseHistoryLine(decoded.visible);
    const visible = buildHistoryLine(
      patch.time ?? parsed.time,
      patch.date ?? parsed.date,
      patch.note ?? parsed.note
    );
    return `${visible}${decoded.token}`;
  });

  return changed ? next.join('\n') : String(resultText || '');
}

function parseHistoryLine(line) {
  const value = String(line || '').trim();
  let date = '';
  let time = '';
  let note = value;
  const dateMatch = value.match(/\b\d{2}\.\d{2}\.\d{4}\b/);
  if (dateMatch) {
    date = dateMatch[0];
    let rest = value.replace(date, '').trim();
    if (/^\d{2}:\d{2}/.test(rest)) {
      time = rest.slice(0, 5);
      rest = rest.slice(5).trim();
    } else if (/^\d{2}:\d{2}/.test(value)) {
      time = value.slice(0, 5);
      rest = rest.replace(time, '').trim();
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

function getHistoryScheduleMarker(row = {}) {
  const fromResult = extractMeta(row.result || '');
  if (fromResult.meta?.source === 'controlled_history_schedule') return fromResult;
  const fromCategory = extractMeta(row.category || '');
  if (fromCategory.meta?.source === 'controlled_history_schedule') return fromCategory;
  return { visible: cleanMeta(row.result || ''), meta: null, token: '' };
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

function cleanMeta(value) {
  return extractMeta(value).visible.trim();
}

function isoToRuDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function parseJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function dispatchReloads() {
  window.dispatchEvent(new CustomEvent('general-cases:reload'));
  window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
  window.dispatchEvent(new CustomEvent('schedule:reload'));
  window.dispatchEvent(new CustomEvent('calendar:reload'));
}
