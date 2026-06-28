import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let renderTimer = 0;
let usersCache = [];

export function initCalendarExecutorControl() {
  if (initialized) return;
  initialized = true;

  const schedule = () => {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderPicker, 50);
  };

  document.addEventListener('click', handleDocumentClick, true);
  window.addEventListener('app:view-changed', event => {
    if (!event.detail?.viewId || event.detail.viewId === 'calendar') schedule();
  });
  window.addEventListener('calendar:reload', schedule);
  window.addEventListener('calendar:updated', syncPickerState);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}

async function renderPicker() {
  const row = document.querySelector('#calendar .calendar-week-new-row');
  const executionButton = row?.querySelector('[data-calendar-execution-mode]');
  const nativeLabel = document.querySelector('#calendar .calendar-user-filter');
  const nativeSelect = nativeLabel?.querySelector('[data-calendar-user]');
  if (!row || !executionButton || !nativeSelect) return;

  // Старое поле оставляем только как технический канал для calendarController.
  // Пользователь его больше не видит и не взаимодействует с ним напрямую.
  nativeLabel.hidden = true;
  nativeLabel.classList.remove('calendar-executor-inline');
  nativeLabel.dataset.calendarExecutorInternal = '1';

  let picker = row.querySelector('[data-calendar-executor-picker]');
  if (!picker) {
    picker = document.createElement('div');
    picker.className = 'calendar-executor-picker';
    picker.dataset.calendarExecutorPicker = '1';
    picker.innerHTML = `
      <span class="calendar-executor-picker-label">Календарь сотрудника</span>
      <button class="calendar-executor-picker-button" type="button" data-calendar-executor-toggle aria-expanded="false">
        <span data-calendar-executor-current>Только мой календарь</span>
        <span class="calendar-executor-picker-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="calendar-executor-picker-menu" data-calendar-executor-menu hidden>
        <button type="button" data-calendar-executor-id="0">Только мой календарь</button>
      </div>
    `;
    row.insertBefore(picker, executionButton);
  }

  try {
    usersCache = await dbApi.getCalendarUsers();
    const users = Array.isArray(usersCache) ? usersCache : [];
    const menu = picker.querySelector('[data-calendar-executor-menu]');
    menu.innerHTML = [
      '<button type="button" data-calendar-executor-id="0">Только мой календарь</button>',
      ...users
        .filter(user => Number(user.role_level ?? 1) === 1)
        .map(user => `<button type="button" data-calendar-executor-id="${escapeHtml(user.id)}">${escapeHtml(user.full_name || '')}</button>`)
    ].join('');
    picker.hidden = false;
    syncPickerState();
  } catch (error) {
    picker.hidden = true;
    console.warn('Выбор исполнителя недоступен:', error);
  }
}

function handleDocumentClick(event) {
  const toggle = event.target.closest('[data-calendar-executor-toggle]');
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    const picker = toggle.closest('[data-calendar-executor-picker]');
    const menu = picker?.querySelector('[data-calendar-executor-menu]');
    if (!menu) return;
    const willOpen = menu.hidden;
    closeAllMenus();
    menu.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', String(willOpen));
    return;
  }

  const choice = event.target.closest('[data-calendar-executor-id]');
  if (choice) {
    event.preventDefault();
    event.stopPropagation();
    const select = document.querySelector('#calendar [data-calendar-user]');
    if (!select) return;
    const value = String(choice.dataset.calendarExecutorId || '0');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncPickerState();
    closeAllMenus();
    return;
  }

  if (!event.target.closest('[data-calendar-executor-picker]')) closeAllMenus();
}

function syncPickerState() {
  const picker = document.querySelector('#calendar [data-calendar-executor-picker]');
  const select = document.querySelector('#calendar [data-calendar-user]');
  if (!picker || !select) return;

  const current = picker.querySelector('[data-calendar-executor-current]');
  const selectedOption = select.options?.[select.selectedIndex];
  if (current) current.textContent = selectedOption?.textContent || 'Только мой календарь';

  picker.querySelectorAll('[data-calendar-executor-id]').forEach(button => {
    const active = String(button.dataset.calendarExecutorId || '0') === String(select.value || '0');
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function closeAllMenus() {
  document.querySelectorAll('[data-calendar-executor-menu]').forEach(menu => {
    menu.hidden = true;
    menu.closest('[data-calendar-executor-picker]')?.querySelector('[data-calendar-executor-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
