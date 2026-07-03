import { dbApi } from '../../api/dbApi.js';
import { getCurrentUserName } from '../../auth/session.js';
import { showNotification } from '../../layout/notifications.js';

const START = '\u2063\u2063\u200d';
const END = '\u200d\u2063\u2063';
const ZERO = '\u200b';
const ONE = '\u200c';
const TYPES = new Set(['result', 'hearing', 'control_date']);

let initialized = false;
let observer = null;
let originalCreateControlledCase = null;
let originalUpdateControlledCase = null;

export function initControlledHistorySync() {
  if (initialized) return;
  initialized = true;

  originalCreateControlledCase = dbApi.createControlledCase.bind(dbApi);
  originalUpdateControlledCase = dbApi.updateControlledCase.bind(dbApi);

  dbApi.createControlledCase = data => saveControlledWithHistory(null, data, originalCreateControlledCase);
  dbApi.updateControlledCase = (id, data) => saveControlledWithHistory(Number(id), data, payload => originalUpdateControlledCase(id, payload));

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-controlled-form]');
    if (!form) return;
    prepareHistoryMarkers(form);
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-controlled-new], [data-controlled-open], [data-controlled-row], [data-controlled-card], [data-history-add], [data-history-remove]')) {
      scheduleEnhance();
    }
  }, true);

  observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleEnhance();
}

function scheduleEnhance() {
  clearTimeout(window.__controlledHistorySyncUiTimer);
  window.__controlledHistorySyncUiTimer = setTimeout(enhanceHistoryUi, 20);
}

