import { getAuthSession } from '../../auth/session.js';

let initialized = false;

export function initRoleUiPolicy() {
  if (initialized) return;
  initialized = true;

  const apply = () => {
    const participant = Number(getAuthSession()?.role_level || 0) === 1;

    document.querySelectorAll('#cases [data-general-new], #cases [data-general-add], #cases .general-case-add-button').forEach(button => {
      button.hidden = participant;
      button.disabled = participant;
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
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}
