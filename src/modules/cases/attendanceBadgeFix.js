let initialized = false;

const STATUS_LABELS = [
  'явочное дело',
  'контрольное дело',
  'отзыв показать',
  'аварийный фонд',
  'выморочка',
  'выморочное дело',
  'иск прокурора'
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

function isCaseStatusControl(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (!node.closest('#cases')) return false;
  const text = normalizeText(node.textContent);
  const hasKnownLabel = STATUS_LABELS.some(label => text.includes(label));
  const hasCheckbox = Boolean(node.querySelector('input[type="checkbox"]'));
  return hasKnownLabel && (hasCheckbox || node.matches('button, .case-badge, [role="button"]'));
}

function cleanCaseStatusControl(node) {
  if (!isCaseStatusControl(node)) return;
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

function refreshCaseStatusControls(root = document) {
  const candidates = new Set();
  root.querySelectorAll?.('#cases label, #cases button, #cases .case-badge, #cases [role="button"]').forEach(node => {
    if (isCaseStatusControl(node)) candidates.add(node);
  });
  candidates.forEach(cleanCaseStatusControl);
}

export function initAttendanceBadgeFix() {
  if (initialized) return;
  initialized = true;

  refreshCaseStatusControls();
  window.addEventListener('general-cases:updated', () => requestAnimationFrame(() => refreshCaseStatusControls()));
  window.addEventListener('general-cases:reload', () => setTimeout(() => refreshCaseStatusControls(), 80));
  document.addEventListener('click', () => setTimeout(() => refreshCaseStatusControls(), 40), true);
  document.addEventListener('change', event => {
    if (event.target.closest?.('#cases')) setTimeout(() => refreshCaseStatusControls(), 20);
  }, true);
}
