import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';
import { getCurrentUserName } from '../../auth/session.js';

const DEFAULT_COURTS = [
  'Железнодорожный районный суд г.Барнаула',
  'Октябрьский районный суд г.Барнаула',
  'Индустриальный районный суд г.Барнаула',
  'Арбитражный суд Алтайского края',
  'Центральный районный суд г.Барнаула'
];

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

let state = {
  initialized: false,
  rows: [],
  filteredRows: [],
  selectedId: null,
  selectedType: '',
  selectedSessionDate: '',
  dateFilter: '',
  search: '',
  collapsedDates: new Set(),
  autoDateInitialized: false,
  miniMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  miniSelectedDate: formatTodayRu()
};

export function initSchedulePage() {
  if (state.initialized) return;
  state.initialized = true;

  document.addEventListener('click', event => {
    const refresh = event.target.closest('[data-schedule-refresh]');
    if (refresh) {
      event.preventDefault();
      loadSchedule();
      return;
    }

    const dateNew = event.target.closest('[data-schedule-date-new]');
    if (dateNew) {
      event.preventDefault();
      openDateDialog();
      return;
    }

    const dateClose = event.target.closest('[data-schedule-date-close]');
    if (dateClose) {
      event.preventDefault();
      closeDateDialog();
      return;
    }

    const dateToday = event.target.closest('[data-schedule-date-today]');
    if (dateToday) {
      event.preventDefault();
      setMiniCalendarDate(new Date());
      return;
    }

    const miniPrev = event.target.closest('[data-schedule-mini-prev]');
    if (miniPrev) {
      event.preventDefault();
      state.miniMonth = new Date(state.miniMonth.getFullYear(), state.miniMonth.getMonth() - 1, 1);
      renderMiniDatePicker();
      return;
    }

    const miniNext = event.target.closest('[data-schedule-mini-next]');
    if (miniNext) {
      event.preventDefault();
      state.miniMonth = new Date(state.miniMonth.getFullYear(), state.miniMonth.getMonth() + 1, 1);
      renderMiniDatePicker();
      return;
    }

    const miniDay = event.target.closest('[data-schedule-mini-day]');
    if (miniDay) {
      event.preventDefault();
      const iso = miniDay.dataset.scheduleMiniDay || '';
      const date = isoToDate(iso);
      if (date) setMiniCalendarDate(date);
      return;
    }

    const dateSave = event.target.closest('[data-schedule-date-save]');
    if (dateSave) {
      event.preventDefault();
      saveDateRow();
      return;
    }

    const addForDate = event.target.closest('[data-schedule-add-case-date]');
    if (addForDate) {
      event.preventDefault();
      event.stopPropagation();
      const sessionDate = addForDate.dataset.scheduleAddCaseDate || '';
      selectDateGroup(sessionDate, addForDate.dataset.scheduleDateId || '');
      openCaseDialogForCreate(sessionDate);
      return;
    }

    const editCase = event.target.closest('[data-schedule-edit-case]');
    if (editCase) {
      event.preventDefault();
      event.stopPropagation();
      const id = editCase.dataset.scheduleEditCase || '';
      const row = state.rows.find(item => String(item.id) === String(id));
      if (!row) {
        alert('Не удалось найти выбранную запись.');
        return;
      }
      openScheduleRow(row, editCase.closest('[data-schedule-row]'), { forceEditor: true });
      return;
    }

    const dateDelete = event.target.closest('[data-schedule-date-delete]');
    if (dateDelete) {
      event.preventDefault();
      event.stopPropagation();
      deleteScheduleDateGroup(dateDelete.dataset.scheduleDateDelete || '', dateDelete.dataset.scheduleDateId || '');
      return;
    }

    const groupToggle = event.target.closest('[data-schedule-group-toggle]');
    if (groupToggle) {
      event.preventDefault();
      const date = groupToggle.dataset.scheduleGroupToggle || '';
      toggleGroup(date);
      return;
    }

    const datePick = event.target.closest('[data-schedule-date-pick]');
    if (datePick) {
      event.preventDefault();
      selectDateGroup(datePick.dataset.scheduleDatePick || '', datePick.dataset.scheduleDateId || '');
      return;
    }

    const row = event.target.closest('[data-schedule-row]');
    if (row) {
      event.preventDefault();
      const record = state.rows.find(item => String(item.id) === String(row.dataset.scheduleRow));
      if (record && row.dataset.scheduleType === 'case') {
        openScheduleRow(record, row);
      } else {
        selectRow(row.dataset.scheduleRow, row.dataset.scheduleType, row.dataset.sessionDate || '');
      }
      return;
    }

    const caseClose = event.target.closest('[data-schedule-case-close]');
    if (caseClose) {
      event.preventDefault();
      closeCaseDialog();
      return;
    }

    const caseMore = event.target.closest('[data-schedule-case-more]');
    if (caseMore) {
      event.preventDefault();
      openScheduleSelectedSource();
      return;
    }

    const hearingToday = event.target.closest('[data-schedule-hearing-today]');
    if (hearingToday) {
      event.preventDefault();
      const form = document.querySelector('[data-schedule-case-form]');
      if (form?.elements.hearing_date) form.elements.hearing_date.value = formatTodayRu();
      return;
    }

    const deleteBtn = event.target.closest('[data-schedule-delete]');
    if (deleteBtn) {
      event.preventDefault();
      deleteSelected();
    }
  });

  document.addEventListener('input', event => {
    if (event.target.matches('[data-schedule-search]')) {
      state.search = event.target.value;
      clearTimeout(window.__scheduleSearchTimer);
      window.__scheduleSearchTimer = setTimeout(applySearchAndRender, 150);
    }

    if (event.target.matches('[data-schedule-time]')) {
      formatTimeInput(event.target);
    }

    if (event.target.matches('[data-schedule-date]')) {
      formatRuDateInput(event.target);
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-schedule-case-form]')) {
      event.preventDefault();
      saveCase(event.target);
    }
  });

  window.addEventListener('schedule:reload', loadSchedule);
  window.addEventListener('schedule:open-general-case', event => {
    const generalCaseId = Number(event.detail?.generalCaseId || event.detail?.general_case_id || 0);
    if (generalCaseId) openScheduleByGeneralCaseId(generalCaseId);
  });

  checkDb();
  fillDatalists();
  loadSchedule();
}

