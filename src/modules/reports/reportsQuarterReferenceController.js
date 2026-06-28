import { dbApi } from '../../api/dbApi.js';

const state = {
  initialized: false,
  timer: null,
  requestVersion: 0,
  applying: false,
  observer: null,
};

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

export function initReportsQuarterReferenceController() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || state.initialized) return;
  state.initialized = true;

  const schedule = delay => scheduleRefresh(root, delay);
  root.addEventListener('submit', () => schedule(100), true);
  root.addEventListener('change', event => {
    if (event.target.closest('[data-reports-filters], [data-reports-structure-sort]')) schedule(100);
  }, true);
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reports-refresh], [data-reports-reset]')) schedule(100);
  }, true);

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') schedule(140);
  });

  state.observer = new MutationObserver(() => {
    if (!state.applying && isQuarterMode(root)) schedule(90);
  });
  state.observer.observe(root, { childList: true, subtree: true });

  schedule(220);
}

function scheduleRefresh(root, delay = 100) {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => renderQuarterReference(root), delay);
}

async function renderQuarterReference(root) {
  if (!root?.isConnected || state.applying || !isQuarterMode(root)) return;
  const version = ++state.requestVersion;

  try {
    const [casesPayload, hearingsPayload, tasksPayload, sessionPayload] = await Promise.all([
      dbApi.getGeneralCases({ search: '' }),
      dbApi.getCourtSchedule(),
      dbApi.getCalendarTasks(),
      dbApi.getCurrentSession().catch(() => null),
    ]);
    if (version !== state.requestVersion || !isQuarterMode(root)) return;

    const year = normalizeYear(root.querySelector('[data-reports-year]')?.value);
    const quarter = normalizeQuarter(root.querySelector('[data-reports-quarter]')?.value);
    const selectedNames = getSelectedEmployeeNames(root, sessionPayload);
    const selected = new Set(selectedNames.map(normalizeName).filter(Boolean));

    const allCases = unwrapRows(casesPayload, ['items', 'rows', 'cases', 'general_cases', 'data', 'results']);
    const allHearings = unwrapRows(hearingsPayload, ['items', 'rows', 'schedule', 'hearings', 'court_schedule', 'data', 'results'])
      .filter(row => Number(row.is_date_row || 0) !== 1);
    const allTasks = unwrapRows(tasksPayload, ['items', 'rows', 'tasks', 'calendar_tasks', 'data', 'results']);

    const cases = filterByEmployees(allCases, selected, ['executor', 'representative', 'case_executor', 'user_name', 'employee']);
    const hearings = filterByEmployees(allHearings, selected, ['representative', 'case_executor', 'executor', 'user_name', 'employee']);
    const tasks = filterByEmployees(allTasks, selected, ['user_name', 'user', 'delegated_to', 'executor', 'employee']);

    const model = buildQuarterModel({ year, quarter, cases, hearings, tasks });
    state.applying = true;
    renderHeader(root, model);
    renderKpis(root, model);
    renderMonthlyInflow(root, model);
    renderDepartmentTotals(root, model);
    renderExecutors(root, model);
    renderStructure(root, model);
  } catch (error) {
    console.warn('Quarter reports reference rendering failed:', error);
  } finally {
    state.observer?.takeRecords();
    state.applying = false;
  }
}

