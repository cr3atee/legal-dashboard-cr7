import { dbApi } from '../../api/dbApi.js';

const state = {
  initialized: false,
  prosecutorMode: false,
  bypass: false,
  rows: new Map(),
  timer: null,
  dialog: null,
  select: null,
  categories: [],
  activeIndex: -1
};

export function initCaseUiEnhancements() {
  if (state.initialized) return;
  state.initialized = true;
  patchCaseLoading();
  ensureCategoryDialog();

  document.addEventListener('input', handleInput, true);
  document.addEventListener('pointerdown', handleCategoryPointer, true);
  document.addEventListener('keydown', handleCategoryKey, true);
  document.addEventListener('click', handleCategoryClick, true);
  window.addEventListener('general-cases:updated', event => {
    rememberRows(event.detail);
    schedule();
  });
  window.addEventListener('general-cases:reload', () => setTimeout(refreshRows, 120));
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'cases') void refreshRows();
  });

  const root = document.querySelector('#cases');
  if (root) new MutationObserver(schedule).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'class', 'hidden']
  });
  void refreshRows();
  schedule();
}

function patchCaseLoading() {
  if (dbApi.__prosecutorOrderPatched) return;
  dbApi.__prosecutorOrderPatched = true;
  const active = dbApi.getGeneralCases.bind(dbApi);
  const archived = dbApi.getArchivedGeneralCases.bind(dbApi);
  dbApi.getGeneralCases = async options => order(await active(options));
  dbApi.getArchivedGeneralCases = async options => order(await archived(options));
}

function order(rows) {
  rememberRows(rows);
  if (!state.prosecutorMode) return rows;
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    Number(b.prosecutor_claim_flag || 0) - Number(a.prosecutor_claim_flag || 0)
    || Number(b.id || 0) - Number(a.id || 0));
}

function handleInput(event) {
  if (event.target.matches?.('[data-case-category-search]')) {
    renderCategories(event.target.value);
    return;
  }
  const select = event.target.closest?.('[data-general-type-filter]');
  if (!select || state.bypass) return;
  if (select.value === 'prosecutor') {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.prosecutorMode = true;
    state.bypass = true;
    select.value = 'all';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    state.bypass = false;
    setTimeout(() => {
      ensureProsecutorOption(select);
      select.value = 'prosecutor';
    }, 0);
    window.dispatchEvent(new CustomEvent('general-cases:reload'));
    return;
  }
  const changed = state.prosecutorMode;
  state.prosecutorMode = false;
  if (changed) setTimeout(() => window.dispatchEvent(new CustomEvent('general-cases:reload')), 0);
}

async function refreshRows() {
  try {
    rememberRows(await dbApi.getGeneralCases());
    schedule();
  } catch {}
}

function rememberRows(rows) {
  if (!Array.isArray(rows)) return;
  rows.forEach(row => {
    const id = Number(row.id || row.source_id || 0);
    if (id) state.rows.set(id, row);
  });
}

function schedule() {
  clearTimeout(state.timer);
  state.timer = setTimeout(decorate, 35);
}

function decorate() {
  const type = document.querySelector('[data-general-type-filter]');
  if (type) {
    ensureProsecutorOption(type);
    if (state.prosecutorMode && type.value !== 'prosecutor') type.value = 'prosecutor';
  }
  document.querySelectorAll('[data-general-form] select[name="category"] option').forEach(option => {
    if (normalize(option.value || option.textContent) === 'all') option.remove();
  });
  document.querySelectorAll('.general-related-open-table').forEach(button => {
    if (button.textContent !== '…') button.textContent = '…';
    if (button.title !== 'Подробнее') button.title = 'Подробнее';
    if (button.getAttribute('aria-label') !== 'Подробнее') button.setAttribute('aria-label', 'Подробнее');
  });
  decorateMarkers();
  const dialog = document.querySelector('[data-general-dialog]');
  if (dialog) {
    dialog.querySelectorAll('select[name="category"]').forEach(enhanceCategoryField);
    const tab = dialog.querySelector('[data-general-case-tab].is-active')?.dataset.generalCaseTab || 'info';
    dialog.classList.toggle('is-plan-tab', tab === 'plan');
    dialog.classList.toggle('is-appeal-tab', tab === 'appeal');
  }
}

