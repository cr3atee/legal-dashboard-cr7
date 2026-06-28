import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

let initialized = false;
let observer = null;

export function initParticipantCaseCreateGuard() {
  if (initialized) return;
  initialized = true;

  const originalCreateGeneralCase = dbApi.createGeneralCase.bind(dbApi);

  dbApi.createGeneralCase = async data => {
    if (!canCurrentUserCreateCase()) {
      const error = new Error('Участник не может добавлять новые дела в общий перечень.');
      error.code = 'GENERAL_CASE_CREATE_FORBIDDEN';
      throw error;
    }

    return originalCreateGeneralCase(data);
  };

  applyCreateButtonPolicy();

  observer = new MutationObserver(() => applyCreateButtonPolicy());
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'disabled'] });

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-general-new]');
    if (!trigger || canCurrentUserCreateCase()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);
}

function applyCreateButtonPolicy() {
  const button = document.querySelector('[data-general-new]');
  if (!button) return;

  const allowed = canCurrentUserCreateCase();

  if (!allowed) {
    button.removeAttribute('onclick');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('hidden', '');
    button.style.setProperty('display', 'none', 'important');
    button.classList.add('is-disabled');
    return;
  }

  button.disabled = false;
  button.removeAttribute('aria-disabled');
  button.removeAttribute('hidden');
  button.style.removeProperty('display');
  button.classList.remove('is-disabled');
}

function canCurrentUserCreateCase() {
  const session = getAuthSession() || {};
  const roleLevel = Number(session.role_level || 1);
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  return roleLevel >= 2 || permissions.includes('cases.editAny') || permissions.includes('cases.create');
}
