function getSessionToken() {
  try {
    const raw = sessionStorage.getItem('legal-dashboard-auth-session-v1');
    return raw ? JSON.parse(raw)?.token || '' : '';
  } catch {
    return '';
  }
}

async function request(path, options = {}) {
  const token = getSessionToken();
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`API базы данных недоступен. Проверьте, что приложение запущено в одном экземпляре, затем обновите страницу. ${error?.message || ''}`.trim());
  }

  const contentType = String(response.headers.get('content-type') || '');
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') {
      sessionStorage.removeItem('legal-dashboard-auth-session-v1');
      setTimeout(() => window.location.reload(), 0);
      throw new Error('Сеанс входа истёк. Выполняется повторный вход.');
    }
    const message = typeof payload === 'string'
      ? payload
      : payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(message || `HTTP ${response.status}`);
  }

  return payload;
}

async function requestBlob(path, options = {}) {
  const token = getSessionToken();
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`API базы данных недоступен. ${error?.message || ''}`.trim());
  }
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('legal-dashboard-auth-session-v1');
      setTimeout(() => window.location.reload(), 0);
    }
    throw new Error(await response.text() || `HTTP ${response.status}`);
  }
  return response.blob();
}

function reportsQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.mode) query.set('mode', params.mode);
  if (params.year) query.set('year', params.year);
  if (params.quarter) query.set('quarter', params.quarter);
  if (params.report_date) query.set('report_date', params.report_date);
  if (params.scope) query.set('scope', params.scope);
  if (params.all) query.set('all', params.all);
  if (Array.isArray(params.user_ids) && params.user_ids.length) query.set('user_ids', params.user_ids.join(','));
  if (params.user_id) query.set('user_id', params.user_id);
  const value = query.toString();
  return value ? `?${value}` : '';
}

function caseFormSnapshot(data = {}) {
  const form = document.querySelector('[data-general-form]');
  const category = String(form?.elements?.category?.value || data.category || '').trim();
  const prosecutorClaim = form?.elements?.prosecutor_claim_flag?.checked
    ? 1
    : Number(data.prosecutor_claim_flag || 0) === 1 ? 1 : 0;
  return { category, prosecutorClaim };
}

