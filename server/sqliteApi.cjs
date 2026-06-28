const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const fs = require('fs');
const pathModule = require('path');
const { spawn } = require('child_process');

const activeSessions = new Map();
const schemaInitialization = new Map();
const DEFAULT_JSON_BODY_LIMIT = 10 * 1024 * 1024;
const MAX_CASE_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_CASE_DOCUMENT_BODY_BYTES = Math.ceil(MAX_CASE_DOCUMENT_BYTES * 4 / 3) + 2 * 1024 * 1024;
const MAX_REPORT_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_REPORT_DOCUMENT_BODY_BYTES = Math.ceil(MAX_REPORT_DOCUMENT_BYTES * 4 / 3) + 2 * 1024 * 1024;

const ROLE_LEVELS = {
  PARTICIPANT: 1,
  REPORT_ADMIN: 2,
  MAIN_ADMIN: 3,
  TECH_ADMIN: 4
};

const ROLE_NAMES = {
  1: 'Участник',
  2: 'Администратор отчетов',
  3: 'Главный администратор',
  4: 'Технический администратор'
};

const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  CASES_VIEW: 'cases.view',
  CASES_VIEW_ANY: 'cases.view.any',
  CASES_EDIT_OWN: 'cases.edit.own',
  CASES_EDIT_ANY: 'cases.edit.any',
  CONTROLLED_CASES_VIEW: 'controlledCases.view',
  CONTROLLED_CASES_EDIT: 'controlledCases.edit',
  CALENDAR_VIEW_OWN: 'calendar.view.own',
  CALENDAR_VIEW_ANY: 'calendar.view.any',
  CALENDAR_EDIT_OWN: 'calendar.edit.own',
  CALENDAR_EDIT_ANY: 'calendar.edit.any',
  SCHEDULE_VIEW_OWN: 'schedule.view.own',
  SCHEDULE_VIEW_ANY: 'schedule.view.any',
  SCHEDULE_EDIT_OWN: 'schedule.edit.own',
  SCHEDULE_EDIT_ANY: 'schedule.edit.any',
  REPORTS_VIEW: 'reports.view',
  REPORTS_MANAGE_ALL: 'reports.manageAll',
  ENFORCEMENT_VIEW: 'enforcement.view',
  MAP_VIEW: 'map.view',
  REGISTRY_VIEW: 'registry.view',
  EMERGENCY_FUND_VIEW: 'emergencyFund.view',
  MEETINGS_VIEW: 'meetings.view',
  USERS_LOOKUP: 'users.lookup',
  USERS_MANAGE: 'users.manage',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_RESET_PASSWORD: 'users.resetPassword',
  PERMISSIONS_MANAGE: 'permissions.manage',
  TECH_ADMIN_ASSIGN: 'techAdmin.assign',
  DICTIONARIES_VIEW: 'dictionaries.view',
  DICTIONARIES_MANAGE: 'dictionaries.manage',
  ROLES_MANAGE: 'roles.manage',
  TECHNICAL_ACCESS: 'technical.access'
};

const INDIVIDUAL_GRANT_PERMISSIONS = new Set([
  PERMISSIONS.CONTROLLED_CASES_VIEW,
  PERMISSIONS.ENFORCEMENT_VIEW,
  PERMISSIONS.MAP_VIEW,
  PERMISSIONS.REGISTRY_VIEW,
  PERMISSIONS.EMERGENCY_FUND_VIEW,
  PERMISSIONS.MEETINGS_VIEW,
  PERMISSIONS.REPORTS_VIEW
]);

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function all(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.all(sql, params, (err, rows) => {
      db.close();
      err ? reject(err) : resolve(rows || []);
    });
  });
}

function get(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.get(sql, params, (err, row) => {
      db.close();
      err ? reject(err) : resolve(row || null);
    });
  });
}