async function checkDb() {
  const node = document.querySelector('[data-schedule-db-status]');
  if (!node) return;

  try {
    await dbApi.health();
    node.textContent = 'База подключена';
  } catch {
    node.textContent = 'API базы недоступен';
  }
}

async function fillDatalists() {
  const courtsNode = document.querySelector('#scheduleCourtsList');
  const repsNode = document.querySelector('#scheduleRepresentativesList');
  const stagesNode = document.querySelector('#scheduleStagesList');

  try {
    const courts = await dbApi.getOptions('court');
    const values = courts.length ? courts : DEFAULT_COURTS;
    if (courtsNode) courtsNode.innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  } catch {
    if (courtsNode) courtsNode.innerHTML = DEFAULT_COURTS.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  }

  try {
    const reps = await dbApi.getUsers();
    if (repsNode) repsNode.innerHTML = reps.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  } catch {
    if (repsNode) repsNode.innerHTML = '';
  }

  try {
    const stages = await dbApi.getOptions('stage');
    if (stagesNode) stagesNode.innerHTML = stages.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  } catch {
    if (stagesNode) stagesNode.innerHTML = '';
  }
}

async function loadSchedule() {
  const groupsNode = document.querySelector('[data-schedule-groups]');
  const datesNode = document.querySelector('[data-schedule-date-list]');
  if (!groupsNode || !datesNode) return;

  groupsNode.innerHTML = '<div class="schedule-empty-line">Загрузка...</div>';
  datesNode.innerHTML = '<div class="schedule-empty-line">Загрузка...</div>';

  try {
    state.rows = await dbApi.getCourtSchedule();
    applySearchAndRender();
  } catch (error) {
    groupsNode.innerHTML = `<div class="schedule-empty-line error">Не удалось загрузить график: ${escapeHtml(error.message)}</div>`;
    datesNode.innerHTML = '<div class="schedule-empty-line">Нет дат</div>';
    state.filteredRows = [];
    updateCount();
    updateDateTotal([]);
  }
}

function applySearchAndRender() {
  state.filteredRows = filterRows(state.rows, state.search);
  autoSelectInitialScheduleDate();
  renderScheduleTable();

  window.dispatchEvent(new CustomEvent('schedule:updated', { detail: getCaseRows(getVisibleRows()) }));
}

