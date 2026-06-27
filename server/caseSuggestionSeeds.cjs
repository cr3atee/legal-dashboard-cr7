const sqlite3 = require('sqlite3').verbose();

const MIGRATION_KEY = 'case_suggestion_dictionaries_v1';

const DEFAULT_CASE_PARTIES = [
  'Комитет по управлению муниципальной собственностью',
  'Комитет по земельным ресурсам и землеустройству',
  'Комитет по строительству, архитектуре и развитию города',
  'Комитет жилищно-коммунального хозяйства',
  'Комитет по дорожному хозяйству и транспорту',
  'Комитет по благоустройству',
  'Комитет по финансам, налоговой и кредитной политике',
  'Комитет по образованию',
  'Комитет муниципального заказа',
  'Комитет по социальной поддержке населения',
  'Комитет по культуре',
  'Комитет по физической культуре и спорту',
  'Комитет по энергоресурсам и газификации',
  'Комитет по развитию предпринимательства, потребительскому рынку и вопросам труда',
  'Администрация Центрального района города Барнаула',
  'Администрация Железнодорожного района города Барнаула',
  'Администрация Индустриального района города Барнаула',
  'Администрация Ленинского района города Барнаула',
  'Администрация Октябрьского района города Барнаула'
];

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function run(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.run(sql, params, function callback(error) {
      db.close();
      error ? reject(error) : resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.all(sql, params, (error, rows) => {
      db.close();
      error ? reject(error) : resolve(rows || []);
    });
  });
}

async function ensureCaseSuggestionSeeds(dbPath) {
  await run(dbPath, 'CREATE TABLE IF NOT EXISTS schema_migrations (key TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const migrated = await all(dbPath, 'SELECT key FROM schema_migrations WHERE key=? LIMIT 1', [MIGRATION_KEY]);
  if (migrated.length) return;

  for (const value of DEFAULT_CASE_PARTIES) {
    await run(dbPath, 'INSERT OR IGNORE INTO app_options (category, value) VALUES (?, ?)', ['case_party', value]);
  }

  const subjects = await all(dbPath, `
    SELECT DISTINCT TRIM(claim_subject) AS value FROM general_cases WHERE TRIM(COALESCE(claim_subject, ''))<>''
    UNION
    SELECT DISTINCT TRIM(claim_subject) AS value FROM general_cases_archive WHERE TRIM(COALESCE(claim_subject, ''))<>''
  `).catch(() => []);
  for (const row of subjects) {
    const value = String(row.value || '').trim();
    if (value && value.toLowerCase() !== 'all') {
      await run(dbPath, 'INSERT OR IGNORE INTO app_options (category, value) VALUES (?, ?)', ['claim_subject', value]);
    }
  }

  await run(dbPath, 'INSERT OR REPLACE INTO schema_migrations (key, applied_at) VALUES (?, ?)', [MIGRATION_KEY, new Date().toISOString()]);
}

module.exports = { DEFAULT_CASE_PARTIES, ensureCaseSuggestionSeeds };
