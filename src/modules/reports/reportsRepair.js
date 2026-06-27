import { dbApi } from '../../api/dbApi.js';

const STYLE_ID = 'reports-repair-styles';

export function initReportsRepair() {
  if (window.__reportsRepairInitialized) return;
  window.__reportsRepairInitialized = true;
  installStyles();
  wrapReportsApi();
}

function wrapReportsApi() {
  if (dbApi.__reportsRepairWrapped) return;
  dbApi.__reportsRepairWrapped = true;
  const original = dbApi.getReportsSummary.bind(dbApi);

  dbApi.getReportsSummary = async params => {
    const response = await original(params);
    const repaired = params?.mode === 'quarter'
      ? await enrichQuarterReport(response, params)
      : await enrichDayReport(response, params);

    requestAnimationFrame(() => {
      if (params?.mode === 'quarter') renderQuarterInflow(repaired, params);
      normalizeReportLayout();
    });
    return repaired;
  };
}

async function enrichDayReport(response = {}, params = {}) {
  const date = String(params.report_date || '').slice(0, 10);
  if (!date) return response;
  let tasks = [];
  try {
    tasks = await dbApi.getCalendarTasks({ date });
  } catch (error) {
    console.warn('reports repair: calendar tasks unavailable', error);
    return response;
  }

  const availableUsers = response?.scope?.available_users || [];
  const selectedIds = new Set((params.user_ids || []).map(Number));
  const selectedNames = new Set(
    availableUsers
      .filter(user => !selectedIds.size || selectedIds.has(Number(user.id)))
      .map(user => normalizeName(user.full_name))
      .filter(Boolean)
  );

  const hearings = dedupeHearings((Array.isArray(tasks) ? tasks : [])
    .filter(isHearingTask)
    .filter(task => matchesSelectedUser(task, selectedIds, selectedNames))
    .map(normalizeHearing));

  if (!hearings.length) return response;
  const daily = ensureScopedObject(response, ['daily', 'day', 'daily_report'], 'daily');
  daily.hearings = dedupeHearings([...(daily.hearings || []), ...hearings]);
  daily.hearings_today = daily.hearings;
  daily.day_hearings = daily.hearings;

  const employees = getFirstArray(daily, ['employees', 'employee_cards', 'users'])
    || getFirstArray(response, ['employees', 'employee_cards', 'users']);
  if (employees) {
    employees.forEach(employee => {
      const employeeHearings = hearings.filter(row => matchesEmployee(row, employee));
      if (!employeeHearings.length) return;
      employee.hearings = dedupeHearings([...(employee.hearings || []), ...employeeHearings]);
      employee.day_hearings = employee.hearings;
    });
  }

  daily.metrics = { ...(daily.metrics || {}) };
  if (!Number(daily.metrics.hearings_day || 0)) daily.metrics.hearings_day = hearings.length;
  return response;
}

async function enrichQuarterReport(response = {}, params = {}) {
  let cases = [];
  try {
    const payload = await dbApi.getGeneralCases();
    cases = Array.isArray(payload) ? payload : (payload?.items || payload?.cases || []);
  } catch (error) {
    console.warn('reports repair: general cases unavailable', error);
    return response;
  }
  if (!cases.length) return response;

  const year = Number(params.year || new Date().getFullYear());
  const quarter = Math.min(4, Math.max(1, Number(params.quarter || 1)));
  const startMonth = (quarter - 1) * 3;
  const quarterCases = filterCasesByPeriod(cases, year, startMonth, startMonth + 3);
  const ytdCases = filterCasesByPeriod(cases, year, 0, startMonth + 3);
  const previousCases = filterCasesByPeriod(cases, year - 1, startMonth, startMonth + 3);

  const effectiveQuarterCases = quarterCases.length ? quarterCases : cases.filter(item => !getCaseDate(item));
  const quarterData = ensureScopedObject(response, ['quarterly', 'quarter', 'quarter_report', 'quarterly_summary'], 'quarterly');

  const categories = groupCategories(effectiveQuarterCases);
  const structureRows = groupStructure(effectiveQuarterCases);
  const executors = groupExecutors(effectiveQuarterCases, ytdCases);
  const monthly = buildMonthlyInflow(effectiveQuarterCases, previousCases, year, startMonth);

  if (!getFirstArray(quarterData, ['categories', 'category_breakdown', 'cases_by_category'])?.length) {
    quarterData.categories = categories;
    quarterData.category_breakdown = categories;
    quarterData.cases_by_category = categories;
  }
  if (!getFirstArray(quarterData, ['structure_rows', 'category_subjects', 'subjects'])?.length) {
    quarterData.structure_rows = structureRows;
    quarterData.category_subjects = structureRows;
  }
  if (!getFirstArray(quarterData, ['executor_report', 'by_executor', 'executor_categories'])?.length) {
    quarterData.executor_report = executors;
    quarterData.by_executor = executors;
  }

  quarterData.metrics = { ...(quarterData.metrics || {}) };
  if (!Number(quarterData.metrics.cases_received_quarter || 0)) {
    quarterData.metrics.cases_received_quarter = effectiveQuarterCases.length;
  }
  if (!Number(quarterData.metrics.cases_received_ytd || 0)) {
    quarterData.metrics.cases_received_ytd = ytdCases.length || effectiveQuarterCases.length;
  }
  quarterData.monthly_inflow = monthly;
  quarterData.previous_year_available = previousCases.length > 0;
  response.__reportsRepair = { monthly };
  return response;
}

