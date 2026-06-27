import { dbApi } from '../../api/dbApi.js';

const state = {
  initialized: false,
  prosecutorMode: false,
  bypassTypeEvent: false,
  rowsById: new Map(),
  observer: null,
  timer: null,
  categoryDialog: null,
  categorySelect: null,
  categoryValues: []
};

export function initCaseUiEnhancements() {
  if (state.initialized) return;
  state.initialized = true;
  patchCaseLoadOrder();
  ensureCategoryDialog();

  document.addEventListener('input', handleTypeFilterInput, true);
  document.addEventListener('pointerdown', handleCategoryPointerDown, true);
  document.addEventListener('keydown', handleCategoryKeyDown, true);
  document.addEventListener('click', handleCategoryDialogClick, true);
  document.addEventListener('input', event => {
    if (event.target.matches('[data-case-category-search]')) renderCategoryChoices(event.target.value);
  });

  window.addEventListener('general-cases:updated', event => {
    updateRows(event.detail);
    scheduleDecorate();
  });
  window.addEventListener('general-cases:reload', () => window.setTimeout(refreshRows, 120));
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'cases') void refreshRows();
  });

  const root = document.querySelector('#cases');
  if (root) {
    state.observer = new MutationObserver(scheduleDecorate);
    state.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  }
  void refreshRows();
  scheduleDecorate();
}

function patchCaseLoadOrder() {
  if (dbApi.__prosecutorOrderPatched) return;
  dbApi.__prosecutorOrderPatched = true;
  const originalActive = dbApi.getGeneralCases.bind(dbApi);
  const originalArchive = dbApi.getArchivedGeneralCases.bind(dbApi);

  dbApi.getGeneralCases = async options => {
    const rows = await originalActive(options);
    updateRows(rows);
    return state.prosecutorMode ? sortProsecutorFirst(rows) : rows;
  };
  dbApi.getArchivedGeneralCases = async options => {
    const rows = await originalArchive(options);
    updateRows(rows);
    return state.prosecutorMode ? sortProsecutorFirst(rows) : rows;
  };
}

function handleTypeFilterInput(event) {
  const select = event.target.closest?.('[data-general-type-filter]');
  if (!select || state.bypassTypeEvent) return;

  if (select.value === 'prosecutor') {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.prosecutorMode = true;
    state.bypassTypeEvent = true;
    select.value = 'all';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    state.bypassTypeEvent = false;
    window.setTimeout(() => {
      ensureProsecutorOption(select);
      select.value = 'prosecutor';
    }, 0);
    window.dispatchEvent(new CustomEvent('general-cases:reload'));
    return;
  }

  const leavingProsecutor = state.prosecutorMode;
  state.prosecutorMode = false;
  if (leavingProsecutor) window.setTimeout(() => window.dispatchEvent(new CustomEvent('general-cases:reload')), 0);
}

function sortProsecutorFirst(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const priority = Number(b.prosecutor_claim_flag || 0) - Number(a.prosecutor_claim_flag || 0);
    return priority || Number(b.id || 0) - Number(a.id || 0);
  });
}

async function refreshRows() {
  try {
    updateRows(await dbApi.getGeneralCases());
    scheduleDecorate();
  } catch {}
}

function updateRows(rows) {
  if (!Array.isArray(rows)) return;
  rows.forEach(row => {
    const id = Number(row.id || row.source_id || 0);
    if (id) state.rowsById.set(id, row);
  });
}

function scheduleDecorate() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(decorate, 35);
}

function decorate() {
  const typeSelect = document.querySelector('[data-general-type-filter]');
  if (typeSelect) {
    ensureProsecutorOption(typeSelect);
    if (state.prosecutorMode) typeSelect.value = 'prosecutor';
  }

  const category = document.querySelector('[data-general-form] select[name="category"]');
  category?.querySelectorAll('option').forEach(option => {
    const value = String(option.value || option.textContent || '').trim().toLowerCase();
    if (value === 'all') option.remove();
  });

  document.querySelectorAll('.general-related-open-table').forEach(button => {
    button.textContent = '…';
    button.title = 'Подробнее';
    button.setAttribute('aria-label', 'Подробнее');
  });

  decorateProsecutorMarkers();
  updateDialogMode();
}

function ensureProsecutorOption(select) {
  if (select.querySelector('option[value="prosecutor"]')) return;
  const option = document.createElement('option');
  option.value = 'prosecutor';
  option.textContent = 'Иски прокурора';
  const other = select.querySelector('option[value="other"]');
  select.insertBefore(option, other || null);
}

