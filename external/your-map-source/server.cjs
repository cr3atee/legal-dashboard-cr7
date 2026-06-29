const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const port = Number(process.env.PORT || 8080);
const publicRoot = path.join(__dirname, 'public');
const distRoot = path.join(__dirname, 'dist');
const packagedPublicIndex = path.join(publicRoot, 'index.html');
const distIndex = path.join(distRoot, 'index.html');
const root = fs.existsSync(distIndex)
  ? distRoot
  : (fs.existsSync(packagedPublicIndex) ? publicRoot : distRoot);

const proxies = [
  { prefix: '/nspd', target: 'https://nspd.gov.ru' },
  { prefix: '/fg', target: 'https://fg.avto-spory.ru' },
  { prefix: '/pkkros', target: 'https://pkk.rosreestr.ru' },
  { prefix: '/pkk', target: 'https://pkk5.rosreestr.ru' },
  { prefix: '/nominatim', target: 'https://nominatim.openstreetmap.org' },
];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname || '/');
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.join(root, pathname.replace(/^\/+/, ''));
  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (error, stat) => {
    if (!error && stat.isFile()) {
      res.writeHead(200, {
        'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const indexPath = path.join(root, 'index.html');
    if (path.extname(pathname)) return send(res, 404, 'File not found');
    fs.createReadStream(indexPath)
      .on('error', () => send(res, 404, 'Build not found. Run npm run build.'))
      .pipe(res);
  });
}

function proxyRequest(req, res, url, proxy) {
  const target = new URL(proxy.target);
  const targetPath = (url.pathname.replace(proxy.prefix, '') || '/') + url.search;
  const headers = {
    ...req.headers,
    host: target.host,
    origin: proxy.target,
    referer: proxy.target + '/',
    'user-agent': 'Mozilla/5.0',
    accept: req.headers.accept || 'application/json,image/png,text/plain,*/*',
  };
  delete headers.connection;
  delete headers['content-length'];

  const upstream = https.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 443,
    path: targetPath,
    method: req.method,
    headers,
    rejectUnauthorized: false,
    timeout: 60000,
  }, upstreamRes => {
    const responseHeaders = {
      ...upstreamRes.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': '*',
    };
    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstream.on('timeout', () => upstream.destroy(new Error('Proxy timeout')));
  upstream.on('error', error => send(res, 502, 'Proxy error: ' + error.message));
  req.pipe(upstream);
}

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const proxy = proxies.find(item => url.pathname === item.prefix || url.pathname.startsWith(item.prefix + '/'));
    if (proxy) return proxyRequest(req, res, url, proxy);
    return serveStatic(req, res, url);
  } catch (error) {
    return send(res, 500, error.message || 'Server error');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Standalone map: http://localhost:${port}`);
});
