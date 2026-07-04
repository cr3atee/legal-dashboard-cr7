let initialized = false;

export function initControlledHistoryCompactDateUi() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-history-pick-today]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openHistoryDatePicker(button.closest('[data-history-id]'));
  }, true);

  document.addEventListener('change', event => {
    if (!event.target.matches?.('[data-history-native-date]')) return;
    const row = event.target.closest('[data-history-id]');
    const dateInput = row?.querySelector('[data-history-date]');
    const ruDate = isoToRu(event.target.value);
    if (!dateInput || !ruDate) return;

    dateInput.value = ruDate;
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);

  document.addEventListener('input', event => {
    if (!event.target.matches?.('[data-history-date]')) return;
    syncNativeDate(event.target.closest('[data-history-id]'));
  }, true);

  enhanceHistoryRows();
  const observer = new MutationObserver(() => enhanceHistoryRows());
  observer.observe(document.body, { childList: true, subtree: true });
}

function enhanceHistoryRows() {
  document.querySelectorAll('[data-controlled-history-rows] [data-history-id]').forEach(row => {
    const dateInput = row.querySelector('[data-history-date]');
    const timeInput = row.querySelector('[data-history-time]');
    const button = row.querySelector('[data-history-pick-today]');
    if (!(dateInput instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return;

    row.classList.add('controlled-history-row-compact');
    dateInput.classList.add('controlled-history-date-compact');
    timeInput?.classList.add('controlled-history-time-compact');

    if (!String(dateInput.value || '').trim()) {
      dateInput.value = formatTodayRu();
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    button.textContent = '📅';
    button.title = 'Выбрать дату';
    button.setAttribute('aria-label', 'Выбрать дату');
    button.classList.add('controlled-history-calendar-button');

    ensureNativeDateInput(row);
    syncNativeDate(row);
  });
}

function ensureNativeDateInput(row) {
  let native = row.querySelector('[data-history-native-date]');
  if (native) return native;

  native = document.createElement('input');
  native.type = 'date';
  native.dataset.historyNativeDate = '1';
  native.className = 'controlled-history-native-date';
  native.tabIndex = -1;
  native.setAttribute('aria-hidden', 'true');
  row.appendChild(native);
  return native;
}

function openHistoryDatePicker(row) {
  if (!row) return;
  const dateInput = row.querySelector('[data-history-date]');
  const native = ensureNativeDateInput(row);
  if (!(dateInput instanceof HTMLInputElement) || !(native instanceof HTMLInputElement)) return;

  const current = ruToIso(dateInput.value) || ruToIso(formatTodayRu());
  native.value = current;

  try {
    if (typeof native.showPicker === 'function') native.showPicker();
    else native.click();
  } catch {
    native.focus();
    native.click();
  }
}

function syncNativeDate(row) {
  if (!row) return;
  const dateInput = row.querySelector('[data-history-date]');
  const native = ensureNativeDateInput(row);
  if (!(dateInput instanceof HTMLInputElement) || !(native instanceof HTMLInputElement)) return;

  const iso = ruToIso(dateInput.value) || ruToIso(formatTodayRu());
  native.value = iso;
}

function formatTodayRu() {
  const date = new Date();
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear()
  ].join('.');
}

function ruToIso(value) {
  const [day, month, year] = String(value || '').trim().split('.').map(Number);
  if (!day || !month || !year) return '';
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoToRu(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!day || !month || !year) return '';
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}
