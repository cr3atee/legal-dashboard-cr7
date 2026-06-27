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
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export function initReportsDerivedDataController() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || state.initialized) return;
  state.initialized = true;

  const schedule = delay => scheduleRefresh(root, delay);
  root.addEventListener('submit', () => schedule(220), true);
  root.addEventListener('change', event => {
    if (event.target.closest('[data-reports-filters], [data-reports-structure-sort]')) schedule(220);
  }, true);
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reports-refresh], [data-reports-reset]')) schedule(220);
  }, true);

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') schedule(260);
  });

  state.observer = new MutationObserver(() => {
    if (!state.applying) schedule(140);
  });
  state.observer.observe(root, { childList: true, subtree: true });

  schedule(320);
}

function scheduleRefresh(root, delay = 180) {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => refreshDerivedReports(root), delay);
}

async function refreshDerivedReports(root) {
  if (!root?.isConnected || state.applying) return;
  const version = ++state.requestVersion;
  const mode = getMode(root);

  try {
    if (mode === 'day') {
      const [schedulePayload, sessionPayload] = await Promise.all([
        dbApi.getCourtSchedule(),
        dbApi.getCurrentSession().catch(() => null),
      ]);
      if (version !== state.requestVersion || getMode(root) !== 'day') return;
      renderDayTimeline(root, unwrapRows(schedulePayload), sessionPayload);
      return;
    }

    const [casesPayload, hearingsPayload, tasksPayload, sessionPayload] = await Promise.all([
      dbApi.getGeneralCases({ search: '' }),
      dbApi.getCourtSchedule(),
      dbApi.getCalendarTasks(),
      dbApi.getCurrentSession().catch(() => null),
    ]);
    if (version !== state.requestVersion || getMode(root) !== 'quarter') return;

    renderQuarter(root, {
      cases: unwrapRows(casesPayload),
      hearings: unwrapRows(hearingsPayload).filter(row => Number(row.is_date_row || 0) !== 1),
      tasks: unwrapRows(tasksPayload),
      sessionPayload,
    });
  } catch (error) {
    console.warn('Reports derived data refresh failed:', error);
  }
}