function filterRows(rows, search) {
  const parts = String(search || '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  if (!parts.length) return [...rows];

  return rows.filter(row => {
    const haystack = [
      row.session_date,
      normalizeRuDate(row.session_date),
      row.court,
      row.time,
      row.representative,
      row.plaintiff,
      row.defendant,
      row.category,
      row.result,
      row.hearing_date,
      normalizeRuDate(row.hearing_date),
      Number(row.is_date_row) === 1 ? 'дата группа' : 'дело'
    ].map(value => String(value ?? '').toLowerCase()).join(' | ');

    return parts.every(part => haystack.includes(part));
  });
}

function renderScheduleTable() {
  const datesNode = document.querySelector('[data-schedule-date-list]');
  const groupsNode = document.querySelector('[data-schedule-groups]');
  if (!datesNode || !groupsNode) return;

  const grouped = buildGroupedRows(state.filteredRows);
  const visibleGroups = getVisibleGroups(grouped);
  updateDateTotal(visibleGroups);
  updateCount(getVisibleRows());

  if (!grouped.length) {
    datesNode.innerHTML = '<div class="schedule-empty-line">Даты не найдены</div>';
    groupsNode.innerHTML = '<div class="schedule-empty-line">Записей не найдено</div>';
    return;
  }

  datesNode.innerHTML = grouped.map((group, index) => {
    const isSelectedDate = isSelectedGroup(group);
    const isOpen = !state.collapsedDates.has(group.sessionDate);

    return `
      <div class="schedule-date-nav-item ${isSelectedDate ? 'active' : ''}" data-schedule-date-pick="${escapeAttr(group.sessionDate)}" data-schedule-date-id="${group.dateId || ''}">
        <button class="schedule-date-nav-main" type="button">
          <span class="schedule-date-nav-icon">▣</span>
          <strong>${escapeHtml(group.sessionDate)}</strong>
          <button class="schedule-date-delete" data-schedule-date-delete="${escapeAttr(group.sessionDate)}" data-schedule-date-id="${group.dateId || ''}" type="button" title="Удалить дату">×</button>
          <span class="schedule-date-nav-count">${group.cases.length} ${declineCases(group.cases.length)}</span>
        </button>
      </div>
    `;
  }).join('');

  const selectedDateToolbar = renderSelectedDateToolbar(visibleGroups);

  if (!visibleGroups.length) {
    groupsNode.innerHTML = `${selectedDateToolbar}<div class="schedule-empty-line">Записей на выбранную дату не найдено</div>`;
    return;
  }

  groupsNode.innerHTML = `${selectedDateToolbar}${visibleGroups.map(group => renderGroup(group)).join('')}`;
}

function getVisibleGroups(grouped) {
  if (!state.dateFilter) return grouped;
  return grouped.filter(group => normalizeRuDate(group.sessionDate) === state.dateFilter);
}

function getVisibleRows() {
  if (!state.dateFilter) return state.filteredRows;
  return state.filteredRows.filter(row => normalizeRuDate(row.session_date) === state.dateFilter);
}

function renderSelectedDateToolbar(visibleGroups = []) {
  const selectedDate = normalizeRuDate(state.selectedSessionDate) || normalizeRuDate(state.dateFilter) || state.dateFilter;
  if (!selectedDate) return '';

  const currentGroup = visibleGroups.find(group => normalizeRuDate(group.sessionDate) === selectedDate);
  const dateId = currentGroup?.dateId || '';

  return `
    <div class="schedule-selected-date-toolbar">
      <div>
        <span>Выбранная дата</span>
        <strong>${escapeHtml(selectedDate)}</strong>
      </div>
      <button class="btn primary schedule-add-case-action" data-schedule-add-case-date="${escapeAttr(selectedDate)}" data-schedule-date-id="${dateId}" type="button">Добавить запись</button>
    </div>
  `;
}

function renderGroup(group) {
  const isOpen = !state.collapsedDates.has(group.sessionDate);
  const isSelectedDate = isSelectedGroup(group);
  const headerClass = isSelectedDate ? 'selected' : '';

  return `
    <article class="schedule-date-section ${isOpen ? 'open' : 'collapsed'} ${headerClass}" data-schedule-date-section="${escapeAttr(group.sessionDate)}">
      <header class="schedule-date-section-head" data-schedule-date-pick="${escapeAttr(group.sessionDate)}" data-schedule-date-id="${group.dateId || ''}">
        <div class="schedule-group-title">
          <span class="schedule-group-calendar">▣</span>
          <strong>${escapeHtml(group.sessionDate)}</strong>
          <span>${group.cases.length} ${declineCases(group.cases.length)}</span>
        </div>
      </header>
      <div class="schedule-date-section-body">
        ${renderCaseGrid(group.cases, group.sessionDate)}
      </div>
      <button class="schedule-group-chevron schedule-group-chevron-bottom" data-schedule-group-toggle="${escapeAttr(group.sessionDate)}" type="button" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${isOpen ? 'Свернуть заседания' : 'Развернуть заседания'}" title="${isOpen ? 'Свернуть заседания' : 'Развернуть заседания'}">${renderChevronIcon(isOpen ? 'up' : 'down')}</button>
    </article>
  `;
}

function renderCaseGrid(cases, sessionDate) {
  const rows = cases.length
    ? cases.map(item => renderCaseCardRow(item)).join('')
    : `
      <div class="schedule-case-empty">
        <span>На ${escapeHtml(sessionDate)} дел нет</span>
      </div>
    `;

  return `
    <div class="schedule-case-grid-head">
      <span>Суд</span>
      <span>Время</span>
      <span>Представитель</span>
      <span>Истец</span>
      <span>Ответчик</span>
      <span>Результат</span>
      <span>Предмет спора</span>
      <span>Дата СЗ</span>
    </div>
    <div class="schedule-case-grid-rows">
      ${rows}
    </div>
  `;
}

function renderCaseCardRow(item) {
  const isSelected = state.selectedType === 'case' && String(state.selectedId) === String(item.id);
  const sessionDate = normalizeRuDate(item.session_date) || item.session_date;
  const hearingDate = normalizeRuDate(item.hearing_date) || item.hearing_date;

  return `
    <div
      class="schedule-case-card-row ${isSelected ? 'selected' : ''}"
      data-schedule-row="${item.id}"
      data-schedule-type="case"
      data-session-date="${escapeAttr(sessionDate)}"
    >
      <button class="schedule-case-edit-pencil" data-schedule-edit-case="${item.id}" type="button" aria-label="Редактировать" title="Редактировать">✎</button>
      ${item.meeting_id ? '<span class="schedule-attendance-mark">Совещание</span>' : (item.general_case_id ? '<span class="schedule-attendance-mark">Явочное</span>' : '')}
      <div class="schedule-cell schedule-court-cell">${formatText(item.court)}</div>
      <div class="schedule-cell schedule-time-cell">${item.time ? `<span class="time-pill">${escapeHtml(item.time)}</span>` : '<span class="muted">—</span>'}</div>
      <div class="schedule-cell">${formatText(item.representative)}</div>
      <div class="schedule-cell">${formatText(item.plaintiff)}</div>
      <div class="schedule-cell">${formatText(item.defendant)}</div>
      <div class="schedule-cell">${formatText(item.category)}</div>
      <div class="schedule-cell">${formatText(item.result)}</div>
      <div class="schedule-cell schedule-date-cell">${formatText(hearingDate)}</div>
    </div>
  `;
}

function buildGroupedRows(rows) {
  const dateRows = rows.filter(row => Number(row.is_date_row) === 1);
  const caseRows = rows.filter(row => Number(row.is_date_row) !== 1);

  const byDate = new Map();

  dateRows.forEach(row => {
    const date = normalizeRuDate(row.session_date) || String(row.session_date || '').trim();
    if (!date) return;
    byDate.set(date, {
      sessionDate: date,
      dateId: row.id,
      cases: []
    });
  });

  caseRows.forEach(row => {
    const date = normalizeRuDate(row.session_date) || String(row.session_date || '').trim() || 'Без даты';
    if (!byDate.has(date)) {
      byDate.set(date, {
        sessionDate: date,
        dateId: '',
        cases: []
      });
    }

    byDate.get(date).cases.push(row);
  });

  const groups = Array.from(byDate.values());

  groups.forEach(group => {
    group.cases.sort((a, b) => parseRuDateForSort(a.hearing_date || a.session_date) - parseRuDateForSort(b.hearing_date || b.session_date) || String(a.time || '').localeCompare(String(b.time || '')));
  });

  groups.sort((a, b) => parseRuDateForSort(a.sessionDate) - parseRuDateForSort(b.sessionDate));

  return groups;
}


function autoSelectInitialScheduleDate() {
  if (state.autoDateInitialized || state.dateFilter) return;
  const groups = buildGroupedRows(state.filteredRows || []);
  if (!groups.length) {
    state.autoDateInitialized = true;
    return;
  }

  const groupsWithCases = groups.filter(group => group.cases.length > 0);
  const sourceGroups = groupsWithCases.length ? groupsWithCases : groups;
  const todayTs = startOfDay(new Date()).getTime();
  const datedGroups = sourceGroups
    .map(group => ({ ...group, sortTs: parseRuDateForSort(group.sessionDate) }))
    .filter(group => Number.isFinite(group.sortTs) && group.sortTs !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => a.sortTs - b.sortTs);

  const todayGroup = datedGroups.find(group => group.sortTs === todayTs);
  const nextGroup = datedGroups.find(group => group.sortTs >= todayTs);
  const nearest = todayGroup || nextGroup || datedGroups[datedGroups.length - 1] || sourceGroups[0];

  state.selectedId = nearest.dateId || null;
  state.selectedType = 'date';
  state.selectedSessionDate = nearest.sessionDate;
  state.dateFilter = normalizeRuDate(nearest.sessionDate) || nearest.sessionDate;
  state.autoDateInitialized = true;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function deleteScheduleDateGroup(sessionDate, dateId = '') {
  const normalizedDate = normalizeRuDate(sessionDate) || sessionDate || '';
  if (!normalizedDate) return;

  const targets = (state.rows || []).filter(row => normalizeRuDate(row.session_date) === normalizedDate);
  const caseCount = targets.filter(row => Number(row.is_date_row) !== 1).length;
  const question = caseCount
    ? `Удалить дату ${normalizedDate} и ${caseCount} ${declineCases(caseCount)} на эту дату?`
    : `Удалить дату ${normalizedDate}?`;

  if (!confirm(question)) return;

  const ids = Array.from(new Set(targets.map(row => Number(row.id || 0)).filter(Boolean)));
  if (dateId && !ids.includes(Number(dateId))) ids.unshift(Number(dateId));

  try {
    for (const id of ids) await dbApi.deleteCourtSchedule(id);
    state.selectedId = null;
    state.selectedType = '';
    state.selectedSessionDate = '';
    state.dateFilter = '';
    state.autoDateInitialized = false;
    showNotification('Дата удалена');
    await loadSchedule();
  } catch (error) {
    alert('Не удалось удалить дату:\n' + error.message);
  }
}

function getCaseRows(rows) {
  return rows.filter(row => Number(row.is_date_row) !== 1);
}

function updateCount(rows = state.filteredRows) {
  const node = document.querySelector('[data-schedule-count]');
  const count = getCaseRows(rows).length;
  if (node) node.textContent = `${count} ${declineCases(count)}`;
}

function updateDateTotal(grouped) {
  const node = document.querySelector('[data-schedule-date-total]');
  if (!node) return;
  const casesCount = grouped.reduce((sum, group) => sum + group.cases.length, 0);
  node.textContent = `${casesCount} ${declineCases(casesCount)} в ${grouped.length} ${declineDates(grouped.length)}`;
}

function declineCases(n) {
  const last = Math.abs(n) % 10;
  const lastTwo = Math.abs(n) % 100;
  if (last === 1 && lastTwo !== 11) return 'дело';
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo)) return 'дела';
  return 'дел';
}

