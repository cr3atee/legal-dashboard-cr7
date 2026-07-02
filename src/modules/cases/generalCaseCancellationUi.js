function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem('legal-dashboard-auth-session-v1') || '{}');
  } catch {
    return {};
  }
}

function authHeaders() {
  const session = readSession();
  const token = session.token || '';
  const userId = session.id || session.user_id || '';
  const userName = session.full_name || session.user || session.name || '';
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'X-User-Id': String(userId) } : {}),
    ...(userName ? { 'X-User-Name': encodeURIComponent(String(userName)) } : {})
  };
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

function setCancelledAppearance(id, cancelled) {
  document.querySelectorAll(`[data-general-card="${id}"], [data-general-row="${id}"]`).forEach(node => {
    node.classList.toggle('is-cancelled-case', cancelled);
    node.setAttribute('aria-disabled', cancelled ? 'true' : 'false');

    let badge = node.querySelector('[data-cancelled-case-badge]');
    if (cancelled && !badge) {
      badge = document.createElement('span');
      badge.dataset.cancelledCaseBadge = '1';
      badge.className = 'case-badge cancelled';
      badge.textContent = 'Отменённое';
      const host = node.querySelector('.general-case-badges, .general-cases-table-badges') || node.firstElementChild || node;
      host.append(badge);
    }
    if (!cancelled) badge?.remove();
  });
}

async function decorateCancelledCases() {
  if (Number(readSession().role_level || 0) < 2) return;
  try {
    const rows = await requestJson('/api/general-cases');
    const cancelledIds = new Set((Array.isArray(rows) ? rows : [])
      .filter(row => Number(row.cancelled_flag || 0) === 1)
      .map(row => String(row.id)));

    document.querySelectorAll('[data-general-card], [data-general-row]').forEach(node => {
      const id = String(node.dataset.generalCard || node.dataset.generalRow || '');
      setCancelledAppearance(id, cancelledIds.has(id));
    });
  } catch (error) {
    console.error('Не удалось оформить отменённые дела:', error);
  }
}

async function toggleCancellation(button) {
  const form = button.closest('[data-general-form]');
  const id = Number(form?.elements?.id?.value || 0);
  if (!id) return;
  const cancelled = form.dataset.cancelledCase === '1';
  const question = cancelled
    ? 'Вернуть дело в активный общий перечень?'
    : 'Отменить дело? Оно останется на текущем месте, станет серым и не будет учитываться в отчётах.';
  if (!window.confirm(question)) return;

  button.disabled = true;
  try {
    await requestJson(`/api/general-cases/${id}/${cancelled ? 'restore-cancelled' : 'cancel'}`, {
      method: 'POST',
      body: '{}'
    });

    const nextCancelled = !cancelled;
    form.dataset.cancelledCase = nextCancelled ? '1' : '0';
    setCancelledAppearance(id, nextCancelled);

    const badge = document.querySelector('[data-general-dialog] .case-dialog-active-dot');
    if (badge) {
      badge.textContent = nextCancelled ? '● Отменённое дело' : '● Активное дело';
      badge.classList.toggle('is-cancelled', nextCancelled);
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.hidden = nextCancelled;
    button.textContent = nextCancelled ? 'Вернуть дело' : 'Отменить дело';
    button.classList.toggle('restore', nextCancelled);
    button.classList.toggle('danger', !nextCancelled);

    document.querySelector('[data-general-dialog]')?.close();
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

  window.addEventListener('general-cases:updated', () => setTimeout(() => void decorateCancelledCases(), 50));
  window.addEventListener('general-cases:reload', () => setTimeout(() => void decorateCancelledCases(), 180));
  setTimeout(() => void decorateCancelledCases(), 250);
}
