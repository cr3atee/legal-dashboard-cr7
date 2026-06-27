import { dbApi } from '../../api/dbApi.js';

const runtime = {
  initialized: false,
  timer: null,
  requestVersion: 0,
  applying: false,
  observer: null,
};

export function initReportsCompatibilityController() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || runtime.initialized) return;
  runtime.initialized = true;

  const schedule = delay => scheduleRefresh(root, delay);
  root.addEventListener('submit', () => schedule(80), true);
  root.addEventListener('change', event => {
    if (event.target.closest('[data-reports-filters], [data-reports-structure-sort]')) schedule(80);
  }, true);
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reports-refresh], [data-reports-reset]')) schedule(80);
  }, true);

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') schedule(120);
  });

  runtime.observer = new MutationObserver(() => {
    if (!runtime.applying) schedule(70);
  });
  runtime.observer.observe(root, { childList: true, subtree: true });

  schedule(180);
}

function scheduleRefresh(root, delay = 80) {
  window.clearTimeout(runtime.timer);
  runtime.timer = window.setTimeout(() => enrichReports(root), delay);
}

async function enrichReports(root) {
  if (!root?.isConnected || runtime.applying) return;
  const mode = root.querySelector('[data-reports-mode]:checked')?.value === 'quarter' ? 'quarter' : 'day';
  const version = ++runtime.requestVersion;

  try {
    const [casesPayload, schedulePayload, sessionPayload] = await Promise.all([
      dbApi.getGeneralCases({ search: '' }),
      dbApi.getCourtSchedule(),
      dbApi.getCurrentSession().catch(() => null),
    ]);
    if (version !== runtime.requestVersion) return;

    const context = {
      root,
      cases: unwrapRows(casesPayload, ['items', 'rows', 'cases', 'general_cases', 'data', 'results']),
      hearings: unwrapRows(schedulePayload, ['items', 'rows', 'schedule', 'hearings', 'court_schedule', 'data', 'results']),
      selectedNames: getSelectedEmployeeNames(root, sessionPayload),
    };

    runtime.applying = true;
    if (mode === 'quarter') enrichQuarterReport(context);
    else enrichDayTimeline(context);
  } catch (error) {
    console.warn('Reports compatibility enrichment failed:', error);
  } finally {
    runtime.applying = false;
  }
}

function enrichDayTimeline({ root, hearings, selectedNames }) {
  const node = root.querySelector('[data-reports-timeline]');
  if (!node) return;

  const reportDate = normalizeDateKey(root.querySelector('[data-reports-date]')?.value);
  const selected = new Set(selectedNames.map(normalizeName).filter(Boolean));
  const rows = hearings
    .filter(row => Number(row.is_date_row || 0) !== 1)
    .filter(row => normalizeDateKey(firstValue(row, ['session_date', 'hearing_date', 'date', 'date_str', 'datetime'])) === reportDate)
    .filter(row => !selected.size || selected.has(normalizeName(firstValue(row, ['representative', 'case_executor', 'executor', 'user_name', 'employee']))))
    .map(normalizeHearingRow)
    .filter(row => row.employee)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const signature = `day:${reportDate}:${selectedNames.join('|')}:${rows.map(row => `${row.id}:${row.time}`).join('|')}`;
  if (node.dataset.compatSignature === signature && node.querySelector('[data-compat-generated]')) return;
  node.dataset.compatSignature = signature;

  if (!rows.length) {
    node.innerHTML = '<div class="reports-empty reports-empty-wide" data-compat-generated>На выбранную дату судебных заседаний нет.</div>';
    return;
  }

  const grouped = new Map();
  rows.forEach(row => {
    if (!grouped.has(row.employee)) grouped.set(row.employee, []);
    grouped.get(row.employee).push(row);
  });

  const minutes = rows.map(row => timeToMinutes(row.time)).filter(Number.isFinite);
  const start = minutes.length ? Math.max(0, Math.min(...minutes) - 60) : 8 * 60;
  const end = minutes.length ? Math.min(24 * 60, Math.max(...minutes) + 90) : 18 * 60;
  const span = Math.max(60, end - start);

  node.innerHTML = `
    <div class="reports-timeline-scale reports-timeline-scale-fixed" data-compat-generated>
      <span aria-hidden="true"></span>
      <div class="reports-timeline-scale-spread">
        <span>${formatTime(start)}</span>
        <span>${formatTime(start + span / 2)}</span>
        <span>${formatTime(end)}</span>
      </div>
    </div>
    ${[...grouped.entries()].map(([employee, employeeRows]) => `
      <div class="reports-timeline-row" data-compat-generated>
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
}

