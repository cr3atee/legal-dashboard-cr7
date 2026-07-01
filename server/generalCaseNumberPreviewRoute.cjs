const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
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

async function maxFrom(db, table, year) {
  const row = await get(db, `
    SELECT MAX(CAST(substr(case_no, 1, instr(case_no, '/') - 1) AS INTEGER)) AS max_no
    FROM ${table}
    WHERE case_no GLOB '[0-9]*/${year}'
  `).catch(() => null);
  return Number(row?.max_no || 0);
}

async function handleGeneralCaseNumberPreview(req, res, url, dbPath) {
  if (req.method !== 'POST' || url.pathname !== '/api/general-cases/next-number') return false;
  const db = openDb(dbPath);
  try {
    const year = new Date().getFullYear();
    const active = await maxFrom(db, 'general_cases', year);
    const archived = await maxFrom(db, 'general_cases_archive', year);
    const cancelled = await maxFrom(db, 'general_cases_cancelled', year);
    const number = Math.max(active, archived, cancelled) + 1;
    sendJson(res, 200, { case_no: `${number}/${year}`, year, number });
  } catch (error) {
    sendJson(res, 500, { error: 'general_case_number_failed', message: error?.message || 'Не удалось сформировать № ПК' });
  } finally {
    db.close();
  }
  return true;
}

module.exports = { handleGeneralCaseNumberPreview };
