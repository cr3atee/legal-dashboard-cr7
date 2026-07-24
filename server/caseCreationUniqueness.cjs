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

      CREATE TRIGGER IF NOT EXISTS prevent_duplicate_general_case_number_update
      BEFORE UPDATE OF case_no ON general_cases
      WHEN TRIM(COALESCE(NEW.case_no, '')) <> ''
        AND LOWER(TRIM(COALESCE(NEW.case_no, ''))) <> LOWER('Р‘РµР· в„– РџРљ')
        AND EXISTS (
          SELECT 1 FROM general_cases
          WHERE id<>OLD.id
            AND LOWER(REPLACE(REPLACE(TRIM(COALESCE(case_no, '')), 'в„–', ''), ' ', ''))
              = LOWER(REPLACE(REPLACE(TRIM(COALESCE(NEW.case_no, '')), 'в„–', ''), ' ', ''))
        )
      BEGIN
        SELECT RAISE(ABORT, 'duplicate_general_case_number');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_duplicate_controlled_general_case_update
      BEFORE UPDATE OF general_case_id ON controlled_cases
      WHEN NEW.general_case_id IS NOT NULL AND CAST(NEW.general_case_id AS INTEGER)<>0
        AND EXISTS (SELECT 1 FROM controlled_cases WHERE id<>OLD.id AND CAST(general_case_id AS INTEGER)=CAST(NEW.general_case_id AS INTEGER))
      BEGIN
        SELECT RAISE(ABORT, 'duplicate_controlled_general_case');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_duplicate_emergency_general_case
      BEFORE INSERT ON emergency_fund
      WHEN CAST(COALESCE(NEW.general_case_id,0) AS INTEGER)<>0
        AND EXISTS (SELECT 1 FROM emergency_fund WHERE CAST(general_case_id AS INTEGER)=CAST(NEW.general_case_id AS INTEGER))
      BEGIN
        SELECT RAISE(ABORT, 'duplicate_emergency_general_case');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_duplicate_registry_general_case
      BEFORE INSERT ON registry
      WHEN CAST(COALESCE(NEW.general_case_id,0) AS INTEGER)<>0
        AND EXISTS (SELECT 1 FROM registry WHERE CAST(general_case_id AS INTEGER)=CAST(NEW.general_case_id AS INTEGER))
      BEGIN
        SELECT RAISE(ABORT, 'duplicate_registry_general_case');
      END;
    `);
  } finally {
    db.close();
  }
}

module.exports = { ensureCaseCreationUniqueness };
