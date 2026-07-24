import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';
import * as XLSX from 'xlsx';

const OPTION_MAP = {
  court: '#emergencyCourtList',
  stage: '#emergencyStageList',
  requirements: '#emergencyRequirementsList',
  prosecutor: '#emergencyProsecutorList',
  district: '#emergencyDistrictList'
};

const VIEW_MODE_KEY = 'legal-dashboard-emergency-view-mode-v1';

let state = {
  initialized: false,
  rows: [],
  filteredRows: [],
  selectedId: null,
  search: '',
  viewMode: localStorage.getItem(VIEW_MODE_KEY) || 'cards',
  importMatches: [],
  activeFormSection: 'basic',
  expandedCardIds: new Set()
};

export function initEmergencyFundPage() {
  if (state.initialized) return;
  state.initialized = true;

  document.addEventListener('click', event => {
    if (event.target.closest('[data-emergency-refresh]')) { loadEmergencyFund(); return; }
    if (event.target.closest('[data-emergency-new]')) { clearForm(false); openEditor(); return; }
    if (event.target.closest('[data-emergency-open]')) { handleEditorToggleClick(); return; }
    if (event.target.closest('[data-emergency-delete]')) { deleteCurrentFromEditor(); return; }
    if (event.target.closest('[data-emergency-archive]')) { archiveSelected(); return; }
    if (event.target.closest('[data-emergency-archive-open]')) { openEmergencyArchive(); return; }
    if (event.target.closest('[data-emergency-archive-close]')) { closeEmergencyArchive(); return; }
    if (event.target.closest('[data-emergency-upload]')) { document.querySelector('[data-emergency-upload-input]')?.click(); return; }
    if (event.target.closest('[data-emergency-import-close]')) { closeImportDialog(); return; }
    if (event.target.closest('[data-emergency-import-apply]')) { applyImportMatches(); return; }
    if (event.target.closest('[data-emergency-reports-open]')) { openReportsDialog(); return; }
    if (event.target.closest('[data-emergency-reports-close]')) { closeReportsDialog(); return; }

    const sectionButton = event.target.closest('[data-emergency-form-section]');
    if (sectionButton) {
      setActiveFormSection(sectionButton.dataset.emergencyFormSection || 'basic');
      return;
    }

    const viewButton = event.target.closest('[data-emergency-view]');
    if (viewButton) {
      setViewMode(viewButton.dataset.emergencyView || 'cards');
      return;
    }

    const generalOpen = event.target.closest('[data-emergency-general-open]');
    if (generalOpen) {
      event.preventDefault();
      event.stopPropagation();
      openLinkedGeneralCase(generalOpen.dataset.emergencyGeneralOpen);
      return;
    }

    const cardToggle = event.target.closest('[data-emergency-card-toggle]');
    if (cardToggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleEmergencyCard(cardToggle.dataset.emergencyCardToggle);
      return;
    }

    const row = event.target.closest('[data-emergency-row], [data-emergency-card]');
    if (row) {
      selectRow(row.dataset.emergencyRow || row.dataset.emergencyCard);
      fillSelected();
      return;
    }

    const restoreArchive = event.target.closest('[data-emergency-archive-restore]');
    if (restoreArchive) restoreEmergencyArchive(restoreArchive.dataset.emergencyArchiveRestore);
    const deleteArchive = event.target.closest('[data-emergency-archive-delete]');
    if (deleteArchive) deleteEmergencyArchive(deleteArchive.dataset.emergencyArchiveDelete);
  });

  document.addEventListener('dblclick', event => {
    const row = event.target.closest('[data-emergency-row], [data-emergency-card]');
    if (!row) return;
    selectRow(row.dataset.emergencyRow || row.dataset.emergencyCard);
    fillSelected();
  });

  document.addEventListener('input', event => {
    if (event.target.matches('[data-emergency-search]')) {
      state.search = event.target.value;
      clearTimeout(window.__emergencySearchTimer);
      window.__emergencySearchTimer = setTimeout(applySearchAndRender, 150);
    }
    if (event.target.matches('[data-emergency-date]')) formatRuDateInput(event.target);
    if (event.target.matches('[data-emergency-pk]')) formatPk(event.target);
    if (event.target.matches('[data-emergency-case]')) formatCaseNumber(event.target);
    if (event.target.matches('[data-emergency-money]')) calculateTotals();
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-emergency-upload-input]')) handleImportFile(event.target.files?.[0]);
    if (event.target.matches('[data-emergency-report-quarter]')) renderReports(Number(event.target.value || 1));
    if (event.target.matches('[data-emergency-import-select]')) {
      const index = Number(event.target.dataset.emergencyImportSelect);
      if (Number.isInteger(index) && state.importMatches[index]) {
        state.importMatches[index].selected = Boolean(event.target.checked);
        renderImportMatches();
      }
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-emergency-form]')) {
      event.preventDefault();
      saveEmergency(event.target);
    }
  });

  window.addEventListener('emergency:reload', loadEmergencyFund);
  window.addEventListener('emergency:open-general-case', event => {
    const generalCaseId = Number(event.detail?.generalCaseId || event.detail?.general_case_id || 0);
    if (!generalCaseId) return;
    const openWhenReady = () => openEmergencyByGeneralCaseId(generalCaseId);
    if (!state.rows.length) loadEmergencyFund().then(openWhenReady).catch(() => {});
    else openWhenReady();
  });
  checkDb();
  fillDatalists();
  clearForm(false);
  syncViewMode();
  syncFormSection();
  loadEmergencyFund();
}

function openEditor() { setEditorOpen(true); }
function handleEditorToggleClick() {
  const editor = document.querySelector('[data-emergency-editor]');
  if (editor?.classList.contains('is-open')) {
    setEditorOpen(false);
    return;
  }
  clearForm(true);
}
function setEditorOpen(open) {
  const editor = document.querySelector('[data-emergency-editor]');
  editor?.classList.toggle('is-open', open);
  document.body.classList.toggle('emergency-editor-modal-open', Boolean(open));
  const btn = document.querySelector('[data-emergency-open]');
  if (btn) btn.textContent = open ? '−' : '＋';
  syncFormMode();
}


function setActiveFormSection(section = 'basic') {
  state.activeFormSection = section || 'basic';
  syncFormSection();
}