function enhanceHistoryUi() {
  const header = document.querySelector('.controlled-history-header');
  if (header && !header.querySelector('[data-history-type-header]')) {
    const label = document.createElement('span');
    label.dataset.historyTypeHeader = '1';
    label.textContent = 'Тип записи';
    header.insertBefore(label, header.children[1] || null);
  }

  document.querySelectorAll('.controlled-history-row[data-history-id]').forEach(row => {
    const note = row.querySelector('[data-history-note]');
    if (!(note instanceof HTMLInputElement)) return;

    const decoded = extractMeta(note.value);
    if (decoded.meta) {
      note.value = decoded.visible;
      note.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (!row.dataset.historySyncKey) {
      row.dataset.historySyncKey = decoded.meta?.key || row.dataset.historyId || randomKey();
    }
    row.dataset.historySyncType = normalizeType(decoded.meta?.type || row.dataset.historySyncType || 'result');
    row.dataset.historyScheduleId = String(decoded.meta?.scheduleId || row.dataset.historyScheduleId || '');
    row.dataset.historyCalendarId = String(decoded.meta?.calendarId || row.dataset.historyCalendarId || '');

    let select = row.querySelector('[data-history-type]');
    if (!select) {
      select = document.createElement('select');
      select.dataset.historyType = '1';
      select.setAttribute('aria-label', 'Тип записи истории');
      select.innerHTML = `
        <option value="result">Результат</option>
        <option value="hearing">Судебное заседание</option>
        <option value="control_date">Контрольная дата</option>
      `;
      row.insertBefore(select, note);
      select.addEventListener('change', () => {
        row.dataset.historySyncType = normalizeType(select.value);
        row.classList.toggle('is-synced-history', select.value !== 'result');
      });
    }

    select.value = row.dataset.historySyncType;
    row.classList.toggle('is-synced-history', select.value !== 'result');
  });
}

function prepareHistoryMarkers(form) {
  enhanceHistoryUi();
  const touched = [];

  form.querySelectorAll('.controlled-history-row[data-history-id]').forEach(row => {
    const note = row.querySelector('[data-history-note]');
    if (!(note instanceof HTMLInputElement)) return;

    const visibleNote = extractMeta(note.value).visible;
    const date = String(row.querySelector('[data-history-date]')?.value || '').trim();
    const time = String(row.querySelector('[data-history-time]')?.value || '').trim();
    const type = normalizeType(row.querySelector('[data-history-type]')?.value || row.dataset.historySyncType);

    if (!visibleNote.trim() && !date && !time && type === 'result') return;

    const meta = {
      v: 1,
      source: 'controlled_history',
      key: row.dataset.historySyncKey || row.dataset.historyId || randomKey(),
      type,
      scheduleId: Number(row.dataset.historyScheduleId || 0) || null,
      calendarId: Number(row.dataset.historyCalendarId || 0) || null
    };

    row.dataset.historySyncKey = meta.key;
    row.dataset.historySyncType = meta.type;
    note.value = `${visibleNote}${encodeMeta(meta)}`;
    note.dispatchEvent(new Event('input', { bubbles: true }));
    touched.push({ note, visibleNote });
  });

  setTimeout(() => {
    touched.forEach(({ note, visibleNote }) => {
      if (!note.isConnected) return;
      note.value = visibleNote;
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, 0);
}

async function saveControlledWithHistory(id, data, save) {
  const incomingEntries = parseResultEntries(data?.result || '');
  validateEntries(incomingEntries);

  let previousEntries = [];
  if (id) {
    const currentRows = await dbApi.getControlledCases().catch(() => []);
    const current = currentRows.find(row => Number(row.id) === Number(id));
    previousEntries = parseResultEntries(current?.result || '');
  }

  const saved = await save(data);
  const controlledId = Number(saved?.id || id || data?.id || 0);
  if (!controlledId) return saved;

  const context = {
    controlledId,
    generalCaseId: Number(saved?.general_case_id || data?.general_case_id || 0) || null,
    caseNumber: saved?.case_number || data?.case_number || '',
    courtCaseNumber: saved?.court_case_number || data?.court_case_number || '',
    court: saved?.court || data?.court || '',
    representative: saved?.representative || data?.representative || '',
    plaintiff: saved?.plaintiff || data?.plaintiff || '',
    defendant: saved?.defendant || data?.defendant || '',
    subject: saved?.subject || data?.subject || '',
    userName: getCurrentUserName()
  };

  try {
    const syncedEntries = await syncEntries(previousEntries, incomingEntries, context);
    const syncedResult = serializeResultEntries(syncedEntries);

    if (syncedResult !== String(data?.result || '')) {
      const finalSaved = await originalUpdateControlledCase(controlledId, {
        ...data,
        id: controlledId,
        general_case_id: context.generalCaseId,
        result: syncedResult
      });
      updateOpenRowsFromEntries(syncedEntries);
      return finalSaved;
    }

    updateOpenRowsFromEntries(syncedEntries);
    return saved;
  } catch (error) {
    console.warn('controlled history sync failed', error);
    showNotification(`Дело сохранено, но связанное событие не обновлено: ${error.message}`, 'error');
    return saved;
  }
}

function validateEntries(entries) {
  for (const entry of entries) {
    if (entry.meta.type === 'result') continue;
    if (!isValidRuDate(entry.date)) {
      const label = entry.meta.type === 'hearing' ? 'судебного заседания' : 'контрольной даты';
      throw new Error(`Для ${label} укажите дату в формате ДД.ММ.ГГГГ`);
    }
  }
}

async function syncEntries(previousEntries, incomingEntries, context) {
  const previousByKey = new Map(previousEntries.map(entry => [entry.meta.key, entry]));
  const incomingKeys = new Set(incomingEntries.map(entry => entry.meta.key));

  for (const oldEntry of previousEntries) {
    if (!incomingKeys.has(oldEntry.meta.key)) {
      await removeLinkedEvents(oldEntry, context);
    }
  }

  const result = [];
  for (const incoming of incomingEntries) {
    const old = previousByKey.get(incoming.meta.key);
    const entry = {
      ...incoming,
      meta: {
        ...incoming.meta,
        scheduleId: incoming.meta.scheduleId || old?.meta.scheduleId || null,
        calendarId: incoming.meta.calendarId || old?.meta.calendarId || null
      }
    };

    if (entry.meta.type === 'result') {
      await removeLinkedEvents(entry, context);
      entry.meta.scheduleId = null;
      entry.meta.calendarId = null;
    } else if (entry.meta.type === 'hearing') {
      entry.meta.scheduleId = await upsertSchedule(entry, context);
      entry.meta.calendarId = await upsertCalendar(entry, context);
    } else if (entry.meta.type === 'control_date') {
      await removeSchedule(entry, context);
      entry.meta.scheduleId = null;
      entry.meta.calendarId = await upsertCalendar(entry, context);
    }

    result.push(entry);
  }

  window.dispatchEvent(new CustomEvent('schedule:reload'));
  window.dispatchEvent(new CustomEvent('calendar:reload'));
  return result;
}

async function upsertSchedule(entry, context) {
  let scheduleId = Number(entry.meta.scheduleId || 0) || await findScheduleId(entry.meta.key, context);
  const resultWithSource = `${entry.note || ''}${encodeMeta({ source: 'controlled_history_schedule', key: entry.meta.key, controlledId: context.controlledId })}`;
  const payload = {
    session_date: entry.date,
    court: context.court,
    time: entry.time,
    representative: context.representative || context.userName,
    plaintiff: context.plaintiff,
    defendant: context.defendant,
    category: context.subject,
    result: resultWithSource,
    hearing_date: '',
    general_case_id: context.generalCaseId,
    meeting_id: null
  };

  await dbApi.createCourtScheduleDate({ session_date: entry.date }).catch(() => null);

  if (scheduleId) {
    try {
      const updated = await dbApi.updateCourtSchedule(scheduleId, payload);
      return Number(updated?.id || scheduleId);
    } catch {
      scheduleId = 0;
    }
  }

  const created = await dbApi.createCourtScheduleCase(payload);
  return Number(created?.id || 0) || null;
}

async function upsertCalendar(entry, context) {
  let calendarId = Number(entry.meta.calendarId || 0) || await findCalendarId(entry.meta.key, context);
  const type = entry.meta.type === 'hearing' ? 'судебное_заседание' : 'контрольная_дата';
  const title = entry.note || (entry.meta.type === 'hearing' ? 'Судебное заседание' : 'Контрольная дата');
  const payload = {
    date: ruToIso(entry.date),
    user: context.userName,
    type,
    event_scope: 'work',
    desc: title,
    time: entry.time,
    court: context.court,
    subject: context.subject,
    assignment: [
      context.caseNumber ? `№ ПК: ${context.caseNumber}` : '',
      context.courtCaseNumber ? `№ дела в суде: ${context.courtCaseNumber}` : '',
      context.plaintiff ? `Истец: ${context.plaintiff}` : '',
      context.defendant ? `Ответчик: ${context.defendant}` : '',
      context.representative ? `Представитель: ${context.representative}` : '',
      entry.note ? `Запись: ${entry.note}` : ''
    ].filter(Boolean).join('\n'),
    note_text: entry.note,
    metadata_json: JSON.stringify({
      source: 'controlled_history',
      controlled_case_id: context.controlledId,
      history_key: entry.meta.key,
      history_type: entry.meta.type
    }),
    done: 0,
    general_case_id: context.generalCaseId,
    meeting_id: null
  };

  if (calendarId) {
    try {
      const updated = await dbApi.updateCalendarTask(calendarId, payload);
      return Number(updated?.id || calendarId);
    } catch {
      calendarId = 0;
    }
  }

  const created = await dbApi.createCalendarTask(payload);
  return Number(created?.id || 0) || null;
}

async function removeLinkedEvents(entry, context) {
  await removeSchedule(entry, context);
  await removeCalendar(entry, context);
}

async function removeSchedule(entry, context) {
  const id = Number(entry.meta.scheduleId || 0) || await findScheduleId(entry.meta.key, context);
  if (!id) return;
  await dbApi.deleteCourtSchedule(id).catch(error => console.warn('schedule delete failed', error));
}

async function removeCalendar(entry, context) {
  const id = Number(entry.meta.calendarId || 0) || await findCalendarId(entry.meta.key, context);
  if (!id) return;
  await dbApi.deleteCalendarTask(id).catch(error => console.warn('calendar delete failed', error));
}

async function findScheduleId(key, context) {
  const rows = await dbApi.getCourtSchedule().catch(() => []);
  const row = rows.find(item => {
    if (Number(item.is_date_row || 0) === 1) return false;
    const decoded = extractMeta(item.result || '');
    return decoded.meta?.source === 'controlled_history_schedule'
      && decoded.meta?.key === key
      && Number(decoded.meta?.controlledId || 0) === Number(context.controlledId);
  });
  return Number(row?.id || 0) || null;
}

async function findCalendarId(key, context) {
  const rows = await dbApi.getCalendarTasks({
    user: context.userName,
    generalCaseId: context.generalCaseId || ''
  }).catch(() => []);
  const row = rows.find(item => {
    const metadata = parseJson(item.metadata_json || item.metadata || '{}');
    return metadata.source === 'controlled_history'
      && metadata.history_key === key
      && Number(metadata.controlled_case_id || 0) === Number(context.controlledId);
  });
  return Number(row?.id || 0) || null;
}

function parseResultEntries(resultText) {
  return String(resultText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const decoded = extractMeta(line);
      const parsed = parseVisibleLine(decoded.visible);
      const meta = decoded.meta || {};
      return {
        visibleLine: decoded.visible,
        date: parsed.date,
        time: parsed.time,
        note: parsed.note,
        meta: {
          v: 1,
          source: 'controlled_history',
          key: meta.key || randomKey(),
          type: normalizeType(meta.type),
          scheduleId: Number(meta.scheduleId || 0) || null,
          calendarId: Number(meta.calendarId || 0) || null
        }
      };
    });
}

function serializeResultEntries(entries) {
  return entries.map(entry => {
    const visible = buildVisibleLine(entry);
    return `${visible}${encodeMeta(entry.meta)}`;
  }).filter(Boolean).join('\n');
}

function buildVisibleLine(entry) {
  const left = [entry.time, entry.date].map(value => String(value || '').trim()).filter(Boolean).join(' ');
  const note = String(entry.note || '').trim();
  if (left && note) return `${left} - ${note}`;
  return left || note;
}

function parseVisibleLine(value) {
  const line = String(value || '').trim();
  let date = '';
  let time = '';
  let note = line;

  if (/^\d{2}:\d{2}/.test(line)) {
    time = line.slice(0, 5);
    let rest = line.slice(5).trim();
    if (/^\d{2}\.\d{2}\./.test(rest)) {
      date = rest.slice(0, 10);
      rest = rest.slice(10).trim();
    }
    note = rest.replace(/^[-–—/]\s*/, '');
  } else if (/^\d{2}\.\d{2}\./.test(line)) {
    date = line.slice(0, 10);
    let rest = line.slice(10).trim();
    if (/^\d{2}:\d{2}/.test(rest)) {
      time = rest.slice(0, 5);
      rest = rest.slice(5).trim();
    }
    note = rest.replace(/^[-–—/]\s*/, '');
  }

  return { date, time, note };
}

function updateOpenRowsFromEntries(entries) {
  const byKey = new Map(entries.map(entry => [entry.meta.key, entry]));
  document.querySelectorAll('.controlled-history-row[data-history-id]').forEach(row => {
    const entry = byKey.get(row.dataset.historySyncKey);
    if (!entry) return;
    row.dataset.historyScheduleId = String(entry.meta.scheduleId || '');
    row.dataset.historyCalendarId = String(entry.meta.calendarId || '');
  });
}

function encodeMeta(meta) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(meta));
    let bits = '';
    bytes.forEach(byte => {
      bits += byte.toString(2).padStart(8, '0').replaceAll('0', ZERO).replaceAll('1', ONE);
    });
    return `${START}${bits}${END}`;
  } catch {
    return '';
  }
}

function extractMeta(value) {
  const text = String(value || '');
  const start = text.indexOf(START);
  if (start < 0) return { visible: text, meta: null };
  const end = text.indexOf(END, start + START.length);
  if (end < 0) return { visible: text, meta: null };

  const encoded = text.slice(start + START.length, end);
  const visible = `${text.slice(0, start)}${text.slice(end + END.length)}`;

  try {
    const binary = encoded.replaceAll(ZERO, '0').replaceAll(ONE, '1');
    const bytes = [];
    for (let index = 0; index + 7 < binary.length; index += 8) {
      bytes.push(parseInt(binary.slice(index, index + 8), 2));
    }
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    return { visible, meta };
  } catch {
    return { visible, meta: null };
  }
}

function normalizeType(value) {
  return TYPES.has(String(value || '')) ? String(value) : 'result';
}

function isValidRuDate(value) {
  const [day, month, year] = String(value || '').split('.').map(Number);
  if (!day || !month || !year) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function ruToIso(value) {
  const [day, month, year] = String(value || '').split('.');
  return `${year}-${month}-${day}`;
}

function parseJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function randomKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `history_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
