const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve({ id: this.lastID, changes: this.changes });
  }));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function requestToken(req) {
  const header = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
}

async function sessionForRequest(db, req) {
  const token = requestToken(req);
  if (!token) return null;
  return get(db, `
    SELECT u.id, u.full_name, COALESCE(u.role_level, 0) AS role_level,
           COALESCE(s.permissions_json, '[]') AS permissions_json
    FROM app_sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token=?
      AND COALESCE(u.is_active,1)=1
      AND (COALESCE(s.expires_at,'')='' OR s.expires_at>?)
    LIMIT 1
  `, [token, new Date().toISOString()]);
}

function canViewAny(session) {
  if (Number(session?.role_level || 0) >= 2) return true;
  try {
    return JSON.parse(session?.permissions_json || '[]').includes('cases.view.any');
  } catch {
    return false;
  }
}

async function ensureColumn(db, table, column, definition) {
  const columns = await all(db, `PRAGMA table_info(${table})`);
  if (!columns.some(item => item.name === column)) {
    await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function restoreLegacyCancelledRows(db) {
  const legacyTable = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='general_cases_cancelled'");
  if (!legacyTable) return;
  const rows = await all(db, 'SELECT * FROM general_cases_cancelled');
  for (const row of rows) {
    const exists = await get(db, 'SELECT id FROM general_cases WHERE id=?', [row.id]);
    if (!exists) {
      const columns = Object.keys(row).filter(name => !['cancelled_at', 'cancelled_by'].includes(name));
      const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
      const placeholders = columns.map(() => '?').join(',');
      await run(db, `INSERT INTO general_cases (${names}) VALUES (${placeholders})`, columns.map(name => row[name]));
    }
    await run(db, `UPDATE general_cases
      SET cancelled_flag=1,
          cancelled_at=COALESCE(NULLIF(?,''), cancelled_at),
          cancelled_by=COALESCE(NULLIF(?,''), cancelled_by)
      WHERE id=?`, [row.cancelled_at || '', row.cancelled_by || '', row.id]);
  }
  await run(db, 'DELETE FROM general_cases_cancelled');
}

async function ensureGeneralCaseCancellationSchema(dbPath) {
  const db = openDb(dbPath);
  try {
    await ensureColumn(db, 'general_cases', 'cancelled_flag', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'general_cases', 'cancelled_at', "TEXT DEFAULT ''");
    await ensureColumn(db, 'general_cases', 'cancelled_by', "TEXT DEFAULT ''");
    await run(db, 'UPDATE general_cases SET cancelled_flag=0 WHERE cancelled_flag IS NULL');

    await run(db, `CREATE TABLE IF NOT EXISTS general_case_cancelled_report_events AS
      SELECT *, 0 AS general_case_id FROM report_event_ledger WHERE 0`).catch(() => {});
    await ensureColumn(db, 'general_case_cancelled_report_events', 'general_case_id', 'INTEGER DEFAULT 0').catch(() => {});
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_cancelled_report_events_case ON general_case_cancelled_report_events(general_case_id)').catch(() => {});

    await restoreLegacyCancelledRows(db);
  } finally {
    db.close();
  }
}

async function removeCaseFromReports(db, id) {
  const ledgerExists = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='report_event_ledger'");
  if (!ledgerExists) return;
  await run(db, 'DELETE FROM general_case_cancelled_report_events WHERE general_case_id=?', [id]).catch(() => {});
  const rows = await all(db, `SELECT * FROM report_event_ledger
    WHERE source_key=? OR source_key LIKE ? OR CAST(json_extract(metadata_json,'$.general_case_id') AS INTEGER)=?`,
  [`case:${id}`, `appeal:${id}:%`, id]).catch(() => []);
  for (const row of rows) {
    const columns = Object.keys(row);
    const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
    const placeholders = columns.map(() => '?').join(',');
    await run(db, `INSERT INTO general_case_cancelled_report_events (${names}, general_case_id) VALUES (${placeholders}, ?)`, [...columns.map(name => row[name]), id]);
  }
  await run(db, `DELETE FROM report_event_ledger
    WHERE source_key=? OR source_key LIKE ? OR CAST(json_extract(metadata_json,'$.general_case_id') AS INTEGER)=?`,
  [`case:${id}`, `appeal:${id}:%`, id]).catch(() => {});
}

async function restoreCaseReportEvents(db, id) {
  const rows = await all(db, 'SELECT * FROM general_case_cancelled_report_events WHERE general_case_id=?', [id]).catch(() => []);
  for (const row of rows) {
    const columns = Object.keys(row).filter(name => name !== 'general_case_id');
    const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
    const placeholders = columns.map(() => '?').join(',');
    await run(db, `INSERT OR REPLACE INTO report_event_ledger (${names}) VALUES (${placeholders})`, columns.map(name => row[name])).catch(() => {});
  }
  await run(db, 'DELETE FROM general_case_cancelled_report_events WHERE general_case_id=?', [id]).catch(() => {});
}

async function setCancelled(db, id, cancelled, userName) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const row = await get(db, 'SELECT * FROM general_cases WHERE id=?', [id]);
    if (!row) throw new Error('Дело не найдено');
    const now = new Date().toISOString();
    if (cancelled) {
      await run(db, `UPDATE general_cases
        SET cancelled_flag=1, cancelled_at=?, cancelled_by=?
        WHERE id=?`, [now, userName, id]);
      await removeCaseFromReports(db, id);
    } else {
      await run(db, `UPDATE general_cases
        SET cancelled_flag=0, cancelled_at='', cancelled_by=''
        WHERE id=?`, [id]);
      await restoreCaseReportEvents(db, id);
    }
    await run(db, 'COMMIT');
  } catch (error) {
    try { await run(db, 'ROLLBACK'); } catch {}
    throw error;
  }
}

