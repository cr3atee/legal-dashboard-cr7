const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
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

function all(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.all(sql, params, (error, rows) => {
      db.close();
      error ? reject(error) : resolve(rows || []);
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function readToken(req) {
  const header = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
}

async function handleCalendarUsers(req, res, url, dbPath) {
  if (url.pathname !== '/api/calendar-users' || req.method !== 'GET') return false;

  const token = readToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'auth_required' });
    return true;
  }

  const session = await get(dbPath, `
    SELECT s.user_id, s.full_name, COALESCE(u.role_level, s.role_level, 1) AS role_level,
           COALESCE(u.is_active, 1) AS is_active
    FROM app_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.token=?
      AND (s.expires_at='' OR s.expires_at IS NULL OR s.expires_at>?)
    LIMIT 1
  `, [token, new Date().toISOString()]).catch(() => null);

  if (!session || Number(session.is_active || 0) !== 1) {
    sendJson(res, 401, { error: 'auth_required' });
    return true;
  }

  if (Number(session.role_level || 0) < 2) {
    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  const users = await all(dbPath, `
    SELECT id, full_name
    FROM users
    WHERE COALESCE(role_level, 1)=1
      AND COALESCE(is_active, 1)=1
      AND TRIM(COALESCE(full_name, ''))<>''
    ORDER BY full_name COLLATE NOCASE, id
  `).catch(() => []);

  sendJson(res, 200, users.map(user => ({
    id: Number(user.id),
    full_name: String(user.full_name || '').trim()
  })));
  return true;
}

module.exports = { handleCalendarUsers };