function renderQuarterInflow(data = {}, params = {}) {
  const root = document.querySelector('[data-reports-root]');
  if (!root || root.dataset.reportsMode !== 'quarter') return;
  const node = root.querySelector('[data-reports-quarter-inflow]');
  const monthly = data?.__reportsRepair?.monthly || data?.quarterly?.monthly_inflow || [];
  if (!node || !monthly.length) return;

  const currentTotal = monthly.reduce((sum, row) => sum + row.current, 0);
  const previousTotal = monthly.reduce((sum, row) => sum + row.previous, 0);
  const maxValue = Math.max(1, ...monthly.flatMap(row => [row.current, row.previous]));
  const peak = monthly.reduce((best, row) => row.current > best.current ? row : best, monthly[0]);
  const average = Math.round(currentTotal / monthly.length);
  const totalDelta = formatDelta(currentTotal, previousTotal);

  node.innerHTML = `
    <div class="reports-quarter-chart-head">
      <div>
        <span class="reports-quarter-chart-caption">Количество новых дел по месяцам</span>
        <div class="reports-quarter-chart-legend">
          <span><i class="is-current"></i>Текущий квартал</span>
          <span><i class="is-previous"></i>Аналогичный период прошлого года</span>
        </div>
      </div>
      <div class="reports-quarter-total">
        <span>Итого за квартал</span>
        <strong>${currentTotal.toLocaleString('ru-RU')} дел</strong>
        <em class="${totalDelta.className}">${totalDelta.label}</em>
      </div>
    </div>
    <div class="reports-quarter-bars">
      ${monthly.map(row => {
        const currentWidth = Math.max(0, Math.min(100, (row.current / maxValue) * 100));
        const previousLeft = Math.max(0, Math.min(100, (row.previous / maxValue) * 100));
        const delta = formatDelta(row.current, row.previous);
        return `
          <div class="reports-quarter-bar-row" aria-label="${escapeHtml(`${row.label}: ${row.current} дел, в прошлом году ${row.previous}, ${delta.label}`)}">
            <strong>${escapeHtml(row.label)}</strong>
            <div class="reports-quarter-bar-track">
              <span class="reports-quarter-bar-fill" style="width:${currentWidth}%"><b>${row.current || ''}</b></span>
              ${row.previous > 0 ? `<i class="reports-quarter-previous-marker" style="left:${previousLeft}%" title="Прошлый год: ${row.previous}"></i>` : ''}
            </div>
            <em class="${delta.className}">${delta.label}</em>
          </div>
        `;
      }).join('')}
    </div>
    <div class="reports-quarter-chart-footer">
      <strong>Пиковый месяц: ${escapeHtml(peak.label)} — ${peak.current} дел</strong>
      <span>Среднее: ${average} дел в месяц</span>
    </div>
  `;
}

