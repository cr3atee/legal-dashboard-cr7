const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
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

function parseArchiveData(row = {}) {
  try {
    const value = JSON.parse(row.data || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

async function handleLinkedCaseLifecycle(req, res, url, dbPath) {
  const controlledArchiveDelete = url.pathname.match(/^\/api\/controlled-cases\/archive\/(\d+)$/);
  if (controlledArchiveDelete && req.method === 'DELETE') {
    const db = openDb(dbPath);
    try {
      const archiveId = Number(controlledArchiveDelete[1]);
      const archiveRow = await get(db, 'SELECT * FROM archive WHERE id=? AND table_name=?', [archiveId, 'controlled_cases']);
      if (!archiveRow) {
        sendJson(res, 404, { error: 'archive_record_not_found' });
        return true;
      }

      const controlledData = parseArchiveData(archiveRow);
      const originalGeneralId = Number(controlledData.general_case_id || 0);

      await run(db, 'BEGIN IMMEDIATE');
      try {
        await run(db, 'DELETE FROM archive WHERE id=? AND table_name=?', [archiveId, 'controlled_cases']);
        if (originalGeneralId) {
          await run(db, 'DELETE FROM general_cases_archive WHERE source_id=?', [originalGeneralId]);
        }
        await run(db, 'COMMIT');
      } catch (error) {
        try { await run(db, 'ROLLBACK'); } catch {}
        throw error;
      }

      sendJson(res, 200, { ok: true, linked_general_archive_deleted: Boolean(originalGeneralId) });
      return true;
    } catch (error) {
      sendJson(res, 500, { error: 'linked_archive_delete_failed', message: error?.message || 'Не удалось удалить связанные архивные записи' });
      return true;
    } finally {
      db.close();
    }
  }

  return false;
}

module.exports = { handleLinkedCaseLifecycle };
