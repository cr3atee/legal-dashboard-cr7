import { dbApi } from '../api/dbApi.js';
import { getAuthSession, setAuthSession, clearAuthSession } from './session.js';
import { initLoginParticleVisual } from './loginParticleVisualCycle.js';

const APP_DISPLAY_NAME = 'ЮрСфера';
const APP_SYSTEM_LABEL = 'Правовая система';

export function initAuthGate(onAuthenticated) {
  const existing = getAuthSession();

  if (existing?.full_name && existing?.token) {
    refreshExistingSession(existing, onAuthenticated);
    return;
  }

  if (existing) clearAuthSession();
  renderLoginScreen(onAuthenticated);
}

async function refreshExistingSession(existing, onAuthenticated) {
  try {
    const session = await dbApi.getCurrentSession();
    const refreshed = { ...session, token: session.token || existing.token };
    setAuthSession(refreshed);
    window.legalDashboardSession = refreshed;
    onAuthenticated(refreshed);
  } catch {
    clearAuthSession();
    renderLoginScreen(onAuthenticated);
  }
}

function renderLoginScreen(onAuthenticated) {
  const root = document.querySelector('#app');
  document.title = APP_DISPLAY_NAME;

  root.innerHTML = `
    <main class="login-screen">
      <section class="login-visual" data-login-visual-label="${APP_DISPLAY_NAME}" aria-label="Интерактивная цифровая фигура">
        <canvas class="login-visual-canvas" data-login-particle-canvas tabindex="0" aria-label="Интерактивная сфера защиты"></canvas>
        <div class="login-visual-fallback" data-login-particle-fallback aria-hidden="true" hidden></div>
      </section>

      <section class="login-card" data-login-card data-state="idle" aria-labelledby="login-title">
        <div class="login-brand">
          <span class="login-brand-mark" aria-hidden="true"></span>
          ${APP_SYSTEM_LABEL}
        </div>

        <div class="login-logo" data-login-lock aria-hidden="true">
          <svg class="login-lock-icon" viewBox="0 0 64 64" focusable="false" aria-hidden="true">
            <path class="login-lock-shield" d="M32 5.5 52 13.8v15.5c0 13.1-8.2 24.2-20 29.2-11.8-5-20-16.1-20-29.2V13.8L32 5.5Z" />
            <path class="login-lock-shackle" d="M23.5 29v-5.2a8.5 8.5 0 0 1 17 0V29" />
            <rect class="login-lock-body" x="20.5" y="27.5" width="23" height="19" rx="6.5" />
            <circle class="login-lock-keyhole" cx="32" cy="36" r="2.8" />
            <path class="login-lock-key-stem" d="M32 38.5v3.8" />
          </svg>
        </div>

        <h1 id="login-title">${APP_DISPLAY_NAME}</h1>
        <p>Введите пароль для входа в систему</p>

        <form class="login-form" data-login-form>
          <label>
            <span>Пароль</span>
            <span class="login-input-wrap">
              <input type="password" name="password" autocomplete="current-password" autofocus aria-describedby="loginStatus">
              <button class="login-password-toggle" data-login-password-toggle type="button" aria-label="Показать пароль" aria-pressed="false">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                  <circle cx="12" cy="12" r="2.7" />
                </svg>
              </button>
            </span>
          </label>

          <div class="login-error" id="loginStatus" data-login-error role="status" aria-live="polite" hidden></div>
          <button class="btn primary login-submit" type="submit">Войти</button>
        </form>
      </section>
    </main>
  `;

  const form = root.querySelector('[data-login-form]');
  const errorNode = root.querySelector('[data-login-error]');
  const card = root.querySelector('[data-login-card]');
  const lock = root.querySelector('[data-login-lock]');
  const passwordToggle = root.querySelector('[data-login-password-toggle]');
  let visual = initLoginParticleVisual(root.querySelector('.login-visual'));
  const input = form.elements.password;
  input.focus();

  input.addEventListener('input', () => {
    if (card?.dataset.state === 'error') {
      setLoginState(card, errorNode, lock, visual, 'typing');
    } else if (card?.dataset.state !== 'checking') {
      visual.setState(input.value.trim() ? 'typing' : 'idle');
    }
  });

  input.addEventListener('focus', () => {
    if (card?.dataset.state === 'idle') visual.setState('typing');
  });

  passwordToggle?.addEventListener('click', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    passwordToggle.setAttribute('aria-pressed', String(!visible));
    passwordToggle.setAttribute('aria-label', visible ? 'Показать пароль' : 'Скрыть пароль');
    passwordToggle.classList.toggle('is-visible', !visible);
    input.focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const password = input.value.trim();
    if (!password) {
      setLoginState(card, errorNode, lock, visual, 'error', 'Введите пароль.');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Проверка...';

    // Критично: останавливаем тяжёлый canvas-рендер ДО запроса авторизации.
    // Именно он блокировал главный поток браузера и вызывал «страница не отвечает».
    try { visual.destroy(); } catch {}
    visual = createNoopVisual();
    root.querySelector('[data-login-particle-canvas]')?.setAttribute('hidden', '');
    setLoginState(card, errorNode, lock, visual, 'checking', 'Выполняется проверка доступа.');

    // Даём браузеру отрисовать новое состояние до сетевого запроса.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));

    let session;
    try {
      session = await Promise.race([
        dbApi.login(password),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Превышено время ожидания ответа сервера.')), 15000))
      ]);
    } catch (error) {
      console.error('Login request failed:', error);
      setLoginState(card, errorNode, lock, visual, 'error', error?.message || 'Неверный пароль.');
      input.select();
      button.disabled = false;
      button.textContent = 'Войти';
      return;
    }

    setLoginState(card, errorNode, lock, visual, 'success', 'Доступ подтверждён.');
    setAuthSession(session);
    window.legalDashboardSession = session;

    try {
      onAuthenticated(session);
    } catch (error) {
      console.error('Application initialization failed after login:', error);
      root.innerHTML = `
        <main class="login-screen">
          <section class="login-card" data-state="error">
            <h1>Ошибка запуска системы</h1>
            <p class="login-error" role="alert">${escapeHtml(error?.message || 'Не удалось открыть главный экран.')}</p>
            <button class="btn primary" type="button" data-login-reload>Перезагрузить страницу</button>
          </section>
        </main>
      `;
      root.querySelector('[data-login-reload]')?.addEventListener('click', () => window.location.reload());
    }
  });
}