function syncFormSection() {
  const active = state.activeFormSection || 'basic';
  document.querySelectorAll('[data-emergency-form-section]').forEach(button => {
    const isActive = button.dataset.emergencyFormSection === active;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('[data-emergency-section-panel]').forEach(panel => {
    panel.classList.toggle('is-active', panel.dataset.emergencySectionPanel === active);
  });
}

function scrollOpenedEditorIntoView() {
  requestAnimationFrame(() => {
    const editor = document.querySelector('[data-emergency-editor]');
    if (editor?.classList.contains('is-open')) editor.focus?.();
  });
}

async function checkDb() {
  const node = document.querySelector('[data-emergency-db-status]');
  if (!node) return;
  try { await dbApi.health(); node.textContent = 'База подключена'; }
  catch { node.textContent = 'API базы недоступен'; }
}

async function fillDatalists() {
  for (const [category, selector] of Object.entries(OPTION_MAP)) {
    const node = document.querySelector(selector);
    if (!node) continue;
    try {
      const values = await dbApi.getOptions(category);
      node.innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
    } catch { node.innerHTML = ''; }
  }
}

async function loadEmergencyFund() {
  const body = document.querySelector('[data-emergency-table-body]');
  const cards = document.querySelector('[data-emergency-cards-grid]');
  if (body) body.innerHTML = '<tr><td colspan="5" class="empty-cell">Загрузка...</td></tr>';
  if (cards) cards.innerHTML = '<div class="empty-card">Загрузка...</div>';

  try {
    state.rows = await dbApi.getEmergencyFund();
    applySearchAndRender();
  } catch (error) {
    state.rows = [];
    state.filteredRows = [];
    if (body) body.innerHTML = `<tr><td colspan="5" class="empty-cell error">API недоступен. Данные не загружены: ${escapeHtml(error.message)}</td></tr>`;
    if (cards) cards.innerHTML = `<div class="empty-card error">API недоступен. Данные не загружены: ${escapeHtml(error.message)}</div>`;
    renderEmergencySummary();
    updateCount();
  }
}

function applySearchAndRender() {
  const parts = String(state.search || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  state.filteredRows = !parts.length ? [...state.rows] : state.rows.filter(row => {
    const haystack = Object.values(row).map(v => String(v ?? '').toLowerCase()).join(' | ');
    return parts.every(part => haystack.includes(part));
  });
  renderEmergencySummary();
  renderTable();
  renderCards();
  syncViewMode();
  updateCount();
  window.dispatchEvent(new CustomEvent('emergency:updated', { detail: state.filteredRows }));
}

function renderTable() {
  const body = document.querySelector('[data-emergency-table-body]');
  if (!body) return;
  if (!state.filteredRows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">Записей не найдено</td></tr>';
    return;
  }
  body.innerHTML = state.filteredRows.map(row => `
    <tr data-emergency-row="${row.id}" class="${String(state.selectedId) === String(row.id) ? 'selected' : ''}">
      <td class="strong">${formatText(row.pk_number || row.pk)}</td>
      <td>${renderEmergencyFioStatus(row)}</td>
      <td>${formatText(row.address)}</td>
      <td>${formatText(row.requirements)}</td>
      <td>${formatText(row.execution_quarter)}</td>
      <td class="actions-cell">${renderEmergencyGeneralButton(row)}</td>
    </tr>
  `).join('');
}

function renderCards() {
  const grid = document.querySelector('[data-emergency-cards-grid]');
  if (!grid) return;
  if (!state.filteredRows.length) {
    grid.innerHTML = '<div class="empty-card">Записей не найдено</div>';
    return;
  }

  grid.innerHTML = state.filteredRows.map(row => {
    const id = String(row.id || '');
    const reviewReady = Number(row.review_ready) === 1;
    return `
      <article class="emergency-case-card is-collapsed ${reviewReady ? 'is-review-ready' : ''} ${String(state.selectedId) === id ? 'selected' : ''}" data-emergency-card="${row.id}" tabindex="0">
        <div class="emergency-case-card-head emergency-case-card-head-compact">
          <div class="emergency-case-icon" aria-hidden="true">🏚️</div>
          <div>
            <span class="emergency-case-kicker">№ ПК</span>
            <h4>${formatText(row.pk_number || row.pk || 'Без номера')}</h4>
          </div>
          ${reviewReady ? '<span class="emergency-review-pill">Отзыв готов</span>' : ''}
        </div>

        <div class="emergency-case-fields emergency-case-fields-main emergency-case-fields-compact">
          ${renderCardHtmlField('ФИО', renderEmergencyFioStatus(row))}
          ${renderCardField('Адрес ЖП', row.address, true)}
          ${renderCardField('Требования', row.requirements, true)}
        </div>

        ${renderEmergencyGeneralButton(row, 'card')}

        <button class="emergency-card-toggle" data-emergency-card-toggle="${row.id}" type="button" aria-label="Открыть карточку редактирования">
          <span aria-hidden="true">⌄</span>
        </button>
      </article>
    `;
  }).join('');
}

function toggleEmergencyCard(id) {
  const key = String(id || '');
  if (!key) return;
  selectRow(key);
  fillSelected();
}

function renderEmergencyGeneralButton(row, variant = 'table') {
  const generalCaseId = Number(row?.general_case_id || 0);
  if (!generalCaseId) return '';
  const className = variant === 'card' ? 'btn small emergency-general-more' : 'btn small';
  return `<button class="${className} more-dots-button" data-emergency-general-open="${generalCaseId}" type="button" title="Подробнее" aria-label="Подробнее"><span aria-hidden="true">•••</span></button>`;
}

function openLinkedGeneralCase(generalCaseId) {
  const id = Number(generalCaseId || 0);
  if (!id) return;

  if (typeof window.openView === 'function') {
    window.openView('cases');
  } else {
    document.querySelector('[data-view="cases"]')?.click();
  }

  window.setTimeout(() => {
    if (typeof window.__generalCasesOpenExisting === 'function') {
      window.__generalCasesOpenExisting(id, null, { sourceView: 'emergencyFund', returnView: 'emergencyFund' });
    } else {
      window.dispatchEvent(new CustomEvent('general-cases:open-case', { detail: { id, sourceView: 'emergencyFund' } }));
    }
  }, 250);
}

function openEmergencyByGeneralCaseId(generalCaseId) {
  const row = (state.rows || []).find(item => Number(item.general_case_id || 0) === Number(generalCaseId));
  if (!row) {
    showNotification('Связанная запись аварийного фонда не найдена');
    return;
  }
  setViewMode('cards');
  selectRow(row.id);
  fillSelected();
  document.querySelector('[data-emergency-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCardField(label, value, wide = false) {
  return `<div class="emergency-card-field ${wide ? 'wide' : ''}"><span>${escapeHtml(label)}</span><strong>${formatText(value)}</strong></div>`;
}

function renderCardHtmlField(label, html, wide = false) {
  return `<div class="emergency-card-field ${wide ? 'wide' : ''}"><span>${escapeHtml(label)}</span><div class="emergency-card-field-html">${html}</div></div>`;
}

function updateCount() {
  const node = document.querySelector('[data-emergency-count]');
  if (node) node.textContent = `${state.filteredRows.length} записей`;
}

function setViewMode(mode) {
  state.viewMode = mode === 'table' ? 'table' : 'cards';
  localStorage.setItem(VIEW_MODE_KEY, state.viewMode);
  syncViewMode();
}

function syncViewMode() {
  const tablePane = document.querySelector('[data-emergency-table-pane]');
  const cardsPane = document.querySelector('[data-emergency-cards-pane]');
  document.querySelectorAll('[data-emergency-view]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.emergencyView === state.viewMode);
  });
  if (tablePane) tablePane.hidden = state.viewMode !== 'table';
  if (cardsPane) cardsPane.hidden = state.viewMode !== 'cards';
}

function selectRow(id) {
  state.selectedId = id;
  renderTable();
  renderCards();
  syncFormMode();
}
function getSelectedRow() { return state.rows.find(row => String(row.id) === String(state.selectedId)); }

function fillSelected() {
  const row = getSelectedRow();
  if (!row) { alert('Выберите запись.'); return; }
  fillForm(row);
  setActiveFormSection('basic');
  openEditor();
  scrollOpenedEditorIntoView();
  document.querySelector('[data-emergency-editor-title]').textContent = 'Редактирование записи';
  document.querySelector('[data-emergency-current-id]').textContent = 'Редактирование выбранной записи';
  syncFormMode();
}

function fillForm(row = {}) {
  const form = document.querySelector('[data-emergency-form]');
  if (!form) return;
  for (const element of Array.from(form.elements)) {
    if (!element.name) continue;
    if (element.type === 'checkbox') element.checked = Number(row[element.name] ?? (element.name === 'review_ready' ? row.review_ready : 0)) === 1;
    else element.value = row[element.name] ?? aliases(row, element.name) ?? '';
  }
  renderExecutionPeople(row.execution_people_json);
  calculateTotals();
  syncFormMode();
}

function aliases(row, name) {
  const map = {
    general_case_id: row.general_case_id,
    pk_number: row.pk,
    case_num: row.case_number,
    sum_claim: row.claim_amount,
    sum_property_claim: row.sum_property_claim,
    provided_area: row.area,
    total_unfulfilled_sum: getUnfulfilledSum(row),
    total_fulfilled_sum: row.total_fulfilled_sum,
    total_unfulfilled_area: getUnfulfilledArea(row),
    total_provided_area: row.provided_area || row.area,
    condemned_date: row.condemned_date,
    resettlement_deadline: row.resettlement_deadline
  };
  return map[name] ?? '';
}

function clearForm(keepOpen = true) {
  const form = document.querySelector('[data-emergency-form]');
  form?.reset();
  if (form?.elements.id) form.elements.id.value = '';
  if (form?.elements.kvartal) form.elements.kvartal.value = getCurrentQuarterText();
  state.selectedId = null;
  document.querySelector('[data-emergency-editor-title]').textContent = 'Новая запись';
  document.querySelector('[data-emergency-current-id]').textContent = 'Заполните поля и нажмите «Сохранить»';
  renderExecutionPeople('');
  calculateTotals();
  setActiveFormSection('basic');
  renderTable();
  renderCards();
  syncFormMode();
  if (keepOpen) openEditor();
}

function syncFormMode() {
  const form = document.querySelector('[data-emergency-form]');
  const deleteButton = document.querySelector('[data-emergency-delete]');
  const archiveButton = document.querySelector('[data-emergency-archive]');
  const isEdit = Boolean(form?.elements.id?.value || state.selectedId);
  if (deleteButton) deleteButton.hidden = !isEdit;
  if (archiveButton) archiveButton.hidden = !isEdit;
}

async function saveEmergency(form) {
  const data = formToData(form);
  try {
    if (data.id) {
      const updated = await dbApi.updateEmergencyFund(data.id, data);
      state.selectedId = updated.id || data.id;
      showNotification('Запись аварийного фонда обновлена');
    } else {
      const created = await dbApi.createEmergencyFund(data);
      state.selectedId = created.id;
      showNotification('Запись аварийного фонда добавлена');
    }
    await loadEmergencyFund();
    const row = getSelectedRow();
    if (row) fillForm(row);
    setEditorOpen(false);
  } catch (error) {
    alert('Не удалось сохранить запись:\n' + error.message);
  }
}

function formToData(form) {
  const data = {};
  for (const element of Array.from(form.elements)) {
    if (!element.name) continue;
    data[element.name] = element.type === 'checkbox' ? (element.checked ? 1 : 0) : element.value.trim();
  }
  data.pk = data.pk_number;
  data.case_number = data.case_num;
  data.claim_amount = data.sum_claim;
  data.area = data.provided_area;
  return data;
}

async function deleteCurrentFromEditor() {
  const form = document.querySelector('[data-emergency-form]');
  const id = form?.elements.id?.value || state.selectedId;
  if (!id) { alert('Откройте запись для редактирования.'); return; }
  if (!confirm('Удалить редактируемую запись?')) return;
  try {
    await dbApi.deleteEmergencyFund(id);
    showNotification('Запись удалена');
    clearForm(false);
    await loadEmergencyFund();
    setEditorOpen(false);
  } catch (error) { alert('Не удалось удалить запись:\n' + error.message); }
}

async function archiveSelected() {
  const row = getSelectedRow();
  if (!row) { alert('Выберите запись для переноса в архив.'); return; }
  if (!confirm('Перенести выбранную запись в архив?')) return;
  try { await dbApi.archiveEmergencyFund(row.id); showNotification('Запись перенесена в архив'); clearForm(false); await loadEmergencyFund(); }
  catch (error) { alert('Не удалось перенести в архив:\n' + error.message); }
}

async function openEmergencyArchive() {
  const dialog = document.querySelector('[data-emergency-archive-dialog]');
  const body = document.querySelector('[data-emergency-archive-body]');
  if (!dialog || !body) return;
  body.innerHTML = '<tr><td colspan="8" class="empty-cell">Загрузка...</td></tr>';
  dialog.showModal();
  try { renderEmergencyArchive(await dbApi.getEmergencyFundArchive()); }
  catch (error) { body.innerHTML = `<tr><td colspan="8" class="empty-cell error">Не удалось открыть архив: ${escapeHtml(error.message)}</td></tr>`; }
}
function closeEmergencyArchive() { document.querySelector('[data-emergency-archive-dialog]')?.close(); }
function renderEmergencyArchive(rows = []) {
  const body = document.querySelector('[data-emergency-archive-body]');
  if (!body) return;
  if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="empty-cell">В архиве записей нет</td></tr>'; return; }
  body.innerHTML = rows.map(row => `
    <tr>
      <td class="strong">${formatText(row.pk_number || row.pk)}</td>
      <td>${formatText(row.fio)}</td>
      <td>${formatText(row.address)}</td>
      <td>${formatText(row.requirements)}</td>
      <td>${formatText(row.court)}</td>
      <td>${formatText([row.judicial_act_date, row.case_num || row.case_number].filter(Boolean).join(', '))}</td>
      <td>${formatText(row.execution_quarter)}</td>
      <td class="archive-actions-cell">
        <button class="btn small restore" data-emergency-archive-restore="${row.archive_id}" type="button">Восстановить</button>
        <button class="btn small danger" data-emergency-archive-delete="${row.archive_id}" type="button">Удалить</button>
      </td>
    </tr>`).join('');
}
async function restoreEmergencyArchive(archiveId) {
  try { await dbApi.restoreEmergencyFundArchive(archiveId); showNotification('Запись восстановлена'); await loadEmergencyFund(); await openEmergencyArchive(); }
  catch (error) { alert('Не удалось восстановить запись:\n' + error.message); }
}
async function deleteEmergencyArchive(archiveId) {
  if (!confirm('Удалить запись из архива навсегда?')) return;
  try { await dbApi.deleteEmergencyFundArchive(archiveId); showNotification('Запись удалена из архива'); await openEmergencyArchive(); }
  catch (error) { alert('Не удалось удалить запись из архива:\n' + error.message); }
}

function calculateTotals() {
  const form = document.querySelector('[data-emergency-form]');
  if (!form) return;

  // Бизнес-логика сумм:
  // - «Заявленная сумма по иску» — исходная сумма из иска, она не используется для расчета исполнения.
  // - «Взыскать» (`collected`) — сумма, удовлетворенная судом; до исполнения это неисполненное обязательство.
  // - «Сумма исполненных обязательств» пополняется только из загруженной таблицы Excel/CSV.
  // - «Сумма неисполненных обязательств» = max(«Взыскать» - «Исполнено», 0).
  const awarded = numberValue(form.elements.collected.value);
  const fulfilled = numberValue(form.elements.total_fulfilled_sum.value);
  const unfulfilled = Math.max(awarded - fulfilled, 0);

  form.elements.total_unfulfilled_sum.value = awarded || fulfilled ? String(unfulfilled) : '';

  const awardedArea = numberValue(form.elements.provided_area.value);
  const fulfilledArea = numberValue(form.elements.total_provided_area.value);
  const unfulfilledArea = Math.max(awardedArea - fulfilledArea, 0);
  form.elements.total_unfulfilled_area.value = awardedArea || fulfilledArea ? String(unfulfilledArea) : '';
  syncObligationSummary();
}

function renderEmergencySummary() {
  const totals = (state.rows || []).reduce((acc, row) => {
    acc.total_unfulfilled_sum += getUnfulfilledSum(row);
    acc.total_fulfilled_sum += numberValue(row.total_fulfilled_sum);
    acc.total_unfulfilled_area += getUnfulfilledArea(row);
    acc.total_provided_area += numberValue(row.total_provided_area || row.provided_area || row.area);
    return acc;
  }, {
    total_unfulfilled_sum: 0,
    total_fulfilled_sum: 0,
    total_unfulfilled_area: 0,
    total_provided_area: 0
  });

  Object.entries(totals).forEach(([key, value]) => {
    const node = document.querySelector(`[data-emergency-summary="${key}"]`);
    if (node) node.textContent = key.includes('area') ? areaText(value) : money(value) || '0,00';
  });
}

function syncObligationSummary() {
  renderEmergencySummary();
}


async function handleImportFile(file) {
  const input = document.querySelector('[data-emergency-upload-input]');
  if (!file) return;
  const ext = file.name.split('.').pop()?.toLowerCase();

  try {
    const imported = ['xlsx', 'xls'].includes(ext)
      ? await parseExcelTable(file)
      : parseDelimitedTable(await file.text());

    if (!imported.length) {
      alert('В таблице не найдены строки для сопоставления. Проверьте заголовки: ФИО, адрес исполненных обязательств, сумма исполненных обязательств.');
      return;
    }

    state.importMatches = findImportMatches(imported);
    renderImportMatches();
    document.querySelector('[data-emergency-import-dialog]')?.showModal();
  } catch (error) {
    alert('Не удалось прочитать таблицу:\n' + error.message);
  } finally {
    if (input) input.value = '';
  }
}

async function parseExcelTable(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const worksheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
  return normalizeImportedMatrix(matrix);
}

function parseDelimitedTable(text) {
  const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  return normalizeImportedMatrix(lines.map(line => splitDelimitedLine(line, delimiter)));
}

function normalizeImportedMatrix(matrix) {
  const rows = (matrix || [])
    .map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '').trim()) : [])
    .filter(row => row.some(Boolean));

  if (!rows.length) return [];

  const budgetRows = extractBudgetExecutionRows(rows);
  if (budgetRows.length) return budgetRows;

  const headerInfo = detectImportHeader(rows);
  const dataRows = rows.slice(headerInfo.headerRowIndex + 1);
  const columns = headerInfo.columns;
  const headerWidth = Math.max((rows[headerInfo.headerRowIndex] || []).length, 1);

  return dataRows
    .map((row, index) => normalizeGenericImportRow(
      row,
      columns,
      headerWidth,
      headerInfo.headerRowIndex + 1 + index
    ))
    .filter(row => row.fio || row.address || row.amount);
}