function declineDates(n) {
  const last = Math.abs(n) % 10;
  const lastTwo = Math.abs(n) % 100;
  if (last === 1 && lastTwo !== 11) return 'дате';
  return 'датах';
}

function isSelectedGroup(group) {
  return Boolean(state.dateFilter) && state.dateFilter === group.sessionDate;
}

function selectDateGroup(sessionDate, dateId = '') {
  const normalizedDate = normalizeRuDate(sessionDate) || sessionDate || '';

  if (state.dateFilter && state.dateFilter === normalizedDate) {
    state.selectedId = null;
    state.selectedType = '';
    state.selectedSessionDate = '';
    state.dateFilter = '';
    renderScheduleTable();
    return;
  }

  state.selectedId = dateId || null;
  state.selectedType = 'date';
  state.selectedSessionDate = normalizedDate;
  state.dateFilter = normalizedDate;
  renderScheduleTable();
}

function selectRow(id, type, sessionDate) {
  state.selectedId = id || null;
  state.selectedType = type || '';
  state.selectedSessionDate = normalizeRuDate(sessionDate) || sessionDate || '';
  renderScheduleTable();
}

function toggleGroup(sessionDate) {
  const normalizedDate = normalizeRuDate(sessionDate) || sessionDate;
  if (!normalizedDate) return;
  if (state.collapsedDates.has(normalizedDate)) state.collapsedDates.delete(normalizedDate);
  else state.collapsedDates.add(normalizedDate);
  renderScheduleTable();
}

