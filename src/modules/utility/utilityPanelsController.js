import { dbApi } from '../../api/dbApi.js';

const NOTES_KEY = 'legal-dashboard-working-notes-v1';

let notes = [];
let activeNoteId = null;
let saveTimer = null;
let notificationItems = [];
let notificationTab = 'active';
let notificationRefreshTimer = null;
let notificationInterval = null;

export function initUtilityPanels() {
  loadNotes();
  refreshNotifications({ silent: true });

  if (notificationInterval) clearInterval(notificationInterval);
  notificationInterval = setInterval(() => refreshNotifications({ silent: true }), 60_000);

  document.addEventListener('click', event => {
    if (event.target.closest('#openNotesBtn')) {
      openPanel('notesPanel');
      renderNotesList();
      ensureActiveNote();
      renderActiveNote();
    }

    if (event.target.closest('#openNotificationsBtn, [data-open-notifications]')) {
      openPanel('notificationsPanel');
      refreshNotifications();
    }

    const notificationTabButton = event.target.closest('[data-notification-tab]');
    if (notificationTabButton) {
      notificationTab = notificationTabButton.dataset.notificationTab === 'overdue' ? 'overdue' : 'active';
      renderNotificationsPanel();
    }

    const readButton = event.target.closest('[data-notification-read]');
    if (readButton) {
      markNotificationKeysRead([readButton.dataset.notificationRead]);
    }

    if (event.target.closest('[data-notifications-mark-all]')) {
      const keys = notificationItems
        .filter(item => item.status === notificationTab && Number(item.unread) === 1)
        .map(item => item.key);
      markNotificationKeysRead(keys);
    }

    const openNotificationButton = event.target.closest('[data-notification-open]');
    if (openNotificationButton) {
      openNotificationSource(openNotificationButton);
    }

    if (event.target.closest('[data-close-utility]') || event.target.id === 'utilityBackdrop') {
      closeUtilityPanels();
    }

    if (event.target.closest('#newNoteBtn')) {
      createNote();
    }

    if (event.target.closest('#deleteNoteBtn')) {
      deleteActiveNote();
    }

    const noteButton = event.target.closest('[data-note-id]');
    if (noteButton) {
      activeNoteId = noteButton.dataset.noteId;
      renderNotesList();
      renderActiveNote();
    }
  });

  document.addEventListener('input', event => {
    if (event.target.matches('#noteTitleInput, #noteTextInput')) {
      scheduleSaveActiveNote();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeUtilityPanels();
    }
  });

  for (const eventName of ['calendar:updated', 'general-cases:updated', 'notifications:refresh']) {
    window.addEventListener(eventName, scheduleNotificationsRefresh);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshNotifications({ silent: true });
  });
}

function openPanel(panelId) {
  document.querySelector('#utilityBackdrop')?.removeAttribute('hidden');

  document.querySelectorAll('.utility-panel').forEach(panel => {
    if (panel.id === panelId) {
      panel.removeAttribute('hidden');
      requestAnimationFrame(() => panel.classList.add('open'));
    } else {
      panel.classList.remove('open');
      panel.setAttribute('hidden', '');
    }
  });
}

function closeUtilityPanels() {
  document.querySelector('#utilityBackdrop')?.setAttribute('hidden', '');

  document.querySelectorAll('.utility-panel').forEach(panel => {
    panel.classList.remove('open');
    panel.setAttribute('hidden', '');
  });
}

function loadNotes() {
  try {
    notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
  } catch {
    notes = [];
  }

  if (!Array.isArray(notes)) notes = [];

  if (!notes.length) {
    notes = [
      {
        id: createId(),
        title: 'Рабочая заметка',
        text: '',
        updatedAt: new Date().toISOString()
      }
    ];
  }

  activeNoteId = notes[0]?.id || null;
}

