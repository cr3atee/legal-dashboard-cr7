import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

const READ_STORAGE_KEY = 'legal-dashboard-assignment-notification-reads-v1';
let initialized = false;

export function initAssignmentNotificationOpen() {
  if (initialized) return;
  initialized = true;

  const originalGetNotifications = dbApi.getNotifications.bind(dbApi);
  const originalMarkNotificationsRead = dbApi.markNotificationsRead.bind(dbApi);

  dbApi.getNotifications = async () => {
    const [response, cases] = await Promise.all([
      originalGetNotifications(),
      dbApi.getGeneralCases().catch(() => [])
    ]);

    const base = response && typeof response === 'object' ? response : { items: [] };
    const assignmentItems = buildAssignmentNotifications(Array.isArray(cases) ? cases : []);
    const merged = mergeNotifications(Array.isArray(base.items) ? base.items : [], assignmentItems);

    return {
      ...base,
      items: merged,
      unread_count: merged.filter(item => Number(item.unread) === 1).length,
      active_count: merged.filter(item => item.status === 'active').length,
      overdue_count: merged.filter(item => item.status === 'overdue').length
    };
  };

  dbApi.markNotificationsRead = async keys => {
    const normalized = [...new Set((Array.isArray(keys) ? keys : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))];
    rememberReadKeys(normalized.filter(key => key.startsWith('case-assignment:')));
    return originalMarkNotificationsRead(normalized);
  };
}

function buildAssignmentNotifications(cases) {
  const session = getAuthSession() || {};
  const currentUser = normalizeName(session.full_name || session.name || '');
  if (!currentUser) return [];

  const readKeys = loadReadKeys();
  const result = [];

  for (const row of cases) {
    const executor = normalizeName(row.executor || row.user_name || row.user || '');
    if (!executor || executor !== currentUser) continue;

    const marks = getCaseMarks(row);
    if (!marks.length) continue;

    const caseId = Number(row.id || 0);
    if (!caseId) continue;

    const markSignature = marks.map(mark => mark.code).sort().join(',');
    const key = `case-assignment:${caseId}:${currentUser}:${markSignature}`;
    const caseNumber = row.case_no || row.court_no || `№ ${caseId}`;
    const markText = marks.map(mark => `«${mark.label}»`).join(', ');
    const createdAt = row.created_at || row.updated_at || new Date().toISOString();

    result.push({
      key,
      status: 'active',
      severity: 'assignment',
      title: 'Вам назначено дело',
      message: `Вам назначено дело ${formatCaseNumber(caseNumber)} с отметкой ${markText}.`,
      due_at: createdAt,
      source_type: 'general_case',
      source_id: caseId,
      general_case_id: caseId,
      unread: readKeys.has(key) ? 0 : 1,
      type: 'case_assignment',
      metadata: {
        type: 'case_assignment',
        caseId,
        marks: marks.map(mark => mark.code)
      }
    });
  }

  return result;
}

function getCaseMarks(row = {}) {
  const definitions = [
    ['review_show_flag', 'review_show', 'Отзыв показать'],
    ['attendance_flag', 'attendance', 'Явочное дело'],
    ['control_flag', 'control', 'Контрольное дело'],
    ['emergency_fund_flag', 'emergency_fund', 'Аварийный фонд'],
    ['registry_flag', 'registry', 'Реестр']
  ];

  return definitions
    .filter(([field]) => Number(row[field] || 0) === 1)
    .map(([, code, label]) => ({ code, label }));
}

function mergeNotifications(baseItems, assignmentItems) {
  const map = new Map();
  for (const item of [...assignmentItems, ...baseItems]) {
    const key = String(item?.key || '').trim();
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => {
    if (Number(a.unread) !== Number(b.unread)) return Number(b.unread) - Number(a.unread);
    return new Date(b.due_at || 0).getTime() - new Date(a.due_at || 0).getTime();
  });
}

function loadReadKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(READ_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberReadKeys(keys) {
  if (!keys.length) return;
  const current = loadReadKeys();
  keys.forEach(key => current.add(key));
  localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...current].slice(-2000)));
}

function normalizeName(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function formatCaseNumber(value) {
  const text = String(value || '').trim();
  if (!text) return 'без номера';
  return text.startsWith('№') ? text : `№ ${text}`;
}