function run(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.run(sql, params, function(err) {
      db.close();
      err ? reject(err) : resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function initializeSchema(dbPath) {
  return new Promise((resolve, reject) => {
    const db = openDb(dbPath);
    db.serialize(() => {
      db.run('PRAGMA journal_mode=WAL');
      db.run('PRAGMA synchronous=NORMAL');
      db.run('PRAGMA busy_timeout=15000');

    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT DEFAULT '',
      password TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0
    )`);
    db.run(`ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN password TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN role_level INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN password_scheme TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT ''`, () => {});
    db.run(`INSERT OR IGNORE INTO users (full_name, password, is_admin)
      SELECT 'Администратор', 'admin', 1
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE full_name='Администратор' OR password='admin')`);
    db.run(`UPDATE users SET role_level=1 WHERE COALESCE(role_level,0) NOT BETWEEN 1 AND 4`);
    db.run(`UPDATE users SET is_active=1 WHERE is_active IS NULL`);

    db.run(`CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      granted_by INTEGER,
      granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, permission)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      key TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS general_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_no TEXT DEFAULT '', court_no TEXT DEFAULT '', court TEXT DEFAULT '', judge TEXT DEFAULT '', executor TEXT DEFAULT '',
      category TEXT DEFAULT '', procedural_position TEXT DEFAULT '', claim_subject TEXT DEFAULT '', claim_address TEXT DEFAULT '', registration_date TEXT DEFAULT '',
      review_result TEXT DEFAULT '', control_flag INTEGER DEFAULT 0, attendance_flag INTEGER DEFAULT 0, attendance_hearing_missing INTEGER DEFAULT 0, review_show_flag INTEGER DEFAULT 0, emergency_fund_flag INTEGER DEFAULT 0, registry_flag INTEGER DEFAULT 0,
      comments TEXT DEFAULT '', judicial_act_date_first TEXT DEFAULT '', first_instance_act_type TEXT DEFAULT '', motivated_decision_date TEXT DEFAULT '', appeal_act_date TEXT DEFAULT '', cassation_act_date TEXT DEFAULT '', documents_json TEXT DEFAULT '', process_kind TEXT DEFAULT '', act_instance TEXT DEFAULT '', proceeding_form TEXT DEFAULT '', appeal_kind TEXT DEFAULT '', order_copy_date TEXT DEFAULT '', apk_cassation_has_appeal TEXT DEFAULT '', supervision_cassation_exhausted TEXT DEFAULT '', late_motivated_received TEXT DEFAULT '', appeals_json TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      plaintiff TEXT DEFAULT '', defendant TEXT DEFAULT ''
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS general_cases_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER,
      case_no TEXT DEFAULT '', court_no TEXT DEFAULT '', court TEXT DEFAULT '', judge TEXT DEFAULT '', executor TEXT DEFAULT '',
      category TEXT DEFAULT '', procedural_position TEXT DEFAULT '', claim_subject TEXT DEFAULT '', claim_address TEXT DEFAULT '', registration_date TEXT DEFAULT '',
      review_result TEXT DEFAULT '', control_flag INTEGER DEFAULT 0, attendance_flag INTEGER DEFAULT 0, attendance_hearing_missing INTEGER DEFAULT 0, review_show_flag INTEGER DEFAULT 0, emergency_fund_flag INTEGER DEFAULT 0, registry_flag INTEGER DEFAULT 0,
      comments TEXT DEFAULT '', judicial_act_date_first TEXT DEFAULT '', first_instance_act_type TEXT DEFAULT '', motivated_decision_date TEXT DEFAULT '', appeal_act_date TEXT DEFAULT '', cassation_act_date TEXT DEFAULT '', documents_json TEXT DEFAULT '', process_kind TEXT DEFAULT '', act_instance TEXT DEFAULT '', proceeding_form TEXT DEFAULT '', appeal_kind TEXT DEFAULT '', order_copy_date TEXT DEFAULT '', apk_cassation_has_appeal TEXT DEFAULT '', supervision_cassation_exhausted TEXT DEFAULT '', late_motivated_received TEXT DEFAULT '', appeals_json TEXT DEFAULT '',
      archived_at TEXT DEFAULT CURRENT_TIMESTAMP, plaintiff TEXT DEFAULT '', defendant TEXT DEFAULT ''
    )`);
    // USER REQUEST FIX: ensure appeal date columns exist in older databases.
    const ensureGeneralCaseColumnMigrations = {
      comments: "TEXT DEFAULT ''",
      claim_address: "TEXT DEFAULT ''",
      judicial_act_date_first: "TEXT DEFAULT ''",
      first_instance_act_type: "TEXT DEFAULT ''",
      motivated_decision_date: "TEXT DEFAULT ''",
      appeal_act_date: "TEXT DEFAULT ''",
      cassation_act_date: "TEXT DEFAULT ''",
      documents_json: "TEXT DEFAULT ''",
      process_kind: "TEXT DEFAULT ''",
      act_instance: "TEXT DEFAULT ''",
      proceeding_form: "TEXT DEFAULT ''",
      appeal_kind: "TEXT DEFAULT ''",
      order_copy_date: "TEXT DEFAULT ''",
      apk_cassation_has_appeal: "TEXT DEFAULT ''",
      supervision_cassation_exhausted: "TEXT DEFAULT ''",
      late_motivated_received: "TEXT DEFAULT ''",
      appeals_json: "TEXT DEFAULT ''",
      review_show_flag: "INTEGER DEFAULT 0",
      emergency_fund_flag: "INTEGER DEFAULT 0",
      registry_flag: "INTEGER DEFAULT 0",
      attendance_hearing_missing: "INTEGER DEFAULT 0"
    };

    for (const [column, type] of Object.entries(ensureGeneralCaseColumnMigrations)) {
      db.run(`ALTER TABLE general_cases ADD COLUMN ${column} ${type}`, () => {});
      db.run(`ALTER TABLE general_cases_archive ADD COLUMN ${column} ${type}`, () => {});
    }

    db.run(`CREATE TABLE IF NOT EXISTS controlled_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_number TEXT DEFAULT '', plaintiff TEXT DEFAULT '', defendant TEXT DEFAULT '', subject TEXT DEFAULT '', representative TEXT DEFAULT '', result TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, general_case_id INTEGER,
      court_case_number TEXT DEFAULT '', court TEXT DEFAULT ''
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS court_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT DEFAULT '', court TEXT DEFAULT '', time TEXT DEFAULT '', representative TEXT DEFAULT '', plaintiff TEXT DEFAULT '', defendant TEXT DEFAULT '',
      category TEXT DEFAULT '', result TEXT DEFAULT '', is_date_row INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, hearing_date TEXT DEFAULT '', general_case_id INTEGER, meeting_id INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS calendar_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_str TEXT, user_name TEXT, task_type TEXT, description TEXT, time_val TEXT, court TEXT, subject TEXT, assignment TEXT,
      metadata_json TEXT DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP, meeting_id INTEGER, general_case_id INTEGER
    )`);
    db.run(`ALTER TABLE calendar_tasks ADD COLUMN metadata_json TEXT DEFAULT '{}'`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS enforcement_proceedings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT DEFAULT '',
      archived INTEGER DEFAULT 0,
      case_number TEXT DEFAULT '',
      ip_number TEXT DEFAULT '',
      subject_execution TEXT DEFAULT '',
      date_start TEXT DEFAULT '',
      start_date TEXT DEFAULT '',
      basis TEXT DEFAULT '',
      start_basis TEXT DEFAULT '',
      appeal_info TEXT DEFAULT '',
      deadline TEXT DEFAULT '',
      execution_deadline TEXT DEFAULT '',
      term_execution TEXT DEFAULT '',
      nature TEXT DEFAULT 'material',
      production_character TEXT DEFAULT '',
      amount_claimed TEXT DEFAULT '',
      claim_sum TEXT DEFAULT '',
      claim_amount TEXT DEFAULT '',
      payment_info TEXT DEFAULT '',
      payments_json TEXT DEFAULT '',
      total_paid TEXT DEFAULT '',
      amount_paid_total TEXT DEFAULT '',
      debt TEXT DEFAULT '',
      debt_amount TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS app_options (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, value TEXT NOT NULL, code TEXT DEFAULT '', system_flag INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 999, UNIQUE(category,value))`);
    db.run(`ALTER TABLE app_options ADD COLUMN code TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE app_options ADD COLUMN system_flag INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE app_options ADD COLUMN sort_order INTEGER DEFAULT 999`, () => {});
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_options_category_code ON app_options(category, code) WHERE code <> ''`, () => {});
    [
      ['case_category', 'Жилищные споры'],
      ['case_category', 'Благоустройство'],
      ['case_category', 'Дороги'],
      ['procedural_position', 'Истец'],
      ['procedural_position', 'Ответчик'],
      ['procedural_position', 'Заявитель'],
      ['procedural_position', 'Заинтересованное лицо'],
      ['procedural_position', 'Третье лицо с самостоятельными требованиями'],
      ['procedural_position', 'Третье лицо без самостоятельных требований'],
      ['procedural_position', 'Прокурор'],
      ['appeal_act_type', 'Решение суда первой инстанции'],
      ['appeal_act_type', 'Судебный акт суда апелляционной инстанции'],
      ['appeal_act_type', 'Судебный акт суда кассационной инстанции'],
      ['appeal_act_type', 'Судебный приказ'],
      ['appeal_act_type', 'Заочное решение'],
      ['appeal_act_type', 'Определение (промежуточное)']
    ].forEach(([category, value]) => {
      db.run('INSERT OR IGNORE INTO app_options (category, value) VALUES (?, ?)', [category, value], () => {});
    });
    [
      ['appeal', 'Апелляционная инстанция', 10],
      ['cassation', 'Кассационная инстанция', 20],
      ['cassation_transfer_refusal', 'Жалоба на определение об отказе в передаче КЖ', 30],
      ['cassation_supreme_court', 'Кассационная инстанция (ВС РФ)', 40]
    ].forEach(([code, value, sortOrder]) => {
      db.run('INSERT OR IGNORE INTO app_options (category, value, code, system_flag, sort_order) VALUES (?, ?, ?, 1, ?)', ['appeal_type', value, code, sortOrder], () => {});
      db.run('UPDATE app_options SET code=?, system_flag=1, sort_order=? WHERE category=? AND (code=? OR value=?)', [code, sortOrder, 'appeal_type', code, value], () => {});
    });
    db.run(`CREATE TABLE IF NOT EXISTS archive (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, record_id INTEGER, data TEXT NOT NULL, archived_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

    const ensureEnforcementColumnMigrations = {
      mode: "TEXT DEFAULT ''",
      archived: "INTEGER DEFAULT 0",
      case_number: "TEXT DEFAULT ''",
      ip_number: "TEXT DEFAULT ''",
      subject_execution: "TEXT DEFAULT ''",
      date_start: "TEXT DEFAULT ''",
      start_date: "TEXT DEFAULT ''",
      basis: "TEXT DEFAULT ''",
      start_basis: "TEXT DEFAULT ''",
      appeal_info: "TEXT DEFAULT ''",
      deadline: "TEXT DEFAULT ''",
      execution_deadline: "TEXT DEFAULT ''",
      term_execution: "TEXT DEFAULT ''",
      nature: "TEXT DEFAULT 'material'",
      production_character: "TEXT DEFAULT ''",
      amount_claimed: "TEXT DEFAULT ''",
      claim_sum: "TEXT DEFAULT ''",
      claim_amount: "TEXT DEFAULT ''",
      payment_info: "TEXT DEFAULT ''",
      payments_json: "TEXT DEFAULT ''",
      total_paid: "TEXT DEFAULT ''",
      amount_paid_total: "TEXT DEFAULT ''",
      debt: "TEXT DEFAULT ''",
      debt_amount: "TEXT DEFAULT ''",
      created_at: "TEXT DEFAULT ''",
      updated_at: "TEXT DEFAULT ''",
      pk: "TEXT DEFAULT ''",
      case_num: "TEXT DEFAULT ''",
      sum_claim: "TEXT DEFAULT ''",
      provided_area: "TEXT DEFAULT ''",
      execution_quarter: "TEXT DEFAULT ''",
      review_ready: "INTEGER DEFAULT 0",
      total_unfulfilled_sum: "TEXT DEFAULT ''",
      total_fulfilled_sum: "TEXT DEFAULT ''",
      total_unfulfilled_area: "TEXT DEFAULT ''",
      total_provided_area: "TEXT DEFAULT ''"
    };

    for (const [column, type] of Object.entries(ensureEnforcementColumnMigrations)) {
      db.run(`ALTER TABLE enforcement_proceedings ADD COLUMN ${column} ${type}`, () => {});
    }


    const ensureCalendarColumnMigrations = {
      date: "TEXT DEFAULT ''",
      user: "TEXT DEFAULT ''",
      type: "TEXT DEFAULT ''",
      desc: "TEXT DEFAULT ''",
      time: "TEXT DEFAULT ''",
      done: "INTEGER DEFAULT 0",
      end_date: "TEXT DEFAULT ''",
      end_time: "TEXT DEFAULT ''",
      event_scope: "TEXT DEFAULT 'work'",
      personal_kind: "TEXT DEFAULT ''",
      note_text: "TEXT DEFAULT ''",
      private_note: "TEXT DEFAULT ''",
      delegated_to: "TEXT DEFAULT ''",
      delegated_by: "TEXT DEFAULT ''",
      delegation_status: "TEXT DEFAULT ''",
      delegation_source_event_id: "INTEGER",
      conflict_override: "INTEGER DEFAULT 0",
      updated_at: "TEXT DEFAULT ''"
    };

    for (const [column, type] of Object.entries(ensureCalendarColumnMigrations)) {
      db.run(`ALTER TABLE calendar_tasks ADD COLUMN "${column}" ${type}`, () => {});
    }


    const ensureScheduleColumnMigrations = {
      session_date: "TEXT DEFAULT ''",
      court: "TEXT DEFAULT ''",
      time: "TEXT DEFAULT ''",
      representative: "TEXT DEFAULT ''",
      plaintiff: "TEXT DEFAULT ''",
      defendant: "TEXT DEFAULT ''",
      category: "TEXT DEFAULT ''",
      result: "TEXT DEFAULT ''",
      is_date_row: "INTEGER DEFAULT 0",
      hearing_date: "TEXT DEFAULT ''",
      general_case_id: "INTEGER",
      meeting_id: "INTEGER",
      created_at: "TEXT DEFAULT ''",
      updated_at: "TEXT DEFAULT ''"
    };

    for (const [column, type] of Object.entries(ensureScheduleColumnMigrations)) {
      db.run(`ALTER TABLE court_schedule ADD COLUMN ${column} ${type}`, () => {});
    }


const ensureEmergencyFundColumnMigrations = {
  kvartal: "TEXT DEFAULT ''",
  pk_number: "TEXT DEFAULT ''",
  fio: "TEXT DEFAULT ''",
  prosecutor: "TEXT DEFAULT ''",
  address: "TEXT DEFAULT ''",
  district: "TEXT DEFAULT ''",
  requirements: "TEXT DEFAULT ''",
  stage: "TEXT DEFAULT ''",
  case_number: "TEXT DEFAULT ''",
  judicial_act_date: "TEXT DEFAULT ''",
  appeal: "TEXT DEFAULT ''",
  claim_amount: "TEXT DEFAULT ''",
  collected: "TEXT DEFAULT ''",
  area: "TEXT DEFAULT ''",
  address_exec: "TEXT DEFAULT ''",
  sum_property_claim: "TEXT DEFAULT ''",
  sum_property: "TEXT DEFAULT ''",
  execution: "TEXT DEFAULT ''",
  executors: "TEXT DEFAULT ''",
  notes: "TEXT DEFAULT ''",
  court: "TEXT DEFAULT ''",
  latitude: "REAL",
  longitude: "REAL",
  pk: "TEXT DEFAULT ''",
  case_num: "TEXT DEFAULT ''",
  sum_claim: "TEXT DEFAULT ''",
  provided_area: "TEXT DEFAULT ''",
  execution_quarter: "TEXT DEFAULT ''",
  review_ready: "INTEGER DEFAULT 0",
  total_unfulfilled_sum: "TEXT DEFAULT ''",
  total_fulfilled_sum: "TEXT DEFAULT ''",
  total_unfulfilled_area: "TEXT DEFAULT ''",
  total_provided_area: "TEXT DEFAULT ''",
  execution_people_json: "TEXT DEFAULT ''",
  condemned_date: "TEXT DEFAULT ''",
  resettlement_deadline: "TEXT DEFAULT ''",
  created_at: "TEXT DEFAULT ''",
  updated_at: "TEXT DEFAULT ''",
  general_case_id: "INTEGER DEFAULT 0"
};

for (const [column, type] of Object.entries(ensureEmergencyFundColumnMigrations)) {
  db.run(`ALTER TABLE emergency_fund ADD COLUMN ${column} ${type}`, () => {});
}


const ensureRegistryColumnMigrations = {
  pk_number: "TEXT DEFAULT ''",
  kvartal: "TEXT DEFAULT ''",
  address: "TEXT DEFAULT ''",
  fio: "TEXT DEFAULT ''",
  property_type: "TEXT DEFAULT ''",
  notes: "TEXT DEFAULT ''",
  court: "TEXT DEFAULT ''",
  stage: "TEXT DEFAULT ''",
  court_act_date: "TEXT DEFAULT ''",
  court_act_number: "TEXT DEFAULT ''",
  court_act: "TEXT DEFAULT ''",
  requirements: "TEXT DEFAULT ''",
  appeal: "TEXT DEFAULT ''",
  execution: "TEXT DEFAULT ''",
  collected: "TEXT DEFAULT ''",
  review_ready: "INTEGER DEFAULT 0",
  attachments_json: "TEXT DEFAULT ''",
  created_at: "TEXT DEFAULT ''",
  updated_at: "TEXT DEFAULT ''",
  general_case_id: "INTEGER"
};

for (const [column, type] of Object.entries(ensureRegistryColumnMigrations)) {
  db.run(`ALTER TABLE registry ADD COLUMN ${column} ${type}`, () => {});
}


db.run(`CREATE TABLE IF NOT EXISTS registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pk_number TEXT DEFAULT '',
  kvartal TEXT DEFAULT '',
  address TEXT DEFAULT '',
  fio TEXT DEFAULT '',
  property_type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  court TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  court_act_date TEXT DEFAULT '',
  court_act_number TEXT DEFAULT '',
  court_act TEXT DEFAULT '',
  requirements TEXT DEFAULT '',
  appeal TEXT DEFAULT '',
  execution TEXT DEFAULT '',
  collected TEXT DEFAULT '',
  review_ready INTEGER DEFAULT 0,
  attachments_json TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  general_case_id INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  date_val TEXT DEFAULT '',
  time_val TEXT DEFAULT '',
  agenda TEXT DEFAULT '',
  protocol TEXT DEFAULT '',
  participants TEXT DEFAULT '',
  invited_participants TEXT DEFAULT '',
  attachment_path TEXT DEFAULT '',
  attachment_type TEXT DEFAULT '',
  has_participants_list INTEGER DEFAULT 0,
  has_telegram INTEGER DEFAULT 0,
  protocol_keeper TEXT DEFAULT '',
  cabinet_number TEXT DEFAULT '',
  telegram_number TEXT DEFAULT '',
  transfer_email TEXT DEFAULT '',
  transfer_fio TEXT DEFAULT '',
  transfer_phone TEXT DEFAULT '',
  telegram_sign_fio TEXT DEFAULT '',
  protocol_number TEXT DEFAULT '',
  protocol_chair_fio TEXT DEFAULT '',
  protocol_chair_position TEXT DEFAULT '',
  agenda_sign_position TEXT DEFAULT '',
  agenda_sign_fio TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS meeting_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  full_name TEXT NOT NULL,
  position TEXT DEFAULT '',
  leadership TEXT DEFAULT '',
  is_leadership INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 999
)`);

    db.run(`CREATE TABLE IF NOT EXISTS quarterly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_name TEXT DEFAULT '',
      year INTEGER NOT NULL,
      quarter INTEGER NOT NULL,
      original_name TEXT DEFAULT '',
      stored_name TEXT DEFAULT '',
      mime_type TEXT DEFAULT '',
      size_bytes INTEGER DEFAULT 0,
      uploaded_by INTEGER,
      uploaded_by_name TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, year, quarter)
    )`);
    const ensureQuarterlyReportColumnMigrations = {
      user_id: "INTEGER DEFAULT 0",
      user_name: "TEXT DEFAULT ''",
      year: "INTEGER DEFAULT 0",
      quarter: "INTEGER DEFAULT 0",
      original_name: "TEXT DEFAULT ''",
      stored_name: "TEXT DEFAULT ''",
      mime_type: "TEXT DEFAULT ''",
      size_bytes: "INTEGER DEFAULT 0",
      uploaded_by: "INTEGER",
      uploaded_by_name: "TEXT DEFAULT ''",
      created_at: "TEXT DEFAULT ''",
      updated_at: "TEXT DEFAULT ''"
    };
    for (const [column, type] of Object.entries(ensureQuarterlyReportColumnMigrations)) {
      db.run(`ALTER TABLE quarterly_reports ADD COLUMN ${column} ${type}`, () => {});
    }
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quarterly_reports_unique ON quarterly_reports(user_id, year, quarter)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_quarterly_reports_user_year ON quarterly_reports(user_id, year, quarter)`);

    const ensureMeetingsColumnMigrations = {
      invited_participants: "TEXT DEFAULT ''",
      attachment_type: "TEXT DEFAULT ''",
      protocol_keeper: "TEXT DEFAULT ''",
      cabinet_number: "TEXT DEFAULT ''",
      telegram_number: "TEXT DEFAULT ''",
      transfer_email: "TEXT DEFAULT ''",
      transfer_fio: "TEXT DEFAULT ''",
      transfer_phone: "TEXT DEFAULT ''",
      telegram_sign_fio: "TEXT DEFAULT ''",
      protocol_number: "TEXT DEFAULT ''",
      protocol_chair_fio: "TEXT DEFAULT ''",
      protocol_chair_position: "TEXT DEFAULT ''",
      agenda_sign_position: "TEXT DEFAULT ''",
      agenda_sign_fio: "TEXT DEFAULT ''",
      updated_at: "TEXT DEFAULT ''"
    };
    for (const [column, type] of Object.entries(ensureMeetingsColumnMigrations)) {
      db.run(`ALTER TABLE meetings ADD COLUMN ${column} ${type}`, () => {});
    }

    const ensureMeetingParticipantsColumnMigrations = {
      category: "TEXT DEFAULT ''",
      full_name: "TEXT DEFAULT ''",
      position: "TEXT DEFAULT ''",
      leadership: "TEXT DEFAULT ''",
      is_leadership: "INTEGER DEFAULT 1",
      sort_order: "INTEGER DEFAULT 999"
    };
    for (const [column, type] of Object.entries(ensureMeetingParticipantsColumnMigrations)) {
      db.run(`ALTER TABLE meeting_participants ADD COLUMN ${column} ${type}`, () => {});
    }

    db.run(`CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER,
      full_name TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0,
      role_level INTEGER DEFAULT 1,
      permissions_json TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT DEFAULT ''
    )`);
    db.run(`ALTER TABLE app_sessions ADD COLUMN role_level INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE app_sessions ADD COLUMN permissions_json TEXT DEFAULT ''`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at)`);

    db.run(`CREATE TABLE IF NOT EXISTS notification_reads (
      user_name TEXT NOT NULL,
      notification_key TEXT NOT NULL,
      read_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_name, notification_key)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS general_case_review_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      general_case_id INTEGER NOT NULL,
      document_id TEXT DEFAULT '',
      document_path TEXT NOT NULL,
      document_name TEXT DEFAULT '',
      document_type TEXT DEFAULT '',
      requester_name TEXT DEFAULT '',
      reviewer_name TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      request_comment TEXT DEFAULT '',
      reviewer_comment TEXT DEFAULT '',
      marked_file_path TEXT DEFAULT '',
      history_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      UNIQUE(general_case_id, document_path)
    )`);
    db.run(`ALTER TABLE general_case_review_approvals ADD COLUMN document_id TEXT DEFAULT ''`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_general_case_review_approvals_case ON general_case_review_approvals(general_case_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_general_case_review_approvals_document_id ON general_case_review_approvals(document_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_general_case_review_approvals_status ON general_case_review_approvals(status)`);

    });
    db.close(error => error ? reject(error) : resolve());
  });
}

function ensureSchema(dbPath) {
  const key = pathModule.resolve(dbPath);
  if (!schemaInitialization.has(key)) {
    const initialization = initializeSchema(key).then(() => migrateUserSecurity(key)).catch(error => {
      schemaInitialization.delete(key);
      throw error;
    });
    schemaInitialization.set(key, initialization);
  }
  return schemaInitialization.get(key);
}

async function migrateUserSecurity(dbPath) {
  await run(dbPath, `CREATE TABLE IF NOT EXISTS schema_migrations (
    key TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(dbPath, 'UPDATE users SET role_level=1 WHERE COALESCE(role_level,0) NOT BETWEEN 1 AND 4');
  const legacyRoleMigration = await get(dbPath, "SELECT key FROM schema_migrations WHERE key='legacy_is_admin_role_level_v1' LIMIT 1").catch(() => null);
  if (!legacyRoleMigration) {
    await run(dbPath, 'UPDATE users SET role_level=3 WHERE id<>1 AND COALESCE(is_admin,0)=1 AND COALESCE(role_level,1)=1');
    await run(dbPath, "INSERT OR IGNORE INTO schema_migrations (key) VALUES ('legacy_is_admin_role_level_v1')");
  }
  await run(dbPath, 'UPDATE users SET role_level=4, is_admin=1, is_active=1 WHERE id=1');
  await run(dbPath, 'UPDATE users SET is_active=1 WHERE is_active IS NULL');
  await run(dbPath, "UPDATE users SET created_at=CURRENT_TIMESTAMP WHERE COALESCE(created_at,'')=''");

  const legacyUsers = await all(dbPath, `
    SELECT id, password
    FROM users
    WHERE COALESCE(password,'')<>''
      AND COALESCE(password_hash,'')=''
  `);

  for (const user of legacyUsers) {
    const credentials = makePasswordCredentials(user.password);
    await run(dbPath, `
      UPDATE users
      SET password_hash=?, password_salt=?, password_scheme='scrypt', password=?
      WHERE id=?
    `, [credentials.hash, credentials.salt, `__migrated_password_${user.id}__`, user.id]);
  }

  const hashedUsers = await all(dbPath, "SELECT id FROM users WHERE COALESCE(password_hash,'')<>''");
  for (const user of hashedUsers) {
    await run(dbPath, 'UPDATE users SET password=? WHERE id=?', [`__migrated_password_${user.id}__`, user.id]);
  }
}

function sendJson(res, statusCode, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    if (!res.headersSent) {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
    }

    if (!res.writableEnded && !res.destroyed) {
      res.end(JSON.stringify(data));
    }
  } catch {
    try { res.destroy(); } catch {}
  }
}

function normalizeRoleLevel(value) {
  const level = Number(value || 0);
  if (level >= ROLE_LEVELS.TECH_ADMIN) return ROLE_LEVELS.TECH_ADMIN;
  if (level >= ROLE_LEVELS.MAIN_ADMIN) return ROLE_LEVELS.MAIN_ADMIN;
  if (level >= ROLE_LEVELS.REPORT_ADMIN) return ROLE_LEVELS.REPORT_ADMIN;
  return ROLE_LEVELS.PARTICIPANT;
}

function parseRoleLevel(value) {
  const level = Number(value);
  return Number.isInteger(level) && level >= ROLE_LEVELS.PARTICIPANT && level <= ROLE_LEVELS.TECH_ADMIN
    ? level
    : null;
}

function getRolePermissions(roleLevel) {
  const level = normalizeRoleLevel(roleLevel);
  const permissions = new Set([
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CASES_VIEW,
    PERMISSIONS.CASES_EDIT_OWN,
    PERMISSIONS.CALENDAR_VIEW_OWN,
    PERMISSIONS.CALENDAR_EDIT_OWN,
    PERMISSIONS.SCHEDULE_VIEW_OWN,
    PERMISSIONS.SCHEDULE_EDIT_OWN,
    PERMISSIONS.USERS_LOOKUP,
    PERMISSIONS.DICTIONARIES_VIEW
  ]);

  if (level >= ROLE_LEVELS.REPORT_ADMIN) {
    permissions.add(PERMISSIONS.REPORTS_VIEW);
    permissions.add(PERMISSIONS.REPORTS_MANAGE_ALL);
  }

  if (level >= ROLE_LEVELS.MAIN_ADMIN) {
    [
      PERMISSIONS.CASES_VIEW,
      PERMISSIONS.CASES_VIEW_ANY,
      PERMISSIONS.CASES_EDIT_ANY,
      PERMISSIONS.CONTROLLED_CASES_VIEW,
      PERMISSIONS.CONTROLLED_CASES_EDIT,
      PERMISSIONS.CALENDAR_VIEW_ANY,
      PERMISSIONS.CALENDAR_EDIT_ANY,
      PERMISSIONS.SCHEDULE_VIEW_ANY,
      PERMISSIONS.SCHEDULE_EDIT_ANY,
      PERMISSIONS.ENFORCEMENT_VIEW,
      PERMISSIONS.MAP_VIEW,
      PERMISSIONS.REGISTRY_VIEW,
      PERMISSIONS.EMERGENCY_FUND_VIEW,
      PERMISSIONS.MEETINGS_VIEW,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_RESET_PASSWORD,
      PERMISSIONS.PERMISSIONS_MANAGE,
      PERMISSIONS.DICTIONARIES_MANAGE
    ].forEach(permission => permissions.add(permission));
  }

  if (level >= ROLE_LEVELS.TECH_ADMIN) {
    permissions.add(PERMISSIONS.ROLES_MANAGE);
    permissions.add(PERMISSIONS.TECH_ADMIN_ASSIGN);
    permissions.add(PERMISSIONS.TECHNICAL_ACCESS);
  }

  return permissions;
}

function makePasswordCredentials(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 32).toString('hex');
  return { hash, salt, scheme: 'scrypt' };
}

function verifyPassword(password, user = {}) {
  const value = String(password || '');
  if (user.password_hash || user.password_salt) {
    if (user.password_scheme !== 'scrypt' || !user.password_hash || !user.password_salt) {
      return false;
    }
    try {
      const hash = crypto.scryptSync(value, String(user.password_salt), 32).toString('hex');
      const expected = Buffer.from(String(user.password_hash), 'hex');
      const actual = Buffer.from(hash, 'hex');
      return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  return Boolean(user.password) && String(user.password) === value;
}

async function loadUserPermissions(dbPath, userId) {
  if (!userId) return [];
  const rows = await all(dbPath, 'SELECT permission FROM user_permissions WHERE user_id=? ORDER BY permission', [userId]).catch(() => []);
  return rows.map(row => String(row.permission || '').trim()).filter(Boolean);
}

async function buildSessionFromUser(dbPath, user) {
  if (!user) return null;
  const roleLevel = normalizeRoleLevel(user.role_level);
  const individualPermissions = await loadUserPermissions(dbPath, user.id);
  const permissions = new Set([...getRolePermissions(roleLevel), ...individualPermissions]);
  if (permissions.has(PERMISSIONS.CONTROLLED_CASES_VIEW)) {
    permissions.add(PERMISSIONS.CONTROLLED_CASES_EDIT);
  }
  return {
    id: user.id || null,
    full_name: user.full_name || user.name || 'Пользователь',
    is_admin: roleLevel >= ROLE_LEVELS.MAIN_ADMIN,
    role_level: roleLevel,
    role_name: ROLE_NAMES[roleLevel] || ROLE_NAMES[ROLE_LEVELS.PARTICIPANT],
    permissions: [...permissions],
    individual_permissions: individualPermissions
  };
}

function hasPermission(session, permission) {
  return Boolean(session?.permissions?.includes(permission));
}

function isSameUserName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function isOwnGeneralCase(session, row = {}) {
  if (!session || !row) return false;
  return isSameUserName(row.executor, session.full_name);
}

function canEditGeneralCase(session, row) {
  if (!session || !row) return false;
  return hasPermission(session, PERMISSIONS.CASES_EDIT_ANY) || isOwnGeneralCase(session, row);
}

function canEditScheduleRow(session, row) {
  if (!session || !row) return false;
  if (hasPermission(session, PERMISSIONS.SCHEDULE_EDIT_ANY)) return true;
  return isSameUserName(row.representative, session.full_name);
}

function getRequiredApiPermission(path, method) {
  const safeMethod = String(method || 'GET').toUpperCase();
  if (path === '/api/health' || path.startsWith('/api/auth/')) return '';
  if (path === '/api/users') return PERMISSIONS.USERS_LOOKUP;
  if (path.startsWith('/api/admin/users')) return PERMISSIONS.USERS_MANAGE;
  if (path.startsWith('/api/admin/options')) return PERMISSIONS.DICTIONARIES_MANAGE;
  if (path.startsWith('/api/options')) return safeMethod === 'GET' ? PERMISSIONS.DICTIONARIES_VIEW : PERMISSIONS.DICTIONARIES_MANAGE;
  if (path.startsWith('/api/general-cases') || path.startsWith('/api/general-case-files')) {
    return PERMISSIONS.CASES_VIEW;
  }
  if (path.startsWith('/api/controlled-cases')) {
    return safeMethod === 'GET' ? PERMISSIONS.CONTROLLED_CASES_VIEW : PERMISSIONS.CONTROLLED_CASES_EDIT;
  }
  if (path.startsWith('/api/calendar-tasks')) {
    return safeMethod === 'GET' ? PERMISSIONS.CALENDAR_VIEW_OWN : PERMISSIONS.CALENDAR_EDIT_OWN;
  }
  if (path.startsWith('/api/court-schedule')) {
    return safeMethod === 'GET' ? PERMISSIONS.SCHEDULE_VIEW_OWN : PERMISSIONS.SCHEDULE_EDIT_OWN;
  }
  if (path.startsWith('/api/reports')) return PERMISSIONS.REPORTS_VIEW;
  if (path.startsWith('/api/enforcement')) return PERMISSIONS.ENFORCEMENT_VIEW;
  if (path.startsWith('/api/municipal-registry')) return PERMISSIONS.REGISTRY_VIEW;
  if (path.startsWith('/api/emergency-fund')) return PERMISSIONS.EMERGENCY_FUND_VIEW;
  if (path.startsWith('/api/meetings') || path.startsWith('/api/meeting-participants')) return PERMISSIONS.MEETINGS_VIEW;
  if (path.startsWith('/api/notifications')) return PERMISSIONS.DASHBOARD_VIEW;
  return '';
}

async function enforceApiAccess(req, res, dbPath, path, method) {
  const permission = getRequiredApiPermission(path, method);
  if (!permission) return null;
  const session = await getRequestSession(req, dbPath);
  if (!session) {
    sendJson(res, 401, { error: 'auth_required' });
    return false;
  }
  if (!hasPermission(session, permission)) {
    sendJson(res, 403, { error: 'forbidden', permission });
    return false;
  }
  return session;
}

async function replaceUserPermissions(dbPath, userId, permissions, grantedBy = null) {
  const normalized = normalizeIndividualPermissions(permissions);
  await run(dbPath, 'DELETE FROM user_permissions WHERE user_id=?', [userId]);
  for (const permission of normalized) {
    await run(dbPath, 'INSERT OR IGNORE INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)', [userId, permission, grantedBy]);
  }
  return normalized;
}

function normalizeIndividualPermissions(permissions) {
  const requested = [...new Set((Array.isArray(permissions) ? permissions : [])
    .map(permission => String(permission || '').trim())
    .filter(Boolean))];
  const unknown = requested.find(permission => !INDIVIDUAL_GRANT_PERMISSIONS.has(permission));
  if (unknown) {
    const error = new Error('invalid_permission');
    error.code = 'INVALID_PERMISSION';
    error.permission = unknown;
    throw error;
  }
  return requested;
}

async function listUsersForAdmin(dbPath) {
  const rows = await all(dbPath, `
    SELECT id, full_name, role_level, is_active, created_at
    FROM users
    ORDER BY
      CASE WHEN COALESCE(is_active, 0)=1 THEN 0 ELSE 1 END,
      full_name COLLATE NOCASE,
      id
  `, []);
  const result = [];
  for (const row of rows) {
    const roleLevel = normalizeRoleLevel(row.role_level);
    result.push({
      id: row.id,
      full_name: row.full_name || '',
      is_active: Number(row.is_active ?? 1) ? 1 : 0,
      role_level: roleLevel,
      role_name: ROLE_NAMES[roleLevel] || ROLE_NAMES[ROLE_LEVELS.PARTICIPANT],
      individual_permissions: (await loadUserPermissions(dbPath, row.id))
        .filter(permission => INDIVIDUAL_GRANT_PERMISSIONS.has(permission)),
      created_at: row.created_at || ''
    });
  }
  return result;
}

async function listCalendarExecutorUsers(dbPath) {
  const rows = await all(dbPath, `
    SELECT id, full_name
    FROM users
    WHERE COALESCE(is_active, 1)=1
      AND COALESCE(role_level, 1)=1
    ORDER BY full_name COLLATE NOCASE, id
  `, []);
  return rows.map(row => ({
    id: Number(row.id),
    full_name: row.full_name || ''
  })).filter(row => row.id && row.full_name);
}

async function isLastActiveTechAdmin(dbPath, userId) {
  const row = await get(dbPath, `
    SELECT COUNT(*) AS count
    FROM users
    WHERE COALESCE(is_active,1)=1
      AND COALESCE(role_level,1)=4
      AND id<>?
  `, [userId]).catch(() => null);
  return Number(row?.count || 0) === 0;
}

async function listDictionaryOptions(dbPath) {
  const options = await all(dbPath, `
    SELECT id, category, value, COALESCE(code, '') AS code, COALESCE(system_flag, 0) AS system_flag, COALESCE(sort_order, 999) AS sort_order
    FROM app_options
    ORDER BY category, sort_order, value, id
  `, []);
  const meetingParticipants = await all(dbPath, `
    SELECT id, category, full_name AS value, position, leadership, is_leadership, sort_order
    FROM meeting_participants
    WHERE category IN ('msu_ip', 'invited_ip')
    ORDER BY category, sort_order, full_name, id
  `, []).catch(() => []);
  return options
    .map(row => ({ id: String(row.id), category: row.category, value: row.value, code: row.code || '', system_flag: Number(row.system_flag || 0), sort_order: row.sort_order ?? 999 }))
    .concat(meetingParticipants.map(row => ({
      id: `meeting:${row.id}`,
      category: row.category,
      value: row.value,
      position: row.position || '',
      leadership: row.leadership || '',
      is_leadership: Number(row.is_leadership ?? 1) ? 1 : 0,
      sort_order: row.sort_order ?? 999,
      source: 'meeting_participants'
    })));
}

function isMeetingParticipantDictionaryCategory(category) {
  return ['msu_ip', 'invited_ip'].includes(String(category || ''));
}

function parseAdminDictionaryId(value) {
  const raw = String(value || '').trim();
  if (!raw) return { type: 'option', id: 0 };
  if (raw.startsWith('meeting:')) return { type: 'meeting', id: Number(raw.slice('meeting:'.length) || 0) };
  return { type: 'option', id: Number(raw || 0) };
}

function normalizeDictionaryOptionValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function makeDictionaryOptionCode(category, value) {
  if (category !== 'appeal_type') return '';
  return `custom_${normalizeDictionaryOptionValue(value).replace(/[^a-zа-я0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now()}`;
}

async function getMeetingParticipantDictionaryRow(dbPath, id) {
  const row = await get(dbPath, `
    SELECT id, category, full_name AS value, position, leadership, is_leadership, sort_order
    FROM meeting_participants
    WHERE id=?
  `, [id]);
  return row ? {
    id: `meeting:${row.id}`,
    category: row.category,
    value: row.value,
    position: row.position || '',
    leadership: row.leadership || '',
    is_leadership: Number(row.is_leadership ?? 1) ? 1 : 0,
    sort_order: row.sort_order ?? 999,
    source: 'meeting_participants'
  } : null;
}

async function isMeetingParticipantValueUsed(dbPath, category, value) {
  const column = category === 'invited_ip' ? 'invited_participants' : 'participants';
  const row = await get(dbPath, `
    SELECT 1 AS used
    FROM meetings
    WHERE instr(char(10) || replace(COALESCE(${column}, ''), char(13), '') || char(10), char(10) || ? || char(10)) > 0
    LIMIT 1
  `, [value]).catch(() => null);
  return Boolean(row?.used);
}

async function isOptionValueUsed(dbPath, category, value) {
  const checks = [
    ['general_cases', 'category', ['case_category']],
    ['general_cases', 'court', ['court']],
    ['general_cases', 'judge', ['judge']],
    ['general_cases', 'executor', ['representatives']],
    ['general_cases', 'procedural_position', ['procedural_position']],
    ['court_schedule', 'court', ['court']],
    ['court_schedule', 'representative', ['representatives']],
    ['court_schedule', 'category', ['stage', 'case_category']],
    ['municipal_registry', 'court', ['court']],
    ['municipal_registry', 'stage', ['stage']],
    ['emergency_fund', 'court', ['court']],
    ['emergency_fund', 'stage', ['stage']],
    ['emergency_fund', 'requirements', ['requirements']],
    ['emergency_fund', 'prosecutor', ['prosecutor']],
    ['emergency_fund', 'district', ['district']]
  ].filter(([, , categories]) => categories.includes(category));

  for (const [table, column] of checks) {
    const row = await get(dbPath, `SELECT 1 AS used FROM ${table} WHERE COALESCE(${column}, '')=? LIMIT 1`, [value]).catch(() => null);
    if (row?.used) return true;
  }
  return false;
}

function readBody(req, { maxBytes = DEFAULT_JSON_BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let finished = false;

    const fail = error => {
      if (finished) return;
      finished = true;
      reject(error);
    };

    req.on('data', chunk => {
      if (finished) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        const error = new Error('Размер запроса превышает допустимый лимит');
        error.code = 'PAYLOAD_TOO_LARGE';
        error.maxBytes = maxBytes;
        fail(error);
        req.resume();
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch {
        const error = new Error('Некорректный JSON в запросе');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', fail);
  });
}

const CASE_DOCUMENT_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const REPORT_DOCUMENT_MIME = {
  ...CASE_DOCUMENT_MIME,
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function caseDocumentsDir(dbPath) {
  return pathModule.join(pathModule.dirname(dbPath), 'uploads', 'general-cases');
}

function reportDocumentsDir(dbPath) {
  return pathModule.join(pathModule.dirname(dbPath), 'uploads', 'reports');
}

function sanitizeUploadedFileName(value) {
  const original = pathModule.basename(String(value || 'document'));
  const clean = original.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  return clean || 'document';
}

function isPathInside(parent, candidate) {
  const relative = pathModule.relative(pathModule.resolve(parent), pathModule.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !pathModule.isAbsolute(relative));
}

function streamInlineFile(res, filePath, mimeType) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { sendJson(res, 404, { error: 'file_not_found' }); return; }
  if (!stat.isFile()) { sendJson(res, 404, { error: 'file_not_found' }); return; }
  res.writeHead(200, {
    'Content-Type': mimeType || CASE_DOCUMENT_MIME[pathModule.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pathModule.basename(filePath))}`,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
}

function streamReportFile(res, filePath, mimeType, disposition = 'attachment') {
  let stat;
  try { stat = fs.statSync(filePath); } catch { sendJson(res, 404, { error: 'file_not_found' }); return; }
  if (!stat.isFile()) { sendJson(res, 404, { error: 'file_not_found' }); return; }
  if (!['inline', 'attachment'].includes(disposition)) disposition = 'attachment';
  res.writeHead(200, {
    'Content-Type': mimeType || REPORT_DOCUMENT_MIME[pathModule.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(pathModule.basename(filePath))}`,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toReportDate(value = '') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value || '').trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})/);
  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatReportDate(value = '') {
  const date = toReportDate(value);
  return date ? `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}` : String(value || '');
}

function toReportIsoDate(value = '') {
  const date = toReportDate(value);
  return date ? `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` : '';
}

function isReportDateInMonth(value, year, monthIndex) {
  const date = toReportDate(value);
  return Boolean(date && date.getFullYear() === year && date.getMonth() === monthIndex);
}

function isReportDateToday(value, today = new Date()) {
  const date = toReportDate(value);
  return Boolean(date
    && date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate());
}

function isReportDateOverdue(value, today = new Date()) {
  const date = toReportDate(value);
  if (!date) return false;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date.getTime() < day.getTime();
}

function getQuarterFromDate(value = new Date()) {
  const date = toReportDate(value) || new Date();
  return Math.floor(date.getMonth() / 3) + 1;
}

function getQuarterMonthIndexes(quarter) {
  const value = Math.min(4, Math.max(1, Number(quarter) || 1));
  const start = (value - 1) * 3;
  return [start, start + 1, start + 2];
}

function normalizeReportYear(value, fallbackDate = new Date()) {
  const year = Number(value);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;
  const date = toReportDate(fallbackDate) || new Date();
  return date.getFullYear();
}

function normalizeReportQuarter(value, fallbackDate = new Date()) {
  const quarter = Number(value);
  if (Number.isInteger(quarter) && quarter >= 1 && quarter <= 4) return quarter;
  return getQuarterFromDate(fallbackDate);
}

function normalizeReportUserIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(item => Number(item)).filter(Number.isInteger).filter(id => id > 0))];
}

function canManageReportScope(session) {
  return normalizeRoleLevel(session?.role_level) >= ROLE_LEVELS.REPORT_ADMIN
    || hasPermission(session, PERMISSIONS.REPORTS_MANAGE_ALL);
}

async function listReportUsers(dbPath) {
  const rows = await all(dbPath, `
    SELECT id, full_name, role_level, is_active
    FROM users
    WHERE COALESCE(full_name,'')<>''
    ORDER BY
      CASE WHEN COALESCE(is_active, 0)=1 THEN 0 ELSE 1 END,
      full_name COLLATE NOCASE,
      id
  `, []).catch(() => []);
  return rows.map(row => ({
    id: Number(row.id),
    full_name: row.full_name || '',
    role_level: normalizeRoleLevel(row.role_level),
    is_active: Number(row.is_active ?? 1) ? 1 : 0
  })).filter(row => row.id && row.full_name);
}

async function resolveCurrentReportUser(dbPath, session) {
  const sessionId = Number(session?.id || 0);
  if (sessionId) {
    const user = await get(dbPath, `
      SELECT id, full_name, role_level, is_active
      FROM users
      WHERE id=? AND COALESCE(is_active,1)=1
      LIMIT 1
    `, [sessionId]).catch(() => null);
    if (user) {
      return {
        id: Number(user.id),
        full_name: user.full_name || session.full_name || '',
        role_level: normalizeRoleLevel(user.role_level),
        is_active: 1
      };
    }
  }

  const fullName = String(session?.full_name || '').trim();
  if (fullName) {
    const user = await get(dbPath, `
      SELECT id, full_name, role_level, is_active
      FROM users
      WHERE full_name=? AND COALESCE(is_active,1)=1
      LIMIT 1
    `, [fullName]).catch(() => null);
    if (user) {
      return {
        id: Number(user.id),
        full_name: user.full_name || fullName,
        role_level: normalizeRoleLevel(user.role_level),
        is_active: 1
      };
    }
  }

  return {
    id: sessionId || 0,
    full_name: fullName,
    role_level: normalizeRoleLevel(session?.role_level),
    is_active: 1
  };
}

async function getReportScope(dbPath, session, source = {}) {
  const currentUser = await resolveCurrentReportUser(dbPath, session);
  const manager = canManageReportScope(session);
  const allUsers = await listReportUsers(dbPath);

  if (!manager) {
    return {
      can_manage_all: false,
      current_user: currentUser,
      available_users: [],
      selected_users: currentUser.full_name ? [currentUser] : [],
      selected_user_ids: currentUser.id ? [currentUser.id] : [],
      selected_names: currentUser.full_name ? [currentUser.full_name] : []
    };
  }

  const rawUserIds = source.user_ids ?? source.user_id ?? '';
  const allRequested = String(rawUserIds || '').trim().toLowerCase() === 'all'
    || String(source.scope || '').trim().toLowerCase() === 'all'
    || String(source.all || '') === '1';
  let selectedUsers = allRequested ? allUsers : [];

  if (!selectedUsers.length) {
    const ids = normalizeReportUserIds(rawUserIds);
    if (ids.length) {
      const allowed = new Set(allUsers.map(user => Number(user.id)));
      const forbidden = ids.find(id => !allowed.has(id));
      if (forbidden) {
        const error = new Error('Запрошенный сотрудник недоступен');
        error.code = 'REPORT_SCOPE_FORBIDDEN';
        throw error;
      }
      selectedUsers = allUsers.filter(user => ids.includes(Number(user.id)));
    }
  }

  if (!selectedUsers.length) selectedUsers = allUsers.length ? allUsers : [currentUser].filter(user => user.full_name);

  return {
    can_manage_all: true,
    current_user: currentUser,
    available_users: allUsers,
    selected_users: selectedUsers,
    selected_user_ids: selectedUsers.map(user => Number(user.id)).filter(Boolean),
    selected_names: selectedUsers.map(user => user.full_name).filter(Boolean)
  };
}

function isOwnedByReportScope(row = {}, scope = {}, keys = []) {
  const names = new Set((scope.selected_names || []).map(name => String(name || '').trim().toLowerCase()));
  if (!names.size) return false;
  return keys.some(key => names.has(String(row[key] || '').trim().toLowerCase()));
}

function serializeQuarterlyReport(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    user_name: row.user_name || '',
    year: Number(row.year),
    quarter: Number(row.quarter),
    original_name: row.original_name || '',
    mime_type: row.mime_type || '',
    size_bytes: Number(row.size_bytes || 0),
    uploaded_by: row.uploaded_by ? Number(row.uploaded_by) : null,
    uploaded_by_name: row.uploaded_by_name || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function reportFilePath(dbPath, row = {}) {
  const uploadDir = reportDocumentsDir(dbPath);
  const filePath = pathModule.resolve(uploadDir, String(row.stored_name || ''));
  return isPathInside(uploadDir, filePath) ? filePath : '';
}

async function getQuarterlyReportById(dbPath, id) {
  return await get(dbPath, 'SELECT * FROM quarterly_reports WHERE id=? LIMIT 1', [Number(id)]).catch(() => null);
}

async function assertQuarterlyReportAccess(dbPath, session, reportId) {
  const row = await getQuarterlyReportById(dbPath, reportId);
  if (!row) {
    const error = new Error('Отчет не найден');
    error.code = 'REPORT_NOT_FOUND';
    throw error;
  }

  if (!canManageReportScope(session)) {
    const currentUser = await resolveCurrentReportUser(dbPath, session);
    if (!currentUser.id || Number(row.user_id) !== Number(currentUser.id)) {
      const error = new Error('Отчет недоступен');
      error.code = 'REPORT_FORBIDDEN';
      throw error;
    }
  }

  return row;
}

async function buildReportsSummary(dbPath, scope, year, quarter, reportDate = new Date()) {
  const now = toReportDate(reportDate) || new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const ownerFilter = row => isOwnedByReportScope(row, scope, ['executor', 'representative', 'user_name', 'user', 'delegated_to', 'case_executor']);

  const generalRows = (await all(dbPath, 'SELECT * FROM general_cases ORDER BY id DESC LIMIT 10000', []).catch(() => []))
    .filter(row => ownerFilter(row));
  const activeCases = generalRows.filter(row => Number(row.archived || 0) !== 1);
  const casesThisMonth = activeCases.filter(row => isReportDateInMonth(row.registration_date || row.created_at, thisYear, thisMonth));
  const updatedThisMonth = activeCases.filter(row => isReportDateInMonth(row.updated_at || row.created_at, thisYear, thisMonth));
  const judicialActCases = activeCases.filter(row => [
    row.judicial_act_date_first,
    row.motivated_decision_date,
    row.appeal_act_date,
    row.cassation_act_date
  ].some(value => isReportDateInMonth(value, thisYear, thisMonth)));
  const movementIds = new Set([...updatedThisMonth, ...judicialActCases].map(row => Number(row.id)).filter(Boolean));
  const quarterMonths = getQuarterMonthIndexes(quarter).map(monthIndex => {
    const current = generalRows.filter(row => isReportDateInMonth(row.registration_date || row.created_at, year, monthIndex)).length;
    const previous = generalRows.filter(row => isReportDateInMonth(row.registration_date || row.created_at, year - 1, monthIndex)).length;
    return {
      month: monthIndex + 1,
      label: new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(year, monthIndex, 1)),
      count: current,
      previous_count: previous,
      dynamics_percent: previous ? Math.round(((current - previous) / previous) * 100) : null
    };
  });

  const scheduleRows = (await all(dbPath, `
    SELECT s.*, g.executor AS case_executor, g.case_no, g.court_no, g.claim_subject
    FROM court_schedule s
    LEFT JOIN general_cases g ON g.id=s.general_case_id
    WHERE COALESCE(s.is_date_row,0)=0
    ORDER BY s.session_date ASC, s.time ASC, s.id ASC
    LIMIT 10000
  `, []).catch(() => [])).filter(row => ownerFilter(row));
  const todayHearings = scheduleRows.filter(row => isReportDateToday(row.session_date || row.hearing_date, now));

  const controlledSeen = new Set();
  const controlledRows = (await all(dbPath, 'SELECT * FROM controlled_cases ORDER BY id DESC LIMIT 10000', []).catch(() => []))
    .filter(row => ownerFilter(row))
    .filter(row => isReportDateToday(row.updated_at || row.created_at, now))
    .filter(row => {
      const key = String(row.general_case_id || row.id || '').trim();
      if (!key || controlledSeen.has(key)) return false;
      controlledSeen.add(key);
      return true;
    });

  const taskRows = (await all(dbPath, `
    SELECT
      t.*,
      g.case_no AS linked_case_no,
      g.court_no AS linked_court_no,
      g.claim_subject AS linked_subject
    FROM calendar_tasks t
    LEFT JOIN general_cases g ON g.id=t.general_case_id
    ORDER BY COALESCE(t.date_str, t."date", '') ASC, COALESCE(t.time_val, t."time", '') ASC, t.id ASC
    LIMIT 10000
  `, []).catch(() => [])).filter(row => ownerFilter(row));
  const openTasks = taskRows.filter(row => Number(row.done || 0) !== 1);
  const todayTasks = taskRows.filter(row => isReportDateToday(row.date_str || row.date, now));
  const overdueTasks = openTasks.filter(row => isReportDateOverdue(row.date_str || row.date, now));

  const workloadByName = new Map();
  for (const user of scope.selected_users || []) {
    workloadByName.set(user.full_name, {
      user_id: user.id,
      user_name: user.full_name,
      is_active: Number(user.is_active ?? 1) ? 1 : 0,
      active_cases: 0,
      hearings_today: 0,
      controlled_cases: 0,
      open_tasks: 0,
      overdue_tasks: 0
    });
  }
  const ensureWorkload = name => {
    const key = String(name || '').trim();
    if (!key) return null;
    if (!workloadByName.has(key)) workloadByName.set(key, {
      user_id: null,
      user_name: key,
      is_active: 1,
      active_cases: 0,
      hearings_today: 0,
      controlled_cases: 0,
      open_tasks: 0,
      overdue_tasks: 0
    });
    return workloadByName.get(key);
  };
  activeCases.forEach(row => { const item = ensureWorkload(row.executor); if (item) item.active_cases += 1; });
  todayHearings.forEach(row => { const item = ensureWorkload(row.representative || row.case_executor); if (item) item.hearings_today += 1; });
  controlledRows.forEach(row => { const item = ensureWorkload(row.representative); if (item) item.controlled_cases += 1; });
  openTasks.forEach(row => { const item = ensureWorkload(row.user_name || row.user || row.delegated_to); if (item) item.open_tasks += 1; });
  overdueTasks.forEach(row => { const item = ensureWorkload(row.user_name || row.user || row.delegated_to); if (item) item.overdue_tasks += 1; });

  const reportParams = [year, quarter];
  let reportWhere = 'WHERE year=? AND quarter=?';
  if (scope.selected_user_ids.length) {
    reportWhere += ` AND user_id IN (${scope.selected_user_ids.map(() => '?').join(',')})`;
    reportParams.push(...scope.selected_user_ids);
  } else {
    reportWhere += ' AND 1=0';
  }
  const reportRows = await all(dbPath, `
    SELECT *
    FROM quarterly_reports
    ${reportWhere}
    ORDER BY user_name, updated_at DESC, id DESC
  `, reportParams).catch(() => []);
  const reportUserIds = new Set(reportRows.map(row => Number(row.user_id)));
  const employeesWithoutReport = (scope.selected_users || [])
    .filter(user => user.id && !reportUserIds.has(Number(user.id)))
    .map(user => ({ id: user.id, full_name: user.full_name }));

  return {
    metrics: {
      active_cases: activeCases.length,
      cases_this_month: casesThisMonth.length,
      updated_this_month: updatedThisMonth.length,
      judicial_act_cases_this_month: judicialActCases.length,
      movement_percent: activeCases.length ? Math.round((movementIds.size / activeCases.length) * 100) : 0,
      hearings_today: todayHearings.length,
      controlled_cases: controlledRows.length,
      calendar_tasks: taskRows.length,
      open_tasks: openTasks.length,
      overdue_tasks: overdueTasks.length,
      quarterly_reports: reportRows.length,
      employees_without_report: employeesWithoutReport.length
    },
    quarter_months: quarterMonths,
    active_cases: activeCases.slice(0, 12).map(row => ({
      id: row.id,
      case_no: row.case_no || row.court_no || '',
      court: row.court || '',
      executor: row.executor || '',
      subject: row.claim_subject || '',
      registration_date: formatReportDate(row.registration_date),
      updated_at: row.updated_at || ''
    })),
    hearings_today: todayHearings.slice(0, 20).map(row => ({
      id: row.id,
      general_case_id: row.general_case_id || null,
      session_date: formatReportDate(row.session_date || row.hearing_date),
      time: row.time || '',
      court: row.court || '',
      representative: row.representative || row.case_executor || '',
      case_executor: row.case_executor || '',
      case_no: row.case_no || row.court_no || '',
      subject: row.result || row.claim_subject || ''
    })),
    controlled_cases: controlledRows.slice(0, 12).map(row => ({
      id: row.id,
      case_number: row.case_number || row.court_case_number || '',
      representative: row.representative || '',
      subject: row.subject || '',
      result: row.result || '',
      updated_at: row.updated_at || ''
    })),
    calendar_tasks: taskRows.slice(0, 500).map(row => ({
      id: row.id,
      date: formatReportDate(row.date_str || row.date),
      time: row.time_val || row.time || '',
      user_name: row.user_name || row.user || '',
      type: row.task_type || row.type || '',
      description: row.description || row.desc || row.assignment || '',
      general_case_id: row.general_case_id || null,
      case_no: row.linked_case_no || row.linked_court_no || '',
      subject: row.subject || row.linked_subject || '',
      done: Number(row.done || 0) ? 1 : 0,
      overdue: isReportDateOverdue(row.date_str || row.date, now) && Number(row.done || 0) !== 1 ? 1 : 0
    })),
    today_tasks: todayTasks.slice(0, 100).map(row => ({
      id: row.id,
      time: row.time_val || row.time || '',
      user_name: row.user_name || row.user || '',
      description: row.description || row.desc || row.assignment || '',
      general_case_id: row.general_case_id || null,
      case_no: row.linked_case_no || row.linked_court_no || '',
      subject: row.subject || row.linked_subject || '',
      done: Number(row.done || 0) ? 1 : 0
    })),
    workload: [...workloadByName.values()].sort((a, b) => {
      const statusDiff = (Number(b.is_active ?? 1) ? 1 : 0) - (Number(a.is_active ?? 1) ? 1 : 0);
      if (statusDiff) return statusDiff;
      const loadDiff = (
        (b.active_cases + b.open_tasks + b.controlled_cases + b.hearings_today)
        - (a.active_cases + a.open_tasks + a.controlled_cases + a.hearings_today)
      );
      if (loadDiff) return loadDiff;
      return String(a.user_name || '').localeCompare(String(b.user_name || ''), 'ru');
    }),
    quarterly_reports: reportRows.map(serializeQuarterlyReport),
    employees_without_report: employeesWithoutReport
  };
}

async function saveQuarterlyReportDocument(dbPath, session, body = {}) {
  const scope = await getReportScope(dbPath, session, { user_id: body.user_id || body.user_ids || '' });
  let targetUser = scope.current_user;
  if (canManageReportScope(session)) {
    const requestedUserId = Number(body.user_id || 0);
    if (!requestedUserId) {
      const error = new Error('Не выбран сотрудник для отчета');
      error.code = 'REPORT_USER_REQUIRED';
      throw error;
    }
    targetUser = scope.selected_users.find(user => Number(user.id) === requestedUserId) || null;
    if (!targetUser) {
      const error = new Error('Сотрудник недоступен');
      error.code = 'REPORT_SCOPE_FORBIDDEN';
      throw error;
    }
  }

  if (!targetUser?.id || !targetUser?.full_name) {
    const error = new Error('Пользователь отчета не найден');
    error.code = 'REPORT_USER_REQUIRED';
    throw error;
  }

  const reportDate = body.report_date || new Date();
  const year = normalizeReportYear(body.year, reportDate);
  const quarter = normalizeReportQuarter(body.quarter, reportDate);
  const originalName = sanitizeUploadedFileName(body.name || body.file_name || 'quarterly-report');
  const ext = pathModule.extname(originalName).toLowerCase();
  if (!REPORT_DOCUMENT_MIME[ext]) {
    const error = new Error('Недопустимый тип файла');
    error.code = 'REPORT_UNSUPPORTED_TYPE';
    throw error;
  }

  const raw = String(body.data_base64 || body.content_base64 || '').replace(/^data:[^;]+;base64,/, '');
  let bytes;
  try { bytes = Buffer.from(raw, 'base64'); } catch { bytes = null; }
  if (!bytes?.length) {
    const error = new Error('Пустой файл отчета');
    error.code = 'REPORT_EMPTY_FILE';
    throw error;
  }
  if (bytes.length > MAX_REPORT_DOCUMENT_BYTES) {
    const error = new Error('Файл отчета превышает 100 МБ');
    error.code = 'REPORT_FILE_TOO_LARGE';
    throw error;
  }

  const uploadDir = reportDocumentsDir(dbPath);
  fs.mkdirSync(uploadDir, { recursive: true });
  const storedName = `${targetUser.id}-${year}-q${quarter}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const filePath = pathModule.join(uploadDir, storedName);
  fs.writeFileSync(filePath, bytes);

  const existing = await get(dbPath, 'SELECT id FROM quarterly_reports WHERE user_id=? AND year=? AND quarter=?', [targetUser.id, year, quarter]).catch(() => null);
  const now = new Date().toISOString();
  if (existing) {
    await run(dbPath, `
      UPDATE quarterly_reports
      SET user_name=?, original_name=?, stored_name=?, mime_type=?, size_bytes=?,
          uploaded_by=?, uploaded_by_name=?, updated_at=?
      WHERE id=?
    `, [
      targetUser.full_name,
      originalName,
      storedName,
      REPORT_DOCUMENT_MIME[ext],
      bytes.length,
      session?.id || null,
      session?.full_name || '',
      now,
      existing.id
    ]);
    return await getQuarterlyReportById(dbPath, existing.id);
  }

  const result = await run(dbPath, `
    INSERT INTO quarterly_reports (
      user_id, user_name, year, quarter, original_name, stored_name, mime_type,
      size_bytes, uploaded_by, uploaded_by_name, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    targetUser.id,
    targetUser.full_name,
    year,
    quarter,
    originalName,
    storedName,
    REPORT_DOCUMENT_MIME[ext],
    bytes.length,
    session?.id || null,
    session?.full_name || '',
    now,
    now
  ]);
  return await getQuarterlyReportById(dbPath, result.id);
}

