const Module = require('module');
const originalLoad = Module._load;

Module._load = function loadWithExtendedApi(request, parent, isMain) {
  const fromElectronMain = String(parent?.filename || '').replaceAll('\\', '/').endsWith('/electron/main.cjs');
  if (fromElectronMain && request === '../server/sqliteApi.cjs') {
    return originalLoad.call(this, '../server/apiRouter.cjs', parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

require('./main.cjs');