export function initAuthUi() {
  if (!window.__topbarProfileDropdownInitialized) {
    window.__topbarProfileDropdownInitialized = true;

    document.addEventListener('click', event => {
      const profileCard = event.target.closest('[data-profile-menu-toggle]');
      const isMenuClick = Boolean(event.target.closest('.topbar-profile-dropdown'));

      if (profileCard && !isMenuClick) {
        const shouldOpen = !profileCard.classList.contains('is-open');
        closeTopbarProfileDropdown();
        setTopbarProfileDropdown(profileCard, shouldOpen);
        return;
      }

      if (!profileCard) closeTopbarProfileDropdown();
    });

    document.addEventListener('keydown', event => {
      const profileCard = event.target.closest('[data-profile-menu-toggle]');
      const isMenuClick = Boolean(event.target.closest('.topbar-profile-dropdown'));

      if ((event.key === 'Enter' || event.key === ' ') && profileCard && !isMenuClick) {
        event.preventDefault();
        const shouldOpen = !profileCard.classList.contains('is-open');
        closeTopbarProfileDropdown();
        setTopbarProfileDropdown(profileCard, shouldOpen);
        return;
      }

      if (event.key === 'Escape') closeTopbarProfileDropdown();
    });

    window.addEventListener('app:view-changed', closeTopbarProfileDropdown);
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-auth-logout]')) {
      try { await dbApi.logout(); } catch {}
      clearAuthSession();
      window.location.reload();
    }
  });
}

function closeTopbarProfileDropdown() {
  document.querySelectorAll('.topbar-profile-card').forEach(card => {
    setTopbarProfileDropdown(card, false);
    if (card instanceof HTMLElement) card.blur();
  });
}

function setTopbarProfileDropdown(card, isOpen) {
  if (!(card instanceof HTMLElement)) return;
  card.classList.toggle('is-open', isOpen);
  card.setAttribute('aria-expanded', String(isOpen));
}

function setLoginState(card, errorNode, lock, visual, state, message = '') {
  if (card) card.dataset.state = state;
  if (lock) lock.hidden = state === 'success';

  if (errorNode) {
    errorNode.textContent = message;
    errorNode.hidden = !message;
    errorNode.dataset.type = state === 'success' ? 'success' : state === 'error' ? 'error' : 'info';
  }

  if (state !== 'success') visual.setState(state);
}

function createNoopVisual() {
  return {
    setState() { return Promise.resolve(); },
    showSuccessText() { return Promise.resolve(); },
    destroy() {}
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
