export function initDomCollectionCompat() {
  const prototype = globalThis.HTMLOptionsCollection?.prototype;
  if (!prototype || typeof prototype.map === 'function') return;
  Object.defineProperty(prototype, 'map', {
    configurable: true,
    value: Array.prototype.map
  });
}
