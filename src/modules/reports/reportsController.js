import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';
import { hasPermission, PERMISSIONS, ROLE_LEVELS } from '../../core/permissions.js';

const STATUS_LEGEND = [
  'Зелёный — план выполняется, 0–2 заседания в день.',
  'Жёлтый — 3–4 заседания либо нагрузка выше плана на 20%.',
  'Красный — 5+ заседаний, просроченные судебные акты или конфликт расписания.',
].join('\n');

const DEFAULT_PREVIOUS_YEAR_MESSAGE =
  'В правовой системе «ЮрСфера» данные за предыдущий год отсутствуют';

const state = {
  initialized: false,
  loading: false,
  canManageAll: false,
  availableUsers: [],
  selectedUserIds: [],
  allUsers: true,
  mode: 'day',
  date: todayIso(),
  year: new Date().getFullYear(),
  quarter: getQuarter(new Date()),
  structureSort: 'count',
  selectedCategory: '',
  latestData: null,
  latestStructureRows: [],
  latestCategoryRows: [],
  latestOverdueTasksByUser: new Map(),
  latestRemainingTasksByUser: new Map(),
  openOverdueUserKey: '',
  openTaskListKind: '',
};

export function initReportsPage() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || state.initialized) return;
  state.initialized = true;

  hydrateFilters(root);
  bindEvents(root);
  syncRoleUi(root);
  syncModeUi(root);
  loadReports();
}

function bindEvents(root) {
  root.querySelector('[data-reports-filters]')?.addEventListener('submit', event => {
    event.preventDefault();
    loadReports();
  });

  root.querySelector('[data-reports-refresh]')?.addEventListener('click', () => {
    loadReports();
  });

  root.querySelectorAll('[data-reports-mode]').forEach(input => {
    input.addEventListener('change', event => {
      state.mode = event.target.value === 'day' ? 'day' : 'quarter';
      syncModeUi(root);
      loadReports();
    });
  });

  root.querySelector('[data-reports-date]')?.addEventListener('change', () => {
    syncFiltersFromUi(root);
    if (state.mode === 'day') loadReports();
  });

  root.querySelector('[data-reports-year]')?.addEventListener('change', () => {
    syncFiltersFromUi(root);
    if (state.mode === 'quarter') loadReports();
  });

  root.querySelector('[data-reports-quarter]')?.addEventListener('change', () => {
    syncFiltersFromUi(root);
    if (state.mode === 'quarter') loadReports();
  });

  root.querySelector('[data-reports-all-users]')?.addEventListener('change', event => {
    state.allUsers = event.target.checked;
    const select = root.querySelector('[data-reports-users]');
    if (select) select.disabled = state.allUsers;
    syncFiltersFromUi(root);
    renderReportUserPicker(root);
    loadReports();
  });

  root.querySelector('[data-reports-users]')?.addEventListener('change', event => {
    state.selectedUserIds = [...event.target.selectedOptions]
      .map(option => Number(option.value))
      .filter(Boolean);
    if (state.selectedUserIds.length) {
      const allInput = root.querySelector('[data-reports-all-users]');
      if (allInput) allInput.checked = false;
      state.allUsers = false;
      event.target.disabled = false;
    }
    renderReportUserPicker(root);
    loadReports();
  });

  root.querySelector('[data-reports-users-toggle]')?.addEventListener('click', event => {
    event.preventDefault();
    toggleReportUserPicker(root);
  });

  root.querySelector('[data-reports-users-options]')?.addEventListener('change', event => {
    if (!event.target.matches('[data-reports-user-option]')) return;
    state.selectedUserIds = [...root.querySelectorAll('[data-reports-user-option]:checked')]
      .map(input => Number(input.value))
      .filter(Boolean);
    state.allUsers = state.selectedUserIds.length === 0;
    const allInput = root.querySelector('[data-reports-all-users]');
    if (allInput) allInput.checked = state.allUsers;
    syncReportUserSelect(root);
    renderReportUserPicker(root);
    loadReports();
  });

  root.querySelector('[data-reports-reset]')?.addEventListener('click', () => {
    state.mode = 'day';
    state.date = todayIso();
    state.year = new Date().getFullYear();
    state.quarter = getQuarter(new Date());
    state.selectedUserIds = [];
    state.allUsers = true;
    state.structureSort = 'count';
    state.selectedCategory = '';
    hydrateFilters(root);
    syncModeUi(root);
    syncReportUserSelect(root);
    renderReportUserPicker(root);
    closeReportUserPicker(root);
    loadReports();
  });

  root.querySelector('[data-reports-structure-sort]')?.addEventListener('change', event => {
    state.structureSort = event.target.value === 'category' ? 'category' : 'count';
    renderQuarterlyReport(root, state.latestData || {});
  });

  root.addEventListener('click', event => {
    const categoryButton = event.target.closest('[data-reports-category]');
    if (categoryButton) {
      state.selectedCategory = categoryButton.dataset.reportsCategory || '';
      renderStructureBreakdown(root);
      renderStructureChart(root);
      return;
    }

    const copyButton = event.target.closest('[data-reports-copy]');
    if (copyButton) {
      copyReportBlock(copyButton.dataset.reportsCopy, root);
      return;
    }

    const controlledCard = event.target.closest('[data-reports-controlled-id]');
    if (controlledCard) {
      openControlledCaseFromReport(controlledCard.dataset.reportsControlledId);
      return;
    }

    const overdueButton = event.target.closest('[data-reports-overdue-user]');
    if (overdueButton) {
      openOverdueTasksDialog(overdueButton.dataset.reportsOverdueUser || '');
      return;
    }

    const remainingButton = event.target.closest('[data-reports-remaining-user]');
    if (remainingButton) {
      openRemainingTasksDialog(remainingButton.dataset.reportsRemainingUser || '');
      return;
    }

  });

  document.addEventListener('click', event => {
    if (!root.contains(event.target) || !event.target.closest('[data-reports-manager-panel]')) {
      closeReportUserPicker(root);
    }
  });

  root.addEventListener('keydown', event => {
    const categoryButton = event.target.closest('[data-reports-category]');
    if (!categoryButton || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    state.selectedCategory = categoryButton.dataset.reportsCategory || '';
    renderStructureBreakdown(root);
    renderStructureChart(root);
  });

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') loadReports();
  });
}

function hydrateFilters(root) {
  root.querySelectorAll('[data-reports-mode]').forEach(input => {
    input.checked = input.value === state.mode;
  });
  const dateInput = root.querySelector('[data-reports-date]');
  if (dateInput) dateInput.value = state.date;
  const yearInput = root.querySelector('[data-reports-year]');
  if (yearInput) yearInput.value = String(state.year);
  const quarterInput = root.querySelector('[data-reports-quarter]');
  if (quarterInput) quarterInput.value = String(state.quarter);
  const allInput = root.querySelector('[data-reports-all-users]');
  if (allInput) allInput.checked = state.allUsers;
  const sortInput = root.querySelector('[data-reports-structure-sort]');
  if (sortInput) sortInput.value = state.structureSort;
}

function syncFiltersFromUi(root) {
  state.date = root.querySelector('[data-reports-date]')?.value || todayIso();
  state.year = Number(root.querySelector('[data-reports-year]')?.value || new Date().getFullYear());
  state.quarter = Number(root.querySelector('[data-reports-quarter]')?.value || getQuarter(new Date()));
  state.mode = root.querySelector('[data-reports-mode]:checked')?.value === 'day' ? 'day' : 'quarter';

  const allInput = root.querySelector('[data-reports-all-users]');
  state.allUsers = allInput ? allInput.checked : state.allUsers;
  const select = root.querySelector('[data-reports-users]');
  state.selectedUserIds = select
    ? [...select.selectedOptions].map(option => Number(option.value)).filter(Boolean)
    : state.selectedUserIds;
}

function syncModeUi(root) {
  root.dataset.reportsMode = state.mode;
  setText(root.querySelector('[data-reports-title]'), state.mode === 'day' ? 'Ежедневный отчёт' : 'Поквартальный отчёт');
  root.querySelectorAll('[data-reports-day-field]').forEach(node => {
    node.hidden = state.mode !== 'day';
  });
  root.querySelectorAll('[data-reports-quarter-field]').forEach(node => {
    node.hidden = state.mode !== 'quarter';
  });
  const dayPanel = root.querySelector('[data-reports-day-panel]');
  const quarterPanel = root.querySelector('[data-reports-quarter-panel]');
  if (dayPanel) dayPanel.hidden = state.mode !== 'day';
  if (quarterPanel) quarterPanel.hidden = state.mode !== 'quarter';
}