function enrichQuarterReport({ root, cases, selectedNames }) {
  const year = Number(root.querySelector('[data-reports-year]')?.value || new Date().getFullYear());
  const quarter = Math.min(4, Math.max(1, Number(root.querySelector('[data-reports-quarter]')?.value || 1)));
  const selected = new Set(selectedNames.map(normalizeName).filter(Boolean));

  const scopedCases = cases.filter(row => {
    if (!selected.size) return true;
    return selected.has(normalizeName(firstValue(row, ['executor', 'representative', 'case_executor', 'user_name', 'employee'])));
  });

  const ytdRows = scopedCases.filter(row => {
    const date = getCaseReportDate(row);
    return date && date.getFullYear() === year && date.getMonth() <= quarter * 3 - 1;
  });
  const quarterStart = (quarter - 1) * 3;
  const quarterRows = ytdRows.filter(row => {
    const month = getCaseReportDate(row)?.getMonth();
    return Number.isInteger(month) && month >= quarterStart && month <= quarterStart + 2;
  });

  renderQuarterInflow(root, quarterRows, ytdRows);
  renderExecutorRows(root, quarterRows, ytdRows);
  const sortMode = root.querySelector('[data-reports-structure-sort]')?.value === 'category' ? 'category' : 'count';
  renderStructure(root, quarterRows, year, quarter, sortMode);
}

function renderQuarterInflow(root, quarterRows, ytdRows) {
  const node = root.querySelector('[data-reports-quarter-inflow]');
  if (!node) return;
  const categories = aggregate(quarterRows, row => categoryOf(row));
  const signature = `inflow:${quarterRows.length}:${ytdRows.length}:${serializeCounts(categories)}`;
  if (node.dataset.compatSignature === signature && node.querySelector('[data-compat-generated]')) return;
  node.dataset.compatSignature = signature;

  node.innerHTML = `
    <div class="reports-inflow-main" data-compat-generated>
      <div><span>За выбранный квартал</span><strong>${formatNumber(quarterRows.length)}</strong></div>
      <div><span>С начала года</span><strong>${formatNumber(ytdRows.length)}</strong></div>
    </div>
    <div class="reports-category-chips" data-compat-generated>
      ${categories.length ? categories.map(([category, count]) => `
        <button type="button" data-compat-category="${escapeAttr(category)}">
          <span>${escapeHtml(category)}</span><b>${formatNumber(count)}</b>
        </button>
      `).join('') : '<div class="reports-empty reports-empty-wide">Нет дел за выбранный квартал.</div>'}
    </div>
  `;
}

function renderExecutorRows(root, quarterRows, ytdRows) {
  const node = root.querySelector('[data-reports-executor-report]');
  if (!node) return;

  const grouped = new Map();
  const add = (row, field) => {
    const executor = employeeOf(row) || 'Не указан';
    const category = categoryOf(row);
    const key = `${normalizeName(executor)}\u0000${normalizeName(category)}`;
    if (!grouped.has(key)) grouped.set(key, { executor, category, quarter: 0, ytd: 0 });
    grouped.get(key)[field] += 1;
  };
  ytdRows.forEach(row => add(row, 'ytd'));
  quarterRows.forEach(row => add(row, 'quarter'));

  const rows = [...grouped.values()].sort((a, b) =>
    b.quarter - a.quarter || b.ytd - a.ytd || a.executor.localeCompare(b.executor, 'ru') || a.category.localeCompare(b.category, 'ru')
  );
  const signature = `executors:${rows.map(row => `${row.executor}:${row.category}:${row.quarter}:${row.ytd}`).join('|')}`;
  if (node.dataset.compatSignature === signature && node.querySelector('[data-compat-generated]')) return;
  node.dataset.compatSignature = signature;

  node.innerHTML = rows.length ? rows.map(row => `
    <tr data-compat-generated>
      <td><span class="reports-person-name">${escapeHtml(row.executor)}</span></td>
      <td>${escapeHtml(row.category)}</td>
      <td><strong class="reports-number-cell">${formatNumber(row.quarter)}</strong></td>
      <td><strong class="reports-number-cell">${formatNumber(row.ytd)}</strong></td>
    </tr>
  `).join('') : '<tr data-compat-generated><td colspan="4"><div class="reports-empty reports-empty-wide">Нет данных по исполнителям за выбранный период.</div></td></tr>';
}

