const sqlite3 = require('sqlite3').verbose();
const REPORT_CATEGORIES = require('./reportCategories.cjs');

const schemaReady = new Map();
const BOOTSTRAP_KEY = 'report_event_ledger_bootstrap_v3';
const MARKERS = [
  ['control_flag', 'Контрольное дело'],
  ['review_show_flag', 'Отзыв показать'],
  ['emergency_fund_flag', 'Аварийный фонд'],
  ['registry_flag', 'Выморочка'],
  ['prosecutor_claim_flag', 'Иск прокурора'],
  ['attendance_flag', 'Явочное дело']
];

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function all(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.all(sql, params, (error, rows) => {
      db.close();
      error ? reject(error) : resolve(rows || []);
    });
  });
}

function get(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.get(sql, params, (error, row) => {
      db.close();
      error ? reject(error) : resolve(row || null);
    });
  });
}

function run(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.run(sql, params, function callback(error) {
      db.close();
      error ? reject(error) : resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function ensureSchema(dbPath) {
  if (!schemaReady.has(dbPath)) {
    const promise = initializeSchema(dbPath).catch(error => {
      schemaReady.delete(dbPath);
      throw error;
    });
    schemaReady.set(dbPath, promise);
  }
  return schemaReady.get(dbPath);
}

async function initializeSchema(dbPath) {
  await run(dbPath, 'CREATE TABLE IF NOT EXISTS schema_migrations (key TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await run(dbPath, `CREATE TABLE IF NOT EXISTS report_event_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    source_key TEXT NOT NULL UNIQUE,
    event_date TEXT DEFAULT '',
    report_year INTEGER NOT NULL,
    report_quarter INTEGER NOT NULL,
    employee TEXT DEFAULT '',
    category TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(dbPath, 'CREATE INDEX IF NOT EXISTS idx_report_event_period ON report_event_ledger(report_year,report_quarter,event_type)');
  await run(dbPath, `CREATE TABLE IF NOT EXISTS general_case_extra_flags (
    general_case_id INTEGER PRIMARY KEY,
    prosecutor_claim_flag INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const value of REPORT_CATEGORIES) {
    await run(dbPath, 'INSERT OR IGNORE INTO app_options (category,value) VALUES (?,?)', ['case_category', value]).catch(() => {});
  }
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) return validDate(+match[1], +match[2] - 1, +match[3]);
  match = text.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})/);
  if (match) return validDate(+(match[3].length === 2 ? `20${match[3]}` : match[3]), +match[2] - 1, +match[1]);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validDate(year, month, day) {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function isoDate(value, fallbackNow = true) {
  const date = parseDate(value) || (fallbackNow ? new Date() : null);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function periodOf(value) {
  const date = parseDate(value) || new Date();
  const reset = date.getMonth() === 11 && date.getDate() >= 30;
  return {
    year: reset ? date.getFullYear() + 1 : date.getFullYear(),
    quarter: reset ? 1 : Math.floor(date.getMonth() / 3) + 1
  };
}

function normalizeName(value) {
  return String(value || '').split(/\s+—\s+/)[0].toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function namesMatch(leftValue, rightValue) {
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

function parseJson(value, fallback) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function flag(value) {
  return Number(value || 0) === 1 ? 1 : 0;
}

function isHearingCalculatorItem(item = {}) {
  const text = String(item.title || item.kind || item.appeal_kind || '').toLowerCase();
  return text.includes('заседан') || text.includes('слушан');
}

function hasDatedAppeal(item = {}) {
  return Boolean(parseDate(item.date || item.event_date || item.appeal_date || item.submitted_at));
}

async function upsertEvent(dbPath, event) {
  const period = periodOf(event.event_date);
  const now = new Date().toISOString();
  await run(dbPath, `INSERT INTO report_event_ledger (
    event_type,source_key,event_date,report_year,report_quarter,employee,category,subject,metadata_json,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(source_key) DO UPDATE SET
    event_type=excluded.event_type,event_date=excluded.event_date,report_year=excluded.report_year,report_quarter=excluded.report_quarter,
    employee=excluded.employee,category=excluded.category,subject=excluded.subject,
    metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`, [
    event.event_type,
    event.source_key,
    isoDate(event.event_date),
    period.year,
    period.quarter,
    String(event.employee || '').trim(),
    String(event.category || '').trim(),
    String(event.subject || '').trim(),
    JSON.stringify(event.metadata || {}),
    now,
    now
  ]);
}

function caseMetadata(row, prosecutorFlag) {
  return {
    general_case_id: Number(row.source_id || row.id || 0),
    case_no: row.case_no || '',
    court_no: row.court_no || '',
    control_flag: flag(row.control_flag),
    attendance_flag: flag(row.attendance_flag),
    review_show_flag: flag(row.review_show_flag),
    emergency_fund_flag: flag(row.emergency_fund_flag),
    registry_flag: flag(row.registry_flag),
    prosecutor_claim_flag: flag(prosecutorFlag)
  };
}

function appealKey(caseId, item, index) {
  const stable = String(item?.counter_id || item?.event_id || item?.id || '').trim();
  return `appeal:${caseId}:${stable || `legacy-${index + 1}`}`;
}

async function bootstrapCases(dbPath, rows, extraFlags) {
  for (const row of rows) {
    const caseId = Number(row.source_id || row.id || 0);
    if (!caseId) continue;
    const eventDate = row.created_at || row.registration_date || row.archived_at || new Date().toISOString();
    const prosecutorFlag = extraFlags.get(caseId) || 0;
    await upsertEvent(dbPath, {
      event_type: 'case',
      source_key: `case:${caseId}`,
      event_date: eventDate,
      employee: row.executor,
      category: row.category,
      subject: row.claim_subject,
      metadata: caseMetadata(row, prosecutorFlag)
    });

    const appeals = parseJson(row.appeals_json, []);
    if (!Array.isArray(appeals)) continue;
    for (let index = 0; index < appeals.length; index += 1) {
      const item = appeals[index] || {};
      if (isHearingCalculatorItem(item) || !hasDatedAppeal(item)) continue;
      await upsertEvent(dbPath, {
        event_type: 'appeal',
        source_key: appealKey(caseId, item, index),
        event_date: item.counter_created_at || item.created_at || eventDate,
        employee: row.executor,
        category: row.category,
        subject: row.claim_subject,
        metadata: {
          general_case_id: caseId,
          kind: item.appeal_kind || item.kind || item.title || 'Обжалование',
          event_date: item.date || item.event_date || item.appeal_date || '',
          counter_id: item.counter_id || `legacy-${index + 1}`
        }
      });
    }
  }
}

async function bootstrap(dbPath) {
  const migrated = await get(dbPath, 'SELECT key FROM schema_migrations WHERE key=?', [BOOTSTRAP_KEY]).catch(() => null);
  if (migrated) return;
  await run(dbPath, "DELETE FROM report_event_ledger WHERE event_type='appeal'").catch(() => {});
  const flagRows = await all(dbPath, 'SELECT general_case_id,prosecutor_claim_flag FROM general_case_extra_flags').catch(() => []);
  const extraFlags = new Map(flagRows.map(row => [Number(row.general_case_id), flag(row.prosecutor_claim_flag)]));
  await bootstrapCases(dbPath, await all(dbPath, 'SELECT * FROM general_cases').catch(() => []), extraFlags);
  await bootstrapCases(dbPath, await all(dbPath, 'SELECT * FROM general_cases_archive').catch(() => []), extraFlags);

  const hearings = await all(dbPath, `SELECT s.*,g.executor AS case_executor,g.category AS case_category,g.claim_subject
    FROM court_schedule s LEFT JOIN general_cases g ON g.id=s.general_case_id
    WHERE COALESCE(s.is_date_row,0)=0`).catch(() => []);
  for (const row of hearings) {
    await upsertEvent(dbPath, {
      event_type: 'hearing',
      source_key: `hearing:${row.id}`,
      event_date: row.created_at || row.updated_at || row.session_date || row.hearing_date,
      employee: row.representative || row.case_executor,
      category: row.case_category || row.category,
      subject: row.claim_subject || row.result,
      metadata: {
        schedule_id: row.id,
        session_date: row.session_date || row.hearing_date || '',
        court: row.court || '',
        time: row.time || '',
        general_case_id: row.general_case_id || null
      }
    });
  }
  await run(dbPath, 'INSERT OR REPLACE INTO schema_migrations (key,applied_at) VALUES (?,?)', [BOOTSTRAP_KEY, new Date().toISOString()]);
}

function inScope(row, names) {
  return !names.length || names.some(name => namesMatch(row.employee, name));
}

function change(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function counters(rows) {
  return {
    cases: rows.filter(row => row.event_type === 'case').length,
    hearings: rows.filter(row => row.event_type === 'hearing').length,
    appeals: rows.filter(row => row.event_type === 'appeal').length
  };
}

function executorRows(quarterCases, ytdCases) {
  const map = new Map();
  const add = (row, field) => {
    const executor = String(row.employee || 'Не указан').trim() || 'Не указан';
    const key = normalizeName(executor) || executor;
    if (!map.has(key)) map.set(key, { executor, categories: new Set(), quarter_count: 0, ytd_count: 0 });
    const item = map.get(key);
    item[field] += 1;
    if (field === 'quarter_count' && row.category) item.categories.add(row.category);
  };
  ytdCases.forEach(row => add(row, 'ytd_count'));
  quarterCases.forEach(row => add(row, 'quarter_count'));
  return [...map.values()].map(row => ({ ...row, categories: [...row.categories].sort((a, b) => a.localeCompare(b, 'ru')) }))
    .sort((a, b) => b.quarter_count - a.quarter_count || a.executor.localeCompare(b.executor, 'ru'));
}

function categoryRows(caseRows) {
  const map = new Map();
  for (const row of caseRows) {
    const category = String(row.category || 'Без категории').trim() || 'Без категории';
    const subject = String(row.subject || 'Без предмета спора').trim() || 'Без предмета спора';
    const key = `${category}\u0000${subject}`;
    const item = map.get(key) || { category, subject, count: 0 };
    item.count += 1;
    map.set(key, item);
  }
  const total = caseRows.length || 1;
  return [...map.values()].map(row => ({ ...row, share: row.count / total * 100 }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ru'));
}

function markerRows(caseRows) {
  const counts = new Map(MARKERS.map(([, label]) => [label, 0]));
  for (const row of caseRows) {
    const metadata = parseJson(row.metadata_json, {});
    for (const [field, label] of MARKERS) {
      if (flag(metadata[field])) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

async function syncCaseEvents(dbPath, row, prosecutorFlag = 0) {
  const caseId = Number(row?.source_id || row?.id || 0);
  if (!caseId) return;
  const eventDate = row.created_at || row.registration_date || row.archived_at || new Date().toISOString();
  await upsertEvent(dbPath, {
    event_type: 'case',
    source_key: `case:${caseId}`,
    event_date: eventDate,
    employee: row.executor,
    category: row.category,
    subject: row.claim_subject,
    metadata: caseMetadata(row, prosecutorFlag)
  });

  const appeals = parseJson(row.appeals_json, []);
  const sourceKeys = [];
  if (Array.isArray(appeals)) {
    for (let index = 0; index < appeals.length; index += 1) {
      const item = appeals[index] || {};
      if (isHearingCalculatorItem(item) || !hasDatedAppeal(item)) continue;
      const sourceKey = appealKey(caseId, item, index);
      sourceKeys.push(sourceKey);
      await upsertEvent(dbPath, {
        event_type: 'appeal',
        source_key: sourceKey,
        event_date: item.counter_created_at || item.created_at || eventDate,
        employee: row.executor,
        category: row.category,
        subject: row.claim_subject,
        metadata: {
          general_case_id: caseId,
          kind: item.appeal_kind || item.kind || item.title || 'Обжалование',
          event_date: item.date || item.event_date || item.appeal_date || '',
          counter_id: item.counter_id || `legacy-${index + 1}`
        }
      });
    }
  }

  const prefix = `appeal:${caseId}:%`;
  if (sourceKeys.length) {
    const placeholders = sourceKeys.map(() => '?').join(',');
    await run(dbPath, `DELETE FROM report_event_ledger WHERE source_key LIKE ? AND source_key NOT IN (${placeholders})`, [prefix, ...sourceKeys]);
  } else {
    await run(dbPath, 'DELETE FROM report_event_ledger WHERE source_key LIKE ?', [prefix]);
  }
}

async function registerHearing(dbPath, row = {}) {
  const scheduleId = Number(row.id || row.schedule_id || 0);
  if (!scheduleId || Number(row.is_date_row || 0) === 1) return;
  await upsertEvent(dbPath, {
    event_type: 'hearing',
    source_key: `hearing:${scheduleId}`,
    event_date: row.created_at || row.updated_at || row.session_date || row.hearing_date,
    employee: row.representative || row.case_executor,
    category: row.case_category || row.category,
    subject: row.claim_subject || row.result,
    metadata: {
      schedule_id: scheduleId,
      session_date: row.session_date || row.hearing_date || '',
      court: row.court || '',
      time: row.time || '',
      general_case_id: Number(row.general_case_id || 0) || null
    }
  });
}

async function deleteHearing(dbPath, scheduleId) {
  const id = Number(scheduleId || 0);
  if (id) await run(dbPath, 'DELETE FROM report_event_ledger WHERE source_key=?', [`hearing:${id}`]);
}

async function deleteCaseEvents(dbPath, caseId) {
  const id = Number(caseId || 0);
  if (!id) return;
  await run(dbPath, 'DELETE FROM general_case_extra_flags WHERE general_case_id=?', [id]);
  await run(dbPath, `DELETE FROM report_event_ledger
    WHERE source_key=? OR source_key LIKE ?
      OR json_extract(COALESCE(metadata_json,'{}'),'$.general_case_id')=?`, [`case:${id}`, `appeal:${id}:%`, id]);
}

function reportQuarterMonths(year, quarter) {
  const startMonth = ((Number(quarter) || 1) - 1) * 3;
  return [0, 1, 2].map(offset => {
    const date = new Date(year, startMonth + offset, 1);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      label: new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(date)
    };
  });
}

function monthlyInflowRows(caseRows, year, quarter) {
  return reportQuarterMonths(year, quarter).map(item => {
    const count = caseRows.filter(row => {
      const date = parseDate(row.event_date || row.created_at);
      if (!date) return false;
      const reportPeriod = periodOf(row.event_date || row.created_at);
      const reportMonth = reportPeriod.quarter === 1 && date.getMonth() === 11 && date.getDate() >= 30
        ? 1
        : date.getMonth() + 1;
      return reportPeriod.year === year && reportPeriod.quarter === quarter && reportMonth === item.month;
    }).length;
    return {
      year: item.year,
      month: item.month,
      label: item.label,
      count
    };
  });
}

function appealBreakdown(rows) {
  const map = new Map();
  for (const row of rows) {
    const metadata = parseJson(row.metadata_json, {});
    const label = String(metadata.kind || 'Обжалование').trim() || 'Обжалование';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

async function dayHearings(dbPath, reportDate, scopeNames) {
  const rows = await all(dbPath, `SELECT s.*,g.executor AS case_executor,g.case_no,g.court_no,g.claim_subject
    FROM court_schedule s LEFT JOIN general_cases g ON g.id=s.general_case_id
    WHERE COALESCE(s.is_date_row,0)=0 ORDER BY COALESCE(s.time,'') ASC,s.id ASC`).catch(() => []);
  const key = isoDate(reportDate, false);
  return rows.map(row => ({
    id: row.id,
    session_date: row.session_date || row.hearing_date || '',
    time: row.time || row.time_val || '',
    court: row.court || '',
    employee: row.representative || row.case_executor || '',
    representative: row.representative || row.case_executor || '',
    case_no: row.case_no || row.court_no || '',
    subject: row.result || row.claim_subject || ''
  })).filter(row => key && isoDate(row.session_date, false) === key && inScope(row, scopeNames));
}

async function summary(dbPath, { year, quarter, reportDate, scopeNames }) {
  await bootstrap(dbPath);
  const current = (await all(dbPath, 'SELECT * FROM report_event_ledger WHERE report_year=? AND report_quarter=?', [year, quarter])).filter(row => inScope(row, scopeNames));
  const previous = (await all(dbPath, 'SELECT * FROM report_event_ledger WHERE report_year=? AND report_quarter=?', [year - 1, quarter])).filter(row => inScope(row, scopeNames));
  const ytd = (await all(dbPath, 'SELECT * FROM report_event_ledger WHERE report_year=? AND report_quarter<=?', [year, quarter])).filter(row => inScope(row, scopeNames));
  const currentCounters = counters(current);
  const previousCounters = counters(previous);
  const cases = current.filter(row => row.event_type === 'case');
  const ytdCases = ytd.filter(row => row.event_type === 'case');
  const appeals = current.filter(row => row.event_type === 'appeal');
  const markers = markerRows(cases);
  return {
    counters: currentCounters,
    dynamics: {
      cases: change(currentCounters.cases, previousCounters.cases),
      hearings: change(currentCounters.hearings, previousCounters.hearings),
      appeals: change(currentCounters.appeals, previousCounters.appeals)
    },
    day_hearings: await dayHearings(dbPath, reportDate, scopeNames),
    executor_report: executorRows(cases, ytdCases),
    monthly_inflow: monthlyInflowRows(cases, year, quarter),
    category_subject_rows: categoryRows(cases),
    marker_distribution: markers,
    department_totals: {
      hearings: currentCounters.hearings,
      appeals: currentCounters.appeals,
      prosecutor_claims: markers.find(item => item.label === 'Иск прокурора')?.count || 0,
      appeal_breakdown: appealBreakdown(appeals)
    },
    categories: REPORT_CATEGORIES
  };
}

async function getFlags(dbPath) {
  return all(dbPath, 'SELECT general_case_id,prosecutor_claim_flag FROM general_case_extra_flags');
}

async function saveFlag(dbPath, caseId, value) {
  const prosecutorFlag = flag(value);
  await run(dbPath, `INSERT INTO general_case_extra_flags (general_case_id,prosecutor_claim_flag,updated_at)
    VALUES (?,?,?) ON CONFLICT(general_case_id) DO UPDATE SET prosecutor_claim_flag=excluded.prosecutor_claim_flag,updated_at=excluded.updated_at`,
  [caseId, prosecutorFlag, new Date().toISOString()]);
  const row = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [caseId])
    || await get(dbPath, 'SELECT * FROM general_cases_archive WHERE source_id=? ORDER BY id DESC LIMIT 1', [caseId]);
  if (row) {
    await syncCaseEvents(dbPath, row, prosecutorFlag);
  }
  return { general_case_id: caseId, prosecutor_claim_flag: prosecutorFlag };
}

module.exports = {
  REPORT_CATEGORIES,
  ensureSchema,
  all,
  get,
  registerEvent: upsertEvent,
  syncCaseEvents,
  registerHearing,
  deleteHearing,
  deleteCaseEvents,
  summary,
  getFlags,
  saveFlag,
  namesMatch
};