/**
 * Нормализует обычную строку Excel/CSV.
 *
 * В пользовательских CSV ФИО часто перечислены через запятую без кавычек:
 *
 *   Азаренкова Ольга Ивановна, Аксенов Алексей Михайлович, адрес, 1000
 *
 * CSV-парсер закономерно превращает это в четыре ячейки вместо трёх. Раньше
 * первая фамилия попадала в колонку «ФИО», вторая — в «Адрес», а сумма съезжала,
 * из-за чего результат зависел от порядка фамилий. Здесь мы восстанавливаем
 * исходное поле ФИО, но только когда добавочные ячейки действительно похожи на
 * ФИО. Для корректных XLS/XLSX и CSV в кавычках поведение остаётся прежним.
 */
function normalizeGenericImportRow(row, columns, headerWidth, sourceIndex) {
  let fioIndex = Number.isInteger(columns.fio) ? columns.fio : 0;
  let addressIndex = Number.isInteger(columns.address) ? columns.address : 1;
  let amountIndex = Number.isInteger(columns.amount) ? columns.amount : 2;

  let fio = getMatrixCell(row, fioIndex);
  let address = getMatrixCell(row, addressIndex);
  let amount = getMatrixCell(row, amountIndex);

  const overflow = Math.max((row || []).length - Math.max(Number(headerWidth) || 0, 1), 0);
  const orderedColumns = fioIndex < addressIndex && addressIndex < amountIndex;

  if (overflow > 0 && orderedColumns) {
    const shiftedAddressIndex = addressIndex + overflow;
    const shiftedAmountIndex = amountIndex + overflow;
    const possibleFioCells = (row || []).slice(fioIndex, shiftedAddressIndex);
    const reconstructedPeople = possibleFioCells.flatMap(cell => splitFioList(cell));

    if (
      possibleFioCells.length > 1
      && possibleFioCells.every(cell => isFioListValue(cell))
      && reconstructedPeople.length > splitFioList(fio).length
    ) {
      fio = reconstructedPeople.join(', ');
      address = getMatrixCell(row, shiftedAddressIndex);
      amount = getMatrixCell(row, shiftedAmountIndex);
    }
  }

  // Дополнительная страховка для таблиц с объединёнными/сдвинутыми колонками:
  // если «адрес» фактически содержит второе ФИО, объединяем его с первым, а
  // настоящий адрес и сумму ищем справа. Это не применяется к обычному адресу.
  if (isFioListValue(fio) && isFioListValue(address)) {
    const combinedPeople = [...splitFioList(fio), ...splitFioList(address)];
    fio = uniqueFioPeople(combinedPeople).join(', ');

    const remaining = (row || []).slice(addressIndex + 1);
    const amountPosition = remaining.findIndex(isLikelyImportAmount);
    if (amountPosition >= 0) {
      const amountCellIndex = addressIndex + 1 + amountPosition;
      amount = getMatrixCell(row, amountCellIndex);
      const addressCandidate = (row || [])
        .slice(addressIndex + 1, amountCellIndex)
        .map(value => String(value || '').trim())
        .find(value => value && !isFioListValue(value));
      address = addressCandidate || '';
    } else {
      address = '';
    }
  }

  return {
    fio: uniqueFioPeople(splitFioList(fio)).join(', '),
    address,
    amount,
    __sourceIndex: sourceIndex
  };
}

