const store = require('./reportEventStore.cjs');

function requestToken(req) {
  const header = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
}

async function getReportSession(req, dbPath) {
  const token = requestToken(req);
  if (!token) return null;
  const row = await store.get(dbPath, `SELECT s.user_id AS id,s.full_name,s.role_level,s.permissions_json,s.expires_at,u.is_active
    FROM app_sessions s LEFT JOIN users u ON u.id=s.user_id WHERE s.token=? LIMIT 1`, [token]).catch(() => null);
  if (!row || Number(row.is_active ?? 1) !== 1) return null;
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt && expiresAt <= Date.now()) return null;
  try { row.permissions = JSON.parse(row.permissions_json || '[]'); }
  catch { row.permissions = []; }
  return row;
}

function canManageAllReports(session) {
  return Number(session?.role_level || 0) >= 2
    || (Array.isArray(session?.permissions) && session.permissions.includes('reports.manageAll'));
}

module.exports = { getReportSession, canManageAllReports };
