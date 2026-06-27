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
    if (event.target.closest('[data-reports-filters]')) schedule(80);
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
  runtime.timer = window.setTimeout(() => enrichDayTimeline(root), delay);
}

async function enrichDayTimeline(root) {
  if (!root?.isConnected || runtime.applying) return;
  const mode = root.querySelector('[data-reports-mode]:checked')?.value === 'quarter' ? 'quarter' : 'day';
  if (mode !== 'day') return;

  const version = ++runtime.requestVersion;
  try {
    const [schedulePayload, sessionPayload] = await Promise.all([
      dbApi.getCourtSchedule(),
      dbApi.getCurrentSession().catch(() => null),
    ]);
    if (version !== runtime.requestVersion) return;

    const hearings = unwrapRows(schedulePayload, ['items', 'rows', 'schedule', 'hearings', 'court_schedule', 'data', 'results']);
    const selectedNames = getSelectedEmployeeNames(root, sessionPayload);
    renderTimeline(root, hearings, selectedNames);
  } catch (error) {
    console.warn('Reports day timeline enrichment failed:', error);
  }
}

function renderTimeline(root, hearings, selectedNames) {
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
    .sort((a, b) => safeTime(a.time) - safeTime(b.time));

  const signature = `day:${reportDate}:${selectedNames.join('|')}:${rows.map(row => `${row.id}:${row.time}`).join('|')}`;
  if (node.dataset.compatSignature === signature && node.querySelector('[data-day-compat-generated]')) return;
  node.dataset.compatSignature = signature;

  runtime.applying = true;
  try {
    if (!rows.length) {
      node.innerHTML = '<div class="reports-empty reports-empty-wide" data-day-compat-generated>На выбранную дату судебных заседаний нет.</div>';
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
      <div class="reports-timeline-scale reports-timeline-scale-fixed" data-day-compat-generated>
        <span aria-hidden="true"></span>
        <div class="reports-timeline-scale-spread">
          <span>${formatTime(start)}</span>
          <span>${formatTime(start + span / 2)}</span>
          <span>${formatTime(end)}</span>
        </div>
      </div>
      ${[...grouped.entries()].map(([employee, employeeRows]) => `
        <div class="reports-timeline-row" data-day-compat-generated>
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
    runtime.observer?.takeRecords();
    runtime.applying = false;
  }
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

function safeTime(value) {
  const minutes = timeToMinutes(value);
  return Number.isFinite(minutes) ? minutes : Number.MAX_SAFE_INTEGER;
}

function formatTime(minutes) {
  const value = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
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
