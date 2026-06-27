const store = require('./reportEventStore.cjs');

function send(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function read(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1048576) return reject(new Error('request_too_large'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function handleReportMetricsWrite(req, res, url, dbPath) {
  const route = url.pathname;
  if (!['/api/case-extra-flags', '/api/report-metric-events'].includes(route)) return false;
  await store.ensureSchema(dbPath);

  if (route === '/api/case-extra-flags' && req.method === 'GET') {
    const caseId = Number(url.searchParams.get('case_id') || 0);
    const rows = await store.getFlags(dbPath);
    if (!caseId) send(res, 200, { items: rows });
    else send(res, 200, rows.find(row => Number(row.general_case_id) === caseId) || { general_case_id: caseId, prosecutor_claim_flag: 0 });
    return true;
  }

  if (route === '/api/case-extra-flags' && req.method === 'POST') {
    const body = await read(req);
    const caseId = Number(body.general_case_id || body.case_id || 0);
    if (!caseId) send(res, 400, { error: 'general_case_id_required' });
    else send(res, 200, await store.saveFlag(dbPath, caseId, body.prosecutor_claim_flag));
    return true;
  }

  if (route === '/api/report-metric-events' && req.method === 'POST') {
    const body = await read(req);
    const eventType = String(body.event_type || '').trim();
    const sourceKey = String(body.source_key || '').trim();
    if (!['case', 'hearing', 'appeal'].includes(eventType) || !sourceKey) {
      send(res, 400, { error: 'invalid_event' });
      return true;
    }
    await store.registerEvent(dbPath, {
      event_type: eventType,
      source_key: sourceKey,
      event_date: body.event_date || new Date().toISOString(),
      employee: body.employee,
      category: body.category,
      subject: body.subject,
      metadata: body.metadata || {}
    });
    send(res, 200, { ok: true });
    return true;
  }

  send(res, 405, { error: 'method_not_allowed' });
  return true;
}

module.exports = { handleReportMetricsWrite };
