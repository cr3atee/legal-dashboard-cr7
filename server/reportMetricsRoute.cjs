const store = require('./reportEventStore.cjs');

function send(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function scopeNames(dbPath, url) {
  if (url.searchParams.get('all') === '1') return [];
  const ids = String(url.searchParams.get('user_ids') || url.searchParams.get('user_id') || '')
    .split(',').map(Number).filter(Number.isFinite).filter(Boolean);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const rows = await store.all(dbPath, `SELECT full_name FROM users WHERE id IN (${marks})`, ids).catch(() => []);
  return rows.map(row => String(row.full_name || '').trim()).filter(Boolean);
}

async function handleReportMetrics(req, res, url, dbPath) {
  if (url.pathname !== '/api/report-metrics' || req.method !== 'GET') return false;
  await store.ensureSchema(dbPath);
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
  const quarter = Math.min(4, Math.max(1, Number(url.searchParams.get('quarter')) || Math.floor(new Date().getMonth() / 3) + 1));
  const reportDate = url.searchParams.get('report_date') || new Date().toISOString();
  const data = await store.summary(dbPath, { year, quarter, reportDate, scopeNames: await scopeNames(dbPath, url) });
  send(res, 200, { ok: true, year, quarter, report_date: reportDate, reset_rule: '30-12', ...data });
  return true;
}

module.exports = { ensureReportMetricsSchema: store.ensureSchema, handleReportMetrics };
