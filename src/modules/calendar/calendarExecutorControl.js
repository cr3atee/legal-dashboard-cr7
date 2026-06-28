import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let refreshTimer = 0;
let loading = false;

export function initCalendarExecutorControl() {
  if (initialized) return;
  initialized = true;

  const schedule = () => {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(renderControl, 30);
  };

  window.addEventListener('app:view-changed', event => {
    if (!event.detail?.viewId || event.detail.viewId === 'calendar') schedule();
  });
  window.addEventListener('calendar:reload', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}

async function renderControl() {
  const row = document.querySelector('#calendar .calendar-week-new-row');
  const executionButton = row?.querySelector('[data-calendar-execution-mode]');
  if (!row || !executionButton) return;

  // В calendarPage уже есть единственный select[data-calendar-user].
  // Переносим именно его, чтобы calendarController работал с тем же элементом,
  // а не создаём второй конкурирующий select.
  let label = document.querySelector('#calendar .calendar-user-filter');
  if (!label) {
    label = document.createElement('label');
    label.className = 'calendar-user-filter';
    label.innerHTML = '<span>Исполнители</span><select data-calendar-user><option value="0">Только мой календарь</option></select>';
  }

  label.classList.add('calendar-executor-inline');
  label.dataset.calendarExecutorControl = '1';
  const title = label.querySelector('span');
  if (title) title.textContent = 'Исполнители';
  if (label.parentElement !== row || label.nextElementSibling !== executionButton) {
    row.insertBefore(label, executionButton);
  }

  const select = label.querySelector('[data-calendar-user]');
  if (!select || loading) return;

  loading = true;
  try {
    // Доступ определяет сервер: для role_level < 2 endpoint вернёт 403.
    // Это надёжнее, чем гадать по форме объекта сессии на frontend.
    const users = await dbApi.getCalendarUsers();
    const previous = select.value || '0';
    const options = Array.isArray(users) ? users : [];
    select.innerHTML = '<option value="0">Только мой календарь</option>' + options
      .filter(user => Number(user.role_level ?? 1) === 1)
      .map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name || '')}</option>`)
      .join('');
    select.value = [...select.options].some(option => option.value === previous) ? previous : '0';
    label.hidden = false;
    label.removeAttribute('aria-hidden');
  } catch (error) {
    label.hidden = true;
    label.setAttribute('aria-hidden', 'true');
    console.warn('Поле исполнителей скрыто: сервер не разрешил получить список.', error);
  } finally {
    loading = false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
