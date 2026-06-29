const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'dist');
const output = path.join(__dirname, 'domain-package');

if (!fs.existsSync(source)) {
  throw new Error('Папка dist не найдена. Сначала выполните npm run build.');
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, path.join(output, 'public'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'server.cjs'), path.join(output, 'server.cjs'));

fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({
  name: 'standalone-legal-map',
  version: '1.0.0',
  private: true,
  scripts: { start: 'node server.cjs' }
}, null, 2));

fs.writeFileSync(path.join(output, 'START_WINDOWS.bat'), '@echo off\r\nset PORT=8080\r\nnode server.cjs\r\npause\r\n');
fs.writeFileSync(path.join(output, 'START_LINUX.sh'), '#!/usr/bin/env sh\nPORT=${PORT:-8080} node server.cjs\n');
fs.copyFileSync(path.join(__dirname, 'DEPLOY.md'), path.join(output, 'DEPLOY.md'));

console.log('Готовый комплект создан:');
console.log(output);
