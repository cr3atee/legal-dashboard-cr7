import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let refreshTimer = 0;
let requestVersion = 0;

export function initReportsQuarterController() {
  if (initialized) return;
  initialized = true;

  const root = document.querySelector('[data-reports-root]');
  if (!root) return;

  const schedule = (delay = 240) => {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refreshQuarter(root), delay);
  };

  root.addEventListener('change', event => {
    if (event.target.closest('[data-reports-filters], [data-reports-structure-sort]')) schedule(260);
  }, true);
  root.addEventListener('submit', () => schedule(320), true);
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reports-refresh], [data-reports-reset]')) schedule(320);
  }, true);
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') schedule(360);
  });

  applyAutomaticCycle(root);
  schedule(500);
}

async function refreshQuarter(root) {
  if (!root?.isConnected || getMode(root) !== 'quarter') return;
  const version = ++requestVersion;

  try {
    const session = await dbApi.getCurrentSession();
    const data = await dbApi.getReportMetrics(getParams(root, session));
    if (version !== requestVersion) return;
    renderQuarter(root, data || {});
  } catch (error) {
    console.warn('Не удалось обновить квартальный отчёт:', error);
  }
}

function getParams(root, session = {}) {
  const params = {
    mode: 'quarter',
    year: Number(root.querySelector('[data-reports-year]')?.value || new Date().getFullYear()),
    quarter: Number(root.querySelector('[data-reports-quarter]')?.value || Math.floor(new Date().getMonth() / 3) + 1)
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

function renderQuarter(root, data) {
  const year = Number(data.year || root.querySelector('[data-reports-year]')?.value || new Date().getFullYear());
  const quarter = Number(data.quarter || root.querySelector('[data-reports-quarter]')?.value || 1);
  const period = `${romanQuarter(quarter)} квартал ${year}`;

  const badge = root.querySelector('[data-reports-quarter-badge]');
  if (badge) badge.textContent = period;
  const title = root.querySelector('[data-reports-title]');
  if (title) title.textContent = 'Квартальный отчёт';

  renderKpis(root, data);
  renderInflow(root, data);
  renderTotals(root, data);
  renderExecutors(root, data);
  renderStructure(root, data, period);
}

function renderKpis(root, data) {
  const node = root.querySelector('[data-reports-quarter-kpis]');
  if (!node) return;
  const counters = data.counters || {};
  const dynamics = data.dynamics || {};
  node.innerHTML = [
    kpi('Поступило дел', counters.cases, dynamics.cases),
    kpi('Судебных заседаний', counters.hearings, dynamics.hearings),
    kpi('Обжалований', counters.appeals, dynamics.appeals)
  ].join('');
}

function kpi(label, value, dynamics) {
  const number = Number(dynamics || 0);
  const tone = dynamics == null || number === 0 ? 'neutral' : number > 0 ? 'positive' : 'warning';
  const trend = dynamics == null ? 'Новые данные к прошлому году' : `${number > 0 ? '+' : ''}${number}% к прошлому году`;
  return `<article class="reports-quarter-kpi"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong><em class="tone-${tone}">${escapeHtml(trend)}</em></article>`;
}

function renderInflow(root, data) {
  const total = Number(data.counters?.cases || 0);
  const badge = root.querySelector('[data-reports-quarter-total-badge]');
  if (badge) badge.innerHTML = `<span>Итого за квартал</span><div><strong>${formatNumber(total)} дел</strong></div>`;

  const months = root.querySelector('[data-reports-quarter-months]');
  const rows = Array.isArray(data.monthly_inflow) ? data.monthly_inflow : [];
  if (months) {
    const max = Math.max(...rows.map(row => Number(row.count || 0)), 1);
    months.innerHTML = rows.length ? `
      <div class="reports-month-inflow-chart">
        ${rows.map(row => {
          const count = Number(row.count || 0);
          const height = Math.max(count ? 8 : 2, Math.round(count / max * 100));
          return `<div class="reports-month-inflow-bar"><b>${formatNumber(count)}</b><span><i style="height:${height}%"></i></span><em>${escapeHtml(row.label || '')}</em></div>`;
        }).join('')}
      </div>
      <small class="reports-month-inflow-note">Архивирование и удаление не уменьшают показатель.</small>`
      : `<div class="reports-persistent-total"><span>Создано и зарегистрировано за выбранный квартал</span><strong>${formatNumber(total)}</strong><small>Архивирование и удаление не уменьшают показатель.</small></div>`;
  }

  const footer = root.querySelector('[data-reports-quarter-month-footer]');
  if (footer) {
    const peak = rows.reduce((best, row) => Number(row.count || 0) > Number(best.count || 0) ? row : best, rows[0] || {});
    const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.count || 0), 0) / rows.length : 0;
    footer.innerHTML = rows.length
      ? `<span>Всего: <b>${formatNumber(total)}</b></span><span>Среднее: <b>${average.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</b></span><span>Максимум: <b>${escapeHtml(peak.label || '')} (${formatNumber(peak.count || 0)})</b></span>`
      : '<span>Данных по месяцам пока нет.</span>';
  }
}

