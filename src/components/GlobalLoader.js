import { subscribeGlobalLoading } from '../core/loadingManager.js';

let initialized = false;

export function initGlobalLoader() {
  if (initialized) return;
  initialized = true;

  const overlay = document.createElement('div');
  overlay.className = 'global-loader-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-busy', 'false');
  overlay.innerHTML = `
    <div class="global-loader-card">
      <div class="global-loader-sphere" aria-hidden="true">
        <span class="global-loader-orbit"></span>
      </div>
      <div class="global-loader-text" data-global-loader-text>Загрузка...</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const label = overlay.querySelector('[data-global-loader-text]');
  subscribeGlobalLoading(state => {
    overlay.classList.toggle('is-visible', state.visible);
    overlay.setAttribute('aria-busy', state.active ? 'true' : 'false');
    document.documentElement.classList.toggle('global-loader-active', state.active);
    document.documentElement.classList.toggle('global-loader-visible', state.visible);
    if (label) label.textContent = state.message || 'Загрузка...';
  });
}
