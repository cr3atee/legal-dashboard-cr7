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

async function sessionForRequest(db, req) {
  const rawId = String(req.headers?.['x-user-id'] || '').trim();
  const rawName = decodeURIComponent(String(req.headers?.['x-user-name'] || '').trim());

  if (/^\d+$/.test(rawId)) {
    const byId = await get(db, `
      SELECT id, full_name, COALESCE(role_level, 0) AS role_level
      FROM users
      WHERE id=? AND COALESCE(is_active,1)=1
      LIMIT 1
    `, [Number(rawId)]);
    if (byId) return byId;
  }

  if (rawName) {
    return get(db, `
      SELECT id, full_name, COALESCE(role_level, 0) AS role_level
      FROM users
      WHERE full_name=? AND COALESCE(is_active,1)=1
      LIMIT 1
    `, [rawName]);
  }

  return null;
}

async function ensureGeneralCaseCancellationSchema(dbPath) {
  const db = openDb(dbPath);
  try {
    await run(db, `CREATE TABLE IF NOT EXISTS general_cases_cancelled AS
      SELECT *, '' AS cancelled_at, '' AS cancelled_by FROM general_cases WHERE 0`);
    const sourceColumns = await all(db, `PRAGMA table_info(general_cases)`);
    const targetColumns = await all(db, `PRAGMA table_info(general_cases_cancelled)`);
    const targetNames = new Set(targetColumns.map(column => column.name));
    for (const column of sourceColumns) {
      if (targetNames.has(column.name)) continue;
      await run(db, `ALTER TABLE general_cases_cancelled ADD COLUMN "${String(column.name).replaceAll('"', '""')}" ${column.type || 'TEXT'}`);
    }
    if (!targetNames.has('cancelled_at')) await run(db, `ALTER TABLE general_cases_cancelled ADD COLUMN cancelled_at TEXT DEFAULT ''`).catch(() => {});
    if (!targetNames.has('cancelled_by')) await run(db, `ALTER TABLE general_cases_cancelled ADD COLUMN cancelled_by TEXT DEFAULT ''`).catch(() => {});
    await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_general_cases_cancelled_id ON general_cases_cancelled(id)`).catch(() => {});
  } finally {
    db.close();
  }
}

async function moveCase(db, id, cancel, userName) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    if (cancel) {
      const row = await get(db, 'SELECT * FROM general_cases WHERE id=?', [id]);
      if (!row) throw new Error('Дело не найдено');
      const columns = Object.keys(row);
      const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
      const placeholders = columns.map(() => '?').join(',');
      await run(db, `INSERT INTO general_cases_cancelled (${names}, cancelled_at, cancelled_by) VALUES (${placeholders}, ?, ?)`, [...columns.map(name => row[name]), new Date().toISOString(), userName]);
      await run(db, 'DELETE FROM general_cases WHERE id=?', [id]);
    } else {
      const row = await get(db, 'SELECT * FROM general_cases_cancelled WHERE id=?', [id]);
      if (!row) throw new Error('Отменённое дело не найдено');
      const columns = Object.keys(row).filter(name => !['cancelled_at', 'cancelled_by'].includes(name));
      const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
      const placeholders = columns.map(() => '?').join(',');
      await run(db, `INSERT INTO general_cases (${names}) VALUES (${placeholders})`, columns.map(name => row[name]));
      await run(db, 'DELETE FROM general_cases_cancelled WHERE id=?', [id]);
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
    const isAdmin = Number(session?.role_level || 0) >= 2;

    if (path === '/api/general-cases' && req.method === 'GET' && url.searchParams.get('archived') !== '1' && isAdmin) {
      const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
      const active = await all(db, 'SELECT *, 0 AS cancelled_flag, "" AS cancelled_at, "" AS cancelled_by FROM general_cases');
      const cancelled = await all(db, 'SELECT *, 1 AS cancelled_flag FROM general_cases_cancelled');
      let rows = [...active, ...cancelled];
      if (search) rows = rows.filter(row => Object.values(row).some(value => String(value ?? '').toLowerCase().includes(search)));
      rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      sendJson(res, 200, rows.slice(0, 2000));
      return true;
    }

    const caseMatch = path.match(/^\/api\/general-cases\/(\d+)$/);
    if (caseMatch && req.method === 'GET' && isAdmin) {
      const id = Number(caseMatch[1]);
      const row = await get(db, 'SELECT *, 1 AS cancelled_flag FROM general_cases_cancelled WHERE id=?', [id]);
      if (row) {
        sendJson(res, 200, row);
        return true;
      }
    }

    const statusMatch = path.match(/^\/api\/general-cases\/(\d+)\/cancel-status$/);
    if (statusMatch && req.method === 'GET') {
      if (!isAdmin) { sendJson(res, 403, { error: 'forbidden' }); return true; }
      const id = Number(statusMatch[1]);
      const row = await get(db, 'SELECT id, cancelled_at, cancelled_by FROM general_cases_cancelled WHERE id=?', [id]);
      sendJson(res, 200, { cancelled: Boolean(row), ...(row || {}) });
      return true;
    }

    const cancelMatch = path.match(/^\/api\/general-cases\/(\d+)\/(cancel|restore-cancelled)$/);
    if (cancelMatch && req.method === 'POST') {
      if (!isAdmin) { sendJson(res, 403, { error: 'forbidden' }); return true; }
      const id = Number(cancelMatch[1]);
      const cancel = cancelMatch[2] === 'cancel';
      await moveCase(db, id, cancel, session.full_name || 'Администратор');
      sendJson(res, 200, { ok: true, id, cancelled: cancel });
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
