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
  const form = document.querySelector('[data-general-form]');
  if (!(form instanceof HTMLFormElement)) return false;

  const idInput = form.elements?.id;
  const input = form.elements?.case_no;
  if (!(input instanceof HTMLInputElement)) return false;
  if (Number(idInput?.value || 0)) return false;

  input.readOnly = true;
  input.setAttribute('aria-readonly', 'true');
  input.classList.add('general-case-pk-number');

  if (form.dataset.pkNumberForNewCase === '1' && input.value.trim()) return true;
  if (form.dataset.pkNumberLoading === '1') return true;

  form.dataset.pkNumberLoading = '1';
  input.value = '';
  input.placeholder = 'Формируется автоматически…';

  try {
    const value = await requestNumber();
    if (!value) throw new Error('Сервер не вернул № ПК');
    input.value = value;
    input.placeholder = '';
    form.dataset.pkNumberForNewCase = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    console.error('Не удалось сформировать № ПК:', error);
    input.placeholder = 'Ошибка формирования № ПК';
  } finally {
    form.dataset.pkNumberLoading = '0';
  }
  return true;
}

function scheduleFill() {
  [0, 40, 120, 250].forEach(delay => {
    setTimeout(() => void fillNewCaseNumber(), delay);
  });
}

export function initGeneralCasePkNumber() {
  if (window.__generalCasePkNumberInitialized) return;
  window.__generalCasePkNumberInitialized = true;

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-general-new]')) return;
    const currentForm = document.querySelector('[data-general-form]');
    if (currentForm instanceof HTMLFormElement) {
      currentForm.dataset.pkNumberForNewCase = '0';
      currentForm.dataset.pkNumberLoading = '0';
    }
    scheduleFill();
  }, true);
}
