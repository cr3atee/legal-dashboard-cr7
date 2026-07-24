import { dbApi } from '../../api/dbApi.js';

const VIEW_PREF_KEY = 'legal-dashboard-cases-default-view-v1';
const reportCache = {
  hearings: new Map(),
  tasks: new Map(),
  controlled: [],
  signature: '',
  loading: false,
};

let initialized = false;
let scheduled = false;
let deleteTarget = null;

export function initUserRequestedEnhancements() {
  if (initialized) return;
  initialized = true;

  ensureDialogs();
  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', scheduleEnhance, true);
  document.addEventListener('input', scheduleEnhance, true);
  window.addEventListener('app:view-changed', scheduleEnhance);
  window.addEventListener('calendar:updated', scheduleEnhance);
  window.addEventListener('general-cases:updated', scheduleEnhance);
  window.addEventListener('controlled-cases:updated', scheduleEnhance);
  window.addEventListener('schedule:updated', scheduleEnhance);
  window.addEventListener('emergency:updated', scheduleEnhance);
  window.addEventListener('registry:updated', scheduleEnhance);
  window.addEventListener('reports:reload', scheduleEnhance);
  scheduleEnhance();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceCalendarExecutor();
    enhanceAppealRows();
    enhanceCasesViewControls();
    decorateCategoryCells();
    void enrichDailyReports();
  });
}

function enhanceCalendarExecutor() {
  const filter = document.querySelector('.calendar-user-filter');
  const executionButton = document.querySelector('[data-calendar-execution-mode]');
  const row = executionButton?.parentElement;
  if (!filter || !executionButton || !row) return;

  const label = filter.querySelector('span');
  if (label) label.textContent = 'Исполнители';
  filter.classList.add('calendar-executor-inline');
  if (filter.parentElement !== row || filter.nextElementSibling !== executionButton) {
    row.insertBefore(filter, executionButton);
  }
}

function enhanceAppealRows() {
  document.querySelectorAll('[data-general-appeal-row]').forEach(row => {
    const labels = [...row.querySelectorAll('label')];
    const dateLabel = labels.find(label => normalize(label.textContent).includes('дата изготовления мотивированного решения суда первой инстанции'));
    if (dateLabel) {
      dateLabel.classList.add('appeal-motivated-date-compact');
      const input = dateLabel.querySelector('input');
      const remove = findAppealRemoveButton(row);
      if (input && remove) {
        let group = dateLabel.querySelector('.appeal-date-delete-group');
        if (!group) {
          group = document.createElement('span');
          group.className = 'appeal-date-delete-group';
          input.before(group);
          group.append(input);
        }
        remove.textContent = '×';
        remove.title = 'Удалить событие';
        remove.setAttribute('aria-label', 'Удалить событие');
        remove.classList.add('appeal-event-delete-cross');
        if (remove.parentElement !== group) group.append(remove);
      }
    }

    const appealTypeLabel = labels.find(label => normalize(label.textContent).includes('вид обжалования'));
    appealTypeLabel?.classList.add('appeal-kind-highlight');
  });
}

function findAppealRemoveButton(row) {
  return [...row.querySelectorAll('button')].find(button => {
    const text = String(button.textContent || '').trim();
    const title = normalize(`${button.title || ''} ${button.getAttribute('aria-label') || ''}`);
    return ['-', '−', '×'].includes(text) || title.includes('удалить событие');
  }) || null;
}