function ensureProsecutorOption(select) {
  if (select.querySelector('option[value="prosecutor"]')) return;
  const option = new Option('Иски прокурора', 'prosecutor');
  select.insertBefore(option, select.querySelector('option[value="other"]'));
}

function decorateMarkers() {
  document.querySelectorAll('[data-general-card]').forEach(card => {
    const row = state.rows.get(Number(card.dataset.generalCard || 0));
    const box = card.querySelector('.general-case-badges');
    const badge = box?.querySelector('[data-prosecutor-case-badge]');
    if (Number(row?.prosecutor_claim_flag || 0) === 1) {
      card.querySelector('.case-badge.neutral')?.remove();
      if (!badge) box?.insertAdjacentHTML('beforeend', '<span class="case-badge prosecutor" data-prosecutor-case-badge>Иск прокурора</span>');
    } else badge?.remove();
  });
  document.querySelectorAll('[data-general-row]').forEach(tableRow => {
    const row = state.rows.get(Number(tableRow.dataset.generalRow || 0));
    const box = tableRow.querySelector('.general-cases-table-badges');
    const marker = box?.querySelector('[data-prosecutor-case-marker]');
    if (Number(row?.prosecutor_claim_flag || 0) === 1) {
      if (!marker) box?.insertAdjacentHTML('beforeend', '<span class="case-table-marker prosecutor" data-prosecutor-case-marker title="Иск прокурора" aria-label="Иск прокурора"></span>');
    } else marker?.remove();
  });
}

function enhanceCategoryField(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.parentElement) select.parentElement.style.position = 'relative';
  let trigger = select.parentElement?.querySelector('[data-case-category-trigger]');
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'case-category-trigger';
    trigger.dataset.caseCategoryTrigger = '1';
    trigger.setAttribute('aria-haspopup', 'dialog');
    select.insertAdjacentElement('afterend', trigger);
  }
  select.classList.add('case-category-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  if (!select.dataset.caseCategoryTriggerBound) {
    select.addEventListener('change', () => {
      const nextTrigger = select.parentElement?.querySelector('[data-case-category-trigger]');
      if (nextTrigger) syncCategoryTrigger(select, nextTrigger);
    });
    select.dataset.caseCategoryTriggerBound = '1';
  }
  syncCategoryTrigger(select, trigger);
}

function syncCategoryTrigger(select, trigger) {
  const value = String(select.value || '').trim();
  trigger.textContent = value || 'Не выбрано';
  trigger.classList.toggle('is-empty', !value);
  trigger.setAttribute('aria-label', value ? `Категория спора: ${value}` : 'Категория спора: не выбрано');
}