function syncRoleUi(root) {
  const session = getAuthSession();
  state.canManageAll = hasPermission(PERMISSIONS.REPORTS_MANAGE_ALL, session)
    || Number(session?.role_level || 0) >= ROLE_LEVELS.REPORT_ADMIN;
  root.querySelectorAll('[data-reports-manager-panel]').forEach(node => {
    node.hidden = !state.canManageAll;
  });
  const select = root.querySelector('[data-reports-users]');
  if (select) select.disabled = state.allUsers;
  renderReportUserPicker(root);
}

async function loadReports() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || state.loading) return;
  syncFiltersFromUi(root);
  syncModeUi(root);
  state.loading = true;
  setLoading(root, true);
  setStatus('');

  try {
    syncRoleUi(root);
    const data = await dbApi.getReportsSummary(getReportParams());
    state.latestData = data || {};
    state.canManageAll = Boolean(data.scope?.can_manage_all);
    state.availableUsers = data.scope?.available_users || state.availableUsers;
    renderManagerFilters(root, data.scope || {});
    renderReport(root, data || {});
    restorePendingOverdueContext(root);
    setStatus('');
  } catch (error) {
    setStatus(`Не удалось получить данные отчёта. Техническая причина: ${error.message || 'ошибка API'}.`, true);
    renderErrorState(root);
  } finally {
    state.loading = false;
    setLoading(root, false);
  }
}

function getReportParams() {
  const params = {
    mode: state.mode,
    report_date: state.date,
    year: state.year,
    quarter: state.quarter,
  };

  if (state.canManageAll) {
    if (state.allUsers) {
      params.all = '1';
    } else if (state.selectedUserIds.length) {
      params.user_ids = state.selectedUserIds;
    }
  }

  return params;
}

function renderManagerFilters(root, scope = {}) {
  state.canManageAll = Boolean(scope.can_manage_all);
  state.availableUsers = scope.available_users || state.availableUsers || [];

  root.querySelectorAll('[data-reports-manager-panel]').forEach(node => {
    node.hidden = !state.canManageAll;
  });

  const select = root.querySelector('[data-reports-users]');
  if (!select || !state.canManageAll) return;

  const selectedIds = new Set(
    state.allUsers
      ? []
      : (state.selectedUserIds.length
        ? state.selectedUserIds
        : (scope.selected_users || []).map(user => Number(user.id)))
  );

  select.innerHTML = state.availableUsers.length
    ? state.availableUsers.map(user => `
      <option value="${user.id}" ${selectedIds.has(Number(user.id)) ? 'selected' : ''}>
        ${escapeHtml(formatReportUserLabel(user))}
      </option>
    `).join('')
    : '<option disabled>Сотрудники не найдены</option>';
  select.disabled = state.allUsers;
  state.selectedUserIds = [...select.selectedOptions].map(option => Number(option.value)).filter(Boolean);
  renderReportUserPicker(root);
}

function renderReportUserPicker(root) {
  const optionsNode = root.querySelector('[data-reports-users-options]');
  const labelNode = root.querySelector('[data-reports-users-label]');
  const toggle = root.querySelector('[data-reports-users-toggle]');
  if (!optionsNode || !labelNode) return;

  const selectedIds = new Set(state.selectedUserIds.map(Number));
  optionsNode.innerHTML = state.availableUsers.length
    ? state.availableUsers.map(user => {
      const id = Number(user.id);
      return `
        <label class="reports-user-option">
          <input type="checkbox" data-reports-user-option value="${escapeAttr(id)}" ${selectedIds.has(id) ? 'checked' : ''}>
          <span>${escapeHtml(formatReportUserLabel(user))}</span>
        </label>
      `;
    }).join('')
    : '<div class="reports-user-picker-empty">Сотрудники не найдены</div>';

  const selectedUsers = state.availableUsers.filter(user => selectedIds.has(Number(user.id)));
  labelNode.textContent = selectedUsers.length
    ? selectedUsers.map(formatReportUserLabel).join(', ')
    : 'Выберите сотрудников';
  toggle?.classList.toggle('has-selection', selectedUsers.length > 0);
}

