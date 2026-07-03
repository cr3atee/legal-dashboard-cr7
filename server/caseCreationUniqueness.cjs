const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}

async function ensureCaseCreationUniqueness(dbPath) {
  const db = openDb(dbPath);
  try {
    await exec(db, `
      CREATE TRIGGER IF NOT EXISTS prevent_duplicate_controlled_general_case
      BEFORE INSERT ON controlled_cases
      WHEN NEW.general_case_id IS NOT NULL
        AND CAST(NEW.general_case_id AS INTEGER) <> 0
        AND EXISTS (
          SELECT 1
          FROM controlled_cases
          WHERE CAST(general_case_id AS INTEGER) = CAST(NEW.general_case_id AS INTEGER)
        )
      BEGIN
        SELECT RAISE(ABORT, 'duplicate_controlled_general_case');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_duplicate_general_case_number
      BEFORE INSERT ON general_cases
      WHEN TRIM(COALESCE(NEW.case_no, '')) <> ''
        AND LOWER(TRIM(COALESCE(NEW.case_no, ''))) <> LOWER('Без № ПК')
        AND EXISTS (
          SELECT 1
          FROM general_cases
          WHERE LOWER(REPLACE(REPLACE(TRIM(COALESCE(case_no, '')), '№', ''), ' ', ''))
              = LOWER(REPLACE(REPLACE(TRIM(COALESCE(NEW.case_no, '')), '№', ''), ' ', ''))
        )
      BEGIN
        SELECT RAISE(ABORT, 'duplicate_general_case_number');
      END;
    `);
  } finally {
    db.close();
  }
}

module.exports = { ensureCaseCreationUniqueness };