function handleCategoryPointer(event) {
  const trigger = event.target.closest?.('[data-case-category-trigger]');
  const select = trigger?.parentElement?.querySelector('select[name="category"]');
  if (!select || select.disabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openCategoryDialog(select);
}

function handleCategoryKey(event) {
  const trigger = event.target.closest?.('[data-case-category-trigger]');
  if (trigger) {
    const select = trigger.parentElement?.querySelector('select[name="category"]');
    if (!select || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void openCategoryDialog(select);
    return;
  }
  const search = event.target.closest?.('[data-case-category-search]');
  if (!search || !state.dialog?.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCategoryDialog();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveCategoryActive(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter' && state.activeIndex >= 0) {
    event.preventDefault();
    const value = visibleCategoryValues()[state.activeIndex] || '';
    if (value) applyCategoryValue(value);
  }
}

async function openCategoryDialog(select) {
  state.select = select;
  const stored = await dbApi.getOptions('case_category').catch(() => []);
  state.categories = unique([select.value, ...stored]).filter(value => normalize(value) !== 'all');
  const dialog = ensureCategoryDialog();
  const search = dialog.querySelector('[data-case-category-search]');
  search.value = '';
  renderCategories('');
  if (!dialog.open) dialog.showModal();
  setTimeout(() => search.focus(), 20);
}

function ensureCategoryDialog() {
  if (state.dialog?.isConnected) return state.dialog;
  const dialog = document.createElement('dialog');
  dialog.className = 'case-category-picker-dialog';
  dialog.innerHTML = `<div class="case-category-picker-card">
    <div class="case-category-picker-head"><div><h3>Категория спора</h3><p>Выберите категорию из справочника.</p></div><button class="icon-button" type="button" data-case-category-close>×</button></div>
    <input type="search" data-case-category-search placeholder="Поиск категории" autocomplete="off">
    <div class="case-category-picker-list" data-case-category-list role="listbox"></div>
  </div>`;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeCategoryDialog();
  });
  document.body.append(dialog);
  state.dialog = dialog;
  return dialog;
}

function handleCategoryClick(event) {
  if (event.target.closest?.('[data-case-category-close]')) return closeCategoryDialog();
  const button = event.target.closest?.('[data-case-category-value]');
  if (!button || !state.dialog?.contains(button)) return;
  applyCategoryValue(button.dataset.caseCategoryValue || '');
}

function renderCategories(query) {
  const list = state.dialog?.querySelector('[data-case-category-list]');
  if (!list) return;
  const values = visibleCategoryValues(query);
  const currentValue = normalize(state.select?.value);
  state.activeIndex = values.length
    ? Math.max(0, values.findIndex(value => normalize(value) === currentValue))
    : -1;
  if (state.activeIndex < 0 && values.length) state.activeIndex = 0;
  list.innerHTML = values.length
    ? values.map((value, index) => `
      <button
        type="button"
        role="option"
        aria-selected="${index === state.activeIndex ? 'true' : 'false'}"
        class="${index === state.activeIndex ? 'is-active' : ''}"
        data-case-category-value="${attr(value)}"
        data-case-category-index="${index}"
      >${html(value)}</button>
    `).join('')
    : '<div class="case-category-picker-empty">Категории не найдены</div>';
  syncCategoryActive();
}

function closeCategoryDialog() {
  if (state.dialog?.open) state.dialog.close();
  state.select = null;
  state.activeIndex = -1;
}

function visibleCategoryValues(query = state.dialog?.querySelector('[data-case-category-search]')?.value || '') {
  const term = normalize(query);
  return state.categories.filter(value => !term || normalize(value).includes(term));
}

function moveCategoryActive(step) {
  const values = visibleCategoryValues();
  if (!values.length) return;
  state.activeIndex = state.activeIndex < 0
    ? 0
    : (state.activeIndex + step + values.length) % values.length;
  syncCategoryActive();
}

function syncCategoryActive() {
  const list = state.dialog?.querySelector('[data-case-category-list]');
  if (!list) return;
  list.querySelectorAll('[data-case-category-index]').forEach(button => {
    const isActive = Number(button.dataset.caseCategoryIndex) === state.activeIndex;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    if (isActive) button.scrollIntoView({ block: 'nearest' });
  });
}

function applyCategoryValue(value) {
  if (!state.select) return;
  let option = [...state.select.options].find(item => item.value === value);
  if (!option) {
    option = new Option(value, value, true, true);
    state.select.add(option);
  }
  state.select.value = value;
  state.select.dispatchEvent(new Event('input', { bubbles: true }));
  state.select.dispatchEvent(new Event('change', { bubbles: true }));
  const trigger = state.select.parentElement?.querySelector('[data-case-category-trigger]');
  if (trigger) syncCategoryTrigger(state.select, trigger);
  closeCategoryDialog();
}

function unique(values) {
  const map = new Map();
  values.forEach(raw => {
    const value = String(raw || '').trim();
    if (value && !map.has(normalize(value))) map.set(normalize(value), value);
  });
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function attr(value) {
  return html(value).replaceAll('`', '&#096;');
}
