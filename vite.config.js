import { defineConfig } from 'vite';
import { createRequire } from 'module';
import { ProxyAgent } from 'proxy-agent';
import path from 'path';

const require = createRequire(import.meta.url);
const CORPORATE_PROXY_URL = process.env.MAP_PROXY_URL || 'http://192.168.227.254:3128';
const corporateProxyAgent = CORPORATE_PROXY_URL ? new ProxyAgent(CORPORATE_PROXY_URL) : undefined;

function safeSetProxyHeader(proxyReq, name, value) {
  try {
    if (!proxyReq.headersSent && typeof proxyReq.setHeader === 'function') {
      proxyReq.setHeader(name, value);
    }
  } catch {
    // In newer Node/Vite versions headers can already be flushed.
    // Ignore instead of crashing dev server with ERR_HTTP_HEADERS_SENT.
  }
}

function setBrowserHeaders(proxy) {
  proxy.on('proxyReq', proxyReq => {
    safeSetProxyHeader(proxyReq, 'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36');
    safeSetProxyHeader(proxyReq, 'Accept', 'application/json,image/png,text/plain,*/*');
    safeSetProxyHeader(proxyReq, 'Accept-Language', 'ru-RU,ru;q=0.9,en;q=0.8');
  });
}

export default defineConfig({
  base: './',
  plugins: [{
    name: 'sqlite-api-dev',
    configureServer(server) {
      const { handleApiRequest, ensureSchema } = require('./server/apiRouter.cjs');
      const dbPath = path.resolve(process.cwd(), 'data/app.db');
      void ensureSchema(dbPath).catch(error => console.error('SQLite schema initialization error', error));
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          await ensureSchema(dbPath);
          const url = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`);
          const handled = await handleApiRequest(req, res, url, dbPath);
          if (!handled) next();
        } catch (error) {
          console.error('SQLite API middleware error', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          }
          if (!res.writableEnded) res.end(JSON.stringify({ error: 'server_error', message: error?.message || 'Ошибка API базы данных' }));
        }
      });
    }
  }],
  server: {
    host: '0.0.0.0', port: 5173, strictPort: true, open: true,
    proxy: {
      '/nspd-api': { target:'https://nspd.gov.ru/api', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/nspd-api/,''), configure:proxy=>{setBrowserHeaders(proxy); proxy.on('proxyReq', r=>{safeSetProxyHeader(r, 'Host', 'nspd.gov.ru'); safeSetProxyHeader(r, 'Referer', 'https://nspd.gov.ru/map'); safeSetProxyHeader(r, 'Origin', 'https://nspd.gov.ru');});}},
      '/nspd': { target:'https://nspd.gov.ru', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/nspd/,''), configure:proxy=>{setBrowserHeaders(proxy); proxy.on('proxyReq', r=>{safeSetProxyHeader(r, 'Host', 'nspd.gov.ru'); safeSetProxyHeader(r, 'Referer', 'https://nspd.gov.ru/map'); safeSetProxyHeader(r, 'Origin', 'https://nspd.gov.ru');});}},
      '/fg': { target:'https://fg.avto-spory.ru', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/fg/,''), configure:proxy=>{setBrowserHeaders(proxy); proxy.on('proxyReq', r=>{safeSetProxyHeader(r, 'Origin', 'https://rosreestor-russia.ru'); safeSetProxyHeader(r, 'Referer', 'https://rosreestor-russia.ru/');});}},
      '/pkkros': { target:'https://pkk.rosreestr.ru', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/pkkros/,'') },
      '/pkk': { target:'https://pkk5.rosreestr.ru', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/pkk/,'') },
      '/nominatim': { target:'https://nominatim.openstreetmap.org', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/nominatim/,'') },
      '/osm-a': { target:'https://a.tile.openstreetmap.org', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/osm-a/,'') },
      '/osm-b': { target:'https://b.tile.openstreetmap.org', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/osm-b/,'') },
      '/osm-c': { target:'https://c.tile.openstreetmap.org', changeOrigin:true, secure:false, agent: corporateProxyAgent, rewrite:p=>p.replace(/^\/osm-c/,'') }
    }
  }
});
