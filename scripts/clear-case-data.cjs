const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

function existingFile(candidates) {
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function resolveDbPath() {
  const explicit = process.argv[2] || process.env.LEGAL_DASHBOARD_DB;
  if (explicit) return path.resolve(explicit);

  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(roaming, 'legal-dashboard', 'data', 'app.db'),
    path.join(roaming, 'Legal Dashboard', 'data', 'app.db'),
    path.join(local, 'legal-dashboard', 'data', 'app.db'),
    path.join(local, 'Legal Dashboard', 'data', 'app.db'),
    path.join(process.cwd(), 'data', 'app.db')
  ];
  return existingFile(candidates) || candidates[0];
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
  });
}

async function tableExists(db, table) {
  const rows = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
  return rows.length > 0;
}

async function deleteTableRows(db, table) {
  if (!(await tableExists(db, table))) return 0;
  const result = await run(db, `DELETE FROM "${table}"`);
  return result.changes || 0;
}

async function resetSequence(db, table) {
  if (!(await tableExists(db, 'sqlite_sequence'))) return;
  await run(db, 'DELETE FROM sqlite_sequence WHERE name=?', [table]);
}

async function main() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`База данных не найдена: ${dbPath}`);
  }

  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `app-before-case-cleanup-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);

  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);

  const fullCaseTables = [
    'general_case_review_approvals',
    'general_case_extra_flags',
    'controlled_case_history',
    'controlled_cases',
    'court_schedule',
    'enforcement_proceedings',
    'emergency_fund',
    'registry',
    'report_event_ledger',
    'general_cases_archive',
    'general_cases',
    'meetings'
  ];

  const counts = {};
  try {
    await run(db, 'PRAGMA foreign_keys=OFF');
    await run(db, 'BEGIN IMMEDIATE');

    if (await tableExists(db, 'calendar_tasks')) {
      const result = await run(db, `
        DELETE FROM calendar_tasks
        WHERE COALESCE(general_case_id, 0) <> 0
           OR COALESCE(schedule_id, 0) <> 0
           OR COALESCE(meeting_id, 0) <> 0
           OR LOWER(COALESCE(metadata_json, '')) LIKE '%general_case_id%'
           OR LOWER(COALESCE(metadata_json, '')) LIKE '%schedule_id%'
           OR LOWER(COALESCE(metadata_json, '')) LIKE '%case_id%'
      `);
      counts.calendar_tasks = result.changes || 0;
    }

    if (await tableExists(db, 'archive')) {
      const placeholders = fullCaseTables.map(() => '?').join(',');
      const result = await run(
        db,
        `DELETE FROM archive WHERE table_name IN (${placeholders})`,
        fullCaseTables
      );
      counts.archive = result.changes || 0;
    }

    if (await tableExists(db, 'notification_reads')) {
      const result = await run(db, `
        DELETE FROM notification_reads
        WHERE LOWER(notification_key) LIKE '%case%'
           OR LOWER(notification_key) LIKE '%дел%'
           OR LOWER(notification_key) LIKE '%hearing%'
           OR LOWER(notification_key) LIKE '%schedule%'
      `);
      counts.notification_reads = result.changes || 0;
    }

    for (const table of fullCaseTables) {
      counts[table] = await deleteTableRows(db, table);
      await resetSequence(db, table);
    }

    await run(db, 'COMMIT');
    await run(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
    await run(db, 'VACUUM');
  } catch (error) {
    try { await run(db, 'ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }

  console.log('Данные дел успешно очищены.');
  console.log(`База: ${dbPath}`);
  console.log(`Резервная копия: ${backupPath}`);
  console.table(counts);
  console.log('Сохранены: пользователи, пароли, роли, права, справочники, настройки, участники совещаний и несвязанные личные задачи.');
}

main().catch(error => {
  console.error(`Ошибка очистки: ${error.message}`);
  process.exitCode = 1;
});