function renderStructure(root, quarterRows, year, quarter, sortMode = 'count') {
  const chart = root.querySelector('[data-reports-structure-chart]');
  const subjects = root.querySelector('[data-reports-subject-breakdown]');
  const table = root.querySelector('[data-reports-structure-rows]');
  if (!chart || !subjects || !table) return;

  const grouped = new Map();
  quarterRows.forEach(row => {
    const category = categoryOf(row);
    const subject = subjectOf(row);
    const key = `${category}\u0000${subject}`;
    grouped.set(key, { category, subject, count: (grouped.get(key)?.count || 0) + 1 });
  });
  const rows = [...grouped.values()].sort((a, b) => sortMode === 'category'
    ? a.category.localeCompare(b.category, 'ru') || b.count - a.count || a.subject.localeCompare(b.subject, 'ru')
    : b.count - a.count || a.category.localeCompare(b.category, 'ru') || a.subject.localeCompare(b.subject, 'ru'));
  const categoryCounts = aggregate(quarterRows, row => categoryOf(row));
  const total = quarterRows.length;
  const signature = `structure:${year}:q${quarter}:${sortMode}:${rows.map(row => `${row.category}:${row.subject}:${row.count}`).join('|')}`;
  if (table.dataset.compatSignature === signature && table.querySelector('[data-compat-generated]')) return;
  chart.dataset.compatSignature = signature;
  subjects.dataset.compatSignature = signature;
  table.dataset.compatSignature = signature;

  if (!rows.length) {
    const empty = '<div class="reports-empty reports-empty-wide" data-compat-generated>Нет данных по структуре дел за выбранный период.</div>';
    chart.innerHTML = empty;
    subjects.innerHTML = empty;
    table.innerHTML = '<tr data-compat-generated><td colspan="5">Нет данных для таблицы структуры дел за выбранный период.</td></tr>';
    return;
  }

  const max = Math.max(...categoryCounts.map(([, count]) => count), 1);
  chart.innerHTML = categoryCounts.map(([category, count], index) => `
    <button type="button" class="reports-bar-row ${index === 0 ? 'active' : ''}" data-compat-category="${escapeAttr(category)}" data-compat-generated>
      <span class="reports-bar-label">${escapeHtml(category)}</span>
      <span class="reports-bar-track"><span style="width:${Math.max(5, Math.round((count / max) * 100))}%"></span></span>
      <b>${formatNumber(count)}</b>
    </button>
  `).join('');

  const topCategory = categoryCounts[0]?.[0] || rows[0].category;
  renderSubjectBreakdown(subjects, rows, topCategory);
  chart.querySelectorAll('[data-compat-category]').forEach(button => {
    button.addEventListener('click', () => {
      chart.querySelectorAll('[data-compat-category]').forEach(item => item.classList.toggle('active', item === button));
      renderSubjectBreakdown(subjects, rows, button.dataset.compatCategory || '');
    });
  });

  const period = `${['', 'I', 'II', 'III', 'IV'][quarter]} квартал ${year}`;
  table.innerHTML = rows.map(row => `
    <tr data-compat-generated>
      <td>${escapeHtml(row.category)}</td>
      <td>${escapeHtml(row.subject)}</td>
      <td><strong class="reports-number-cell">${formatNumber(row.count)}</strong></td>
      <td>${formatPercent(total ? row.count / total * 100 : 0)}</td>
      <td>${escapeHtml(period)}</td>
    </tr>
  `).join('');
}

function renderSubjectBreakdown(node, rows, category) {
  const filtered = rows.filter(row => row.category === category);
  const shown = filtered.slice(0, 6);
  const other = filtered.slice(6).reduce((sum, row) => sum + row.count, 0);
  const total = filtered.reduce((sum, row) => sum + row.count, 0);
  node.innerHTML = `
    <div data-compat-generated>
      <h4>${escapeHtml(category || 'Предметы спора')}</h4>
      ${shown.map(row => `<div class="reports-subject-row"><span title="${escapeAttr(row.subject)}">${escapeHtml(row.subject)}</span><b>${formatNumber(row.count)}</b></div>`).join('')}
      ${other ? `<div class="reports-subject-row is-muted"><span>Прочие</span><b>${formatNumber(other)}</b></div>` : ''}
      <p class="muted">Всего по категории: ${formatNumber(total)}</p>
    </div>
  `;
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
    const value = getPath(payload, key);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function getPath(source, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], source);
}

function normalizeHearingRow(row) {
  return {
    id: row.id || row.schedule_id || '',
    employee: String(firstValue(row, ['representative', 'case_executor', 'executor', 'user_name', 'employee']) || '').trim(),
    time: String(firstValue(row, ['time', 'start_time', 'time_val']) || '').trim(),
    court: String(firstValue(row, ['court', 'court_name']) || '').trim(),
    subject: String(firstValue(row, ['result', 'claim_subject', 'subject']) || '').trim(),
    caseNo: String(firstValue(row, ['case_no', 'court_no', 'case_number']) || '').trim(),
    conflict: Boolean(row.conflict || row.has_conflict),
  };
}

function getCaseReportDate(row) {
  return parseDate(firstValue(row, ['registration_date', 'created_at', 'updated_at', 'judicial_act_date_first', 'motivated_decision_date']));
}

function employeeOf(row) {
  return String(firstValue(row, ['executor', 'representative', 'case_executor', 'user_name', 'employee']) || '').trim();
}

function categoryOf(row) {
  return String(firstValue(row, ['category', 'dispute_category', 'case_category']) || 'Без категории').trim() || 'Без категории';
}

function subjectOf(row) {
  return String(firstValue(row, ['claim_subject', 'subject', 'result']) || 'Без предмета спора').trim() || 'Без предмета спора';
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function aggregate(rows, keyFactory) {
  const result = new Map();
  rows.forEach(row => {
    const key = keyFactory(row);
    result.set(key, (result.get(key) || 0) + 1);
  });
  return [...result.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
}

function serializeCounts(rows) {
  return rows.map(([key, count]) => `${key}:${count}`).join('|');
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

function normalizeDateKey(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function timeToMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(minutes) {
  const value = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
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
