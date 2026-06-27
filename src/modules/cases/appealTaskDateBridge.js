import { dbApi } from '../../api/dbApi.js';
import { calculateAppealDeadline, normalizeKind, readAppealRow } from './appealDeadlineMath.js';

export function initAppealTaskDateBridge() {
  if (dbApi.__appealTaskDateBridge) return;
  dbApi.__appealTaskDateBridge = true;
  const original = dbApi.createCalendarTask.bind(dbApi);
  dbApi.createCalendarTask = data => original(withCorrectDate(data));
}

function withCorrectDate(data = {}) {
  const title = String(data.desc || data.description || '');
  if (!title.includes('Последний день подачи')) return data;
  const kind = normalizeKind(title);
  const row = [...document.querySelectorAll('[data-general-appeal-row]')]
    .map(readAppealRow)
    .find(item => normalizeKind(item.appeal_kind) === kind);
  const result = row ? calculateAppealDeadline(row) : null;
  return result?.dateIso ? { ...data, date: result.dateIso } : data;
}
