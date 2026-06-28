const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const core = require('./sqliteApi.cjs');
const { ensureReportMetricsSchema, handleReportMetrics } = require('./reportMetricsRoute.cjs');
const { handleReportMetricsWrite } = require('./reportMetricsWriteRoute.cjs');
const { ensureCaseSuggestionSeeds } = require('./caseSuggestionSeeds.cjs');
const { handleCalendarUsers } = require('./calendarUsersRoute.cjs');

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 3000);
  return db;
}

function dbAll(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.all(sql, params, (error, rows) => {
      db.close();
      error ? reject(error) : resolve(rows || []);
    });
  });
}

function dbGet(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.get(sql, params, (error, row) => {
      db.close();
      error ? reject(error) : resolve(row || null);
    });
  });
}

function dbRun(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.run(sql, params, function(error) {
      db.close();
      error ? reject(error) : resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function sendJson(res, status, payload) {
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  if (!res.writableEnded) res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function verifyPassword(password, user) {
  const value = String(password || '');
  if (user.password_hash && user.password_salt && user.password_scheme === 'scrypt') {
    try {
      const actual = Buffer.from(crypto.scryptSync(value, String(user.password_salt), 32).toString('hex'), 'hex');
      const expected = Buffer.from(String(user.password_hash), 'hex');
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch { return false; }
  }
  return Boolean(user.password) && String(user.password) === value;
}

function rolePermissions(level) {
  const permissions = new Set([
    'dashboard.view', 'cases.view', 'cases.edit.own', 'calendar.view.own',
    'calendar.edit.own', 'schedule.view.own', 'schedule.edit.own',
    'users.lookup', 'dictionaries.view'
  ]);
  if (level >= 2) {
    permissions.add('reports.view');
    permissions.add('reports.manageAll');
  }
  if (level >= 3) {
    [
      'cases.view.any', 'cases.edit.any', 'controlledCases.view', 'controlledCases.edit',
      'calendar.view.any', 'calendar.edit.any', 'schedule.view.any', 'schedule.edit.any',
      'enforcement.view', 'map.view', 'registry.view', 'emergencyFund.view',
      'meetings.view', 'users.manage', 'users.create', 'users.update',
      'users.resetPassword', 'permissions.manage', 'dictionaries.manage'
    ].forEach(value => permissions.add(value));
  }
  if (level >= 4) {
    permissions.add('roles.manage');
    permissions.add('techAdmin.assign');
    permissions.add('technical.access');
  }
  return permissions;
}

async function ensureFastAuthTables(dbPath) {
  await dbRun(dbPath, `CREATE TABLE IF NOT EXISTS app_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER,
    full_name TEXT DEFAULT '',
    is_admin INTEGER DEFAULT 0,
    role_level INTEGER DEFAULT 1,
    permissions_json TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT DEFAULT ''
  )`);
}

function bearerToken(req) {
  const value = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : value;
}

async function handleFastAuth(req, res, url, dbPath) {
  const path = url.pathname;
  if (!path.startsWith('/api/auth/') && path !== '/api/health') return false;

  if (path === '/api/health') {
    sendJson(res, 200, { ok: true, dbPath });
    return true;
  }

  await ensureFastAuthTables(dbPath);

  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req);
    const password = String(body.password || '').trim();
    if (!password) {
      sendJson(res, 400, { error: 'password_required' });
      return true;
    }

    const users = await dbAll(dbPath, 'SELECT * FROM users WHERE COALESCE(is_active,1)=1 ORDER BY id');
    const user = users.find(row => verifyPassword(password, row));
    if (!user) {
      sendJson(res, 401, { error: 'invalid_password' });
      return true;
    }

    const roleLevel = Math.max(1, Math.min(4, Number(user.role_level || (user.is_admin ? 3 : 1))));
    const individual = await dbAll(dbPath, 'SELECT permission FROM user_permissions WHERE user_id=?', [user.id])
      .then(rows => rows.map(row => String(row.permission || '')).filter(Boolean))
      .catch(() => []);
    const permissions = [...new Set([...rolePermissions(roleLevel), ...individual])];
    const token = crypto.randomBytes(32).toString('hex');
    const fullName = user.full_name || user.name || 'Пользователь';
    const roleNames = { 1: 'Участник', 2: 'Администратор отчетов', 3: 'Главный администратор', 4: 'Технический администратор' };
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await dbRun(dbPath, `INSERT OR REPLACE INTO app_sessions
      (token,user_id,full_name,is_admin,role_level,permissions_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`, [
      token, user.id, fullName, roleLevel >= 3 ? 1 : 0, roleLevel,
      JSON.stringify(permissions), new Date().toISOString(), expiresAt
    ]);

    sendJson(res, 200, {
      ok: true,
      id: user.id,
      full_name: fullName,
      is_admin: roleLevel >= 3,
      role_level: roleLevel,
      role_name: roleNames[roleLevel],
      permissions,
      individual_permissions: individual,
      token
    });
    return true;
  }

  if (path === '/api/auth/me' && req.method === 'GET') {
    const token = bearerToken(req);
    const row = token ? await dbGet(dbPath, `SELECT * FROM app_sessions
      WHERE token=? AND (COALESCE(expires_at,'')='' OR expires_at>?)`, [token, new Date().toISOString()]) : null;
    if (!row) {
      sendJson(res, 401, { error: 'auth_required' });
      return true;
    }
    let permissions = [];
    try { permissions = JSON.parse(row.permissions_json || '[]'); } catch {}
    const roleNames = { 1: 'Участник', 2: 'Администратор отчетов', 3: 'Главный администратор', 4: 'Технический администратор' };
    sendJson(res, 200, {
      id: row.user_id,
      full_name: row.full_name,
      is_admin: Number(row.is_admin || 0) === 1,
      role_level: Number(row.role_level || 1),
      role_name: roleNames[Number(row.role_level || 1)],
      permissions,
      individual_permissions: [],
      token
    });
    return true;
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = bearerToken(req);
    if (token) await dbRun(dbPath, 'DELETE FROM app_sessions WHERE token=?', [token]).catch(() => {});
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function ensureSchema(dbPath) {
  await core.ensureSchema(dbPath);
  await ensureCaseSuggestionSeeds(dbPath);
  await ensureReportMetricsSchema(dbPath);
}

async function handleApiRequest(req, res, url, dbPath) {
  if (await handleFastAuth(req, res, url, dbPath)) return true;
  if (await handleCalendarUsers(req, res, url, dbPath)) return true;
  if (await handleReportMetrics(req, res, url, dbPath)) return true;
  if (await handleReportMetricsWrite(req, res, url, dbPath)) return true;
  return core.handleApiRequest(req, res, url, dbPath);
}

module.exports = { ensureSchema, handleApiRequest };