function buildQuarterModel({ year, quarter, cases, hearings, tasks }) {
  const current = quarterRange(year, quarter);
  const previousYear = quarterRange(year - 1, quarter);
  const previousQuarter = previousQuarterRange(year, quarter);
  const ytd = { start: new Date(year, 0, 1), end: current.end };

  const currentCases = filterByDateRange(cases, getCaseDate, current);
  const previousYearCases = filterByDateRange(cases, getCaseDate, previousYear);
  const previousQuarterCases = filterByDateRange(cases, getCaseDate, previousQuarter);
  const ytdCases = filterByDateRange(cases, getCaseDate, ytd);

  const currentHearings = filterByDateRange(hearings, getHearingDate, current);
  const previousYearHearings = filterByDateRange(hearings, getHearingDate, previousYear);

  const currentTasks = filterByDateRange(tasks, getTaskDate, current);
  const previousQuarterTasks = filterByDateRange(tasks, getTaskDate, previousQuarter);
  const currentTaskCompletion = completionPercent(currentTasks);
  const previousTaskCompletion = completionPercent(previousQuarterTasks);

  const currentAppeals = countAppealEvents(cases, current);
  const previousYearAppeals = countAppealEvents(cases, previousYear);

  const months = [0, 1, 2].map(offset => {
    const monthIndex = (quarter - 1) * 3 + offset;
    return {
      monthIndex,
      label: MONTHS[monthIndex],
      current: currentCases.filter(row => getCaseDate(row)?.getMonth() === monthIndex).length,
      previous: previousYearCases.filter(row => getCaseDate(row)?.getMonth() === monthIndex).length,
    };
  });

  return {
    year,
    quarter,
    periodLabel: `${romanQuarter(quarter)} квартал ${year}`,
    current,
    previousYear,
    previousQuarter,
    cases: currentCases,
    ytdCases,
    previousYearCases,
    previousQuarterCases,
    hearings: currentHearings,
    previousYearHearings,
    tasks: currentTasks,
    taskCompletion: currentTaskCompletion,
    previousTaskCompletion,
    appeals: currentAppeals,
    previousYearAppeals,
    months,
  };
}

function renderHeader(root, model) {
  const badge = root.querySelector('[data-reports-quarter-badge]');
  if (badge) badge.textContent = model.periodLabel;
  const title = root.querySelector('[data-reports-title]');
  if (title) title.textContent = 'Квартальный отчёт';
}

function renderKpis(root, model) {
  const node = root.querySelector('[data-reports-quarter-kpis]');
  if (!node) return;

  const caseTrend = percentChange(model.cases.length, model.previousQuarterCases.length);
  const hearingTrend = percentChange(model.hearings.length, model.previousYearHearings.length);
  const appealTrend = percentChange(model.appeals, model.previousYearAppeals);
  const completionDelta = model.taskCompletion - model.previousTaskCompletion;

  node.innerHTML = [
    renderKpiCard('Поступило дел', model.cases.length, trendLabel(caseTrend, 'к прошлому кварталу'), trendTone(caseTrend)),
    renderKpiCard('Судебных заседаний', model.hearings.length, trendLabel(hearingTrend, 'к прошлому году'), trendTone(hearingTrend, true)),
    renderKpiCard('Обжалований', model.appeals, trendLabel(appealTrend, 'к прошлому году'), appealTrend > 0 ? 'warning' : appealTrend < 0 ? 'positive' : 'neutral'),
    renderKpiCard('Исполнено поручений', `${model.taskCompletion}%`, signedPoints(completionDelta, 'к прошлому кварталу'), completionDelta >= 0 ? 'accent' : 'warning'),
  ].join('');
}

function renderKpiCard(label, value, trend, tone) {
  return `
    <article class="reports-quarter-kpi">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em class="tone-${tone}">${escapeHtml(trend)}</em>
    </article>
  `;
}

function renderMonthlyInflow(root, model) {
  const totalBadge = root.querySelector('[data-reports-quarter-total-badge]');
  const rowsNode = root.querySelector('[data-reports-quarter-months]');
  const footer = root.querySelector('[data-reports-quarter-month-footer]');
  if (!rowsNode) return;

  const totalTrend = percentChange(model.cases.length, model.previousYearCases.length);
  if (totalBadge) {
    totalBadge.innerHTML = `
      <span>Итого за квартал</span>
      <div><strong>${formatNumber(model.cases.length)} дел</strong><em class="tone-${trendTone(totalTrend, true)}">${escapeHtml(shortTrend(totalTrend))}</em></div>
    `;
  }

  const max = Math.max(...model.months.flatMap(item => [item.current, item.previous]), 1);
  rowsNode.innerHTML = model.months.map(item => {
    const currentWidth = Math.max(item.current ? 6 : 0, Math.round(item.current / max * 100));
    const previousLeft = Math.max(1, Math.min(99, Math.round(item.previous / max * 100)));
    const trend = percentChange(item.current, item.previous);
    return `
      <div class="reports-quarter-month-row">
        <strong>${escapeHtml(item.label)}</strong>
        <div class="reports-quarter-month-track">
          <span class="reports-quarter-month-bar" style="width:${currentWidth}%"><b>${formatNumber(item.current)}</b></span>
          <i class="reports-quarter-previous-marker" style="left:${previousLeft}%" title="Прошлый год: ${formatNumber(item.previous)}"></i>
        </div>
        <em class="tone-${trendTone(trend, true)}">${escapeHtml(shortTrend(trend))}</em>
      </div>
    `;
  }).join('');

  if (footer) {
    const peak = [...model.months].sort((a, b) => b.current - a.current)[0];
    const average = model.months.length ? Math.round(model.cases.length / model.months.length) : 0;
    footer.innerHTML = `
      <span>Пиковый месяц: <b>${escapeHtml(peak?.label || '—')} — ${formatNumber(peak?.current || 0)} дел</b></span>
      <span>Среднее: <b>${formatNumber(average)} дел в месяц</b></span>
    `;
  }
}

