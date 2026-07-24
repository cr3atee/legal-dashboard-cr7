const MARK_NAMES = new Set([
  'control_flag',
  'attendance_flag',
  'review_show_flag',
  'emergency_fund_flag',
  'registry_flag',
  'prosecutor_claim_flag'
]);

function decorateMark(input) {
  if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
  if (!MARK_NAMES.has(String(input.name || ''))) return;

  input.classList.add('general-case-mark-checkbox');
  input.setAttribute('aria-checked', input.checked ? 'true' : 'false');

  const label = input.closest('label');
  if (label) {
    label.classList.add('general-case-mark-option');
    label.classList.toggle('is-checked', input.checked);
  }
}

function scan() {
  document
    .querySelectorAll('[data-general-form] input[type="checkbox"]')
    .forEach(decorateMark);
}

export function initGeneralCaseUiPolish() {
  if (window.__generalCaseUiPolishInitialized) return;
  window.__generalCaseUiPolishInitialized = true;

  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !MARK_NAMES.has(String(input.name || ''))) return;
    decorateMark(input);
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('[data-general-new], [data-general-open], [data-general-form]')) {
      setTimeout(scan, 0);
      setTimeout(scan, 80);
    }
  }, true);

  window.addEventListener('app:view-changed', scan);
  window.addEventListener('general-cases:updated', scan);
  window.addEventListener('general-cases:open-case', () => setTimeout(scan, 0));
  scan();
}
