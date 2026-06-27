const { getReportSession, canManageAllReports } = require('./reportMetricsAuth.cjs');

async function reportAccess(req, dbPath) {
  const session = await getReportSession(req, dbPath);
  return session ? { session, manageAll: canManageAllReports(session) } : null;
}

module.exports = { reportAccess };