function renderDepartmentTotals(root, model) {
  const node = root.querySelector('[data-reports-quarter-totals]');
  if (!node) return;

  const rows = [
    {
      label: 'Судебные заседания',
      value: model.hearings.length,
      trend: percentChange(model.hearings.length, model.previousYearHearings.length),
      lowerIsBetter: false,
    },
    {
      label: 'Обжалования',
      value: model.appeals,
      trend: percentChange(model.appeals, model.previousYearAppeals),
      lowerIsBetter: true,
    },
    {
      label: 'Исковые заявления',
      value: model.cases.length,
      trend: percentChange(model.cases.length, model.previousYearCases.length),
      lowerIsBetter: false,
    },
  ];

  node.innerHTML = rows.map(row => `
    <div class="reports-quarter-summary-row">
      <span>${escapeHtml(row.label)}</span>
      <strong>${formatNumber(row.value)}</strong>
      <em class="tone-${row.lowerIsBetter ? inverseTrendTone(row.trend) : trendTone(row.trend, true)}">${escapeHtml(shortTrend(row.trend))}</em>
    </div>
  `).join('');
}

function renderExecutors(root, model) {
  const node = root.querySelector('[data-reports-executor-report]');
  if (!node) return;

  const completionByEmployee = new Map();
  const taskGroups = groupBy(model.tasks, row => employeeOf(row) || 'Не указан');
  for (const [employee, rows] of taskGroups) completionByEmployee.set(normalizeName(employee), completionPercent(rows));

  const grouped = new Map();
  const addCase = (row, field) => {
    const executor = employeeOf(row) || 'Не указан';
    const category = categoryOf(row);
    const key = `${normalizeName(executor)}\u0000${normalizeName(category)}`;
    if (!grouped.has(key)) grouped.set(key, { executor, category, quarter: 0, ytd: 0 });
    grouped.get(key)[field] += 1;
  };
  model.ytdCases.forEach(row => addCase(row, 'ytd'));
  model.cases.forEach(row => addCase(row, 'quarter'));

  const rows = [...grouped.values()]
    .map(row => ({ ...row, completion: completionByEmployee.get(normalizeName(row.executor)) ?? 0 }))
    .sort((a, b) => b.quarter - a.quarter || b.ytd - a.ytd || a.executor.localeCompare(b.executor, 'ru'));

  node.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td><strong class="reports-person-name">${escapeHtml(row.executor)}</strong></td>
      <td>${escapeHtml(row.category)}</td>
      <td><strong class="reports-number-cell">${formatNumber(row.quarter)}</strong></td>
      <td><strong class="reports-number-cell">${formatNumber(row.ytd)}</strong></td>
      <td>
        <div class="reports-executor-progress">
          <span><i class="${row.completion >= 85 ? 'is-good' : ''}" style="width:${Math.max(0, Math.min(100, row.completion))}%"></i></span>
          <b>${formatNumber(row.completion)}%</b>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="5"><div class="reports-empty reports-empty-wide">Нет данных по исполнителям за выбранный период.</div></td></tr>';
}