function openDateDialog() {
  const dialog = document.querySelector('[data-schedule-date-dialog]');
  setMiniCalendarDate(new Date(), false);
  renderMiniDatePicker();
  dialog?.showModal();
}

function closeDateDialog() {
  document.querySelector('[data-schedule-date-dialog]')?.close();
}

function setMiniCalendarDate(date, rerender = true) {
  state.miniSelectedDate = dateToRu(date);
  state.miniMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const input = document.querySelector('[data-schedule-date-input]');
  if (input) input.value = state.miniSelectedDate;
  if (rerender) renderMiniDatePicker();
}

function renderMiniDatePicker() {
  const title = document.querySelector('[data-schedule-mini-title]');
  const daysNode = document.querySelector('[data-schedule-mini-days]');
  const input = document.querySelector('[data-schedule-date-input]');
  if (!daysNode) return;

  const year = state.miniMonth.getFullYear();
  const month = state.miniMonth.getMonth();
  if (title) title.textContent = `${MONTHS_RU[month]} ${year}`;
  if (input) input.value = state.miniSelectedDate;

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const todayIso = dateToIso(new Date());
  const selectedIso = ruDateToIso(state.miniSelectedDate);
  const cells = [];

  for (let i = 0; i < offset; i += 1) cells.push('<span class="schedule-mini-day empty"></span>');

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const iso = dateToIso(date);
    cells.push(`
      <button
        class="schedule-mini-day ${iso === todayIso ? 'today' : ''} ${iso === selectedIso ? 'selected' : ''}"
        data-schedule-mini-day="${iso}"
        type="button"
      >${day}</button>
    `);
  }

  daysNode.innerHTML = cells.join('');
}