function saveNotes() {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function ensureActiveNote() {
  if (!notes.length) {
    createNote(false);
  }

  if (!activeNoteId || !notes.some(note => note.id === activeNoteId)) {
    activeNoteId = notes[0]?.id || null;
  }
}

function createNote(render = true) {
  const note = {
    id: createId(),
    title: 'Новая заметка',
    text: '',
    updatedAt: new Date().toISOString()
  };

  notes.unshift(note);
  activeNoteId = note.id;
  saveNotes();

  if (render) {
    renderNotesList();
    renderActiveNote();
  }
}

function deleteActiveNote() {
  if (!activeNoteId) return;

  if (!confirm('Удалить выбранную заметку?')) return;

  notes = notes.filter(note => note.id !== activeNoteId);

  if (!notes.length) {
    createNote(false);
  }

  activeNoteId = notes[0]?.id || null;
  saveNotes();
  renderNotesList();
  renderActiveNote();
}

function renderNotesList() {
  const list = document.querySelector('#notesList');
  if (!list) return;

  ensureActiveNote();

  list.innerHTML = notes.map(note => `
    <button class="note-list-item ${note.id === activeNoteId ? 'active' : ''}" data-note-id="${escapeAttr(note.id)}" type="button">
      <b>${escapeHtml(note.title || 'Без названия')}</b>
      <span>${formatNoteDate(note.updatedAt)}</span>
    </button>
  `).join('');
}

function renderActiveNote() {
  const note = notes.find(item => item.id === activeNoteId);
  const titleInput = document.querySelector('#noteTitleInput');
  const textInput = document.querySelector('#noteTextInput');

  if (!titleInput || !textInput || !note) return;

  titleInput.value = note.title || '';
  textInput.value = note.text || '';
  updateSaveState('Готово');
}

function scheduleSaveActiveNote() {
  updateSaveState('Сохранение...');

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const note = notes.find(item => item.id === activeNoteId);
    const titleInput = document.querySelector('#noteTitleInput');
    const textInput = document.querySelector('#noteTextInput');

    if (!note || !titleInput || !textInput) return;

    note.title = titleInput.value.trim() || 'Без названия';
    note.text = textInput.value;
    note.updatedAt = new Date().toISOString();

    saveNotes();
    renderNotesList();
    updateSaveState('Сохранено');
  }, 250);
}

function updateSaveState(text) {
  const node = document.querySelector('#noteSaveState');
  if (node) node.textContent = text;
}

