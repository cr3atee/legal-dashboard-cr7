const BLOCKED_STORAGE_KEYS = new Set([
  "custom-gis-map-v43",
]);

for (const key of BLOCKED_STORAGE_KEYS) {
  try { window.localStorage.removeItem(key); } catch {}
  try { window.sessionStorage.removeItem(key); } catch {}
}

function blockPersistence(storage) {
  if (!storage) return;
  const originalSetItem = storage.setItem.bind(storage);
  const originalRemoveItem = storage.removeItem.bind(storage);

  storage.setItem = (key, value) => {
    if (BLOCKED_STORAGE_KEYS.has(String(key))) return;
    return originalSetItem(key, value);
  };

  storage.removeItem = key => originalRemoveItem(key);
}

try { blockPersistence(window.localStorage); } catch {}
try { blockPersistence(window.sessionStorage); } catch {}

window.addEventListener("beforeunload", () => {
  for (const key of BLOCKED_STORAGE_KEYS) {
    try { window.localStorage.removeItem(key); } catch {}
    try { window.sessionStorage.removeItem(key); } catch {}
  }
});