function toggleReportUserPicker(root) {
  const menu = root.querySelector('[data-reports-users-menu]');
  const toggle = root.querySelector('[data-reports-users-toggle]');
  if (!menu || !toggle) return;
  const open = menu.hidden;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

function closeReportUserPicker(root) {
  const menu = root.querySelector('[data-reports-users-menu]');
  const toggle = root.querySelector('[data-reports-users-toggle]');
  if (!menu || !toggle) return;
  menu.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function syncReportUserSelect(root) {
  const select = root.querySelector('[data-reports-users]');
  if (!select) return;
  const selectedIds = new Set(state.selectedUserIds.map(Number));
  [...select.options].forEach(option => {
    option.selected = selectedIds.has(Number(option.value));
  });
  select.disabled = state.allUsers;
}

function renderReport(root, data = {}) {
  const updated = root.querySelector('[data-reports-updated]');
  if (updated) {
    updated.textContent = state.mode === 'day'
      ? `Обновлено: ${formatDateTime(data.updated_at)}. Период: ${formatDate(state.date)}.`
      : `Обновлено: ${formatDateTime(data.updated_at)}. Период: ${quarterLabel(state.quarter)} ${state.year}.`;
  }

  if (state.mode === 'day') {
    renderDailyReport(root, data);
  } else {
    renderQuarterlyReport(root, data);
  }
}

function renderDailyReport(root, data = {}) {
  const daily = getScopedData(data, ['daily', 'day', 'daily_report']) || data;
  const metrics = getMetrics(daily, data);
  const hearings = getRows(daily, data, ['hearings', 'hearings_today', 'day_hearings']);
  const tasks = getRows(daily, data, ['tasks', 'calendar_tasks', 'today_tasks']);
  const employees = getEmployeeCards(daily, data, hearings, tasks);
  const critical = getCriticalPoints(daily, data, employees);

  renderDayKpis(root, metrics, critical.length);
  setText(root.querySelector('[data-reports-hearings-title]'), `Заседания ${formatDate(state.date)}`);
  renderHearings(root, hearings);
  renderEmployeeCards(root, employees);
  renderCriticalPoints(root, critical);
  renderTimeline(root, employees, hearings);
  renderControlled(root, getRows(daily, data, ['controlled_cases', 'nearest_controlled_cases', 'upcoming_controlled_cases']));
}

function renderDayKpis(root, metrics = {}, criticalCount = 0) {
  const items = [
    ['Активные дела', pickMetric(metrics, ['active_cases_day', 'active_cases']), 'за день'],
    ['Заседания', pickMetric(metrics, ['hearings_day', 'hearings_today', 'hearings']), 'за день'],
    ['Задачи выполнено', pickMetric(metrics, ['completed_tasks', 'done_tasks', 'tasks_done']), 'за день'],
    ['Задачи всего', pickMetric(metrics, ['total_tasks', 'calendar_tasks', 'tasks_total']), 'за день'],
    ['Просрочки', pickMetric(metrics, ['overdue_tasks', 'overdue']), 'за день'],
    ['Критические точки', pickMetric(metrics, ['critical_points', 'critical_count'], criticalCount), 'за день'],
  ];

  const node = root.querySelector('[data-reports-day-kpis]');
  if (!node) return;
  node.innerHTML = items.map(([label, value, trend]) => renderKpi(label, value, trend, label.includes('Проср') || label.includes('Крит'))).join('');
}

function renderHearings(root, rows) {
  const node = root.querySelector('[data-reports-hearings]');
  if (!node) return;
  node.innerHTML = rows.length ? rows.map(row => `
    <div class="reports-list-row ${row.conflict || row.has_conflict ? 'is-conflict' : ''}">
      <strong>${escapeHtml(row.time || row.start_time || 'Время не указано')} · ${escapeHtml(row.court || 'Суд не указан')}</strong>
      <span>${escapeHtml(row.subject || row.claim_subject || row.result || 'Предмет не указан')}</span>
      <small>${escapeHtml(row.representative || row.employee || row.case_executor || 'Сотрудник не указан')} · ${escapeHtml(row.case_no || row.court_no || row.case_number || 'Дело не указано')}</small>
      ${(row.conflict || row.has_conflict) ? '<em>Конфликт расписания</em>' : ''}
    </div>
  `).join('') : emptyState('На выбранную дату заседаний нет.');
}

function renderEmployeeCards(root, employees) {
  const node = root.querySelector('[data-reports-employee-cards]');
  if (!node) return;
  state.latestOverdueTasksByUser = new Map();
  state.latestRemainingTasksByUser = new Map();
  node.classList.toggle('is-single', employees.length === 1);
  node.innerHTML = employees.length
    ? employees.map(employee => renderEmployeeCard(employee)).join('')
    : emptyState('Сотрудники по выбранному фильтру не найдены.');
}

function renderEmployeeCard(employee) {
  const status = getEmployeeStatus(employee);
  const doneTasks = getTaskRows(employee, ['done_tasks_list', 'completed_tasks_list', 'completed_tasks', 'done_tasks']);
  const remainingTasks = getTaskRows(employee, ['remaining_tasks', 'open_tasks_list', 'open_tasks']);
  const hearings = getTaskRows(employee, ['hearings', 'day_hearings']);
  const totalTasks = firstNumber(employee.total_tasks, employee.tasks_total, doneTasks.length + remainingTasks.length);
  const completedTasks = firstNumber(employee.completed_tasks_count, employee.done_tasks_count, employee.tasks_done, doneTasks.length);
  const remainingRows = getRemainingTaskRows(employee, remainingTasks);
  const overdueRows = getOverdueTaskRows(employee, remainingTasks);
  const overdueTasks = Math.max(
    firstNumber(employee.overdue_tasks, employee.overdue_tasks_count, overdueRows.length) || 0,
    overdueRows.length
  );
  const employeeKey = getEmployeeKey(employee);
  state.latestOverdueTasksByUser.set(employeeKey, overdueRows);
  state.latestRemainingTasksByUser.set(employeeKey, remainingRows);
  const name = employee.user_name || employee.full_name || employee.name || 'Сотрудник';
  const safeTotal = Math.max(0, Number(totalTasks || 0));
  const safeCompleted = Math.max(0, Number(completedTasks || 0));
  const remainingCount = Math.max(remainingRows.length, safeTotal - safeCompleted, 0);
  const progress = safeTotal ? Math.max(0, Math.min(100, Math.round((safeCompleted / safeTotal) * 100))) : 0;
  const updated = formatEmployeeUpdatedAt(employee);

  return `
    <article class="reports-employee-card status-${status.level}">
      <div class="reports-employee-head">
        <div class="reports-employee-identity">
          <div class="reports-employee-avatar" aria-hidden="true">${escapeHtml(getInitials(name))}</div>
          <div class="reports-employee-title-block">
            <h4>${escapeHtml(name)}</h4>
            <div class="reports-employee-meta">
              <button class="reports-status-chip" type="button" title="${escapeHtml(STATUS_LEGEND)}" aria-label="${escapeHtml(status.text)}. ${escapeHtml(STATUS_LEGEND)}">
                <span aria-hidden="true"></span>
                ${escapeHtml(status.text)}
              </button>
              ${updated ? `<span class="reports-employee-updated">${escapeHtml(updated)}</span>` : ''}
            </div>
          </div>
        </div>
        <button class="reports-overdue-summary ${overdueTasks > 2 ? 'is-critical' : ''}" data-reports-overdue-user="${escapeAttr(employeeKey)}" type="button" aria-label="Открыть просроченные задачи сотрудника ${escapeAttr(name)}">
          <span>
            <b>Просроченные задачи</b>
            <small>Открыть список →</small>
          </span>
          <strong>${formatMaybeNumber(overdueTasks)}</strong>
        </button>
      </div>

      <hr class="reports-employee-divider">

      <div class="reports-employee-middle">
        <section class="reports-employee-section reports-plan-card">
          <h5>Выполнение плана</h5>
          <div class="reports-plan-main">
            <div>
              <strong>${formatMaybeNumber(safeCompleted)} из ${formatMaybeNumber(safeTotal)} задач</strong>
              <p>Выполнено ${progress}% за выбранный период</p>
            </div>
            <span class="reports-plan-percent">${progress}%</span>
          </div>
          <div class="reports-plan-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
          <div class="reports-plan-stats">
            <div><span>Выполнено</span><strong>${formatMaybeNumber(safeCompleted)}</strong></div>
            <div><span>Осталось</span><strong>${formatMaybeNumber(remainingCount)}</strong></div>
          </div>
        </section>

        <section class="reports-employee-section reports-hearings-card">
          <div class="reports-section-title-row">
            <h5>Судебные заседания сегодня</h5>
            <span>${formatMaybeNumber(hearings.length)}</span>
          </div>
          ${hearings.length ? renderEmployeeHearings(hearings) : `
            <div class="reports-hearings-empty">
              <i aria-hidden="true">⚖</i>
              <strong>На сегодня заседаний нет</strong>
              <p>Заседания выбранного сотрудника появятся здесь</p>
            </div>
          `}
        </section>
      </div>

      <div class="reports-employee-tasks-row">
        <div class="reports-task-metric-card is-done" aria-label="Выполненные задачи">
          <span>
            <b>Выполнено</b>
            <small>за выбранный период</small>
          </span>
          <strong>${formatMaybeNumber(safeCompleted)}</strong>
        </div>

        <button class="reports-task-metric-card is-remaining" data-reports-remaining-user="${escapeAttr(employeeKey)}" type="button" aria-label="Открыть оставшиеся задачи сотрудника ${escapeAttr(name)}">
          <span>
            <b>Осталось выполнить</b>
            <small>Открыть список</small>
          </span>
          <strong>${formatMaybeNumber(remainingCount)}</strong>
        </button>
      </div>

      <div class="reports-employee-note">
        <span>Ключевые показатели видны сразу, а задачи сгруппированы по смыслу</span>
      </div>
    </article>
  `;
}

function getInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('');
}

function formatEmployeeUpdatedAt(employee = {}) {
  const value = employee.updated_at || employee.report_updated_at || employee.last_updated_at || '';
  if (!value) return '';
  return `Обновлено ${formatDateTime(value)}`;
}

function renderEmployeeHearings(rows = []) {
  return `<div class="reports-hearing-list">${rows.map(row => `
    <div class="reports-hearing-chip ${row.conflict || row.has_conflict ? 'is-conflict' : ''}">
      <b>${escapeHtml(row.time || row.start_time || '—')}</b>
      <span>${escapeHtml(row.court || row.court_name || 'Суд не указан')}</span>
      <small>${escapeHtml([row.subject || row.claim_subject || row.result || '', row.case_no || row.court_no || row.case_number || ''].filter(Boolean).join(' · ') || 'Данные дела не указаны')}</small>
      ${(row.conflict || row.has_conflict) ? '<em>Конфликт</em>' : ''}
    </div>
  `).join('')}</div>`;
}

function renderEmployeeTaskRows(rows = [], emptyText = 'Задач нет', mode = 'remaining') {
  if (!rows.length) {
    return `<div class="reports-task-empty">${escapeHtml(emptyText)}</div>`;
  }
  return `<div class="reports-task-list">${rows.map(row => {
    const title = row.description || row.desc || row.assignment || row.task_type || row.type || row.subject || 'Задача';
    const due = getTaskDueLabel(row, mode);
    return `
      <div class="reports-task-row" title="${escapeAttr(title)}">
        <strong>${escapeHtml(title)}</strong>
        ${due}
      </div>
    `;
  }).join('')}</div>`;
}

function getTaskDueLabel(row = {}, mode = 'remaining') {
  if (mode === 'done') return '<span class="reports-task-date is-done">Выполнено</span>';
  const key = normalizeReportDateKey(row.date_str || row.date || row.deadline || row.due_date || '');
  const selected = normalizeReportDateKey(state.date || todayIso());
  if (key && key < selected) return '<span class="reports-task-date is-overdue">Просрочено</span>';
  if (key && key === selected) return '<span class="reports-task-date is-today">Сегодня</span>';
  const label = key ? formatDate(key) : '';
  return label ? `<span class="reports-task-date">до ${escapeHtml(label)}</span>` : '<span class="reports-task-date">срок не указан</span>';
}
function renderCriticalPoints(root, rows) {
  const node = root.querySelector('[data-reports-critical]');
  if (!node) return;
  node.innerHTML = rows.length ? rows.map(row => `
    <div class="reports-list-row is-conflict">
      <strong>${escapeHtml(row.type || row.kind || 'Критическая точка')}</strong>
      <span>${escapeHtml(row.employee || row.user_name || row.representative || 'Сотрудник не указан')} · ${escapeHtml(row.time || row.date || '')}</span>
      <p>${escapeHtml(row.reason || row.description || row.message || 'Причина не указана')}</p>
    </div>
  `).join('') : emptyState('Критические точки по выбранной дате не найдены.');
}

function renderTimeline(root, employees, hearings) {
  const node = root.querySelector('[data-reports-timeline]');
  if (!node) return;
  const sourceHearings = uniqueTimelineHearings(filterTimelineHearings(hearings));
  const sourceEmployees = buildTimelineSourceEmployees(employees, sourceHearings);
  if (!sourceEmployees.length) {
    node.innerHTML = emptyState('На выбранную дату судебных заседаний нет');
    return;
  }

  const allHearings = sourceEmployees.flatMap(employee => getTaskRows(employee, ['hearings', 'day_hearings']));
  const minutes = allHearings.map(row => parseTimeMinutes(row.time || row.start_time)).filter(value => value !== null);
  const start = minutes.length ? Math.max(0, Math.min(...minutes) - 60) : 8 * 60;
  const end = minutes.length ? Math.min(24 * 60, Math.max(...minutes) + 90) : 18 * 60;
  const span = Math.max(end - start, 60);

  node.innerHTML = `
    <div class="reports-timeline-scale">
      <span>${formatTime(start)}</span>
      <span>${formatTime(start + span / 2)}</span>
      <span>${formatTime(end)}</span>
    </div>
    ${sourceEmployees.map(employee => {
      const employeeHearings = getTaskRows(employee, ['hearings', 'day_hearings']);
      return `
        <div class="reports-timeline-row">
          <strong>${escapeHtml(employee.user_name || employee.full_name || employee.name || 'Сотрудник')}</strong>
          <div class="reports-timeline-track">
            ${employeeHearings.map(row => {
              const value = parseTimeMinutes(row.time || row.start_time);
              const left = value === null ? 0 : Math.max(0, Math.min(100, ((value - start) / span) * 100));
              const details = formatTimelineHearingDetails(row, employee);
              return `
                <span class="reports-timeline-item ${row.conflict || row.has_conflict ? 'is-conflict' : ''}" style="left:${left}%">
                  <b>${escapeHtml(row.time || row.start_time || '—')}</b>
                  ${escapeHtml(row.court || row.court_name || 'Суд')}
                  <small>${escapeHtml(details)}</small>
                </span>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function buildTimelineSourceEmployees(employees = [], hearings = []) {
  const employeeRows = employees.length ? employees : getSelectedReportUsersForTimeline();
  if (!employeeRows.length) return buildTimelineEmployees(hearings);

  const rows = employeeRows
    .map(employee => {
      const currentHearings = getTaskRows(employee, ['hearings', 'day_hearings']);
      if (currentHearings.length) {
        return { ...employee, hearings: uniqueTimelineHearings(filterTimelineHearings(currentHearings)) };
      }
      const name = employee.user_name || employee.full_name || employee.name || employee.representative || '';
      const matchedHearings = hearings.filter(row => matchesPerson(row, name, employee));
      return { ...employee, hearings: matchedHearings };
    })
    .filter(employee => getTaskRows(employee, ['hearings', 'day_hearings']).length);

  return rows.length ? rows : buildTimelineEmployees(hearings);
}

function filterTimelineHearings(rows = []) {
  const selectedDate = normalizeReportDateKey(state.date || todayIso());
  return (rows || []).filter(row => {
    const rowDate = normalizeReportDateKey(
      row.session_date || row.hearing_date || row.hearingDate || row.event_date || row.date || row.date_str || row.datetime
    );
    if (!rowDate) return true;
    return rowDate === selectedDate;
  });
}

function uniqueTimelineHearings(rows = []) {
  const seen = new Set();
  return (rows || []).filter(row => {
    const key = [
      row.id || row.schedule_id || row.hearing_id,
      row.general_case_id || row.case_id,
      row.session_date || row.hearing_date || row.hearingDate || row.event_date || row.date || row.date_str || row.datetime,
      row.time || row.start_time,
      row.court || row.court_name,
      row.representative || row.employee || row.case_executor,
    ].map(value => String(value || '').trim()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSelectedReportUsersForTimeline() {
  if (state.allUsers || !state.selectedUserIds.length) return [];
  const selectedIds = new Set(state.selectedUserIds.map(Number));
  return state.availableUsers.filter(user => selectedIds.has(Number(user.id || user.user_id)));
}

function formatTimelineHearingDetails(row = {}, employee = {}) {
  const employeeName = employee.user_name || employee.full_name || employee.name || getPrimaryPersonName(row);
  const caseNumber = row.case_number || row.case_no || row.court_case_number || row.pk_number || row.general_case_number || '';
  const subject = row.subject || row.claim_subject || row.result || row.description || row.desc || '';
  return [employeeName, caseNumber, subject].filter(Boolean).join(' · ');
}

function renderControlled(root, rows) {
  const node = root.querySelector('[data-reports-controlled]');
  if (!node) return;
  node.innerHTML = rows.length ? rows.map(row => {
    const id = getControlledCaseId(row);
    const tag = id ? 'button' : 'div';
    const attrs = id
      ? `type="button" data-reports-controlled-id="${escapeAttr(id)}" title="Открыть в перечне контрольных дел"`
      : '';
    return `
    <${tag} class="reports-list-row reports-controlled-row" ${attrs}>
      <strong>${escapeHtml(row.case_number || row.court_case_number || row.case_no || 'Без номера')}</strong>
      <span>${escapeHtml(row.representative || row.executor || 'Сотрудник не указан')}</span>
      <small>${escapeHtml(row.deadline || row.control_date || row.updated_at || '')}</small>
      <p>${escapeHtml(row.subject || row.result || '')}</p>
    </${tag}>
  `;
  }).join('') : emptyState('Ближайшие контрольные дела отсутствуют.');
}

function getControlledCaseId(row = {}) {
  return row.id || row.controlled_case_id || row.case_id || row.control_id || '';
}

function openControlledCaseFromReport(id) {
  const safeId = Number(id);
  if (!safeId) return;
  try {
    window.sessionStorage?.setItem('legal-dashboard-open-controlled-case-id', String(safeId));
    window.sessionStorage?.setItem('legal-dashboard-open-controlled-case-return-view', 'reports');
  } catch {}
  window.openView?.('controlledCases');
  window.dispatchEvent(new CustomEvent('reports:open-controlled-case', { detail: { id: safeId, sourceView: 'reports' } }));
}

function getEmployeeKey(employee = {}) {
  return String(employee.user_id || employee.id || employee.user_name || employee.full_name || employee.name || '').trim();
}

function getOverdueTaskRows(employee = {}, remainingTasks = []) {
  const direct = getTaskRows(employee, ['overdue_tasks_list', 'overdue_task_rows', 'expired_tasks']);
  if (direct.length) return uniqueOverdueTaskRows(direct.filter(isActiveOverdueTask));
  const selectedDate = String(state.date || todayIso());
  return uniqueOverdueTaskRows((remainingTasks || []).filter(task => {
    const dateValue = String(task.date_str || task.date || task.deadline || task.due_date || '').slice(0, 10);
    if (!dateValue) return false;
    return normalizeReportDateKey(dateValue) < selectedDate && isActiveOverdueTask(task);
  }));
}

function getRemainingTaskRows(employee = {}, remainingTasks = []) {
  const direct = getTaskRows(employee, ['remaining_tasks', 'open_tasks_list', 'open_tasks']);
  const rows = direct.length ? direct : remainingTasks;
  return uniqueOverdueTaskRows((rows || []).filter(isActiveOverdueTask));
}

function isActiveOverdueTask(task = {}) {
  if (Number(task.done || task.completed || task.is_done || 0) === 1) return false;
  const status = String(task.status || task.state || '').toLowerCase();
  return !['done', 'completed', 'cancelled', 'canceled', 'deleted', 'выполнено', 'отменено', 'удалено'].includes(status);
}

function uniqueOverdueTaskRows(rows = []) {
  const seen = new Set();
  return rows.filter(row => {
    const key = [
      row.id,
      row.general_case_id || row.case_id,
      row.description || row.desc || row.assignment || row.title,
      row.deadline || row.due_date || row.date || row.date_str,
    ].map(value => String(value || '').trim()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openOverdueTasksDialog(userKey = '') {
  const root = document.querySelector('[data-reports-root]');
  if (!root) return;
  state.openOverdueUserKey = String(userKey || '').trim();
  state.openTaskListKind = 'overdue';
  const tasks = state.latestOverdueTasksByUser.get(String(userKey || '').trim()) || [];
  let dialog = root.querySelector('[data-reports-overdue-dialog]');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'reports-overdue-dialog';
    dialog.dataset.reportsOverdueDialog = '';
    root.append(dialog);
  }
  dialog.innerHTML = `
    <div class="reports-overdue-dialog-head">
      <div>
        <h3>Просроченные задачи</h3>
        <p>Выберите задачу, чтобы открыть связанное дело в общем перечне.</p>
      </div>
      <button class="icon-button" type="button" data-reports-overdue-close>×</button>
    </div>
    <div class="reports-overdue-list">
      ${tasks.length ? tasks.map(task => renderOverdueTaskRow(task)).join('') : '<div class="reports-empty">Просроченных задач по сотруднику не найдено.</div>'}
    </div>
    <div class="reports-overdue-actions">
      <button class="btn primary" type="button" data-reports-overdue-close>Закрыть</button>
    </div>
  `;
  dialog.querySelectorAll('[data-reports-overdue-close]').forEach(button => {
    button.addEventListener('click', () => dialog.close(), { once: true });
  });
  dialog.addEventListener('click', event => {
    const task = event.target.closest('[data-reports-overdue-task]');
    if (task) {
      dialog.close();
      openGeneralCaseFromReport(task.dataset.reportsOverdueTask, userKey, 'overdue');
    }
  }, { once: true });
  if (!dialog.open) dialog.showModal();
}

function openRemainingTasksDialog(userKey = '') {
  const root = document.querySelector('[data-reports-root]');
  if (!root) return;
  state.openOverdueUserKey = String(userKey || '').trim();
  state.openTaskListKind = 'remaining';
  const tasks = state.latestRemainingTasksByUser.get(String(userKey || '').trim()) || [];
  let dialog = root.querySelector('[data-reports-remaining-dialog]');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'reports-overdue-dialog reports-remaining-dialog';
    dialog.dataset.reportsRemainingDialog = '';
    root.append(dialog);
  }
  dialog.innerHTML = `
    <div class="reports-overdue-dialog-head">
      <div>
        <h3>Осталось выполнить</h3>
        <p>Выберите задачу, чтобы открыть связанное дело в общем перечне.</p>
      </div>
      <button class="icon-button" type="button" data-reports-remaining-close>×</button>
    </div>
    <div class="reports-overdue-list">
      ${tasks.length ? tasks.map(task => renderRemainingTaskRow(task)).join('') : '<div class="reports-empty">Оставшиеся задачи по сотруднику не найдены.</div>'}
    </div>
    <div class="reports-overdue-actions">
      <button class="btn primary" type="button" data-reports-remaining-close>Закрыть</button>
    </div>
  `;
  dialog.querySelectorAll('[data-reports-remaining-close]').forEach(button => {
    button.addEventListener('click', () => dialog.close(), { once: true });
  });
  dialog.addEventListener('click', event => {
    const task = event.target.closest('[data-reports-remaining-task]');
    if (task) {
      dialog.close();
      openGeneralCaseFromReport(task.dataset.reportsRemainingTask, userKey, 'remaining');
    }
  }, { once: true });
  if (!dialog.open) dialog.showModal();
}

function renderOverdueTaskRow(task = {}) {
  const generalCaseId = task.general_case_id || task.generalCaseId || task.linked_general_case_id || task.case_id || '';
  const attrs = `type="button" data-reports-overdue-task="${escapeAttr(generalCaseId)}"`;
  const title = task.description || task.desc || task.assignment || task.title || 'Задача';
  const date = task.date_str || task.date || task.deadline || task.due_date || '';
  const time = task.time || task.start_time || '';
  const status = task.status || (Number(task.done || task.completed || 0) ? 'Выполнено' : 'В работе');
  const priority = task.priority || task.importance || '';
  const linkedCase = task.case_title || task.case_name || task.general_case_title || '';
  const caseNumber = task.case_no || task.linked_case_no || task.court_no || task.linked_court_no || task.case_number || task.pk_number || '';
  const meta = [
    date ? `Срок: ${formatDate(date)}` : 'Срок не указан',
    time ? `Время: ${time}` : '',
    status ? `Статус: ${status}` : '',
    priority ? `Приоритет: ${priority}` : '',
  ].filter(Boolean).join(' · ');
  const caseMeta = [linkedCase, caseNumber].filter(Boolean).join(' · ');
  return `<button class="reports-overdue-row ${generalCaseId ? '' : 'is-unlinked'}" ${attrs}>
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(meta)}</span>
    <small>${escapeHtml(caseMeta || task.subject || '')}</small>
    <em>${generalCaseId ? 'Открыть дело' : 'Нет связи с делом'}</em>
  </button>`;
}

function renderRemainingTaskRow(task = {}) {
  const generalCaseId = task.general_case_id || task.generalCaseId || task.linked_general_case_id || task.case_id || '';
  const title = task.description || task.desc || task.assignment || task.title || 'Задача';
  const date = task.date_str || task.date || task.deadline || task.due_date || '';
  const time = task.time || task.start_time || '';
  const status = task.status || (Number(task.done || task.completed || 0) ? 'Выполнено' : 'В работе');
  const linkedCase = task.case_title || task.case_name || task.general_case_title || '';
  const caseNumber = task.case_no || task.linked_case_no || task.court_no || task.linked_court_no || task.case_number || task.pk_number || '';
  const meta = [
    date ? `Срок: ${formatDate(date)}` : 'Срок не указан',
    time ? `Время: ${time}` : '',
    status ? `Статус: ${status}` : '',
  ].filter(Boolean).join(' · ');
  const caseMeta = [linkedCase, caseNumber].filter(Boolean).join(' · ');
  return `<button class="reports-overdue-row ${generalCaseId ? '' : 'is-unlinked'}" type="button" data-reports-remaining-task="${escapeAttr(generalCaseId)}">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(meta)}</span>
    <small>${escapeHtml(caseMeta || task.subject || '')}</small>
    <em>${generalCaseId ? 'Открыть дело' : 'Нет связи с делом'}</em>
  </button>`;
}

function openGeneralCaseFromReport(id, userKey = '', listKind = '') {
  const safeId = Number(id);
  if (!safeId) {
    setStatus('У задачи нет связи с делом из общего перечня.', true);
    return;
  }
  saveReportsReturnContext(userKey, listKind);
  window.openView?.('cases');
  window.dispatchEvent(new CustomEvent('general-cases:open-case', {
    detail: { id: safeId, sourceView: 'reports' }
  }));
}

function saveReportsReturnContext(userKey = '', listKind = '') {
  try {
    window.sessionStorage?.setItem('legal-dashboard-reports-return-context', JSON.stringify({
      mode: state.mode,
      date: state.date,
      year: state.year,
      quarter: state.quarter,
      selectedUserIds: state.selectedUserIds,
      allUsers: state.allUsers,
      overdueUserKey: String(userKey || state.openOverdueUserKey || '').trim(),
      taskListKind: listKind || state.openTaskListKind || 'overdue',
      scrollY: window.scrollY || 0,
    }));
  } catch {}
}

function restorePendingOverdueContext(root) {
  let context = null;
  try {
    const raw = window.sessionStorage?.getItem('legal-dashboard-reports-return-context');
    if (!raw) return;
    context = JSON.parse(raw);
    window.sessionStorage?.removeItem('legal-dashboard-reports-return-context');
  } catch {
    return;
  }
  if (!context || context.mode !== 'day') return;
  const userKey = String(context.overdueUserKey || '').trim();
  const listKind = context.taskListKind === 'remaining' ? 'remaining' : 'overdue';
  if (userKey) {
    setTimeout(() => {
      if (listKind === 'remaining' && state.latestRemainingTasksByUser.has(userKey)) {
        openRemainingTasksDialog(userKey);
        return;
      }
      if (state.latestOverdueTasksByUser.has(userKey)) openOverdueTasksDialog(userKey);
    }, 0);
  }
  if (Number.isFinite(Number(context.scrollY))) {
    setTimeout(() => window.scrollTo({ top: Number(context.scrollY), behavior: 'auto' }), 0);
  }
}

function renderQuarterlyReport(root, data = {}) {
  const quarter = getScopedData(data, ['quarterly', 'quarter', 'quarter_report', 'quarterly_summary']) || data;
  const metrics = getMetrics(quarter, data);
  const categories = normalizeCategoryRows(getRows(quarter, data, [
    'categories',
    'category_breakdown',
    'cases_by_category',
    'structure.categories',
    'case_structure.categories',
  ]));
  const structureRows = normalizeStructureRows(getRows(quarter, data, [
    'structure_rows',
    'structure.items',
    'case_structure.items',
    'category_subjects',
    'subjects',
  ]), categories);

  state.latestData = data;
  state.latestCategoryRows = categories;
  state.latestStructureRows = sortStructureRows(structureRows);
  if (!state.selectedCategory && categories.length) {
    state.selectedCategory = categories[0].category;
  }

  renderQuarterInflow(root, metrics, categories, quarter, data);
  renderExecutorReport(root, getRows(quarter, data, ['executor_report', 'by_executor', 'executor_categories']));
  renderQuarterTotals(root, quarter, data, metrics);
  renderStructureChart(root);
  renderStructureBreakdown(root);
  renderStructureTable(root);
}

function renderQuarterInflow(root, metrics, categories, quarter = {}, data = {}) {
  const node = root.querySelector('[data-reports-quarter-inflow]');
  if (!node) return;
  const quarterCount = pickMetric(metrics, ['cases_received_quarter', 'cases_this_quarter', 'received_quarter']);
  const ytdCount = pickMetric(metrics, ['cases_received_ytd', 'cases_ytd', 'received_ytd']);
  const monthRows = getQuarterMonthRows(quarter, data, metrics);
  const total = monthRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const previousTotal = monthRows.reduce((sum, row) => sum + Number(row.previous_count || 0), 0);
  const maxValue = Math.max(...monthRows.flatMap(row => [Number(row.count || 0), Number(row.previous_count || 0)]), 1);
  const peak = monthRows.reduce((best, row) => Number(row.count || 0) > Number(best.count || 0) ? row : best, monthRows[0] || {});
  const avg = monthRows.length ? total / monthRows.length : 0;
  const totalDynamics = previousTotal ? Math.round(((total - previousTotal) / previousTotal) * 100) : null;

  node.innerHTML = `
    <div class="reports-inflow-main">
      <div>
        <span>За выбранный квартал</span>
        <strong>${formatMaybeNumber(total || quarterCount)}</strong>
      </div>
      <div>
        <span>С начала года</span>
        <strong>${formatMaybeNumber(ytdCount)}</strong>
      </div>
      <div>
        <span>Динамика</span>
        <strong>${formatDynamics(totalDynamics)}</strong>
      </div>
    </div>
    ${monthRows.length ? `
      <div class="reports-quarter-bars">
        ${monthRows.map(row => {
          const value = Number(row.count || 0);
          const previous = Number(row.previous_count || 0);
          const width = Math.max(value ? 8 : 0, Math.round((value / maxValue) * 100));
          const previousLeft = Math.max(0, Math.min(100, Math.round((previous / maxValue) * 100)));
          return `
            <div class="reports-quarter-bar-row">
              <span class="reports-quarter-month">${escapeHtml(row.label || getQuarterMonthLabel(row.month))}</span>
              <div class="reports-quarter-track">
                <span class="reports-quarter-previous" style="left:${previousLeft}%"></span>
                <span class="reports-quarter-current" style="width:${width}%">
                  <b>${formatMaybeNumber(value)}</b>
                </span>
              </div>
              <strong class="${Number(row.dynamics_percent) < 0 ? 'is-negative' : ''}">${formatDynamics(row.dynamics_percent)}</strong>
            </div>
          `;
        }).join('')}
      </div>
      <div class="reports-quarter-bars-foot">
        <span>Пиковый месяц: <b>${escapeHtml(peak?.label || getQuarterMonthLabel(peak?.month))}</b></span>
        <span>Среднее: <b>${avg.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</b></span>
      </div>
    ` : emptyState('Нет помесячных данных за выбранный квартал.')}
    <div class="reports-category-chips">
      ${categories.length ? categories.map(row => `
        <button type="button" data-reports-category="${escapeAttr(row.category)}" class="${row.category === state.selectedCategory ? 'active' : ''}">
          <span>${escapeHtml(row.category)}</span>
          <b>${formatMaybeNumber(row.count)}</b>
        </button>
      `).join('') : emptyState('Нет данных по категориям за выбранный период.')}
    </div>
  `;
}

function getQuarterMonthRows(quarter = {}, data = {}, metrics = {}) {
  const rows = getRows(quarter, data, ['quarter_months', 'monthly_inflow', 'month_breakdown']);
  if (rows.length) {
    return rows.map(row => ({
      month: Number(row.month || row.month_number || 0),
      label: row.label || row.month_name || getQuarterMonthLabel(row.month || row.month_number),
      count: Number(row.count ?? row.current_count ?? row.value ?? 0),
      previous_count: Number(row.previous_count ?? row.previous_year_count ?? row.previous ?? 0),
      dynamics_percent: row.dynamics_percent ?? row.dynamic_percent ?? row.delta_percent ?? null,
    }));
  }

  const total = pickMetric(metrics, ['cases_received_quarter', 'cases_this_quarter', 'received_quarter']);
  if (total === null || total === undefined || Number(total) === 0) return [];
  return getQuarterMonthIndexes(state.quarter).map(month => ({
    month,
    label: getQuarterMonthLabel(month),
    count: 0,
    previous_count: 0,
    dynamics_percent: null,
  }));
}

function getQuarterMonthIndexes(quarter) {
  const value = Math.min(4, Math.max(1, Number(quarter) || 1));
  const start = (value - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

function getQuarterMonthLabel(month) {
  const value = Number(month || 0);
  if (value < 1 || value > 12) return '';
  return new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(state.year, value - 1, 1));
}

function formatDynamics(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toLocaleString('ru-RU')}%`;
}
function renderExecutorReport(root, rows) {
  const node = root.querySelector('[data-reports-executor-report]');
  if (!node) return;
  node.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${escapeHtml(row.executor || row.user_name || row.employee || 'Не указан')}</td>
      <td>${escapeHtml(row.category || row.dispute_category || 'Без категории')}</td>
      <td>${formatMaybeNumber(row.quarter_count ?? row.count_quarter ?? row.current_quarter ?? row.count)}</td>
      <td>${formatMaybeNumber(row.ytd_count ?? row.count_ytd ?? row.year_to_date)}</td>
    </tr>
  `).join('') : '<tr><td colspan="4">Нет данных по исполнителям за выбранный период.</td></tr>';
}

function renderQuarterTotals(root, quarter, data, metrics) {
  const node = root.querySelector('[data-reports-quarter-totals]');
  if (!node) return;
  const totals = getRows(quarter, data, ['department_totals', 'general_totals', 'totals']);
  if (totals.length) {
    node.innerHTML = totals.map(renderTotalRow).join('');
    return;
  }

  const appeals = firstObject(quarter, ['appeals_breakdown', 'appeals'])
    || firstObject(data, ['appeals_breakdown', 'appeals'])
    || {};
  const prosecutor = firstObject(quarter, ['prosecutor_claims'])
    || firstObject(data, ['prosecutor_claims'])
    || {};
  const historyMessage = data.previous_year_available === false || quarter.previous_year_available === false
    ? DEFAULT_PREVIOUS_YEAR_MESSAGE
    : '—';

  node.innerHTML = [
    renderTotalRow({
      label: 'Количество судебных заседаний',
      value: pickMetric(metrics, ['hearings_quarter', 'hearing_facts', 'hearings_count']),
      dynamics: historyMessage,
    }),
    renderTotalRow({
      label: 'Обжалование',
      value: pickMetric(metrics, ['appeals_total', 'appeals_count']),
      dynamics: historyMessage,
      details: normalizeAppealRows(appeals),
    }),
    renderTotalRow({
      label: 'Количество исковых заявлений, поданных прокурором',
      value: pickMetric(metrics, ['prosecutor_claims', 'prosecutor_claims_count']),
      dynamics: historyMessage,
      details: normalizeProsecutorRows(prosecutor).filter(row => Number(row.count || 0) > 0),
    }),
  ].join('');
}

function renderTotalRow(row = {}) {
  const details = Array.isArray(row.details) && row.details.length
    ? `<details class="reports-row-details"><summary>Разбивка</summary>${row.details.map(item => `
        <div><span>${escapeHtml(item.label || item.category || item.type || 'Показатель')}</span><b>${formatMaybeNumber(item.count ?? item.value)}</b></div>
      `).join('')}</details>`
    : '';
  return `
    <tr>
      <td>${escapeHtml(row.label || row.metric || row.name || 'Показатель')}${details}</td>
      <td>${formatMaybeNumber(row.value ?? row.count)}</td>
      <td>${escapeHtml(row.dynamics || row.delta_label || row.previous_year_message || DEFAULT_PREVIOUS_YEAR_MESSAGE)}</td>
    </tr>
  `;
}

function renderStructureChart(root) {
  const node = root.querySelector('[data-reports-structure-chart]');
  if (!node) return;
  const rows = state.latestCategoryRows;
  const max = Math.max(...rows.map(row => Number(row.count || 0)), 1);
  node.innerHTML = rows.length ? rows.map(row => {
    const width = Math.max(4, Math.round((Number(row.count || 0) / max) * 100));
    return `
      <button type="button" class="reports-bar-row ${row.category === state.selectedCategory ? 'active' : ''}" data-reports-category="${escapeAttr(row.category)}">
        <span class="reports-bar-label">${escapeHtml(row.category)}</span>
        <span class="reports-bar-track"><span style="width:${width}%"></span></span>
        <b>${formatMaybeNumber(row.count)}</b>
      </button>
    `;
  }).join('') : emptyState('Нет данных по структуре дел за выбранный период.');
}

function renderStructureBreakdown(root) {
  const node = root.querySelector('[data-reports-subject-breakdown]');
  if (!node) return;
  const rows = state.latestStructureRows.filter(row => !state.selectedCategory || row.category === state.selectedCategory);
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const topRows = rows.slice(0, 6);
  const otherCount = rows.slice(6).reduce((sum, row) => sum + Number(row.count || 0), 0);
  node.innerHTML = `
    <h4>${escapeHtml(state.selectedCategory || 'Предметы спора')}</h4>
    ${topRows.length ? topRows.map(row => `
      <div class="reports-subject-row">
        <span title="${escapeAttr(row.subject)}">${escapeHtml(row.subject)}</span>
        <b>${formatMaybeNumber(row.count)}</b>
      </div>
    `).join('') : '<div class="reports-empty compact">Нет предметов по выбранной категории.</div>'}
    ${otherCount ? `<div class="reports-subject-row is-muted"><span>Прочие</span><b>${formatMaybeNumber(otherCount)}</b></div>` : ''}
    ${total ? `<p class="muted">Всего по категории: ${formatMaybeNumber(total)}</p>` : ''}
  `;
}

function renderStructureTable(root) {
  const node = root.querySelector('[data-reports-structure-rows]');
  if (!node) return;
  const period = `${quarterLabel(state.quarter)} ${state.year}`;
  node.innerHTML = state.latestStructureRows.length ? state.latestStructureRows.map(row => `
    <tr>
      <td>${escapeHtml(row.category)}</td>
      <td>${escapeHtml(row.subject)}</td>
      <td>${formatMaybeNumber(row.count)}</td>
      <td>${formatPercent(row.share)}</td>
      <td>${escapeHtml(row.period || period)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5">Нет данных для таблицы структуры дел за выбранный период.</td></tr>';
}

function getEmployeeCards(scoped, data, hearings, tasks) {
  const direct = getRows(scoped, data, ['employee_cards', 'employees', 'employee_statuses']);
  if (direct.length) return direct;

  const workload = getRows(scoped, data, ['workload']);
  return workload.map(row => {
    const name = row.user_name || row.full_name || row.name || '';
    const employeeHearings = hearings.filter(hearing => matchesPerson(hearing, name, row));
    const employeeTasks = tasks.filter(task => matchesPerson(task, name, row));
    return {
      ...row,
      hearings: employeeHearings,
      done_tasks_list: employeeTasks.filter(task => Number(task.done || task.completed || 0) === 1),
      remaining_tasks: employeeTasks.filter(task => Number(task.done || task.completed || 0) !== 1),
      total_tasks: row.total_tasks ?? employeeTasks.length,
      completed_tasks_count: row.completed_tasks_count ?? employeeTasks.filter(task => Number(task.done || task.completed || 0) === 1).length,
    };
  });
}

function getEmployeeStatus(employee) {
  const apiLevel = employee.status_level || employee.status_color || employee.status;
  if (apiLevel && ['green', 'yellow', 'red'].includes(String(apiLevel).toLowerCase())) {
    return {
      level: String(apiLevel).toLowerCase(),
      text: employee.status_text || statusText(apiLevel),
      reasons: normalizeReasons(employee.status_reasons || employee.reasons || employee.status_reason),
    };
  }

  const hearings = firstNumber(employee.hearings_count, employee.hearings_today, getTaskRows(employee, ['hearings', 'day_hearings']).length);
  const overdueActs = firstNumber(employee.overdue_judicial_acts, employee.overdue_acts, 0);
  const overdueTasks = firstNumber(employee.overdue_tasks, employee.overdue_tasks_count, 0);
  const conflicts = firstNumber(employee.conflicts_count, employee.schedule_conflicts, 0);
  const loadPercent = Number(employee.load_percent || employee.plan_percent || 0);

  if (hearings >= 5 || overdueActs > 0 || conflicts > 0) {
    return {
      level: 'red',
      text: 'Критично',
      reasons: [
        hearings >= 5 ? `${hearings} заседаний за день` : '',
        overdueActs > 0 ? `${overdueActs} просроченных судебных актов` : '',
        conflicts > 0 ? `${conflicts} конфликтов расписания` : '',
      ].filter(Boolean),
    };
  }

  if (hearings >= 3 || loadPercent > 120) {
    return {
      level: 'yellow',
      text: 'Повышенная нагрузка',
      reasons: [
        hearings >= 3 ? `${hearings} заседания за день` : '',
        loadPercent > 120 ? `нагрузка ${loadPercent}% от плана` : '',
      ].filter(Boolean),
    };
  }

  return {
    level: 'green',
    text: 'В норме',
      reasons: overdueTasks > 0 ? [`${overdueTasks} просроченных задач`] : ['0–2 заседания, критические признаки не указаны'],
  };
}

function getCriticalPoints(scoped, data, employees) {
  const direct = getRows(scoped, data, ['critical_points', 'critical', 'risks']);
  if (direct.length) return direct;
  return employees.flatMap(employee => {
    const status = getEmployeeStatus(employee);
    if (status.level !== 'red') return [];
    return status.reasons.map(reason => ({
      type: reason.includes('судеб') ? 'Просроченный судебный акт' : 'Критическая перегрузка',
      employee: employee.user_name || employee.full_name || employee.name,
      time: formatDate(state.date),
      reason,
    }));
  });
}

function normalizeCategoryRows(rows) {
  return rows.map(row => ({
    category: String(row.category || row.name || row.label || 'Без категории'),
    count: Number(row.count ?? row.value ?? row.quarter_count ?? 0),
    ytd: row.ytd_count ?? row.year_to_date,
  })).filter(row => row.category);
}

function normalizeStructureRows(rows, categories) {
  const normalized = rows.map(row => ({
    category: String(row.category || row.dispute_category || 'Без категории'),
    subject: String(row.subject || row.claim_subject || row.name || 'Без предмета'),
    count: Number(row.count ?? row.value ?? 0),
    share: Number(row.share ?? row.percent ?? 0),
    period: row.period || '',
  })).filter(row => row.category);

  if (normalized.length) return normalized;
  const total = categories.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return categories.map(row => ({
    category: row.category,
      subject: 'Предметы спора не детализированы',
    count: row.count,
    share: total ? (Number(row.count || 0) / total) * 100 : 0,
    period: '',
  }));
}

function sortStructureRows(rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const withShare = rows.map(row => ({
    ...row,
    share: row.share || (total ? (Number(row.count || 0) / total) * 100 : 0),
  }));
  if (state.structureSort === 'category') {
    return withShare.sort((a, b) => String(a.category).localeCompare(String(b.category), 'ru') || Number(b.count || 0) - Number(a.count || 0));
  }
  return withShare.sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.category).localeCompare(String(b.category), 'ru'));
}

function normalizeAppealRows(appeals = {}) {
  if (Array.isArray(appeals)) return appeals;
  return [
    ['Апелляционные жалобы', appeals.appeal ?? appeals.appeals],
    ['Кассационные жалобы', appeals.cassation],
    ['Кассационные жалобы в Верховный Суд РФ', appeals.supreme_court ?? appeals.supreme],
    ['Жалобы в Конституционный Суд РФ', appeals.constitutional_court ?? appeals.constitutional],
  ].map(([label, count]) => ({ label, count }));
}

function normalizeProsecutorRows(prosecutor = {}) {
  if (Array.isArray(prosecutor)) return prosecutor;
  if (Array.isArray(prosecutor.by_category)) return prosecutor.by_category;
  return [];
}

async function copyReportBlock(kind, root) {
  const chartBlob = kind !== 'table' ? await createChartPngBlob() : null;
  const tableHtml = kind !== 'chart' ? buildStructureTableHtml(root) : '';
  const tsv = kind !== 'chart' ? buildStructureTsv(root) : '';

  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      const payload = {};
      if (chartBlob) payload['image/png'] = chartBlob;
      if (tableHtml) payload['text/html'] = new Blob([tableHtml], { type: 'text/html' });
      if (tsv) payload['text/plain'] = new Blob([tsv], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem(payload)]);
      setStatus('Данные скопированы в буфер обмена.');
      return;
    }

    if (navigator.clipboard?.writeText && tsv) {
      await navigator.clipboard.writeText(tsv);
      if (chartBlob) downloadBlob(chartBlob, 'reports-structure-chart.png');
      setStatus('Clipboard API для изображений недоступен. Таблица скопирована текстом, диаграмма скачана PNG.');
      return;
    }
  } catch (error) {
    if (chartBlob) downloadBlob(chartBlob, 'reports-structure-chart.png');
    if (tsv) fallbackCopyText(tsv);
    setStatus(`Не удалось выполнить прямое копирование. Использован fallback. ${error?.message || ''}`.trim(), true);
    return;
  }

  if (chartBlob) downloadBlob(chartBlob, 'reports-structure-chart.png');
  if (tsv) fallbackCopyText(tsv);
  setStatus('Clipboard API недоступен. PNG скачан, текст подготовлен для ручного копирования.', true);
}