function parseAppeals(value) {
  try {
    const rows = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function randomMetricId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeAppealsForCounter(value) {
  return parseAppeals(value).map(row => ({
    ...row,
    appeal_row_id: row?.appeal_row_id || row?.appealRowId || row?.counter_id || randomMetricId(),
    counter_id: row?.counter_id || row?.appeal_row_id || row?.appealRowId || randomMetricId(),
    counter_created_at: row?.counter_created_at || new Date().toISOString()
  }));
}

function prepareCasePayload(data = {}) {
  const snapshot = caseFormSnapshot(data);
  const appeals = normalizeAppealsForCounter(data.appeals_json);
  return {
    payload: {
      ...data,
      category: snapshot.category,
      prosecutor_claim_flag: snapshot.prosecutorClaim,
      appeals_json: JSON.stringify(appeals)
    },
    prosecutorClaim: snapshot.prosecutorClaim,
    appeals
  };
}

async function saveCaseExtraFlag(caseId, prosecutorClaim) {
  return request('/api/case-extra-flags', {
    method: 'POST',
    body: JSON.stringify({ general_case_id: caseId, prosecutor_claim_flag: prosecutorClaim })
  });
}

async function registerMetricEvent(event) {
  try {
    return await request('/api/report-metric-events', { method: 'POST', body: JSON.stringify(event) });
  } catch (error) {
    console.warn('Не удалось зарегистрировать событие отчёта:', error);
    return null;
  }
}

async function registerCaseMetrics(saved, prepared) {
  const id = Number(saved?.id || prepared.payload.id || 0);
  if (!id) return;
  await saveCaseExtraFlag(id, prepared.prosecutorClaim).catch(error => console.warn('Не удалось сохранить пометку иска прокурора:', error));
  await registerMetricEvent({
    event_type: 'case',
    source_key: `case:${id}`,
    event_date: saved?.created_at || prepared.payload.created_at || prepared.payload.registration_date || new Date().toISOString(),
    employee: saved?.executor || prepared.payload.executor || '',
    category: saved?.category || prepared.payload.category || '',
    subject: saved?.claim_subject || prepared.payload.claim_subject || '',
    metadata: {
      general_case_id: id,
      case_no: saved?.case_no || prepared.payload.case_no || '',
      control_flag: Number(prepared.payload.control_flag || 0),
      attendance_flag: Number(prepared.payload.attendance_flag || 0),
      review_show_flag: Number(prepared.payload.review_show_flag || 0),
      emergency_fund_flag: Number(prepared.payload.emergency_fund_flag || 0),
      registry_flag: Number(prepared.payload.registry_flag || 0),
      prosecutor_claim_flag: prepared.prosecutorClaim
    }
  });
  for (const appeal of prepared.appeals) {
    await registerMetricEvent({
      event_type: 'appeal',
      source_key: `appeal:${id}:${appeal.counter_id}`,
      event_date: appeal.counter_created_at,
      employee: saved?.executor || prepared.payload.executor || '',
      category: saved?.category || prepared.payload.category || '',
      subject: saved?.claim_subject || prepared.payload.claim_subject || '',
      metadata: {
        general_case_id: id,
        counter_id: appeal.counter_id,
        kind: appeal.appeal_kind || appeal.kind || appeal.title || 'Обжалование',
        event_date: appeal.date || appeal.event_date || ''
      }
    });
  }
}

async function registerHearingMetric(row = {}, fallback = {}) {
  const id = Number(row.id || row.schedule_id || 0);
  if (!id) return;
  await registerMetricEvent({
    event_type: 'hearing',
    source_key: `hearing:${id}`,
    event_date: row.created_at || fallback.created_at || new Date().toISOString(),
    employee: row.representative || row.case_executor || fallback.representative || fallback.executor || '',
    category: row.category || fallback.category || '',
    subject: row.result || row.claim_subject || fallback.subject || fallback.result || '',
    metadata: {
      schedule_id: id,
      session_date: row.session_date || row.hearing_date || fallback.session_date || fallback.hearing_date || fallback.date || '',
      court: row.court || fallback.court || '',
      time: row.time || row.time_val || fallback.time || fallback.time_val || '',
      general_case_id: row.general_case_id || fallback.general_case_id || null
    }
  });
}

async function mergeCaseExtraFlags(rows = [], archived = false) {
  const payload = await request('/api/case-extra-flags').catch(() => ({ items: [] }));
  const flags = new Map((payload.items || []).map(row => [Number(row.general_case_id), Number(row.prosecutor_claim_flag || 0)]));
  return rows.map(row => ({
    ...row,
    prosecutor_claim_flag: flags.get(Number(archived ? row.source_id : row.id)) || 0
  }));
}

async function createGeneralCase(data) {
  const prepared = prepareCasePayload(data);
  const saved = await request('/api/general-cases', { method: 'POST', body: JSON.stringify(prepared.payload) });
  await registerCaseMetrics(saved, prepared);
  return { ...saved, prosecutor_claim_flag: prepared.prosecutorClaim };
}

async function updateGeneralCase(id, data) {
  const prepared = prepareCasePayload({ ...data, id });
  const saved = await request(`/api/general-cases/${id}`, { method: 'PUT', body: JSON.stringify(prepared.payload) });
  await registerCaseMetrics(saved, prepared);
  return { ...saved, prosecutor_claim_flag: prepared.prosecutorClaim };
}

export const dbApi = {
  health: () => request('/api/health'),
  getCurrentSession: () => request('/api/auth/me'),
  login: password => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
  getOptions: category => request(`/api/options?category=${encodeURIComponent(category)}`),
  getUsers: () => request('/api/users'),
  getCalendarUsers: () => request('/api/calendar-users'),
  getAdminUsers: () => request('/api/admin/users'),
  createAdminUser: data => request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminUser: (id, data) => request(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAdminOptions: () => request('/api/admin/options'),
  saveAdminOption: data => request('/api/admin/options', { method: 'POST', body: JSON.stringify(data) }),
  deleteAdminOption: id => request(`/api/admin/options/${id}`, { method: 'DELETE' }),
  getNotifications: () => request('/api/notifications'),
  markNotificationsRead: keys => request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ keys }) }),

  getReportsSummary: (params = {}) => request(`/api/reports/summary${reportsQuery(params)}`),
  getReportMetrics: (params = {}) => request(`/api/report-metrics${reportsQuery(params)}`),
  getReportUsers: () => request('/api/reports/users'),
  getQuarterlyReports: (params = {}) => request(`/api/reports/quarterly${reportsQuery(params)}`),
  uploadQuarterlyReport: data => request('/api/reports/quarterly', { method: 'POST', body: JSON.stringify(data) }),
  downloadQuarterlyReport: id => requestBlob(`/api/reports/quarterly/${id}/download`),
  openQuarterlyReport: id => request(`/api/reports/quarterly/${id}/open`, { method: 'POST', body: '{}' }),

  getGeneralCases: async ({ search = '' } = {}) => mergeCaseExtraFlags(await request(`/api/general-cases${search ? `?search=${encodeURIComponent(search)}` : ''}`)),
  getArchivedGeneralCases: async ({ search = '' } = {}) => mergeCaseExtraFlags(await request(`/api/general-cases?archived=1${search ? `&search=${encodeURIComponent(search)}` : ''}`), true),
  createGeneralCase,
  updateGeneralCase,
  saveGeneralCaseExtraFlag: saveCaseExtraFlag,
  uploadGeneralCaseDocument: data => request('/api/general-case-files', { method: 'POST', body: JSON.stringify(data) }),
  previewGeneralCaseDocument: filePath => requestBlob(`/api/general-case-files/preview?path=${encodeURIComponent(filePath)}`),
  openGeneralCaseDocument: filePath => request('/api/general-case-files/open', { method: 'POST', body: JSON.stringify({ path: filePath }) }),
  getGeneralCaseReviewApprovals: id => request(`/api/general-cases/${id}/review-approval`),
  requestGeneralCaseReviewApproval: (id, data) => request(`/api/general-cases/${id}/review-approval/request`, { method: 'POST', body: JSON.stringify(data) }),
  commentGeneralCaseReviewApproval: (caseId, approvalId, data) => request(`/api/general-cases/${caseId}/review-approval/${approvalId}/comment`, { method: 'POST', body: JSON.stringify(data) }),
  requestGeneralCaseReviewRevision: (caseId, approvalId, data) => request(`/api/general-cases/${caseId}/review-approval/${approvalId}/revision`, { method: 'POST', body: JSON.stringify(data) }),
  approveGeneralCaseReview: (caseId, approvalId, data) => request(`/api/general-cases/${caseId}/review-approval/${approvalId}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  markGeneralCaseReviewSentToCourt: (caseId, approvalId, data) => request(`/api/general-cases/${caseId}/review-approval/${approvalId}/court-sent`, { method: 'POST', body: JSON.stringify(data) }),
  archiveGeneralCase: id => request(`/api/general-cases/${id}`, { method: 'DELETE' }),
  restoreGeneralCase: archiveId => request(`/api/general-cases/archive/${archiveId}/restore`, { method: 'POST' }),
  createControlledFromGeneral: (id, history_text = '') => request(`/api/general-cases/${id}/controlled-link`, { method: 'POST', body: JSON.stringify({ history_text }) }),
  addGeneralCaseAttendance: async (id, data) => {
    const result = await request(`/api/general-cases/${id}/attendance-hearing`, { method: 'POST', body: JSON.stringify(data) });
    await registerHearingMetric(result.schedule || {}, { ...data, general_case_id: id });
    return result;
  },

  getControlledCases: ({ search = '' } = {}) => request(`/api/controlled-cases${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getArchivedControlledCases: () => request('/api/controlled-cases/archive'),
  createControlledCase: data => request('/api/controlled-cases', { method: 'POST', body: JSON.stringify(data) }),
  updateControlledCase: (id, data) => request(`/api/controlled-cases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  archiveControlledCase: id => request(`/api/controlled-cases/${id}`, { method: 'DELETE' }),
  restoreControlledCase: archiveId => request(`/api/controlled-cases/archive/${archiveId}/restore`, { method: 'POST' }),
  deleteControlledArchiveCase: archiveId => request(`/api/controlled-cases/archive/${archiveId}`, { method: 'DELETE' }),

  getEnforcement: (mode = 'debtor') => request(`/api/enforcement?mode=${encodeURIComponent(mode)}`),
  getArchivedEnforcement: (mode = 'debtor') => request(`/api/enforcement/archive?mode=${encodeURIComponent(mode)}`),
  createEnforcement: data => request('/api/enforcement', { method: 'POST', body: JSON.stringify(data) }),
  updateEnforcement: (id, data) => request(`/api/enforcement/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEnforcement: id => request(`/api/enforcement/${id}`, { method: 'DELETE' }),
  archiveEnforcement: id => request(`/api/enforcement/${id}/archive`, { method: 'POST' }),
  restoreEnforcement: archiveId => request(`/api/enforcement/archive/${archiveId}/restore`, { method: 'POST' }),
  deleteEnforcementArchive: archiveId => request(`/api/enforcement/archive/${archiveId}`, { method: 'DELETE' }),

  getMeetings: () => request('/api/meetings'),
  getMeetingParticipants: category => request(`/api/meeting-participants${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  createMeeting: data => request('/api/meetings', { method: 'POST', body: JSON.stringify(data) }),
  updateMeeting: (id, data) => request(`/api/meetings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMeeting: id => request(`/api/meetings/${id}`, { method: 'DELETE' }),

  getMunicipalRegistry: ({ search = '' } = {}) => request(`/api/municipal-registry${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createMunicipalRegistry: data => request('/api/municipal-registry', { method: 'POST', body: JSON.stringify(data) }),
  updateMunicipalRegistry: (id, data) => request(`/api/municipal-registry/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMunicipalRegistry: id => request(`/api/municipal-registry/${id}`, { method: 'DELETE' }),
  archiveMunicipalRegistry: id => request(`/api/municipal-registry/${id}/archive`, { method: 'POST' }),
  getMunicipalRegistryArchive: () => request('/api/municipal-registry/archive'),
  restoreMunicipalRegistryArchive: archiveId => request(`/api/municipal-registry/archive/${archiveId}/restore`, { method: 'POST' }),
  deleteMunicipalRegistryArchive: archiveId => request(`/api/municipal-registry/archive/${archiveId}`, { method: 'DELETE' }),

  getEmergencyFund: ({ search = '' } = {}) => request(`/api/emergency-fund${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createEmergencyFund: data => request('/api/emergency-fund', { method: 'POST', body: JSON.stringify(data) }),
  updateEmergencyFund: (id, data) => request(`/api/emergency-fund/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmergencyFund: id => request(`/api/emergency-fund/${id}`, { method: 'DELETE' }),
  archiveEmergencyFund: id => request(`/api/emergency-fund/${id}/archive`, { method: 'POST' }),
  getEmergencyFundArchive: () => request('/api/emergency-fund/archive'),
  restoreEmergencyFundArchive: archiveId => request(`/api/emergency-fund/archive/${archiveId}/restore`, { method: 'POST' }),
  deleteEmergencyFundArchive: archiveId => request(`/api/emergency-fund/archive/${archiveId}`, { method: 'DELETE' }),

  getCourtSchedule: () => request('/api/court-schedule'),
  createCourtScheduleDate: data => request('/api/court-schedule/date', { method: 'POST', body: JSON.stringify(data) }),
  createCourtScheduleCase: async data => {
    const result = await request('/api/court-schedule/case', { method: 'POST', body: JSON.stringify(data) });
    await registerHearingMetric(result, data);
    return result;
  },
  updateCourtSchedule: async (id, data) => {
    const result = await request(`/api/court-schedule/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    await registerHearingMetric(result, data);
    return result;
  },
  deleteCourtSchedule: id => request(`/api/court-schedule/${id}`, { method: 'DELETE' }),

  getCalendarTasks: ({ date = '', start = '', end = '', user = '', scope = '', generalCaseId = '' } = {}) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    if (user) params.set('user', user);
    if (scope) params.set('scope', scope);
    if (generalCaseId) params.set('general_case_id', generalCaseId);
    const query = params.toString();
    return request(`/api/calendar-tasks${query ? `?${query}` : ''}`);
  },
  createCalendarTask: data => request('/api/calendar-tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateCalendarTask: (id, data) => request(`/api/calendar-tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delegateCalendarTasks: data => request('/api/calendar-tasks/delegate', { method: 'POST', body: JSON.stringify(data) }),
  deleteCalendarTask: id => request(`/api/calendar-tasks/${id}`, { method: 'DELETE' })
};