function isLikelyImportAmount(value) {
  const text = String(value ?? '').trim();
  if (!text || numberValue(text) <= 0) return false;
  // Адреса нередко содержат номер дома. Не принимаем ячейку за сумму, если
  // в ней есть обычные слова; допускаем только обозначения валюты.
  const withoutCurrency = text
    .toLowerCase()
    .replace(/руб(?:\.|лей|ля)?/g, '')
    .replace(/₽/g, '')
    .replace(/[\s\u00a0.,'-]/g, '');
  return /^\d+$/.test(withoutCurrency);
}

function extractBudgetExecutionRows(rows) {
  if (!looksLikeBudgetExecutionReport(rows)) return [];

  const amountColumn = findColumnByHeader(rows, ['кассовоеисполнение', 'исполнено', 'кассовое']) ?? 14;
  const fallbackAmountColumns = [amountColumn, 14, 9, 10, 13].filter((value, index, array) => Number.isInteger(value) && array.indexOf(value) === index);
  const result = [];

  rows.forEach((row, index) => {
    const fio = String(row?.[0] || '').trim();
    if (!looksLikeBudgetPersonName(fio)) return;

    const amount = getBudgetExecutionAmountFromGroup(rows, index, fallbackAmountColumns);
    const address = findBudgetAddress(rows, index);
    result.push({
      fio,
      address,
      amount: amount ? String(amount) : '',
      __sourceIndex: index
    });
  });

  return result;
}

function looksLikeBudgetExecutionReport(rows) {
  const text = rows.slice(0, 20).flat().map(value => compactHeader(value)).join('|');
  return text.includes('сводныеданныеобисполнениибюджета')
    || (text.includes('договорконтрагентнаименование') && text.includes('кассовоеисполнение'));
}

function findColumnByHeader(rows, needles = []) {
  const maxHeaderRows = Math.min(rows.length, 16);
  for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
    for (let colIndex = 0; colIndex < (rows[rowIndex] || []).length; colIndex += 1) {
      const compact = compactHeader(rows[rowIndex][colIndex]);
      if (needles.some(needle => compact.includes(needle))) return colIndex;
    }
  }
  return null;
}

function looksLikeBudgetPersonName(value) {
  const text = String(value || '').trim();
  if (!text || /\d/.test(text)) return false;
  if (/^(кпс|кэк|договор|параметры|отбор|сводные|исполнительный лист|возмещение|итого|организация)/i.test(text)) return false;

  // В одном поле отчёта могут находиться несколько граждан через запятую
  // или точку с запятой. Проверяем каждое ФИО отдельно, иначе такая строка
  // отбрасывалась целиком из-за количества слов.
  return isFioListValue(text);
}

function firstPositiveAmount(row, columns = []) {
  for (const column of columns) {
    const value = numberValue(row?.[column]);
    if (value > 0) return value;
  }
  return 0;
}

function getBudgetExecutionAmount(row, preferredColumns = []) {
  const preferred = firstPositiveAmount(row, preferredColumns);
  if (preferred > 0) return preferred;

  const numericValues = (row || [])
    .slice(4)
    .map(value => numberValue(value))
    .filter(value => value > 0);

  if (!numericValues.length) return 0;

  // В отчёте БКГ сумма исполнения у строки ФИО часто дублируется в нескольких
  // бюджетных колонках. Берём положительную сумму из строки, чтобы не получить 0,
  // если «Кассовое исполнение» было смещено из-за объединённых ячеек/служебных строк.
  return Math.max(...numericValues);
}

function getBudgetExecutionAmountFromGroup(rows, personRowIndex, preferredColumns = []) {
  const groupRows = [
    rows?.[personRowIndex],
    rows?.[personRowIndex + 1],
    rows?.[personRowIndex + 2]
  ].filter(Boolean);

  for (const column of preferredColumns) {
    for (const row of groupRows) {
      const value = numberValue(row?.[column]);
      if (value > 0) return value;
    }
  }

  const numericValues = groupRows
    .flatMap(row => (row || []).slice(8).map(value => numberValue(value)))
    .filter(value => value > 0);

  return numericValues.length ? Math.max(...numericValues) : 0;
}

function findBudgetAddress(rows, personRowIndex) {
  for (let offset = 1; offset <= 4; offset += 1) {
    const text = String(rows?.[personRowIndex + offset]?.[0] || '').trim();
    if (!text) continue;
    if (/возмещение|жил|жп|помещени|ул\.?|просп|пер\.?|адрес/i.test(text)) return cleanupBudgetAddress(text);
  }
  return '';
}

function cleanupBudgetAddress(value) {
  return String(value || '')
    .replace(/^Возмещение\s+(расходов\s+)?(за\s+)?/i, '')
    .replace(/^за\s+изымаемое\s+/i, '')
    .replace(/^из/i, 'из')
    .trim();
}

function detectImportHeader(rows) {
  const maxHeaderRows = Math.min(rows.length, 12);
  let best = { headerRowIndex: -1, score: -1, columns: {} };

  for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
    const columns = detectImportColumns(rows[rowIndex]);
    const score = Number.isInteger(columns.fio) + Number.isInteger(columns.address) + Number.isInteger(columns.amount);
    if (score > best.score) best = { headerRowIndex: rowIndex, score, columns };
  }

  if (best.score <= 0) {
    return {
      headerRowIndex: -1,
      columns: fallbackImportColumns(rows[0] || [])
    };
  }

  return {
    headerRowIndex: best.headerRowIndex,
    columns: fillMissingImportColumns(best.columns, rows[best.headerRowIndex] || [])
  };
}

