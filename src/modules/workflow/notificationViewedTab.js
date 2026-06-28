import { dbApi } from '../../api/dbApi.js';

let initialized = false;

export function initNotificationViewedTab() {
  if (initialized) return;
  initialized = true;

  ensureViewedTab();

  document.addEventListener('click', async event => {
    const viewedButton = event.target.closest('[data-notification-tab="viewed"]');
    if (!viewedButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    await renderViewedNotifications();
  }, true);

  document.addEventListener('click', event => {
    const regularTab = event.target.closest('[data-notification-tab="active"], [data-notification-tab="overdue"]');
    if (!regularTab) return;
    document.querySelector('[data-notification-tab="viewed"]')?.classList.remove('is-active');
  }, true);

  for (const eventName of ['notifications:refresh', 'general-cases:updated', 'calendar:updated']) {
    window.addEventListener(eventName, refreshViewedCount);
  }

  window.setInterval(refreshViewedCount, 60_000);
  refreshViewedCount();
}

function ensureViewedTab() {
  const tabs = document.querySelector('.notifications-tabs');
  if (!tabs || tabs.querySelector('[data-notification-tab="viewed"]')) return;

  const button = document.createElement('button');
  button.className = 'notifications-tab';
  button.type = 'button';
  button.dataset.notificationTab = 'viewed';
  button.innerHTML = 'Просмотренные <span data-notification-viewed-count>0</span>';
  tabs.append(button);
}

async function refreshViewedCount() {
  ensureViewedTab();
  try {
    const response = await dbApi.getNotifications();
    const items = Array.isArray(response?.items) ? response.items : [];
    const count = items.filter(item => Number(item.unread) === 0).length;
    const node = document.querySelector('[data-notification-viewed-count]');
    if (node) node.textContent = String(count);
  } catch {}
}

async function renderViewedNotifications() {
  ensureViewedTab();

  document.querySelectorAll('[data-notification-tab]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.notificationTab === 'viewed');
  });

  const list = document.querySelector('[data-notifications-list]');
  const status = document.querySelector('[data-notifications-status]');
  const markAll = document.querySelector('[data-notifications-mark-all]');
  if (markAll) markAll.hidden = true;
  if (status) status.textContent = 'Загрузка просмотренных уведомлений...';

  try {
    const response = await dbApi.getNotifications();
    const items = (Array.isArray(response?.items) ? response.items : [])
      .filter(item => Number(item.unread) === 0)
      .sort((a, b) => new Date(b.due_at || 0).getTime() - new Date(a.due_at || 0).getTime());

    const count = document.querySelector('[data-notification-viewed-count]');
    if (count) count.textContent = String(items.length);
    if (status) status.textContent = items.length
      ? `${items.length} просмотренных уведомлений`
      : 'Просмотренных уведомлений нет.';
    if (list) list.innerHTML = items.length
      ? items.map(renderViewedCard).join('')
      : '<div class="notifications-empty">Просмотренных уведомлений нет</div>';
  } catch (error) {
    if (status) status.textContent = `Не удалось загрузить просмотренные уведомления: ${error.message}`;
    if (list) list.innerHTML = '<div class="notifications-empty">Ошибка загрузки</div>';
  }
}

function renderViewedCard(item) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const sourceLabel = item.source_type === 'general_case' || item.source_type === 'general_case_review_approval'
    ? 'Открыть дело'
    : 'Открыть календарь';

  return `
    <article class="notification-card notification-${escapeAttr(item.severity || 'info')}">
      <div class="notification-card-head">
        <span class="notification-severity-icon" aria-hidden="true">${notificationIcon(item)}</span>
        <div>
          <b>${escapeHtml(item.title || 'Уведомление')}</b>
          <small>Просмотрено</small>
        </div>
      </div>
      <span>${escapeHtml(item.message || '')}</span>
      <div class="notification-card-actions">
        <button class="btn small" type="button" data-notification-open
          data-source-type="${escapeAttr(item.source_type || '')}"
          data-source-id="${escapeAttr(item.source_id || '')}"
          data-general-case-id="${escapeAttr(item.general_case_id || item.caseId || metadata.caseId || '')}"
          data-document-id="${escapeAttr(item.documentId || item.document_id || metadata.documentId || '')}"
          data-approval-request-id="${escapeAttr(item.approvalRequestId || item.approval_request_id || metadata.approvalRequestId || '')}">${sourceLabel}</button>
      </div>
    </article>`;
}

function notificationIcon(item = {}) {
  if (item.severity === 'deadline') return '⏰';
  if (item.severity === 'hearing') return '⚖️';
  if (item.severity === 'stale') return '⚠️';
  if (item.severity === 'assignment') return '📌';
  return '🔔';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