function renderTotals(root, data) {
  const node = root.querySelector('[data-reports-quarter-totals]');
  if (!node) return;
  const totals = data.department_totals || {};
  const breakdown = Array.isArray(totals.appeal_breakdown) ? totals.appeal_breakdown : [];
  node.innerHTML = `<div class="reports-old-totals-wrap"><table class="reports-old-totals-table"><thead><tr><th>Показатель</th><th>Значение</th><th>Динамика к аналогичному периоду прошлого года</th></tr></thead><tbody>
    <tr><td>Количество судебных заседаний</td><td><strong>${formatNumber(totals.hearings)}</strong></td><td>${formatDynamics(data.dynamics?.hearings)}</td></tr>
    <tr><td>Обжалование${breakdown.length ? `<details class="reports-row-details"><summary>Разбивка</summary>${breakdown.map(row => `<div><span>${escapeHtml(row.label)}</span><b>${formatNumber(row.count)}</b></div>`).join('')}</details>` : ''}</td><td><strong>${formatNumber(totals.appeals)}</strong></td><td>${formatDynamics(data.dynamics?.appeals)}</td></tr>
    <tr><td>Количество исковых заявлений, поданных прокурором</td><td><strong>${formatNumber(totals.prosecutor_claims)}</strong></td><td>—</td></tr>
  </tbody></table></div>`;
}

function renderExecutors(root, data) {
  const body = root.querySelector('[data-reports-executor-report]');
  if (!body) return;
  const table = body.closest('table');
  if (table?.querySelector('thead')) table.querySelector('thead').innerHTML = '<tr><th>Исполнитель</th><th>Категории спора</th><th>За выбранный квартал</th><th>С начала года</th></tr>';
  const rows = Array.isArray(data.executor_report) ? data.executor_report : [];
  body.innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${escapeHtml(row.executor || 'Не указан')}</strong></td><td><div class="reports-executor-categories">${(row.categories || []).map(category => `<span>${escapeHtml(category)}</span>`).join('') || '<span>Без категории</span>'}</div></td><td><strong>${formatNumber(row.quarter_count)}</strong></td><td><strong>${formatNumber(row.ytd_count)}</strong></td></tr>`).join('')
    : '<tr><td colspan="4"><div class="reports-empty reports-empty-wide">Нет созданных дел у выбранных исполнителей за выбранный период.</div></td></tr>';
}

function renderStructure(root, data, period) {
  const chart = root.querySelector('[data-reports-structure-chart]');
  const rowsNode = root.querySelector('[data-reports-structure-rows]');
  const sourceRows = Array.isArray(data.category_subject_rows) ? data.category_subject_rows : [];
  const grouped = new Map();
  sourceRows.forEach(row => {
    const category = String(row.category || 'Без категории');
    grouped.set(category, (grouped.get(category) || 0) + Number(row.count || 0));
  });
  const rows = [...grouped.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ru'));
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const max = Math.max(...rows.map(row => Number(row.count || 0)), 1);

  if (chart) {
    chart.innerHTML = rows.length ? `<div class="reports-column-chart">${rows.map(row => {
      const height = Math.max(4, Math.round(Number(row.count || 0) / max * 100));
      const share = total ? Number(row.count || 0) / total * 100 : 0;
      return `<button type="button" class="reports-column-bar"><b>${formatNumber(row.count)} (${formatPercent(share)})</b><span class="reports-column-bar-track"><i style="height:${height}%"></i></span><span class="reports-column-bar-label">${escapeHtml(row.category)}</span></button>`;
    }).join('')}</div>` : '<div class="reports-empty reports-empty-wide">Нет данных по структуре дел за выбранный период.</div>';
  }

  if (rowsNode) {
    rowsNode.innerHTML = sourceRows.length ? sourceRows.map(row => {
      const count = Number(row.count || 0);
      const share = total ? count / total * 100 : 0;
      return `<tr><td>${escapeHtml(row.category || 'Без категории')}</td><td>${escapeHtml(row.subject || row.claim_subject || 'Без предмета')}</td><td>${formatNumber(count)}</td><td>${formatPercent(share)}</td><td>${escapeHtml(period)}</td></tr>`;
    }).join('') : '<tr><td colspan="5"><div class="reports-empty reports-empty-wide">Нет данных по структуре дел за выбранный период.</div></td></tr>';
  }
}

function applyAutomaticCycle(root) {
  const now = new Date();
  if (now.getMonth() !== 11 || now.getDate() < 30) return;
  const yearInput = root.querySelector('[data-reports-year]');
  const quarterInput = root.querySelector('[data-reports-quarter]');
  const calendarYear = now.getFullYear();
  if (yearInput && Number(yearInput.value || calendarYear) === calendarYear) yearInput.value = String(calendarYear + 1);
  if (quarterInput && Number(quarterInput.value || 4) === 4) quarterInput.value = '1';
}

function getMode(root) {
  return root.querySelector('[data-reports-mode]:checked')?.value || 'day';
}
function romanQuarter(value) {
  return ['I', 'II', 'III', 'IV'][Math.max(1, Math.min(4, Number(value || 1))) - 1];
}
function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}
function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}
function formatDynamics(value) {
  if (value == null) return '—';
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${number}%`;
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
