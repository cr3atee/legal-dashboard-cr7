import baseConfig from './vite.config.js';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

const reportMetricsPlugin = {
  name: 'report-metrics-api',
  configureServer(server) {
    const { handleReportMetrics, ensureReportMetricsSchema } = require('./server/reportMetricsRoute.cjs');
    const { handleReportMetricsWrite } = require('./server/reportMetricsWriteRoute.cjs');
    const dbPath = path.resolve(process.cwd(), 'data/app.db');
    void ensureReportMetricsSchema(dbPath);
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/report-metrics') && !req.url?.startsWith('/api/case-extra-flags') && !req.url?.startsWith('/api/report-metric-events')) return next();
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`);
        if (await handleReportMetrics(req, res, url, dbPath)) return;
        if (await handleReportMetricsWrite(req, res, url, dbPath)) return;
        next();
      } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        if (!res.writableEnded) res.end(JSON.stringify({ error: 'report_metrics_error', message: error?.message || String(error) }));
      }
    });
  }
};

export default {
  ...baseConfig,
  plugins: [reportMetricsPlugin, ...(baseConfig.plugins || [])]
};
