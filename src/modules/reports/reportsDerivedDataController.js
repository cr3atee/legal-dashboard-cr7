import { dbApi } from '../../api/dbApi.js';
import { initGeneralCaseReportEnhancements } from '../cases/generalCaseReportEnhancements.js';

const state = {
  initialized: false,
  timer: null,
  requestVersion: 0,
  applying: false,
  observer: null,
};

const PIE_COLORS = ['#356fe0', '#6d8ee8', '#88a6ed', '#a8bdf0', '#6ec8b4', '#ef9b68'];

export function initReportsDerivedDataController() {
  initGeneralCaseReportEnhancements();
  const root = document.querySelector('[data-reports-root]');
  if (!root || state.initialized) return;
  state.initialized = true;
  applyAutomaticReportCycle(root);

  const schedule = delay => scheduleRefresh(root, delay);
  root.addEventListener('submit', () => schedule(320), true);
  root.addEventListener('change', event => {
    if (event.target.closest('[data-reports-filters], [data-reports-structure-sort]')) schedule(320);
  }, true);
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reports-refresh], [data-reports-reset]')) schedule(320);
  }, true);
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') schedule(360);
  });

  state.observer = new MutationObserver(() => {
    if (!state.applying) schedule(180);
  });
  state.observer.observe(root, { childList: true, subtree: true });
  schedule(500);
}

function applyAutomaticReportCycle(root) {
  const now = new Date();
  if (now.getMonth() !== 11 || now.getDate() < 30) return;
  const yearInput = root.querySelector('[data-reports-year]');
  const quarterInput = root.querySelector('[data-reports-quarter]');
  const calendarYear = now.getFullYear();
  if (yearInput && Number(yearInput.value || calendarYear) === calendarYear) yearInput.value = String(calendarYear + 1);
  if (quarterInput && Number(quarterInput.value || 4) === 4) quarterInput.value = '1';
}

function scheduleRefresh(root, delay = 240) {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => refreshReports(root), delay);
}

async function refreshReports(root) {
  if (!root?.isConnected || state.applying) return;
  const version = ++state.requestVersion;
  try {
    const session = await dbApi.getCurrentSession();
    const params = getMetricParams(root, session);
    const data = await dbApi.getReportMetrics(params);
    if (version !== state.requestVersion) return;

    state.applying = true;
    if (getMode(root) === 'day') renderDay(root, data);
    else renderQuarter(root, data);
  } catch (error) {
    console.warn('Не удалось обновить постоянные показатели отчёта:', error);
  } finally {
    state.observer?.takeRecords();
    state.applying = false;
  }
}

function getMetricParams(root, session = {}) {
  const params = {
    mode: getMode(root),
    report_date: root.querySelector('[data-reports-date]')?.value || todayIso(),
    year: Number(root.querySelector('[data-reports-year]')?.value || new Date().getFullYear()),
    quarter: Number(root.querySelector('[data-reports-quarter]')?.value || Math.floor(new Date().getMonth() / 3) + 1),
  };
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  const canManageAll = Number(session.role_level || 0) >= 2 || permissions.includes('reports.manageAll');
  if (!canManageAll) {
    params.user_id = Number(session.id || session.user_id || 0) || undefined;
    return params;
  }

  const allUsers = Boolean(root.querySelector('[data-reports-all-users]')?.checked);
  const selectedIds = root.querySelector('[data-reports-users]')
    ? [...root.querySelector('[data-reports-users]').selectedOptions].map(option => Number(option.value)).filter(Boolean)
    : [];
  if (allUsers || !selectedIds.length) params.all = '1';
  else params.user_ids = selectedIds;
  return params;
}

function renderDay(root, data) {
  const rows = Array.isArray(data.day_hearings) ? data.day_hearings : [];
  renderTimeline(root, rows);
  renderEmployeeHearings(root, rows);
}