async function saveDateRow() {
  const input = document.querySelector('[data-schedule-date-input]');
  const value = String(input?.value || state.miniSelectedDate || '').trim();

  if (!isValidRuDate(value)) {
    alert('Выберите дату в мини-календаре');
    return;
  }

  try {
    const created = await dbApi.createCourtScheduleDate({ session_date: value });
    state.selectedId = created.id;
    state.selectedType = 'date';
    state.selectedSessionDate = normalizeRuDate(value) || value;
    state.dateFilter = state.selectedSessionDate;
    closeDateDialog();
    showNotification('Дата добавлена');
    await loadSchedule();
  } catch (error) {
    alert('Не удалось добавить дату:\n' + error.message);
  }
}

function getSelectedSessionDate() {
  if (state.selectedSessionDate) return normalizeRuDate(state.selectedSessionDate) || state.selectedSessionDate;

  if (state.selectedType === 'case') {
    const row = state.rows.find(item => String(item.id) === String(state.selectedId));
    if (row?.session_date) return normalizeRuDate(row.session_date) || row.session_date;
  }

  return '';
}

function openCaseDialogForCreate(sessionDateOverride = '') {
  const sessionDate = sessionDateOverride || getSelectedSessionDate();

  if (!sessionDate) {
    alert('Выберите дату-группу или нажмите плюс рядом с нужной датой.');
    return;
  }

  openCaseDialog({
    id: '',
    session_date: sessionDate,
    court: '',
    time: '',
    representative: getCurrentUserName(),
    plaintiff: '',
    defendant: '',
    category: '',
    result: '',
    hearing_date: '',
    general_case_id: '',
    meeting_id: ''
  }, 'create');
}

function openCaseDialog(row, mode) {
  const dialog = document.querySelector('[data-schedule-case-dialog]');
  const form = document.querySelector('[data-schedule-case-form]');
  if (!dialog || !form) return;

  form.reset();

  form.elements.id.value = row.id || '';
  form.elements.session_date.value = normalizeRuDate(row.session_date) || row.session_date || '';
  form.elements.court.value = row.court || '';
  form.elements.time.value = row.time || '';
  form.elements.representative.value = row.representative || '';
  form.elements.plaintiff.value = row.plaintiff || '';
  form.elements.defendant.value = row.defendant || '';
  form.elements.category.value = row.category || '';
  form.elements.result.value = row.result || '';
  form.elements.hearing_date.value = normalizeRuDate(row.hearing_date) || row.hearing_date || '';
  if (form.elements.general_case_id) form.elements.general_case_id.value = row.general_case_id || '';
  if (form.elements.meeting_id) form.elements.meeting_id.value = row.meeting_id || '';

  const title = document.querySelector('[data-schedule-case-title]');
  const subtitle = document.querySelector('[data-schedule-case-subtitle]');
  const hearingWrap = document.querySelector('[data-schedule-hearing-date-wrap]');
  const moreButton = document.querySelector('[data-schedule-case-more]');
  const deleteButton = document.querySelector('[data-schedule-delete]');
  const hasLink = Boolean(row.meeting_id || row.general_case_id);

  if (title) title.textContent = mode === 'edit' ? 'Редактировать дело' : 'Добавить дело';
  if (subtitle) subtitle.textContent = `Дата-группа: ${normalizeRuDate(row.session_date) || row.session_date || ''}`;

  if (hearingWrap) hearingWrap.hidden = mode !== 'edit';
  if (moreButton) moreButton.hidden = !hasLink;
  if (deleteButton) deleteButton.hidden = mode !== 'edit' || !row.id;

  dialog.showModal();
}