function formatNoteDate(value) {
  if (!value) return '';

  try {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function createId() {
  return `note_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function scheduleNotificationsRefresh() {
  clearTimeout(notificationRefreshTimer);
  notificationRefreshTimer = setTimeout(() => refreshNotifications({ silent: true }), 250);
}

async function refreshNotifications({ silent = false } = {}) {
  const statusNode = document.querySelector('[data-notifications-status]');
  if (!silent && statusNode) statusNode.textContent = 'Обновление...';

  try {
    const response = await dbApi.getNotifications();
    notificationItems = Array.isArray(response?.items) ? response.items : [];
    renderNotificationsPanel();
    renderCriticalAlertsWidget();
    syncNotificationsBadge();
  } catch (error) {
    if (statusNode) statusNode.textContent = `Не удалось загрузить уведомления: ${error.message}`;
    renderCriticalAlertsError(error.message);
    syncNotificationsBadge(0);
  }
}

function renderNotificationsPanel() {
  const list = document.querySelector('[data-notifications-list]');
  const statusNode = document.querySelector('[data-notifications-status]');
  const activeCount = notificationItems.filter(item => item.status === 'active').length;
  const overdueCount = notificationItems.filter(item => item.status === 'overdue').length;

  document.querySelector('[data-notification-active-count]')?.replaceChildren(document.createTextNode(String(activeCount)));
  document.querySelector('[data-notification-overdue-count]')?.replaceChildren(document.createTextNode(String(overdueCount)));
  document.querySelectorAll('[data-notification-tab]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.notificationTab === notificationTab);
  });

  const visible = notificationItems.filter(item => item.status === notificationTab);
  if (statusNode) {
    const unread = visible.filter(item => Number(item.unread) === 1).length;
    statusNode.textContent = visible.length
      ? `${visible.length} уведомлений, непрочитанных: ${unread}`
      : notificationTab === 'overdue'
        ? 'Просроченных уведомлений нет.'
        : 'Актуальных критических ситуаций нет.';
  }

  if (!list) return;
  if (!visible.length) {
    list.innerHTML = `<div class="notifications-empty">${notificationTab === 'overdue' ? 'Просроченных уведомлений нет' : 'Критических ситуаций нет'}</div>`;
    return;
  }

  list.innerHTML = visible.map(renderNotificationCard).join('');
}

function renderNotificationCard(item) {
  const unread = Number(item.unread) === 1;
  const sourceLabel = item.source_type === 'general_case' || item.source_type === 'general_case_review_approval' ? 'Карточка дела' : 'Календарь';
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  return `
    <article class="notification-card notification-${escapeAttr(item.severity || 'info')} ${unread ? 'is-unread' : ''} ${item.status === 'overdue' ? 'is-overdue' : ''}">
      <div class="notification-card-head">
        <span class="notification-severity-icon" aria-hidden="true">${notificationIcon(item)}</span>
        <div>
          <b>${escapeHtml(item.title || 'Уведомление')}</b>
          <small>${item.status === 'overdue' ? 'Просрочено' : 'Актуально'}${unread ? ' · не прочитано' : ' · прочитано'}</small>
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
        ${unread ? `<button class="btn small primary" type="button" data-notification-read="${escapeAttr(item.key || '')}">Прочитано</button>` : ''}
      </div>
    </article>
  `;
}

function renderCriticalAlertsWidget() {
  const list = document.querySelector('[data-critical-alerts-list]');
  const count = document.querySelector('[data-critical-alerts-count]');
  if (!list || !count) return;

  const critical = [...notificationItems]
    .sort((a, b) => Number(b.unread) - Number(a.unread))
    .slice(0, 5);
  const unread = notificationItems.filter(item => Number(item.unread) === 1).length;
  count.textContent = unread ? `Непрочитанных: ${unread}` : 'Новых уведомлений нет';

  if (!critical.length) {
    list.innerHTML = '<div class="critical-alerts-empty">На сегодня критических ситуаций нет.</div>';
    return;
  }

  list.innerHTML = critical.map(item => `
    <button class="critical-alert-item ${item.status === 'overdue' ? 'is-overdue' : ''} ${Number(item.unread) === 1 ? 'is-unread' : ''}"
      type="button" data-open-notifications>
      <span class="critical-alert-icon" aria-hidden="true">${notificationIcon(item)}</span>
      <span><b>${escapeHtml(item.title || '')}</b><small>${escapeHtml(item.message || '')}</small></span>
      <em>${item.status === 'overdue' ? 'Просрочено' : 'Актуально'}</em>
    </button>
  `).join('');
}

function renderCriticalAlertsError(message) {
  const list = document.querySelector('[data-critical-alerts-list]');
  const count = document.querySelector('[data-critical-alerts-count]');
  if (count) count.textContent = 'Ошибка загрузки';
  if (list) list.innerHTML = `<div class="critical-alerts-empty error">${escapeHtml(message || 'API недоступен')}</div>`;
}

function syncNotificationsBadge(forcedCount = null) {
  const badge = document.querySelector('.topbar-notify-badge');
  if (!badge) return;
  const unread = forcedCount === null
    ? notificationItems.filter(item => Number(item.unread) === 1).length
    : Number(forcedCount || 0);
  badge.textContent = String(unread);
  badge.toggleAttribute('hidden', unread <= 0);
  badge.closest('.topbar-notify-btn')?.classList.toggle('has-unread', unread > 0);
}

async function markNotificationKeysRead(keys = []) {
  const valid = [...new Set(keys.map(value => String(value || '').trim()).filter(Boolean))];
  if (!valid.length) return;
  notificationItems = notificationItems.map(item => valid.includes(item.key) ? { ...item, unread: 0 } : item);
  renderNotificationsPanel();
  renderCriticalAlertsWidget();
  syncNotificationsBadge();
  try {
    await dbApi.markNotificationsRead(valid);
    await refreshNotifications({ silent: true });
  } catch (error) {
    alert(`Не удалось отметить уведомление прочитанным:\n${error.message}`);
    await refreshNotifications({ silent: true });
  }
}

function openNotificationSource(button) {
  const sourceType = button.dataset.sourceType || '';
  const sourceId = Number(button.dataset.sourceId || 0);
  const generalCaseId = Number(button.dataset.generalCaseId || 0);
  const documentId = String(button.dataset.documentId || '').trim();
  const approvalRequestId = Number(button.dataset.approvalRequestId || 0);
  closeUtilityPanels();

  if (sourceType === 'general_case' || sourceType === 'general_case_review_approval' || generalCaseId) {
    window.openView?.('cases');
    const id = generalCaseId || sourceId;
    if (id) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('general-cases:open-case', {
          detail: { id, documentId, approvalRequestId, tab: documentId ? 'documents' : '', sourceView: 'notifications' }
        }));
      }, 120);
    }
    return;
  }

  window.openView?.('calendar');
}

function notificationIcon(item = {}) {
  if (item.severity === 'deadline') return '⏰';
  if (item.severity === 'hearing') return '⚖️';
  if (item.severity === 'stale') return '⚠️';
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