async function handleGeneralCaseCancellation(req, res, url, dbPath) {
  const path = url.pathname;
  const db = openDb(dbPath);
  try {
    const session = await sessionForRequest(db, req);
    if (!session) return false;
    const isAdmin = Number(session.role_level || 0) >= 2;

    if (path === '/api/general-cases' && req.method === 'GET' && url.searchParams.get('archived') !== '1') {
      const searchParts = String(url.searchParams.get('search') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      const where = [];
      const params = [];
      if (!isAdmin) where.push('COALESCE(cancelled_flag,0)=0');
      if (!isAdmin && !canViewAny(session)) {
        where.push("COALESCE(executor,'')=?");
        params.push(session.full_name || '');
      }
      let rows = await all(db, `SELECT * FROM general_cases ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);
      if (searchParts.length) {
        rows = rows.filter(row => {
          const text = Object.values(row).map(value => String(value ?? '').toLowerCase()).join(' | ');
          return searchParts.every(part => text.includes(part));
        });
      }
      rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      sendJson(res, 200, rows.slice(0, 2000));
      return true;
    }

    const statusMatch = path.match(/^\/api\/general-cases\/(\d+)\/cancel-status$/);
    if (statusMatch && req.method === 'GET') {
      if (!isAdmin) { sendJson(res, 403, { error: 'forbidden' }); return true; }
      const row = await get(db, 'SELECT id,cancelled_flag,cancelled_at,cancelled_by FROM general_cases WHERE id=?', [Number(statusMatch[1])]);
      sendJson(res, 200, { cancelled: Number(row?.cancelled_flag || 0) === 1, ...(row || {}) });
      return true;
    }

    const cancelMatch = path.match(/^\/api\/general-cases\/(\d+)\/(cancel|restore-cancelled)$/);
    if (cancelMatch && req.method === 'POST') {
      if (!isAdmin) { sendJson(res, 403, { error: 'forbidden' }); return true; }
      const id = Number(cancelMatch[1]);
      const cancelled = cancelMatch[2] === 'cancel';
      await setCancelled(db, id, cancelled, session.full_name || 'Администратор');
      sendJson(res, 200, { ok: true, id, cancelled });
      return true;
    }

    return false;
  } catch (error) {
    sendJson(res, 500, { error: 'general_case_cancellation_failed', message: error?.message || 'Ошибка операции с делом' });
    return true;
  } finally {
    db.close();
  }
}

module.exports = { ensureGeneralCaseCancellationSchema, handleGeneralCaseCancellation };