function detectImportColumns(headerRow) {
  const columns = {};
  (headerRow || []).forEach((header, index) => {
    const type = detectImportColumnType(header);
    if (type && !Number.isInteger(columns[type])) columns[type] = index;
  });
  return columns;
}

function fillMissingImportColumns(columns, headerRow) {
  const filled = { ...columns };
  const used = new Set(Object.values(filled).filter(Number.isInteger));
  const fallback = fallbackImportColumns(headerRow);

  ['fio', 'address', 'amount'].forEach(type => {
    if (!Number.isInteger(filled[type]) && Number.isInteger(fallback[type]) && !used.has(fallback[type])) {
      filled[type] = fallback[type];
      used.add(fallback[type]);
    }
  });

  return filled;
}

function fallbackImportColumns(row) {
  const nonEmptyIndexes = (row || []).map((value, index) => String(value || '').trim() ? index : null).filter(index => index !== null);
  return {
    fio: nonEmptyIndexes[0] ?? 0,
    address: nonEmptyIndexes[1] ?? 1,
    amount: nonEmptyIndexes[2] ?? 2
  };
}

function detectImportColumnType(header) {
  const normalized = normalizeHeader(header);
  const compact = compactHeader(header);

  if (
    normalized === 'фио' ||
    compact.includes('фио') ||
    compact.includes('фамилия') ||
    compact.includes('заявитель') ||
    compact.includes('собственник') ||
    compact.includes('переселяемый') ||
    compact.includes('гражданин') ||
    compact === 'fio' ||
    compact === 'name'
  ) return 'fio';

  if (
    compact.includes('адрес') ||
    compact.includes('жилогопомещения') ||
    compact.includes('жп') ||
    compact.includes('объект') ||
    compact.includes('помещение') ||
    compact.includes('address')
  ) return 'address';

  if (
    compact.includes('сумма') ||
    compact.includes('исполненныхобязательств') ||
    compact.includes('исполнено') ||
    compact.includes('выкуп') ||
    compact.includes('amount') ||
    compact.includes('sum')
  ) return 'amount';

  return null;
}

function getMatrixCell(row, index) {
  if (!Number.isInteger(index)) return '';
  return String(row?.[index] ?? '').trim();
}

function detectDelimiter(line) {
  if (String(line).includes(';')) return ';';
  if (String(line).includes('\t')) return '\t';
  return ',';
}

function splitDelimitedLine(line, delimiter) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) { result.push(current.trim()); current = ''; continue; }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function compactHeader(value) {
  return normalizeHeader(value).replace(/[^a-zа-я0-9]/gi, '');
}

function findImportMatches(importedRows) {
  return (importedRows || []).flatMap((imported, sourcePosition) => {
    const importedPeople = splitFioList(imported.fio);
    const sourceKey = getImportSourceKey(imported, sourcePosition);

    return importedPeople.map((importedPerson, personPosition) => {
      const candidates = [];
      state.rows.forEach(row => {
        splitFioList(row.fio).forEach(savedPerson => {
          const score = compareFioPerson(importedPerson, savedPerson);
          if (score > 0) candidates.push({ row, savedPerson, score });
        });
      });
      candidates.sort((a, b) => b.score - a.score);

      const top = candidates[0] || null;
      const second = candidates[1] || null;
      const topKey = top ? `${top.row.id}:${normalizeFioPerson(top.savedPerson)}` : '';
      const secondKey = second ? `${second.row.id}:${normalizeFioPerson(second.savedPerson)}` : '';
      const ambiguous = Boolean(top && second && second.score === top.score && secondKey !== topKey);
      const matched = ambiguous ? null : top?.row || null;
      const matchedPerson = ambiguous ? '' : top?.savedPerson || '';
      const tableAmount = numberValue(imported.amount);
      const awardedFallback = matched ? numberValue(matched.collected) : 0;
      const amount = tableAmount > 0 ? tableAmount : awardedFallback;
      const amountSource = tableAmount > 0 ? 'таблица' : awardedFallback > 0 ? 'взыскать' : '';
      const alreadyExecuted = Boolean(matched && matchedPerson && isExecutionPersonMarked(matched.execution_people_json, matchedPerson));
      const status = ambiguous
        ? 'Найдено несколько равных совпадений — требуется ручная проверка'
        : matched
          ? alreadyExecuted
            ? `Уже отмечен исполненным: ${matchedPerson}`
            : amount > 0
              ? `${amountSource === 'взыскать' ? 'Совпадение, сумма из поля «Взыскать»' : 'Совпадение'}: ${importedPerson} ↔ ${matchedPerson}`
              : `Совпадение без суммы: ${importedPerson} ↔ ${matchedPerson}`
          : 'Не найдено';

      return {
        imported: { ...imported, fio: importedPerson, originalFio: imported.fio },
        sourceKey,
        sourcePosition,
        personPosition,
        amount,
        amountSource,
        matched,
        matchedPerson,
        ambiguous,
        alreadyExecuted,
        selected: Boolean(matched && !ambiguous && amount > 0 && !alreadyExecuted),
        status,
        matchScore: top?.score || 0
      };
    });
  });
}

function splitFioList(value) {
  const text = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[|]+/g, ';')
    .trim();

  if (!text) return [];

  return uniqueFioPeople(
    text
      .split(/[,;\n]+/)
      .map(item => item.replace(/^\s*[-–—]\s*/, '').trim())
      .filter(Boolean)
  );
}

function uniqueFioPeople(values = []) {
  const seen = new Set();
  const result = [];
  (values || []).forEach(value => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    const key = normalizeFioPerson(clean);
    if (!clean || !key || seen.has(key)) return;
    seen.add(key);
    result.push(clean);
  });
  return result;
}

function isFioListValue(value) {
  const people = splitFioList(value);
  if (!people.length) return false;
  return people.every(isLikelyFioPerson);
}

