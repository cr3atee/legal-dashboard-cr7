import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';

const REGISTRY_VIEW_KEY = 'legal-dashboard-municipal-registry-view-v1';

let state = {
  initialized: false,
  rows: [],
  filteredRows: [],
  selectedId: null,
  search: '',
  viewMode: localStorage.getItem(REGISTRY_VIEW_KEY) || 'cards',
  activeSection: 'object'
};

export function initMunicipalRegistryPage() {
  if (state.initialized) return;
  state.initialized = true;

  document.addEventListener('click', event => {
    if (event.target.closest('[data-registry-refresh]')) loadRegistry();
    if (event.target.closest('[data-registry-new]')) { clearForm(false); openEditor(); }
    if (event.target.closest('[data-registry-open]')) toggleEditor();
    if (event.target.closest('[data-registry-clear]')) { clearForm(); openEditor(); }
    if (event.target.closest('[data-registry-delete]')) deleteSelected();
    if (event.target.closest('[data-registry-archive]')) archiveSelected();
    if (event.target.closest('[data-registry-archive-open]')) openArchive();
    if (event.target.closest('[data-registry-archive-close]')) closeArchive();

    const viewButton = event.target.closest('[data-registry-view]');
    if (viewButton) setViewMode(viewButton.dataset.registryView || 'cards');

    const sectionButton = event.target.closest('[data-registry-section]');
    if (sectionButton) setActiveSection(sectionButton.dataset.registrySection || 'object');

    const row = event.target.closest('[data-registry-row]');
    if (row) {
      selectRow(row.dataset.registryRow);
      fillSelected();
    }

    const card = event.target.closest('[data-registry-card]');
    if (card) {
      selectRow(card.dataset.registryCard);
      fillSelected();
    }

    const attach = event.target.closest('[data-registry-attach-document]');
    if (attach) document.querySelector('[data-registry-document-input]')?.click();

    const openDocument = event.target.closest('[data-registry-doc-open]');
    if (openDocument) openRegistryDocument(Number(openDocument.dataset.registryDocOpen || 0));

    const removeDocument = event.target.closest('[data-registry-doc-remove]');
    if (removeDocument) removeRegistryDocument(Number(removeDocument.dataset.registryDocRemove || 0));

    const restore = event.target.closest('[data-registry-archive-restore]');
    if (restore) restoreArchive(restore.dataset.registryArchiveRestore);
    const delArchive = event.target.closest('[data-registry-archive-delete]');
    if (delArchive) deleteArchive(delArchive.dataset.registryArchiveDelete);
  });

  document.addEventListener('input', event => {
    if (event.target.matches('[data-registry-search]')) {
      state.search = event.target.value;
      clearTimeout(window.__registrySearchTimer);
      window.__registrySearchTimer = setTimeout(applySearchAndRender, 150);
    }
    if (event.target.matches('[data-registry-date]')) formatRuDateInput(event.target);
    if (event.target.matches('[data-registry-pk]')) formatPk(event.target);
    if (event.target.matches('[data-registry-document-input]')) attachRegistryDocuments(event.target.files);
  });

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-registry-form]')) {
      event.preventDefault();
      saveRegistry(event.target);
    }
  });

  window.addEventListener('registry:reload', () => {
    loadRegistry();
  });

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'municipalRegistry') {
      loadRegistry();
    }
  });

  window.addEventListener('registry:open-general-case', async event => {
    const generalCaseId = Number(event.detail?.generalCaseId || 0);
    if (!generalCaseId) return;
    await loadRegistry();
    const row = state.rows.find(item => Number(item.general_case_id || 0) === generalCaseId);
    if (row) {
      selectRow(row.id);
      fillSelected();
      openEditor();
    }
  });

  checkDb();
  fillDatalists();
  clearForm(false);
  setViewMode(state.viewMode, false);
  setActiveSection('object');
  loadRegistry();
}

function openEditor() { setEditorOpen(true); }
function closeEditor() { setEditorOpen(false); }
function toggleEditor() {
  const isOpen = document.querySelector('[data-registry-editor]')?.classList.contains('is-open');
  if (isOpen) {
    closeEditor();
    return;
  }
  clearForm(false);
  openEditor();
}
function setEditorOpen(open) {
  document.querySelector('[data-registry-editor]')?.classList.toggle('is-open', open);
  document.querySelector('#municipalRegistry')?.classList.toggle('registry-editor-sheet-open', open);
  const btn = document.querySelector('[data-registry-open]');
  if (btn) btn.textContent = open ? '−' : '＋';
}