function renderTimeline(root, rows) {
  const node = root.querySelector('[data-reports-timeline]');
  if (!node) return;
  if (!rows.length) {
    node.innerHTML = '<div class="reports-empty reports-empty-wide" data-persistent-report>На выбранную дату судебных заседаний нет.</div>';
    return;
  }

  const normalized = rows.map(row => ({
    employee: String(row.employee || row.representative || row.case_executor || 'Сотрудник не указан').trim(),
    time: String(row.time || row.time_val || '').trim(),
    court: String(row.court || 'Суд не указан').trim(),
    subject: String(row.subject || row.result || row.claim_subject || row.case_no || 'Предмет не указан').trim(),
  })).sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time));
  const groups = groupBy(normalized, row => row.employee);
  const values = normalized.map(row => timeMinutes(row.time)).filter(Number.isFinite);
  const start = values.length ? Math.max(0, Math.min(...values) - 60) : 8 * 60;
  const end = values.length ? Math.min(1439, Math.max(...values) + 90) : 18 * 60;
  const span = Math.max(60, end - start);

  node.innerHTML = `
    <div class="reports-timeline-scale reports-timeline-scale-fixed" data-persistent-report>
      <span aria-hidden="true"></span>
      <div class="reports-timeline-scale-spread"><span>${formatTime(start)}</span><span>${formatTime(start + span / 2)}</span><span>${formatTime(end)}</span></div>
    </div>
    ${[...groups.entries()].map(([employee, hearings]) => `
      <div class="reports-timeline-row" data-persistent-report>
        <strong title="${escapeAttr(employee)}">${escapeHtml(employee)}</strong>
        <div class="reports-timeline-track">
          ${hearings.map(row => {
            const raw = ((timeMinutes(row.time) - start) / span) * 100;
            const left = Number.isFinite(raw) ? Math.max(5, Math.min(88, raw)) : 5;
            return `<span class="reports-timeline-item" style="left:${left}%" title="${escapeAttr(`${row.time} · ${row.court} · ${row.subject}`)}"><b>${escapeHtml(row.time || '—')}</b>${escapeHtml(row.court)}<small>${escapeHtml(row.subject)}</small></span>`;
          }).join('')}
        </div>
      </div>`).join('')}
  `;
}

function renderEmployeeHearings(root, rows) {
  const selectedDate = root.querySelector('[data-reports-date]')?.value || todayIso();
  root.querySelectorAll('.reports-employee-card').forEach(card => {
    const name = card.querySelector('.reports-employee-head h4')?.textContent || '';
    const hearings = rows.filter(row => personNamesMatch(row.employee || row.representative || row.case_executor, name));
    const section = card.querySelector('.reports-hearings-card');
    if (!section) return;
    const heading = section.querySelector('h5');
    if (heading) heading.textContent = `Судебные заседания ${formatDate(selectedDate)}`;
    const count = section.querySelector('.reports-section-title-row > span');
    if (count) count.textContent = String(hearings.length);
    [...section.children].forEach(child => {
      if (!child.classList.contains('reports-section-title-row')) child.remove();
    });
    section.insertAdjacentHTML('beforeend', hearings.length ? `
      <div class="reports-hearing-list">
        ${hearings.map(row => `<div class="reports-hearing-chip"><b>${escapeHtml(row.time || '—')}</b><span>${escapeHtml(row.court || 'Суд не указан')}</span><small>${escapeHtml([row.subject, row.case_no].filter(Boolean).join(' · ') || 'Данные дела не указаны')}</small></div>`).join('')}
      </div>
    ` : '<div class="reports-hearings-empty"><i aria-hidden="true">⚖</i><strong>На выбранную дату заседаний нет</strong><p>Заседания выбранного сотрудника появятся здесь</p></div>');
  });
}

