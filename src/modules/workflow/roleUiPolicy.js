import { getAuthSession } from '../../auth/session.js';
import { hasPermission, PERMISSIONS } from '../../core/permissions.js';

let initialized = false;

export function initRoleUiPolicy() {
  if (initialized) return;
  initialized = true;

  const apply = () => {
    const roleLevel = Number(getAuthSession()?.role_level || 0);
    const participant = roleLevel === 1;
    const canCreateAssignments = roleLevel >= 3
      || hasPermission(PERMISSIONS.TECH_ADMIN_ASSIGN);

    document.querySelectorAll('#cases [data-general-new], #cases [data-general-add], #cases .general-case-add-button').forEach(button => {
      button.hidden = participant;
      button.disabled = participant;
    });

    document.querySelectorAll('[data-calendar-open-assignment]').forEach(button => {
      button.hidden = !canCreateAssignments;
      button.disabled = !canCreateAssignments;
    });

    const day = document.querySelector('#reports [data-reports-mode][value="day"]');
    const dayLabel = day?.closest('label');
    if (dayLabel) dayLabel.hidden = participant;

    if (participant) {
      const quarter = document.querySelector('#reports [data-reports-mode][value="quarter"]');
      if (quarter && !quarter.checked) {
        quarter.checked = true;
        quarter.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  apply();
  window.addEventListener('app:view-changed', apply);
  window.addEventListener('general-cases:updated', apply);
  window.addEventListener('reports:reload', apply);
}