function renderStructure(root, model) {
  const chart = root.querySelector('[data-reports-structure-chart]');
  const subjects = root.querySelector('[data-reports-subject-breakdown]');
  const table = root.querySelector('[data-reports-structure-rows]');
  if (!chart || !table) return;

  const sortMode = root.querySelector('[data-reports-structure-sort]')?.value === 'category' ? 'category' : 'count';
  const grouped = new Map();
  model.cases.forEach(row => {
    const category = categoryOf(row);
    const subject = subjectOf(row);
    const key = `${category}\u0000${subject}`;
    const previous = grouped.get(key) || { category, subject, count: 0 };
    previous.count += 1;
    grouped.set(key, previous);
  });

  const rows = [...grouped.values()].sort((a, b) => sortMode === 'category'
    ? a.category.localeCompare(b.category, 'ru') || b.count - a.count || a.subject.localeCompare(b.subject, 'ru')
    : b.count - a.count || a.category.localeCompare(b.category, 'ru') || a.subject.localeCompare(b.subject, 'ru'));

  if (!rows.length) {
    const empty = '<div class="reports-empty reports-empty-wide">Нет данных по структуре дел за выбранный период.</div>';
    chart.innerHTML = empty;
    if (subjects) subjects.innerHTML = '';
    table.innerHTML = '<tr><td colspan="5">Нет данных для таблицы структуры дел за выбранный период.</td></tr>';
    return;
  }

  const categoryCounts = aggregate(model.cases, categoryOf);
  const displayCategories = collapseCategories(categoryCounts, 5);
  const max = Math.max(...displayCategories.map(([, count]) => count), 1);

  chart.innerHTML = displayCategories.map(([category, count], index) => `
    <button type="button" class="reports-bar-row ${index === 0 ? 'active' : ''}" data-quarter-category="${escapeAttr(category)}">
      <span class="reports-bar-label">${escapeHtml(category)}</span>
      <span class="reports-bar-track"><span style="width:${Math.max(5, Math.round(count / max * 100))}%"></span></span>
      <b>${formatNumber(count)} дел</b>
    </button>
  `).join('');

  const initialCategory = displayCategories[0]?.[0] || rows[0].category;
  if (subjects) {
    subjects.hidden = true;
    subjects.innerHTML = '';
  }
  chart.querySelectorAll('[data-quarter-category]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      chart.querySelectorAll('[data-quarter-category]').forEach(item => item.classList.toggle('active', item === button));
    });
  });

  const total = model.cases.length;
  table.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.category)}</td>
      <td>${escapeHtml(row.subject)}</td>
      <td><strong class="reports-number-cell">${formatNumber(row.count)}</strong></td>
      <td>${formatPercent(total ? row.count / total * 100 : 0)}</td>
      <td>${escapeHtml(model.periodLabel)}</td>
    </tr>
  `).join('');
}

function renderSubjects(node, rows, category) {
  let filtered;
  if (category === 'Иные категории') {
    const totals = new Map();
    rows.forEach(row => totals.set(row.category, (totals.get(row.category) || 0) + row.count));
    const categoryTotals = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
    const included = new Set(categoryTotals.slice(4).map(([name]) => name));
    filtered = rows.filter(row => included.has(row.category));
  } else {
    filtered = rows.filter(row => row.category === category);
  }

  const subjectCounts = new Map();
  filtered.forEach(row => subjectCounts.set(row.subject, (subjectCounts.get(row.subject) || 0) + row.count));
  const items = [...subjectCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).slice(0, 6);

  node.innerHTML = `
    <h4>Предметы спора</h4>
    <div class="reports-quarter-subject-list">
      ${items.map(([subject, count]) => `
        <div><span title="${escapeAttr(subject)}">${escapeHtml(subject)}</span><b>${formatNumber(count)}</b></div>
      `).join('') || '<div class="reports-empty compact">Предметы спора не указаны.</div>'}
    </div>
  `;
}

function collapseCategories(rows, limit) {
  if (rows.length <= limit) return rows;
  const visible = rows.slice(0, limit - 1);
  const rest = rows.slice(limit - 1).reduce((sum, [, count]) => sum + count, 0);
  return [...visible, ['Иные категории', rest]];
}

function filterByEmployees(rows, selected, keys) {
  if (!selected.size) return rows;
  return rows.filter(row => selected.has(normalizeName(firstValue(row, keys))));
}

function filterByDateRange(rows, dateGetter, range) {
  return rows.filter(row => {
    const date = dateGetter(row);
    return date && date >= range.start && date <= range.end;
  });
}

function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  return {
    start: new Date(year, startMonth, 1, 0, 0, 0, 0),
    end: new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
  };
}

function previousQuarterRange(year, quarter) {
  return quarter === 1 ? quarterRange(year - 1, 4) : quarterRange(year, quarter - 1);
}

function countAppealEvents(cases, range) {
  return cases.reduce((sum, row) => {
    const dates = getAppealDates(row).filter(date => date >= range.start && date <= range.end);
    return sum + dates.length;
  }, 0);
}

function getAppealDates(row) {
  const values = [row.appeal_act_date, row.cassation_act_date];
  const raw = row.appeals_json;
  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      items.forEach(item => values.push(firstValue(item, ['date', 'appeal_date', 'submitted_at', 'act_date', 'decision_date'])));
    } catch {}
  }
  return values.map(parseDate).filter(Boolean);
}

function completionPercent(tasks) {
  if (!tasks.length) return 0;
  return Math.round(tasks.filter(isTaskDone).length / tasks.length * 100);
}

function isTaskDone(row) {
  if (Number(row.done || row.completed || row.is_completed || 0) === 1) return true;
  const status = String(row.status || row.state || '').toLowerCase();
  return status.includes('выполн') || status === 'done' || status === 'completed';
}

function getCaseDate(row) {
  return parseDate(firstValue(row, ['registration_date', 'created_at', 'updated_at']));
}

function getHearingDate(row) {
  return parseDate(firstValue(row, ['session_date', 'hearing_date', 'date', 'date_str', 'datetime']));
}

function getTaskDate(row) {
  return parseDate(firstValue(row, ['date_str', 'date', 'deadline', 'due_date', 'created_at']));
}

function employeeOf(row) {
  return String(firstValue(row, ['executor', 'representative', 'case_executor', 'user_name', 'user', 'delegated_to', 'employee']) || '').trim();
}

function categoryOf(row) {
  return String(firstValue(row, ['category', 'dispute_category', 'case_category']) || 'Без категории').trim() || 'Без категории';
}

function subjectOf(row) {
  return String(firstValue(row, ['claim_subject', 'subject', 'result']) || 'Без предмета спора').trim() || 'Без предмета спора';
}

function groupBy(rows, keyFactory) {
  const map = new Map();
  rows.forEach(row => {
    const key = keyFactory(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function aggregate(rows, keyFactory) {
  const map = new Map();
  rows.forEach(row => {
    const key = keyFactory(row);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
}

function getSelectedEmployeeNames(root, sessionPayload) {
  const select = root.querySelector('[data-reports-users]');
  const allUsers = Boolean(root.querySelector('[data-reports-all-users]')?.checked);
  const options = select ? [...select.options] : [];
  const chosen = allUsers ? options : options.filter(option => option.selected);
  const names = chosen.map(option => stripUserStatus(option.textContent)).filter(Boolean);
  if (names.length) return [...new Set(names)];

  const session = sessionPayload?.user || sessionPayload?.session || sessionPayload || {};
  const currentName = session.full_name || session.name || session.user_name || '';
  return currentName ? [String(currentName).trim()] : [];
}

function stripUserStatus(value) {
  return String(value || '').split(/\s+—\s+(?:активен|заблокирован)\s*$/i)[0].trim();
}

function unwrapRows(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    const value = String(key).split('.').reduce((current, part) => current?.[part], payload);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return validDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})/);
  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return validDate(year, Number(match[2]) - 1, Number(match[1]));
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validDate(year, month, day) {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function isQuarterMode(root) {
  return root.querySelector('[data-reports-mode]:checked')?.value === 'quarter';
}

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
}

function normalizeQuarter(value) {
  const quarter = Number(value);
  return Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? quarter : Math.floor(new Date().getMonth() / 3) + 1;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function romanQuarter(quarter) {
  return ['', 'I', 'II', 'III', 'IV'][quarter] || String(quarter);
}

function percentChange(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round((current - previous) / previous * 100);
}

function trendLabel(value, suffix) {
  if (value === null) return `Новые данные ${suffix}`;
  return `${value > 0 ? '+' : ''}${value}% ${suffix}`;
}

function shortTrend(value) {
  if (value === null) return 'новое';
  return `${value > 0 ? '+' : ''}${value}%`;
}

function signedPoints(value, suffix) {
  return `${value > 0 ? '+' : ''}${value} п.п. ${suffix}`;
}

function trendTone(value, positiveIsGood = true) {
  if (value === null || value === 0) return 'neutral';
  const good = positiveIsGood ? value > 0 : value < 0;
  return good ? 'positive' : 'warning';
}

function inverseTrendTone(value) {
  if (value === null || value === 0) return 'neutral';
  return value < 0 ? 'positive' : 'warning';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
