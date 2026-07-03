const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 15000);
  return db;
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
  });
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

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > limit) {
        reject(new Error('request_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, '')
    .replace(/[.,;:()\[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCaseNumber(value) {
  return normalizeText(value)
    .replace(/^№\s*/u, '')
    .replace(/[^0-9a-zа-я/\\-]+/giu, '');
}

function subjectMatches(inputValue, storedValue) {
  const input = normalizeText(inputValue);
  const stored = normalizeText(storedValue);
  if (!input || !stored) return false;
  if (input === stored) return true;
  return input.startsWith(`${stored} `)
    || input.startsWith(`${stored},`)
    || input.startsWith(`${stored};`)
    || input.startsWith(`${stored} |`);
}

async function findSimilarGeneralCases(dbPath, criteria = {}) {
  const courtNo = normalizeCaseNumber(criteria.court_no);
  const court = normalizeText(criteria.court);
  const category = normalizeText(criteria.category);
  const subject = normalizeText(criteria.claim_subject);

  if (!courtNo || !court || !category || !subject) return [];

  const db = openDb(dbPath);
  try {
    const rows = await all(db, `
      SELECT id, case_no, court_no, court, category, claim_subject, plaintiff, defendant, executor, registration_date
      FROM general_cases
      ORDER BY id DESC
      LIMIT 5000
    `);

    return rows
      .filter(row => normalizeCaseNumber(row.court_no) === courtNo)
      .filter(row => normalizeText(row.court) === court)
      .filter(row => normalizeText(row.category) === category)
      .filter(row => subjectMatches(criteria.claim_subject, row.claim_subject))
      .slice(0, 10);
  } finally {
    db.close();
  }
}

async function handleSimilarGeneralCases(req, res, url, dbPath) {
  if (req.method !== 'POST' || url.pathname !== '/api/general-cases/similar-check') return false;

  try {
    const body = await readBody(req);
    const items = await findSimilarGeneralCases(dbPath, body);
    sendJson(res, 200, { items });
  } catch (error) {
    sendJson(res, 500, {
      error: 'similar_general_cases_check_failed',
      message: error?.message || 'Не удалось проверить похожие дела'
    });
  }
  return true;
}

module.exports = {
  handleSimilarGeneralCases,
  findSimilarGeneralCases
};
