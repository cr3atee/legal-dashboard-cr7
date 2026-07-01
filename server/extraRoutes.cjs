const cancellation = require('./generalCaseCancellationRoute.cjs');
const numbering = require('./generalCaseNumberRoute.cjs');

async function ensureExtraSchema(dbPath) {
  await numbering.ensureGeneralCaseNumberSchema(dbPath);
  await cancellation.ensureGeneralCaseCancellationSchema(dbPath);
}

async function handleExtraRoutes(req, res, url, dbPath) {
  if (await cancellation.handleGeneralCaseCancellation(req, res, url, dbPath)) return true;
  if (await numbering.handleGeneralCaseNumber(req, res, url, dbPath)) return true;
  return false;
}

module.exports = { ensureExtraSchema, handleExtraRoutes };