function createChartPngBlob() {
  return new Promise(resolve => {
    const rows = state.latestCategoryRows;
    const width = 960;
    const height = Math.max(260, 90 + rows.length * 52);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#10233f';
    ctx.font = '700 24px Arial, sans-serif';
    ctx.fillText('Структура судебных дел по категориям', 32, 42);

    const max = Math.max(...rows.map(row => Number(row.count || 0)), 1);
    rows.forEach((row, index) => {
      const y = 82 + index * 52;
      const barWidth = Math.round((Number(row.count || 0) / max) * 520);
      ctx.fillStyle = '#4f6481';
      ctx.font = '600 16px Arial, sans-serif';
      ctx.fillText(truncateText(row.category, 38), 32, y + 19);
      ctx.fillStyle = '#e7eef9';
      ctx.fillRect(360, y, 540, 24);
      ctx.fillStyle = '#2457d6';
      ctx.fillRect(360, y, Math.max(8, barWidth), 24);
      ctx.fillStyle = '#10233f';
      ctx.font = '700 16px Arial, sans-serif';
      ctx.fillText(String(row.count || 0), 916, y + 18);
    });

    canvas.toBlob(blob => resolve(blob), 'image/png');
  });
}

function buildStructureTableHtml(root) {
  const table = root.querySelector('[data-reports-structure-table]');
  if (!table) return '';
  return `
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;background:#fff;color:#111;">
      ${table.innerHTML}
    </table>
  `;
}

