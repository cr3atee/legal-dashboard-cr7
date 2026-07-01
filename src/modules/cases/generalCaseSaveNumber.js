function getToken() {
  try {
    return JSON.parse(sessionStorage.getItem('legal-dashboard-auth-session-v1') || '{}').token || '';
  } catch {
    return '';
  }
}

async function loadNextNumber() {
  const token = getToken();
  const response = await fetch('/api/general-cases/next-number', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: '{}'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return String(data.case_no || '');
}

function prepareField() {
  const form = document.querySelector('[data-general-form]');
  const input = form?.elements?.case_no;
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) return;
  input.readOnly = true;
  input.classList.add('general-case-pk-number');
  if (!Number(form.elements?.id?.value || 0) && !input.value.trim()) {
    input.placeholder = 'Будет присвоен при сохранении';
  }
}

export function initGeneralCaseSaveNumber() {
  if (window.__generalCaseSaveNumberInitialized) return;
  window.__generalCaseSaveNumberInitialized = true;

  document.addEventListener('click', event => {
    if (event.target.closest('[data-general-new], [data-general-open]')) {
      setTimeout(prepareField, 0);
      setTimeout(prepareField, 100);
    }
  }, true);

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-general-form]')) return;
    const input = form.elements?.case_no;
    const isNew = !Number(form.elements?.id?.value || 0);
    if (!isNew || !(input instanceof HTMLInputElement) || input.value.trim() || form.dataset.pkSubmitReady === '1') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.dataset.pkNumberLoading === '1') return;
    form.dataset.pkNumberLoading = '1';
    input.placeholder = 'Формируется автоматически…';

    try {
      input.value = await loadNextNumber();
      form.dataset.pkSubmitReady = '1';
      form.requestSubmit();
    } catch (error) {
      console.error('Не удалось присвоить № ПК:', error);
      input.placeholder = 'Ошибка формирования № ПК';
    } finally {
      form.dataset.pkNumberLoading = '0';
    }
  }, true);

  new MutationObserver(prepareField).observe(document.body, { childList: true, subtree: true });
  prepareField();
}