function isLikelyFioPerson(value) {
  const tokens = String(value || '')
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/^["'«»()]+|["'«»(),]+$/g, ''))
    .filter(Boolean);

  if (tokens.length < 2 || tokens.length > 5) return false;

  return tokens.every((token, index) => {
    if (/^[А-ЯЁA-Z]\.?[А-ЯЁA-Z]?\.?$/u.test(token)) return index > 0;
    return /^[А-ЯЁA-Z][а-яёa-z-]+$/u.test(token);
  });
}

function normalizeFioPerson(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["'«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fioTokens(value) {
  return normalizeFioPerson(value).split(' ').filter(Boolean);
}

function compareFioPerson(left, right) {
  const a = fioTokens(left);
  const b = fioTokens(right);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 120;
  if (a[0] !== b[0]) return 0;
  let score = 55;
  if (a[1] && b[1] && a[1][0] === b[1][0]) score += 25;
  if (a[2] && b[2] && a[2][0] === b[2][0]) score += 20;
  if (a.length >= 2 && b.length >= 2 && a[1] === b[1]) score += 10;
  if (a.length >= 3 && b.length >= 3 && a[2] === b[2]) score += 10;
  return score;
}

function compareFioLists(left, right) {
  const imported = splitFioList(left);
  const saved = splitFioList(right);
  if (!imported.length || !saved.length) return 0;
  let score = 0;
  let matchedCount = 0;
  const used = new Set();
  for (const importedName of imported) {
    let best = { index: -1, score: 0 };
    saved.forEach((savedName, index) => {
      if (used.has(index)) return;
      const current = compareFioPerson(importedName, savedName);
      if (current > best.score) best = { index, score: current };
    });
    if (best.index >= 0 && best.score > 0) {
      used.add(best.index);
      score += best.score;
      matchedCount += 1;
    }
  }
  return matchedCount ? score + matchedCount * 3 : 0;
}

function getMatchingFioNames(left, right) {
  const imported = splitFioList(left);
  const saved = splitFioList(right);
  const result = [];
  const used = new Set();
  for (const importedName of imported) {
    let best = { index: -1, score: 0 };
    saved.forEach((savedName, index) => {
      if (used.has(index)) return;
      const score = compareFioPerson(importedName, savedName);
      if (score > best.score) best = { index, score };
    });
    if (best.index >= 0 && best.score > 0) {
      used.add(best.index);
      result.push(`${importedName} ↔ ${saved[best.index]}`);
    }
  }
  return result;
}

function getImportSourceKey(imported = {}, fallbackIndex = 0) {
  const sourceIndex = Number.isInteger(Number(imported.__sourceIndex)) ? Number(imported.__sourceIndex) : fallbackIndex;
  return [
    sourceIndex,
    normalizeFioPerson(imported.originalFio || imported.fio),
    normalizeHeader(imported.address),
    String(numberValue(imported.amount))
  ].join('|');
}

function parseExecutionPeopleDetails(value) {
  const empty = { version: 1, people: [], appliedSources: [] };
  if (!value) return empty;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return { ...empty, people: parsed };
    if (!parsed || typeof parsed !== 'object') return empty;
    return {
      version: 1,
      people: Array.isArray(parsed.people) ? parsed.people : [],
      appliedSources: Array.isArray(parsed.appliedSources) ? parsed.appliedSources : []
    };
  } catch {
    return empty;
  }
}

function isExecutionPersonMarked(value, personName) {
  const key = normalizeFioPerson(personName);
  if (!key) return false;
  return parseExecutionPeopleDetails(value).people.some(person => {
    const personKey = normalizeFioPerson(person.key || person.name);
    return personKey === key && String(person.status || 'executed') === 'executed';
  });
}

function renderEmergencyFioStatus(row = {}) {
  const people = splitFioList(row.fio);
  if (!people.length) return '<span class="muted">—</span>';
  return `<div class="emergency-fio-status-list">
    ${people.map(person => {
      const executed = isExecutionPersonMarked(row.execution_people_json, person);
      return `<span class="emergency-fio-status-item ${executed ? 'is-executed' : ''}">${executed ? '<b aria-hidden="true">✓</b>' : '<b aria-hidden="true">•</b>'}${formatText(person)}</span>`;
    }).join('')}
  </div>`;
}

function renderExecutionPeople(value) {
  const node = document.querySelector('[data-emergency-execution-people]');
  if (!node) return;
  const details = parseExecutionPeopleDetails(value);
  const people = details.people.filter(person => String(person.status || 'executed') === 'executed');
  if (!people.length) {
    node.innerHTML = '<div class="empty-card">Отдельные ФИО пока не отмечены исполненными.</div>';
    return;
  }
  node.innerHTML = `
    <div class="emergency-execution-people-title">Исполнено по ФИО</div>
    <div class="emergency-execution-people-list">
      ${people.map(person => `
        <div class="emergency-execution-person-item">
          <strong>${formatText(person.name || person.key)}</strong>
          <span>${formatText(person.executionQuarter || '')}${person.markedAt ? ` · ${formatText(formatExecutionMarkedAt(person.markedAt))}` : ''}</span>
        </div>`).join('')}
    </div>`;
}

function formatExecutionMarkedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU');
}

