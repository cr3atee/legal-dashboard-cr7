let initialized = false;
let pendingHearing = null;

export function initReportAndAdminNavigation() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', event => {
    const hearing = event.target.closest('.reports-hearing-chip');
    if (hearing) {
      event.preventDefault();
      openReportHearingInSchedule(hearing);
      return;
    }

    const editButton = event.target.closest('[data-admin-user-edit]');
    if (editButton) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const form = document.querySelector('[data-admin-user-form]');
          if (!form) return;
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const firstField = form.querySelector('input:not([type="hidden"]), select, textarea');
          setTimeout(() => firstField?.focus({ preventScroll: true }), 350);
        });
      });
    }
  }, true);

  window.addEventListener('schedule:updated', tryOpenPendingHearing);
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'schedule' && pendingHearing) {
      setTimeout(tryOpenPendingHearing, 120);
    }
  });
}

function openReportHearingInSchedule(chip) {
  const card = chip.closest('.reports-employee-card');
  const details = chip.querySelector('small')?.textContent || '';
  const [subject = '', caseNumber = ''] = details.split('·').map(value => value.trim());

  pendingHearing = {
    time: normalize(chip.querySelector('b')?.textContent),
    court: normalize(chip.querySelector('span')?.textContent),
    subject: normalize(subject),
    caseNumber: normalize(caseNumber),
    employee: normalize(card?.querySelector('h4')?.textContent),
    createdAt: Date.now(),
  };

  document.querySelector('[data-view="schedule"]')?.click();
  setTimeout(tryOpenPendingHearing, 180);
}

function tryOpenPendingHearing() {
  if (!pendingHearing) return;
  if (Date.now() - pendingHearing.createdAt > 5000) {
    pendingHearing = null;
    return;
  }

  const rows = [...document.querySelectorAll('[data-schedule-row][data-schedule-type="case"]')];
  if (!rows.length) {
    setTimeout(tryOpenPendingHearing, 180);
    return;
  }

  const match = rows.find(row => {
    const text = normalize(row.textContent);
    const checks = [
      pendingHearing.time,
      pendingHearing.court,
      pendingHearing.caseNumber,
      pendingHearing.subject,
      pendingHearing.employee,
    ].filter(Boolean);
    const strongChecks = checks.filter(value => value.length >= 3);
    return strongChecks.length && strongChecks.every(value => text.includes(value));
  }) || rows.find(row => {
    const text = normalize(row.textContent);
    return Boolean(
      pendingHearing.time
      && pendingHearing.court
      && text.includes(pendingHearing.time)
      && text.includes(pendingHearing.court)
    );
  });

  if (!match) {
    setTimeout(tryOpenPendingHearing, 180);
    return;
  }

  pendingHearing = null;
  match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => match.click(), 280);
}

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}