function renderQuarter(root, data) {
  const period = `${romanQuarter(data.quarter)} квартал ${data.year}`;
  const badge = root.querySelector('[data-reports-quarter-badge]');
  if (badge) badge.textContent = period;
  const title = root.querySelector('[data-reports-title]');
  if (title) title.textContent = 'Квартальный отчёт';

  renderQuarterKpis(root, data);
  renderInflowSummary(root, data);
  renderDepartmentTotals(root, data);
  renderExecutors(root, data);
  renderMarkerPie(root, data);
  renderCategoryTable(root, data, period);
}

function renderQuarterKpis(root, data) {
  const node = root.querySelector('[data-reports-quarter-kpis]');
  if (!node) return;
  const counters = data.counters || {};
  const dynamics = data.dynamics || {};
  node.innerHTML = [
    kpiCard('Поступило дел', counters.cases, dynamics.cases, 'к прошлому году'),
    kpiCard('Судебных заседаний', counters.hearings, dynamics.hearings, 'к прошлому году'),
    kpiCard('Обжалований', counters.appeals, dynamics.appeals, 'к прошлому году', Number(dynamics.appeals) > 0 ? 'warning' : 'neutral'),
  ].join('');
}

function kpiCard(label, value, dynamics, suffix, forcedTone = '') {
  const tone = forcedTone || (dynamics === null || Number(dynamics) === 0 ? 'neutral' : Number(dynamics) > 0 ? 'positive' : 'warning');
  const trend = dynamics === null ? `Новые данные ${suffix}` : `${Number(dynamics) > 0 ? '+' : ''}${Number(dynamics || 0)}% ${suffix}`;
  return `<article class="reports-quarter-kpi"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong><em class="tone-${tone}">${escapeHtml(trend)}</em></article>`;
}

function renderInflowSummary(root, data) {
  const total = Number(data.counters?.cases || 0);
  const badge = root.querySelector('[data-reports-quarter-total-badge]');
  if (badge) badge.innerHTML = `<span>Итого за квартал</span><div><strong>${formatNumber(total)} дел</strong></div>`;
  root.querySelector('.reports-quarter-legend')?.setAttribute('hidden', '');
  const months = root.querySelector('[data-reports-quarter-months]');
  if (months) months.innerHTML = `<div class="reports-persistent-total"><span>Создано и зарегистрировано за выбранный квартал</span><strong>${formatNumber(total)}</strong><small>Архивирование и удаление не уменьшают показатель.</small></div>`;
  const footer = root.querySelector('[data-reports-quarter-month-footer]');
  if (footer) footer.innerHTML = '<span>Новый годовой цикл начинается автоматически 30 декабря.</span>';
}

function renderDepartmentTotals(root, data) {
  const node = root.querySelector('[data-reports-quarter-totals]');
  if (!node) return;
  const totals = data.department_totals || {};
  const breakdown = Array.isArray(totals.appeal_breakdown) ? totals.appeal_breakdown : [];
  node.innerHTML = `
    <div class="reports-old-totals-wrap">
      <table class="reports-old-totals-table">
        <thead><tr><th>Показатель</th><th>Значение</th><th>Динамика к аналогичному периоду прошлого года</th></tr></thead>
        <tbody>
          <tr><td>Количество судебных заседаний</td><td><strong>${formatNumber(totals.hearings)}</strong></td><td>${formatDynamics(data.dynamics?.hearings)}</td></tr>
          <tr><td>Обжалование${breakdown.length ? `<details class="reports-row-details"><summary>Разбивка</summary>${breakdown.map(row => `<div><span>${escapeHtml(row.label)}</span><b>${formatNumber(row.count)}</b></div>`).join('')}</details>` : ''}</td><td><strong>${formatNumber(totals.appeals)}</strong></td><td>${formatDynamics(data.dynamics?.appeals)}</td></tr>
          <tr><td>Количество исковых заявлений, поданных прокурором</td><td><strong>${formatNumber(totals.prosecutor_claims)}</strong></td><td>—</td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderExecutors(root, data) {
  const body = root.querySelector('[data-reports-executor-report]');
  if (!body) return;
  const table = body.closest('table');
  if (table) table.querySelector('thead').innerHTML = '<tr><th>Исполнитель</th><th>Категории спора</th><th>За выбранный квартал</th><th>С начала года</th></tr>';
  const rows = Array.isArray(data.executor_report) ? data.executor_report : [];
  body.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.executor || 'Не указан')}</strong></td>
      <td><div class="reports-executor-categories">${(row.categories || []).map(category => `<span>${escapeHtml(category)}</span>`).join('') || '<span>Без категории</span>'}</div></td>
      <td><strong>${formatNumber(row.quarter_count)}</strong></td>
      <td><strong>${formatNumber(row.ytd_count)}</strong></td>
    </tr>`).join('') : '<tr><td colspan="4"><div class="reports-empty reports-empty-wide">Нет созданных дел у выбранных исполнителей за выбранный период.</div></td></tr>';
}