function setActiveSection(section = 'object') {
  state.activeSection = section;
  document.querySelectorAll('[data-registry-section]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.registrySection === section));
  document.querySelectorAll('[data-registry-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.registryPanel === section));
}

function setViewMode(mode = 'cards', persist = true) {
  state.viewMode = mode === 'table' ? 'table' : 'cards';
  if (persist) localStorage.setItem(REGISTRY_VIEW_KEY, state.viewMode);
  document.querySelectorAll('[data-registry-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.registryView === state.viewMode));
  const table = document.querySelector('[data-registry-table-view]');
  const cards = document.querySelector('[data-registry-cards-list]');
  if (table) {
    table.hidden = state.viewMode !== 'table';
    table.style.display = state.viewMode === 'table' ? '' : 'none';
  }
  if (cards) {
    cards.hidden = state.viewMode !== 'cards';
    cards.style.display = state.viewMode === 'cards' ? '' : 'none';
  }
}

function syncEditorActions() {
  const hasRow = Boolean(document.querySelector('[data-registry-form]')?.elements.id?.value);
  document.querySelector('[data-registry-archive]')?.toggleAttribute('hidden', !hasRow);
  document.querySelector('[data-registry-delete]')?.toggleAttribute('hidden', !hasRow);
}

function scrollOpenedEditorIntoView() {
  requestAnimationFrame(() => {
    document.querySelector('[data-registry-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function checkDb() {
  const node = document.querySelector('[data-registry-db-status]');
  if (!node) return;
  try { await dbApi.health(); node.textContent = 'База подключена'; }
  catch { node.textContent = 'API базы недоступен'; }
}

async function fillDatalists() {
  const court = document.querySelector('#registryCourtList');
  const stage = document.querySelector('#registryStageList');
  const users = document.querySelector('#registryUsersList');
  try { if (court) court.innerHTML = (await dbApi.getOptions('court')).map(v => `<option value="${escapeHtml(v)}"></option>`).join(''); } catch {}
  try { if (stage) stage.innerHTML = (await dbApi.getOptions('stage')).map(v => `<option value="${escapeHtml(v)}"></option>`).join(''); } catch {}
  try { if (users) users.innerHTML = (await dbApi.getUsers()).map(v => `<option value="${escapeHtml(v)}"></option>`).join(''); } catch {}
}

async function loadRegistry() {
  const body = document.querySelector('[data-registry-table-body]');
  const cards = document.querySelector('[data-registry-cards-list]');
  if (body) body.innerHTML = '<tr><td colspan="6" class="empty-cell">Загрузка...</td></tr>';
  if (cards) cards.innerHTML = '<div class="empty-card">Загрузка...</div>';
  try {
    state.rows = await dbApi.getMunicipalRegistry();
    applySearchAndRender();
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="6" class="empty-cell error">Не удалось загрузить реестр: ${escapeHtml(error.message)}</td></tr>`;
    if (cards) cards.innerHTML = `<div class="empty-card error">Не удалось загрузить реестр: ${escapeHtml(error.message)}</div>`;
  }
}

function applySearchAndRender() {
  const parts = String(state.search || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  state.filteredRows = !parts.length ? [...state.rows] : state.rows.filter(row => {
    const haystack = Object.values(row).map(v => String(v ?? '').toLowerCase()).join(' | ');
    return parts.every(part => haystack.includes(part));
  });
  renderTable();
  renderCards();
  const count = document.querySelector('[data-registry-count]');
  if (count) count.textContent = `${state.filteredRows.length} записей`;
}

function renderTable() {
  const body = document.querySelector('[data-registry-table-body]');
  if (!body) return;
  if (!state.filteredRows.length) { body.innerHTML = '<tr><td colspan="6" class="empty-cell">Записей не найдено</td></tr>'; return; }
  body.innerHTML = state.filteredRows.map(row => `
    <tr data-registry-row="${row.id}" class="${String(state.selectedId) === String(row.id) ? 'selected' : ''}">
      <td class="strong">${formatText(row.pk_number)}</td>
      <td>${formatText(row.address)}</td>
      <td>${formatText(row.fio || row.requirements)}</td>
      <td>${formatText(row.court)}</td>
      <td>${formatText(row.stage)}</td>
      <td>${formatText(row.collected)}</td>
    </tr>`).join('');
}

function renderCards() {
  const list = document.querySelector('[data-registry-cards-list]');
  if (!list) return;
  if (!state.filteredRows.length) { list.innerHTML = '<div class="empty-card">Записей не найдено</div>'; return; }
  list.innerHTML = state.filteredRows.map(row => `
    <article class="registry-object-card ${String(state.selectedId) === String(row.id) ? 'selected' : ''}" data-registry-card="${row.id}">
      <div class="registry-object-card-head">
        <strong>${formatText(row.pk_number || 'Без номера')}</strong>
        ${Number(row.review_ready || 0) === 1 ? '<span class="registry-review-badge">Отзыв готов</span>' : ''}
      </div>
      <div class="registry-object-card-fields">
        <div><span>№ дела в суде</span><b>${formatText(row.court_act_number || '—')}</b></div>
        <div><span>Адрес</span><b>${formatText(row.address || 'Адрес не указан')}</b></div>
        <div><span>Собственник</span><b>${formatText(row.fio || 'Собственник не указан')}</b></div>
      </div>
    </article>`).join('');
}

function selectRow(id) { state.selectedId = id; renderTable(); renderCards(); }
function getSelectedRow() { return state.rows.find(row => String(row.id) === String(state.selectedId)); }

function fillSelected() {
  const row = getSelectedRow();
  if (!row) { alert('Выберите запись.'); return; }
  fillForm(row);
  openEditor();
  scrollOpenedEditorIntoView();
  document.querySelector('[data-registry-editor-title]').textContent = 'Новая запись';
  document.querySelector('[data-registry-current-id]').textContent = 'Запись открыта для редактирования';
  setActiveSection('object');
  syncEditorActions();
}

function fillForm(row = {}) {
  const form = document.querySelector('[data-registry-form]');
  if (!form) return;
  for (const element of Array.from(form.elements)) {
    if (!element.name) continue;
    if (element.type === 'checkbox') {
      element.checked = Number(row[element.name] || 0) === 1;
    } else {
      element.value = row[element.name] ?? '';
    }
  }
  renderRegistryDocuments();
  syncEditorActions();
}

function clearForm(keepOpen = true) {
  const form = document.querySelector('[data-registry-form]');
  form?.reset();
  if (form?.elements.id) form.elements.id.value = '';
  if (form?.elements.general_case_id) form.elements.general_case_id.value = '';
  if (form?.elements.attachments_json) form.elements.attachments_json.value = '[]';
  if (form?.elements.review_ready) form.elements.review_ready.checked = false;
  if (form?.elements.kvartal) form.elements.kvartal.value = getCurrentQuarterText();
  state.selectedId = null;
  document.querySelector('[data-registry-editor-title]').textContent = 'Новая запись';
  document.querySelector('[data-registry-current-id]').textContent = 'Заполните поля и нажмите «Сохранить»';
  setActiveSection('object');
  renderTable();
  renderCards();
  renderRegistryDocuments();
  syncEditorActions();
  if (keepOpen) openEditor();
}

async function saveRegistry(form) {
  const data = formToData(form);
  try {
    if (data.id) {
      const updated = await dbApi.updateMunicipalRegistry(data.id, data);
      state.selectedId = updated.id || data.id;
      showNotification('Запись реестра обновлена');
    } else {
      const created = await dbApi.createMunicipalRegistry(data);
      state.selectedId = created.id;
      showNotification('Запись реестра добавлена');
    }
    await loadRegistry();
    clearForm(false);
    closeEditor();
  } catch (error) { alert('Не удалось сохранить запись:\n' + error.message); }
}
function formToData(form) {
  const data = {};
  for (const element of Array.from(form.elements)) {
    if (!element.name) continue;
    if (element.type === 'checkbox') data[element.name] = element.checked ? 1 : 0;
    else data[element.name] = String(element.value || '').trim();
  }
  return data;
}
async function deleteSelected() {
  const row = getSelectedRow();
  if (!row) { alert('Выберите запись для удаления.'); return; }
  if (!confirm('Удалить выбранную запись?')) return;
  try { await dbApi.deleteMunicipalRegistry(row.id); showNotification('Запись удалена'); clearForm(false); await loadRegistry(); }
  catch (error) { alert('Не удалось удалить запись:\n' + error.message); }
}
async function archiveSelected() {
  const row = getSelectedRow();
  if (!row) { alert('Выберите запись для переноса в архив.'); return; }
  if (!confirm('Перенести выбранную запись в архив?')) return;
  try { await dbApi.archiveMunicipalRegistry(row.id); showNotification('Запись перенесена в архив'); clearForm(false); await loadRegistry(); }
  catch (error) { alert('Не удалось перенести в архив:\n' + error.message); }
}
async function openArchive() {
  const dialog = document.querySelector('[data-registry-archive-dialog]');
  const body = document.querySelector('[data-registry-archive-body]');
  if (!dialog || !body) return;
  body.innerHTML = '<tr><td colspan="8" class="empty-cell">Загрузка...</td></tr>';
  dialog.showModal();
  try { renderArchive(await dbApi.getMunicipalRegistryArchive()); }
  catch (error) { body.innerHTML = `<tr><td colspan="8" class="empty-cell error">Не удалось открыть архив: ${escapeHtml(error.message)}</td></tr>`; }
}
function closeArchive() { document.querySelector('[data-registry-archive-dialog]')?.close(); }
function renderArchive(rows = []) {
  const body = document.querySelector('[data-registry-archive-body]');
  if (!body) return;
  if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="empty-cell">В архиве записей нет</td></tr>'; return; }
  body.innerHTML = rows.map(row => `
    <tr>
      <td class="strong">${formatText(row.pk_number)}</td><td>${formatText(row.address)}</td><td>${formatText(row.fio || row.requirements)}</td>
      <td>${formatText(row.court)}</td><td>${formatText(row.court_act_date)}</td><td>${formatText(row.court_act_number)}</td><td>${formatText(row.collected)}</td>
      <td class="archive-actions-cell"><button class="btn small restore" data-registry-archive-restore="${row.archive_id}" type="button">Восстановить</button><button class="btn small danger" data-registry-archive-delete="${row.archive_id}" type="button">Удалить</button></td>
    </tr>`).join('');
}
async function restoreArchive(archiveId) {
  try { await dbApi.restoreMunicipalRegistryArchive(archiveId); showNotification('Запись восстановлена'); await loadRegistry(); await openArchive(); }
  catch (error) { alert('Не удалось восстановить запись:\n' + error.message); }
}
async function deleteArchive(archiveId) {
  if (!confirm('Удалить запись из архива навсегда?')) return;
  try { await dbApi.deleteMunicipalRegistryArchive(archiveId); showNotification('Запись удалена из архива'); await openArchive(); }
  catch (error) { alert('Не удалось удалить запись из архива:\n' + error.message); }
}
function getRegistryAttachmentsFromForm() {
  const raw = document.querySelector('[data-registry-form]')?.elements.attachments_json?.value || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setRegistryAttachmentsToForm(attachments = []) {
  const field = document.querySelector('[data-registry-form]')?.elements.attachments_json;
  if (field) field.value = JSON.stringify(Array.isArray(attachments) ? attachments : []);
  renderRegistryDocuments();
}

async function attachRegistryDocuments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const attachments = getRegistryAttachmentsFromForm();
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    attachments.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size || 0, dataUrl });
  }
  setRegistryAttachmentsToForm(attachments);
  const input = document.querySelector('[data-registry-document-input]');
  if (input) input.value = '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать документ'));
    reader.readAsDataURL(file);
  });
}

function renderRegistryDocuments() {
  const list = document.querySelector('[data-registry-documents-list]');
  if (!list) return;
  const attachments = getRegistryAttachmentsFromForm();
  if (!attachments.length) {
    list.innerHTML = '<div class="registry-document-empty">Документы не прикреплены</div>';
    return;
  }
  list.innerHTML = attachments.map((doc, index) => `
    <div class="registry-document-row">
      <button class="registry-document-link" data-registry-doc-open="${index}" type="button">${escapeHtml(doc.name || `Документ ${index + 1}`)}</button>
      <button class="registry-document-remove" data-registry-doc-remove="${index}" type="button" aria-label="Удалить документ">×</button>
    </div>`).join('');
}

function openRegistryDocument(index) {
  const doc = getRegistryAttachmentsFromForm()[index];
  if (!doc?.dataUrl) return;
  const win = window.open(doc.dataUrl, '_blank');
  if (!win) {
    const link = document.createElement('a');
    link.href = doc.dataUrl;
    link.download = doc.name || 'document';
    link.click();
  }
}

function removeRegistryDocument(index) {
  const attachments = getRegistryAttachmentsFromForm();
  attachments.splice(index, 1);
  setRegistryAttachmentsToForm(attachments);
}

function getCurrentQuarterText() {
  const now = new Date();
  const q = now.getMonth() < 3 ? 'I' : now.getMonth() < 6 ? 'II' : now.getMonth() < 9 ? 'III' : 'IV';
  return `${q} квартал ${now.getFullYear()}`;
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
function formatText(value) {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
}