function closeCaseDialog() {
  document.querySelector('[data-schedule-case-dialog]')?.close();
}

async function saveCase(form) {
  const data = formToCaseData(form);
  const isEdit = Boolean(data.id);

  if (data.time) {
    const cleanTime = data.time.replace(':', '');
    if (cleanTime.length !== 4 || !/^\d+$/.test(cleanTime)) {
      alert('Время должно быть в формате ЧЧ:ММ');
      return;
    }
  }

  try {
    if (isEdit && data.hearing_date) {
      if (!isValidRuDate(data.hearing_date)) {
        alert('Дата СЗ должна быть в формате ДД.ММ.ГГГГ');
        return;
      }

      const movedData = { ...data, session_date: data.hearing_date, hearing_date: '' };

      await dbApi.createCourtScheduleDate({ session_date: data.hearing_date });
      const created = await dbApi.createCourtScheduleCase(movedData);
      await addScheduleCaseToCalendar(data.hearing_date, { ...movedData, schedule_id: created.id });
      await dbApi.deleteCourtSchedule(data.id);

      state.selectedId = created.id;
      state.selectedType = 'case';
      state.selectedSessionDate = normalizeRuDate(data.hearing_date) || data.hearing_date;
      state.dateFilter = state.selectedSessionDate;

      showNotification(`Дело перенесено на дату: ${data.hearing_date}`);
    } else if (isEdit) {
      const updated = await dbApi.updateCourtSchedule(data.id, data);
      state.selectedId = updated.id || data.id;
      state.selectedType = 'case';
      state.selectedSessionDate = normalizeRuDate(data.session_date) || data.session_date;
      showNotification('Дело обновлено');
    } else {
      const created = await dbApi.createCourtScheduleCase(data);
      await addScheduleCaseToCalendar(data.session_date, { ...data, schedule_id: created.id });
      state.selectedId = created.id;
      state.selectedType = 'case';
      state.selectedSessionDate = normalizeRuDate(data.session_date) || data.session_date;
      state.dateFilter = state.selectedSessionDate;
      showNotification('Дело добавлено в график и перенесено в календарь');
    }

    closeCaseDialog();
    await loadSchedule();
    window.dispatchEvent(new CustomEvent('calendar:reload'));
  } catch (error) {
    alert('Не удалось сохранить дело:\n' + error.message);
  }
}

function formToCaseData(form) {
  return {
    id: form.elements.id.value || '',
    session_date: form.elements.session_date.value || '',
    court: form.elements.court.value.trim(),
    time: form.elements.time.value.trim(),
    representative: form.elements.representative.value.trim(),
    plaintiff: form.elements.plaintiff.value.trim(),
    defendant: form.elements.defendant.value.trim(),
    category: form.elements.category.value.trim(),
    result: form.elements.result.value.trim(),
    hearing_date: form.elements.hearing_date.value.trim(),
    general_case_id: form.elements.general_case_id?.value || null,
    meeting_id: form.elements.meeting_id?.value || null
  };
}

async function addScheduleCaseToCalendar(sessionDate, caseData) {
  const calendarDate = ruDateToIso(sessionDate);

  if (!calendarDate) {
    showNotification('Дело сохранено в графике, но не перенесено в календарь: некорректная дата');
    return;
  }

  const task = {
    date: calendarDate,
    user: getCurrentUserName(),
    type: 'судебное_заседание',
    desc: caseData.result || 'Судебное заседание',
    time: caseData.time || '',
    court: caseData.court || '',
    subject: caseData.result || '',
    assignment: [
      `Истец: ${caseData.plaintiff || ''}`,
      `Ответчик: ${caseData.defendant || ''}`,
      `Представитель: ${caseData.representative || ''}`,
      `Результат: ${caseData.category || ''}`
    ].join('\n'),
    done: 0,
    meeting_id: caseData.meeting_id || null,
    general_case_id: caseData.general_case_id || null,
    schedule_id: caseData.schedule_id || null
  };

  try {
    await dbApi.createCalendarTask(task);
  } catch (error) {
    showNotification('Дело сохранено в графике, но не перенесено в календарь');
    console.warn('calendar sync error', error);
  }
}

function openScheduleRow(row, sourceElement = null, options = {}) {
  if (!row) return;

  selectRow(row.id, 'case', row.session_date || '');
  animateOpenFromElement(sourceElement);

  setTimeout(() => openCaseDialog(row, 'edit'), sourceElement ? 160 : 0);
}


