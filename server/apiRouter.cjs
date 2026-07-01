const core = require('./sqliteApi.cjs');
const { ensureReportMetricsSchema, handleReportMetrics } = require('./reportMetricsRoute.cjs');
const { handleReportMetricsWrite } = require('./reportMetricsWriteRoute.cjs');
const { ensureCaseSuggestionSeeds } = require('./caseSuggestionSeeds.cjs');
const { handleCalendarUsers } = require('./calendarUsersRoute.cjs');
const { ensureGeneralCaseNumberSchema, handleGeneralCaseNumber } = require('./generalCaseNumberRoute.cjs');
const { ensureGeneralCaseCancellationSchema, handleGeneralCaseCancellation } = require('./generalCaseCancellationRoute.cjs');

async function ensureSchema(dbPath) {
  await core.ensureSchema(dbPath);
  await ensureCaseSuggestionSeeds(dbPath);
  await ensureReportMetricsSchema(dbPath);
  await ensureGeneralCaseNumberSchema(dbPath);
  await ensureGeneralCaseCancellationSchema(dbPath);
}

async function handleApiRequest(req, res, url, dbPath) {
  if (await handleGeneralCaseNumber(req, res, url, dbPath)) return true;
  if (await handleGeneralCaseCancellation(req, res, url, dbPath)) return true;
  if (await handleCalendarUsers(req, res, url, dbPath)) return true;
  if (await handleReportMetrics(req, res, url, dbPath)) return true;
  if (await handleReportMetricsWrite(req, res, url, dbPath)) return true;
  return core.handleApiRequest(req, res, url, dbPath);
}

module.exports = { ensureSchema, handleApiRequest };