function renderMarkerPie(root, data) {
  const chart = root.querySelector('[data-reports-structure-chart]');
  const legend = root.querySelector('[data-reports-subject-breakdown]');
  if (!chart || !legend) return;
  const rows = Array.isArray(data.marker_distribution) ? data.marker_distribution : [];
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += total ? Number(row.count || 0) / total * 100 : 0;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${cursor}%`;
  }).join(', ');
  chart.innerHTML = `<div class="reports-marker-pie-shell"><div class="reports-marker-pie" style="background:${total ? `conic-gradient(${segments})` : '#e5edf7'}"><span><strong>${formatNumber(total)}</strong><small>пометок</small></span></div></div>`;
  legend.innerHTML = `<h4>Пометки дел</h4><div class="reports-marker-legend">${rows.map((row, index) => `<div><i style="background:${PIE_COLORS[index % PIE_COLORS.length]}"></i><span>${escapeHtml(row.label)}</span><b>${formatNumber(row.count)}</b></div>`).join('')}</div>`;
}

function renderCategoryTable(root, data, period) {
  const body = root.querySelector('[data-reports-structure-rows]');
  if (!body) return;
  const mode = root.querySelector('[data-reports-structure-sort]')?.value === 'category' ? 'category' : 'count';
  const rows = [...(Array.isArray(data.category_subject_rows) ? data.category_subject_rows : [])];
  rows.sort((a, b) => mode === 'category'
    ? String(a.category).localeCompare(String(b.category), 'ru') || Number(b.count) - Number(a.count)
    : Number(b.count) - Number(a.count) || String(a.category).localeCompare(String(b.category), 'ru'));
  body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.subject)}</td><td><strong>${formatNumber(row.count)}</strong></td><td>${formatPercent(row.share)}</td><td>${escapeHtml(period)}</td></tr>`).join('') : '<tr><td colspan="5">Нет созданных дел за выбранный квартал.</td></tr>';
}

function getMode(root) {
  return root.querySelector('[data-reports-mode]:checked')?.value === 'quarter' ? 'quarter' : 'day';
}

function groupBy(rows, factory) {
  const map = new Map();
  rows.forEach(row => {
    const key = factory(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function normalizeName(value) {
  return String(value || '').split(/\s+—\s+/)[0].toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function personNamesMatch(leftValue, rightValue) {
  const left = normalizeName(leftValue);
  const right = normalizeName(rightValue);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftParts = left.split(' ');
  const rightParts = right.split(' ');
  if (leftParts[0] !== rightParts[0]) return false;
  const leftInitials = leftParts.slice(1).map(part => part[0]).join('');
  const rightInitials = rightParts.slice(1).map(part => part[0]).join('');
  return Boolean(leftInitials && rightInitials && (leftInitials.startsWith(rightInitials) || rightInitials.startsWith(leftInitials)));
}

function timeMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

function formatTime(minutes) {
  const value = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '');
}

function romanQuarter(value) {
  return ['', 'I', 'II', 'III', 'IV'][Number(value)] || String(value || '');
}

function formatDynamics(value) {
  if (value === null || value === undefined) return 'Новые данные';
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${number}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
