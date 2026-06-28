import { dbApi } from '../../api/dbApi.js';
import { getAuthSession } from '../../auth/session.js';

let initialized = false;

export function initParticipantCaseCreateGuard() {
  if (initialized) return;
  initialized = true;

  const originalCreateGeneralCase = dbApi.createGeneralCase.bind(dbApi);

  dbApi.createGeneralCase = async data => {
    const session = getAuthSession() || {};
    const roleLevel = Number(session.role_level || 1);
    const permissions = Array.isArray(session.permissions) ? session.permissions : [];
    const canCreate = roleLevel >= 2 || permissions.includes('cases.editAny') || permissions.includes('cases.create');

    if (!canCreate) {
      const error = new Error('Участник не может добавлять новые дела в общий перечень.');
      error.code = 'GENERAL_CASE_CREATE_FORBIDDEN';
      throw error;
    }

    return originalCreateGeneralCase(data);
  };

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-general-new], [data-general-add], .general-case-add-button, [data-open-general-case-form="new"]');
    if (!trigger || canCurrentUserCreateCase()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    alert('Участник не может добавлять новые дела в общий перечень.');
  }, true);
}

function canCurrentUserCreateCase() {
  const session = getAuthSession() || {};
  const roleLevel = Number(session.role_level || 1);
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  return roleLevel >= 2 || permissions.includes('cases.editAny') || permissions.includes('cases.create');
}
