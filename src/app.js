import './styles/user-requested-enhancements.css';
import './styles/latest-user-requirements.css';
import { renderAppLayout } from './layout/appLayout.js';
import { initRouter } from './core/router.js';
import { initDashboard } from './dashboard/dashboard.js';
import { initAuthGate, initAuthUi } from './auth/authController.js';
import { initSidebarCollapse } from './layout/sidebarCollapse.js';
import { initThemeUi } from './core/theme.js';

export function initApp() {
  initAuthGate(session => {
    const root = document.querySelector('#app');
    root.innerHTML = renderAppLayout(session);

    // Безопасная загрузка: сначала запускается только оболочка приложения.
    // Ранее один из дополнительных модулей входил в бесконечный синхронный цикл
    // сразу после авторизации и полностью блокировал вкладку браузера.
    runSafeInitializer('auth-ui', initAuthUi);
    runSafeInitializer('theme-ui', initThemeUi);
    runSafeInitializer('sidebar', initSidebarCollapse);
    runSafeInitializer('router', initRouter);
    runSafeInitializer('dashboard', initDashboard);

    root.dataset.appBootState = 'ready';
    window.dispatchEvent(new CustomEvent('app:boot-ready', { detail: { session } }));
  });
}

function runSafeInitializer(name, initializer) {
  try {
    initializer();
  } catch (error) {
    console.error(`[app boot] ${name} failed`, error);
  }
}