function enhanceCasesViewControls() {
  const root = document.querySelector('#cases');
  if (!root) return;
  const buttons = [...root.querySelectorAll('button')];
  const tableButton = buttons.find(button => normalize(button.textContent) === 'таблица');
  const cardsButton = buttons.find(button => normalize(button.textContent) === 'карточки');
  if (!tableButton || !cardsButton) return;

  let defaultButton = root.querySelector('[data-cases-default-view]');
  if (!defaultButton) {
    defaultButton = document.createElement('button');
    defaultButton.type = 'button';
    defaultButton.className = 'btn small cases-default-view-button';
    defaultButton.dataset.casesDefaultView = '1';
    defaultButton.textContent = 'Установить по умолчанию';
    const group = tableButton.parentElement;
    group?.insertBefore(defaultButton, tableButton);
  }

  if (root.dataset.defaultViewApplied !== '1') {
    root.dataset.defaultViewApplied = '1';
    const preferred = readViewPreference();
    const target = preferred === 'cards' ? cardsButton : tableButton;
    if (!isViewButtonActive(target)) setTimeout(() => target.click(), 0);
  }
}

function isViewButtonActive(button) {
  return button.classList.contains('active')
    || button.classList.contains('primary')
    || button.getAttribute('aria-pressed') === 'true';
}

function decorateCategoryCells() {
  document.querySelectorAll('#cases table').forEach(table => {
    const headers = [...table.querySelectorAll('thead th')];
    const index = headers.findIndex(header => normalize(header.textContent).includes('категория спора'));
    if (index < 0) return;
    table.querySelectorAll('tbody tr').forEach(row => {
      const cell = row.children[index];
      if (!cell || cell.querySelector('.case-category-pill')) return;
      const text = String(cell.textContent || '').trim();
      if (!text || text === '—' || text === '-') return;
      const pill = document.createElement('span');
      pill.className = 'case-category-pill';
      const hue = stableHue(text);
      pill.style.setProperty('--category-hue', String(hue));
      pill.innerHTML = `<span class="case-category-pill-icon" aria-hidden="true">▣</span><span>${escapeHtml(text)}</span>`;
      cell.textContent = '';
      cell.append(pill);
    });
  });
}

async function enrichDailyReports() {
  const root = document.querySelector('[data-reports-root]');
  if (!root || root.hidden || root.dataset.reportsMode === 'quarter') return;
  const date = root.querySelector('[data-reports-date]')?.value || todayIso();
  const cards = [...root.querySelectorAll('.reports-employee-card')];
  const names = cards.map(card => card.querySelector('h4')?.textContent?.trim()).filter(Boolean);
  if (!names.length) return;

  const signature = `${date}|${names.join('|')}|${cards.length}`;
  if (reportCache.loading || reportCache.signature === signature) return;
  reportCache.loading = true;
  try {
    const [scheduleRows, controlledRows, taskResults] = await Promise.all([
      dbApi.getCourtSchedule().catch(() => []),
      dbApi.getControlledCases().catch(() => []),
      Promise.all(names.map(name => dbApi.getCalendarTasks({ date, user: name }).catch(() => []))),
    ]);

    reportCache.hearings = new Map();
    reportCache.tasks = new Map();
    names.forEach((name, index) => {
      reportCache.hearings.set(name, filterHearings(scheduleRows, date, name));
      reportCache.tasks.set(name, filterPlanTasks(taskResults[index], date));
    });
    reportCache.controlled = Array.isArray(controlledRows) ? controlledRows : [];
    reportCache.signature = signature;

    cards.forEach(card => enrichEmployeeCard(card, date));
    renderControlledForEmployees(root, names, date);
  } finally {
    reportCache.loading = false;
  }
}

function filterHearings(rows, date, employeeName) {
  const employee = normalize(employeeName);
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const rowDate = normalizeDate(row.session_date || row.hearing_date || row.date || row.date_str);
    const owner = normalize(row.representative || row.case_executor || row.executor || row.employee || '');
    const type = normalize(row.type || row.kind || '');
    return rowDate === date && owner === employee && (!type || type.includes('case') || type.includes('засед'));
  });
}