function normalizeReportLayout() {
  const root = document.querySelector('[data-reports-root]');
  if (!root) return;
  root.querySelectorAll('.reports-employee-card').forEach(card => card.classList.add('reports-repaired-card'));
  root.querySelectorAll('.reports-empty').forEach(node => {
    node.style.wordBreak = 'normal';
    node.style.overflowWrap = 'break-word';
    node.style.whiteSpace = 'normal';
  });
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .reports-employee-grid:not(.is-single){grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))!important;align-items:stretch!important}
    .reports-employee-card,.reports-employee-card *{min-width:0}
    .reports-employee-card{overflow:hidden}
    .reports-employee-card .reports-empty,.reports-employee-card .reports-empty.compact{width:100%!important;max-width:100%!important;min-height:118px!important;height:auto!important;padding:20px!important;text-align:center!important;word-break:normal!important;overflow-wrap:break-word!important;white-space:normal!important;line-height:1.45!important}
    .reports-employee-card .reports-empty.compact::first-line{white-space:normal}
    .reports-employee-section{min-width:0!important}
    .reports-hearing-chip{max-width:100%;overflow:hidden}
    .reports-timeline-row{grid-template-columns:minmax(150px,220px) minmax(0,1fr)!important}
    .reports-timeline-track{min-width:0!important}
    .reports-quarter-overview{grid-template-columns:minmax(0,1.6fr) minmax(360px,1fr)!important;gap:20px!important}
    .reports-mode-panel[data-reports-quarter-panel] .reports-card{border-radius:24px!important}
    .reports-quarter-chart-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}
    .reports-quarter-chart-caption{font-size:14px;color:var(--muted,#70839e)}
    .reports-quarter-chart-legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:12px;color:var(--muted,#607792)}
    .reports-quarter-chart-legend span{display:flex;align-items:center;gap:7px}
    .reports-quarter-chart-legend i.is-current{width:12px;height:12px;border-radius:4px;background:#3b6fd8}
    .reports-quarter-chart-legend i.is-previous{width:3px;height:15px;border-radius:2px;background:#9aa9ba}
    .reports-quarter-total{position:relative;display:grid;grid-template-columns:auto auto;gap:3px 12px;min-width:220px;padding:12px 14px;border-radius:16px;background:var(--surface-muted,#f4f7fb)}
    .reports-quarter-total span{grid-column:1/-1;font-size:12px;color:var(--muted,#7a8ca5)}
    .reports-quarter-total strong{font-size:20px;color:var(--text,#0f2745)}
    .reports-quarter-total em,.reports-quarter-bar-row>em{align-self:center;justify-self:end;padding:5px 9px;border-radius:14px;font-size:12px;font-style:normal;font-weight:700;white-space:nowrap}
    .is-positive{background:#e9f7f2;color:#126b51}.is-negative{background:#fff2f3;color:#a23a49}.is-neutral{background:#eef3f8;color:#607792}
    .reports-quarter-bars{display:grid;gap:16px}
    .reports-quarter-bar-row{display:grid;grid-template-columns:86px minmax(160px,1fr) 70px;align-items:center;gap:14px}
    .reports-quarter-bar-row>strong{font-size:14px;color:var(--text-soft,#334e6e)}
    .reports-quarter-bar-track{position:relative;height:36px;border-radius:11px;background:var(--surface-muted,#eef3f8);overflow:visible}
    .reports-quarter-bar-fill{display:flex;align-items:center;justify-content:flex-end;height:100%;min-width:0;border-radius:11px;background:#3b6fd8;transition:width .2s ease}
    .reports-quarter-bar-fill b{padding:0 10px;color:#fff;font-size:13px}
    .reports-quarter-previous-marker{position:absolute;top:-5px;bottom:-5px;width:3px;border-radius:2px;background:#9aa9ba;transform:translateX(-1px)}
    .reports-quarter-chart-footer{display:flex;justify-content:space-between;gap:16px;margin-top:22px;padding:11px 14px;border-radius:14px;background:var(--surface-muted,#f8fafd);font-size:13px;color:var(--text-soft,#334e6e)}
    [data-reports-executor-report] tr,[data-reports-structure-rows] tr{background:transparent}
    .reports-chart-layout{grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr)!important}
    @media(max-width:1100px){.reports-quarter-overview{grid-template-columns:1fr!important}.reports-chart-layout{grid-template-columns:1fr!important}}
    @media(max-width:760px){.reports-quarter-chart-head,.reports-quarter-chart-footer{flex-direction:column}.reports-quarter-total{width:100%}.reports-quarter-bar-row{grid-template-columns:1fr}.reports-quarter-bar-row>em{justify-self:start}.reports-timeline-row{grid-template-columns:1fr!important}}
  `;
  document.head.append(style);
}

function ensureScopedObject(root, keys, fallbackKey) {
  for (const key of keys) {
    if (root?.[key] && typeof root[key] === 'object' && !Array.isArray(root[key])) return root[key];
  }
  root[fallbackKey] = {};
  return root[fallbackKey];
}

function getFirstArray(source, keys) {
  for (const key of keys) if (Array.isArray(source?.[key])) return source[key];
  return null;
}

function isHearingTask(task = {}) {
  const text = [task.type, task.task_type, task.kind, task.title, task.description, task.assignment, task.event_type]
    .filter(Boolean).join(' ').toLowerCase();
  return text.includes('засед') || text.includes('слушан') || text.includes('судебное');
}

function normalizeHearing(task = {}) {
  return {
    ...task,
    id: task.id,
    session_date: task.session_date || task.hearing_date || task.date || task.date_str,
    time: task.time || task.start_time || task.time_val || '',
    court: task.court || task.court_name || 'Суд не указан',
    subject: task.subject || task.claim_subject || task.assignment || task.description || '',
    case_no: task.case_no || task.court_no || task.case_number || '',
    representative: task.representative || task.employee || task.user_name || task.user || task.delegated_to || '',
    user_id: task.user_id || task.assignee_id || task.executor_id || null,
  };
}

function dedupeHearings(rows = []) {
  const seen = new Set();
  return rows.filter(row => {
    const key = [row.id || '', row.session_date || row.date || '', row.time || row.start_time || '', normalizeName(row.representative || row.employee || row.user_name), row.case_no || row.case_number || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesSelectedUser(task, ids, names) {
  if (!ids.size && !names.size) return true;
  const taskId = Number(task.user_id || task.assignee_id || task.executor_id || 0);
  if (taskId && ids.has(taskId)) return true;
  return [task.user_name, task.user, task.employee, task.executor, task.representative, task.delegated_to]
    .some(value => names.has(normalizeName(value)));
}

function matchesEmployee(row, employee) {
  const rowId = Number(row.user_id || row.assignee_id || row.executor_id || 0);
  const employeeId = Number(employee.user_id || employee.id || 0);
  if (rowId && employeeId && rowId === employeeId) return true;
  const employeeName = normalizeName(employee.user_name || employee.full_name || employee.name);
  return [row.representative, row.employee, row.user_name, row.user, row.executor, row.delegated_to]
    .some(value => normalizeName(value) === employeeName);
}

function filterCasesByPeriod(cases, year, startMonth, endMonth) {
  return cases.filter(item => {
    const date = getCaseDate(item);
    return date && date.getFullYear() === year && date.getMonth() >= startMonth && date.getMonth() < endMonth;
  });
}

function getCaseDate(item = {}) {
  for (const value of [item.received_at, item.registration_date, item.filing_date, item.created_at, item.date, item.updated_at]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function groupCategories(cases) {
  const map = new Map();
  cases.forEach(item => {
    const category = String(item.dispute_category || item.category || item.case_category || 'Без категории').trim();
    map.set(category, (map.get(category) || 0) + 1);
  });
  return [...map].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

function groupStructure(cases) {
  const map = new Map();
  cases.forEach(item => {
    const category = String(item.dispute_category || item.category || item.case_category || 'Без категории').trim();
    const subject = String(item.claim_subject || item.subject || item.dispute_subject || 'Предмет не указан').trim();
    const key = `${category}\u0000${subject}`;
    map.set(key, { category, subject, count: (map.get(key)?.count || 0) + 1 });
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function groupExecutors(quarterCases, ytdCases) {
  const ytd = new Map();
  ytdCases.forEach(item => {
    const executor = getExecutor(item);
    const category = getCategory(item);
    const key = `${executor}\u0000${category}`;
    ytd.set(key, (ytd.get(key) || 0) + 1);
  });
  const quarter = new Map();
  quarterCases.forEach(item => {
    const executor = getExecutor(item);
    const category = getCategory(item);
    const key = `${executor}\u0000${category}`;
    quarter.set(key, { executor, category, quarter_count: (quarter.get(key)?.quarter_count || 0) + 1 });
  });
  return [...quarter].map(([key, row]) => ({ ...row, ytd_count: ytd.get(key) || row.quarter_count }))
    .sort((a, b) => b.quarter_count - a.quarter_count);
}

function buildMonthlyInflow(currentCases, previousCases, year, startMonth) {
  const formatter = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
  return [0, 1, 2].map(offset => {
    const month = startMonth + offset;
    return {
      label: capitalize(formatter.format(new Date(year, month, 1))),
      current: currentCases.filter(item => getCaseDate(item)?.getMonth() === month).length,
      previous: previousCases.filter(item => getCaseDate(item)?.getMonth() === month).length,
    };
  });
}

function getExecutor(item) {
  return String(item.executor || item.case_executor || item.responsible || item.representative || 'Не указан').trim();
}
function getCategory(item) {
  return String(item.dispute_category || item.category || item.case_category || 'Без категории').trim();
}
function formatDelta(current, previous) {
  if (!previous) return current ? { label: 'Новые', className: 'is-positive' } : { label: '0%', className: 'is-neutral' };
  const value = Math.round(((current - previous) / previous) * 100);
  return { label: `${value > 0 ? '+' : ''}${value}%`, className: value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-neutral' };
}
function normalizeName(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function capitalize(value) { return value ? value[0].toUpperCase() + value.slice(1) : ''; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