function renderDayTimeline(root, hearings, sessionPayload) {
  const node = root.querySelector('[data-reports-timeline]');
  if (!node) return;

  const reportDate = normalizeDateKey(root.querySelector('[data-reports-date]')?.value);
  const selectedNames = getSelectedEmployeeNames(root, sessionPayload);
  const dateRows = hearings
    .filter(row => Number(row.is_date_row || 0) !== 1)
    .filter(row => normalizeDateKey(getHearingDateValue(row)) === reportDate);
  const rows = filterByEmployees(dateRows, selectedNames, hearingEmployeeOf)
    .map(normalizeHearingRow)
    .sort((a, b) => safeTime(a.time) - safeTime(b.time));

  state.applying = true;
  try {
    if (!rows.length) {
      const coreHasRows = Boolean(node.querySelector('.reports-timeline-row, .reports-timeline-item'))
        && !node.querySelector('[data-derived-timeline]');
      if (coreHasRows) return;
      node.innerHTML = '<div class="reports-empty reports-empty-wide" data-derived-timeline>На выбранную дату судебных заседаний нет.</div>';
      return;
    }

    const grouped = groupBy(rows, row => row.employee || 'Сотрудник не указан');
    const minutes = rows.map(row => timeToMinutes(row.time)).filter(Number.isFinite);
    const start = minutes.length ? Math.max(0, Math.min(...minutes) - 60) : 8 * 60;
    const end = minutes.length ? Math.min(24 * 60, Math.max(...minutes) + 90) : 18 * 60;
    const span = Math.max(60, end - start);

    node.innerHTML = `
      <div class="reports-timeline-scale reports-timeline-scale-fixed" data-derived-timeline>
        <span aria-hidden="true"></span>
        <div class="reports-timeline-scale-spread">
          <span>${formatTime(start)}</span>
          <span>${formatTime(start + span / 2)}</span>
          <span>${formatTime(end)}</span>
        </div>
      </div>
      ${[...grouped.entries()].map(([employee, employeeRows]) => `
        <div class="reports-timeline-row" data-derived-timeline>
          <strong title="${escapeAttr(employee)}">${escapeHtml(employee)}</strong>
          <div class="reports-timeline-track">
            ${employeeRows.map(row => {
              const value = timeToMinutes(row.time);
              const rawLeft = Number.isFinite(value) ? ((value - start) / span) * 100 : 5;
              const left = Math.max(5, Math.min(88, rawLeft));
              return `
                <span class="reports-timeline-item ${row.conflict ? 'is-conflict' : ''}" style="left:${left}%" title="${escapeAttr([row.time, row.court, row.subject].filter(Boolean).join(' · '))}">
                  <b>${escapeHtml(row.time || '—')}</b>
                  ${escapeHtml(row.court || 'Суд не указан')}
                  <small>${escapeHtml(row.subject || row.caseNo || 'Предмет не указан')}</small>
                </span>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    `;
  } finally {
    state.observer?.takeRecords();
    state.applying = false;
  }
}

function renderQuarter(root, payload) {
  const year = normalizeYear(root.querySelector('[data-reports-year]')?.value);
  const quarter = normalizeQuarter(root.querySelector('[data-reports-quarter]')?.value);
  const selectedNames = getSelectedEmployeeNames(root, payload.sessionPayload);

  const cases = filterByEmployees(payload.cases, selectedNames, caseEmployeeOf);
  const hearings = filterByEmployees(payload.hearings, selectedNames, hearingEmployeeOf);
  const tasks = filterByEmployees(payload.tasks, selectedNames, taskEmployeeOf);
  const model = buildQuarterModel({ year, quarter, cases, hearings, tasks });

  state.applying = true;
  try {
    renderQuarterHeader(root, model);
    renderQuarterKpis(root, model);
    renderMonthlyInflow(root, model);
    renderDepartmentTotals(root, model);
    renderExecutors(root, model);
    renderStructure(root, model);
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

  const datedCases = cases.filter(row => getCaseDate(row));
  const undatedCases = cases.filter(row => !getCaseDate(row));
  const currentCases = filterByDateRange(datedCases, getCaseDate, current);
  const previousYearCases = filterByDateRange(datedCases, getCaseDate, previousYear);
  const previousQuarterCases = filterByDateRange(datedCases, getCaseDate, previousQuarter);
  const ytdCases = filterByDateRange(datedCases, getCaseDate, ytd);

  const effectiveCurrentCases = currentCases.length ? currentCases : undatedCases;
  const effectiveYtdCases = ytdCases.length ? ytdCases : effectiveCurrentCases;

  const currentHearings = filterByDateRange(hearings, getHearingDate, current);
  const previousYearHearings = filterByDateRange(hearings, getHearingDate, previousYear);
  const currentTasks = filterByDateRange(tasks, getTaskDate, current);
  const previousQuarterTasks = filterByDateRange(tasks, getTaskDate, previousQuarter);

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
    cases: effectiveCurrentCases,
    ytdCases: effectiveYtdCases,
    previousYearCases,
    previousQuarterCases,
    hearings: currentHearings,
    previousYearHearings,
    tasks: currentTasks,
    taskCompletion: completionPercent(currentTasks),
    previousTaskCompletion: completionPercent(previousQuarterTasks),
    appeals: countAppealEvents(cases, current),
    previousYearAppeals: countAppealEvents(cases, previousYear),
    months,
  };
}

function renderQuarterHeader(root, model) {
  const badge = root.querySelector('[data-reports-quarter-badge]');
  if (badge) badge.textContent = model.periodLabel;
  const title = root.querySelector('[data-reports-title]');
  if (title) title.textContent = 'Квартальный отчёт';
}

function renderQuarterKpis(root, model) {
  const node = root.querySelector('[data-reports-quarter-kpis]');
  if (!node) return;
  const caseTrend = percentChange(model.cases.length, model.previousQuarterCases.length);
  const hearingTrend = percentChange(model.hearings.length, model.previousYearHearings.length);
  const appealTrend = percentChange(model.appeals, model.previousYearAppeals);
  const completionDelta = model.taskCompletion - model.previousTaskCompletion;

  node.innerHTML = [
    renderKpiCard('Поступило дел', model.cases.length, trendLabel(caseTrend, 'к прошлому кварталу'), trendTone(caseTrend)),
    renderKpiCard('Судебных заседаний', model.hearings.length, trendLabel(hearingTrend, 'к прошлому году'), trendTone(hearingTrend)),
    renderKpiCard('Обжалований', model.appeals, trendLabel(appealTrend, 'к прошлому году'), appealTrend > 0 ? 'warning' : appealTrend < 0 ? 'positive' : 'neutral'),
    renderKpiCard('Исполнено поручений', `${model.taskCompletion}%`, signedPoints(completionDelta, 'к прошлому кварталу'), completionDelta >= 0 ? 'accent' : 'warning'),
  ].join('');
}

function renderKpiCard(label, value, trend, tone) {
  return `<article class="reports-quarter-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em class="tone-${tone}">${escapeHtml(trend)}</em></article>`;
}

function renderMonthlyInflow(root, model) {
  const totalBadge = root.querySelector('[data-reports-quarter-total-badge]');
  const rowsNode = root.querySelector('[data-reports-quarter-months]');
  const footer = root.querySelector('[data-reports-quarter-month-footer]');
  if (!rowsNode) return;

  const totalTrend = percentChange(model.cases.length, model.previousYearCases.length);
  if (totalBadge) {
    totalBadge.innerHTML = `<span>Итого за квартал</span><div><strong>${formatNumber(model.cases.length)} дел</strong><em class="tone-${trendTone(totalTrend)}">${escapeHtml(shortTrend(totalTrend))}</em></div>`;
  }

  const max = Math.max(...model.months.flatMap(item => [item.current, item.previous]), 1);
  rowsNode.innerHTML = model.months.map(item => {
    const width = Math.max(item.current ? 6 : 0, Math.round(item.current / max * 100));
    const previousLeft = Math.max(1, Math.min(99, Math.round(item.previous / max * 100)));
    const trend = percentChange(item.current, item.previous);
    return `
      <div class="reports-quarter-month-row">
        <strong>${escapeHtml(item.label)}</strong>
        <div class="reports-quarter-month-track">
          <span class="reports-quarter-month-bar" style="width:${width}%"><b>${formatNumber(item.current)}</b></span>
          <i class="reports-quarter-previous-marker" style="left:${previousLeft}%" title="Прошлый год: ${formatNumber(item.previous)}"></i>
        </div>
        <em class="tone-${trendTone(trend)}">${escapeHtml(shortTrend(trend))}</em>
      </div>`;
  }).join('');

  if (footer) {
    const peak = [...model.months].sort((a, b) => b.current - a.current)[0];
    const average = model.months.length ? Math.round(model.cases.length / model.months.length) : 0;
    footer.innerHTML = `<span>Пиковый месяц: <b>${escapeHtml(peak?.label || '—')} — ${formatNumber(peak?.current || 0)} дел</b></span><span>Среднее: <b>${formatNumber(average)} дел в месяц</b></span>`;
  }
}

function renderDepartmentTotals(root, model) {
  const node = root.querySelector('[data-reports-quarter-totals]');
  if (!node) return;
  const rows = [
    ['Судебные заседания', model.hearings.length, percentChange(model.hearings.length, model.previousYearHearings.length), false],
    ['Обжалования', model.appeals, percentChange(model.appeals, model.previousYearAppeals), true],
    ['Исковые заявления', model.cases.length, percentChange(model.cases.length, model.previousYearCases.length), false],
  ];
  node.innerHTML = rows.map(([label, value, trend, lowerIsBetter]) => `
    <div class="reports-quarter-summary-row"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong><em class="tone-${lowerIsBetter ? inverseTrendTone(trend) : trendTone(trend)}">${escapeHtml(shortTrend(trend))}</em></div>
  `).join('');
}

function renderExecutors(root, model) {
  const node = root.querySelector('[data-reports-executor-report]');
  if (!node) return;

  const completionByEmployee = new Map();
  for (const [employee, rows] of groupBy(model.tasks, taskEmployeeOf)) {
    completionByEmployee.set(normalizePersonName(employee), completionPercent(rows));
  }

  const grouped = new Map();
  const add = (row, field) => {
    const executor = caseEmployeeOf(row) || 'Не указан';
    const category = categoryOf(row);
    const key = `${normalizePersonName(executor)}\u0000${normalizeText(category)}`;
    if (!grouped.has(key)) grouped.set(key, { executor, category, quarter: 0, ytd: 0 });
    grouped.get(key)[field] += 1;
  };
  model.ytdCases.forEach(row => add(row, 'ytd'));
  model.cases.forEach(row => add(row, 'quarter'));

  const rows = [...grouped.values()]
    .map(row => ({ ...row, completion: completionByEmployee.get(normalizePersonName(row.executor)) ?? 0 }))
    .sort((a, b) => b.quarter - a.quarter || b.ytd - a.ytd || a.executor.localeCompare(b.executor, 'ru'));

  node.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td><strong class="reports-person-name">${escapeHtml(row.executor)}</strong></td>
      <td>${escapeHtml(row.category)}</td>
      <td><strong class="reports-number-cell">${formatNumber(row.quarter)}</strong></td>
      <td><strong class="reports-number-cell">${formatNumber(row.ytd)}</strong></td>
      <td><div class="reports-executor-progress"><span><i class="${row.completion >= 85 ? 'is-good' : ''}" style="width:${Math.max(0, Math.min(100, row.completion))}%"></i></span><b>${formatNumber(row.completion)}%</b></div></td>
    </tr>
  `).join('') : '<tr><td colspan="5"><div class="reports-empty reports-empty-wide">Нет данных по исполнителям за выбранный период.</div></td></tr>';
}

function renderStructure(root, model) {
  const chart = root.querySelector('[data-reports-structure-chart]');
  const subjects = root.querySelector('[data-reports-subject-breakdown]');
  const table = root.querySelector('[data-reports-structure-rows]');
  if (!chart || !subjects || !table) return;

  const sortMode = root.querySelector('[data-reports-structure-sort]')?.value === 'category' ? 'category' : 'count';
  const grouped = new Map();
  model.cases.forEach(row => {
    const category = categoryOf(row);
    const subject = subjectOf(row);
    const key = `${normalizeText(category)}\u0000${normalizeText(subject)}`;
    const item = grouped.get(key) || { category, subject, count: 0 };
    item.count += 1;
    grouped.set(key, item);
  });

  const rows = [...grouped.values()].sort((a, b) => sortMode === 'category'
    ? a.category.localeCompare(b.category, 'ru') || b.count - a.count
    : b.count - a.count || a.category.localeCompare(b.category, 'ru'));

  if (!rows.length) {
    const empty = '<div class="reports-empty reports-empty-wide">Нет данных по структуре дел за выбранный период.</div>';
    chart.innerHTML = empty;
    subjects.innerHTML = empty;
    table.innerHTML = '<tr><td colspan="5">Нет данных для таблицы структуры дел за выбранный период.</td></tr>';
    return;
  }

  const categoryCounts = aggregate(model.cases, categoryOf);
  const categories = collapseCategories(categoryCounts, 5);
  const max = Math.max(...categories.map(([, count]) => count), 1);
  chart.innerHTML = categories.map(([category, count], index) => `
    <button type="button" class="reports-bar-row ${index === 0 ? 'active' : ''}" data-derived-category="${escapeAttr(category)}">
      <span class="reports-bar-label">${escapeHtml(category)}</span>
      <span class="reports-bar-track"><span style="width:${Math.max(5, Math.round(count / max * 100))}%"></span></span>
      <b>${formatNumber(count)} дел</b>
    </button>
  `).join('');

  const showSubjects = category => renderSubjects(subjects, rows, category, categories);
  showSubjects(categories[0]?.[0] || rows[0].category);
  chart.querySelectorAll('[data-derived-category]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      chart.querySelectorAll('[data-derived-category]').forEach(item => item.classList.toggle('active', item === button));
      showSubjects(button.dataset.derivedCategory || '');
    });
  });

  const total = model.cases.length;
  table.innerHTML = rows.map(row => `
    <tr><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.subject)}</td><td><strong class="reports-number-cell">${formatNumber(row.count)}</strong></td><td>${formatPercent(total ? row.count / total * 100 : 0)}</td><td>${escapeHtml(model.periodLabel)}</td></tr>
  `).join('');
}

function renderSubjects(node, rows, category, displayedCategories) {
  let includedCategories = new Set([category]);
  if (category === 'Иные категории') {
    const visible = new Set(displayedCategories.slice(0, -1).map(([name]) => name));
    includedCategories = new Set(rows.map(row => row.category).filter(name => !visible.has(name)));
  }
  const counts = new Map();
  rows.filter(row => includedCategories.has(row.category)).forEach(row => {
    counts.set(row.subject, (counts.get(row.subject) || 0) + row.count);
  });
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).slice(0, 6);
  node.innerHTML = `<h4>Предметы спора</h4><div class="reports-quarter-subject-list">${items.map(([subject, count]) => `<div><span title="${escapeAttr(subject)}">${escapeHtml(subject)}</span><b>${formatNumber(count)}</b></div>`).join('') || '<div class="reports-empty compact">Предметы спора не указаны.</div>'}</div>`;
}

function getSelectedEmployeeNames(root, sessionPayload) {
  const allUsers = Boolean(root.querySelector('[data-reports-all-users]')?.checked);
  if (allUsers) return [];

  const select = root.querySelector('[data-reports-users]');
  const names = select
    ? [...select.selectedOptions].map(option => cleanEmployeeLabel(option.textContent)).filter(Boolean)
    : [];
  if (names.length) return [...new Set(names)];

  const session = sessionPayload?.user || sessionPayload?.session || sessionPayload || {};
  const currentName = session.full_name || session.name || session.user_name || '';
  return currentName ? [String(currentName).trim()] : [];
}

function filterByEmployees(rows, selectedNames, getter) {
  if (!selectedNames.length) return rows;
  return rows.filter(row => selectedNames.some(selected => personNamesMatch(getter(row), selected)));
}

function personNamesMatch(actual, selected) {
  const left = normalizePersonName(actual);
  const right = normalizePersonName(selected);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;

  const leftParts = left.split(' ');
  const rightParts = right.split(' ');
  if (leftParts[0] !== rightParts[0]) return false;
  const leftInitials = leftParts.slice(1).map(part => part[0]).join('');
  const rightInitials = rightParts.slice(1).map(part => part[0]).join('');
  return Boolean(leftInitials && rightInitials && (leftInitials.startsWith(rightInitials) || rightInitials.startsWith(leftInitials)));
}

function cleanEmployeeLabel(value) {
  return String(value || '').split(/\s+—\s+/)[0].replace(/\s*\((?:активен|заблокирован)\)\s*$/i, '').trim();
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  const paths = ['items', 'rows', 'cases', 'general_cases', 'schedule', 'hearings', 'court_schedule', 'tasks', 'calendar_tasks', 'data', 'results'];
  for (const path of paths) {
    const value = path.split('.').reduce((current, part) => current?.[part], payload);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeHearingRow(row) {
  return {
    id: row.id || row.schedule_id || '',
    employee: hearingEmployeeOf(row) || 'Сотрудник не указан',
    time: String(firstValue(row, ['time', 'start_time', 'time_val']) || '').trim(),
    court: String(firstValue(row, ['court', 'court_name']) || '').trim(),
    subject: String(firstValue(row, ['result', 'claim_subject', 'subject', 'linked_subject']) || '').trim(),
    caseNo: String(firstValue(row, ['case_no', 'court_no', 'case_number', 'linked_case_no']) || '').trim(),
    conflict: Boolean(row.conflict || row.has_conflict),
  };
}

function caseEmployeeOf(row) {
  return String(firstValue(row, ['executor', 'representative', 'case_executor', 'user_name', 'employee', 'responsible', 'assignee']) || '').trim();
}

function hearingEmployeeOf(row) {
  return String(firstValue(row, ['representative', 'case_executor', 'executor', 'user_name', 'employee', 'responsible']) || '').trim();
}

function taskEmployeeOf(row) {
  return String(firstValue(row, ['delegated_to', 'user_name', 'user', 'executor', 'employee', 'responsible']) || '').trim();
}

function categoryOf(row) {
  return String(firstValue(row, ['category', 'dispute_category', 'case_category', 'claim_category']) || 'Без категории').trim() || 'Без категории';
}

function subjectOf(row) {
  return String(firstValue(row, ['claim_subject', 'subject', 'result', 'linked_subject', 'description']) || 'Без предмета спора').trim() || 'Без предмета спора';
}

function getCaseDate(row) {
  return parseDate(firstValue(row, [
    'registration_date', 'case_registration_date', 'receipt_date', 'incoming_date',
    'filing_date', 'case_date', 'created_at', 'updated_at',
  ]));
}

function getHearingDate(row) {
  return parseDate(getHearingDateValue(row));
}

function getHearingDateValue(row) {
  return firstValue(row, ['session_date', 'hearing_date', 'date', 'date_str', 'datetime', 'start_date']);
}

function getTaskDate(row) {
  return parseDate(firstValue(row, ['date_str', 'date', 'deadline', 'due_date', 'end_date', 'created_at']));
}

function filterByDateRange(rows, getter, range) {
  return rows.filter(row => {
    const date = getter(row);
    return date && date >= range.start && date <= range.end;
  });
}

function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  return { start: new Date(year, startMonth, 1, 0, 0, 0, 0), end: new Date(year, startMonth + 3, 0, 23, 59, 59, 999) };
}

function previousQuarterRange(year, quarter) {
  return quarter === 1 ? quarterRange(year - 1, 4) : quarterRange(year, quarter - 1);
}

function countAppealEvents(cases, range) {
  return cases.reduce((sum, row) => sum + getAppealDates(row).filter(date => date >= range.start && date <= range.end).length, 0);
}

function getAppealDates(row) {
  const values = [row.appeal_act_date, row.cassation_act_date];
  if (row.appeals_json) {
    try {
      const parsed = typeof row.appeals_json === 'string' ? JSON.parse(row.appeals_json) : row.appeals_json;
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

function collapseCategories(rows, limit) {
  if (rows.length <= limit) return rows;
  return [...rows.slice(0, limit - 1), ['Иные категории', rows.slice(limit - 1).reduce((sum, [, count]) => sum + count, 0)]];
}

function aggregate(rows, keyFactory) {
  const map = new Map();
  rows.forEach(row => {
    const key = keyFactory(row);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
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

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || '').trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) return validDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = text.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})/);
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

function normalizeDateKey(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizePersonName(value) {
  return cleanEmployeeLabel(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
}

function normalizeQuarter(value) {
  const quarter = Number(value);
  return Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? quarter : Math.floor(new Date().getMonth() / 3) + 1;
}

function getMode(root) {
  return root.querySelector('[data-reports-mode]:checked')?.value === 'quarter' ? 'quarter' : 'day';
}

function timeToMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function safeTime(value) {
  const minutes = timeToMinutes(value);
  return Number.isFinite(minutes) ? minutes : Number.MAX_SAFE_INTEGER;
}

function formatTime(minutes) {
  const value = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function romanQuarter(quarter) {
  return ['', 'I', 'II', 'III', 'IV'][quarter] || String(quarter);
}

function percentChange(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round((current - previous) / previous * 100);
}

function trendLabel(value, suffix) {
  return value === null ? `Новые данные ${suffix}` : `${value > 0 ? '+' : ''}${value}% ${suffix}`;
}

function shortTrend(value) {
  return value === null ? 'новое' : `${value > 0 ? '+' : ''}${value}%`;
}

function signedPoints(value, suffix) {
  return `${value > 0 ? '+' : ''}${value} п.п. ${suffix}`;
}

function trendTone(value) {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'warning';
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