function filterPlanTasks(rows, date) {
  return (Array.isArray(rows) ? rows : []).filter(task => {
    const taskDate = normalizeDate(task.date || task.date_str || task.start_date || task.deadline);
    const type = normalize(task.type || task.task_type || task.kind || '');
    const scope = normalize(task.event_scope || task.scope || 'work');
    return taskDate === date
      && !type.includes('судебное заседание')
      && !type.includes('судебное_заседание')
      && scope !== 'personal'
      && scope !== 'личное';
  });
}

function enrichEmployeeCard(card, date) {
  const name = card.querySelector('h4')?.textContent?.trim();
  if (!name) return;
  const hearings = reportCache.hearings.get(name) || [];
  const tasks = reportCache.tasks.get(name) || [];
  const done = tasks.filter(isTaskDone);
  const remaining = tasks.filter(task => !isTaskDone(task));
  const percent = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;

  const hearingSection = card.querySelector('.reports-hearings-card');
  if (hearingSection) {
    hearingSection.innerHTML = `
      <div class="reports-section-title-row">
        <h5>Судебные заседания на ${escapeHtml(formatRuDate(date))}</h5>
        <button type="button" class="reports-linked-count" data-user-hearings="${escapeAttr(name)}">${hearings.length}</button>
      </div>
      <p class="reports-linked-hint">${hearings.length ? 'Нажмите на количество, чтобы открыть список заседаний.' : 'Судебные заседания на выбранную дату отсутствуют.'}</p>
    `;
  }

  const planSection = card.querySelector('.reports-plan-card');
  if (planSection) {
    planSection.innerHTML = `
      <h5>Выполнение плана на ${escapeHtml(formatRuDate(date))}</h5>
      <div class="reports-plan-main">
        <div>
          <strong>${done.length} из ${tasks.length} задач выполнено</strong>
          <button type="button" class="reports-remaining-link" data-user-remaining="${escapeAttr(name)}">Невыполнено: ${remaining.length}</button>
        </div>
        <span class="reports-plan-percent">${percent}%</span>
      </div>
      <div class="reports-plan-progress" aria-hidden="true"><span style="width:${percent}%"></span></div>
    `;
  }
}

function renderControlledForEmployees(root, names, date) {
  const node = root.querySelector('[data-reports-controlled]');
  if (!node) return;
  const allowed = new Set(names.map(normalize));
  const rows = reportCache.controlled.filter(row => {
    const owner = normalize(row.representative || row.executor || row.employee || '');
    const rowDate = normalizeDate(row.control_date || row.deadline || row.date || row.date_str || row.next_date);
    return allowed.has(owner) && rowDate === date;
  });

  node.classList.add('reports-controlled-two-column');
  node.innerHTML = rows.length ? rows.map(row => {
    const id = row.id || row.controlled_case_id || row.case_id || '';
    return `<button type="button" class="reports-list-row reports-controlled-row" data-reports-controlled-id="${escapeAttr(id)}">
      <strong>${escapeHtml(row.case_number || row.court_case_number || row.case_no || 'Без номера')}</strong>
      <span>${escapeHtml(row.representative || row.executor || 'Сотрудник не указан')}</span>
      <small>${escapeHtml(formatRuDate(date))}</small>
      <p>${escapeHtml(row.subject || row.result || '')}</p>
    </button>`;
  }).join('') : '<div class="reports-empty">Контрольные дела на выбранную дату отсутствуют.</div>';
}

