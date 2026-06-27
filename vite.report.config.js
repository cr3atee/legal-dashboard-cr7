import baseConfig from './vite.config.js';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

const extendedApiPlugin = {
  name: 'extended-local-api',
  configureServer(server) {
    const api = require('./server/apiRouter.cjs');
    const dbPath = path.resolve(process.cwd(), 'data/app.db');
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      try {
        await api.ensureSchema(dbPath);
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (!await api.handleApiRequest(req, res, url, dbPath)) next();
      } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        if (!res.writableEnded) res.end(JSON.stringify({ error: 'local_api_error' }));
      }
    });
  }
};

export default {
  ...baseConfig,
  plugins: [extendedApiPlugin, ...(baseConfig.plugins || [])]
};
