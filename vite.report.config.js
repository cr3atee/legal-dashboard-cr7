import baseConfig from './vite.config.js';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

const extendedApiPlugin = {
  name: 'extended-local-api',
  configureServer(server) {
    const api = require('./server/apiRouter.cjs');
    const dbPath = path.resolve(process.cwd(), 'data/app.db');
    let schemaReady = null;

    const ensureSchemaOnce = () => {
      if (!schemaReady) {
        schemaReady = api.ensureSchema(dbPath).catch(error => {
          console.error('[local-api] schema initialization failed:', error);
          schemaReady = null;
          throw error;
        });
      }
      return schemaReady;
    };

    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const isAuthRequest = url.pathname === '/api/auth/login'
          || url.pathname === '/api/auth/me'
          || url.pathname === '/api/auth/logout'
          || url.pathname === '/api/health';

        // Не запускаем полную миграцию базы при старте Vite и до входа.
        // Иначе она захватывает SQLite и даже быстрый auth-обработчик ждёт блокировку.
        if (!isAuthRequest) await ensureSchemaOnce();

        if (!await api.handleApiRequest(req, res, url, dbPath)) next();
      } catch (error) {
        console.error('[local-api] request failed:', error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        if (!res.writableEnded) res.end(JSON.stringify({ error: 'local_api_error', message: error?.message || '' }));
      }
    });
  }
};

export default {
  ...baseConfig,
  plugins: [extendedApiPlugin, ...(baseConfig.plugins || [])]
};
