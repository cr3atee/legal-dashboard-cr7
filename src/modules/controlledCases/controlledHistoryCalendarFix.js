import { dbApi } from '../../api/dbApi.js';
import { getCurrentUserName } from '../../auth/session.js';

let initialized = false;
let originalCreateCalendarTask = null;
let originalUpdateCalendarTask = null;

export function initControlledHistoryCalendarFix() {
  if (initialized) return;
  initialized = true;

  originalCreateCalendarTask = dbApi.createCalendarTask.bind(dbApi);
  originalUpdateCalendarTask = dbApi.updateCalendarTask.bind(dbApi);

  dbApi.createCalendarTask = async data => {
    const payload = normalizeControlledHistoryCalendarPayload(data);
    const created = await originalCreateCalendarTask(payload);
    if (isControlledHistoryPayload(payload) && !Number(created?.id || 0)) {
      throw new Error('Календарь не вернул идентификатор созданного события');
    }
    scheduleCalendarReload();
    return created;
  };

  dbApi.updateCalendarTask = async (id, data) => {
    const payload = normalizeControlledHistoryCalendarPayload(data);
    const updated = await originalUpdateCalendarTask(id, payload);
    scheduleCalendarReload();
    return updated;
  };

  setTimeout(repairLegacyControlledHistoryTasks, 800);
}

function normalizeControlledHistoryCalendarPayload(data = {}) {
  if (!isControlledHistoryPayload(data)) return data;

  const date = String(data.date || data.date_str || '').trim();
  const time = String(data.time || data.time_val || '').trim();
  const description = String(data.desc || data.description || data.note_text || data.assignment || '').trim();
  const originalType = String(data.type || data.task_type || '').trim();
  const type = originalType === 'контрольная_дата' ? 'поручение' : originalType;
  const user = String(data.user || data.user_name || getCurrentUserName() || '').trim();

  if (!date) {
    throw new Error('Для передачи записи в календарь не указана дата');
  }

  return {
    ...data,
    date,
    date_str: date,
    user,
    user_name: user,
    type,
    task_type: type,
    desc: description,
    description,
    time,
    time_val: time,
    event_scope: 'work',
    done: Number(data.done || 0) ? 1 : 0
  };
}

function isControlledHistoryPayload(data = {}) {
  const metadata = parseMetadata(data.metadata_json || data.metadata || '{}');
  return metadata.source === 'controlled_history';
}

async function repairLegacyControlledHistoryTasks() {
  const user = getCurrentUserName();
  if (!user) return;

  const rows = await dbApi.getCalendarTasks({ user }).catch(() => []);
  for (const row of rows) {
    const metadata = parseMetadata(row.metadata_json || row.metadata || '{}');
    if (metadata.source !== 'controlled_history') continue;
    if (String(row.task_type || row.type || '') !== 'контрольная_дата') continue;

    await originalUpdateCalendarTask(row.id, normalizeControlledHistoryCalendarPayload({
      ...row,
      date: row.date_str || row.date || '',
      time: row.time_val || row.time || '',
      type: 'поручение',
      desc: row.description || row.desc || row.note_text || '',
      metadata_json: row.metadata_json || '{}'
    })).catch(error => console.warn('Не удалось исправить старую контрольную дату:', error));
  }

  scheduleCalendarReload();
}

function scheduleCalendarReload() {
  window.dispatchEvent(new CustomEvent('calendar:reload'));
  setTimeout(() => window.dispatchEvent(new CustomEvent('calendar:reload')), 120);
  setTimeout(() => window.dispatchEvent(new CustomEvent('calendar:reload')), 450);
}

function parseMetadata(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