function convertWordDocumentToPdf(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Word preview is available on Windows with Microsoft Word installed'));
      return;
    }
    const quote = value => String(value).replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop';$word=New-Object -ComObject Word.Application;$word.Visible=$false;try{$doc=$word.Documents.Open('${quote(inputPath)}',$false,$true);$doc.ExportAsFixedFormat('${quote(outputPath)}',17);$doc.Close($false)}finally{$word.Quit()}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(stderr.trim() || `Word exited with code ${code}`));
    });
  });
}

function openFileWithSystem(filePath) {
  return new Promise((resolve, reject) => {
    let command;
    let args;
    if (process.platform === 'win32') {
      command = 'cmd.exe';
      args = ['/c', 'start', '', filePath];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [filePath];
    } else {
      command = 'xdg-open';
      args = [filePath];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function normCase(data = {}) {
  return {
    case_no: data.case_no || '', court_no: data.court_no || '', court: data.court || '', judge: data.judge || '', executor: data.executor || '',
    category: data.category || '', procedural_position: data.procedural_position || '', claim_subject: data.claim_subject || '',
    claim_address: data.claim_address || '',
    registration_date: data.registration_date || '', review_result: data.review_result || '', plaintiff: data.plaintiff || '', defendant: data.defendant || '',
    comments: data.comments || '',
    judicial_act_date_first: data.judicial_act_date_first || '',
    first_instance_act_type: data.first_instance_act_type || '',
    motivated_decision_date: data.motivated_decision_date || '',
    appeal_act_date: data.appeal_act_date || '',
    cassation_act_date: data.cassation_act_date || '',
    documents_json: data.documents_json || '',
    process_kind: data.process_kind || '',
    act_instance: data.act_instance || '',
    proceeding_form: data.proceeding_form || '',
    appeal_kind: data.appeal_kind || '',
    order_copy_date: data.order_copy_date || '',
    apk_cassation_has_appeal: data.apk_cassation_has_appeal || '',
    supervision_cassation_exhausted: data.supervision_cassation_exhausted || '',
    late_motivated_received: data.late_motivated_received || '',
    appeals_json: data.appeals_json || '',
    review_show_flag: data.review_show_flag ? 1 : 0,
    emergency_fund_flag: data.emergency_fund_flag ? 1 : 0,
    registry_flag: data.registry_flag ? 1 : 0,
    attendance_hearing_missing: Number(data.attendance_hearing_missing || 0) ? 1 : 0,
    control_flag: data.control_flag ? 1 : 0, attendance_flag: data.attendance_flag ? 1 : 0
  };
}


function controlledValue(data = {}, keys = [], defaultValue = '') {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return defaultValue;
}

function normControlled(data = {}) {
  return {
    case_number: controlledValue(data, ['case_number', 'case_num', 'case_no']),
    plaintiff: controlledValue(data, ['plaintiff']),
    defendant: controlledValue(data, ['defendant']),
    subject: controlledValue(data, ['subject', 'claim_subject']),
    representative: controlledValue(data, ['representative', 'executor']),
    result: controlledValue(data, ['result', 'history_results']),
    court_case_number: controlledValue(data, ['court_case_number', 'court_case_num', 'court_no']),
    court: controlledValue(data, ['court', 'court_name']),
    general_case_id: controlledValue(data, ['general_case_id'], null)
  };
}

async function syncLinked(dbPath, id, d) {
  if (Number(d.control_flag) === 1) {
    const existing = await get(dbPath, 'SELECT id FROM controlled_cases WHERE general_case_id=? LIMIT 1', [id]);
    const vals = [d.case_no, d.plaintiff, d.defendant, d.claim_subject, d.executor, d.review_result, d.court_no, d.court, id, new Date().toISOString()];
    if (existing) {
      await run(dbPath, `UPDATE controlled_cases SET case_number=?, plaintiff=?, defendant=?, subject=?, representative=?, result=?, court_case_number=?, court=?, general_case_id=?, updated_at=? WHERE id=?`, [...vals, existing.id]);
    } else {
      await run(dbPath, `INSERT INTO controlled_cases (case_number, plaintiff, defendant, subject, representative, result, court_case_number, court, general_case_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, vals);
    }
  }
  if (Number(d.attendance_flag) === 1) {
    try { await run(dbPath, 'ALTER TABLE court_schedule ADD COLUMN general_case_id INTEGER'); } catch {}
    const existing = await get(dbPath, 'SELECT id FROM court_schedule WHERE general_case_id=? LIMIT 1', [id]);
    const date = d.registration_date || '';
    const vals = [date, d.court, '', d.executor, d.plaintiff, d.defendant, d.category, d.claim_subject, 0, date, id, new Date().toISOString()];
    if (existing) {
      await run(dbPath, `UPDATE court_schedule SET session_date=?, court=?, time=?, representative=?, plaintiff=?, defendant=?, category=?, result=?, is_date_row=?, hearing_date=?, general_case_id=?, updated_at=? WHERE id=?`, [...vals, existing.id]);
    } else {
      await run(dbPath, `INSERT INTO court_schedule (session_date, court, time, representative, plaintiff, defendant, category, result, is_date_row, hearing_date, general_case_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, vals);
    }
  }
}


function anyValue(data = {}, keys = [], fallback = '') {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function normEnforcement(data = {}) {
  const character = anyValue(data, ['production_character', 'Характер'], '');
  return {
    mode: anyValue(data, ['mode'], 'debtor'),
    archived: Number(anyValue(data, ['archived'], 0)) ? 1 : 0,

    case_number: anyValue(data, ['case_number', 'ip_number', 'Номер ИП']),
    ip_number: anyValue(data, ['ip_number', 'case_number', 'Номер ИП']),
    subject_execution: anyValue(data, ['subject_execution', 'Предмет исполнения']),

    date_start: anyValue(data, ['date_start', 'start_date', 'Дата возбуждения']),
    start_date: anyValue(data, ['start_date', 'date_start', 'Дата возбуждения']),

    basis: anyValue(data, ['basis', 'start_basis', 'Основание возбуждения ИП']),
    start_basis: anyValue(data, ['start_basis', 'basis', 'Основание возбуждения ИП']),

    appeal_info: anyValue(data, ['appeal_info', 'Сведения об обжаловании']),

    deadline: anyValue(data, ['deadline', 'execution_deadline', 'term_execution', 'Срок исполнения']),
    execution_deadline: anyValue(data, ['execution_deadline', 'deadline', 'term_execution', 'Срок исполнения']),
    term_execution: anyValue(data, ['term_execution', 'deadline', 'execution_deadline', 'Срок исполнения']),

    nature: anyValue(data, ['nature'], character === 'Нематериальное' ? 'non_material' : 'material'),
    production_character: character,

    amount_claimed: anyValue(data, ['amount_claimed', 'claim_sum', 'claim_amount', 'Сумма требований(руб.)']),
    claim_sum: anyValue(data, ['claim_sum', 'amount_claimed', 'claim_amount', 'Сумма требований(руб.)']),
    claim_amount: anyValue(data, ['claim_amount', 'amount_claimed', 'claim_sum', 'Сумма требований(руб.)']),

    payment_info: anyValue(data, ['payment_info', 'payments_json', 'Сведения об оплате']),
    payments_json: anyValue(data, ['payments_json', 'payment_info', 'Сведения об оплате']),

    total_paid: anyValue(data, ['total_paid', 'amount_paid_total', 'Итого оплачено']),
    amount_paid_total: anyValue(data, ['amount_paid_total', 'total_paid', 'Итого оплачено']),

    debt: anyValue(data, ['debt', 'debt_amount', 'Долг']),
    debt_amount: anyValue(data, ['debt_amount', 'debt', 'Долг'])
  };
}



function normCalendarTask(data = {}) {
  return {
    date: anyValue(data, ['date', 'date_str'], ''),
    end_date: anyValue(data, ['end_date'], ''),
    user: anyValue(data, ['user', 'user_name'], ''),
    type: anyValue(data, ['type', 'task_type'], 'судебное_заседание'),
    event_scope: anyValue(data, ['event_scope'], 'work'),
    personal_kind: anyValue(data, ['personal_kind'], ''),
    desc: anyValue(data, ['desc', 'description'], ''),
    time: anyValue(data, ['time', 'time_val'], ''),
    end_time: anyValue(data, ['end_time'], ''),
    court: anyValue(data, ['court'], ''),
    subject: anyValue(data, ['subject'], ''),
    assignment: anyValue(data, ['assignment'], ''),
    note_text: anyValue(data, ['note_text'], ''),
    private_note: anyValue(data, ['private_note'], ''),
    metadata_json: typeof data.metadata_json === 'string'
      ? data.metadata_json
      : JSON.stringify(data.metadata || {}),
    delegated_to: anyValue(data, ['delegated_to'], ''),
    delegated_by: anyValue(data, ['delegated_by'], ''),
    delegation_status: anyValue(data, ['delegation_status'], ''),
    delegation_source_event_id: anyValue(data, ['delegation_source_event_id'], null),
    conflict_override: Number(anyValue(data, ['conflict_override'], 0)) ? 1 : 0,
    done: Number(anyValue(data, ['done'], 0)) ? 1 : 0,
    meeting_id: anyValue(data, ['meeting_id'], null),
    general_case_id: anyValue(data, ['general_case_id'], null)
  };
}

async function getRequestSession(req, dbPath) {
  const header = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
  if (!token) return null;

  const row = await get(dbPath, `
    SELECT user_id AS id, full_name, role_level, permissions_json, expires_at
    FROM app_sessions
    WHERE token=?
    LIMIT 1
  `, [token]).catch(() => null);

  if (!row) return null;
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt && expiresAt <= Date.now()) {
    await run(dbPath, 'DELETE FROM app_sessions WHERE token=?', [token]).catch(() => {});
    return null;
  }

  const user = row.id
    ? await get(dbPath, 'SELECT * FROM users WHERE id=? AND COALESCE(is_active,1)=1 LIMIT 1', [row.id]).catch(() => null)
    : await get(dbPath, 'SELECT * FROM users WHERE full_name=? AND COALESCE(is_active,1)=1 LIMIT 1', [row.full_name]).catch(() => null);
  if (row.id && !user) {
    await run(dbPath, 'DELETE FROM app_sessions WHERE token=?', [token]).catch(() => {});
    activeSessions.delete(token);
    return null;
  }
  const activeSession = await buildSessionFromUser(dbPath, user || row);
  activeSessions.set(token, activeSession);
  return activeSession;
}

function canEditCalendarTask(session, row) {
  if (!session || !row) return false;
  if (hasPermission(session, PERMISSIONS.CALENDAR_EDIT_ANY)) return true;
  return String(row.user_name || row.user || '') === String(session.full_name || '');
}

function maskCalendarTaskForViewer(row, session) {
  const owner = String(row.user_name || row.user || '');
  const scope = String(row.event_scope || 'work');
  if (scope !== 'personal' || !session || owner === String(session.full_name || '')) return row;
  return {
    ...row,
    description: 'Отсутствие',
    desc: 'Отсутствие',
    personal_kind: '',
    private_note: '',
    note_text: '',
    court: '',
    subject: '',
    assignment: '',
    is_private_masked: 1
  };
}

function toIsoDateLocal(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateTime(dateValue = '', timeValue = '', endOfDay = false) {
  const match = String(dateValue || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const timeMatch = String(timeValue || '').trim().match(/^(\d{1,2}):(\d{2})/);
  const hours = timeMatch ? Number(timeMatch[1]) : (endOfDay ? 23 : 0);
  const minutes = timeMatch ? Number(timeMatch[2]) : (endOfDay ? 59 : 0);
  const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes, endOfDay && !timeMatch ? 59 : 0, 0);
  return Number.isNaN(result.getTime()) ? null : result;
}

function formatRuDateServer(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '');
}

function dayDifference(fromIso, toIso) {
  const from = String(fromIso || '').split('-').map(Number);
  const to = String(toIso || '').split('-').map(Number);
  if (from.length !== 3 || to.length !== 3 || from.some(Number.isNaN) || to.some(Number.isNaN)) return 0;
  return Math.round((Date.UTC(to[0], to[1] - 1, to[2]) - Date.UTC(from[0], from[1] - 1, from[2])) / 86400000);
}

function pluralDays(value) {
  const number = Math.abs(Number(value || 0));
  const mod100 = number % 100;
  const mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

function cleanNotificationTaskTitle(value = '') {
  return String(value || '')
    .replace(/^\[Авто общего перечня\]\s*/i, '')
    .trim() || 'Выполнить задачу';
}

function getDeadlineLabel(description = '') {
  const text = cleanNotificationTaskTitle(description);
  const match = text.match(/последн(?:ий|его)\s+день\s+подач[аи]\s+(.+?)(?:\s+по\s+делу|$)/i);
  if (!match) return 'процессуального срока';
  return `срока на ${String(match[1] || '').trim().toLowerCase()}`;
}

function notificationCaseLabel(row = {}) {
  const value = row.case_no || row.court_no || row.subject || '';
  return value ? `№${String(value).replace(/^№\s*/, '')}` : 'без номера';
}

function parseJsonArraySafe(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringifyHistory(history = []) {
  return JSON.stringify(Array.isArray(history) ? history.slice(-80) : []);
}

function appendApprovalHistory(row = {}, action, actor, comment = '') {
  const history = parseJsonArraySafe(row.history_json);
  history.push({
    action,
    actor: actor || '',
    comment: comment || '',
    at: new Date().toISOString()
  });
  return stringifyHistory(history);
}

function canReviewGeneralCaseApproval(session) {
  return hasPermission(session, PERMISSIONS.CASES_EDIT_ANY);
}

function canRequestGeneralCaseApproval(session, generalCase) {
  return canEditGeneralCase(session, generalCase);
}

function normalizeApprovalStatus(status = '') {
  const value = String(status || '').trim();
  return ['draft', 'pending', 'revision_required', 'approved', 'completed'].includes(value)
    ? value
    : 'draft';
}

function approvalResponse(row = {}) {
  return {
    ...row,
    documentId: row.document_id || '',
    status: normalizeApprovalStatus(row.status),
    history: parseJsonArraySafe(row.history_json)
  };
}

function findReviewDocument(documents = [], options = {}) {
  const documentId = String(options.documentId || options.document_id || '').trim();
  if (documentId) {
    const byId = documents.find(doc => String(doc.id || doc.document_id || '').trim() === documentId);
    if (byId) return byId;
  }
  const documentIndex = options.documentIndex ?? options.document_index;
  if (Number.isInteger(documentIndex) && documents[documentIndex]) return documents[documentIndex];
  const targetPath = String(options.documentPath || options.document_path || '').trim();
  if (targetPath) {
    return documents.find(doc => String(doc.path || '').trim() === targetPath) || null;
  }
  return documents.find(doc => /отзыв|review/i.test(String(`${doc.type || ''} ${doc.name || ''}`))) || documents[0] || null;
}

async function buildUserNotifications(dbPath, session) {
  const userName = String(session?.full_name || '').trim();
  if (!userName) return [];

  const now = new Date();
  const todayIso = toIsoDateLocal(now);
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 59, 59, 999);
  const overdueFloor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60, 0, 0, 0, 0);

  const taskRows = await all(dbPath, `
    SELECT c.*, g.case_no, g.court_no
    FROM calendar_tasks c
    LEFT JOIN general_cases g ON g.id=c.general_case_id
    WHERE (COALESCE(NULLIF(c.user_name, ''), c."user", '')=? OR COALESCE(c.delegated_to, '')=?)
      AND COALESCE(c.done, 0)=0
      AND COALESCE(c.event_scope, 'work')<>'personal'
    ORDER BY COALESCE(NULLIF(c.date_str, ''), c."date", '') ASC,
             COALESCE(NULLIF(c.time_val, ''), c."time", '') ASC,
             c.id ASC
  `, [userName, userName]).catch(() => []);

  const notifications = [];
  for (const row of taskRows) {
    const type = String(row.task_type || row.type || '').trim();
    const dateValue = String(row.date_str || row.date || '').trim();
    const timeValue = String(row.time_val || row.time || '').trim();
    if (!dateValue) continue;

    if (type === 'судебное_заседание') {
      const eventAt = parseLocalDateTime(dateValue, timeValue, !timeValue);
      if (!eventAt || eventAt < overdueFloor || eventAt > horizon) continue;
      const overdue = eventAt.getTime() <= now.getTime();
      const caseLabel = notificationCaseLabel(row);
      const when = dateValue === todayIso
        ? `сегодня${timeValue ? ` в ${timeValue}` : ''}`
        : `${formatRuDateServer(dateValue)}${timeValue ? ` в ${timeValue}` : ''}`;
      notifications.push({
        key: `hearing:${row.id}:${dateValue}:${timeValue || 'all-day'}`,
        status: overdue ? 'overdue' : 'active',
        severity: 'hearing',
        title: overdue ? 'Просроченное судебное заседание' : 'Судебное заседание',
        message: `По делу ${caseLabel} судебное заседание назначено ${when}.`,
        due_at: eventAt.toISOString(),
        source_type: 'calendar_task',
        source_id: row.id,
        general_case_id: row.general_case_id || null
      });
      continue;
    }

    const taskDescription = String(row.description || row.desc || row.assignment || '');
    const isDeadlineTask = type === 'процессуальный_срок'
      || (type === 'поручение' && /(срок|последн(?:ий|его)\s+день|подать|подач[аи]|жалоб)/i.test(taskDescription));
    if (isDeadlineTask) {
      const dueAt = parseLocalDateTime(dateValue, timeValue, true);
      if (!dueAt || dueAt < overdueFloor || dueAt > horizon) continue;
      const overdue = dueAt.getTime() <= now.getTime();
      const days = dayDifference(todayIso, dateValue);
      const caseLabel = notificationCaseLabel(row);
      const taskTitle = cleanNotificationTaskTitle(taskDescription);
      const deadlineLabel = getDeadlineLabel(taskDescription);
      let message;
      if (overdue) {
        message = `По делу ${caseLabel} ${deadlineLabel} истёк ${formatRuDateServer(dateValue)}, а задача «${taskTitle}» не выполнена!`;
      } else if (days === 0) {
        message = `По делу ${caseLabel} ${deadlineLabel} истекает сегодня, а задача «${taskTitle}» не выполнена!`;
      } else {
        message = `По делу ${caseLabel} до окончания ${deadlineLabel} осталось ${days} ${pluralDays(days)}, а задача «${taskTitle}» не выполнена!`;
      }
      notifications.push({
        key: `deadline:${row.id}:${dateValue}:${timeValue || 'end-of-day'}`,
        status: overdue ? 'overdue' : 'active',
        severity: 'deadline',
        title: overdue ? 'Просроченный процессуальный срок' : 'Процессуальный срок',
        message,
        due_at: dueAt.toISOString(),
        source_type: 'calendar_task',
        source_id: row.id,
        general_case_id: row.general_case_id || null
      });
    }
  }

  const staleParams = [];
  let staleWhere = 'COALESCE(control_flag, 0)=1';
  if (!hasPermission(session, PERMISSIONS.CASES_VIEW_ANY)) {
    staleWhere += ` AND COALESCE(executor, '')=?`;
    staleParams.push(userName);
  }
  const staleRows = await all(dbPath, `
    SELECT id, case_no, court_no, executor, updated_at, created_at
    FROM general_cases
    WHERE ${staleWhere}
    ORDER BY COALESCE(updated_at, created_at, '') ASC
    LIMIT 500
  `, staleParams).catch(() => []);

  for (const row of staleRows) {
    const changedAt = new Date(row.updated_at || row.created_at || 0);
    if (Number.isNaN(changedAt.getTime())) continue;
    const inactiveDays = Math.floor((now.getTime() - changedAt.getTime()) / 86400000);
    if (inactiveDays < 14) continue;
    const caseLabel = notificationCaseLabel(row);
    notifications.push({
      key: `stale-case:${row.id}:${toIsoDateLocal(changedAt)}`,
      status: 'active',
      severity: 'stale',
      title: 'Дело давно не обновлялось',
      message: `Дело ${caseLabel} на контроле у руководителя, но не обновлялось ${inactiveDays} ${pluralDays(inactiveDays)}.`,
      due_at: changedAt.toISOString(),
      source_type: 'general_case',
      source_id: row.id,
      general_case_id: row.id
    });
  }

  const approvalRows = await all(dbPath, `
    SELECT a.*, g.case_no, g.court_no
    FROM general_case_review_approvals a
    LEFT JOIN general_cases g ON g.id=a.general_case_id
    WHERE COALESCE(a.status, '') IN ('pending', 'revision_required', 'approved')
      AND (
        COALESCE(a.requester_name, '')=?
        OR COALESCE(a.reviewer_name, '')=?
        OR (?=1 AND COALESCE(a.status, '')='pending')
      )
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT 300
  `, [userName, userName, canReviewGeneralCaseApproval(session) ? 1 : 0]).catch(() => []);

  for (const row of approvalRows) {
    const status = normalizeApprovalStatus(row.status);
    const caseLabel = notificationCaseLabel(row);
    const documentName = row.document_name || 'документ';
    const isReviewerTask = status === 'pending' && canReviewGeneralCaseApproval(session);
    const isRequesterTask = isSameUserName(row.requester_name, userName);
    if (!isReviewerTask && !isRequesterTask) continue;
    notifications.push({
      key: `review-approval:${row.id}:${status}:${row.updated_at || ''}`,
      status: status === 'pending' || status === 'revision_required' ? 'active' : 'done',
      severity: 'review',
      title: status === 'pending'
        ? 'Отзыв ожидает согласования'
        : (status === 'revision_required' ? 'Отзыв требует доработки' : 'Отзыв согласован'),
      message: status === 'pending'
        ? `${row.requester_name || 'Сотрудник'} направил(а) документ «${documentName}» на согласование по делу ${caseLabel}.`
        : `Статус документа «${documentName}» по делу ${caseLabel}: ${status === 'revision_required' ? 'требуется доработка' : 'согласовано'}.`,
      due_at: row.updated_at || row.created_at || new Date().toISOString(),
      source_type: 'general_case_review_approval',
      source_id: row.id,
      general_case_id: row.general_case_id || null,
      type: 'review_approval_request',
      caseId: row.general_case_id || null,
      documentId: row.document_id || '',
      approvalRequestId: row.id,
      metadata: {
        type: 'review_approval_request',
        caseId: row.general_case_id || null,
        documentId: row.document_id || '',
        approvalRequestId: row.id
      },
      approval_status: status
    });
  }

  const readRows = await all(dbPath, 'SELECT notification_key FROM notification_reads WHERE user_name=?', [userName]).catch(() => []);
  const readKeys = new Set(readRows.map(row => String(row.notification_key || '')));
  return notifications
    .map(item => ({ ...item, unread: readKeys.has(item.key) ? 0 : 1 }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'overdue' ? -1 : 1;
      if (a.unread !== b.unread) return b.unread - a.unread;
      return new Date(a.due_at || 0).getTime() - new Date(b.due_at || 0).getTime();
    });
}


function normSchedule(data = {}) {
  return {
    session_date: anyValue(data, ['session_date'], ''),
    court: anyValue(data, ['court'], ''),
    time: anyValue(data, ['time'], ''),
    representative: anyValue(data, ['representative'], ''),
    plaintiff: anyValue(data, ['plaintiff'], ''),
    defendant: anyValue(data, ['defendant'], ''),
    category: anyValue(data, ['category'], ''),
    result: anyValue(data, ['result'], ''),
    hearing_date: anyValue(data, ['hearing_date'], ''),
    general_case_id: anyValue(data, ['general_case_id'], null),
    meeting_id: anyValue(data, ['meeting_id'], null)
  };
}



function ruDateToIsoServer(value = '') {
  const [day, month, year] = String(value || '').split('.').map(Number);
  if (!day || !month || !year) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}


function normEmergencyFund(data = {}) {
  return {
    kvartal: anyValue(data, ['kvartal'], ''),
    pk_number: anyValue(data, ['pk_number', 'pkNumber'], ''),
    fio: anyValue(data, ['fio'], ''),
    prosecutor: anyValue(data, ['prosecutor'], ''),
    address: anyValue(data, ['address'], ''),
    district: anyValue(data, ['district'], ''),
    requirements: anyValue(data, ['requirements'], ''),
    stage: anyValue(data, ['stage'], ''),
    case_number: anyValue(data, ['case_number', 'caseNumber'], ''),
    judicial_act_date: anyValue(data, ['judicial_act_date', 'judicialActDate'], ''),
    appeal: anyValue(data, ['appeal'], ''),
    claim_amount: anyValue(data, ['claim_amount', 'claimAmount'], ''),
    collected: anyValue(data, ['collected'], ''),
    area: anyValue(data, ['area'], ''),
    address_exec: anyValue(data, ['address_exec', 'addressExec'], ''),
    sum_property_claim: anyValue(data, ['sum_property_claim', 'sumPropertyClaim'], ''),
    sum_property: anyValue(data, ['sum_property', 'sumProperty'], ''),
    execution: anyValue(data, ['execution'], ''),
    executors: anyValue(data, ['executors'], ''),
    notes: anyValue(data, ['notes'], ''),
    court: anyValue(data, ['court'], ''),
    latitude: anyValue(data, ['latitude'], null),
    longitude: anyValue(data, ['longitude'], null),
    pk: anyValue(data, ['pk'], ''),
    case_num: anyValue(data, ['case_num'], ''),
    sum_claim: anyValue(data, ['sum_claim'], ''),
    provided_area: anyValue(data, ['provided_area'], ''),
    execution_quarter: anyValue(data, ['execution_quarter'], ''),
    review_ready: anyValue(data, ['review_ready'], 0),
    total_unfulfilled_sum: anyValue(data, ['total_unfulfilled_sum'], ''),
    total_fulfilled_sum: anyValue(data, ['total_fulfilled_sum'], ''),
    total_unfulfilled_area: anyValue(data, ['total_unfulfilled_area'], ''),
    total_provided_area: anyValue(data, ['total_provided_area'], ''),
    execution_people_json: anyValue(data, ['execution_people_json', 'executionPeopleJson'], ''),
    condemned_date: anyValue(data, ['condemned_date', 'condemnedDate'], ''),
    resettlement_deadline: anyValue(data, ['resettlement_deadline', 'resettlementDeadline'], ''),
    general_case_id: anyValue(data, ['general_case_id', 'generalCaseId'], 0)
  };
}



function normMunicipalRegistry(data = {}) {
  return {
    pk_number: anyValue(data, ['pk_number'], ''),
    kvartal: anyValue(data, ['kvartal'], ''),
    address: anyValue(data, ['address'], ''),
    fio: anyValue(data, ['fio'], ''),
    property_type: anyValue(data, ['property_type'], ''),
    notes: anyValue(data, ['notes'], ''),
    court: anyValue(data, ['court'], ''),
    stage: anyValue(data, ['stage'], ''),
    court_act_date: anyValue(data, ['court_act_date'], ''),
    court_act_number: anyValue(data, ['court_act_number'], ''),
    court_act: anyValue(data, ['court_act'], ''),
    requirements: anyValue(data, ['requirements'], ''),
    appeal: anyValue(data, ['appeal'], ''),
    execution: anyValue(data, ['execution'], ''),
    collected: anyValue(data, ['collected'], ''),
    review_ready: Number(anyValue(data, ['review_ready'], 0) || 0),
    attachments_json: anyValue(data, ['attachments_json'], ''),
    general_case_id: Number(anyValue(data, ['general_case_id'], 0) || 0)
  };
}




function normMeeting(data = {}) {
  return {
    title: anyValue(data, ['title'], ''),
    date_val: anyValue(data, ['date_val'], ''),
    time_val: anyValue(data, ['time_val'], ''),
    agenda: anyValue(data, ['agenda'], ''),
    protocol: anyValue(data, ['protocol'], ''),
    participants: anyValue(data, ['participants'], ''),
    invited_participants: anyValue(data, ['invited_participants'], ''),
    attachment_path: anyValue(data, ['attachment_path'], ''),
    attachment_type: anyValue(data, ['attachment_type'], ''),
    has_participants_list: anyValue(data, ['has_participants_list'], 0),
    has_telegram: anyValue(data, ['has_telegram'], 0),
    protocol_keeper: anyValue(data, ['protocol_keeper'], ''),
    cabinet_number: anyValue(data, ['cabinet_number'], ''),
    telegram_number: anyValue(data, ['telegram_number'], ''),
    transfer_email: anyValue(data, ['transfer_email'], ''),
    transfer_fio: anyValue(data, ['transfer_fio'], ''),
    transfer_phone: anyValue(data, ['transfer_phone'], ''),
    telegram_sign_fio: anyValue(data, ['telegram_sign_fio'], ''),
    protocol_number: anyValue(data, ['protocol_number'], ''),
    protocol_chair_fio: anyValue(data, ['protocol_chair_fio'], ''),
    protocol_chair_position: anyValue(data, ['protocol_chair_position'], ''),
    agenda_sign_position: anyValue(data, ['agenda_sign_position'], ''),
    agenda_sign_fio: anyValue(data, ['agenda_sign_fio'], '')
  };
}


async function handleApiRequest(req, res, parsedUrl, dbPath) {
  if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return true; }
  const path = parsedUrl.pathname;
  try {
    await ensureSchema(dbPath);

    const accessSession = await enforceApiAccess(req, res, dbPath, path, req.method);
    if (accessSession === false) return true;


    // MEETING_PARTICIPANTS_ROUTE_PATCHED
    if (path === '/api/meeting-participants' && req.method === 'GET') {
      const category = parsedUrl.searchParams.get('category') || '';
      const rows = await all(dbPath, 'SELECT id, category, full_name, position, leadership, sort_order FROM meeting_participants WHERE (? = "" OR category = ?) ORDER BY sort_order, full_name', [category, category]).catch(() => []);
      if (rows.length) {
        sendJson(res, 200, rows);
        return true;
      }
      const users = await all(dbPath, 'SELECT id, full_name, "" as position, "" as leadership FROM users ORDER BY full_name', []).catch(() => []);
      sendJson(res, 200, users.map(row => ({ id: row.id, category, full_name: row.full_name, position: row.position || '', leadership: row.leadership || '', sort_order: 999 })));
      return true;
    }



// Source-port API routes inserted early so Vite never falls through to HTML.
if (path === '/api/meeting-participants' && req.method === 'GET') {
  const category = parsedUrl.searchParams.get('category') || '';
  const rows = await all(dbPath, 'SELECT * FROM meeting_participants WHERE (? = "" OR category = ?) ORDER BY sort_order, full_name', [category, category]).catch(() => []);
  if (rows.length) {
    sendJson(res, 200, rows);
    return true;
  }
  const users = await all(dbPath, 'SELECT full_name FROM users ORDER BY full_name', []).catch(() => []);
  sendJson(res, 200, users.map(row => ({ full_name: row.full_name })));
  return true;
}

if (path === '/api/meetings' && req.method === 'GET') {
  sendJson(res, 200, await all(dbPath, 'SELECT * FROM meetings ORDER BY date_val DESC, time_val DESC, id DESC LIMIT 5000'));
  return true;
}

if (path === '/api/meetings' && req.method === 'POST') {
  const d = normMeeting(await readBody(req));
  const result = await run(dbPath, `
    INSERT INTO meetings (
      title, date_val, time_val, agenda, protocol, participants, invited_participants,
      attachment_path, attachment_type, has_participants_list, has_telegram, protocol_keeper,
      cabinet_number, telegram_number, transfer_email, transfer_fio, transfer_phone,
      telegram_sign_fio, protocol_number, protocol_chair_fio, protocol_chair_position,
      agenda_sign_position, agenda_sign_fio, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    d.title, d.date_val, d.time_val, d.agenda, d.protocol, d.participants, d.invited_participants,
    d.attachment_path, d.attachment_type, d.has_participants_list, d.has_telegram, d.protocol_keeper,
    d.cabinet_number, d.telegram_number, d.transfer_email, d.transfer_fio, d.transfer_phone,
    d.telegram_sign_fio, d.protocol_number, d.protocol_chair_fio, d.protocol_chair_position,
    d.agenda_sign_position, d.agenda_sign_fio, new Date().toISOString(), new Date().toISOString()
  ]);
  sendJson(res, 201, await get(dbPath, 'SELECT * FROM meetings WHERE id=?', [result.id]));
  return true;
}

const meetingsMatchSourcePort = path.match(/^\/api\/meetings\/(\d+)$/);
if (meetingsMatchSourcePort) {
  const id = Number(meetingsMatchSourcePort[1]);
  if (req.method === 'PUT') {
    const d = normMeeting(await readBody(req));
    await run(dbPath, `
      UPDATE meetings SET
        title=?, date_val=?, time_val=?, agenda=?, protocol=?, participants=?, invited_participants=?,
        attachment_path=?, attachment_type=?, has_participants_list=?, has_telegram=?, protocol_keeper=?,
        cabinet_number=?, telegram_number=?, transfer_email=?, transfer_fio=?, transfer_phone=?,
        telegram_sign_fio=?, protocol_number=?, protocol_chair_fio=?, protocol_chair_position=?,
        agenda_sign_position=?, agenda_sign_fio=?, updated_at=?
      WHERE id=?
    `, [
      d.title, d.date_val, d.time_val, d.agenda, d.protocol, d.participants, d.invited_participants,
      d.attachment_path, d.attachment_type, d.has_participants_list, d.has_telegram, d.protocol_keeper,
      d.cabinet_number, d.telegram_number, d.transfer_email, d.transfer_fio, d.transfer_phone,
      d.telegram_sign_fio, d.protocol_number, d.protocol_chair_fio, d.protocol_chair_position,
      d.agenda_sign_position, d.agenda_sign_fio, new Date().toISOString(), id
    ]);
    sendJson(res, 200, await get(dbPath, 'SELECT * FROM meetings WHERE id=?', [id]));
    return true;
  }
  if (req.method === 'DELETE') {
    await run(dbPath, 'DELETE FROM meetings WHERE id=?', [id]);
    sendJson(res, 200, { ok: true });
    return true;
  }
}


    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const password = String(body.password || '').trim();

      if (!password) {
        sendJson(res, 400, { error: 'password_required' });
        return true;
      }

      const candidates = await all(dbPath, 'SELECT * FROM users WHERE COALESCE(is_active,1)=1 ORDER BY id', []).catch(() => []);
      let user = candidates.find(row => verifyPassword(password, row)) || null;

      if (!user) {
        sendJson(res, 401, { error: 'invalid_password' });
        return true;
      }

      if (!user.password_hash || user.password_scheme !== 'scrypt') {
        const credentials = makePasswordCredentials(password);
        await run(dbPath, `
          UPDATE users
          SET password_hash=?, password_salt=?, password_scheme=?, password=?
          WHERE id=?
        `, [credentials.hash, credentials.salt, credentials.scheme, `__migrated_password_${user.id}__`, user.id]);
        user = { ...user, password_hash: credentials.hash, password_salt: credentials.salt, password_scheme: credentials.scheme, password: `__migrated_password_${user.id}__` };
      }

      const token = crypto.randomBytes(32).toString('hex');
      const builtSession = await buildSessionFromUser(dbPath, user);
      const session = {
        id: builtSession.id,
        full_name: user.full_name || user.name || 'Пользователь',
        is_admin: builtSession.is_admin,
        role_level: builtSession.role_level,
        role_name: builtSession.role_name,
        permissions: builtSession.permissions,
        individual_permissions: builtSession.individual_permissions
      };
      activeSessions.set(token, session);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await run(dbPath, `
        INSERT OR REPLACE INTO app_sessions (token, user_id, full_name, is_admin, role_level, permissions_json, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [token, session.id, session.full_name, session.is_admin ? 1 : 0, session.role_level, JSON.stringify(session.permissions || []), new Date().toISOString(), expiresAt]);
      await run(dbPath, "DELETE FROM app_sessions WHERE expires_at<>'' AND expires_at<?", [new Date().toISOString()]).catch(() => {});

      sendJson(res, 200, {
        ok: true,
        ...session,
        token
      });
      return true;
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      const header = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
      if (token) {
        activeSessions.delete(token);
        await run(dbPath, 'DELETE FROM app_sessions WHERE token=?', [token]).catch(() => {});
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/health') { sendJson(res, 200, { ok: true, dbPath }); return true; }

    if (path === '/api/auth/me' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      const header = String(req.headers?.authorization || req.headers?.['x-session-token'] || '').trim();
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
      sendJson(res, 200, { ...session, token });
      return true;
    }

    if (path === '/api/admin/users' && req.method === 'GET') {
      sendJson(res, 200, await listUsersForAdmin(dbPath));
      return true;
    }

    if (path === '/api/admin/users' && req.method === 'POST') {
      const body = await readBody(req);
      const fullName = String(body.full_name || '').trim();
      const password = String(body.password || '').trim();
      const roleLevel = parseRoleLevel(body.role_level ?? ROLE_LEVELS.PARTICIPANT);
      const individualPermissions = normalizeIndividualPermissions(body.individual_permissions || body.permissions || []);
      if (!hasPermission(accessSession, PERMISSIONS.USERS_CREATE)) {
        sendJson(res, 403, { error: 'forbidden', permission: PERMISSIONS.USERS_CREATE });
        return true;
      }
      if (!roleLevel) {
        sendJson(res, 400, { error: 'invalid_role_level' });
        return true;
      }
      if (!fullName || !password) {
        sendJson(res, 400, { error: 'full_name_and_password_required' });
        return true;
      }
      if (roleLevel >= ROLE_LEVELS.TECH_ADMIN && !hasPermission(accessSession, PERMISSIONS.TECH_ADMIN_ASSIGN)) {
        sendJson(res, 403, { error: 'tech_admin_role_forbidden' });
        return true;
      }
      if (individualPermissions.length && !hasPermission(accessSession, PERMISSIONS.PERMISSIONS_MANAGE)) {
        sendJson(res, 403, { error: 'forbidden', permission: PERMISSIONS.PERMISSIONS_MANAGE });
        return true;
      }
      const credentials = makePasswordCredentials(password);
      const result = await run(dbPath, `
        INSERT INTO users (full_name, password, password_hash, password_salt, password_scheme, is_admin, role_level, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [fullName, `__migrated_password_${Date.now()}_${crypto.randomBytes(4).toString('hex')}__`, credentials.hash, credentials.salt, credentials.scheme, roleLevel >= ROLE_LEVELS.MAIN_ADMIN ? 1 : 0, roleLevel, Number(body.is_active ?? 1) ? 1 : 0]);
      await replaceUserPermissions(dbPath, result.id, individualPermissions, accessSession?.id || null);
      sendJson(res, 201, (await listUsersForAdmin(dbPath)).find(user => Number(user.id) === Number(result.id)));
      return true;
    }

    const adminUserMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
    if (adminUserMatch && req.method === 'PUT') {
      const id = Number(adminUserMatch[1]);
      const existing = await get(dbPath, 'SELECT * FROM users WHERE id=?', [id]);
      if (!existing) {
        sendJson(res, 404, { error: 'user_not_found' });
        return true;
      }
      const body = await readBody(req);
      const fullName = String(body.full_name || existing.full_name || '').trim();
      const roleLevel = parseRoleLevel(body.role_level ?? existing.role_level);
      const isActive = Number(body.is_active ?? existing.is_active ?? 1) ? 1 : 0;
      const existingRoleLevel = normalizeRoleLevel(existing.role_level);
      const individualPermissions = normalizeIndividualPermissions(body.individual_permissions || body.permissions || []);
      if (!hasPermission(accessSession, PERMISSIONS.USERS_UPDATE)) {
        sendJson(res, 403, { error: 'forbidden', permission: PERMISSIONS.USERS_UPDATE });
        return true;
      }
      if (!roleLevel) {
        sendJson(res, 400, { error: 'invalid_role_level' });
        return true;
      }
      if ((existingRoleLevel >= ROLE_LEVELS.TECH_ADMIN || roleLevel >= ROLE_LEVELS.TECH_ADMIN) && !hasPermission(accessSession, PERMISSIONS.TECH_ADMIN_ASSIGN)) {
        sendJson(res, 403, { error: 'tech_admin_role_forbidden' });
        return true;
      }
      if (individualPermissions.length && !hasPermission(accessSession, PERMISSIONS.PERMISSIONS_MANAGE)) {
        sendJson(res, 403, { error: 'forbidden', permission: PERMISSIONS.PERMISSIONS_MANAGE });
        return true;
      }
      if (existingRoleLevel >= ROLE_LEVELS.TECH_ADMIN && (roleLevel < ROLE_LEVELS.TECH_ADMIN || !isActive) && await isLastActiveTechAdmin(dbPath, id)) {
        sendJson(res, 400, { error: 'last_tech_admin_required' });
        return true;
      }
      const password = String(body.password || '').trim();
      if (password && !hasPermission(accessSession, PERMISSIONS.USERS_RESET_PASSWORD)) {
        sendJson(res, 403, { error: 'forbidden', permission: PERMISSIONS.USERS_RESET_PASSWORD });
        return true;
      }
      await run(dbPath, 'UPDATE users SET full_name=?, is_admin=?, role_level=?, is_active=? WHERE id=?', [
        fullName,
        roleLevel >= ROLE_LEVELS.MAIN_ADMIN ? 1 : 0,
        roleLevel,
        isActive,
        id
      ]);
      if (password) {
        const credentials = makePasswordCredentials(password);
        await run(dbPath, "UPDATE users SET password=?, password_hash=?, password_salt=?, password_scheme=? WHERE id=?", [`__migrated_password_${id}__`, credentials.hash, credentials.salt, credentials.scheme, id]);
      }
      await replaceUserPermissions(dbPath, id, individualPermissions, accessSession?.id || null);
      activeSessions.clear();
      sendJson(res, 200, (await listUsersForAdmin(dbPath)).find(user => Number(user.id) === id));
      return true;
    }

    if (path === '/api/admin/options' && req.method === 'GET') {
      sendJson(res, 200, await listDictionaryOptions(dbPath));
      return true;
    }

    if (path === '/api/admin/options' && req.method === 'POST') {
      const body = await readBody(req);
      const parsedId = parseAdminDictionaryId(body.id);
      const category = String(body.category || '').trim();
      const value = String(body.value || '').trim().replace(/\s+/g, ' ');
      const position = String(body.position || '').trim();
      const leadership = String(body.leadership || '').trim();
      const isLeadership = Number(body.is_leadership ?? 1) ? 1 : 0;
      const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 999;
      if (!category || !value) {
        sendJson(res, 400, { error: 'category_and_value_required' });
        return true;
      }

      if (isMeetingParticipantDictionaryCategory(category)) {
        if (!position) {
          sendJson(res, 400, { error: 'position_required' });
          return true;
        }
        if (parsedId.id && parsedId.type !== 'meeting') {
          sendJson(res, 400, { error: 'invalid_option_id' });
          return true;
        }
        if (parsedId.id) {
          const existing = await get(dbPath, 'SELECT id FROM meeting_participants WHERE id=?', [parsedId.id]);
          if (!existing) {
            sendJson(res, 404, { error: 'option_not_found' });
            return true;
          }
          await run(dbPath, 'UPDATE meeting_participants SET category=?, full_name=?, position=?, leadership=?, is_leadership=? WHERE id=?', [category, value, position, leadership, isLeadership, parsedId.id]);
          sendJson(res, 200, await getMeetingParticipantDictionaryRow(dbPath, parsedId.id));
          return true;
        }
        const existing = await get(dbPath, 'SELECT id FROM meeting_participants WHERE category=? AND full_name=? LIMIT 1', [category, value]);
        if (existing) {
          await run(dbPath, 'UPDATE meeting_participants SET position=?, leadership=?, is_leadership=? WHERE id=?', [position, leadership, isLeadership, existing.id]);
          sendJson(res, 200, await getMeetingParticipantDictionaryRow(dbPath, existing.id));
          return true;
        }
        const result = await run(dbPath, 'INSERT INTO meeting_participants (category, full_name, position, leadership, is_leadership, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [category, value, position, leadership, isLeadership, 999]);
        sendJson(res, 201, await getMeetingParticipantDictionaryRow(dbPath, result.id));
        return true;
      }

      if (parsedId.id) {
        if (parsedId.type !== 'option') {
          sendJson(res, 400, { error: 'invalid_option_id' });
          return true;
        }
        const existing = await get(dbPath, 'SELECT id, category, code, system_flag, sort_order FROM app_options WHERE id=?', [parsedId.id]);
        if (!existing) {
          sendJson(res, 404, { error: 'option_not_found' });
          return true;
        }
        const duplicate = (await all(dbPath, "SELECT id, value FROM app_options WHERE category=? AND id<>?", [category, parsedId.id]).catch(() => []))
          .find(row => normalizeDictionaryOptionValue(row.value) === normalizeDictionaryOptionValue(value));
        if (duplicate) {
          sendJson(res, 409, { error: 'option_duplicate' });
          return true;
        }
        await run(dbPath, 'UPDATE app_options SET category=?, value=?, sort_order=? WHERE id=?', [category, value, sortOrder, parsedId.id]);
        const row = await get(dbPath, 'SELECT id, category, value, COALESCE(code, "") AS code, COALESCE(system_flag, 0) AS system_flag, COALESCE(sort_order, 999) AS sort_order FROM app_options WHERE id=?', [parsedId.id]);
        sendJson(res, 200, { ...row, id: String(row.id) });
        return true;
      }
      const duplicate = (await all(dbPath, "SELECT id, category, value FROM app_options WHERE category=?", [category]).catch(() => []))
        .find(row => normalizeDictionaryOptionValue(row.value) === normalizeDictionaryOptionValue(value));
      if (duplicate) {
        sendJson(res, 409, { error: 'option_duplicate' });
        return true;
      }
      const optionCode = makeDictionaryOptionCode(category, value);
      const result = await run(dbPath, 'INSERT OR IGNORE INTO app_options (category, value, code, sort_order) VALUES (?, ?, ?, ?)', [category, value, optionCode, sortOrder]);
      const row = result.changes
        ? await get(dbPath, 'SELECT id, category, value, COALESCE(code, "") AS code, COALESCE(system_flag, 0) AS system_flag, COALESCE(sort_order, 999) AS sort_order FROM app_options WHERE id=?', [result.id])
        : await get(dbPath, 'SELECT id, category, value, COALESCE(code, "") AS code, COALESCE(system_flag, 0) AS system_flag, COALESCE(sort_order, 999) AS sort_order FROM app_options WHERE category=? AND value=?', [category, value]);
      sendJson(res, result.changes ? 201 : 200, { ...row, id: String(row.id) });
      return true;
    }

    const adminOptionMatch = path.match(/^\/api\/admin\/options\/([^/]+)$/);
    if (adminOptionMatch && req.method === 'DELETE') {
      const parsedId = parseAdminDictionaryId(decodeURIComponent(adminOptionMatch[1]));
      if (parsedId.type === 'meeting') {
        const option = await get(dbPath, 'SELECT id, category, full_name AS value FROM meeting_participants WHERE id=?', [parsedId.id]);
        if (!option) {
          sendJson(res, 404, { error: 'option_not_found' });
          return true;
        }
        if (await isMeetingParticipantValueUsed(dbPath, option.category, option.value)) {
          sendJson(res, 409, { error: 'option_in_use' });
          return true;
        }
        await run(dbPath, 'DELETE FROM meeting_participants WHERE id=?', [parsedId.id]);
        sendJson(res, 200, { ok: true });
        return true;
      }

      const id = parsedId.id;
      const option = await get(dbPath, 'SELECT id, category, value, COALESCE(system_flag, 0) AS system_flag FROM app_options WHERE id=?', [id]);
      if (!option) {
        sendJson(res, 404, { error: 'option_not_found' });
        return true;
      }
      if (option.category === 'appeal_type' && Number(option.system_flag || 0) === 1) {
        sendJson(res, 409, { error: 'system_option_protected' });
        return true;
      }
      if (option.category !== 'appeal_type' && await isOptionValueUsed(dbPath, option.category, option.value)) {
        sendJson(res, 409, { error: 'option_in_use' });
        return true;
      }
      await run(dbPath, 'DELETE FROM app_options WHERE id=?', [id]);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/reports/summary' && req.method === 'GET') {
      const session = accessSession || await getRequestSession(req, dbPath);
      const reportDate = parsedUrl.searchParams.get('report_date') || new Date();
      const year = normalizeReportYear(parsedUrl.searchParams.get('year'), reportDate);
      const quarter = normalizeReportQuarter(parsedUrl.searchParams.get('quarter'), reportDate);
      const scope = await getReportScope(dbPath, session, {
        user_ids: parsedUrl.searchParams.get('user_ids') || parsedUrl.searchParams.get('user_id') || '',
        scope: parsedUrl.searchParams.get('scope') || '',
        all: parsedUrl.searchParams.get('all') || ''
      });
      const summary = await buildReportsSummary(dbPath, scope, year, quarter, reportDate);
      sendJson(res, 200, {
        ok: true,
        updated_at: new Date().toISOString(),
        year,
        quarter,
        scope: {
          can_manage_all: scope.can_manage_all,
          current_user: scope.current_user,
          selected_users: scope.selected_users,
          available_users: scope.can_manage_all ? scope.available_users : []
        },
        ...summary
      });
      return true;
    }

    if (path === '/api/reports/users' && req.method === 'GET') {
      const session = accessSession || await getRequestSession(req, dbPath);
      if (!canManageReportScope(session)) {
        const currentUser = await resolveCurrentReportUser(dbPath, session);
        sendJson(res, 200, { can_manage_all: false, users: currentUser.full_name ? [currentUser] : [] });
        return true;
      }
      sendJson(res, 200, { can_manage_all: true, users: await listReportUsers(dbPath) });
      return true;
    }

    if (path === '/api/reports/quarterly' && req.method === 'GET') {
      const session = accessSession || await getRequestSession(req, dbPath);
      const reportDate = parsedUrl.searchParams.get('report_date') || new Date();
      const year = normalizeReportYear(parsedUrl.searchParams.get('year'), reportDate);
      const quarter = normalizeReportQuarter(parsedUrl.searchParams.get('quarter'), reportDate);
      const scope = await getReportScope(dbPath, session, {
        user_ids: parsedUrl.searchParams.get('user_ids') || parsedUrl.searchParams.get('user_id') || '',
        scope: parsedUrl.searchParams.get('scope') || '',
        all: parsedUrl.searchParams.get('all') || ''
      });
      const params = [year, quarter];
      let whereSql = 'WHERE year=? AND quarter=?';
      if (scope.selected_user_ids.length) {
        whereSql += ` AND user_id IN (${scope.selected_user_ids.map(() => '?').join(',')})`;
        params.push(...scope.selected_user_ids);
      } else {
        whereSql += ' AND 1=0';
      }
      const rows = await all(dbPath, `
        SELECT *
        FROM quarterly_reports
        ${whereSql}
        ORDER BY user_name, updated_at DESC, id DESC
      `, params).catch(() => []);
      const reportUserIds = new Set(rows.map(row => Number(row.user_id)));
      sendJson(res, 200, {
        ok: true,
        year,
        quarter,
        reports: rows.map(serializeQuarterlyReport),
        employees_without_report: (scope.selected_users || [])
          .filter(user => user.id && !reportUserIds.has(Number(user.id)))
          .map(user => ({ id: user.id, full_name: user.full_name }))
      });
      return true;
    }

    if (path === '/api/reports/quarterly' && req.method === 'POST') {
      const session = accessSession || await getRequestSession(req, dbPath);
      const body = await readBody(req, { maxBytes: MAX_REPORT_DOCUMENT_BODY_BYTES });
      const row = await saveQuarterlyReportDocument(dbPath, session, body);
      sendJson(res, 201, { ok: true, report: serializeQuarterlyReport(row) });
      return true;
    }

    const reportDownloadMatch = path.match(/^\/api\/reports\/quarterly\/(\d+)\/download$/);
    if (reportDownloadMatch && req.method === 'GET') {
      const session = accessSession || await getRequestSession(req, dbPath);
      const row = await assertQuarterlyReportAccess(dbPath, session, Number(reportDownloadMatch[1]));
      const filePath = reportFilePath(dbPath, row);
      if (!filePath) {
        sendJson(res, 404, { error: 'file_not_found' });
        return true;
      }
      streamReportFile(res, filePath, row.mime_type || '', 'attachment');
      return true;
    }

    const reportOpenMatch = path.match(/^\/api\/reports\/quarterly\/(\d+)\/open$/);
    if (reportOpenMatch && req.method === 'POST') {
      const session = accessSession || await getRequestSession(req, dbPath);
      const row = await assertQuarterlyReportAccess(dbPath, session, Number(reportOpenMatch[1]));
      const filePath = reportFilePath(dbPath, row);
      if (!filePath || !fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'file_not_found' });
        return true;
      }
      await openFileWithSystem(filePath);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/general-case-files' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      if (!session) { sendJson(res, 401, { error: 'auth_required' }); return true; }
      const body = await readBody(req, { maxBytes: MAX_CASE_DOCUMENT_BODY_BYTES });
      const name = sanitizeUploadedFileName(body.name);
      const ext = pathModule.extname(name).toLowerCase();
      if (!CASE_DOCUMENT_MIME[ext]) {
        sendJson(res, 415, { error: 'unsupported_file_type', allowed: ['pdf', 'doc', 'docx'] });
        return true;
      }
      const raw = String(body.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
      let bytes;
      try { bytes = Buffer.from(raw, 'base64'); } catch { bytes = null; }
      if (!bytes?.length) { sendJson(res, 400, { error: 'empty_file' }); return true; }
      if (bytes.length > MAX_CASE_DOCUMENT_BYTES) { sendJson(res, 413, { error: 'file_too_large', max_mb: 100 }); return true; }
      const uploadDir = caseDocumentsDir(dbPath);
      fs.mkdirSync(uploadDir, { recursive: true });
      const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${name}`;
      const filePath = pathModule.join(uploadDir, uniqueName);
      fs.writeFileSync(filePath, bytes);
      sendJson(res, 201, {
        ok: true,
        name,
        path: filePath,
        mime: CASE_DOCUMENT_MIME[ext],
        size: bytes.length
      });
      return true;
    }

    if (path === '/api/general-case-files/preview' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      if (!session) { sendJson(res, 401, { error: 'auth_required' }); return true; }
      const requestedPath = String(parsedUrl.searchParams.get('path') || '').trim();
      const uploadDir = caseDocumentsDir(dbPath);
      const filePath = pathModule.resolve(requestedPath);
      if (!requestedPath || !isPathInside(uploadDir, filePath)) {
        sendJson(res, 403, { error: 'preview_path_forbidden' });
        return true;
      }
      let stat;
      try { stat = fs.statSync(filePath); } catch { sendJson(res, 404, { error: 'file_not_found' }); return true; }
      if (!stat.isFile()) { sendJson(res, 404, { error: 'file_not_found' }); return true; }
      const ext = pathModule.extname(filePath).toLowerCase();
      if (ext === '.pdf') { streamInlineFile(res, filePath, CASE_DOCUMENT_MIME[ext]); return true; }
      if (ext === '.doc' || ext === '.docx') {
        const cacheDir = pathModule.join(pathModule.dirname(dbPath), 'preview-cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        const cacheKey = crypto.createHash('sha256').update(`${filePath}|${stat.mtimeMs}|${stat.size}`).digest('hex');
        const pdfPath = pathModule.join(cacheDir, `${cacheKey}.pdf`);
        try {
          if (!fs.existsSync(pdfPath)) await convertWordDocumentToPdf(filePath, pdfPath);
          streamInlineFile(res, pdfPath, 'application/pdf');
        } catch (error) {
          sendJson(res, 501, { error: 'word_preview_unavailable', message: error.message });
        }
        return true;
      }
      sendJson(res, 415, { error: 'unsupported_file_type' });
      return true;
    }

    if (path === '/api/general-case-files/open' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      if (!session) { sendJson(res, 401, { error: 'auth_required' }); return true; }
      const body = await readBody(req);
      const requestedPath = String(body.path || '').trim();
      const uploadDir = caseDocumentsDir(dbPath);
      const filePath = pathModule.resolve(requestedPath);
      if (!requestedPath || !isPathInside(uploadDir, filePath)) {
        sendJson(res, 403, { error: 'open_path_forbidden' });
        return true;
      }
      let stat;
      try { stat = fs.statSync(filePath); } catch { sendJson(res, 404, { error: 'file_not_found' }); return true; }
      if (!stat.isFile()) { sendJson(res, 404, { error: 'file_not_found' }); return true; }
      try {
        await openFileWithSystem(filePath);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 500, { error: 'open_failed', message: error.message });
      }
      return true;
    }

    if (path === '/api/users' && req.method === 'GET') {
      const rows = await all(dbPath, 'SELECT full_name FROM users ORDER BY full_name', []).catch(() => []);
      const users = rows.map(row => row.full_name).filter(Boolean);
      sendJson(res, 200, users.length ? users : ['Администратор']);
      return true;
    }

    if (path === '/api/calendar-users' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      if (Number(session.role_level || 0) < 2) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }
      sendJson(res, 200, await listCalendarExecutorUsers(dbPath));
      return true;
    }

    if (path === '/api/notifications' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      const items = await buildUserNotifications(dbPath, session);
      sendJson(res, 200, {
        items,
        unread_count: items.filter(item => Number(item.unread) === 1).length,
        active_count: items.filter(item => item.status === 'active').length,
        overdue_count: items.filter(item => item.status === 'overdue').length
      });
      return true;
    }

    if (path === '/api/notifications/read' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      const body = await readBody(req);
      const keys = Array.isArray(body.keys)
        ? [...new Set(body.keys.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 500)
        : [];
      const now = new Date().toISOString();
      for (const key of keys) {
        await run(dbPath, `
          INSERT OR REPLACE INTO notification_reads (user_name, notification_key, read_at)
          VALUES (?, ?, ?)
        `, [session.full_name, key, now]);
      }
      sendJson(res, 200, { ok: true, changed: keys.length });
      return true;
    }

    if (path === '/api/options' && req.method === 'GET') {
      const category = parsedUrl.searchParams.get('category') || '';
      if (category === 'appeal_type') {
        const rows = await all(dbPath, 'SELECT id, value, COALESCE(code, "") AS code, COALESCE(system_flag, 0) AS system_flag, COALESCE(sort_order, 999) AS sort_order FROM app_options WHERE category=? ORDER BY sort_order, value, id', [category]);
        sendJson(res, 200, rows.map(row => ({ ...row, id: String(row.id), system_flag: Number(row.system_flag || 0) })));
        return true;
      }
      const rows = await all(dbPath, 'SELECT value FROM app_options WHERE category=? ORDER BY value', [category]);
      sendJson(res, 200, rows.map(r => r.value)); return true;
    }
    if (path === '/api/general-cases' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      const archived = parsedUrl.searchParams.get('archived') === '1';
      const search = (parsedUrl.searchParams.get('search') || '').trim();
      const table = archived ? 'general_cases_archive' : 'general_cases';
      const cols = ['case_no','court_no','court','judge','executor','category','procedural_position','claim_subject','claim_address','registration_date','review_result','plaintiff','defendant','comments','judicial_act_date_first','first_instance_act_type','motivated_decision_date','appeal_act_date','cassation_act_date','documents_json','process_kind','act_instance','proceeding_form','appeal_kind','order_copy_date','apk_cassation_has_appeal','supervision_cassation_exhausted','late_motivated_received','appeals_json','emergency_fund_flag','registry_flag'];
      const whereParts = [];
      const params = [];
      if (search) {
        whereParts.push('(' + cols.map(c => `LOWER(COALESCE(${c},'')) LIKE LOWER(?)`).join(' OR ') + ')');
        params.push(...cols.map(() => `%${search}%`));
      }
      if (!hasPermission(session, PERMISSIONS.CASES_VIEW_ANY)) {
        whereParts.push(`COALESCE(executor,'')=?`);
        params.push(session.full_name);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      const rows = await all(dbPath, `SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT 2000`, params);
      sendJson(res, 200, rows); return true;
    }
    if (path === '/api/general-cases' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      const rawGeneralBody = await readBody(req);
      const d = normCase(rawGeneralBody);
      if (!hasPermission(session, PERMISSIONS.CASES_EDIT_ANY)) d.executor = session.full_name;
      const result = await run(dbPath, `INSERT INTO general_cases (case_no,court_no,court,judge,executor,category,procedural_position,claim_subject,claim_address,registration_date,review_result,control_flag,attendance_flag,attendance_hearing_missing,review_show_flag,emergency_fund_flag,registry_flag,comments,judicial_act_date_first,first_instance_act_type,motivated_decision_date,appeal_act_date,cassation_act_date,documents_json,process_kind,act_instance,proceeding_form,appeal_kind,order_copy_date,apk_cassation_has_appeal,supervision_cassation_exhausted,late_motivated_received,appeals_json,created_at,updated_at,plaintiff,defendant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [d.case_no,d.court_no,d.court,d.judge,d.executor,d.category,d.procedural_position,d.claim_subject,d.claim_address,d.registration_date,d.review_result,d.control_flag,d.attendance_flag,d.attendance_hearing_missing,d.review_show_flag,d.emergency_fund_flag,d.registry_flag,d.comments,d.judicial_act_date_first,d.first_instance_act_type,d.motivated_decision_date,d.appeal_act_date,d.cassation_act_date,d.documents_json,d.process_kind,d.act_instance,d.proceeding_form,d.appeal_kind,d.order_copy_date,d.apk_cassation_has_appeal,d.supervision_cassation_exhausted,d.late_motivated_received,d.appeals_json,new Date().toISOString(),new Date().toISOString(),d.plaintiff,d.defendant]);
      if (!rawGeneralBody.skip_linked) await syncLinked(dbPath, result.id, d);
      sendJson(res, 201, await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [result.id])); return true;
    }

    const controlLinkMatch = path.match(/^\/api\/general-cases\/(\d+)\/controlled-link$/);
    if (controlLinkMatch && req.method === 'POST') {
      const id = Number(controlLinkMatch[1]);
      const body = await readBody(req);
      const historyText = String(body.history_text || body.result || '').trim();
      const row = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [id]);

      if (!row) {
        sendJson(res, 404, { error: 'general_case_not_found' });
        return true;
      }

      const existing = await get(dbPath, 'SELECT id FROM controlled_cases WHERE general_case_id=? LIMIT 1', [id]);
      const vals = [
        row.case_no || '',
        row.plaintiff || '',
        row.defendant || '',
        row.claim_subject || '',
        row.executor || '',
        historyText,
        row.court_no || '',
        row.court || '',
        id,
        new Date().toISOString()
      ];

      if (existing) {
        await run(dbPath, `UPDATE controlled_cases SET case_number=?, plaintiff=?, defendant=?, subject=?, representative=?, result=?, court_case_number=?, court=?, general_case_id=?, updated_at=? WHERE id=?`, [...vals, existing.id]);
        sendJson(res, 200, await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [existing.id]));
      } else {
        const result = await run(dbPath, `INSERT INTO controlled_cases (case_number, plaintiff, defendant, subject, representative, result, court_case_number, court, general_case_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, vals);
        sendJson(res, 201, await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [result.id]));
      }
      return true;
    }

    const attendanceHearingMatch = path.match(/^\/api\/general-cases\/(\d+)\/attendance-hearing$/);
    if (attendanceHearingMatch && req.method === 'POST') {
      const id = Number(attendanceHearingMatch[1]);
      const body = await readBody(req);
      const hearingDate = String(body.hearing_date || '').trim();
      const hearingTime = String(body.hearing_time || body.time || '').trim();
      const currentUser = String(body.user || '').trim();
      const isoDate = ruDateToIsoServer(hearingDate);
      const row = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [id]);

      if (!row) {
        sendJson(res, 404, { error: 'general_case_not_found' });
        return true;
      }

      if (!isoDate || !hearingTime) {
        sendJson(res, 400, { error: 'invalid_hearing_datetime' });
        return true;
      }

      const existingDate = await get(dbPath, 'SELECT id FROM court_schedule WHERE is_date_row=1 AND session_date=? LIMIT 1', [hearingDate]);
      if (!existingDate) {
        await run(dbPath, `INSERT INTO court_schedule (session_date, court, time, representative, plaintiff, defendant, category, result, is_date_row, hearing_date, general_case_id, created_at, updated_at) VALUES (?, '', '', '', '', '', '', '', 1, '', NULL, ?, ?)`, [hearingDate, new Date().toISOString(), new Date().toISOString()]);
      }

      const scheduleVals = [
        hearingDate,
        row.court || '',
        hearingTime,
        row.executor || currentUser || '',
        row.plaintiff || '',
        row.defendant || '',
        row.review_result || '',
        row.claim_subject || '',
        0,
        '',
        id,
        new Date().toISOString()
      ];

      const existingSchedule = await get(dbPath, 'SELECT id FROM court_schedule WHERE general_case_id=? AND is_date_row=0 LIMIT 1', [id]);
      let scheduleRow;
      if (existingSchedule) {
        await run(dbPath, `UPDATE court_schedule SET session_date=?, court=?, time=?, representative=?, plaintiff=?, defendant=?, category=?, result=?, is_date_row=?, hearing_date=?, general_case_id=?, updated_at=? WHERE id=?`, [...scheduleVals, existingSchedule.id]);
        scheduleRow = await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [existingSchedule.id]);
      } else {
        const scheduleResult = await run(dbPath, `INSERT INTO court_schedule (session_date, court, time, representative, plaintiff, defendant, category, result, is_date_row, hearing_date, general_case_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, scheduleVals);
        scheduleRow = await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [scheduleResult.id]);
      }

      const desc = `Явочное дело № ${row.case_no || ''} по предмету ${row.claim_subject || ''}`.trim();
      const assignment = `${desc}\nИстец: ${row.plaintiff || ''}\nОтветчик: ${row.defendant || ''}`;
      const calendarVals = [
        isoDate, isoDate,
        currentUser || row.executor || 'Администратор', currentUser || row.executor || 'Администратор',
        'судебное_заседание', 'судебное_заседание',
        desc || 'Судебное заседание', desc || 'Судебное заседание',
        hearingTime, hearingTime,
        row.court || '',
        row.claim_subject || '',
        assignment,
        0,
        null,
        id,
        new Date().toISOString()
      ];

      const existingTask = await get(dbPath, 'SELECT id FROM calendar_tasks WHERE general_case_id=? LIMIT 1', [id]);
      let calendarRow;
      if (existingTask) {
        await run(dbPath, `UPDATE calendar_tasks SET date_str=?, "date"=?, user_name=?, "user"=?, task_type=?, "type"=?, description=?, "desc"=?, time_val=?, "time"=?, court=?, subject=?, assignment=?, done=?, meeting_id=COALESCE(?, meeting_id), general_case_id=?, created_at=COALESCE(created_at, ?) WHERE id=?`, [...calendarVals, existingTask.id]);
        calendarRow = await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [existingTask.id]);
      } else {
        const calendarResult = await run(dbPath, `INSERT INTO calendar_tasks (date_str, "date", user_name, "user", task_type, "type", description, "desc", time_val, "time", court, subject, assignment, done, meeting_id, general_case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, calendarVals);
        calendarRow = await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [calendarResult.id]);
      }

      sendJson(res, 200, { ok: true, schedule: scheduleRow, calendar: calendarRow });
      return true;
    }

    const reviewApprovalListMatch = path.match(/^\/api\/general-cases\/(\d+)\/review-approval$/);
    if (reviewApprovalListMatch && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      const id = Number(reviewApprovalListMatch[1]);
      const row = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [id]);
      if (!row) { sendJson(res, 404, { error: 'general_case_not_found' }); return true; }
      if (!hasPermission(session, PERMISSIONS.CASES_VIEW_ANY) && !isOwnGeneralCase(session, row)) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }
      const approvals = await all(dbPath, 'SELECT * FROM general_case_review_approvals WHERE general_case_id=? ORDER BY updated_at DESC, id DESC', [id]);
      sendJson(res, 200, { items: approvals.map(approvalResponse) });
      return true;
    }

    const reviewApprovalRequestMatch = path.match(/^\/api\/general-cases\/(\d+)\/review-approval\/request$/);
    if (reviewApprovalRequestMatch && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      const id = Number(reviewApprovalRequestMatch[1]);
      const body = await readBody(req);
      const row = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [id]);
      if (!row) { sendJson(res, 404, { error: 'general_case_not_found' }); return true; }
      if (!canRequestGeneralCaseApproval(session, row)) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }
      if (Number(row.review_show_flag || 0) !== 1) {
        sendJson(res, 400, { error: 'review_flag_required', message: 'Согласование доступно только для дел с пометкой «Отзыв показать».' });
        return true;
      }
      const documents = parseJsonArraySafe(row.documents_json);
      const requestedIndex = Number(body.document_index);
      const documentId = String(body.documentId || body.document_id || '').trim();
      const doc = findReviewDocument(documents, {
        documentId,
        documentPath: body.document_path,
        documentIndex: Number.isInteger(requestedIndex) ? requestedIndex : null
      });
      if (!doc || !String(doc.path || '').trim()) {
        sendJson(res, 400, { error: 'review_document_required', message: 'Перед отправкой на согласование прикрепите и сохраните документ «Отзыв».' });
        return true;
      }
      const savedDocumentId = String(doc.id || doc.document_id || '').trim();
      if (documentId && savedDocumentId !== documentId) {
        sendJson(res, 400, { error: 'document_not_found', message: 'Документ не найден в сохранённой карточке дела.' });
        return true;
      }
      if (!savedDocumentId) {
        sendJson(res, 400, { error: 'document_id_required', message: 'Сначала сохраните документ в карточке дела, затем отправьте его на согласование.' });
        return true;
      }
      if (!/отзыв|review/i.test(String(`${doc.type || ''} ${doc.name || ''}`))) {
        sendJson(res, 400, { error: 'review_document_type_required', message: 'Согласование доступно только для документа «Отзыв».' });
        return true;
      }
      const approverId = Number(body.approverId || body.approver_id || 0);
      const approverById = approverId
        ? await get(dbPath, 'SELECT full_name FROM users WHERE id=? AND COALESCE(is_active,1)=1 LIMIT 1', [approverId]).catch(() => null)
        : null;
      const reviewer = String(approverById?.full_name || body.reviewer_name || '').trim()
        || (await get(dbPath, 'SELECT full_name FROM users WHERE COALESCE(is_active,1)=1 AND COALESCE(role_level,1)>=3 ORDER BY role_level DESC, id ASC LIMIT 1').catch(() => null))?.full_name
        || '';
      if (!reviewer) {
        sendJson(res, 400, { error: 'approver_required', message: 'Не удалось определить согласующего.' });
        return true;
      }
      const now = new Date().toISOString();
      const existing = await get(dbPath, `
        SELECT * FROM general_case_review_approvals
        WHERE general_case_id=?
          AND (document_id=? OR (?<>'' AND document_path=?))
        LIMIT 1
      `, [id, savedDocumentId, doc.path || '', doc.path || '']);
      const comment = String(body.comment || '').trim();
      if (existing) {
        const existingStatus = normalizeApprovalStatus(existing.status);
        if (existingStatus === 'pending') {
          sendJson(res, 409, { error: 'approval_already_pending', message: 'Документ уже отправлен на согласование.' });
          return true;
        }
        if (existingStatus === 'approved' || existingStatus === 'completed') {
          sendJson(res, 409, { error: 'approval_already_finished', message: 'Документ уже согласован.' });
          return true;
        }
        const historyJson = appendApprovalHistory(existing, 'request', session.full_name, comment);
        await run(dbPath, `
          UPDATE general_case_review_approvals
          SET document_id=?, document_path=?, document_name=?, document_type=?, requester_name=?, reviewer_name=?, status='pending',
              request_comment=?, history_json=?, updated_at=?, approved_at='', completed_at=''
          WHERE id=?
        `, [savedDocumentId, doc.path || '', doc.name || '', doc.type || '', session.full_name, reviewer, comment, historyJson, now, existing.id]);
        sendJson(res, 200, approvalResponse(await get(dbPath, 'SELECT * FROM general_case_review_approvals WHERE id=?', [existing.id])));
        return true;
      }
      const historyJson = stringifyHistory([{ action: 'request', actor: session.full_name, comment, at: now }]);
      const result = await run(dbPath, `
        INSERT INTO general_case_review_approvals (
          general_case_id, document_id, document_path, document_name, document_type, requester_name,
          reviewer_name, status, request_comment, history_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `, [id, savedDocumentId, doc.path, doc.name || '', doc.type || '', session.full_name, reviewer, comment, historyJson, now, now]);
      sendJson(res, 201, approvalResponse(await get(dbPath, 'SELECT * FROM general_case_review_approvals WHERE id=?', [result.id])));
      return true;
    }

    const reviewApprovalActionMatch = path.match(/^\/api\/general-cases\/(\d+)\/review-approval\/(\d+)\/(comment|revision|approve|court-sent)$/);
    if (reviewApprovalActionMatch && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      const caseId = Number(reviewApprovalActionMatch[1]);
      const approvalId = Number(reviewApprovalActionMatch[2]);
      const action = reviewApprovalActionMatch[3];
      const body = await readBody(req);
      const row = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [caseId]);
      const approval = await get(dbPath, 'SELECT * FROM general_case_review_approvals WHERE id=? AND general_case_id=?', [approvalId, caseId]);
      if (!row) { sendJson(res, 404, { error: 'general_case_not_found' }); return true; }
      if (!approval) { sendJson(res, 404, { error: 'approval_not_found' }); return true; }

      const isRequester = isSameUserName(approval.requester_name, session.full_name);
      const isReviewer = canReviewGeneralCaseApproval(session);
      if (!isRequester && !isReviewer) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }

      const now = new Date().toISOString();
      const comment = String(body.comment || '').trim();
      const markedFilePath = String(body.marked_file_path || approval.marked_file_path || '').trim();
      let nextStatus = normalizeApprovalStatus(approval.status);
      let approvedAt = approval.approved_at || '';
      let completedAt = approval.completed_at || '';

      if (action === 'revision') {
        if (!isReviewer) { sendJson(res, 403, { error: 'manager_required' }); return true; }
        nextStatus = 'revision_required';
      } else if (action === 'approve') {
        if (!isReviewer) { sendJson(res, 403, { error: 'manager_required' }); return true; }
        nextStatus = 'approved';
        approvedAt = now;
      } else if (action === 'court-sent') {
        if (!isRequester && !isReviewer) { sendJson(res, 403, { error: 'forbidden' }); return true; }
        if (normalizeApprovalStatus(approval.status) !== 'approved') {
          sendJson(res, 409, { error: 'approval_required', message: 'Перед отметкой отправки в суд документ «Отзыв» должен быть согласован.' });
          return true;
        }
        nextStatus = 'completed';
        completedAt = now;
      }

      const historyJson = appendApprovalHistory(approval, action, session.full_name, comment);
      await run(dbPath, `
        UPDATE general_case_review_approvals
        SET status=?, reviewer_comment=?,
            marked_file_path=?, history_json=?, updated_at=?, approved_at=?, completed_at=?
        WHERE id=?
      `, [
        nextStatus,
        comment || approval.reviewer_comment || '',
        markedFilePath,
        historyJson,
        now,
        approvedAt,
        completedAt,
        approvalId
      ]);
      sendJson(res, 200, approvalResponse(await get(dbPath, 'SELECT * FROM general_case_review_approvals WHERE id=?', [approvalId])));
      return true;
    }

    const generalArchiveRestoreMatch = path.match(/^\/api\/general-cases\/archive\/(\d+)\/restore$/);
    if (generalArchiveRestoreMatch && req.method === 'POST') {
      const archiveId = Number(generalArchiveRestoreMatch[1]);
      const row = await get(dbPath, 'SELECT * FROM general_cases_archive WHERE id=?', [archiveId]);

      if (!row) {
        sendJson(res, 404, { error: 'general_case_archive_not_found' });
        return true;
      }

      const result = await run(dbPath, `INSERT INTO general_cases (case_no,court_no,court,judge,executor,category,procedural_position,claim_subject,claim_address,registration_date,review_result,control_flag,attendance_flag,attendance_hearing_missing,review_show_flag,emergency_fund_flag,registry_flag,comments,judicial_act_date_first,first_instance_act_type,motivated_decision_date,appeal_act_date,cassation_act_date,documents_json,process_kind,act_instance,proceeding_form,appeal_kind,order_copy_date,apk_cassation_has_appeal,supervision_cassation_exhausted,late_motivated_received,appeals_json,created_at,updated_at,plaintiff,defendant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [row.case_no,row.court_no,row.court,row.judge,row.executor,row.category,row.procedural_position,row.claim_subject,row.claim_address || '',row.registration_date,row.review_result,row.control_flag,row.attendance_flag,row.attendance_hearing_missing || 0,row.review_show_flag || 0,row.emergency_fund_flag || 0,row.registry_flag || 0,row.comments || '',row.judicial_act_date_first || '',row.first_instance_act_type || '',row.motivated_decision_date || '',row.appeal_act_date || '',row.cassation_act_date || '',row.documents_json || '',row.process_kind || '',row.act_instance || '',row.proceeding_form || '',row.appeal_kind || '',row.order_copy_date || '',row.apk_cassation_has_appeal || '',row.supervision_cassation_exhausted || '',row.late_motivated_received || '',row.appeals_json || '',new Date().toISOString(),new Date().toISOString(),row.plaintiff,row.defendant]);
      await run(dbPath, 'DELETE FROM general_cases_archive WHERE id=?', [archiveId]);
      sendJson(res, 200, await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [result.id]));
      return true;
    }

    const m = path.match(/^\/api\/general-cases\/(\d+)$/);
    if (m) {
      const session = await getRequestSession(req, dbPath);
      const id = Number(m[1]);
      const existingCase = await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [id]);
      if (!existingCase) { sendJson(res, 404, { error: 'general_case_not_found' }); return true; }
      if (!hasPermission(session, PERMISSIONS.CASES_VIEW_ANY) && !isOwnGeneralCase(session, existingCase)) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }
      if (req.method === 'GET') { sendJson(res, 200, existingCase); return true; }
      if (req.method === 'PUT') {
        if (!canEditGeneralCase(session, existingCase)) { sendJson(res, 403, { error: 'forbidden' }); return true; }
        const rawGeneralBody = await readBody(req);
        const d = normCase(rawGeneralBody);
        if (!hasPermission(session, PERMISSIONS.CASES_EDIT_ANY)) d.executor = session.full_name;
        await run(dbPath, `UPDATE general_cases SET case_no=?,court_no=?,court=?,judge=?,executor=?,category=?,procedural_position=?,claim_subject=?,claim_address=?,registration_date=?,review_result=?,control_flag=?,attendance_flag=?,attendance_hearing_missing=?,review_show_flag=?,emergency_fund_flag=?,registry_flag=?,comments=?,judicial_act_date_first=?,first_instance_act_type=?,motivated_decision_date=?,appeal_act_date=?,cassation_act_date=?,documents_json=?,process_kind=?,act_instance=?,proceeding_form=?,appeal_kind=?,order_copy_date=?,apk_cassation_has_appeal=?,supervision_cassation_exhausted=?,late_motivated_received=?,appeals_json=?,updated_at=?,plaintiff=?,defendant=? WHERE id=?`, [d.case_no,d.court_no,d.court,d.judge,d.executor,d.category,d.procedural_position,d.claim_subject,d.claim_address,d.registration_date,d.review_result,d.control_flag,d.attendance_flag,d.attendance_hearing_missing,d.review_show_flag,d.emergency_fund_flag,d.registry_flag,d.comments,d.judicial_act_date_first,d.first_instance_act_type,d.motivated_decision_date,d.appeal_act_date,d.cassation_act_date,d.documents_json,d.process_kind,d.act_instance,d.proceeding_form,d.appeal_kind,d.order_copy_date,d.apk_cassation_has_appeal,d.supervision_cassation_exhausted,d.late_motivated_received,d.appeals_json,new Date().toISOString(),d.plaintiff,d.defendant,id]);
        if (!rawGeneralBody.skip_linked) await syncLinked(dbPath, id, d);
        sendJson(res, 200, await get(dbPath, 'SELECT * FROM general_cases WHERE id=?', [id])); return true;
      }
      if (req.method === 'DELETE') {
        if (!canEditGeneralCase(session, existingCase)) { sendJson(res, 403, { error: 'forbidden' }); return true; }
        const row = existingCase;
        if (row) {
          await run(dbPath, `INSERT INTO general_cases_archive (source_id,case_no,court_no,court,judge,executor,category,procedural_position,claim_subject,claim_address,registration_date,review_result,control_flag,attendance_flag,attendance_hearing_missing,review_show_flag,emergency_fund_flag,registry_flag,comments,judicial_act_date_first,first_instance_act_type,motivated_decision_date,appeal_act_date,cassation_act_date,documents_json,process_kind,act_instance,proceeding_form,appeal_kind,order_copy_date,apk_cassation_has_appeal,supervision_cassation_exhausted,late_motivated_received,appeals_json,archived_at,plaintiff,defendant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [row.id,row.case_no,row.court_no,row.court,row.judge,row.executor,row.category,row.procedural_position,row.claim_subject,row.claim_address || '',row.registration_date,row.review_result,row.control_flag,row.attendance_flag,row.attendance_hearing_missing || 0,row.review_show_flag || 0,row.emergency_fund_flag || 0,row.registry_flag || 0,row.comments || '',row.judicial_act_date_first || '',row.first_instance_act_type || '',row.motivated_decision_date || '',row.appeal_act_date || '',row.cassation_act_date || '',row.documents_json || '',row.process_kind || '',row.act_instance || '',row.proceeding_form || '',row.appeal_kind || '',row.order_copy_date || '',row.apk_cassation_has_appeal || '',row.supervision_cassation_exhausted || '',row.late_motivated_received || '',row.appeals_json || '',new Date().toISOString(),row.plaintiff,row.defendant]);
          await run(dbPath, 'DELETE FROM general_cases WHERE id=?', [id]);
        }
        sendJson(res, 200, { ok: true }); return true;
      }
    }

    if (path === '/api/controlled-cases' && req.method === 'GET') {
      const search = (parsedUrl.searchParams.get('search') || '').trim();
      const cols = ['case_number','plaintiff','defendant','subject','representative','result','court_case_number','court'];
      const where = search ? 'WHERE ' + cols.map(c => `LOWER(COALESCE(${c},'')) LIKE LOWER(?)`).join(' OR ') : '';
      const params = search ? cols.map(() => `%${search}%`) : [];
      sendJson(res, 200, await all(dbPath, `SELECT * FROM controlled_cases ${where} ORDER BY id DESC LIMIT 2000`, params));
      return true;
    }

    if (path === '/api/controlled-cases' && req.method === 'POST') {
      const d = normControlled(await readBody(req));
      const result = await run(dbPath, `
        INSERT INTO controlled_cases (
          case_number, plaintiff, defendant, subject, representative, result,
          court_case_number, court, general_case_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        d.case_number, d.plaintiff, d.defendant, d.subject, d.representative, d.result,
        d.court_case_number, d.court, d.general_case_id, new Date().toISOString(), new Date().toISOString()
      ]);

      sendJson(res, 201, await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [result.id]));
      return true;
    }

    if (path === '/api/controlled-cases/archive' && req.method === 'GET') {
      const rows = await all(dbPath, 'SELECT * FROM archive WHERE table_name=? ORDER BY id DESC LIMIT 2000', ['controlled_cases']);
      sendJson(res, 200, rows.map(row => {
        let data = {};
        try { data = JSON.parse(row.data || '{}'); } catch {}
        return { ...row, data };
      }));
      return true;
    }

    const controlledArchiveRestoreMatch = path.match(/^\/api\/controlled-cases\/archive\/(\d+)\/restore$/);
    if (controlledArchiveRestoreMatch && req.method === 'POST') {
      const archiveId = Number(controlledArchiveRestoreMatch[1]);
      const archiveRow = await get(dbPath, 'SELECT * FROM archive WHERE id=? AND table_name=?', [archiveId, 'controlled_cases']);

      if (!archiveRow) {
        sendJson(res, 404, { error: 'archive_record_not_found' });
        return true;
      }

      let parsed = {};
      try { parsed = JSON.parse(archiveRow.data || '{}'); } catch {}
      const d = normControlled(parsed);

      const result = await run(dbPath, `
        INSERT INTO controlled_cases (
          case_number, plaintiff, defendant, subject, representative, result,
          court_case_number, court, general_case_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        d.case_number, d.plaintiff, d.defendant, d.subject, d.representative, d.result,
        d.court_case_number, d.court, d.general_case_id, new Date().toISOString(), new Date().toISOString()
      ]);

      await run(dbPath, 'DELETE FROM archive WHERE id=?', [archiveId]);
      sendJson(res, 200, await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [result.id]));
      return true;
    }

    const controlledArchiveDeleteMatch = path.match(/^\/api\/controlled-cases\/archive\/(\d+)$/);
    if (controlledArchiveDeleteMatch && req.method === 'DELETE') {
      await run(dbPath, 'DELETE FROM archive WHERE id=? AND table_name=?', [Number(controlledArchiveDeleteMatch[1]), 'controlled_cases']);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const controlledMatch = path.match(/^\/api\/controlled-cases\/(\d+)$/);
    if (controlledMatch) {
      const id = Number(controlledMatch[1]);

      if (req.method === 'GET') {
        sendJson(res, 200, await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [id]));
        return true;
      }

      if (req.method === 'PUT') {
        const d = normControlled(await readBody(req));
        await run(dbPath, `
          UPDATE controlled_cases
          SET case_number=?, plaintiff=?, defendant=?, subject=?, representative=?, result=?,
              court_case_number=?, court=?, general_case_id=COALESCE(?, general_case_id), updated_at=?
          WHERE id=?
        `, [
          d.case_number, d.plaintiff, d.defendant, d.subject, d.representative, d.result,
          d.court_case_number, d.court, d.general_case_id, new Date().toISOString(), id
        ]);

        sendJson(res, 200, await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [id]));
        return true;
      }

      if (req.method === 'DELETE') {
        const row = await get(dbPath, 'SELECT * FROM controlled_cases WHERE id=?', [id]);

        if (row) {
          await run(dbPath, 'INSERT INTO archive (table_name, record_id, data, archived_at) VALUES (?, ?, ?, ?)', [
            'controlled_cases',
            id,
            JSON.stringify(row),
            new Date().toISOString()
          ]);

          await run(dbPath, 'DELETE FROM controlled_cases WHERE id=?', [id]);
        }

        sendJson(res, 200, { ok: true });
        return true;
      }
    }


    if (path === '/api/enforcement' && req.method === 'GET') {
      const mode = parsedUrl.searchParams.get('mode') || '';
      const archived = parsedUrl.searchParams.get('archived') === '1';
      const search = (parsedUrl.searchParams.get('search') || '').trim();

      const cols = [
        'case_number', 'ip_number', 'subject_execution', 'date_start', 'start_date',
        'basis', 'start_basis', 'appeal_info', 'deadline', 'execution_deadline',
        'amount_claimed', 'claim_sum', 'payment_info', 'total_paid', 'debt', 'production_character'
      ];

      const where = ['archived=?'];
      const params = [archived ? 1 : 0];

      if (mode) {
        where.push('mode=?');
        params.push(mode);
      }

      if (search) {
        where.push('(' + cols.map(c => `LOWER(COALESCE(${c},'')) LIKE LOWER(?)`).join(' OR ') + ')');
        params.push(...cols.map(() => `%${search}%`));
      }

      sendJson(res, 200, await all(dbPath, `SELECT * FROM enforcement_proceedings WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 2000`, params));
      return true;
    }

    if (path === '/api/enforcement' && req.method === 'POST') {
      const d = normEnforcement(await readBody(req));
      const result = await run(dbPath, `
        INSERT INTO enforcement_proceedings (
          mode, archived, case_number, ip_number, subject_execution,
          date_start, start_date, basis, start_basis, appeal_info,
          deadline, execution_deadline, term_execution, nature, production_character,
          amount_claimed, claim_sum, claim_amount, payment_info, payments_json,
          total_paid, amount_paid_total, debt, debt_amount, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        d.mode, 0, d.case_number, d.ip_number, d.subject_execution,
        d.date_start, d.start_date, d.basis, d.start_basis, d.appeal_info,
        d.deadline, d.execution_deadline, d.term_execution, d.nature, d.production_character,
        d.amount_claimed, d.claim_sum, d.claim_amount, d.payment_info, d.payments_json,
        d.total_paid, d.amount_paid_total, d.debt, d.debt_amount, new Date().toISOString(), new Date().toISOString()
      ]);

      sendJson(res, 201, await get(dbPath, 'SELECT * FROM enforcement_proceedings WHERE id=?', [result.id]));
      return true;
    }

    if (path === '/api/enforcement/archive' && req.method === 'GET') {
      const mode = parsedUrl.searchParams.get('mode') || '';

      const rows = await all(dbPath, 'SELECT * FROM archive WHERE table_name=? ORDER BY id DESC LIMIT 2000', ['enforcement_proceedings']);
      const parsed = rows.map(row => {
        let data = {};
        try { data = JSON.parse(row.data || '{}'); } catch {}
        return { ...row, data };
      }).filter(row => !mode || row.data?.mode === mode);

      sendJson(res, 200, parsed);
      return true;
    }

    const enforcementArchiveRestoreMatch = path.match(/^\/api\/enforcement\/archive\/(\d+)\/restore$/);
    if (enforcementArchiveRestoreMatch && req.method === 'POST') {
      const archiveId = Number(enforcementArchiveRestoreMatch[1]);
      const archiveRow = await get(dbPath, 'SELECT * FROM archive WHERE id=? AND table_name=?', [archiveId, 'enforcement_proceedings']);

      if (!archiveRow) {
        sendJson(res, 404, { error: 'archive_record_not_found' });
        return true;
      }

      let data = {};
      try { data = JSON.parse(archiveRow.data || '{}'); } catch {}
      const d = normEnforcement(data);

      const result = await run(dbPath, `
        INSERT INTO enforcement_proceedings (
          mode, archived, case_number, ip_number, subject_execution,
          date_start, start_date, basis, start_basis, appeal_info,
          deadline, execution_deadline, term_execution, nature, production_character,
          amount_claimed, claim_sum, claim_amount, payment_info, payments_json,
          total_paid, amount_paid_total, debt, debt_amount, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        d.mode, 0, d.case_number, d.ip_number, d.subject_execution,
        d.date_start, d.start_date, d.basis, d.start_basis, d.appeal_info,
        d.deadline, d.execution_deadline, d.term_execution, d.nature, d.production_character,
        d.amount_claimed, d.claim_sum, d.claim_amount, d.payment_info, d.payments_json,
        d.total_paid, d.amount_paid_total, d.debt, d.debt_amount, new Date().toISOString(), new Date().toISOString()
      ]);

      await run(dbPath, 'DELETE FROM archive WHERE id=?', [archiveId]);
      sendJson(res, 200, await get(dbPath, 'SELECT * FROM enforcement_proceedings WHERE id=?', [result.id]));
      return true;
    }

    const enforcementArchiveDeleteMatch = path.match(/^\/api\/enforcement\/archive\/(\d+)$/);
    if (enforcementArchiveDeleteMatch && req.method === 'DELETE') {
      await run(dbPath, 'DELETE FROM archive WHERE id=? AND table_name=?', [Number(enforcementArchiveDeleteMatch[1]), 'enforcement_proceedings']);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const enforcementArchiveMatch = path.match(/^\/api\/enforcement\/(\d+)\/archive$/);
    if (enforcementArchiveMatch && req.method === 'POST') {
      const id = Number(enforcementArchiveMatch[1]);
      const row = await get(dbPath, 'SELECT * FROM enforcement_proceedings WHERE id=?', [id]);

      if (row) {
        await run(dbPath, 'INSERT INTO archive (table_name, record_id, data, archived_at) VALUES (?, ?, ?, ?)', [
          'enforcement_proceedings',
          id,
          JSON.stringify(row),
          new Date().toISOString()
        ]);
        await run(dbPath, 'DELETE FROM enforcement_proceedings WHERE id=?', [id]);
      }

      sendJson(res, 200, { ok: true });
      return true;
    }

    const enforcementMatch = path.match(/^\/api\/enforcement\/(\d+)$/);
    if (enforcementMatch) {
      const id = Number(enforcementMatch[1]);

      if (req.method === 'GET') {
        sendJson(res, 200, await get(dbPath, 'SELECT * FROM enforcement_proceedings WHERE id=?', [id]));
        return true;
      }

      if (req.method === 'PUT') {
        const d = normEnforcement(await readBody(req));
        await run(dbPath, `
          UPDATE enforcement_proceedings
          SET mode=?, archived=?, case_number=?, ip_number=?, subject_execution=?,
              date_start=?, start_date=?, basis=?, start_basis=?, appeal_info=?,
              deadline=?, execution_deadline=?, term_execution=?, nature=?, production_character=?,
              amount_claimed=?, claim_sum=?, claim_amount=?, payment_info=?, payments_json=?,
              total_paid=?, amount_paid_total=?, debt=?, debt_amount=?, updated_at=?
          WHERE id=?
        `, [
          d.mode, 0, d.case_number, d.ip_number, d.subject_execution,
          d.date_start, d.start_date, d.basis, d.start_basis, d.appeal_info,
          d.deadline, d.execution_deadline, d.term_execution, d.nature, d.production_character,
          d.amount_claimed, d.claim_sum, d.claim_amount, d.payment_info, d.payments_json,
          d.total_paid, d.amount_paid_total, d.debt, d.debt_amount, new Date().toISOString(), id
        ]);

        sendJson(res, 200, await get(dbPath, 'SELECT * FROM enforcement_proceedings WHERE id=?', [id]));
        return true;
      }

      if (req.method === 'DELETE') {
        await run(dbPath, 'DELETE FROM enforcement_proceedings WHERE id=?', [id]);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }





if (path === '/api/meetings' && req.method === 'GET') {
  sendJson(res, 200, await all(dbPath, 'SELECT * FROM meetings ORDER BY date_val DESC, time_val DESC, id DESC LIMIT 5000'));
  return true;
}

if (path === '/api/meetings' && req.method === 'POST') {
  const d = normMeeting(await readBody(req));
  const result = await run(dbPath, `INSERT INTO meetings (title,date_val,time_val,agenda,protocol,participants,attachment_path,has_participants_list,has_telegram,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.title,d.date_val,d.time_val,d.agenda,d.protocol,d.participants,d.attachment_path,d.has_participants_list,d.has_telegram,new Date().toISOString(),new Date().toISOString()]);
  sendJson(res, 201, await get(dbPath, 'SELECT * FROM meetings WHERE id=?', [result.id]));
  return true;
}

const meetingsMatch = path.match(/^\/api\/meetings\/(\d+)$/);
if (meetingsMatch) {
  const id = Number(meetingsMatch[1]);
  if (req.method === 'PUT') {
    const d = normMeeting(await readBody(req));
    await run(dbPath, `UPDATE meetings SET title=?, date_val=?, time_val=?, agenda=?, protocol=?, participants=?, attachment_path=?, has_participants_list=?, has_telegram=?, updated_at=? WHERE id=?`,
      [d.title,d.date_val,d.time_val,d.agenda,d.protocol,d.participants,d.attachment_path,d.has_participants_list,d.has_telegram,new Date().toISOString(),id]);
    sendJson(res, 200, await get(dbPath, 'SELECT * FROM meetings WHERE id=?', [id]));
    return true;
  }
  if (req.method === 'DELETE') {
    await run(dbPath, 'DELETE FROM meetings WHERE id=?', [id]);
    sendJson(res, 200, { ok: true });
    return true;
  }
}

if (path === '/api/municipal-registry' && req.method === 'GET') {
  const search = String(parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
  const rows = await all(dbPath, 'SELECT * FROM registry ORDER BY id DESC LIMIT 5000');
  if (!search) { sendJson(res, 200, rows); return true; }
  const parts = search.split(',').map(s => s.trim()).filter(Boolean);
  sendJson(res, 200, rows.filter(row => {
    const haystack = Object.values(row).map(value => String(value ?? '').toLowerCase()).join(' | ');
    return parts.every(part => haystack.includes(part));
  }));
  return true;
}

if (path === '/api/municipal-registry/archive' && req.method === 'GET') {
  const rows = await all(dbPath, 'SELECT * FROM archive WHERE table_name=? ORDER BY id DESC LIMIT 5000', ['registry']);
  sendJson(res, 200, rows.map(row => {
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch {}
    return { ...data, archive_id: row.id, original_id: row.record_id, archived_at: row.archived_at };
  }));
  return true;
}

if (path === '/api/municipal-registry' && req.method === 'POST') {
  const d = normMunicipalRegistry(await readBody(req));
  const result = await run(dbPath, `INSERT INTO registry (pk_number,kvartal,address,fio,property_type,notes,court,stage,court_act_date,court_act_number,court_act,requirements,appeal,execution,collected,review_ready,attachments_json,general_case_id,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.pk_number,d.kvartal,d.address,d.fio,d.property_type,d.notes,d.court,d.stage,d.court_act_date,d.court_act_number,d.court_act || [d.court_act_date,d.court_act_number].filter(Boolean).join(', '),d.requirements,d.appeal,d.execution,d.collected,d.review_ready,d.attachments_json,d.general_case_id,new Date().toISOString(),new Date().toISOString()]);
  sendJson(res, 201, await get(dbPath, 'SELECT * FROM registry WHERE id=?', [result.id]));
  return true;
}

const registryArchiveRestoreMatch = path.match(/^\/api\/municipal-registry\/archive\/(\d+)\/restore$/);
if (registryArchiveRestoreMatch && req.method === 'POST') {
  const archiveId = Number(registryArchiveRestoreMatch[1]);
  const archiveRow = await get(dbPath, 'SELECT * FROM archive WHERE id=? AND table_name=?', [archiveId, 'registry']);
  if (!archiveRow) { sendJson(res, 404, { error: 'archive_record_not_found' }); return true; }
  let d = {}; try { d = normMunicipalRegistry(JSON.parse(archiveRow.data || '{}')); } catch { d = normMunicipalRegistry({}); }
  const result = await run(dbPath, `INSERT INTO registry (pk_number,kvartal,address,fio,property_type,notes,court,stage,court_act_date,court_act_number,court_act,requirements,appeal,execution,collected,review_ready,attachments_json,general_case_id,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.pk_number,d.kvartal,d.address,d.fio,d.property_type,d.notes,d.court,d.stage,d.court_act_date,d.court_act_number,d.court_act,d.requirements,d.appeal,d.execution,d.collected,d.review_ready,d.attachments_json,d.general_case_id,new Date().toISOString(),new Date().toISOString()]);
  await run(dbPath, 'DELETE FROM archive WHERE id=? AND table_name=?', [archiveId, 'registry']);
  sendJson(res, 200, await get(dbPath, 'SELECT * FROM registry WHERE id=?', [result.id]));
  return true;
}

const registryArchiveDeleteMatch = path.match(/^\/api\/municipal-registry\/archive\/(\d+)$/);
if (registryArchiveDeleteMatch && req.method === 'DELETE') {
  await run(dbPath, 'DELETE FROM archive WHERE id=? AND table_name=?', [Number(registryArchiveDeleteMatch[1]), 'registry']);
  sendJson(res, 200, { ok: true });
  return true;
}

const registryArchiveMatch = path.match(/^\/api\/municipal-registry\/(\d+)\/archive$/);
if (registryArchiveMatch && req.method === 'POST') {
  const id = Number(registryArchiveMatch[1]);
  const row = await get(dbPath, 'SELECT * FROM registry WHERE id=?', [id]);
  if (!row) { sendJson(res, 404, { error: 'not_found' }); return true; }
  await run(dbPath, 'INSERT INTO archive (table_name, record_id, data) VALUES (?, ?, ?)', ['registry', id, JSON.stringify(row)]);
  await run(dbPath, 'DELETE FROM registry WHERE id=?', [id]);
  sendJson(res, 200, { ok: true });
  return true;
}

const registryMatch = path.match(/^\/api\/municipal-registry\/(\d+)$/);
if (registryMatch) {
  const id = Number(registryMatch[1]);
  if (req.method === 'PUT') {
    const d = normMunicipalRegistry(await readBody(req));
    await run(dbPath, `UPDATE registry SET pk_number=?, kvartal=?, address=?, fio=?, property_type=?, notes=?, court=?, stage=?, court_act_date=?, court_act_number=?, court_act=?, requirements=?, appeal=?, execution=?, collected=?, review_ready=?, attachments_json=?, general_case_id=?, updated_at=? WHERE id=?`,
      [d.pk_number,d.kvartal,d.address,d.fio,d.property_type,d.notes,d.court,d.stage,d.court_act_date,d.court_act_number,d.court_act || [d.court_act_date,d.court_act_number].filter(Boolean).join(', '),d.requirements,d.appeal,d.execution,d.collected,d.review_ready,d.attachments_json,d.general_case_id,new Date().toISOString(),id]);
    sendJson(res, 200, await get(dbPath, 'SELECT * FROM registry WHERE id=?', [id]));
    return true;
  }
  if (req.method === 'DELETE') {
    await run(dbPath, 'DELETE FROM registry WHERE id=?', [id]);
    sendJson(res, 200, { ok: true });
    return true;
  }
}

if (path === '/api/emergency-fund' && req.method === 'GET') {
  const search = String(parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
  const rows = await all(dbPath, 'SELECT * FROM emergency_fund ORDER BY id DESC LIMIT 5000');

  if (!search) {
    sendJson(res, 200, rows);
    return true;
  }

  const parts = search.split(',').map(s => s.trim()).filter(Boolean);
  const filtered = rows.filter(row => {
    const haystack = Object.values(row).map(value => String(value ?? '').toLowerCase()).join(' | ');
    return parts.every(part => haystack.includes(part));
  });

  sendJson(res, 200, filtered);
  return true;
}

if (path === '/api/emergency-fund' && req.method === 'POST') {
  const d = normEmergencyFund(await readBody(req));
  const result = await run(dbPath, `
    INSERT INTO emergency_fund (
      kvartal, pk_number, fio, prosecutor, address, district, requirements, stage,
      case_number, judicial_act_date, appeal, claim_amount, collected, area, address_exec,
      sum_property_claim, sum_property, execution, executors, notes, court, latitude, longitude,
      pk, case_num, sum_claim, provided_area, execution_quarter, review_ready,
      total_unfulfilled_sum, total_fulfilled_sum, total_unfulfilled_area, total_provided_area, execution_people_json,
      condemned_date, resettlement_deadline, general_case_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    d.kvartal, d.pk_number, d.fio, d.prosecutor, d.address, d.district, d.requirements, d.stage,
    d.case_number, d.judicial_act_date, d.appeal, d.claim_amount, d.collected, d.area, d.address_exec,
    d.sum_property_claim, d.sum_property, d.execution, d.executors, d.notes, d.court, d.latitude, d.longitude,
    d.pk, d.case_num, d.sum_claim, d.provided_area, d.execution_quarter, d.review_ready,
    d.total_unfulfilled_sum, d.total_fulfilled_sum, d.total_unfulfilled_area, d.total_provided_area, d.execution_people_json,
    d.condemned_date, d.resettlement_deadline, d.general_case_id, new Date().toISOString(), new Date().toISOString()
  ]);

  sendJson(res, 201, await get(dbPath, 'SELECT * FROM emergency_fund WHERE id=?', [result.id]));
  return true;
}

if (path === '/api/emergency-fund/archive' && req.method === 'GET') {
  const rows = await all(dbPath, 'SELECT * FROM archive WHERE table_name=? ORDER BY id DESC LIMIT 5000', ['emergency']);
  const parsed = rows.map(row => {
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch {}
    return { ...data, archive_id: row.id, original_id: row.record_id, archived_at: row.archived_at };
  });
  sendJson(res, 200, parsed);
  return true;
}

const emergencyArchiveRestoreMatch = path.match(/^\/api\/emergency-fund\/archive\/(\d+)\/restore$/);
if (emergencyArchiveRestoreMatch && req.method === 'POST') {
  const archiveId = Number(emergencyArchiveRestoreMatch[1]);
  const archiveRow = await get(dbPath, 'SELECT * FROM archive WHERE id=? AND table_name=?', [archiveId, 'emergency']);

  if (!archiveRow) {
    sendJson(res, 404, { error: 'archive_record_not_found' });
    return true;
  }

  let d = {};
  try { d = normEmergencyFund(JSON.parse(archiveRow.data || '{}')); } catch { d = normEmergencyFund({}); }

  const result = await run(dbPath, `
    INSERT INTO emergency_fund (
      kvartal, pk_number, fio, prosecutor, address, district, requirements, stage,
      case_number, judicial_act_date, appeal, claim_amount, collected, area, address_exec,
      sum_property_claim, sum_property, execution, executors, notes, court, latitude, longitude,
      pk, case_num, sum_claim, provided_area, execution_quarter, review_ready,
      total_unfulfilled_sum, total_fulfilled_sum, total_unfulfilled_area, total_provided_area, execution_people_json,
      condemned_date, resettlement_deadline, general_case_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    d.kvartal, d.pk_number, d.fio, d.prosecutor, d.address, d.district, d.requirements, d.stage,
    d.case_number, d.judicial_act_date, d.appeal, d.claim_amount, d.collected, d.area, d.address_exec,
    d.sum_property_claim, d.sum_property, d.execution, d.executors, d.notes, d.court, d.latitude, d.longitude,
    d.pk, d.case_num, d.sum_claim, d.provided_area, d.execution_quarter, d.review_ready,
    d.total_unfulfilled_sum, d.total_fulfilled_sum, d.total_unfulfilled_area, d.total_provided_area, d.execution_people_json,
    d.condemned_date, d.resettlement_deadline, d.general_case_id, new Date().toISOString(), new Date().toISOString()
  ]);

  await run(dbPath, 'DELETE FROM archive WHERE id=? AND table_name=?', [archiveId, 'emergency']);
  sendJson(res, 200, await get(dbPath, 'SELECT * FROM emergency_fund WHERE id=?', [result.id]));
  return true;
}

const emergencyArchiveDeleteMatch = path.match(/^\/api\/emergency-fund\/archive\/(\d+)$/);
if (emergencyArchiveDeleteMatch && req.method === 'DELETE') {
  await run(dbPath, 'DELETE FROM archive WHERE id=? AND table_name=?', [Number(emergencyArchiveDeleteMatch[1]), 'emergency']);
  sendJson(res, 200, { ok: true });
  return true;
}

const emergencyArchiveMatch = path.match(/^\/api\/emergency-fund\/(\d+)\/archive$/);
if (emergencyArchiveMatch && req.method === 'POST') {
  const id = Number(emergencyArchiveMatch[1]);
  const row = await get(dbPath, 'SELECT * FROM emergency_fund WHERE id=?', [id]);

  if (!row) {
    sendJson(res, 404, { error: 'not_found' });
    return true;
  }

  try {
    await run(dbPath, 'INSERT INTO archive (table_name, record_id, data) VALUES (?, ?, ?)', ['emergency', id, JSON.stringify(row)]);
  } catch {
    await run(dbPath, `CREATE TABLE IF NOT EXISTS archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      data TEXT NOT NULL,
      archived_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(dbPath, 'INSERT INTO archive (table_name, record_id, data) VALUES (?, ?, ?)', ['emergency', id, JSON.stringify(row)]);
  }

  await run(dbPath, 'DELETE FROM emergency_fund WHERE id=?', [id]);
  sendJson(res, 200, { ok: true });
  return true;
}

const emergencyMatch = path.match(/^\/api\/emergency-fund\/(\d+)$/);
if (emergencyMatch) {
  const id = Number(emergencyMatch[1]);

  if (req.method === 'PUT') {
    const d = normEmergencyFund(await readBody(req));
    await run(dbPath, `
      UPDATE emergency_fund
      SET kvartal=?, pk_number=?, fio=?, prosecutor=?, address=?, district=?, requirements=?, stage=?,
          case_number=?, judicial_act_date=?, appeal=?, claim_amount=?, collected=?, area=?, address_exec=?,
          sum_property_claim=?, sum_property=?, execution=?, executors=?, notes=?, court=?, latitude=?, longitude=?,
          pk=?, case_num=?, sum_claim=?, provided_area=?, execution_quarter=?, review_ready=?,
          total_unfulfilled_sum=?, total_fulfilled_sum=?, total_unfulfilled_area=?, total_provided_area=?, execution_people_json=?,
          condemned_date=?, resettlement_deadline=?, general_case_id=?, updated_at=?
      WHERE id=?
    `, [
      d.kvartal, d.pk_number, d.fio, d.prosecutor, d.address, d.district, d.requirements, d.stage,
      d.case_number, d.judicial_act_date, d.appeal, d.claim_amount, d.collected, d.area, d.address_exec,
      d.sum_property_claim, d.sum_property, d.execution, d.executors, d.notes, d.court, d.latitude, d.longitude,
      d.pk, d.case_num, d.sum_claim, d.provided_area, d.execution_quarter, d.review_ready,
      d.total_unfulfilled_sum, d.total_fulfilled_sum, d.total_unfulfilled_area, d.total_provided_area, d.execution_people_json,
      d.condemned_date, d.resettlement_deadline, d.general_case_id, new Date().toISOString(), id
    ]);

    sendJson(res, 200, await get(dbPath, 'SELECT * FROM emergency_fund WHERE id=?', [id]));
    return true;
  }

  if (req.method === 'DELETE') {
    await run(dbPath, 'DELETE FROM emergency_fund WHERE id=?', [id]);
    sendJson(res, 200, { ok: true });
    return true;
  }
}

    if (path === '/api/court-schedule' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      const whereSql = hasPermission(session, PERMISSIONS.SCHEDULE_VIEW_ANY)
        ? ''
        : `WHERE court_schedule.is_date_row=1
          OR COALESCE(court_schedule.representative,'')=?
          OR COALESCE(general_cases.executor,'')=?`;
      const params = hasPermission(session, PERMISSIONS.SCHEDULE_VIEW_ANY) ? [] : [session.full_name, session.full_name];
      const rows = await all(dbPath, `
        SELECT court_schedule.*
        FROM court_schedule
        LEFT JOIN general_cases ON general_cases.id=court_schedule.general_case_id
        ${whereSql}
        ORDER BY
          CASE WHEN session_date IS NULL OR session_date='' THEN 1 ELSE 0 END,
          substr(session_date, 7, 4) || '-' || substr(session_date, 4, 2) || '-' || substr(session_date, 1, 2) ASC,
          is_date_row DESC,
          COALESCE(time, '') ASC,
          id ASC
        LIMIT 5000
      `, params);
      sendJson(res, 200, rows);
      return true;
    }

    if (path === '/api/court-schedule/date' && req.method === 'POST') {
      const d = normSchedule(await readBody(req));
      if (!d.session_date) {
        sendJson(res, 400, { error: 'session_date_required' });
        return true;
      }

      const existing = await get(dbPath, 'SELECT * FROM court_schedule WHERE is_date_row=1 AND session_date=? LIMIT 1', [d.session_date]);
      if (existing) {
        sendJson(res, 200, existing);
        return true;
      }

      const result = await run(dbPath, `
        INSERT INTO court_schedule (
          session_date, court, time, representative, plaintiff, defendant,
          category, result, is_date_row, hearing_date, general_case_id, meeting_id, created_at, updated_at
        )
        VALUES (?, '', '', '', '', '', '', '', 1, '', NULL, NULL, ?, ?)
      `, [d.session_date, new Date().toISOString(), new Date().toISOString()]);

      sendJson(res, 201, await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [result.id]));
      return true;
    }

    if (path === '/api/court-schedule/case' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      const d = normSchedule(await readBody(req));
      if (!hasPermission(session, PERMISSIONS.SCHEDULE_EDIT_ANY)) d.representative = session.full_name;

      if (!d.session_date) {
        sendJson(res, 400, { error: 'session_date_required' });
        return true;
      }

      const result = await run(dbPath, `
        INSERT INTO court_schedule (
          session_date, court, time, representative, plaintiff, defendant,
          category, result, is_date_row, hearing_date, general_case_id, meeting_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `, [
        d.session_date, d.court, d.time, d.representative, d.plaintiff, d.defendant,
        d.category, d.result, d.hearing_date, d.general_case_id, d.meeting_id, new Date().toISOString(), new Date().toISOString()
      ]);

      sendJson(res, 201, await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [result.id]));
      return true;
    }

    const courtScheduleMatch = path.match(/^\/api\/court-schedule\/(\d+)$/);
    if (courtScheduleMatch) {
      const id = Number(courtScheduleMatch[1]);

      if (req.method === 'PUT') {
        const session = await getRequestSession(req, dbPath);
        const existingSchedule = await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [id]);
        if (!canEditScheduleRow(session, existingSchedule)) { sendJson(res, 403, { error: 'forbidden' }); return true; }
        const d = normSchedule(await readBody(req));
        if (!hasPermission(session, PERMISSIONS.SCHEDULE_EDIT_ANY)) d.representative = session.full_name;
        await run(dbPath, `
          UPDATE court_schedule
          SET session_date=?, court=?, time=?, representative=?, plaintiff=?, defendant=?,
              category=?, result=?, hearing_date=?, general_case_id=COALESCE(?, general_case_id), meeting_id=COALESCE(?, meeting_id), updated_at=?
          WHERE id=?
        `, [
          d.session_date, d.court, d.time, d.representative, d.plaintiff, d.defendant,
          d.category, d.result, d.hearing_date, d.general_case_id, d.meeting_id, new Date().toISOString(), id
        ]);

        sendJson(res, 200, await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [id]));
        return true;
      }

      if (req.method === 'DELETE') {
        const session = await getRequestSession(req, dbPath);
        const existingSchedule = await get(dbPath, 'SELECT * FROM court_schedule WHERE id=?', [id]);
        if (!canEditScheduleRow(session, existingSchedule)) { sendJson(res, 403, { error: 'forbidden' }); return true; }
        await run(dbPath, 'DELETE FROM court_schedule WHERE id=?', [id]);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }


    if (path === '/api/calendar-tasks' && req.method === 'GET') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }

      const date = parsedUrl.searchParams.get('date') || '';
      const start = parsedUrl.searchParams.get('start') || '';
      const end = parsedUrl.searchParams.get('end') || '';
      const requestedUser = parsedUrl.searchParams.get('user') || '';
      const requestedScope = parsedUrl.searchParams.get('scope') || '';
      const generalCaseId = Number(parsedUrl.searchParams.get('general_case_id') || 0);
      const effectiveUser = hasPermission(session, PERMISSIONS.CALENDAR_VIEW_ANY) ? requestedUser : session.full_name;

      const where = [];
      const params = [];

      if (date) {
        where.push(`COALESCE(date_str, "date", '')=?`);
        params.push(date);
      }

      if (start) {
        where.push(`COALESCE(NULLIF(end_date, ''), COALESCE(date_str, "date", ''))>=?`);
        params.push(start);
      }

      if (end) {
        where.push(`COALESCE(date_str, "date", '')<=?`);
        params.push(end);
      }

      if (effectiveUser && !generalCaseId) {
        where.push(`(COALESCE(user_name, "user", '')=? OR COALESCE(delegated_to, '')=?)`);
        params.push(effectiveUser, effectiveUser);
      }

      if (generalCaseId) {
        where.push('COALESCE(general_case_id, 0)=?');
        params.push(generalCaseId);
      }

      if (requestedScope === 'work') {
        where.push(`COALESCE(event_scope, 'work')<>'personal'`);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = await all(dbPath, `
        SELECT
          id,
          COALESCE(date_str, "date", '') AS date_str,
          COALESCE("date", date_str, '') AS "date",
          COALESCE(end_date, '') AS end_date,
          COALESCE(user_name, "user", '') AS user_name,
          COALESCE("user", user_name, '') AS "user",
          COALESCE(task_type, "type", '') AS task_type,
          COALESCE("type", task_type, '') AS "type",
          COALESCE(event_scope, 'work') AS event_scope,
          COALESCE(personal_kind, '') AS personal_kind,
          COALESCE(description, "desc", '') AS description,
          COALESCE("desc", description, '') AS "desc",
          COALESCE(time_val, "time", '') AS time_val,
          COALESCE("time", time_val, '') AS "time",
          COALESCE(end_time, '') AS end_time,
          court,
          subject,
          assignment,
          COALESCE(note_text, '') AS note_text,
          COALESCE(private_note, '') AS private_note,
          COALESCE(metadata_json, '{}') AS metadata_json,
          COALESCE(delegated_to, '') AS delegated_to,
          COALESCE(delegated_by, '') AS delegated_by,
          COALESCE(delegation_status, '') AS delegation_status,
          delegation_source_event_id,
          COALESCE(conflict_override, 0) AS conflict_override,
          COALESCE(done, 0) AS done,
          meeting_id,
          general_case_id,
          created_at,
          updated_at
        FROM calendar_tasks
        ${whereSql}
        ORDER BY COALESCE(date_str, "date", '') ASC, COALESCE(time_val, "time", '') ASC, id ASC
        LIMIT 5000
      `, params);

      sendJson(res, 200, rows.map(row => maskCalendarTaskForViewer(row, session)));
      return true;
    }

    if (path === '/api/calendar-tasks' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      const d = normCalendarTask(await readBody(req));
      d.user = session.full_name;
      if (d.general_case_id) {
        const linkedCase = await get(dbPath, 'SELECT id FROM general_cases WHERE id=? LIMIT 1', [d.general_case_id]);
        if (!linkedCase) {
          sendJson(res, 400, { error: 'general_case_not_found' });
          return true;
        }
      }
      const now = new Date().toISOString();
      const result = await run(dbPath, `
        INSERT INTO calendar_tasks (
          date_str, "date", end_date, user_name, "user", task_type, "type", event_scope, personal_kind,
          description, "desc", time_val, "time", end_time, court, subject, assignment, note_text, private_note, metadata_json,
          delegated_to, delegated_by, delegation_status, delegation_source_event_id, conflict_override, done, meeting_id, general_case_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        d.date, d.date, d.end_date, d.user, d.user, d.type, d.type, d.event_scope, d.personal_kind,
        d.desc, d.desc, d.time, d.time, d.end_time, d.court, d.subject, d.assignment, d.note_text, d.private_note, d.metadata_json,
        d.delegated_to, d.delegated_by, d.delegation_status, d.delegation_source_event_id, d.conflict_override, d.done, d.meeting_id, d.general_case_id,
        now, now
      ]);

      sendJson(res, 201, await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [result.id]));
      return true;
    }

    if (path === '/api/calendar-tasks/delegate' && req.method === 'POST') {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
      const delegatedTo = String(body.delegated_to || '').trim();
      const sourceEventId = Number(body.source_event_id || 0);
      if (!sourceEventId) {
        sendJson(res, 400, { error: 'source_event_required' });
        return true;
      }
      const sourceEvent = await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [sourceEventId]);
      if (!canEditCalendarTask(session, sourceEvent)) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }
      await run(dbPath, `UPDATE calendar_tasks SET delegated_to='', delegated_by='', delegation_status='', delegation_source_event_id=NULL, updated_at=? WHERE delegation_source_event_id=?`, [new Date().toISOString(), sourceEventId]);
      let changed = 0;
      if (delegatedTo) {
        for (const id of ids) {
          const row = await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [id]);
          if (!canEditCalendarTask(session, row)) continue;
          const result = await run(dbPath, `UPDATE calendar_tasks SET delegated_to=?, delegated_by=?, delegation_status='active', delegation_source_event_id=?, updated_at=? WHERE id=?`, [delegatedTo, session.full_name, sourceEventId, new Date().toISOString(), id]);
          changed += Number(result.changes || 0);
        }
      }
      sendJson(res, 200, { ok: true, changed });
      return true;
    }

    const calendarTaskMatch = path.match(/^\/api\/calendar-tasks\/(\d+)$/);
    if (calendarTaskMatch) {
      const session = await getRequestSession(req, dbPath);
      if (!session) {
        sendJson(res, 401, { error: 'auth_required' });
        return true;
      }
      const id = Number(calendarTaskMatch[1]);
      const existing = await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [id]);
      if (!existing) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      if (!canEditCalendarTask(session, existing)) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }

      if (req.method === 'PUT') {
        const d = normCalendarTask(await readBody(req));
        d.user = existing.user_name || existing.user || session.full_name;
        if (d.general_case_id) {
          const linkedCase = await get(dbPath, 'SELECT id FROM general_cases WHERE id=? LIMIT 1', [d.general_case_id]);
          if (!linkedCase) {
            sendJson(res, 400, { error: 'general_case_not_found' });
            return true;
          }
        }
        await run(dbPath, `
          UPDATE calendar_tasks
          SET date_str=?, "date"=?, end_date=?, user_name=?, "user"=?, task_type=?, "type"=?, event_scope=?, personal_kind=?,
              description=?, "desc"=?, time_val=?, "time"=?, end_time=?, court=?, subject=?, assignment=?, note_text=?, private_note=?, metadata_json=?,
              delegated_to=?, delegated_by=?, delegation_status=?, delegation_source_event_id=?, conflict_override=?, done=?, meeting_id=?, general_case_id=?, updated_at=?
          WHERE id=?
        `, [
          d.date, d.date, d.end_date, d.user, d.user, d.type, d.type, d.event_scope, d.personal_kind,
          d.desc, d.desc, d.time, d.time, d.end_time, d.court, d.subject, d.assignment, d.note_text, d.private_note, d.metadata_json,
          d.delegated_to, d.delegated_by, d.delegation_status, d.delegation_source_event_id, d.conflict_override, d.done, d.meeting_id, d.general_case_id,
          new Date().toISOString(), id
        ]);

        sendJson(res, 200, await get(dbPath, 'SELECT * FROM calendar_tasks WHERE id=?', [id]));
        return true;
      }

      if (req.method === 'DELETE') {
        if (String(existing.event_scope || '') === 'personal') {
          await run(dbPath, `UPDATE calendar_tasks SET delegated_to='', delegated_by='', delegation_status='', delegation_source_event_id=NULL, updated_at=? WHERE delegation_source_event_id=?`, [new Date().toISOString(), id]);
        }
        await run(dbPath, 'DELETE FROM calendar_tasks WHERE id=?', [id]);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    return false;
  } catch (err) {
    if (res.headersSent || res.writableEnded || res.destroyed) return true;
    if (err?.code === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'payload_too_large', message: err.message, max_bytes: err.maxBytes || DEFAULT_JSON_BODY_LIMIT });
      return true;
    }
    if (err?.code === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'invalid_json', message: err.message });
      return true;
    }
    if (err?.code === 'INVALID_PERMISSION') {
      sendJson(res, 400, { error: 'invalid_permission', permission: err.permission || '' });
      return true;
    }
    if (err?.code === 'REPORT_SCOPE_FORBIDDEN' || err?.code === 'REPORT_FORBIDDEN') {
      sendJson(res, 403, { error: 'forbidden', message: err.message });
      return true;
    }
    if (err?.code === 'REPORT_NOT_FOUND') {
      sendJson(res, 404, { error: 'report_not_found', message: err.message });
      return true;
    }
    if (err?.code === 'REPORT_USER_REQUIRED' || err?.code === 'REPORT_EMPTY_FILE') {
      sendJson(res, 400, { error: err.code.toLowerCase(), message: err.message });
      return true;
    }
    if (err?.code === 'REPORT_UNSUPPORTED_TYPE') {
      sendJson(res, 415, { error: 'unsupported_file_type', allowed: ['pdf', 'doc', 'docx', 'xls', 'xlsx'], message: err.message });
      return true;
    }
    if (err?.code === 'REPORT_FILE_TOO_LARGE') {
      sendJson(res, 413, { error: 'file_too_large', max_mb: 100, message: err.message });
      return true;
    }
    console.error(err);
    sendJson(res, 500, { error: 'server_error', message: err?.message || 'Внутренняя ошибка сервера' });
    return true;
  }
}

module.exports = { ensureSchema, handleApiRequest };