function handleClick(event) {
  const deleteButton = event.target.closest('.appeal-event-delete-cross');
  if (deleteButton && deleteButton.dataset.deleteConfirmed !== '1') {
    event.preventDefault();
    event.stopImmediatePropagation();
    deleteTarget = deleteButton;
    openDeleteDialog();
    return;
  }

  const defaultView = event.target.closest('[data-cases-default-view]');
  if (defaultView) {
    event.preventDefault();
    openViewPreferenceDialog();
    return;
  }

  const viewChoice = event.target.closest('[data-cases-view-choice]');
  if (viewChoice) {
    const value = viewChoice.dataset.casesViewChoice === 'cards' ? 'cards' : 'table';
    localStorage.setItem(VIEW_PREF_KEY, value);
    document.querySelector('[data-cases-view-dialog]')?.close();
    const root = document.querySelector('#cases');
    const target = [...(root?.querySelectorAll('button') || [])].find(button => normalize(button.textContent) === (value === 'cards' ? 'карточки' : 'таблица'));
    target?.click();
    return;
  }

  if (event.target.closest('[data-appeal-delete-no]')) {
    deleteTarget = null;
    document.querySelector('[data-appeal-delete-dialog]')?.close();
    return;
  }
  if (event.target.closest('[data-appeal-delete-yes]')) {
    const button = deleteTarget;
    deleteTarget = null;
    document.querySelector('[data-appeal-delete-dialog]')?.close();
    if (button?.isConnected) {
      button.dataset.deleteConfirmed = '1';
      button.click();
      delete button.dataset.deleteConfirmed;
    }
    return;
  }

  const hearingButton = event.target.closest('[data-user-hearings]');
  if (hearingButton) {
    openListDialog('hearings', hearingButton.dataset.userHearings || '');
    return;
  }
  const remainingButton = event.target.closest('[data-user-remaining]');
  if (remainingButton) {
    openListDialog('tasks', remainingButton.dataset.userRemaining || '');
    return;
  }
  if (event.target.closest('[data-user-list-close]')) {
    document.querySelector('[data-user-list-dialog]')?.close();
    return;
  }

  const hearingRow = event.target.closest('[data-open-hearing-index]');
  if (hearingRow) {
    const name = hearingRow.dataset.employee || '';
    const row = (reportCache.hearings.get(name) || [])[Number(hearingRow.dataset.openHearingIndex)];
    if (row) openHearing(row);
    return;
  }
  const taskRow = event.target.closest('[data-open-task-index]');
  if (taskRow) {
    const name = taskRow.dataset.employee || '';
    const remaining = (reportCache.tasks.get(name) || []).filter(task => !isTaskDone(task));
    const task = remaining[Number(taskRow.dataset.openTaskIndex)];
    if (task) openCalendarTask(task);
  }
}

