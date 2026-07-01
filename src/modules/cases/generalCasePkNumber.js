function getSessionToken() {
  try {
    const raw = sessionStorage.getItem('legal-dashboard-auth-session-v1');
    return raw ? JSON.parse(raw)?.token || '' : '';
  } catch {
    return '';
  }
}

async function requestNumber() {
  const token = getSessionToken();
  const response = await fetch('/api/general-cases/next-number', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: '{}'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || result?.error || `HTTP ${response.status}`);
  return String(result?.case_no || '');
}

async function fillNewCaseNumber() {
  const dialog = document.querySelector('[data-general-dialog]');
  const form = dialog?.querySelector('[data-general-form]');
  if (!(form instanceof HTMLFormElement)) return;
  if (!dialog.open && !dialog.classList.contains('is-open')) return;

  const idInput = form.elements?.id;
  const input = form.elements?.case_no;
  if (!(input instanceof HTMLInputElement)) return;
  if (Number(idInput?.value || 0)) return;

  input.readOnly = true;
  input.setAttribute('aria-readonly', 'true');
  input.classList.add('general-case-pk-number');

  if (input.value.trim()) return;
  if (form.dataset.pkNumberLoading === '1') return;

  form.dataset.pkNumberLoading = '1';
  input.placeholder = 'Формируется автоматически…';
  try {
    const value = await requestNumber();
    if (!value) throw new Error('Сервер не вернул № ПК');
    if (!Number(form.elements?.id?.value || 0) && !input.value.trim()) {
      input.value = value;
      input.placeholder = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (error) {
    console.error('Не удалось сформировать № ПК:', error);
    input.placeholder = 'Ошибка формирования № ПК';
  } finally {
    form.dataset.pkNumberLoading = '0';
  }
}

function scheduleFill() {
  [0, 30, 80, 160, 300, 600].forEach(delay => {
    setTimeout(() => void fillNewCaseNumber(), delay);
  });
}

export function initGeneralCasePkNumber() {
  if (window.__generalCasePkNumberInitialized) return;
  window.__generalCasePkNumberInitialized = true;

  document.addEventListener('click', event => {
    if (event.target.closest('[data-general-new]')) scheduleFill();
  }, true);

  const dialog = document.querySelector('[data-general-dialog]');
  if (dialog) {
    new MutationObserver(() => scheduleFill()).observe(dialog, {
      attributes: true,
      attributeFilter: ['open', 'class']
    });
  }
}
