let initialized = false;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

function isAttendanceControl(node) {
  if (!(node instanceof HTMLElement)) return false;
  const text = normalizeText(node.textContent);
  if (!text.includes('явочное дело')) return false;
  return Boolean(
    node.matches('label, button, .case-badge, [role="button"], [data-case-attendance-badge]')
    || node.querySelector('input[type="checkbox"]')
  );
}

function cleanAttendanceControl(node) {
  if (!isAttendanceControl(node)) return;
  node.classList.add('single-attendance-control');

  node.querySelectorAll('[data-single-attendance-icon]').forEach((icon, index) => {
    if (index > 0) icon.remove();
  });

  node.querySelectorAll('svg, i, .icon, .checkbox-icon, .check-icon, .checkmark').forEach(icon => {
    if (!icon.hasAttribute('data-single-attendance-icon')) icon.remove();
  });

  let icon = node.querySelector('[data-single-attendance-icon]');
  if (!icon) {
    icon = document.createElement('span');
    icon.dataset.singleAttendanceIcon = '1';
    icon.className = 'single-attendance-icon';
    icon.setAttribute('aria-hidden', 'true');
    node.insertBefore(icon, node.firstChild);
  }
}

function refreshAttendanceControls(root = document) {
  const candidates = new Set();
  root.querySelectorAll?.('label, button, .case-badge, [role="button"], [data-case-attendance-badge]').forEach(node => {
    if (isAttendanceControl(node)) candidates.add(node);
  });
  candidates.forEach(cleanAttendanceControl);
}

export function initAttendanceBadgeFix() {
  if (initialized) return;
  initialized = true;

  refreshAttendanceControls();
  window.addEventListener('general-cases:updated', () => requestAnimationFrame(() => refreshAttendanceControls()));
  window.addEventListener('general-cases:reload', () => setTimeout(() => refreshAttendanceControls(), 80));
  document.addEventListener('click', () => setTimeout(() => refreshAttendanceControls(), 40), true);
}
