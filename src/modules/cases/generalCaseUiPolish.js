export function initGeneralCaseUiPolish() {
  const names = new Set(['control_flag', 'attendance_flag', 'review_show_flag', 'emergency_fund_flag', 'registry_flag', 'prosecutor_claim_flag']);
  const scan = () => {
    document.querySelectorAll('[data-general-form] input[type="checkbox"]').forEach(input => {
      if (!names.has(String(input.name || ''))) return;
      input.classList.add('general-case-mark-checkbox');
      const label = input.closest('label');
      if (label) {
        label.classList.add('general-case-mark-option');
        label.classList.toggle('is-checked', input.checked);
      }
    });
  };
  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !names.has(String(input.name || ''))) return;
    input.closest('label')?.classList.toggle('is-checked', input.checked);
  });
  document.addEventListener('click', () => setTimeout(scan, 0));
  scan();
}
