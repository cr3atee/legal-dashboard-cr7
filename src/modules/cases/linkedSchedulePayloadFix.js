import { dbApi } from '../../api/dbApi.js';

const META_START = '\u2063\u2063\u200d';
const META_END = '\u200d\u2063\u2063';
const META_ZERO = '\u200b';
const META_ONE = '\u200c';

let initialized = false;

export function initLinkedSchedulePayloadFix() {
  if (initialized) return;
  initialized = true;

  const createCourtScheduleCase = dbApi.createCourtScheduleCase.bind(dbApi);
  const updateCourtSchedule = dbApi.updateCourtSchedule.bind(dbApi);

  dbApi.createCourtScheduleCase = async data => {
    const normalized = await normalizePayload(data);
    return createCourtScheduleCase(normalized);
  };

  dbApi.updateCourtSchedule = async (id, data) => {
    const normalized = await normalizePayload(data);
    return updateCourtSchedule(id, normalized);
  };
}

async function normalizePayload(data = {}) {
  const resultMeta = extractMeta(data.result || '');
  const categoryMeta = extractMeta(data.category || '');
  const marker = isHistoryScheduleMeta(resultMeta.meta)
    ? resultMeta
    : (isHistoryScheduleMeta(categoryMeta.meta) ? categoryMeta : null);

  if (!marker) return data;

  const controlledRows = await dbApi.getControlledCases().catch(() => []);
  const generalCaseId = Number(data.general_case_id || 0);
  const controlled = marker.meta?.controlledId
    ? controlledRows.find(row => Number(row.id || 0) === Number(marker.meta.controlledId))
    : controlledRows.find(row => Number(row.general_case_id || 0) === generalCaseId);

  const generalRows = generalCaseId
    ? await dbApi.getGeneralCases().catch(() => [])
    : [];
  const general = generalRows.find(row => Number(row.id || 0) === generalCaseId) || null;

  const currentSubject = String(controlled?.subject || general?.claim_subject || '').trim();
  const history = findHistoryEntry(controlled?.result, marker.meta.key);
  const currentNote = String(history?.note || '').trim();
  const visibleResult = resultMeta.visible.trim();
  const visibleCategory = categoryMeta.visible.trim();

  let subject;
  let note;

  if (marker === categoryMeta) {
    subject = visibleResult || currentSubject;
    note = visibleCategory || currentNote;
  } else {
    const legacyShape = isSameText(visibleResult, currentNote)
      || (isSameText(visibleCategory, currentSubject) && !isSameText(visibleResult, currentSubject));

    if (legacyShape) {
      subject = visibleCategory || currentSubject;
      note = visibleResult || currentNote;
    } else {
      subject = visibleResult || currentSubject;
      note = visibleCategory || currentNote;
    }
  }

  return {
    ...data,
    result: subject,
    category: `${note}${marker.token}`
  };
}

function findHistoryEntry(resultText, key) {
  if (!key) return null;
  return String(resultText || '')
    .split(/\r?\n/)
    .map(line => {
      const decoded = extractMeta(line);
      return { ...decoded, ...parseHistoryLine(decoded.visible) };
    })
    .find(row => row.meta?.key === key) || null;
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

function isHistoryScheduleMeta(meta) {
  return meta?.source === 'controlled_history_schedule' && Boolean(meta?.key);
}

function isSameText(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}
