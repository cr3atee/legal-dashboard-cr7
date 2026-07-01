function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem('legal-dashboard-auth-session-v1') || '{}');
  } catch {
    return {};
  }
}

function authHeaders() {
  const token = readSession().token || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return data;
}

function ensureButton(form) {
  let button = form.querySelector('[data-general-cancel-case]');
  if (button) return button;

  button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small general-case-cancel-button';
  button.dataset.generalCancelCase = '1';

  const submit = form.querySelector('button[type="submit"]');
  const actions = submit?.parentElement || form;
  actions.insertBefore(button, submit || null);
  return button;
}

async function syncCancellationUi() {
  const session = readSession();
  const form = document.querySelector('[data-general-form]');
  if (!(form instanceof HTMLFormElement)) return;

  const button = ensureButton(form);
  const id = Number(form.elements?.id?.value || 0);
  const isAdmin = Number(session.role_level || 0) >= 2;
  button.hidden = !isAdmin || !id;
  if (!isAdmin || !id) return;

  try {
    const status = await requestJson(`/api/general-cases/${id}/cancel-status`);
    const cancelled = Boolean(status.cancelled);
    form.dataset.cancelledCase = cancelled ? '1' : '0';
    button.textContent = cancelled ? 'Вернуть дело' : 'Отменить дело';
    button.classList.toggle('restore', cancelled);
    button.classList.toggle('danger', !cancelled);

    const badge = document.querySelector('[data-general-dialog] .case-dialog-active-dot');
    if (badge) {
      badge.textContent = cancelled ? '● Отменённое дело' : '● Активное дело';
      badge.classList.toggle('is-cancelled', cancelled);
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.hidden = cancelled;
  } catch (error) {
    console.error('Не удалось определить статус дела:', error);
    button.hidden = true;
  }
}

async function toggleCancellation(button) {
  const form = button.closest('[data-general-form]');
  const id = Number(form?.elements?.id?.value || 0);
  if (!id) return;

  const cancelled = form.dataset.cancelledCase === '1';
  const question = cancelled
    ? 'Вернуть дело в активный общий перечень?'
    : 'Отменить дело? Оно будет видно только администраторам и не будет учитываться в отчётах.';
  if (!window.confirm(question)) return;

  button.disabled = true;
  try {
    await requestJson(`/api/general-cases/${id}/${cancelled ? 'restore-cancelled' : 'cancel'}`, {
      method: 'POST',
      body: '{}'
    });
    document.querySelector('[data-general-dialog]')?.close();
    window.dispatchEvent(new CustomEvent('general-cases:reload'));
    setTimeout(() => document.querySelector('[data-general-refresh]')?.click(), 50);
  } catch (error) {
    window.alert(error.message || 'Не удалось изменить статус дела');
  } finally {
    button.disabled = false;
  }
}

export function initGeneralCaseCancellationUi() {
  if (window.__generalCaseCancellationUiInitialized) return;
  window.__generalCaseCancellationUiInitialized = true;

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-general-cancel-case]');
    if (toggle) {
      event.preventDefault();
      void toggleCancellation(toggle);
      return;
    }
    if (event.target.closest('[data-general-open], [data-general-new]')) {
      setTimeout(() => void syncCancellationUi(), 60);
      setTimeout(() => void syncCancellationUi(), 180);
    }
  }, true);

  new MutationObserver(() => void syncCancellationUi()).observe(document.body, { childList: true, subtree: true });
}