function decorateProsecutorMarkers() {
  document.querySelectorAll('[data-general-card]').forEach(card => {
    const row = state.rowsById.get(Number(card.dataset.generalCard || 0));
    const badges = card.querySelector('.general-case-badges');
    const existing = badges?.querySelector('[data-prosecutor-case-badge]');
    if (Number(row?.prosecutor_claim_flag || 0) === 1) {
      card.querySelector('.case-badge.neutral')?.remove();
      if (!existing) badges?.insertAdjacentHTML('beforeend', '<span class="case-badge prosecutor" data-prosecutor-case-badge>Иск прокурора</span>');
    } else existing?.remove();
  });

  document.querySelectorAll('[data-general-row]').forEach(tableRow => {
    const row = state.rowsById.get(Number(tableRow.dataset.generalRow || 0));
    const badges = tableRow.querySelector('.general-cases-table-badges');
    const existing = badges?.querySelector('[data-prosecutor-case-marker]');
    if (Number(row?.prosecutor_claim_flag || 0) === 1) {
      if (!existing) badges?.insertAdjacentHTML('beforeend', '<span class="case-table-marker prosecutor" data-prosecutor-case-marker title="Иск прокурора" aria-label="Иск прокурора"></span>');
    } else existing?.remove();
  });
}

function updateDialogMode() {
  const dialog = document.querySelector('[data-general-dialog]');
  if (!dialog) return;
  const active = dialog.querySelector('[data-general-case-tab].is-active')?.dataset.generalCaseTab || 'info';
  dialog.classList.toggle('is-plan-tab', active === 'plan');
  dialog.classList.toggle('is-appeal-tab', active === 'appeal');
}

function handleCategoryPointerDown(event) {
  const select = event.target.closest?.('[data-general-form] select[name="category"]');
  if (!select || select.disabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openCategoryDialog(select);
}

function handleCategoryKeyDown(event) {
  const select = event.target.closest?.('[data-general-form] select[name="category"]');
  if (!select || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openCategoryDialog(select);
}

async function openCategoryDialog(select) {
  state.categorySelect = select;
  const values = [...select.options.map(option => option.value), ...(await dbApi.getOptions('case_category').catch(() => []))];
  state.categoryValues = unique(values).filter(value => normalize(value) !== 'all');
  const dialog = ensureCategoryDialog();
  const search = dialog.querySelector('[data-case-category-search]');
  if (search) search.value = '';
  renderCategoryChoices('');
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => search?.focus(), 20);
}

function ensureCategoryDialog() {
  if (state.categoryDialog?.isConnected) return state.categoryDialog;
  const dialog = document.createElement('dialog');
  dialog.className = 'case-category-picker-dialog';
  dialog.innerHTML = `
    <div class="case-category-picker-card">
      <div class="case-category-picker-head">
        <div><h3>Категория спора</h3><p>Выберите категорию из справочника.</p></div>
        <button class="icon-button" type="button" data-case-category-close>×</button>
      </div>
      <input type="search" data-case-category-search placeholder="Поиск категории" autocomplete="off">
      <div class="case-category-picker-list" data-case-category-list></div>
    </div>`;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeCategoryDialog();
  });
  document.body.append(dialog);
  state.categoryDialog = dialog;
  return dialog;
}

function handleCategoryDialogClick(event) {
  if (event.target.closest?.('[data-case-category-close]')) {
    closeCategoryDialog();
    return;
  }
  const option = event.target.closest?.('[data-case-category-value]');
  if (!option || !state.categoryDialog?.contains(option)) return;
  chooseCategory(option.dataset.caseCategoryValue || '');
}

function renderCategoryChoices(query) {
  const list = state.categoryDialog?.querySelector('[data-case-category-list]');
  if (!list) return;
  const normalized = normalize(query);
  const values = state.categoryValues.filter(value => !normalized || normalize(value).includes(normalized));
  list.innerHTML = values.length
    ? values.map(value => `<button type="button" data-case-category-value="${escapeAttr(value)}">${escapeHtml(value)}</button>`).join('')
    : '<div class="case-category-picker-empty">Категории не найдены</div>';
}

function chooseCategory(value) {
  const select = state.categorySelect;
  if (!select || !value) return;
  if (![...select.options].some(option => option.value === value)) select.add(new Option(value, value));
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  closeCategoryDialog();
  select.focus();
}

function closeCategoryDialog() {
  if (state.categoryDialog?.open) state.categoryDialog.close();
  state.categorySelect = null;
}

function unique(values) {
  const map = new Map();
  values.forEach(raw => {
    const value = String(raw || '').trim();
    const key = normalize(value);
    if (value && key && !map.has(key)) map.set(key, value);
  });
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
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