function renderImportMatches() {
  const node = document.querySelector('[data-emergency-import-body]');
  const applyButton = document.querySelector('[data-emergency-import-apply]');
  if (!node) return;

  const actionable = getActionableImportMatches();
  if (applyButton) {
    applyButton.disabled = !actionable.length;
    applyButton.title = actionable.length ? '' : 'Нет строк, где одновременно найдена запись и указана сумма больше 0';
  }

  if (!state.importMatches.length) {
    node.innerHTML = '<div class="empty-card">Совпадений не найдено</div>';
    return;
  }

  const total = state.importMatches.length;
  const matched = state.importMatches.filter(match => match.matched).length;
  const withAmount = state.importMatches.filter(match => match.amount > 0).length;
  const alreadyExecuted = state.importMatches.filter(match => match.alreadyExecuted).length;

  node.innerHTML = `
    <div class="emergency-import-summary">
      <b>Распознано ФИО: ${total}</b>
      <span>Найдено совпадений: ${matched}</span>
      <span>ФИО с суммой больше 0: ${withAmount}</span>
      ${alreadyExecuted ? `<span>Уже отмечено исполненными: ${alreadyExecuted}</span>` : ''}
      ${actionable.length ? `<strong>Выбрано для отметки: ${actionable.length}</strong>` : '<em>Выберите ФИО, у которых найдена запись и указана сумма больше 0.</em>'}
    </div>
    <table class="emergency-table emergency-import-table">
      <thead><tr><th class="emergency-import-check-column">Отметить</th><th>ФИО из таблицы</th><th>Совпавшее ФИО</th><th>Запись на сайте</th><th>Адрес</th><th>Сумма</th><th>Статус</th></tr></thead>
      <tbody>
        ${state.importMatches.map((match, index) => `
          <tr class="${match.matched ? 'is-match' : 'is-miss'} ${match.alreadyExecuted ? 'is-already-executed' : ''}">
            <td class="emergency-import-check-column">
              <input
                type="checkbox"
                data-emergency-import-select="${index}"
                ${match.selected ? 'checked' : ''}
                ${!match.matched || match.ambiguous || match.amount <= 0 || match.alreadyExecuted ? 'disabled' : ''}
                aria-label="Отметить исполненным ${escapeHtml(match.imported.fio)}"
              >
            </td>
            <td>${formatText(match.imported.fio)}</td>
            <td>${match.matchedPerson ? formatText(match.matchedPerson) : '<span class="muted">—</span>'}</td>
            <td>${match.matched ? formatText(match.matched.fio) : '<span class="muted">—</span>'}</td>
            <td>${formatText(match.imported.address || match.matched?.address)}</td>
            <td>${formatText(money(match.amount))}${match.amountSource === 'взыскать' ? '<br><small class="muted">из поля «Взыскать»</small>' : ''}</td>
            <td>${escapeHtml(match.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function getActionableImportMatches() {
  return state.importMatches.filter(match => match.selected && match.matched && !match.ambiguous && !match.alreadyExecuted && match.amount > 0);
}

function getAwardedValue(row = {}) {
  return row.collected ?? row.awarded_sum ?? row.awarded ?? row.recovered_sum ?? row.sum_to_collect ?? '';
}


async function applyImportMatches() {
  const matches = getActionableImportMatches();
  if (!matches.length) {
    showNotification('Нет строк для отметки: нужна совпавшая фамилия и сумма больше 0.');
    renderImportMatches();
    return;
  }
  const grouped = groupImportMatchesByEmergencyRow(matches);
  const matchedPeople = matches.length;
  if (!confirm(`Отметить исполненными совпадения по ${matchedPeople} ФИО в ${grouped.length} записях?`)) return;

  const currentQuarter = getCurrentQuarterText();
  let updated = 0;
  for (const group of grouped) {
    const row = group.row;
    const awardedRaw = getAwardedValue(row);
    const awarded = numberValue(awardedRaw);
    const currentFulfilled = numberValue(row.total_fulfilled_sum);
    const details = parseExecutionPeopleDetails(row.execution_people_json);
    const existingSourceKeys = new Set(details.appliedSources.map(source => String(source.key || '')));
    const newSources = Array.from(group.sources.values()).filter(source => !existingSourceKeys.has(source.key));
    const sourceAmount = newSources.reduce((sum, source) => sum + numberValue(source.amount), 0);
    // В старых версиях сумма могла быть уже записана на уровне всей карточки,
    // но сведения по каждому ФИО ещё не сохранялись. При первом переходе на
    // персональный учёт засчитываем только разницу, чтобы не удвоить исполнение.
    const isLegacyExecution = !details.people.length && !details.appliedSources.length && currentFulfilled > 0;
    const addedAmount = isLegacyExecution ? Math.max(sourceAmount - currentFulfilled, 0) : sourceAmount;
    const nextFulfilled = currentFulfilled + addedAmount;
    const nextUnfulfilled = Math.max(awarded - nextFulfilled, 0);
    const markedAt = new Date().toISOString();

    group.matches.forEach(match => {
      const personKey = normalizeFioPerson(match.matchedPerson || match.imported.fio);
      if (!personKey) return;
      const existingPerson = details.people.find(person => normalizeFioPerson(person.key || person.name) === personKey);
      const sourceKeys = Array.from(new Set([...(existingPerson?.sourceKeys || []), match.sourceKey]));
      const nextPerson = {
        ...(existingPerson || {}),
        key: personKey,
        name: match.matchedPerson || match.imported.fio,
        status: 'executed',
        executionQuarter: currentQuarter,
        markedAt,
        sourceKeys
      };
      if (existingPerson) Object.assign(existingPerson, nextPerson);
      else details.people.push(nextPerson);
    });

    newSources.forEach(source => {
      details.appliedSources.push({
        key: source.key,
        amount: numberValue(source.amount),
        sourceFio: source.sourceFio,
        sourceAddress: source.sourceAddress,
        people: source.people,
        appliedAt: markedAt
      });
    });

    const payload = {
      ...row,
      // Поле «Взыскать» — это сумма, удовлетворенная судом. При отметке исполнения
      // оно не должно обнуляться и не должно заменяться импортированной суммой.
      collected: awardedRaw,
      total_fulfilled_sum: String(nextFulfilled),
      total_unfulfilled_sum: String(nextUnfulfilled),
      execution_quarter: currentQuarter,
      execution_people_json: JSON.stringify(details),
      pk: row.pk_number || row.pk,
      case_num: row.case_num || row.case_number,
      claim_amount: row.claim_amount || row.sum_claim,
      sum_claim: row.claim_amount || row.sum_claim,
      provided_area: row.provided_area || row.area
    };
    try {
      await dbApi.updateEmergencyFund(row.id, payload);
      updated += 1;
    } catch (error) {
      console.warn('Не удалось обновить запись аварийного фонда', row.id, error);
    }
  }
  showNotification(`Отмечено исполненными ФИО: ${matchedPeople}. Обновлено записей: ${updated}`);
  closeImportDialog();
  await loadEmergencyFund();
}

function groupImportMatchesByEmergencyRow(matches = []) {
  const groups = new Map();

  matches.forEach((match, index) => {
    const row = match.matched;
    if (!row?.id) return;
    const key = String(row.id);
    if (!groups.has(key)) {
      groups.set(key, {
        row,
        matches: [],
        sources: new Map()
      });
    }

    const group = groups.get(key);
    group.matches.push(match);

    // Одна строка таблицы может содержать несколько ФИО. Статус сохраняется
    // отдельно для каждого человека, но сумма этой строки учитывается один раз.
    const sourceKey = match.sourceKey || getImportSourceKey(match.imported, index);
    if (!group.sources.has(sourceKey)) {
      group.sources.set(sourceKey, {
        key: sourceKey,
        amount: numberValue(match.amount),
        sourceFio: match.imported.originalFio || match.imported.fio,
        sourceAddress: match.imported.address || '',
        people: []
      });
    }
    const source = group.sources.get(sourceKey);
    const personName = match.matchedPerson || match.imported.fio;
    if (!source.people.some(name => normalizeFioPerson(name) === normalizeFioPerson(personName))) source.people.push(personName);
  });

  return Array.from(groups.values());
}

function closeImportDialog() {
  document.querySelector('[data-emergency-import-dialog]')?.close();
}

function openReportsDialog() {
  const select = document.querySelector('[data-emergency-report-quarter]');
  if (select) select.value = String(getCurrentQuarterNumber());
  renderReports(Number(select?.value || getCurrentQuarterNumber()));
  document.querySelector('[data-emergency-reports-dialog]')?.showModal();
}

function closeReportsDialog() {
  document.querySelector('[data-emergency-reports-dialog]')?.close();
}

function renderReports(quarter = 1) {
  const node = document.querySelector('[data-emergency-reports-body]');
  if (!node) return;
  const q = Math.min(Math.max(Number(quarter) || 1, 1), 4);
  const cumulative = state.rows.filter(row => getRowQuarter(row) <= q);
  const current = state.rows.filter(row => getRowQuarter(row) === q);

  node.innerHTML = `
    <section class="emergency-report-section">
      <h4>1. Общее количество дел</h4>
      ${renderCountReport(current, cumulative, q)}
    </section>
    <section class="emergency-report-section">
      <h4>2. Анализ дел по стадии рассмотрения</h4>
      ${renderStageReport(current, cumulative)}
    </section>
    <section class="emergency-report-section">
      <h4>3. Судебные акты</h4>
      ${renderJudicialActsReport(current, cumulative)}
    </section>
    <section class="emergency-report-section">
      <h4>4. Суммы и площади исполненных обязательств</h4>
      ${renderObligationsReport(current, cumulative)}
    </section>
    <section class="emergency-report-section">
      <h4>5. Адреса объектов и районы</h4>
      ${renderAddressReport(current, cumulative)}
    </section>
    <section class="emergency-report-section">
      <h4>6. Проблемные адреса и сроки расселения</h4>
      ${renderResettlementDeadlineReport(cumulative)}
    </section>
  `;
}

function renderCountReport(current, cumulative, q) {
  const rows = [
    ['Только выбранный квартал', current.length, countRequirement(current, 'изъят'), countRequirement(current, 'социальн'), countProsecutor(current), current.length - countProsecutor(current)],
    [`I–${roman(q)} кварталы`, cumulative.length, countRequirement(cumulative, 'изъят'), countRequirement(cumulative, 'социальн'), countProsecutor(cumulative), cumulative.length - countProsecutor(cumulative)]
  ];
  return renderSimpleTable(['Период', 'Всего', 'Изъятие ЖП', 'Соцнайм', 'Прокуратура', 'Граждане'], rows) + renderBar(rows.map(row => [row[0], row[1]]));
}

function renderStageReport(current, cumulative) {
  const stages = ['Экспертиза', 'Не назначено', 'На рассмотрении', 'На рассмотрении после экспертизы', 'Решение - удовлетворено', 'Решение - отказано'];
  const rows = stages.map(stage => [stage, current.filter(row => row.stage === stage).length, cumulative.filter(row => row.stage === stage).length]);
  return renderSimpleTable(['Стадия', 'Квартал', 'Накопительно'], rows) + renderBar(rows.map(row => [row[0], row[2]]));
}

function renderJudicialActsReport(current, cumulative) {
  const count = rows => rows.filter(row => ['Решение - удовлетворено', 'Решение - отказано'].includes(row.stage) && String(row.judicial_act_date || '').trim()).length;
  const rows = [['Квартал', count(current)], ['Накопительно', count(cumulative)]];
  return renderSimpleTable(['Период', 'Судебных актов'], rows) + renderBar(rows);
}

function renderObligationsReport(current, cumulative) {
  const sumFulfilled = rows => rows.reduce((sum, row) => sum + numberValue(row.total_fulfilled_sum), 0);
  const sumArea = rows => rows.reduce((sum, row) => sum + numberValue(row.provided_area || row.area || row.sum_property), 0);
  const rows = [['Квартал', money(sumFulfilled(current)), sumArea(current)], ['Накопительно', money(sumFulfilled(cumulative)), sumArea(cumulative)]];
  return renderSimpleTable(['Период', 'Исполнено, руб.', 'Площадь, м²'], rows) + renderBar([['Квартал', sumFulfilled(current)], ['Накопительно', sumFulfilled(cumulative)]]);
}

function renderAddressReport(current, cumulative) {
  const addressRows = topBy(cumulative, row => normalizeAddress(row.address)).slice(0, 7).map(([key, count]) => [key || 'Без адреса', count]);
  const districtRows = topBy(cumulative, row => row.district || 'Без района').slice(0, 7).map(([key, count]) => [key, count]);
  return `
    <h5>Адреса</h5>${renderSimpleTable(['Адрес', 'Количество'], addressRows)}${renderBar(addressRows)}
    <h5>Районы</h5>${renderSimpleTable(['Район', 'Количество'], districtRows)}${renderHeatmap(districtRows)}
  `;
}

function renderResettlementDeadlineReport(rows) {
  const analyzed = rows
    .map(row => ({ ...row, deadlineStatus: getDeadlineStatus(row) }))
    .filter(row => row.deadlineStatus.status !== 'Нет данных');

  if (!analyzed.length) {
    return '<p class="emergency-report-note">Заполните поля «Дата признания дома аварийным» и «Срок расселения по распоряжению», чтобы получить анализ проблемных адресов.</p>';
  }

  const statusRows = ['Просрочено', 'Критическая зона', 'Зона риска', 'Норма'].map(status => [
    status,
    analyzed.filter(row => row.deadlineStatus.status === status).length
  ]);

  const detailRows = analyzed.map(row => [
    row.address || 'Без адреса',
    row.district || 'Без района',
    row.condemned_date || '—',
    row.resettlement_deadline || '—',
    row.deadlineStatus.status,
    row.deadlineStatus.note
  ]);

  const overdueByQuarter = topBy(analyzed.filter(row => row.deadlineStatus.status === 'Просрочено'), row => getQuarterFromDate(row.resettlement_deadline)).map(([key, count]) => [key || 'Без квартала', count]);

  return `
    <h5>Статусы сроков</h5>
    ${renderSimpleTable(['Статус', 'Количество'], statusRows)}
    ${renderBar(statusRows)}
    <h5>Проблемные адреса</h5>
    ${renderSimpleTable(['Адрес', 'Район', 'Дата признания аварийным', 'Срок расселения', 'Статус', 'Комментарий'], detailRows)}
    <h5>Динамика накопления просрочек по кварталам</h5>
    ${overdueByQuarter.length ? renderSimpleTable(['Квартал', 'Просрочек'], overdueByQuarter) + renderBar(overdueByQuarter) : '<p class="muted">Просроченных адресов нет.</p>'}
  `;
}

function getDeadlineStatus(row) {
  const deadline = parseRuOrIsoDate(row.resettlement_deadline);
  const condemned = parseRuOrIsoDate(row.condemned_date);
  if (!deadline && !condemned) return { status: 'Нет данных', note: 'Заполните дату признания аварийным и срок расселения.' };

  const today = new Date();
  const target = deadline || addYears(condemned, 3);
  if (!target) return { status: 'Нет данных', note: 'Не удалось определить контрольную дату.' };

  const daysLeft = Math.ceil((target - today) / 86400000);
  const legalLimit = condemned ? addYears(condemned, 3) : null;
  const exceedsThreeYears = Boolean(legalLimit && deadline && deadline > legalLimit);
  const suffix = exceedsThreeYears ? ' Срок по распоряжению превышает 3 года от даты признания.' : '';

  if (daysLeft < 0) return { status: 'Просрочено', note: `Просрочено на ${Math.abs(daysLeft)} дн.${suffix}` };
  if (daysLeft <= 90) return { status: 'Критическая зона', note: `До срока ${daysLeft} дн.${suffix}` };
  if (daysLeft <= 180) return { status: 'Зона риска', note: `До срока ${daysLeft} дн.${suffix}` };
  return { status: 'Норма', note: `До срока ${daysLeft} дн.${suffix}` };
}

function parseRuOrIsoDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return null;
}

function addYears(date, years) {
  if (!date) return null;
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

function getQuarterFromDate(value) {
  const date = parseRuOrIsoDate(value);
  if (!date) return '';
  return `${roman(Math.floor(date.getMonth() / 3) + 1)} квартал ${date.getFullYear()}`;
}

function renderSimpleTable(headers, rows) {
  return `<table class="emergency-report-table"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${formatText(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderBar(rows) {
  const max = Math.max(1, ...rows.map(row => numberValue(row[1])));
  return `<div class="emergency-report-bars">${rows.map(([label, value]) => `<div class="emergency-report-bar"><span>${escapeHtml(label)}</span><b style="--bar:${Math.round((numberValue(value) / max) * 100)}%"></b><em>${escapeHtml(value)}</em></div>`).join('')}</div>`;
}

function renderHeatmap(rows) {
  const max = Math.max(1, ...rows.map(row => numberValue(row[1])));
  return `<div class="emergency-heatmap">${rows.map(([label, value]) => `<div class="emergency-heatmap-cell" style="--heat:${Math.max(12, Math.round((numberValue(value) / max) * 100))}%"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('')}</div>`;
}

function topBy(rows, getter) {
  const map = new Map();
  rows.forEach(row => {
    const key = String(getter(row) || '').trim();
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function countRequirement(rows, text) {
  const needle = text.toLowerCase();
  return rows.filter(row => String(row.requirements || '').toLowerCase().includes(needle)).length;
}

function countProsecutor(rows) {
  return rows.filter(row => String(row.prosecutor || '').trim()).length;
}

function getRowQuarter(row) {
  const explicit = String(row.kvartal || row.execution_quarter || '').match(/(I|II|III|IV|1|2|3|4)/i)?.[1];
  if (explicit) return romanToNumber(explicit);
  const date = row.created_at || row.judicial_act_date || '';
  const month = parseDateMonth(date);
  return month ? Math.ceil(month / 3) : 1;
}

function getCurrentQuarterNumber() {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

function roman(value) {
  return ['', 'I', 'II', 'III', 'IV'][Number(value) || 1] || 'I';
}

function romanToNumber(value) {
  const v = String(value || '').toUpperCase();
  if (v === 'I') return 1;
  if (v === 'II') return 2;
  if (v === 'III') return 3;
  if (v === 'IV') return 4;
  return Math.min(Math.max(Number(v) || 1, 1), 4);
}

function parseDateMonth(value) {
  const text = String(value || '');
  const ru = text.match(/\b\d{1,2}\.(\d{1,2})\.\d{4}\b/);
  if (ru) return Number(ru[1]);
  const iso = text.match(/\b\d{4}-(\d{1,2})-\d{1,2}\b/);
  if (iso) return Number(iso[1]);
  return 0;
}

function getUnfulfilledSum(row) {
  const awarded = numberValue(row.collected);
  const fulfilled = numberValue(row.total_fulfilled_sum);
  if (awarded || fulfilled) return Math.max(awarded - fulfilled, 0);
  return numberValue(row.total_unfulfilled_sum);
}

function getUnfulfilledArea(row) {
  const awardedArea = numberValue(row.provided_area || row.area);
  const fulfilledArea = numberValue(row.total_provided_area);
  if (awardedArea || fulfilledArea) return Math.max(awardedArea - fulfilledArea, 0);
  return numberValue(row.total_unfulfilled_area);
}

function getSurname(value) {
  return String(value || '').trim().split(/\s+/)[0]?.toLowerCase().replace(/ё/g, 'е') || '';
}

function normalizeAddress(value) {
  return String(value || '').replace(/,?\s*кв\.?\s*\d+.*$/i, '').trim();
}

function numberValue(value) {
  const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return Number(normalized) || 0;
}

function areaText(value) {
  const n = numberValue(value);
  return n ? n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';
}

function money(value) {
  const n = numberValue(value);
  return n ? n.toLocaleString('ru-RU') : '';
}

function getCurrentQuarterText() {
  const now = new Date();
  return `${roman(getCurrentQuarterNumber())} квартал ${now.getFullYear()} года`;
}
function formatRuDateInput(input) {
  let digits = String(input.value || '').replace(/\D/g, '').slice(0, 8);
  input.value = digits.length > 4 ? `${digits.slice(0,2)}.${digits.slice(2,4)}.${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0,2)}.${digits.slice(2)}` : digits;
}
function formatPk(input) {
  let value = String(input.value || '').replace(/[^0-9/]/g, '');
  const year = String(new Date().getFullYear());
  if (value.endsWith('/') && !value.endsWith(`/${year}`)) value += year;
  input.value = value;
}
function formatCaseNumber(input) {
  let value = String(input.value || '').replace('A', 'А').replace('a', 'а').replace(/[^А-Яа-я0-9-]/g, '');
  const prefixes = ['А03','13','12','11','10','2а','9','8','5','4','3','2','1'];
  for (const prefix of prefixes) {
    if (value.toLowerCase() === prefix.toLowerCase()) { value = `${prefix}-`; break; }
  }
  input.value = value;
}
function formatText(value) {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
}
