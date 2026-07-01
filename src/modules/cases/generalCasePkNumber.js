function requestNumber(callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/general-cases/next-number');
  xhr.onload = () => {
    try {
      const data = JSON.parse(xhr.responseText || '{}');
      callback(xhr.status >= 200 && xhr.status < 300 ? data.case_no || '' : '');
    } catch {
      callback('');
    }
  };
  xhr.onerror = () => callback('');
  xhr.send();
}

function fill(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const input = form.elements?.case_no;
  if (!input) return;
  input.readOnly = true;
  input.classList.add('general-case-pk-number');
  if (Number(form.elements?.id?.value || 0) || input.value.trim()) return;
  if (form.dataset.pkLoading === '1') return;
  form.dataset.pkLoading = '1';
  requestNumber(value => {
    if (value && !input.value.trim()) input.value = value;
    form.dataset.pkLoading = '0';
  });
}

export function initGeneralCasePkNumber() {
  const scan = () => document.querySelectorAll('[data-general-form]').forEach(fill);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-general-new], [data-general-open]')) setTimeout(scan, 50);
  }, true);
  scan();
}
