import { setSidebarCollapsed } from '../layout/sidebarCollapse.js';
import { initMap, invalidateMapSize } from '../modules/map/mapInit.js';
import { canViewRoute } from './permissions.js';

const TEMPORARILY_HIDDEN_VIEWS = new Set(['map']);

const VIEW_PATHS = {
  dashboard: '/',
  cases: '/cases',
  controlledCases: '/controlled-cases',
  reports: '/reports',
  enforcement: '/enforcement',
  calendar: '/calendar',
  schedule: '/schedule',
  map: '/map',
  emergencyFund: '/emergency-fund',
  municipalRegistry: '/municipal-registry',
  meetings: '/meetings',
  admin: '/admin',
  adminUsers: '/admin/users',
  adminDictionaries: '/admin/dictionaries',
  settings: '/settings',
};

const PATH_VIEWS = Object.fromEntries(Object.entries(VIEW_PATHS).map(([view, route]) => [route, view]));

export function initRouter() {
  document.addEventListener('click', event => {
    const navButton = event.target.closest('[data-view]');
    if (!navButton) return;

    event.preventDefault();
    openView(navButton.dataset.view);
  });

  window.addEventListener('popstate', () => {
    openView(getViewFromLocation(), { updateHistory: false });
  });

  openView(getViewFromLocation(), { updateHistory: false });
}

export function openView(viewId, options = {}) {
  if (TEMPORARILY_HIDDEN_VIEWS.has(viewId) || !canViewRoute(viewId)) {
    const fallbackView = canViewRoute('dashboard') ? 'dashboard' : document.querySelector('.view')?.id;
    if (fallbackView && fallbackView !== viewId) {
      openView(fallbackView, { updateHistory: true, replaceHistory: true });
    }
    window.dispatchEvent(new CustomEvent('app:access-denied', { detail: { viewId } }));
    return;
  }

  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('active', view.id === viewId);
  });

  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === viewId);
  });

  document.body.dataset.currentView = viewId;
  updateBrowserRoute(viewId, options);
  window.dispatchEvent(new CustomEvent('app:view-changed', { detail: { viewId } }));

  setSidebarCollapsed(true);

  if (viewId !== 'dashboard' && typeof window.setDashboardEditMode === 'function') {
    window.setDashboardEditMode(false);
  }

  if (viewId === 'map') {
    setTimeout(() => {
      initMap('legalMap');
      invalidateMapSize();
    }, 80);
  }
}

window.openView = openView;

function getViewFromLocation() {
  const path = normalizePath(window.location.pathname);
  const view = PATH_VIEWS[path] || 'dashboard';
  return TEMPORARILY_HIDDEN_VIEWS.has(view) ? 'dashboard' : view;
}

function normalizePath(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';
  return path;
}

function updateBrowserRoute(viewId, options = {}) {
  if (options.updateHistory === false) return;
  const nextPath = VIEW_PATHS[viewId];
  if (!nextPath || window.location.pathname === nextPath) return;
  const method = options.replaceHistory ? 'replaceState' : 'pushState';
  window.history[method]({ viewId }, '', nextPath);
}
