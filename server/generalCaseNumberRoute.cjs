const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
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

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row || null);
    });
  });
}

async function ensureGeneralCaseNumberSchema(dbPath) {
  const db = openDb(dbPath);
  try {
    await run(db, `CREATE TABLE IF NOT EXISTS general_case_number_sequences (
      year INTEGER PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_general_cases_case_no_unique
      ON general_cases(case_no)
      WHERE TRIM(COALESCE(case_no, '')) <> ''`).catch(() => {});
  } finally {
    db.close();
  }
}

async function reserveNextGeneralCaseNumber(dbPath) {
  const db = openDb(dbPath);
  const year = new Date().getFullYear();
  try {
    await run(db, 'BEGIN IMMEDIATE');

    const sequence = await get(db, 'SELECT last_number FROM general_case_number_sequences WHERE year=?', [year]);
    let lastNumber = Number(sequence?.last_number || 0);

    if (!sequence) {
      const active = await get(db, `
        SELECT MAX(CAST(substr(case_no, 1, instr(case_no, '/') - 1) AS INTEGER)) AS max_no
        FROM general_cases
        WHERE case_no GLOB '[0-9]*/${year}'
      `);
      const archived = await get(db, `
        SELECT MAX(CAST(substr(case_no, 1, instr(case_no, '/') - 1) AS INTEGER)) AS max_no
        FROM general_cases_archive
        WHERE case_no GLOB '[0-9]*/${year}'
      `).catch(() => null);
      lastNumber = Math.max(Number(active?.max_no || 0), Number(archived?.max_no || 0));
      await run(db, 'INSERT INTO general_case_number_sequences (year, last_number, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [year, lastNumber]);
    }

    const nextNumber = lastNumber + 1;
    await run(db, 'UPDATE general_case_number_sequences SET last_number=?, updated_at=CURRENT_TIMESTAMP WHERE year=?', [nextNumber, year]);
    await run(db, 'COMMIT');
    return { case_no: `${nextNumber}/${year}`, year, number: nextNumber };
  } catch (error) {
    try { await run(db, 'ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

async function handleGeneralCaseNumber(req, res, url, dbPath) {
  if (req.method !== 'POST' || url.pathname !== '/api/general-cases/next-number') return false;
  try {
    const result = await reserveNextGeneralCaseNumber(dbPath);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: 'general_case_number_failed', message: error?.message || 'Не удалось сформировать № ПК' });
  }
  return true;
}

module.exports = {
  ensureGeneralCaseNumberSchema,
  handleGeneralCaseNumber,
  reserveNextGeneralCaseNumber
};