function buildStructureTsv(root) {
  const rows = [...root.querySelectorAll('[data-reports-structure-table] tr')];
  return rows.map(row => [...row.children].map(cell => cell.textContent.trim()).join('\t')).join('\n');
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  try { document.execCommand('copy'); } catch {}
  textarea.remove();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderKpi(label, value, trend, attention = false) {
  return `
    <article class="panel reports-kpi ${attention ? 'reports-kpi-attention' : ''}">
      <div class="reports-kpi-top">
        <span class="reports-kpi-trend">${escapeHtml(trend)}</span>
      </div>
      <strong>${formatMaybeNumber(value)}</strong>
      <span class="reports-kpi-label">${escapeHtml(label)}</span>
    </article>
  `;
}

function getRows(scoped, root, keys) {
  for (const key of keys) {
    const scopedValue = readPath(scoped, key);
    if (Array.isArray(scopedValue)) return scopedValue;
    const rootValue = readPath(root, key);
    if (Array.isArray(rootValue)) return rootValue;
  }
  return [];
}

function getScopedData(data, keys) {
  for (const key of keys) {
    const value = readPath(data, key);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function getMetrics(scoped, data) {
  return {
    ...(data?.metrics || {}),
    ...(data?.kpis || {}),
    ...(scoped?.metrics || {}),
    ...(scoped?.kpis || {}),
  };
}

function pickMetric(metrics, keys, fallback = null) {
  for (const key of keys) {
    if (metrics?.[key] !== undefined && metrics?.[key] !== null) return metrics[key];
  }
  return fallback;
}

function firstObject(source, keys) {
  for (const key of keys) {
    const value = readPath(source, key);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function readPath(source, path) {
  if (!source || !path) return undefined;
  return String(path).split('.').reduce((value, key) => value?.[key], source);
}

function getTaskRows(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function renderCompactList(rows, emptyText) {
  return rows.length
    ? `<ul>${rows.slice(0, 5).map(row => `<li>${escapeHtml(row.description || row.desc || row.assignment || row.task_type || row.type || row.subject || 'Задача')}</li>`).join('')}</ul>`
    : `<p>${escapeHtml(emptyText)}</p>`;
}

function matchesPerson(row, name, person = {}) {
  const personIds = getPersonIds(person, true);
  if (personIds.length) {
    const rowIds = getPersonIds(row);
    if (rowIds.some(id => personIds.includes(id))) return true;
  }

  const needle = normalizeName(name);
  if (!needle) return false;
  return getPersonNames(row).some(value => {
    const normalized = normalizeName(value);
    return normalized === needle
      || (needle.length > 5 && normalized.includes(needle))
      || (normalized.length > 5 && needle.includes(normalized));
  });
}

function getPersonIds(row = {}, includePlainId = false) {
  return [
    includePlainId ? row.id : '',
    row.user_id,
    row.employee_id,
    row.executor_id,
    row.representative_id,
    row.owner_id,
    row.assignee_id,
    row.delegated_to_id,
    row.case_executor_id,
  ]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0);
}

function getPersonNames(row = {}) {
  return [
    row.user_name,
    row.user,
    row.employee,
    row.full_name,
    row.name,
    row.representative,
    row.executor,
    row.case_executor,
    row.owner,
    row.assignee,
    row.delegated_to,
  ];
}

function getPrimaryPersonName(row = {}) {
  return getPersonNames(row).find(value => String(value || '').trim()) || '';
}

function buildTimelineEmployees(hearings) {
  const byName = new Map();
  hearings.forEach(row => {
    const name = getPrimaryPersonName(row) || 'Сотрудник не указан';
    if (!byName.has(name)) byName.set(name, { user_name: name, hearings: [] });
    byName.get(name).hearings.push(row);
  });
  return [...byName.values()];
}

function getNearestFutureHearing(rows) {
  const now = new Date();
  const selectedDate = state.date || todayIso();
  return rows
    .map(row => ({ row, date: parseDateTime(selectedDate, row.time || row.start_time) }))
    .filter(item => item.date && item.date >= now)
    .sort((a, b) => a.date - b.date)[0]?.row || null;
}

function formatNearestHearing(value) {
  if (!value) return 'Нет будущих заседаний';
  if (typeof value === 'string') return value;
  if (value.label) return value.label;
  const date = value.datetime ? new Date(value.datetime) : parseDateTime(state.date, value.time || value.start_time);
  if (!date || Number.isNaN(date.getTime())) return value.court || 'Время не указано';
  const diff = Math.max(0, date.getTime() - Date.now());
  const minutes = Math.round(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const prefix = hours ? `Через ${hours} час ${rest} минут` : `Через ${rest} минут`;
  return `${prefix}${value.court ? ` (${value.court})` : ''}`;
}

function parseDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const [hours, minutes] = String(timeValue).match(/\d{1,2}/g)?.map(Number) || [];
  if (!Number.isFinite(hours)) return null;
  const date = new Date(`${dateValue}T${String(hours).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTimeMinutes(value) {
  const parts = String(value || '').match(/\d{1,2}/g);
  if (!parts?.length) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);
  if (!Number.isFinite(hours) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatTime(minutes) {
  const value = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function setLoading(root, loading) {
  const node = root.querySelector('[data-reports-loading]');
  if (node) node.hidden = !loading;
  root.classList.toggle('is-loading', loading);
}

function renderErrorState(root) {
  root.querySelector('[data-reports-day-kpis]')?.replaceChildren();
  setHtml(root.querySelector('[data-reports-hearings]'), emptyState('Не удалось загрузить заседания.'));
  setHtml(root.querySelector('[data-reports-critical]'), emptyState('Не удалось загрузить критические точки.'));
  setHtml(root.querySelector('[data-reports-employee-cards]'), emptyState('Не удалось загрузить карточки сотрудников.'));
  setHtml(root.querySelector('[data-reports-timeline]'), emptyState('Не удалось загрузить график.'));
  setHtml(root.querySelector('[data-reports-controlled]'), emptyState('Не удалось загрузить контрольные дела.'));
  setHtml(root.querySelector('[data-reports-quarter-inflow]'), emptyState('Не удалось загрузить квартальные показатели.'));
}

function emptyState(text) {
  return `<div class="reports-empty">${escapeHtml(text)}</div>`;
}

function formatReportUserLabel(user = {}) {
  const status = Number(user.is_active ?? 1) ? 'активен' : 'заблокирован';
  return `${user.full_name || ''} — ${status}`;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeReasons(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value) return [String(value)];
  return ['Причины статуса не указаны'];
}

function statusText(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'red') return 'Критично';
  if (key === 'yellow') return 'Повышенная нагрузка';
  return 'В норме';
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeReportDateKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMaybeNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ru-RU') : String(value);
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '—';
}

function formatDate(value) {
  if (!value) return 'не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU');
}

function formatDateTime(value) {
  if (!value) return 'не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function quarterLabel(value) {
  return `${['', 'I', 'II', 'III', 'IV'][Number(value || 0)] || value} квартал`;
}

function getQuarter(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function truncateText(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function setHtml(node, value) {
  if (node) node.innerHTML = value;
}

function setStatus(message, isError = false) {
  const node = document.querySelector('[data-reports-status]');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error', Boolean(isError));
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