async function openScheduleByGeneralCaseId(generalCaseId) {
  const id = Number(generalCaseId || 0);
  if (!id) return;

  if (!state.rows.length) {
    await loadSchedule();
  }

  const row = state.rows.find(item =>
    Number(item.general_case_id || 0) === id && Number(item.is_date_row || 0) !== 1
  );

  if (!row) {
    showNotification('В графике не найдено заседание для этого явочного дела', 'error');
    return;
  }

  selectDateGroup(row.session_date || row.hearing_date || '', '');
  openScheduleRow(row, null, { forceEditor: true });
  showNotification('Открыто связанное заседание в графике');
}

function openScheduleSelectedSource() {
  const form = document.querySelector('[data-schedule-case-form]');
  const meetingId = Number(form?.elements.meeting_id?.value || 0);
  const generalCaseId = Number(form?.elements.general_case_id?.value || 0);

  if (meetingId) {
    openLinkedMeetingFromSchedule(meetingId);
    return;
  }

  if (generalCaseId) {
    openLinkedGeneralCaseFromSchedule(generalCaseId);
    return;
  }

  alert('У этой записи графика нет связи с общим перечнем дел или совещанием.');
}

function openLinkedGeneralCaseFromSchedule(generalCaseId) {
  const id = Number(generalCaseId || 0);
  if (!id) return;

  closeCaseDialog();
  document.querySelector('[data-view="cases"]')?.click();

  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('general-cases:open-case', { detail: { id, sourceView: 'schedule' } }));
  }, 160);

  showNotification('Открываю явочное дело в общем перечне');
}

function openLinkedMeetingFromSchedule(meetingId) {
  const id = Number(meetingId || 0);
  if (!id) return;

  closeCaseDialog();
  document.querySelector('[data-view="meetings"]')?.click();

  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('meetings:open-meeting', { detail: { id } }));
  }, 160);

  showNotification('Открываю связанное совещание');
}

async function deleteSelected() {
  const form = document.querySelector('[data-schedule-case-form]');
  const dialog = document.querySelector('[data-schedule-case-dialog]');
  const editId = dialog?.open ? Number(form?.elements.id?.value || 0) : 0;
  const targetId = editId || state.selectedId;

  if (!targetId) {
    alert('Выберите элемент для удаления.');
    return;
  }

  if (!confirm('Удалить выбранный элемент?')) return;

  try {
    await dbApi.deleteCourtSchedule(targetId);
    showNotification('Запись удалена');
    state.selectedId = null;
    state.selectedType = '';
    state.selectedSessionDate = '';
    state.dateFilter = '';
    closeCaseDialog();
    await loadSchedule();
  } catch (error) {
    alert('Не удалось удалить:\n' + error.message);
  }
}

function animateOpenFromElement(element) {
  if (!element) return;
  element.classList.remove('schedule-card-opening');
  void element.offsetWidth;
  element.classList.add('schedule-card-opening');
  setTimeout(() => element.classList.remove('schedule-card-opening'), 520);
}

function parseRuDateForSort(value) {
  const [day, month, year] = String(normalizeRuDate(value) || value || '').split('.').map(Number);
  if (!day || !month || !year) return Number.MAX_SAFE_INTEGER;
  return new Date(year, month - 1, day).getTime();
}

function ruDateToIso(value) {
  const [day, month, year] = String(normalizeRuDate(value) || value || '').split('.').map(Number);
  if (!day || !month || !year) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeRuDate(value) {
  const [day, month, year] = String(value || '').trim().split('.').map(Number);
  if (!day || !month || !year) return '';
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

function isoToDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function dateToIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToRu(date) {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear()
  ].join('.');
}

function isValidRuDate(value) {
  const [day, month, year] = String(value || '').split('.').map(Number);
  if (!day || !month || !year) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatTodayRu() {
  return dateToRu(new Date());
}

function formatTimeInput(input) {
  let digits = String(input.value || '').replace(/\D/g, '').slice(0, 4);
  input.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function formatRuDateInput(input) {
  let digits = String(input.value || '').replace(/\D/g, '').slice(0, 8);

  if (digits.length > 4) input.value = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  else if (digits.length > 2) input.value = `${digits.slice(0, 2)}.${digits.slice(2)}`;
  else input.value = digits;
}

function formatText(value) {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}

function renderChevronIcon(direction) {
  const paths = {
    up: 'm18 15-6-6-6 6',
    down: 'm6 9 6 6 6-6',
  };
  return `<svg class="schedule-chevron-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[direction]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