function ensureDialogs() {
  if (!document.querySelector('[data-appeal-delete-dialog]')) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="user-enhancement-dialog" data-appeal-delete-dialog>
        <h3>Удаление события</h3>
        <p>Вы уверены, что хотите удалить событие?</p>
        <div class="user-enhancement-actions">
          <button class="btn" type="button" data-appeal-delete-no>Нет</button>
          <button class="btn danger" type="button" data-appeal-delete-yes>Да</button>
        </div>
      </dialog>
      <dialog class="user-enhancement-dialog" data-cases-view-dialog>
        <h3>Вид общего перечня</h3>
        <p>При открытии раздела открывать:</p>
        <div class="user-enhancement-actions">
          <button class="btn" type="button" data-cases-view-choice="table">Таблицу</button>
          <button class="btn" type="button" data-cases-view-choice="cards">Карточки</button>
        </div>
      </dialog>
      <dialog class="user-enhancement-dialog reports-user-list-dialog" data-user-list-dialog>
        <div class="user-list-dialog-head"><div><h3 data-user-list-title>Список</h3><p data-user-list-subtitle></p></div><button class="icon-button" type="button" data-user-list-close>×</button></div>
        <div class="user-list-dialog-body" data-user-list-body></div>
        <div class="user-enhancement-actions"><button class="btn primary" type="button" data-user-list-close>Закрыть</button></div>
      </dialog>
    `);
  }
}

function openDeleteDialog() {
  const dialog = document.querySelector('[data-appeal-delete-dialog]');
  if (dialog && !dialog.open) dialog.showModal();
}

function openViewPreferenceDialog() {
  const dialog = document.querySelector('[data-cases-view-dialog]');
  if (dialog && !dialog.open) dialog.showModal();
}

function openListDialog(kind, employeeName) {
  const dialog = document.querySelector('[data-user-list-dialog]');
  if (!dialog) return;
  const title = dialog.querySelector('[data-user-list-title]');
  const subtitle = dialog.querySelector('[data-user-list-subtitle]');
  const body = dialog.querySelector('[data-user-list-body]');
  if (kind === 'hearings') {
    const rows = reportCache.hearings.get(employeeName) || [];
    title.textContent = `Судебные заседания — ${employeeName}`;
    subtitle.textContent = rows.length ? 'Выберите заседание, чтобы открыть его в графике.' : 'Заседаний нет.';
    body.innerHTML = rows.length ? rows.map((row, index) => `<button class="user-list-row" type="button" data-open-hearing-index="${index}" data-employee="${escapeAttr(employeeName)}"><strong>${escapeHtml(row.time || row.start_time || 'Время не указано')} · ${escapeHtml(row.court || 'Суд не указан')}</strong><span>${escapeHtml(row.case_number || row.case_no || row.court_no || row.subject || '')}</span></button>`).join('') : '<div class="reports-empty">Судебные заседания отсутствуют.</div>';
  } else {
    const rows = (reportCache.tasks.get(employeeName) || []).filter(task => !isTaskDone(task));
    title.textContent = `Невыполненные задачи — ${employeeName}`;
    subtitle.textContent = rows.length ? 'Выберите задачу, чтобы открыть её в календаре.' : 'Невыполненных задач нет.';
    body.innerHTML = rows.length ? rows.map((task, index) => `<button class="user-list-row" type="button" data-open-task-index="${index}" data-employee="${escapeAttr(employeeName)}"><strong>${escapeHtml(task.description || task.desc || task.assignment || task.title || task.subject || 'Задача')}</strong><span>${escapeHtml([task.time || task.start_time || '', task.type || task.task_type || ''].filter(Boolean).join(' · '))}</span></button>`).join('') : '<div class="reports-empty">Невыполненных задач нет.</div>';
  }
  if (!dialog.open) dialog.showModal();
}

function openHearing(row) {
  document.querySelector('[data-user-list-dialog]')?.close();
  window.openView?.('schedule');
  const generalCaseId = Number(row.general_case_id || row.case_id || 0);
  if (generalCaseId) {
    window.dispatchEvent(new CustomEvent('schedule:open-general-case', { detail: { generalCaseId } }));
    return;
  }
  const id = String(row.id || row.schedule_id || '');
  if (!id) return;
  waitForElement(`[data-schedule-row="${cssEscape(id)}"]`, element => element.click());
}

function openCalendarTask(task) {
  document.querySelector('[data-user-list-dialog]')?.close();
  window.openView?.('calendar');
  const date = normalizeDate(task.date || task.date_str || task.start_date || task.deadline) || todayIso();
  window.dispatchEvent(new CustomEvent('calendar:select-date', { detail: { date } }));
  window.dispatchEvent(new CustomEvent('calendar:edit-task', { detail: { task } }));
}

function waitForElement(selector, callback, attempts = 30) {
  const element = document.querySelector(selector);
  if (element) {
    callback(element);
    return;
  }
  if (attempts > 0) setTimeout(() => waitForElement(selector, callback, attempts - 1), 100);
}

function isTaskDone(task) {
  if (Number(task.done || task.completed || task.is_done || 0) === 1) return true;
  return ['done', 'completed', 'выполнено'].includes(normalize(task.status || task.state || ''));
}

function readViewPreference() {
  const value = localStorage.getItem(VIEW_PREF_KEY);
  return value === 'cards' ? 'cards' : 'table';
}

function stableHue(value) {
  let hash = 0;
  for (const char of normalize(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function normalizeDate(value) {
  const text = String(value || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
}

function formatRuDate(value) {
  const iso = normalizeDate(value);
  if (!iso) return String(value || '');
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}
