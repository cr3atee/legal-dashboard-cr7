import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';
import { getCurrentUserName } from '../../auth/session.js';
import { BARNAUL_ADDRESS_SUGGESTIONS } from '../../data/barnaulAddressSuggestions.js';

const GENERAL_CASE_COLORS_KEY = 'legal-dashboard-general-case-status-colors-v1';
const DEFAULT_CASE_COLORS = { control: '#8b5cf6', attendance: '#ef4444', review: '#0284c7', emergency: '#f97316', registry: '#14b8a6' };
const GENERAL_CASE_VIEW_KEY = 'legal-dashboard-general-cases-view-mode-v1';
const GENERAL_CASE_COMMENTS_VIEWED_KEY = 'legal-dashboard-general-comments-viewed-v1';
const PROCEDURAL_POSITION_OPTIONS = [
  'Истец',
  'Ответчик',
  'Заявитель',
  'Заинтересованное лицо',
  'Третье лицо с самостоятельными требованиями',
  'Третье лицо без самостоятельных требований',
  'Прокурор'
];
const DISPUTE_CATEGORY_OPTIONS = [
  'Жилищные споры',
  'Благоустройство',
  'Дороги'
];
const GENERAL_REVIEW_RESULT_OPTIONS = [
  'На рассмотрении',
  'Удовлетворено',
  'Удовлетворено в части',
  'Отказано',
  'Прекращено',
  'Приостановлено',
  'Направлено по подсудности',
  'Назначена экспертиза',
  'Оставлено без рассмотрения',
  'Мировое соглашение',
  'Заявление возвращено заявителю'
];

let state = {
  rows: [],
  filteredRows: [],
  archived: false,
  search: '',
  initialized: false,
  expandedCaseIds: new Set(),
  typeFilter: 'all',
  proceduralPositionFilter: 'all',
  disputeCategoryFilter: 'all',
  page: 1,
  pageSize: 25,
  viewMode: loadGeneralCasesViewMode(),
  colors: loadGeneralCaseColors(),
  returnView: '',
  reviewApprovals: [],
  archiveWizard: {
    rows: [],
    filter: 'all',
    selectedIds: new Set()
  }
};

const CLAIM_ADDRESS_SUGGESTIONS = [
  'Алтайский край, г. Барнаул',
  'Алтайский край, г. Бийск',
  'Алтайский край, г. Рубцовск',
  'Алтайский край, г. Новоалтайск',
  'Алтайский край, г. Заринск',
  'Алтайский край, г. Камень-на-Оби',
  'Алтайский край, г. Алейск',
  'Алтайский край, г. Славгород'
];

const columns = [
  'case_no',
  'court_no',
  'court',
  'executor',
  'plaintiff',
  'defendant',
  'category',
  'procedural_position',
  'claim_subject',
  'claim_address',
  'registration_date',
  'review_result',
  'appeal',
  'appeal_info',
  'appeal_result',
  'obzhalovanie',
  'comments',
  'review_show_flag',
  'emergency_fund_flag',
  'registry_flag',
  'judicial_act_date_first',
  'motivated_decision_date',
  'appeal_act_date',
  'cassation_act_date',
  'documents_json',
  'first_instance_act_type',
  'process_kind',
  'act_instance',
  'proceeding_form',
  'appeal_kind',
  'order_copy_date',
  'apk_cassation_has_appeal',
  'supervision_cassation_exhausted',
  'late_motivated_received',
  'appeals_json'
];

let lastGeneralDialogOpenAt = 0;
let lastGeneralDialogOpenKey = '';
let currentDocumentPreview = null;
let currentDocumentPreviewUrl = '';

export function initGeneralCasesPage() {
  if (state.initialized) return;
  state.initialized = true;

  const previewDialog = document.querySelector('[data-general-document-preview]');
  previewDialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeDocumentPreview();
  });
  previewDialog?.addEventListener('click', event => {
    if (event.target === previewDialog) closeDocumentPreview();
  });

  // Ранний обработчик кнопок общего перечня.
  // Работает при запуске через npm run dev и не конфликтует с другими
  // глобальными обработчиками кликов.
  installGeneralCaseButtonFallbacks();
  if (!window.__generalCasesPrimaryClickInstalled) {
    window.__generalCasesPrimaryClickInstalled = true;
    document.addEventListener('click', handleGeneralPrimaryActionClick, true);
  }

  document.addEventListener('click', event => {
    if (handleGeneralAppealActionClick(event)) return;

    if (event.target.closest('[data-general-refresh]')) {
      event.preventDefault();
      loadGeneralCases();
    }

    if (event.target.closest('[data-general-color-reset]')) {
      state.colors = { ...DEFAULT_CASE_COLORS };
      saveGeneralCaseColors();
      syncGeneralCaseControls();
      renderCards();
    }

    const viewButton = event.target.closest('[data-general-view]');
    if (viewButton) {
      setGeneralCasesViewMode(viewButton.dataset.generalView || 'cards');
      return;
    }

    if (event.target.closest('[data-general-new]')) {
      event.preventDefault();
      event.stopPropagation();
      if (state.archived) {
        openGeneralArchiveWizard();
        return;
      }
      openDialog();
      return;
    }

    if (event.target.closest('[data-general-archive-wizard-close]')) {
      event.preventDefault();
      closeGeneralArchiveWizard();
      return;
    }

    if (event.target.closest('[data-general-archive-select-all]')) {
      event.preventDefault();
      selectAllVisibleArchiveCandidates();
      return;
    }

    if (event.target.closest('[data-general-archive-add-selected]')) {
      event.preventDefault();
      addSelectedGeneralCasesToArchive();
      return;
    }

    if (event.target.closest('[data-general-close]')) {
      event.preventDefault();
      closeDialog();
    }

    if (event.target.closest('[data-general-back]')) {
      event.preventDefault();
      returnToSourceView();
      return;
    }

    const toggle = event.target.closest('[data-general-archive-toggle]');
    if (toggle) {
      event.preventDefault();
      state.archived = !state.archived;
      syncArchiveToggleButton();
      state.page = 1;
      loadGeneralCases();
    }

    const open = event.target.closest('[data-general-open]');
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      openGeneralCaseById(open.dataset.generalOpen, open);
      return;
    }

    const relatedOpen = event.target.closest('[data-general-related-open]');
    if (relatedOpen) {
      event.preventDefault();
      event.stopPropagation();
      openGeneralRelatedDestinations(Number(relatedOpen.dataset.generalRelatedOpen || 0));
      return;
    }

    const printPreview = event.target.closest('[data-general-print-preview]');
    if (printPreview) {
      event.preventDefault();
      event.stopPropagation();
      openGeneralCasePrintPreview(printPreview.dataset.generalPrintPreview);
      return;
    }

    const cardToggle = event.target.closest('[data-general-card-toggle]');
    if (cardToggle) {
      const id = Number(cardToggle.dataset.generalCardToggle || 0);
      if (id) {
        toggleCaseCard(id);
      }
      return;
    }

    if (event.target.closest('[data-general-appeal-add]')) {
      addAppealRow();
      return;
    }

    const appealRemove = event.target.closest('[data-general-appeal-remove]');
    if (appealRemove) {
      removeAppealRow(appealRemove);
      return;
    }

    const tabButton = event.target.closest('[data-general-case-tab]');
    if (tabButton) {
      switchGeneralCaseTab(tabButton.dataset.generalCaseTab || 'info');
      return;
    }

    if (event.target.closest('[data-general-document-attach]')) {
      document.querySelector('[data-general-document-input]')?.click();
      return;
    }

    const docRemove = event.target.closest('[data-general-document-remove]');
    if (docRemove) {
      removeDocumentRow(docRemove);
      return;
    }

    const docOpen = event.target.closest('[data-general-document-open-item]');
    if (docOpen) {
      const index = Number(docOpen.dataset.generalDocumentOpenItem || 0);
      openDocumentByIndex(index);
      return;
    }

    const docExternal = event.target.closest('[data-general-document-external-item]');
    if (docExternal) {
      const index = Number(docExternal.dataset.generalDocumentExternalItem || 0);
      const doc = getDocumentByIndex(index);
      if (doc) openDocumentExternal(doc);
      return;
    }

    const reviewAction = event.target.closest('[data-general-review-action]');
    if (reviewAction) {
      handleReviewApprovalAction(reviewAction);
      return;
    }

    if (event.target.closest('[data-general-document-open]')) {
      openDocumentsPicker();
      return;
    }

    if (event.target.closest('[data-general-document-preview-close]')) {
      closeDocumentPreview();
      return;
    }

    if (event.target.closest('[data-general-document-preview-external]')) {
      if (currentDocumentPreview) openDocumentExternal(currentDocumentPreview);
      return;
    }

    if (event.target.closest('[data-general-plan-add]')) {
      openCasePlanInCalendar();
      return;
    }

    const appealSubmitted = event.target.closest('[data-general-appeal-submitted]');
    if (appealSubmitted) {
      const row = appealSubmitted.closest('[data-general-appeal-row]');
      if (row) {
        row.classList.toggle('is-submitted');
        renderAppealRowResult(row);
        renderAppealSuggestions();
      }
      return;
    }

    const pageButton = event.target.closest('[data-general-page]');
    if (pageButton) {
      changeGeneralPage(pageButton.dataset.generalPage);
      return;
    }

    const restoreCard = event.target.closest('[data-general-restore-card]');
    if (restoreCard) {
      const id = Number(restoreCard.dataset.generalRestoreCard || 0);

      if (id && confirm('Восстановить дело из архива?')) {
        restoreCase(id);
      }

      return;
    }

    const restore = event.target.closest('[data-general-restore]');
    if (restore) {
      const form = document.querySelector('[data-general-form]');
      const id = Number(form?.elements.id.value || 0);

      if (id && confirm('Восстановить дело из архива?')) {
        restoreCase(id);
      }
    }

    const del = event.target.closest('[data-general-delete]');
    if (del) {
      const form = document.querySelector('[data-general-form]');
      const id = Number(form?.elements.id.value || 0);

      if (id && confirm('Перенести дело в архив?')) {
        archiveCase(id);
      }
    }
  });

  document.addEventListener('input', event => {
    if (event.target.matches('[data-ru-date]')) {
      applyRuDateMask(event.target);
    }

    if (event.target.matches('[data-general-document-comment], [data-general-document-row-note]')) {
      syncDocumentsHiddenInput();
    }

    if (event.target.matches('[data-general-act-date], [data-general-appeal-date], [data-general-motivated-date], [data-general-appeal-next-date], [data-general-appeal-control], [data-general-act-type], [name="category"], [name="court"], [name="procedural_position"]')) {
      syncAppealWizardVisibility();
      renderAppealResult();
      renderAppealSuggestions();
    }

    if (event.target.matches('[data-general-search]')) {
      state.search = event.target.value;
      state.page = 1;
      clearTimeout(window.__gcTimer);
      window.__gcTimer = setTimeout(applySearchAndRender, 180);
    }

    if (event.target.matches('[data-general-claim-subject]')) {
      syncClaimSubjectAddressField(event.target);
      renderClaimSubjectAddressSuggestions(event.target);
    }

    if (event.target.matches('[data-general-type-filter]')) {
      state.typeFilter = event.target.value || 'all';
      state.page = 1;
      applySearchAndRender();
    }

    if (event.target.matches('[data-general-procedural-position-filter]')) {
      state.proceduralPositionFilter = event.target.value || 'all';
      state.page = 1;
      applySearchAndRender();
    }

    if (event.target.matches('[data-general-dispute-category-filter]')) {
      state.disputeCategoryFilter = event.target.value || 'all';
      state.page = 1;
      applySearchAndRender();
    }

    if (event.target.matches('[data-general-control-color]')) {
      state.colors.control = event.target.value || DEFAULT_CASE_COLORS.control;
      saveGeneralCaseColors();
      syncGeneralCaseControls();
      renderCards();
    }

    if (event.target.matches('[data-general-attendance-color]')) {
      state.colors.attendance = event.target.value || DEFAULT_CASE_COLORS.attendance;
      saveGeneralCaseColors();
      syncGeneralCaseControls();
      renderCards();
    }

    if (event.target.matches('[data-general-review-color]')) {
      state.colors.review = event.target.value || DEFAULT_CASE_COLORS.review;
      saveGeneralCaseColors();
      syncGeneralCaseControls();
      renderCards();
    }

    if (event.target.matches('[data-general-emergency-color]')) {
      state.colors.emergency = event.target.value || DEFAULT_CASE_COLORS.emergency;
      saveGeneralCaseColors();
      syncGeneralCaseControls();
      renderCards();
    }
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-general-archive-filter]')) {
      state.archiveWizard.filter = event.target.value || 'all';
      state.archiveWizard.selectedIds.clear();
      renderGeneralArchiveWizard();
      return;
    }

    if (event.target.matches('[data-general-archive-candidate]')) {
      const id = Number(event.target.value || 0);
      if (id && event.target.checked) state.archiveWizard.selectedIds.add(id);
      if (id && !event.target.checked) state.archiveWizard.selectedIds.delete(id);
      return;
    }

    if (event.target.matches('[data-general-document-input]')) {
      handleDocumentFileInput(event.target);
      return;
    }

    if (event.target.matches('[data-ru-date]')) {
      applyRuDateMask(event.target);
    }

    if (event.target.matches('[data-general-act-date]')) {
      handleJudicialActDateChange(event.target);
    }

    if (event.target.matches('[data-general-motivated-date]')) {
      handleMotivatedDecisionDateChange(event.target);
    }

    if (event.target.matches('[data-general-appeal-date], [data-general-appeal-control]')) {
      renderAppealRowResult(event.target.closest('[data-general-appeal-row]'));
      renderAppealSuggestions();
    }
  });

  document.addEventListener('keydown', event => {
    if (!event.target.matches?.('[data-general-claim-subject]')) return;
    if (event.key === 'Escape') {
      hideClaimSubjectAddressSuggestions();
    }
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-general-address-suggestion]')) {
      const button = event.target.closest('[data-general-address-suggestion]');
      const input = document.querySelector('[data-general-claim-subject]');
      if (input) applyClaimSubjectAddressSuggestion(input, button.dataset.generalAddressSuggestion || '');
      return;
    }

    if (!event.target.closest('[data-general-claim-subject], [data-general-address-suggestions]')) {
      hideClaimSubjectAddressSuggestions();
    }
  });

  document.addEventListener('dblclick', event => {
    const card = event.target.closest?.('[data-general-card]');
    if (card && !event.target.closest('button, a, input, select, textarea, [data-general-card-toggle]')) {
      event.preventDefault();
      openGeneralCaseById(card.dataset.generalCard, card);
      return;
    }

    const row = event.target.closest?.('[data-general-row]');
    if (row && !event.target.closest('button, a, input, select, textarea')) {
      event.preventDefault();
      openGeneralCaseById(row.dataset.generalRow, row);
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-general-form]')) {
      event.preventDefault();

      if (!state.archived) {
        saveCase(event.target);
      }
    }
  });

  window.addEventListener('general-cases:reload', loadGeneralCases);

  fillDatalists();
  checkDb();
  syncGeneralCaseControls();
  bindGeneralCaseActionButtons();
  loadGeneralCases();
}


function installGeneralCaseButtonFallbacks() {
  window.__generalCasesOpenNew = () => {
    if (state.archived) {
      openGeneralArchiveWizard();
      return;
    }
    openGeneralCaseDialogSafe(null, { force: true });
  };
  window.__generalCasesOpenExisting = (id, sourceElement = null, options = {}) => openGeneralCaseById(id, sourceElement, options);

  if (!window.__generalCasesPointerFallbackInstalled) {
    window.__generalCasesPointerFallbackInstalled = true;
    document.addEventListener('pointerup', handleGeneralPrimaryActionClick, true);
  }
}

function handleGeneralPrimaryActionClick(event) {
  const target = event.target;
  if (!target?.closest) return false;

  const newButton = target.closest('[data-general-new]');
  if (newButton) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click' && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    if (state.archived) {
      openGeneralArchiveWizard();
      return true;
    }
    openGeneralCaseDialogSafe(null);
    return true;
  }

  const openButton = target.closest('[data-general-open]');
  if (openButton) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click' && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    openGeneralCaseById(openButton.dataset.generalOpen, openButton);
    return true;
  }

  return false;
}

async function openGeneralCaseById(id, sourceElement = null, options = {}) {
  const animated = animateGeneralCaseOpening(sourceElement);
  if (animated) await delay(130);

  let row = findGeneralCaseById(id);

  if (!row) {
    try {
      const rows = state.archived
        ? await dbApi.getArchivedGeneralCases()
        : await dbApi.getGeneralCases();
      state.rows = Array.isArray(rows) ? rows : [];
      state.filteredRows = sortRowsByTypeFilter(filterRows(state.rows, state.search));
      row = findGeneralCaseById(id);
    } catch (error) {
      console.error('Не удалось перечитать общий перечень перед открытием дела:', error);
    }
  }

  if (row) {
    openGeneralCaseDialogSafe(row, options);
  } else {
    showNotification('Дело не найдено в текущем списке. Нажмите «Обновить» и повторите.', 'error');
  }
}


function animateGeneralCaseOpening(sourceElement = null) {
  const source = sourceElement?.closest
    ? sourceElement
    : null;
  const card = source?.closest?.('.general-case-card-collapsible, .general-cases-table-row');
  if (!card) return false;
  card.classList.add('is-opening');
  window.setTimeout(() => card.classList.remove('is-opening'), 380);
  return true;
}

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function findGeneralCaseById(id) {
  const numericId = Number(id || 0);
  if (!numericId) return null;
  return state.filteredRows.find(item => Number(item.id) === numericId)
    || state.rows.find(item => Number(item.id) === numericId)
    || null;
}

async function checkDb() {
  const node = document.querySelector('[data-general-db-status]');
  if (!node) return;

  try {
    await dbApi.health();
    node.textContent = 'База подключена';
  } catch {
    node.textContent = 'API базы недоступен';
  }
}

async function fillDatalists() {
  fill('courtsList', 'court');
  fill('caseCategoriesList', 'case_category');
  fill('executorsList', 'representatives');
  syncClaimAddressDatalist();
}

async function fill(id, category) {
  const node = document.getElementById(id);
  if (!node) return;

  try {
    const values = await dbApi.getOptions(category);
    node.innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  } catch {
    node.innerHTML = '';
  }
}

function syncClaimAddressDatalist() {
  const node = document.getElementById('claimAddressList');
  if (!node) return;

  const savedAddresses = (state.rows || [])
    .map(row => String(row.claim_address || '').trim())
    .filter(Boolean);

  const values = Array.from(new Set([...CLAIM_ADDRESS_SUGGESTIONS, ...savedAddresses]));
  node.innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function splitClaimSubjectAndAddress(value) {
  const text = String(value || '').trim();
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0) return { subject: text, address: '' };

  return {
    subject: text.slice(0, commaIndex).trim(),
    address: text.slice(commaIndex + 1).split(',').map(part => part.trim()).filter(Boolean).join(', ')
  };
}

function formatClaimSubjectWithAddress(subject, address) {
  const cleanSubject = String(subject || '').trim();
  const cleanAddress = String(address || '').trim();
  if (!cleanAddress) return cleanSubject;
  if (!cleanSubject) return cleanAddress;

  const normalizedSubject = normalizeText(cleanSubject);
  const normalizedAddress = normalizeText(cleanAddress);
  if (normalizedSubject.includes(normalizedAddress)) return cleanSubject;
  return `${cleanSubject}, ${cleanAddress}`;
}

function getClaimSubjectAddressQuery(value) {
  const text = String(value || '');
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0) return null;

  const prefix = text.slice(0, commaIndex).trim();
  const addressParts = text.slice(commaIndex + 1).split(',');
  const query = String(addressParts.pop() || '').trim();
  const completedAddressParts = addressParts.map(part => part.trim()).filter(Boolean);
  const stage = completedAddressParts.length === 0
    ? 'locality'
    : (completedAddressParts.length === 1 ? 'street' : 'complete');

  return { prefix, query, completedAddressParts, stage };
}

function isAddressLocalitySuggestion(value) {
  return /^(?:г\.|п\.|с\.|р\.\s*п\.|ст\.)\s+/i.test(String(value || '').trim());
}

function isBarnaulLocality(value) {
  return normalizeAddressSuggestionSearch(value) === 'барнаул';
}

function syncClaimSubjectAddressField(input) {
  const form = input?.closest?.('form');
  const addressInput = form?.elements?.claim_address;
  if (!addressInput) return;
  addressInput.value = splitClaimSubjectAndAddress(input.value).address;
}

function renderClaimSubjectAddressSuggestions(input) {
  const box = document.querySelector('[data-general-address-suggestions]');
  const parsed = getClaimSubjectAddressQuery(input?.value);
  if (!box || !parsed || !parsed.query || parsed.stage === 'complete') {
    hideClaimSubjectAddressSuggestions();
    return;
  }

  let candidates;
  if (parsed.stage === 'locality') {
    candidates = BARNAUL_ADDRESS_SUGGESTIONS.filter(isAddressLocalitySuggestion);
  } else {
    const locality = parsed.completedAddressParts[0] || '';
    if (!isBarnaulLocality(locality)) {
      hideClaimSubjectAddressSuggestions();
      return;
    }
    candidates = BARNAUL_ADDRESS_SUGGESTIONS.filter(item => !isAddressLocalitySuggestion(item));
  }

  const normalizedQuery = normalizeText(parsed.query);
  const matches = candidates
    .filter(item => {
      const normalized = normalizeText(item);
      const plain = normalizeAddressSuggestionSearch(item);
      return normalized.startsWith(normalizedQuery) || plain.startsWith(normalizedQuery);
    })
    .sort((a, b) => {
      const aScore = getAddressSuggestionScore(a, normalizedQuery);
      const bScore = getAddressSuggestionScore(b, normalizedQuery);
      if (aScore !== bScore) return aScore - bScore;
      return a.localeCompare(b, 'ru');
    })
    .slice(0, 12);

  if (!matches.length) {
    hideClaimSubjectAddressSuggestions();
    return;
  }

  box.hidden = false;
  box.innerHTML = matches.map(item => `
    <button type="button" data-general-address-suggestion="${escapeAttr(item)}">
      ${escapeHtml(item)}
    </button>
  `).join('');
}

function hideClaimSubjectAddressSuggestions() {
  const box = document.querySelector('[data-general-address-suggestions]');
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';
}

function applyClaimSubjectAddressSuggestion(input, suggestion) {
  if (!input || !suggestion) return;

  const parsed = getClaimSubjectAddressQuery(input.value);
  if (!parsed) return;

  input.value = [parsed.prefix, ...parsed.completedAddressParts, suggestion]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  syncClaimSubjectAddressField(input);
  hideClaimSubjectAddressSuggestions();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function normalizeAddressSuggestionSearch(value) {
  return normalizeText(value).replace(/^(ул\.|пр-т|пер\.|пл\.|б-р|г\.|с\.|п\.|р\.\s*п\.|мкр\.|ст\.)\s*/, '');
}

function getAddressSuggestionScore(value, query) {
  const normalized = normalizeText(value);
  const plain = normalizeAddressSuggestionSearch(value);
  if (plain.startsWith(query)) return 0;
  if (normalized.startsWith(query)) return 1;
  return 2;
}

export async function loadGeneralCases() {
  const list = document.querySelector('[data-general-cards-list]');
  if (!list) return;

  list.innerHTML = '<div class="empty-card">Загрузка...</div>';

  try {
    state.rows = state.archived
      ? await dbApi.getArchivedGeneralCases()
      : await dbApi.getGeneralCases();

    syncClaimAddressDatalist();
    applySearchAndRender();
  } catch (error) {
    list.innerHTML = `<div class="empty-card error">Не удалось загрузить данные: ${escapeHtml(error.message)}</div>`;
    state.filteredRows = [];
    updateCount();
  }
}

function applySearchAndRender() {
  state.filteredRows = sortRowsByTypeFilter(filterRows(state.rows, state.search));
  syncGeneralCaseControls();
  renderCards();
  updateCount();
  window.dispatchEvent(new CustomEvent('general-cases:updated', { detail: state.filteredRows }));
}


function sortRowsByTypeFilter(rows) {
  const type = state.typeFilter || 'all';
  if (type === 'all') return [...rows];

  return [...rows].sort((a, b) => {
    let aPriority = 1;
    let bPriority = 1;

    if (type === 'control') {
      aPriority = Number(a.control_flag) === 1 ? 0 : 1;
      bPriority = Number(b.control_flag) === 1 ? 0 : 1;
    } else if (type === 'attendance') {
      aPriority = Number(a.attendance_flag) === 1 ? 0 : 1;
      bPriority = Number(b.attendance_flag) === 1 ? 0 : 1;
    } else if (type === 'review') {
      aPriority = Number(a.review_show_flag) === 1 ? 0 : 1;
      bPriority = Number(b.review_show_flag) === 1 ? 0 : 1;
    } else if (type === 'emergency') {
      aPriority = Number(a.emergency_fund_flag) === 1 ? 0 : 1;
      bPriority = Number(b.emergency_fund_flag) === 1 ? 0 : 1;
    } else if (type === 'registry') {
      aPriority = Number(a.registry_flag) === 1 ? 0 : 1;
      bPriority = Number(b.registry_flag) === 1 ? 0 : 1;
    } else if (type === 'other') {
      aPriority = Number(a.control_flag) !== 1 && Number(a.attendance_flag) !== 1 && Number(a.review_show_flag) !== 1 && Number(a.emergency_fund_flag) !== 1 && Number(a.registry_flag) !== 1 ? 0 : 1;
      bPriority = Number(b.control_flag) !== 1 && Number(b.attendance_flag) !== 1 && Number(b.review_show_flag) !== 1 && Number(b.emergency_fund_flag) !== 1 && Number(b.registry_flag) !== 1 ? 0 : 1;
    }

    if (aPriority !== bPriority) return aPriority - bPriority;

    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function loadGeneralCaseColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(GENERAL_CASE_COLORS_KEY) || '{}');
    return {
      control: saved.control || DEFAULT_CASE_COLORS.control,
      attendance: saved.attendance || DEFAULT_CASE_COLORS.attendance,
      review: saved.review || DEFAULT_CASE_COLORS.review,
      emergency: saved.emergency || DEFAULT_CASE_COLORS.emergency,
      registry: saved.registry || DEFAULT_CASE_COLORS.registry
    };
  } catch {
    return { ...DEFAULT_CASE_COLORS };
  }
}

function saveGeneralCaseColors() {
  localStorage.setItem(GENERAL_CASE_COLORS_KEY, JSON.stringify(state.colors));
}

function loadGeneralCasesViewMode() {
  const saved = localStorage.getItem(GENERAL_CASE_VIEW_KEY);
  return saved === 'table' ? 'table' : 'cards';
}

function setGeneralCasesViewMode(mode) {
  state.viewMode = mode === 'table' ? 'table' : 'cards';
  localStorage.setItem(GENERAL_CASE_VIEW_KEY, state.viewMode);
  renderCards();
}

function syncGeneralViewButtons() {
  document.querySelectorAll('[data-general-view]').forEach(button => {
    const active = button.dataset.generalView === state.viewMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const list = document.querySelector('[data-general-cards-list]');
  if (list) {
    list.classList.toggle('is-table-view', state.viewMode === 'table');
    list.classList.toggle('is-card-view', state.viewMode !== 'table');
  }
}

function syncGeneralCaseControls() {
  const type = document.querySelector('[data-general-type-filter]');
  const proceduralPosition = document.querySelector('[data-general-procedural-position-filter]');
  const disputeCategory = document.querySelector('[data-general-dispute-category-filter]');
  const control = document.querySelector('[data-general-control-color]');
  const attendance = document.querySelector('[data-general-attendance-color]');
  const review = document.querySelector('[data-general-review-color]');
  const emergency = document.querySelector('[data-general-emergency-color]');
  const registry = document.querySelector('[data-general-registry-color]');

  if (type) type.value = state.typeFilter || 'all';
  if (proceduralPosition) proceduralPosition.value = state.proceduralPositionFilter || 'all';
  if (disputeCategory) disputeCategory.value = state.disputeCategoryFilter || 'all';
  if (control) control.value = state.colors.control || DEFAULT_CASE_COLORS.control;
  if (attendance) attendance.value = state.colors.attendance || DEFAULT_CASE_COLORS.attendance;
  if (review) review.value = state.colors.review || DEFAULT_CASE_COLORS.review;
  if (emergency) emergency.value = state.colors.emergency || DEFAULT_CASE_COLORS.emergency;
  if (registry) registry.value = state.colors.registry || DEFAULT_CASE_COLORS.registry;

  const root = document.querySelector('#cases');
  if (root) {
    root.style.setProperty('--general-control-color', state.colors.control || DEFAULT_CASE_COLORS.control);
    root.style.setProperty('--general-attendance-color', state.colors.attendance || DEFAULT_CASE_COLORS.attendance);
    root.style.setProperty('--general-review-color', state.colors.review || DEFAULT_CASE_COLORS.review);
    root.style.setProperty('--general-emergency-color', state.colors.emergency || DEFAULT_CASE_COLORS.emergency);
    root.style.setProperty('--general-registry-color', state.colors.registry || DEFAULT_CASE_COLORS.registry);
  }

  syncArchiveToggleButton();
}


function syncArchiveToggleButton() {
  const toggle = document.querySelector('[data-general-archive-toggle]');
  if (!toggle) return;

  toggle.classList.toggle('primary', state.archived);
  toggle.innerHTML = state.archived
    ? '<span aria-hidden="true">↩</span><span>Активные дела</span>'
    : '<span aria-hidden="true">🗂</span><span>Архив</span>';
}

async function openGeneralArchiveWizard() {
  const dialog = document.querySelector('[data-general-archive-wizard]');
  const list = document.querySelector('[data-general-archive-list]');
  if (!dialog || !list) return;

  state.archiveWizard.filter = 'all';
  state.archiveWizard.selectedIds.clear();
  state.archiveWizard.rows = [];
  list.innerHTML = '<div class="empty-card">Загрузка кандидатов...</div>';

  try {
    if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  } catch {
    dialog.setAttribute('open', '');
  }

  const filter = document.querySelector('[data-general-archive-filter]');
  if (filter) filter.value = 'all';

  try {
    const rows = await dbApi.getGeneralCases();
    state.archiveWizard.rows = Array.isArray(rows) ? rows : [];
    renderGeneralArchiveWizard();
  } catch (error) {
    list.innerHTML = `<div class="empty-card error">Не удалось загрузить дела для архивации: ${escapeHtml(error.message)}</div>`;
  }
}

function closeGeneralArchiveWizard() {
  const dialog = document.querySelector('[data-general-archive-wizard]');
  state.archiveWizard.selectedIds.clear();
  if (!dialog) return;
  try {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  } catch {
    dialog.removeAttribute('open');
  }
}

function getGeneralArchiveCandidates() {
  const filter = state.archiveWizard.filter || 'all';
  return (state.archiveWizard.rows || [])
    .filter(row => getGeneralArchiveReadiness(row).ok)
    .filter(row => matchesGeneralArchiveFilter(row, filter))
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

function matchesGeneralArchiveFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'controlled') return Number(row.control_flag) === 1;
  if (filter === 'appearance') return Number(row.attendance_flag) === 1;
  if (filter === 'emergency') return Number(row.emergency_fund_flag) === 1;
  if (filter === 'registry') return Number(row.registry_flag) === 1;
  if (filter === 'other') return !hasArchiveMarker(row);
  return true;
}

function hasArchiveMarker(row) {
  return Number(row.control_flag) === 1
    || Number(row.attendance_flag) === 1
    || Number(row.emergency_fund_flag) === 1
    || Number(row.registry_flag) === 1;
}

function getGeneralArchiveReadiness(row) {
  const decision = firstFilled(row.review_result, row.first_instance_act_type);
  const actDate = firstFilled(row.judicial_act_date_first);
  const hasAppeal = hasGeneralArchiveAppealData(row);
  const reasons = [];

  if (!decision) reasons.push('не заполнено решение или итоговый судебный акт');
  if (!actDate) reasons.push('не заполнена дата судебного акта');
  if (hasAppeal) reasons.push('есть данные об обжаловании');

  return {
    ok: reasons.length === 0,
    reasons,
    decision,
    actDate
  };
}

function firstFilled(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function hasGeneralArchiveAppealData(row) {
  const directAppeal = [
    row.appeal,
    row.appeal_info,
    row.appeal_result,
    row.obzhalovanie,
    row.appeal_act_date,
    row.cassation_act_date,
    row.appeal_status,
    row.cassation,
    row.complaint,
    row.status
  ].some(value => String(value ?? '').trim());

  if (directAppeal) return true;

  const statusText = normalizeText([row.comments, row.status].filter(Boolean).join(' '));
  if (/(апелляц|кассац|жалоб|обжал)/.test(statusText)) return true;

  return parseAppeals(row.appeals_json).some(item => {
    if (item?.submitted) return true;
    return [
      item?.event_date,
      item?.date,
      item?.note,
      item?.next_motivated_date,
      item?.result,
      item?.status
    ].some(value => String(value ?? '').trim());
  });
}

function renderGeneralArchiveWizard() {
  const list = document.querySelector('[data-general-archive-list]');
  if (!list) return;

  const candidates = getGeneralArchiveCandidates();
  if (!candidates.length) {
    list.innerHTML = '<div class="empty-card">Нет дел, подходящих для архивации по выбранному фильтру</div>';
    return;
  }

  list.innerHTML = `
    <div class="general-archive-candidates-table-wrap">
      <table class="general-archive-candidates-table">
        <thead>
          <tr>
            <th></th>
            <th>№ ПК</th>
            <th>ФИО / наименование</th>
            <th>Предмет спора</th>
            <th>Адрес</th>
            <th>Пометки</th>
            <th>Решение</th>
            <th>Дата акта</th>
          </tr>
        </thead>
        <tbody>
          ${candidates.map(row => renderGeneralArchiveCandidateRow(row)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGeneralArchiveCandidateRow(row) {
  const readiness = getGeneralArchiveReadiness(row);
  const checked = state.archiveWizard.selectedIds.has(Number(row.id || 0)) ? 'checked' : '';
  return `
    <tr>
      <td><input type="checkbox" data-general-archive-candidate value="${escapeAttr(row.id)}" ${checked}></td>
      <td><strong>${formatInline(row.case_no, '—')}</strong></td>
      <td>${formatText(row.plaintiff || row.defendant)}</td>
      <td>${formatText(row.claim_subject)}</td>
      <td>${formatText(row.claim_address)}</td>
      <td><div class="general-archive-marker-list">${renderGeneralArchiveMarkers(row)}</div></td>
      <td>${formatText(readiness.decision)}</td>
      <td>${formatInline(readiness.actDate, '—')}</td>
    </tr>
  `;
}

function renderGeneralArchiveMarkers(row) {
  const markers = [];
  if (Number(row.control_flag) === 1) markers.push('Контрольное');
  if (Number(row.attendance_flag) === 1) markers.push('Явочное');
  if (Number(row.emergency_fund_flag) === 1) markers.push('Аварийный фонд');
  if (Number(row.registry_flag) === 1) markers.push('Выморочка');
  if (!markers.length) markers.push('Остальное');
  return markers.map(marker => `<span class="case-badge neutral">${escapeHtml(marker)}</span>`).join('');
}

function selectAllVisibleArchiveCandidates() {
  getGeneralArchiveCandidates().forEach(row => {
    const id = Number(row.id || 0);
    if (id) state.archiveWizard.selectedIds.add(id);
  });
  renderGeneralArchiveWizard();
}

async function addSelectedGeneralCasesToArchive() {
  const selectedIds = Array.from(state.archiveWizard.selectedIds);
  if (!selectedIds.length) {
    alert('Выберите хотя бы одно дело');
    return;
  }

  try {
    const freshRows = await dbApi.getGeneralCases();
    const byId = new Map((Array.isArray(freshRows) ? freshRows : []).map(row => [Number(row.id || 0), row]));
    const readyRows = [];
    const blocked = [];

    selectedIds.forEach(id => {
      const row = byId.get(Number(id));
      const readiness = row ? getGeneralArchiveReadiness(row) : { ok: false, reasons: ['дело не найдено в активном перечне'] };
      if (row && readiness.ok) readyRows.push(row);
      else blocked.push(`Дело №${row?.case_no || id} не может быть архивировано: ${readiness.reasons.join(', ')}`);
    });

    if (blocked.length) {
      alert(blocked.join('\n'));
    }

    if (!readyRows.length) return;

    for (const row of readyRows) {
      await dbApi.archiveGeneralCase(row.id);
    }

    showNotification(`В архив добавлено дел: ${readyRows.length}`);
    closeGeneralArchiveWizard();
    await loadGeneralCases();
  } catch (error) {
    alert('Не удалось добавить выбранные дела в архив:\n' + error.message);
  }
}

function getCaseStatusStyle(row) {
  if (Number(row.control_flag) === 1 && Number(row.attendance_flag) === 1) {
    return `--case-accent: linear-gradient(180deg, ${state.colors.control}, ${state.colors.attendance}); --case-folder-bg: linear-gradient(180deg, ${hexToRgba(state.colors.control, .18)}, ${hexToRgba(state.colors.attendance, .16)}); --case-folder-color: ${state.colors.control};`;
  }

  if (Number(row.attendance_flag) === 1) {
    return `--case-accent: ${state.colors.attendance}; --case-folder-bg: ${hexToRgba(state.colors.attendance, .16)}; --case-folder-color: ${state.colors.attendance};`;
  }

  if (Number(row.control_flag) === 1) {
    return `--case-accent: ${state.colors.control}; --case-folder-bg: ${hexToRgba(state.colors.control, .16)}; --case-folder-color: ${state.colors.control};`;
  }

  if (Number(row.emergency_fund_flag) === 1) {
    return `--case-accent: ${state.colors.emergency}; --case-folder-bg: ${hexToRgba(state.colors.emergency, .16)}; --case-folder-color: ${state.colors.emergency};`;
  }

  if (Number(row.registry_flag) === 1) {
    return `--case-accent: ${state.colors.registry}; --case-folder-bg: ${hexToRgba(state.colors.registry, .16)}; --case-folder-color: ${state.colors.registry};`;
  }

  if (Number(row.review_show_flag) === 1) {
    return `--case-accent: ${state.colors.review}; --case-folder-bg: ${hexToRgba(state.colors.review, .16)}; --case-folder-color: ${state.colors.review};`;
  }

  return '';
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return `rgba(45, 99, 255, ${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function filterRows(rows, rawSearch) {
  const parts = String(rawSearch || '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  const proceduralFilter = state.proceduralPositionFilter || 'all';
  const categoryFilter = state.disputeCategoryFilter || 'all';

  return rows.filter(row => {
    if (proceduralFilter !== 'all' && String(row.procedural_position || '') !== proceduralFilter) return false;
    if (categoryFilter !== 'all' && String(row.category || '') !== categoryFilter) return false;

    if (!parts.length) return true;

    const haystack = [
      ...columns.map(column => String(row[column] ?? '').toLowerCase()),
      ...getStatusSearchTokens(row)
    ].join(' | ');

    return parts.every(part => haystack.includes(part));
  });
}

function getStatusSearchTokens(row) {
  const tokens = [];

  if (Number(row.control_flag) === 1) {
    tokens.push('контроль', 'контрольное', 'контрольный', 'контрольность', 'контрольное дело');
  }

  if (Number(row.attendance_flag) === 1) {
    tokens.push('явка', 'явочное', 'явочный', 'явочность', 'явочное дело');
  }

  if (Number(row.attendance_hearing_missing) === 1) {
    tokens.push('дата заседания не указана', 'время заседания не указано', 'без даты заседания', 'нужно указать дату заседания');
  }

  if (Number(row.review_show_flag) === 1) {
    tokens.push('отзыв', 'отзывы', 'отзыв показать', 'показать отзыв');
  }

  if (Number(row.emergency_fund_flag) === 1) {
    tokens.push('аварийный фонд', 'аварийное', 'аварийный');
  }

  if (Number(row.registry_flag) === 1) {
    tokens.push('реестр', 'выморочка', 'выморочное дело', 'муниципальная собственность');
  }

  if (Number(row.control_flag) !== 1 && Number(row.attendance_flag) !== 1 && Number(row.review_show_flag) !== 1 && Number(row.emergency_fund_flag) !== 1 && Number(row.registry_flag) !== 1) {
    tokens.push('основные дела', 'основное дело');
  }

  return tokens;
}


function renderCards() {
  const list = document.querySelector('[data-general-cards-list]');
  if (!list) return;

  syncGeneralViewButtons();

  if (!state.filteredRows.length) {
    list.innerHTML = state.archived
      ? '<div class="empty-card">В архиве дел не найдено</div>'
      : '<div class="empty-card">Дела не найдены</div>';
    renderPagination();
    return;
  }

  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
  state.page = Math.min(Math.max(1, Number(state.page) || 1), totalPages);

  const start = (state.page - 1) * state.pageSize;
  const visibleRows = state.filteredRows.slice(start, start + state.pageSize);

  list.innerHTML = state.viewMode === 'table'
    ? renderCasesTable(visibleRows)
    : visibleRows.map(row => renderCaseCard(row)).join('');
  bindGeneralCaseActionButtons();
  renderPagination();
}


function bindGeneralCaseActionButtons() {
  // Кнопки карточек и таблицы пересоздаются после каждого renderCards().
  // Поэтому дополнительно навешиваем обработчики на реальные элементы,
  // а не на старые/несуществующие id вроде #addCaseBtn.
  document.querySelectorAll('[data-general-new]').forEach(button => {
    if (button.dataset.generalActionBound === '1') return;
    button.dataset.generalActionBound = '1';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (state.archived) {
        openGeneralArchiveWizard();
        return;
      }
      openGeneralCaseDialogSafe(null);
    });
  });

  document.querySelectorAll('[data-general-open]').forEach(button => {
    if (button.dataset.generalActionBound === '1') return;
    button.dataset.generalActionBound = '1';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openGeneralCaseById(button.dataset.generalOpen, button);
    });
  });
}

function renderPagination() {
  const node = document.querySelector('[data-general-pagination]');
  if (!node) return;

  const total = state.filteredRows.length;
  if (!total) {
    node.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const from = (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);

  node.innerHTML = `
    <div class="general-cases-pagination-info">
      Показано ${from}–${to} из ${total}
    </div>
    <div class="general-cases-pagination-actions">
      <button class="btn small" data-general-page="prev" type="button" ${state.page <= 1 ? 'disabled' : ''}>← Назад</button>
      <span>${state.page} / ${totalPages}</span>
      <button class="btn small" data-general-page="next" type="button" ${state.page >= totalPages ? 'disabled' : ''}>Вперёд →</button>
    </div>
  `;
}

function changeGeneralPage(direction) {
  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));

  if (direction === 'prev') state.page = Math.max(1, state.page - 1);
  if (direction === 'next') state.page = Math.min(totalPages, state.page + 1);

  renderCards();
  document.querySelector('[data-general-cards-list]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCasesTable(rows) {
  return `
    <div class="general-cases-table-wrap">
      <table class="general-cases-table">
        <colgroup>
          <col class="general-col-case-no">
          <col class="general-col-court-no">
          <col class="general-col-category">
          <col class="general-col-subject">
          <col class="general-col-plaintiff">
          <col class="general-col-status">
          <col class="general-col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>№ ПК</th>
            <th>№ дела в суде</th>
            <th>Категория спора</th>
            <th>Предмет спора</th>
            <th>Истец</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => renderCasesTableRow(row)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderCasesTableRow(row) {
  const statusBadges = renderCasesTableMarkers(row);
  const statusClass = getCaseStatusClass(row);
  const statusStyle = getCaseStatusStyle(row);

  return `
    <tr class="general-cases-table-row ${statusClass}" data-general-row="${row.id}" style="${statusStyle}">
      <td class="primary-cell"><span class="table-case-accent" aria-hidden="true"></span><strong>${formatInline(row.case_no, 'Без номера')}</strong></td>
      <td>${formatText(row.court_no)}</td>
      <td>${formatText(row.category)}</td>
      <td class="wide-cell">${formatText(row.claim_subject)}</td>
      <td>${formatText(row.plaintiff)}</td>
      <td class="status-cell"><div class="general-cases-table-badges">${statusBadges}</div></td>
      <td class="actions-cell">
        ${state.archived ? `<button class="btn small restore" data-general-restore-card="${row.id}" type="button">Восстановить</button>` : ''}
        ${renderRelatedOpenButton(row, 'table')}
        ${renderPrintPreviewButton(row, 'table')}
        <button class="general-case-edit-icon table-edit" data-general-open="${row.id}" onclick="if (window.__generalCasesOpenExisting) window.__generalCasesOpenExisting(this.dataset.generalOpen, this); return false;" type="button" aria-label="Редактировать" title="Редактировать">${pencilIcon()}</button>
      </td>
    </tr>
  `;
}

function renderCaseStatusBadge(className, fullLabel, displayLabel = fullLabel) {
  return `<span class="case-badge ${className}" title="${escapeAttr(fullLabel)}" aria-label="${escapeAttr(fullLabel)}">${escapeHtml(displayLabel)}</span>`;
}

function renderCasesTableMarkers(row) {
  const markers = [];
  const add = (className, label) => {
    markers.push(`<span class="case-table-marker ${className}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" role="img" tabindex="0"></span>`);
  };
  if (state.archived) add('archive', 'Архив');
  if (Number(row.attendance_flag) === 1) add('attendance', 'Явочное дело');
  if (Number(row.attendance_hearing_missing) === 1) add('hearing-missing', 'Дата и время заседания не указаны');
  if (Number(row.control_flag) === 1) add('control', 'Контрольное дело');
  if (Number(row.review_show_flag) === 1) add('review', 'Отзыв показать');
  if (Number(row.emergency_fund_flag) === 1) add('emergency', 'Аварийный фонд');
  if (Number(row.registry_flag) === 1) add('registry', 'Выморочка');
  if (commentSignature(row)) add(commentIsViewed(row) ? 'comment viewed' : 'comment new', commentIsViewed(row) ? 'Комментарий просмотрен' : 'Новый комментарий');
  return markers.join('');
}

function commentIsViewed(row = {}) {
  const comment = commentSignature(row);
  if (!comment || !row?.id) return false;
  const viewed = readCommentViewState()[row.id];
  return viewed?.signature === comment && Boolean(viewed?.viewed_at);
}

function renderCaseCard(row) {
  const id = Number(row.id || 0);
  const expanded = state.expandedCaseIds.has(id);
  const themeClass = getCaseThemeClass(id);
  const statusClass = getCaseStatusClass(row);
  const statusStyle = getCaseStatusStyle(row);
  const statusBadges = `
    ${state.archived ? '<span class="case-badge archive">Архив</span>' : ''}
    ${Number(row.attendance_flag) === 1 ? '<span class="case-badge attendance">Явочное</span>' : ''}
    ${Number(row.attendance_hearing_missing) === 1 ? '<span class="case-badge hearing-missing">Дата и время заседания не указаны</span>' : ''}
    ${Number(row.control_flag) === 1 ? '<span class="case-badge control">Контроль</span>' : ''}
    ${Number(row.review_show_flag) === 1 ? '<span class="case-badge review">Отзыв показать</span>' : ''}
    ${Number(row.emergency_fund_flag) === 1 ? '<span class="case-badge emergency">Аварийный фонд</span>' : ''}
    ${Number(row.registry_flag) === 1 ? '<span class="case-badge registry">Выморочка</span>' : ''}
    ${Number(row.control_flag) !== 1 && Number(row.attendance_flag) !== 1 && Number(row.review_show_flag) !== 1 && Number(row.emergency_fund_flag) !== 1 && Number(row.registry_flag) !== 1 && !state.archived ? '<span class="case-badge neutral">Основные дела</span>' : ''}
    ${getCommentBadge(row)}
  `;

  return `
    <article class="general-case-card general-case-card-modern general-case-card-collapsible ${expanded ? 'is-expanded' : ''} ${state.archived ? 'archived' : ''} ${themeClass} ${statusClass}" data-general-card="${row.id}" style="${statusStyle}">
      <div class="general-case-card-accent"></div>
      <div class="general-case-card-shell">
        <div class="general-case-icon-wrap" aria-hidden="true">
          <span class="general-case-folder-badge">${folderIcon()}</span>
        </div>

        <div class="general-case-body-wrap">
          <div class="general-case-compact-top">
            <div class="general-case-compact-title">
              <div>
                <span class="general-case-kicker">№ ПК</span>
                <h3>${formatInline(row.case_no, 'Без номера')}</h3>
              </div>
            </div>

            <div class="general-case-modern-side">
              <div class="general-case-status-actions">
                <div class="general-case-badges">${statusBadges}</div>
                <div class="general-case-actions general-case-modern-actions">
                  ${state.archived ? `<button class="btn small restore" data-general-restore-card="${row.id}" type="button">Восстановить</button>` : ''}
                  ${renderRelatedOpenButton(row, 'card')}
                  ${renderPrintPreviewButton(row, 'card')}
                  <button class="general-case-edit-icon" data-general-open="${row.id}" onclick="if (window.__generalCasesOpenExisting) window.__generalCasesOpenExisting(this.dataset.generalOpen, this); return false;" type="button" aria-label="Редактировать" title="Редактировать">${pencilIcon()}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="general-case-compact-grid">
            ${renderCompactField('№ дела в суде', row.court_no)}
            ${renderCompactField('Истец', row.plaintiff)}
            ${renderCompactField('Предмет спора', row.claim_subject)}
            ${renderCompactField('Адрес', row.claim_address)}
            ${renderCompactField('Категория спора', row.category)}
            ${renderCompactField('Процессуальное положение', row.procedural_position)}
          </div>

          <div class="general-case-expanded-content" ${expanded ? '' : 'hidden'}>
            <div class="general-case-expanded-row general-case-expanded-row-2">
              ${renderLineField('Суд', row.court)}
              ${renderLineField('№ дела в суде', row.court_no)}
              ${renderLineField('Ответчик', row.defendant, 'wide')}
              ${renderLineField('Адрес', row.claim_address, 'wide')}
            </div>

            <div class="general-case-expanded-row general-case-expanded-row-3">
              ${renderLineField('Тип акта суда первой инстанции', row.first_instance_act_type)}
              ${renderLineField('Дата вынесения судебного акта', row.judicial_act_date_first)}
              ${renderLineField('Результат рассмотрения', row.review_result)}
              ${renderLineField('Дата изготовления мотивированной части решения', row.motivated_decision_date)}
              ${renderLineField('Дата акта апелляционной инстанции', row.appeal_act_date)}
              ${renderLineField('Дата акта кассационной инстанции', row.cassation_act_date)}
              ${renderLineField('Обжалование', getAppealSummary(row), 'wide')}
              ${renderLineField('Комментарии', row.comments, 'wide')}
            </div>
          </div>
        </div>

        <div class="general-case-card-date-corner">${calendarIcon()}<span>${formatInline(row.registration_date, '—')}</span></div>

        <button class="general-case-expand-toggle general-case-more-toggle" data-general-card-toggle="${row.id}" type="button" title="Подробнее" aria-label="Подробнее" aria-expanded="${expanded ? 'true' : 'false'}">
          <span aria-hidden="true">•••</span>
        </button>
      </div>
    </article>
  `;
}



function renderPrintPreviewButton(row, variant = 'card') {
  const id = Number(row?.id || 0);
  if (!id) return '';
  const className = variant === 'table'
    ? 'general-case-print-preview table-print'
    : 'general-case-print-preview';

  return `<button class="${className}" data-general-print-preview="${id}" type="button" aria-label="Предпросмотр карточки дела" title="Открыть карточку дела для печати">${printPreviewIcon()}</button>`;
}

function openGeneralCasePrintPreview(id) {
  const caseId = Number(id || 0);
  if (!caseId) {
    showNotification?.('Не удалось открыть карточку: ID дела не найден', 'error');
    return;
  }

  const url = new URL('/case-preview.html', window.location.origin);
  url.searchParams.set('id', String(caseId));

  const win = window.open(url.toString(), '_blank');
  if (!win) {
    showNotification?.('Браузер заблокировал открытие окна предпросмотра', 'error');
  }
}

function printPreviewIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 8V4h10v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 14h10v6H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M17 12h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function renderRelatedOpenButton(row, variant = 'card') {
  const destinations = getGeneralRelatedDestinations(row);
  if (!destinations.length || state.archived) return '';
  if (variant === 'table') {
    return `<button class="btn small general-related-open-table" data-general-related-open="${row.id}" type="button">Подробнее</button>`;
  }
  return `<button class="general-related-open-card general-card-dots-button" data-general-related-open="${row.id}" type="button" title="Подробнее" aria-label="Подробнее"><span aria-hidden="true">•••</span></button>`;
}

function getGeneralRelatedDestinations(row) {
  const destinations = [];
  const add = (key, label, view) => {
    if (!destinations.some(item => item.key === key)) destinations.push({ key, label, view });
  };

  if (Number(row.control_flag) === 1) add('control', 'Перечне контрольных дел', 'controlledCases');
  if (Number(row.attendance_flag) === 1) {
    add('calendar', 'Календаре', 'calendar');
    add('schedule', 'Графике судебных заседаний', 'schedule');
  }
  if (Number(row.emergency_fund_flag) === 1) add('emergency', 'Аварийном фонде', 'emergencyFund');
  if (Number(row.registry_flag) === 1) add('registry', 'Реестре', 'municipalRegistry');

  return destinations;
}

function openGeneralRelatedDestinations(id) {
  const row = state.rows.find(item => Number(item.id) === Number(id));
  if (!row) return;
  const destinations = getGeneralRelatedDestinations(row);
  if (!destinations.length) return;

  if (destinations.length === 1) {
    openGeneralRelatedDestination(row, destinations[0]);
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'general-related-dialog';
  dialog.innerHTML = `
    <div class="general-related-dialog-card">
      <div class="general-related-dialog-head">
        <div><h3>Открыть в:</h3><p>${formatText(row.case_no || row.court_no || row.plaintiff || 'Выберите раздел')}</p></div>
        <button class="icon-button" data-related-close type="button">×</button>
      </div>
      <div class="general-related-options">
        ${destinations.map(item => `<button class="btn" data-related-destination="${item.key}" type="button">${escapeHtml(item.label)}</button>`).join('')}
      </div>
    </div>
  `;

  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-related-close]')) {
      dialog.close();
      dialog.remove();
      return;
    }
    const button = event.target.closest('[data-related-destination]');
    if (!button) return;
    const destination = destinations.find(item => item.key === button.dataset.relatedDestination);
    dialog.close();
    dialog.remove();
    if (destination) openGeneralRelatedDestination(row, destination);
  });

  document.body.append(dialog);
  dialog.showModal();
}

function openGeneralRelatedDestination(row, destination) {
  if (!destination?.view) return;
  const navButton = document.querySelector(`[data-view="${destination.view}"]`);
  const viewNode = document.getElementById(destination.view);
  if (!navButton && !viewNode) {
    showNotification?.('Связанный раздел недоступен в текущем интерфейсе.', 'error');
    return;
  }
  if (typeof window.openView === 'function') window.openView(destination.view);
  else navButton?.click();

  if (destination.key === 'emergency') {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('emergency:open-general-case', { detail: { generalCaseId: row.id } }));
    }, 180);
  }

  if (destination.key === 'calendar') {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('calendar:open-general-case', { detail: { generalCaseId: row.id } }));
    }, 220);
  }

  if (destination.key === 'schedule') {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('schedule:open-general-case', { detail: { generalCaseId: row.id } }));
    }, 220);
  }

  if (destination.key === 'registry') {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('registry:open-general-case', { detail: { generalCaseId: row.id } }));
    }, 220);
  }
}

function renderLineField(label, value, mode = '') {
  return `
    <div class="general-case-line-field ${mode ? `is-${mode}` : ''}">
      <span>${label}</span>
      <strong>${formatText(value)}</strong>
    </div>
  `;
}

function renderCompactField(label, value) {
  return `
    <div class="general-case-compact-field">
      <span>${label}</span>
      <strong>${formatText(value)}</strong>
    </div>
  `;
}

function getCaseStatusClass(row) {
  const control = Number(row.control_flag) === 1;
  const attendance = Number(row.attendance_flag) === 1;
  const review = Number(row.review_show_flag) === 1;
  const emergency = Number(row.emergency_fund_flag) === 1;
  const registry = Number(row.registry_flag) === 1;

  if (control && attendance) return 'status-both';
  if (attendance) return 'status-attendance';
  if (control) return 'status-control';
  if (emergency) return 'status-emergency';
  if (registry) return 'status-registry';
  if (review) return 'status-review';
  return 'status-default';
}

function getCaseThemeClass(id) {
  const index = Math.abs(Number(id || 0)) % 5;
  return `theme-${index + 1}`;
}

function folderIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H10l2 2h6.5A2.5 2.5 0 0 1 21 10.5v7A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"></path></svg>`;
}

function pencilIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 9.3-9.3a1.9 1.9 0 0 0 0-2.7l-.8-.8a1.9 1.9 0 0 0-2.7 0L5 15.5 4 20z"></path><path d="M13.5 6.5l4 4"></path></svg>`;
}

function calendarIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M8 3v4M16 3v4M3 10h18"></path></svg>`;
}

function chevronDownIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>`;
}

function chevronUpIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"></path></svg>`;
}

function toggleCaseCard(id) {
  if (state.expandedCaseIds.has(id)) {
    state.expandedCaseIds.delete(id);
  } else {
    state.expandedCaseIds.add(id);
  }

  renderCards();
}

function renderChip(label, value) {
  return `
    <span class="general-case-chip">
      <em>${label}</em>
      <b>${formatText(value)}</b>
    </span>
  `;
}

function renderModernDetail(label, value) {
  return `
    <div class="general-case-modern-detail">
      <span>${label}</span>
      <p>${formatText(value)}</p>
    </div>
  `;
}

function getAppealValue(row) {
  return row.appeal || row.appeal_info || row.appeal_result || row.obzhalovanie || '';
}

function renderField(label, value) {
  return `
    <div class="general-case-field">
      <span class="general-case-label">${label}</span>
      <div class="general-case-value">${formatText(value)}</div>
    </div>
  `;
}

function updateCount() {
  const node = document.querySelector('[data-general-count]');
  if (node) {
    node.textContent = `${state.filteredRows.length} ${declineCases(state.filteredRows.length)}`;
  }
}

function declineCases(n) {
  const last = Math.abs(n) % 10;
  const lastTwo = Math.abs(n) % 100;

  if (last === 1 && lastTwo !== 11) return 'дело';
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo)) return 'дела';

  return 'дел';
}


function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function __old_setAppealBlockVisible(visible) {
  const block = document.querySelector('[data-general-appeal-block]');
  if (block) block.hidden = !visible;
}

function __old_handleMotivatedDecisionDateChange_1(input) {
  const value = String(input?.value || '').trim();
  if (!value || !isValidRuDate(value)) {
    renderAppealSuggestions();
    return;
  }

  const block = document.querySelector('[data-general-appeal-block]');
  const alreadyVisible = block && !block.hidden;

  if (!alreadyVisible) {
    const yes = confirm('Судебный акт подлежит обжалованию?');
    if (!yes) {
      setAppealBlockVisible(false);
      const container = document.querySelector('[data-general-appeal-rows]');
      if (container) container.innerHTML = '';
      renderAppealSuggestions();
      return;
    }

    setAppealBlockVisible(true);
    renderAppealRows([{ title: 'Обжалование судебного акта', date: value }]);
    syncAppealWizardVisibility();
    renderAppealResult(true);
    return;
  }

  setAppealBlockVisible(true);
  syncAppealWizardVisibility();
  renderAppealResult();
  renderAppealSuggestions();
}

function getGeneralFormDataSafe() {
  const form = document.querySelector('[data-general-form]');
  return form ? collectGeneralCaseFormData(form) : {};
}

function syncAppealWizardVisibility() {
  const form = document.querySelector('[data-general-form]');
  if (!form) return;

  const actType = String(form.elements.first_instance_act_type?.value || '').trim();
  const processKind = String(form.elements.process_kind?.value || 'ГПК');
  const appealKind = String(form.elements.appeal_kind?.value || 'Апелляция');

  const orderField = document.querySelector('[data-general-order-copy-field]');
  const apkCassationField = document.querySelector('[data-general-apk-cassation-field]');
  const supervisionField = document.querySelector('[data-general-supervision-field]');

  if (orderField) orderField.hidden = actType !== 'Судебный приказ';
  if (apkCassationField) apkCassationField.hidden = !(processKind === 'АПК' && appealKind === 'Кассация');
  if (supervisionField) supervisionField.hidden = appealKind !== 'Надзор';
}

function renderAppealResult(forcePrompt = false) {
  const node = document.querySelector('[data-general-appeal-result]');
  const form = document.querySelector('[data-general-form]');
  if (!node || !form) return;

  const data = collectGeneralCaseFormData(form);
  const result = calculateAppealDeadlineFromForm(data);

  if (!result) {
    node.hidden = true;
    node.innerHTML = '';
    return;
  }

  node.hidden = false;
  const expired = isDeadlineExpired(result.dateIso);
  node.innerHTML = `
    <div class="general-appeal-result-main">
      <b>Последний день подачи ${escapeHtml((data.appeal_kind || 'жалобы').toLowerCase())} — ${escapeHtml(result.dateRu)}.</b>
      <p>Срок исчисляется в календарных днях. При окончании срока в нерабочий день днём окончания считается ближайший следующий рабочий день (ст. 107 ГПК, ст. 113 АПК, ст. 92 КАС).</p>
      ${result.note ? `<p class="warning">${escapeHtml(result.note)}</p>` : ''}
    </div>
    <div class="general-appeal-result-actions">
      <button class="btn small" type="button" disabled>📎 Сформировать напоминание</button>
      <button class="btn small" type="button" disabled>🖨️ Распечатать результат</button>
      ${expired ? '<button class="btn small danger" type="button" disabled>⚠️ Срок пропущен — заявление о восстановлении</button>' : ''}
    </div>
  `;

  const key = `${result.dateRu}|${data.appeal_kind}|${data.process_kind}|${data.first_instance_act_type}`;
  if (forcePrompt && node.dataset.lastPrompt !== key) {
    node.dataset.lastPrompt = key;
    alert(`Последний срок подачи жалобы — ${result.dateRu}.\n\nЭтот срок будет указан в плане и календаре после сохранения дела.`);
  }
}

function maybeShowAppealDeadlineQuestion(rowNode, force = false) {
  if (!rowNode) return;

  const title = rowNode.querySelector('[data-general-appeal-title]')?.value?.trim() || 'Получение решения суда 1 инстанции';
  const date = rowNode.querySelector('[data-general-appeal-date]')?.value?.trim() || '';
  if (!date || !isValidRuDate(date)) {
    renderAppealSuggestions();
    return;
  }

  const form = document.querySelector('[data-general-form]');
  const data = form ? collectGeneralCaseFormData(form) : {};
  const deadline = calculateAppealDeadline({ title, date, row: data });
  if (!deadline) {
    renderAppealSuggestions();
    return;
  }

  const key = `${title}|${date}|${deadline.dateRu}`;
  if (!force && rowNode.dataset.deadlinePrompted === key) {
    renderAppealSuggestions();
    return;
  }

  rowNode.dataset.deadlinePrompted = key;
  alert(`Последний срок подачи жалобы — ${deadline.dateRu}.\n\nЭтот срок будет указан в плане и календаре после сохранения дела.`);
  renderAppealSuggestions();
}

function parseAppeals(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function __old_collectAppealRows() {
  return Array.from(document.querySelectorAll('[data-general-appeal-row]'))
    .map(row => ({
      title: row.querySelector('[data-general-appeal-title]')?.value?.trim() || '',
      date: row.querySelector('[data-general-appeal-date]')?.value?.trim() || ''
    }))
    .filter(row => row.title || row.date);
}

function __old_renderAppealRows(rows = []) {
  const container = document.querySelector('[data-general-appeal-rows]');
  if (!container) return;

  const list = Array.isArray(rows) && rows.length
    ? rows
    : [{ title: '', date: '' }];

  container.innerHTML = list.map(row => renderAppealRow(row)).join('');

  try {
    renderAppealSuggestions();
  } catch (error) {
    console.warn('Не удалось рассчитать подсказки обжалования', error);
  }
}

function __old_renderAppealRow(row = {}) {
  return `
    <div class="general-appeal-row" data-general-appeal-row>
      <div class="general-appeal-index" aria-hidden="true">•</div>
      <input data-general-appeal-title value="${escapeAttr(row.title || '')}" placeholder="Обжалование судебного акта / перенос заседания / получение определения">
      <label>
        <span>Дата</span>
        <input data-general-appeal-date value="${escapeAttr(row.date || '')}" placeholder="ДД.ММ.ГГГГ">
      </label>
      <button class="btn small" data-general-appeal-remove type="button" title="Удалить событие">🗑</button>
    </div>
  `;
}

function __old_addAppealRow(row = {}) {
  setAppealBlockVisible(true);
  const container = document.querySelector('[data-general-appeal-rows]');
  if (!container) return;

  container.insertAdjacentHTML('beforeend', renderAppealRow(row));
  renderAppealSuggestions();
}

function __old_removeAppealRow(button) {
  const rows = Array.from(document.querySelectorAll('[data-general-appeal-row]'));
  const row = button.closest('[data-general-appeal-row]');
  if (!row) return;

  if (rows.length <= 1) {
    row.querySelectorAll('input').forEach(input => input.value = '');
  } else {
    row.remove();
  }

  renderAppealSuggestions();
}

function __old_renderAppealSuggestions() {
  const node = document.querySelector('[data-general-appeal-suggestions]');
  const form = document.querySelector('[data-general-form]');
  if (!node || !form) return;

  try {
    const data = collectGeneralCaseFormData(form);
    const tasks = buildGeneralCaseAutoTasks({ ...data, id: data.id || 'preview' }, data, { preview: true });

    if (!tasks.length) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }

    node.hidden = false;
    node.innerHTML = `
      <h5>Автоматически будут добавлены в план и календарь:</h5>
      ${tasks.map(task => `
        <div class="general-appeal-suggestion">
          <b>${formatText(task.dateRu)}</b>
          <span>${formatText(task.desc.replace('[Авто общего перечня] ', ''))}</span>
        </div>
      `).join('')}
    `;
  } catch (error) {
    console.warn('Ошибка расчета подсказок обжалования', error);
    node.hidden = true;
    node.innerHTML = '';
  }
}

function __old_getAppealSummary(row) {
  const rows = parseAppeals(row.appeals_json);
  const calculated = [];
  if (row.motivated_decision_date) {
    const deadline = calculateAppealDeadlineFromForm(row);
    if (deadline) calculated.push(`${row.first_instance_act_type || 'Судебный акт'}: мотивировка ${row.motivated_decision_date} → срок до ${deadline.dateRu}`);
  }

  for (const item of rows) {
    const deadline = calculateAppealDeadline({ title: item.title, date: item.date, row });
    if (deadline) calculated.push(`${item.title || 'Обжалование'}: ${item.date} → срок до ${deadline.dateRu}`);
  }

  return calculated.length ? calculated.join('\n') : getAppealValue(row);
}

function __old_confirmAppealDeadlinesBeforeSave(data) {
  const rows = [];

  if (data.motivated_decision_date && isValidRuDate(data.motivated_decision_date)) {
    const mainDeadline = calculateAppealDeadlineFromForm(data);
    if (mainDeadline) rows.push({ title: data.appeal_kind || 'Обжалование', date: data.motivated_decision_date, deadline: mainDeadline });
  }

  for (const item of parseAppeals(data.appeals_json)) {
    if (item.date && isValidRuDate(item.date)) rows.push(item);
  }

  if (!rows.length) return;

  const lines = rows
    .map(item => {
      const deadline = item.deadline || calculateAppealDeadline({ title: item.title, date: item.date, row: data });
      return deadline ? `${item.title || 'Обжалование'}: последний срок подачи жалобы — ${deadline.dateRu}` : '';
    })
    .filter(Boolean);

  if (lines.length) {
    alert(`${lines.join('\n')}\n\nСроки будут добавлены в план и календарь после сохранения дела.`);
  }
}

async function __old_syncGeneralCaseAutoTasks(savedCase, data, previousRow = null) {
  const oldEvents = getHearingEventDates(previousRow);
  const newEvents = getHearingEventDates(data);
  const hearingDateChanged = oldEvents.length && newEvents.length && oldEvents.join('|') !== newEvents.join('|');

  let allTasks = [];
  try {
    allTasks = await dbApi.getCalendarTasks({});
  } catch (error) {
    console.warn('Не удалось получить задачи календаря', error);
  }

  const existingAutoTasks = allTasks.filter(task =>
    Number(task.general_case_id) === Number(savedCase.id) &&
    String(task.description || task.desc || '').startsWith('[Авто общего перечня]')
  );

  if (hearingDateChanged && existingAutoTasks.length) {
    const oldText = oldEvents.map(displayIsoAsRu).join(', ');
    const newText = newEvents.map(displayIsoAsRu).join(', ');
    const ok = confirm(`⚠️ Дата предварительного заседания изменена с ${oldText} на ${newText}.\nОбнаружены зависимые задачи.\n\nПересчитать сроки их исполнения автоматически?`);
    if (!ok) return;
  }

  for (const task of existingAutoTasks) {
    try {
      await dbApi.deleteCalendarTask(task.id);
    } catch (error) {
      console.warn('Не удалось удалить старую автозадачу', error);
    }
  }

  const tasks = buildGeneralCaseAutoTasks(savedCase, data);
  for (const task of tasks) {
    try {
      await dbApi.createCalendarTask({
        date: task.dateIso,
        user: task.user,
        type: task.type,
        desc: task.desc,
        time: '',
        court: data.court || '',
        subject: data.claim_subject || '',
        assignment: task.assignment,
        general_case_id: savedCase.id
      });
    } catch (error) {
      console.warn('Не удалось создать автозадачу', error);
    }
  }

  if (tasks.length) {
    showNotification(`Автоматически добавлено задач в план/календарь: ${tasks.length}`);
  }
}

function __old_buildGeneralCaseAutoTasks(savedCase, data, { preview = false } = {}) {
  const row = { ...savedCase, ...data };
  const tasks = [];
  const user = data.executor || getCurrentUserName() || 'Администратор';
  const caseNo = data.case_no || savedCase.case_no || '';
  const baseAssignment = `Дело № ${caseNo}\nИстец: ${data.plaintiff || ''}\nОтветчик: ${data.defendant || ''}\nПредмет: ${data.claim_subject || ''}${data.claim_address ? '\nАдрес: ' + data.claim_address : ''}`.trim();

  if (data.motivated_decision_date) {
    const deadline = calculateAppealDeadlineFromForm(data);

    if (deadline) {
      tasks.push({
        dateIso: deadline.dateIso,
        dateRu: deadline.dateRu,
        user,
        type: 'поручение',
        desc: `[Авто общего перечня] Последний день подачи ${String(data.appeal_kind || 'жалобы').toLowerCase()} по делу № ${caseNo}`,
        assignment: `${baseAssignment}\nОснование: ${data.first_instance_act_type || 'судебный акт'} от ${data.judicial_act_date_first || data.motivated_decision_date}\nМотивировка изготовлена: ${data.motivated_decision_date}\nРасчёт: ${deadline.rule}`
      });
    }
  }

  for (const item of parseAppeals(data.appeals_json)) {
    if (!item.date) continue;

    if (isHearingEvent(item.title)) {
      const prepDate = subtractCalendarDaysWithWeekendShift(ruDateToDate(item.date), 5);
      if (prepDate) {
        tasks.push({
          dateIso: dateToIso(prepDate),
          dateRu: dateToRu(prepDate),
          user,
          type: 'поручение',
          desc: `[Авто общего перечня] Подготовить отзыв на иск по делу № ${caseNo}`,
          assignment: `${baseAssignment}\nЗаседание: ${item.date}\nВнутренняя инструкция: за 5 календарных дней до заседания; если срок выпал на выходной — перенос на ближайший рабочий день`
        });
      }
      continue;
    }

    const deadline = calculateAppealDeadline({
      title: item.title,
      date: item.date,
      row
    });

    if (deadline) {
      tasks.push({
        dateIso: deadline.dateIso,
        dateRu: deadline.dateRu,
        user,
        type: 'поручение',
        desc: `[Авто общего перечня] Контроль срока обжалования по делу № ${caseNo}`,
        assignment: `${baseAssignment}\nСобытие: ${item.title || 'обжалование'} от ${item.date}\nРасчёт: ${deadline.rule}`
      });
    }
  }

  return preview ? tasks.slice(0, 6) : tasks;
}


function __old_calculateAppealDeadlineFromForm(data = {}) {
  const actType = String(data.first_instance_act_type || '').trim() || 'Решение';
  const processKind = String(data.process_kind || detectProcessKind(`${data.category || ''} ${data.court || ''}`) || 'ГПК');
  const appealKind = String(data.appeal_kind || 'Апелляция');
  const proceedingForm = String(data.proceeding_form || 'Общий порядок');
  const actInstance = String(data.act_instance || 'Первая инстанция');
  const baseDate = actType === 'Судебный приказ' && data.order_copy_date
    ? data.order_copy_date
    : data.motivated_decision_date;

  const start = ruDateToDate(baseDate);
  if (!start) return null;

  if (processKind === 'АПК' && appealKind === 'Кассация' && data.apk_cassation_has_appeal === 'Нет') {
    return {
      dateIso: '',
      dateRu: 'жалоба не принимается',
      rule: 'АПК: для кассации в арбитражный суд округа требуется предшествующее апелляционное обжалование',
      note: 'Жалоба не принимается: не было апелляционного обжалования.'
    };
  }

  if (appealKind === 'Надзор' && data.supervision_cassation_exhausted === 'Нет') {
    return {
      dateIso: '',
      dateRu: 'жалоба не принимается',
      rule: 'Надзор: сначала должны быть исчерпаны кассационные способы обжалования',
      note: 'Жалоба не принимается: не исчерпаны кассационные способы.'
    };
  }

  let deadline;
  let rule;

  if (actType === 'Судебный приказ') {
    const days = processKind === 'КАС' ? 20 : 10;
    deadline = addDays(start, days);
    rule = `отмена судебного приказа: ${days} календарных дней (${processKind})`;
  } else if (appealKind === 'Надзор') {
    deadline = addMonths(start, 3);
    rule = `надзор в ВС РФ: 3 календарных месяца (${processKind})`;
  } else if (appealKind === 'Кассация') {
    const months = processKind === 'АПК' ? 2 : (processKind === 'КАС' ? 6 : 3);
    deadline = addMonths(start, months);
    rule = `кассация: ${months} календарн. мес. (${processKind})`;
  } else if (proceedingForm === 'Упрощённое производство') {
    deadline = addDays(start, 15);
    rule = `апелляция на упрощённое производство: 15 календарных дней (${processKind})`;
  } else if (actType === 'Определение') {
    if (processKind === 'АПК') {
      deadline = addMonths(start, 1);
      rule = 'частная жалоба на определение: 1 календарный месяц (АПК)';
    } else {
      deadline = addDays(start, 15);
      rule = `частная жалоба на определение: 15 календарных дней (${processKind})`;
    }
  } else {
    deadline = addMonths(start, 1);
    rule = `апелляция на акт первой инстанции: 1 календарный месяц (${processKind})`;
  }

  const adjusted = moveToNextWorkingDay(deadline);
  const moved = adjusted.getTime() !== deadline.getTime();
  const note = data.late_motivated_received === 'Да'
    ? 'Акт получен с нарушением срока изготовления мотивировки: можно подготовить заявление о восстановлении срока.'
    : '';

  return {
    dateIso: dateToIso(adjusted),
    dateRu: dateToRu(adjusted),
    rule: `${rule}; срок течёт со следующего календарного дня, последний день переносится только если выпал на выходной/праздник${moved ? '; перенесено на ближайший рабочий день' : ''}`,
    note
  };
}

function isDeadlineExpired(iso) {
  if (!iso) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const deadline = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return today.getTime() > deadline.getTime();
}

function calculateAppealDeadline({ title = '', date = '', row = {} } = {}) {
  const start = ruDateToDate(date);
  if (!start) return null;

  const kind = detectProcessKind(`${title} ${row.category || ''} ${row.court || ''}`);
  const text = normalizeText(title);
  let deadline;
  let rule;

  // Специальное поле карточки: "Дата судебного акта первой инстанции".
  // Для него считаем основной срок апелляционного обжалования решения первой инстанции:
  // 1 календарный месяц, с переносом только последнего дня, если он выпал на выходной.
  const isFirstInstanceActField =
    text.includes('дата судебного акта') ||
    text.includes('судебный акт 1 инстанции') ||
    text.includes('судебного акта первой инстанции') ||
    text.includes('решение суда 1 инстанции') ||
    text.includes('решение первой инстанции');

  if (isFirstInstanceActField && !text.includes('приказ') && !text.includes('определ') && !text.includes('частн') && !text.includes('кассац')) {
    deadline = addMonths(start, 1);
    rule = `решение суда первой инстанции: 1 календарный месяц (${kind}); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник`;
  } else if (text.includes('судебн') && text.includes('приказ')) {
    const days = kind === 'КАС' ? 20 : 10;
    deadline = addDays(start, days);
    rule = `судебный приказ: ${days} календарных дней (${kind}); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник`;
  } else if (text.includes('кассац')) {
    const months = kind === 'АПК' ? 2 : (kind === 'КАС' ? 6 : 3);
    deadline = addMonths(start, months);
    rule = `кассация: ${months} календарн. мес. (${kind}); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник`;
  } else if (text.includes('определ') || text.includes('частн')) {
    if (kind === 'АПК') {
      deadline = addMonths(start, 1);
      rule = 'определение/частная жалоба: 1 календарный месяц (АПК); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник';
    } else {
      deadline = addDays(start, 15);
      rule = `определение/частная жалоба: 15 календарных дней (${kind}); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник`;
    }
  } else if (text.includes('упрощ')) {
    deadline = addDays(start, 15);
    rule = `упрощённое производство: 15 календарных дней (${kind}); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник`;
  } else {
    deadline = addMonths(start, 1);
    rule = `решение суда первой инстанции: 1 календарный месяц (${kind}); срок течёт со следующего дня, последний день переносится только если выпал на выходной/праздник`;
  }

  const adjusted = moveToNextWorkingDay(deadline);
  const moved = adjusted.getTime() !== deadline.getTime();
  return {
    dateIso: dateToIso(adjusted),
    dateRu: dateToRu(adjusted),
    rule: `${rule}${moved ? '; перенесено на ближайший рабочий день' : ''}`
  };
}

function detectProcessKind(text = '') {
  const value = normalizeText(text);
  if (value.includes('апк') || value.includes('арбитраж')) return 'АПК';
  if (value.includes('кас') || value.includes('административ')) return 'КАС';
  return 'ГПК';
}

function isHearingEvent(text = '') {
  const value = normalizeText(text);
  return value.includes('заседан') || value.includes('слушан');
}

function getHearingEventDates(source = {}) {
  return parseAppeals(source?.appeals_json)
    .filter(item => isHearingEvent(item.title))
    .map(item => normalizeDateKey(item.date))
    .filter(Boolean);
}

function ruDateToDate(value) {
  const match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeDateKey(value) {
  const date = ruDateToDate(value);
  return date ? dateToIso(date) : '';
}

function dateToIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToRu(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function displayIsoAsRu(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + Number(months || 0));
  if (result.getDate() < day) result.setDate(0);
  return result;
}

function subtractCalendarDaysWithWeekendShift(date, days) {
  if (!date) return null;
  const result = new Date(date);
  result.setDate(result.getDate() - Number(days || 0));
  return moveToNextWorkingDay(result);
}

function moveToNextWorkingDay(date) {
  const result = new Date(date);
  while (!isWorkingDay(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

function isWorkingDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function openDialog(row = null) {
  openGeneralCaseDialogSafe(row, { force: true });
}

function openGeneralCaseDialogSafe(row = null, options = {}) {
  const key = row?.id ? `edit:${row.id}` : 'new';
  const now = Date.now();

  if (!options.force && key === lastGeneralDialogOpenKey && now - lastGeneralDialogOpenAt < 350) {
    return;
  }

  lastGeneralDialogOpenKey = key;
  lastGeneralDialogOpenAt = now;
  state.returnView = options.returnView || options.sourceView || '';

  try {
    openDialogCore(row);
  } catch (error) {
    console.error('Не удалось открыть карточку стандартным способом:', error);
    openDialogDomFallback(row, error);
  }

  const dialog = document.querySelector('[data-general-dialog]');
  if (dialog && !dialog.open && !dialog.classList.contains('is-open')) {
    openDialogDomFallback(row);
  }

  syncGeneralBackButton();
}

function openDialogCore(row = null) {
  const dialog = document.querySelector('[data-general-dialog]');
  const form = document.querySelector('[data-general-form]');
  if (!dialog || !form) return;

  form.reset();
  form.elements.id.value = row?.id || '';

  const title = document.querySelector('[data-general-dialog-title]');
  if (title) {
    title.textContent = row
      ? (state.archived ? 'Архивное дело' : 'Карточка дела')
      : 'Новое дело';
  }

  const createdNode = document.querySelector('[data-general-dialog-created]');
  if (createdNode) {
    const created = row?.registration_date || getTodayRu();
    createdNode.textContent = `Создано ${created}`;
  }

  const deleteButton = document.querySelector('[data-general-delete]');
  const restoreButton = document.querySelector('[data-general-restore]');
  const saveButton = form.querySelector('button[type="submit"]');

  if (deleteButton) deleteButton.hidden = !row || state.archived;
  if (restoreButton) restoreButton.hidden = !row || !state.archived;
  if (saveButton) saveButton.hidden = state.archived;

  const fields = [
    'case_no',
    'court_no',
    'court',
    'executor',
    'plaintiff',
    'defendant',
    'category',
    'procedural_position',
    'claim_subject',
    'claim_address',
    'registration_date',
    'review_result',
    'comments',
    'review_show_flag',
    'judicial_act_date_first',
    'motivated_decision_date',
    'appeal_act_date',
    'cassation_act_date',
    'documents_json',
    'first_instance_act_type',
    'process_kind',
    'act_instance',
    'proceeding_form',
    'appeal_kind',
    'order_copy_date',
    'apk_cassation_has_appeal',
    'supervision_cassation_exhausted',
    'late_motivated_received',
    'appeals_json'
  ];

  fields.forEach(field => {
    if (form.elements[field]) {
      form.elements[field].value = row?.[field] || '';
    }
  });
  if (form.elements.claim_subject) {
    form.elements.claim_subject.value = formatClaimSubjectWithAddress(row?.claim_subject, row?.claim_address);
  }
  ensureReviewResultOption(form.elements.review_result, row?.review_result || '');

  const appealRows = parseAppeals(row?.appeals_json);
  renderAppealRows(appealRows);
  setAppealBlockVisible(Boolean(appealRows.length || row?.judicial_act_date_first));
  state.reviewApprovals = [];
  renderDocumentsRows(parseDocuments(row?.documents_json));
  refreshReviewApprovals(row?.id);
  if (row) markCommentViewed(row);
  ensureGeneralCaseTabs();
  switchGeneralCaseTab('info');

  if (!row && form.elements.registration_date && !form.elements.registration_date.value) {
    form.elements.registration_date.value = getTodayRu();
  }

  if (form.elements.review_show_flag) form.elements.review_show_flag.checked = Number(row?.review_show_flag || 0) === 1;
  if (form.elements.emergency_fund_flag) form.elements.emergency_fund_flag.checked = Number(row?.emergency_fund_flag || 0) === 1;
  if (form.elements.registry_flag) form.elements.registry_flag.checked = Number(row?.registry_flag || 0) === 1;
  form.elements.control_flag.checked = Number(row?.control_flag || 0) === 1;
  form.elements.attendance_flag.checked = Number(row?.attendance_flag || 0) === 1;

  setDialogReadonly(state.archived);

  openGeneralDialogSafely(dialog);
}


function openDialogDomFallback(row = null, cause = null) {
  const dialog = document.querySelector('[data-general-dialog]');
  const form = document.querySelector('[data-general-form]');

  if (!dialog || !form) {
    alert('Не найдено модальное окно общего перечня дел. Обновите страницу и повторите попытку.');
    return;
  }

  try { form.reset(); } catch {}

  setGeneralFormValue(form, 'id', row?.id || '');

  const title = document.querySelector('[data-general-dialog-title]');
  if (title) title.textContent = row ? (state.archived ? 'Архивное дело' : 'Карточка дела') : 'Новое дело';

  const createdNode = document.querySelector('[data-general-dialog-created]');
  if (createdNode) createdNode.textContent = `Создано ${row?.registration_date || getTodayRu()}`;

  const fields = [
    'case_no', 'court_no', 'court', 'plaintiff', 'defendant', 'category',
    'procedural_position', 'claim_subject', 'claim_address', 'registration_date', 'review_result',
    'comments', 'review_show_flag', 'emergency_fund_flag',
  'registry_flag', 'judicial_act_date_first', 'motivated_decision_date', 'appeal_act_date',
    'cassation_act_date', 'documents_json', 'first_instance_act_type', 'process_kind',
    'act_instance', 'proceeding_form', 'appeal_kind', 'order_copy_date',
    'apk_cassation_has_appeal', 'supervision_cassation_exhausted',
    'late_motivated_received', 'appeals_json'
  ];

  fields.forEach(field => setGeneralFormValue(form, field, row?.[field] || ''));
  if (form.elements.claim_subject) {
    form.elements.claim_subject.value = formatClaimSubjectWithAddress(row?.claim_subject, row?.claim_address);
  }
  ensureReviewResultOption(form.elements.review_result, row?.review_result || '');

  const reviewShow = form.elements.review_show_flag;
  if (reviewShow) reviewShow.checked = Number(row?.review_show_flag || 0) === 1;

  const emergencyFund = form.elements.emergency_fund_flag;
  if (emergencyFund) emergencyFund.checked = Number(row?.emergency_fund_flag || 0) === 1;

  const control = form.elements.control_flag;
  if (control) control.checked = Number(row?.control_flag || 0) === 1;

  const attendance = form.elements.attendance_flag;
  if (attendance) attendance.checked = Number(row?.attendance_flag || 0) === 1;

  try { renderAppealRows(parseAppeals(row?.appeals_json)); } catch (error) { console.warn('Не удалось отрисовать блок обжалования:', error); }
  try { setAppealBlockVisible(Boolean(parseAppeals(row?.appeals_json).length || row?.judicial_act_date_first)); } catch {}
  state.reviewApprovals = [];
  try { renderDocumentsRows(parseDocuments(row?.documents_json)); refreshReviewApprovals(row?.id); } catch (error) { console.warn('Не удалось отрисовать документы:', error); }
  try { if (row) markCommentViewed(row); } catch {}
  try { ensureGeneralCaseTabs(); } catch {}
  try { switchGeneralCaseTab('info'); } catch {}
  try { setDialogReadonly(Boolean(state.archived)); } catch {}

  const deleteButton = document.querySelector('[data-general-delete]');
  const restoreButton = document.querySelector('[data-general-restore]');
  const saveButton = form.querySelector('button[type="submit"]');
  if (deleteButton) deleteButton.hidden = !row || state.archived;
  if (restoreButton) restoreButton.hidden = !row || !state.archived;
  if (saveButton) saveButton.hidden = Boolean(state.archived);

  if (!row && form.elements.registration_date && !form.elements.registration_date.value) {
    form.elements.registration_date.value = getTodayRu();
  }

  openGeneralDialogSafely(dialog);

  if (cause) {
    showNotification('Карточка открыта резервным способом. Проверьте поля перед сохранением.', 'info');
  }
}

function setGeneralFormValue(form, name, value) {
  const field = form?.elements?.[name];
  if (!field) return;
  try { field.value = value ?? ''; } catch {}
}

function ensureReviewResultOption(select, value) {
  if (!select || select.tagName !== 'SELECT') return;

  const text = String(value || '').trim();
  select.querySelectorAll('[data-custom-review-result]').forEach(option => option.remove());

  if (!text) {
    select.value = '';
    return;
  }

  if (!GENERAL_REVIEW_RESULT_OPTIONS.includes(text) && !Array.from(select.options).some(option => option.value === text)) {
    const option = document.createElement('option');
    option.value = text;
    option.textContent = text;
    option.dataset.customReviewResult = '1';
    select.append(option);
  }

  select.value = text;
}

function ensureGeneralCaseTabs() {
  const form = document.querySelector('[data-general-form]');
  if (!form) return;

  let tabs = form.querySelector('.general-case-tabs');
  const tabsHtml = `
    <div class="general-case-tabs" role="tablist">
      <button class="general-case-tab is-active" data-general-case-tab="info" type="button">Информация по делу</button>
      <button class="general-case-tab" data-general-case-tab="appeal" type="button">Калькулятор сроков обжалования</button>
      <button class="general-case-tab" data-general-case-tab="plan" type="button">План и заметки по делу</button>
      <button class="general-case-tab" data-general-case-tab="documents" type="button">Документы</button>
    </div>`;

  if (!tabs) {
    const firstPanel = form.querySelector('[data-general-case-tab-panel]');
    if (firstPanel) {
      firstPanel.insertAdjacentHTML('beforebegin', tabsHtml);
      tabs = form.querySelector('.general-case-tabs');
    }
  }

  if (!tabs) return;

  const requiredTabs = [
    ['info', 'Информация по делу'],
    ['appeal', 'Калькулятор сроков обжалования'],
    ['plan', 'План и заметки по делу'],
    ['documents', 'Документы']
  ];

  requiredTabs.forEach(([key, title]) => {
    if (!tabs.querySelector(`[data-general-case-tab="${key}"]`)) {
      tabs.insertAdjacentHTML('beforeend', `<button class="general-case-tab" data-general-case-tab="${key}" type="button">${title}</button>`);
    }
  });

  tabs.hidden = false;
  tabs.style.display = 'flex';
}

function resetGeneralDialogViewport(dialog) {
  if (!dialog) return;

  dialog.classList.add('general-case-dialog-centered');
  document.body.classList.add('general-case-dialog-open');

  Object.assign(dialog.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    margin: '0',
    width: 'min(1120px, calc(100vw - 64px))',
    maxWidth: 'calc(100vw - 64px)',
    maxHeight: 'calc(100vh - 64px)',
    overflow: 'hidden',
    zIndex: '10000'
  });

  const form = dialog.querySelector('[data-general-form]');
  if (form) {
    form.style.maxHeight = 'calc(100vh - 64px)';
    form.style.overflowY = 'auto';
    form.style.overscrollBehavior = 'contain';
  }
}

function scrollGeneralDialogToTop(dialog) {
  const form = dialog?.querySelector('[data-general-form]');
  if (form) {
    form.scrollTop = 0;
    form.scrollLeft = 0;
  }

  if (dialog) {
    dialog.scrollTop = 0;
    dialog.scrollLeft = 0;
  }
}

function focusGeneralDialogWithoutScrolling(dialog) {
  const focusTarget = dialog?.querySelector('[data-general-case-tab="info"]') || dialog;
  if (!focusTarget) return;

  if (focusTarget === dialog && !dialog.hasAttribute('tabindex')) {
    dialog.setAttribute('tabindex', '-1');
  }

  try {
    focusTarget.focus({ preventScroll: true });
  } catch {
    try { focusTarget.focus(); } catch {}
  }
}

function openGeneralDialogSafely(dialog) {
  if (!dialog) return;

  ensureGeneralCaseTabs();
  resetGeneralDialogViewport(dialog);
  scrollGeneralDialogToTop(dialog);

  try {
    if (!dialog.open && typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    dialog.classList.add('is-open');
    resetGeneralDialogViewport(dialog);
    scrollGeneralDialogToTop(dialog);
    requestAnimationFrame(() => {
      ensureGeneralCaseTabs();
      resetGeneralDialogViewport(dialog);
      scrollGeneralDialogToTop(dialog);
      focusGeneralDialogWithoutScrolling(dialog);
    });
  } catch (error) {
    console.error('Не удалось открыть модальное окно дела:', error);
    dialog.setAttribute('open', '');
    dialog.classList.add('is-open');
    resetGeneralDialogViewport(dialog);
    scrollGeneralDialogToTop(dialog);
    requestAnimationFrame(() => {
      ensureGeneralCaseTabs();
      scrollGeneralDialogToTop(dialog);
      focusGeneralDialogWithoutScrolling(dialog);
    });
    showNotification('Карточка открыта без системного модального режима.', 'info');
  }
}

function setDialogReadonly(readonly) {
  const form = document.querySelector('[data-general-form]');
  if (!form) return;

  Array.from(form.elements).forEach(element => {
    if (element.name === 'id') return;
    if (element.matches?.('[data-general-close], [data-general-back], [data-general-case-tab], [data-general-restore], [data-general-document-open], [data-general-document-open-item]')) return;
    if (!element.name && element.type === 'button') return;
    element.disabled = readonly;
  });

  form.querySelectorAll('[data-general-appeal-add], [data-general-appeal-remove]').forEach(button => {
    button.disabled = readonly;
  });
}

function closeDialog() {
  const dialog = document.querySelector('[data-general-dialog]');
  const form = document.querySelector('[data-general-form]');

  if (form) {
    setDialogReadonly(false);

    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.hidden = false;
  }

  if (dialog) {
    try {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
    } catch {
      dialog.removeAttribute('open');
    }
    dialog.classList.remove('is-open');
    dialog.classList.remove('general-case-dialog-centered');
  }

  document.body.classList.remove('general-case-dialog-open');
  state.returnView = '';
  syncGeneralBackButton();
}

function syncGeneralBackButton() {
  const button = document.querySelector('[data-general-back]');
  if (button) button.hidden = !state.returnView;
}

function returnToSourceView() {
  const view = state.returnView;
  if (!view) return;

  closeDialog();
  if (typeof window.openView === 'function') {
    window.openView(view);
  } else {
    document.querySelector(`[data-view="${view}"]`)?.click();
  }
}


async function saveCase(form) {
  const data = collectGeneralCaseFormData(form);
  confirmAppealDeadlinesBeforeSave(data);
  const previousRow = data.id
    ? state.rows.find(row => Number(row.id) === Number(data.id))
    : null;

  if (!String(data.registration_date || '').trim()) {
    data.registration_date = getTodayRu();
  }

  try {
    const isNew = !data.id;
    const wantsControl = Number(data.control_flag) === 1;
    const wantsAttendance = Number(data.attendance_flag) === 1;
    const wantsEmergencyFund = Number(data.emergency_fund_flag) === 1;
    const wantsRegistry = Number(data.registry_flag) === 1;
    const wasAttendance = Number(previousRow?.attendance_flag || 0) === 1;
    const hearingWasMissing = Number(previousRow?.attendance_hearing_missing || 0) === 1;

    let attendanceData = null;
    let controlHistoryText = '';
    let attendanceQuestionAsked = false;

    // Спрашиваем дату/время не только при создании, но и при редактировании,
    // если раньше пользователь ответил «Нет» и запись помечена как явочная без заседания.
    const shouldAskAttendance = wantsAttendance && (isNew || !wasAttendance || hearingWasMissing);
    const shouldAskControl = isNew && wantsControl;

    if (shouldAskAttendance || shouldAskControl) {
      const title = wantsControl && wantsAttendance
        ? 'Контрольное / явочное дело'
        : (wantsAttendance ? 'Явочное дело' : 'Контрольное дело');

      const question = shouldAskAttendance
        ? 'Дата и время судебного заседания назначены?'
        : 'Дата и время заседания назначены?';
      const answer = await askFlagQuestion(title, question);

      if (answer === 'back') return;

      if (answer === 'yes') {
        if (shouldAskAttendance) {
          attendanceQuestionAsked = true;
          attendanceData = await askAttendanceDateTime();
          if (!attendanceData) return;
        }

        if (shouldAskControl) {
          const historyText = await askControlHistoryText();
          if (historyText === null) return;
          controlHistoryText = historyText;
        }
      } else if (answer === 'no') {
        if (shouldAskAttendance) {
          attendanceQuestionAsked = true;
          data.attendance_hearing_missing = 1;
        }
      }
    }

    if (!wantsAttendance) {
      data.attendance_hearing_missing = 0;
    } else if (attendanceData) {
      data.attendance_hearing_missing = 0;
    } else if (!attendanceQuestionAsked && hearingWasMissing) {
      data.attendance_hearing_missing = 1;
    }

    const savedCase = await persistGeneralCase(data);

    if (wantsAttendance && attendanceData) {
      await dbApi.addGeneralCaseAttendance(savedCase.id, {
        hearing_date: attendanceData.hearing_date,
        hearing_time: attendanceData.hearing_time,
        user: getCurrentUserName()
      });
    }

    if (wantsControl && isNew) {
      await dbApi.createControlledFromGeneral(savedCase.id, controlHistoryText || '');
    }

    if (wantsEmergencyFund) {
      await syncEmergencyFundFromGeneral(savedCase, data);
    }

    if (wantsRegistry) {
      await syncMunicipalRegistryFromGeneral(savedCase, data);
    }

    await syncGeneralCaseAutoTasks(savedCase, data, previousRow);

    await finishGeneralSave(data, attendanceData);
  } catch (error) {
    alert('Не удалось сохранить дело:\n' + error.message);
  }
}

function collectGeneralCaseFormData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const subjectAndAddress = splitClaimSubjectAndAddress(data.claim_subject);
  data.claim_subject = subjectAndAddress.subject;
  data.claim_address = subjectAndAddress.address;
  if (!DISPUTE_CATEGORY_OPTIONS.includes(data.category || '')) data.category = '';
  if (!PROCEDURAL_POSITION_OPTIONS.includes(data.procedural_position || '')) data.procedural_position = '';
  data.review_show_flag = form.elements.review_show_flag?.checked ? 1 : 0;
  data.emergency_fund_flag = form.elements.emergency_fund_flag?.checked ? 1 : 0;
  data.registry_flag = form.elements.registry_flag?.checked ? 1 : 0;
  data.attendance_hearing_missing = 0;
  data.control_flag = form.elements.control_flag.checked ? 1 : 0;
  data.attendance_flag = form.elements.attendance_flag.checked ? 1 : 0;
  data.appeals_json = JSON.stringify(collectAppealRows());
  data.documents_json = JSON.stringify(collectDocumentRows());
  data.skip_linked = true;
  return data;
}

async function persistGeneralCase(data) {
  if (data.id) {
    const updated = await dbApi.updateGeneralCase(data.id, data);
    showNotification('Дело обновлено');
    return updated;
  }

  const created = await dbApi.createGeneralCase(data);
  const form = document.querySelector('[data-general-form]');
  if (form?.elements.id) form.elements.id.value = created.id;
  showNotification('Дело добавлено');
  return created;
}


async function syncEmergencyFundFromGeneral(savedCase, data) {
  const generalCaseId = Number(savedCase?.id || data?.id || 0);
  if (!generalCaseId) return;

  const existingRows = await dbApi.getEmergencyFund().catch(() => []);
  const existing = Array.isArray(existingRows)
    ? existingRows.find(row => Number(row.general_case_id || 0) === generalCaseId)
    : null;

  const payload = {
    ...(existing || {}),
    general_case_id: generalCaseId,
    pk_number: savedCase.case_no || data.case_no || '',
    pk: savedCase.case_no || data.case_no || '',
    fio: savedCase.plaintiff || data.plaintiff || data.defendant || '',
    prosecutor: String(savedCase.procedural_position || data.procedural_position || '').toLowerCase().includes('прокурор') ? (savedCase.plaintiff || data.plaintiff || '') : '',
    requirements: savedCase.claim_subject || data.claim_subject || '',
    court: savedCase.court || data.court || '',
    case_number: savedCase.court_no || data.court_no || '',
    case_num: savedCase.court_no || data.court_no || '',
    stage: savedCase.review_result || data.review_result || '',
    notes: savedCase.comments || data.comments || '',
    review_ready: Number(savedCase.review_show_flag || data.review_show_flag || 0),
    kvartal: existing?.kvartal || getQuarterTextFromRuDate(savedCase.registration_date || data.registration_date || getTodayRu()),
    address: existing?.address || '',
    district: existing?.district || '',
    sum_claim: existing?.sum_claim || '',
    claim_amount: existing?.claim_amount || existing?.sum_claim || '',
    collected: existing?.collected || '',
    provided_area: existing?.provided_area || existing?.area || '',
    execution_quarter: existing?.execution_quarter || '',
    total_fulfilled_sum: existing?.total_fulfilled_sum || '',
    total_unfulfilled_sum: existing?.total_unfulfilled_sum || '',
    total_provided_area: existing?.total_provided_area || '',
    total_unfulfilled_area: existing?.total_unfulfilled_area || '',
    condemned_date: existing?.condemned_date || '',
    resettlement_deadline: existing?.resettlement_deadline || ''
  };

  if (existing?.id) await dbApi.updateEmergencyFund(existing.id, payload);
  else await dbApi.createEmergencyFund(payload);
}


async function syncMunicipalRegistryFromGeneral(savedCase, data) {
  const generalCaseId = Number(savedCase?.id || data?.id || 0);
  if (!generalCaseId) return;

  const existingRows = await dbApi.getMunicipalRegistry().catch(() => []);
  const existing = Array.isArray(existingRows)
    ? existingRows.find(row => Number(row.general_case_id || 0) === generalCaseId)
    : null;

  const payload = {
    ...(existing || {}),
    general_case_id: generalCaseId,
    pk_number: savedCase.case_no || data.case_no || existing?.pk_number || '',
    kvartal: existing?.kvartal || getQuarterTextFromRuDate(savedCase.registration_date || data.registration_date || getTodayRu()),
    address: existing?.address || savedCase.claim_address || data.claim_address || '',
    fio: existing?.fio || savedCase.plaintiff || data.plaintiff || savedCase.defendant || data.defendant || '',
    property_type: existing?.property_type || '',
    notes: existing?.notes || savedCase.comments || data.comments || '',
    court: savedCase.court || data.court || existing?.court || '',
    stage: savedCase.review_result || data.review_result || existing?.stage || '',
    court_act_date: savedCase.judicial_act_date_first || data.judicial_act_date_first || existing?.court_act_date || '',
    court_act_number: existing?.court_act_number || savedCase.court_no || data.court_no || '',
    court_act: existing?.court_act || '',
    requirements: existing?.requirements || savedCase.claim_subject || data.claim_subject || '',
    appeal: existing?.appeal || '',
    execution: existing?.execution || savedCase.executor || data.executor || '',
    collected: existing?.collected || ''
  };

  if (existing?.id) await dbApi.updateMunicipalRegistry(existing.id, payload);
  else await dbApi.createMunicipalRegistry(payload);
}

function getQuarterTextFromRuDate(value) {
  const match = String(value || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const date = match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : new Date();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${['I', 'II', 'III', 'IV'][quarter - 1]} квартал ${date.getFullYear()}`;
}

async function askControlQuestionAgain(savedCase, data, attendanceData) {
  const controlAnswer = await askFlagQuestion('Контрольное дело', 'Дата и время заседания назначены?');

  if (controlAnswer === 'back') return;

  if (controlAnswer === 'yes') {
    const historyText = await askControlHistoryText();
    if (historyText === null) {
      await askControlQuestionAgain(savedCase, data, attendanceData);
      return;
    }

    await dbApi.createControlledFromGeneral(savedCase.id, historyText);
  } else {
    await dbApi.createControlledFromGeneral(savedCase.id, '');
  }

  await finishGeneralSave(data, attendanceData);
}

async function finishGeneralSave(data, attendanceData = null) {
  closeAllGeneralWorkflowDialogs();
  closeDialog();
  await loadGeneralCases();

  window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
  window.dispatchEvent(new CustomEvent('schedule:reload'));
  window.dispatchEvent(new CustomEvent('calendar:reload'));
  window.dispatchEvent(new CustomEvent('emergency:reload'));

  if (Number(data.control_flag) === 1 && attendanceData) {
    showNotification('Дело сохранено в общий перечень, контрольные дела, календарь и график');
  } else if (Number(data.control_flag) === 1) {
    showNotification('Дело сохранено в общий перечень и контрольные дела');
  } else if (attendanceData) {
    showNotification('Дело сохранено в общий перечень, календарь и график');
  }
}


function ensureGeneralWorkflowDialogs() {
  if (document.querySelector('[data-general-question-dialog]')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="general-mini-dialog" data-general-question-dialog>
      <div class="general-mini-head">
        <h3 data-general-question-title>Вопрос</h3>
      </div>
      <div class="general-mini-body">
        <p data-general-question-text>Дата и время заседания назначены?</p>
      </div>
      <div class="general-mini-actions">
        <button class="btn" data-general-question-no type="button">Нет</button>
        <button class="btn primary" data-general-question-yes type="button">Да</button>
        <button class="btn" data-general-question-back type="button">Назад</button>
      </div>
    </dialog>

    <dialog class="general-history-dialog" data-general-history-dialog>
      <div class="general-mini-head">
        <h3>История результатов</h3>
      </div>
      <div class="general-mini-body">
        <div class="controlled-history-block general-history-mini-block">
          <div class="controlled-history-title">
            <h4>История результатов</h4>
            <div class="controlled-history-actions">
              <button class="btn small" data-general-history-add type="button">+</button>
              <button class="btn small" data-general-history-remove type="button">−</button>
            </div>
          </div>
          <div class="controlled-history-header">
            <span>№</span>
            <span>Примечания</span>
            <span>Время</span>
            <span>Дата</span>
            <span></span>
          </div>
          <div class="controlled-history-rows" data-general-history-rows></div>
        </div>
      </div>
      <div class="general-mini-actions">
        <button class="btn primary" data-general-history-save type="button">Сохранить</button>
        <button class="btn" data-general-history-skip type="button">Пропустить</button>
        <button class="btn" data-general-history-back type="button">Назад</button>
      </div>
    </dialog>

    <dialog class="general-hearing-dialog" data-general-hearing-dialog>
      <div class="general-mini-head">
        <h3>Дата и время заседания</h3>
      </div>
      <div class="general-mini-body general-hearing-form">
        <label>
          <span>Дата</span>
          <div class="general-date-line">
            <input data-general-hearing-date placeholder="ДД.ММ.ГГГГ" maxlength="10">
            <button class="btn small" data-general-hearing-calendar type="button">▣</button>
          </div>
        </label>
        <label>
          <span>Время</span>
          <input data-general-hearing-time placeholder="ЧЧ:ММ" maxlength="5">
        </label>
      </div>
      <div class="general-mini-actions">
        <button class="btn primary" data-general-hearing-save type="button">Сохранить</button>
        <button class="btn" data-general-hearing-back type="button">Назад</button>
      </div>
    </dialog>

    <dialog class="general-date-picker-dialog" data-general-date-picker-dialog>
      <div class="general-mini-head general-date-picker-head">
        <button class="btn small" data-general-date-prev type="button">◀</button>
        <h3 data-general-date-title>Месяц</h3>
        <button class="btn small" data-general-date-next type="button">▶</button>
      </div>
      <div class="general-date-weekdays">
        <span>ПН</span><span>ВТ</span><span>СР</span><span>ЧТ</span><span>ПТ</span><span>СБ</span><span>ВС</span>
      </div>
      <div class="general-date-picker-grid" data-general-date-grid></div>
      <div class="general-mini-actions">
        <button class="btn" data-general-date-today type="button">Сегодня</button>
        <button class="btn" data-general-date-cancel type="button">Отмена</button>
      </div>
    </dialog>
  `);
}

function askFlagQuestion(title, question) {
  ensureGeneralWorkflowDialogs();

  const dialog = document.querySelector('[data-general-question-dialog]');
  const titleNode = document.querySelector('[data-general-question-title]');
  const textNode = document.querySelector('[data-general-question-text]');

  if (titleNode) titleNode.textContent = title;
  if (textNode) textNode.textContent = question;

  return new Promise(resolve => {
    const yes = document.querySelector('[data-general-question-yes]');
    const no = document.querySelector('[data-general-question-no]');
    const back = document.querySelector('[data-general-question-back]');

    yes.onclick = () => { dialog.close(); resolve('yes'); };
    no.onclick = () => { dialog.close(); resolve('no'); };
    back.onclick = () => { dialog.close(); resolve('back'); };

    dialog.showModal();
  });
}

function askControlHistoryText() {
  ensureGeneralWorkflowDialogs();

  const dialog = document.querySelector('[data-general-history-dialog]');
  const rowsNode = document.querySelector('[data-general-history-rows]');
  const addButton = document.querySelector('[data-general-history-add]');
  const removeButton = document.querySelector('[data-general-history-remove]');
  const saveButton = document.querySelector('[data-general-history-save]');
  const skipButton = document.querySelector('[data-general-history-skip]');
  const backButton = document.querySelector('[data-general-history-back]');

  const rows = [{ id: makeMiniId(), note: '', time: '', date: '' }];

  function renderRows() {
    rowsNode.innerHTML = rows.map((row, index) => `
      <div class="controlled-history-row" data-general-history-id="${row.id}">
        <span class="history-number">${index + 1}.</span>
        <input data-general-history-note value="${escapeAttr(row.note)}" placeholder="Примечание">
        <input data-general-history-time value="${escapeAttr(row.time)}" placeholder="ЧЧ:ММ" maxlength="5">
        <input data-general-history-date value="${escapeAttr(row.date)}" placeholder="ДД.ММ.ГГГГ" maxlength="10">
        <button class="btn small" data-general-history-today="${row.id}" type="button">сегодня</button>
      </div>
    `).join('');
  }

  function syncRows() {
    rowsNode.querySelectorAll('[data-general-history-id]').forEach((node, index) => {
      rows[index].note = node.querySelector('[data-general-history-note]')?.value || '';
      rows[index].time = node.querySelector('[data-general-history-time]')?.value || '';
      rows[index].date = node.querySelector('[data-general-history-date]')?.value || '';
    });
  }

  function buildHistoryText() {
    syncRows();
    return rows.map(row => {
      const left = [row.time, row.date].map(value => String(value || '').trim()).filter(Boolean).join(' ');
      const note = String(row.note || '').trim();
      if (left && note) return `${left} - ${note}`;
      if (left) return left;
      return note;
    }).filter(Boolean).join('\n');
  }

  renderRows();

  addButton.onclick = () => {
    syncRows();
    rows.push({ id: makeMiniId(), note: '', time: '', date: '' });
    renderRows();
  };

  removeButton.onclick = () => {
    syncRows();
    if (rows.length > 1) rows.pop();
    renderRows();
  };

  rowsNode.oninput = event => {
    if (event.target.matches('[data-general-history-time]')) {
      event.target.value = formatMiniTime(event.target.value);
    }
    if (event.target.matches('[data-general-history-date]')) {
      event.target.value = formatMiniDate(event.target.value);
    }
  };

  rowsNode.onclick = event => {
    const todayButton = event.target.closest('[data-general-history-today]');
    if (!todayButton) return;
    const row = todayButton.closest('[data-general-history-id]');
    const input = row?.querySelector('[data-general-history-date]');
    if (input) input.value = getTodayRu();
  };

  return new Promise(resolve => {
    saveButton.onclick = () => { const text = buildHistoryText(); dialog.close(); resolve(text); };
    skipButton.onclick = () => { dialog.close(); resolve(''); };
    backButton.onclick = () => { dialog.close(); resolve(null); };
    dialog.showModal();
  });
}

function askAttendanceDateTime() {
  ensureGeneralWorkflowDialogs();

  const dialog = document.querySelector('[data-general-hearing-dialog]');
  const dateInput = document.querySelector('[data-general-hearing-date]');
  const timeInput = document.querySelector('[data-general-hearing-time]');
  const calendarButton = document.querySelector('[data-general-hearing-calendar]');
  const saveButton = document.querySelector('[data-general-hearing-save]');
  const backButton = document.querySelector('[data-general-hearing-back]');

  dateInput.value = getTodayRu();
  timeInput.value = '';

  dateInput.oninput = () => { dateInput.value = formatMiniDate(dateInput.value); };
  timeInput.oninput = () => { timeInput.value = formatMiniTime(timeInput.value); };
  calendarButton.onclick = async () => {
    const picked = await openMiniDatePicker(dateInput.value);
    if (picked) dateInput.value = picked;
  };

  return new Promise(resolve => {
    saveButton.onclick = () => {
      const hearing_date = String(dateInput.value || '').trim();
      const hearing_time = String(timeInput.value || '').trim();
      const cleanTime = hearing_time.replace(':', '');

      if (!isValidRuDate(hearing_date)) {
        alert('Укажите дату заседания в формате ДД.ММ.ГГГГ.');
        return;
      }

      if (cleanTime.length !== 4 || !/^\d+$/.test(cleanTime)) {
        alert('Время должно быть в формате ЧЧ:ММ.');
        return;
      }

      dialog.close();
      resolve({ hearing_date, hearing_time });
    };

    backButton.onclick = () => { dialog.close(); resolve(null); };
    dialog.showModal();
  });
}

function openMiniDatePicker(initialValue = '') {
  ensureGeneralWorkflowDialogs();

  const dialog = document.querySelector('[data-general-date-picker-dialog]');
  const title = document.querySelector('[data-general-date-title]');
  const grid = document.querySelector('[data-general-date-grid]');
  const prev = document.querySelector('[data-general-date-prev]');
  const next = document.querySelector('[data-general-date-next]');
  const todayButton = document.querySelector('[data-general-date-today]');
  const cancel = document.querySelector('[data-general-date-cancel]');

  const parsed = parseRuDate(initialValue) || new Date();
  let year = parsed.getFullYear();
  let month = parsed.getMonth();

  const months = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  function render() {
    title.textContent = `${months[month + 1]} ${year}`;
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < offset; i += 1) cells.push('<button class="general-date-cell empty" disabled></button>');
    for (let day = 1; day <= days; day += 1) {
      const value = `${String(day).padStart(2, '0')}.${String(month + 1).padStart(2, '0')}.${year}`;
      cells.push(`<button class="general-date-cell" data-general-date-value="${value}" type="button">${day}</button>`);
    }
    grid.innerHTML = cells.join('');
  }

  return new Promise(resolve => {
    prev.onclick = () => { month -= 1; if (month < 0) { month = 11; year -= 1; } render(); };
    next.onclick = () => { month += 1; if (month > 11) { month = 0; year += 1; } render(); };
    todayButton.onclick = () => { dialog.close(); resolve(getTodayRu()); };
    cancel.onclick = () => { dialog.close(); resolve(null); };
    grid.onclick = event => {
      const cell = event.target.closest('[data-general-date-value]');
      if (!cell) return;
      dialog.close();
      resolve(cell.dataset.generalDateValue);
    };
    render();
    dialog.showModal();
  });
}

function closeAllGeneralWorkflowDialogs() {
  document.querySelectorAll('[data-general-question-dialog], [data-general-history-dialog], [data-general-hearing-dialog], [data-general-date-picker-dialog]').forEach(dialog => {
    if (dialog.open) dialog.close();
  });
}

function isValidRuDate(value) {
  const parsed = parseRuDate(value);
  if (!parsed) return false;
  const [day, month, year] = String(value || '').split('.').map(Number);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function parseRuDate(value) {
  const [day, month, year] = String(value || '').split('.').map(Number);
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

function formatMiniTime(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function formatMiniDate(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return digits;
}

function makeMiniId() {
  return `mini_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}


async function archiveCase(id) {
  try {
    await dbApi.archiveGeneralCase(id);
    closeDialog();
    showNotification('Дело перенесено в архив');
    loadGeneralCases();
  } catch (error) {
    alert('Не удалось перенести в архив:\\n' + error.message);
  }
}

async function restoreCase(id) {
  try {
    await dbApi.restoreGeneralCase(id);
    closeDialog();
    showNotification('Дело восстановлено из архива');
    await loadGeneralCases();

    window.dispatchEvent(new CustomEvent('controlled-cases:reload'));
    window.dispatchEvent(new CustomEvent('schedule:reload'));
    window.dispatchEvent(new CustomEvent('calendar:reload'));
  window.dispatchEvent(new CustomEvent('emergency:reload'));
  } catch (error) {
    alert('Не удалось восстановить дело:\\n' + error.message);
  }
}

function getTodayRu() {
  const date = new Date();
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear()
  ].join('.');
}

function formatText(value) {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
}

function formatInline(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text) : `<span class="muted">${fallback}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


/* ===== HOTFIX/UPDATE: event-based appeal calculator for general cases ===== */
function handleJudicialActDateChange(input) {
  const value = String(input?.value || '').trim();
  const form = document.querySelector('[data-general-form]');
  const motivated = form?.elements.motivated_decision_date;
  if (value && isValidRuDate(value) && motivated && !motivated.value.trim()) {
    motivated.value = value;
    handleMotivatedDecisionDateChange(motivated);
  }
}

function handleMotivatedDecisionDateChange(input) {
  const value = String(input?.value || '').trim();
  if (!value || !isValidRuDate(value)) {
    renderAppealSuggestions();
    return;
  }

  const block = document.querySelector('[data-general-appeal-block]');
  const alreadyVisible = block && !block.hidden;
  const rows = collectAppealRows();

  if (alreadyVisible || rows.length) {
    fillEmptyAppealDates(value);
    renderAppealRows(rows.length ? rows : [{ event_date: value }]);
    setAppealBlockVisible(true);
    renderAppealSuggestions();
    return;
  }

  openAppealIntentDialog({
    onYes: () => {
      setAppealBlockVisible(true);
      renderAppealRows([{ event_date: value }]);
      renderAppealSuggestions(true);
    },
    onNo: () => {
      setAppealBlockVisible(false);
      const container = document.querySelector('[data-general-appeal-rows]');
      if (container) container.innerHTML = '';
      renderAppealSuggestions();
    }
  });
}

function openAppealIntentDialog({ onYes, onNo } = {}) {
  document.querySelector('[data-general-appeal-intent-modal]')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'general-mini-modal-overlay';
  overlay.dataset.generalAppealIntentModal = '1';
  overlay.innerHTML = `
    <div class="general-mini-modal" role="dialog" aria-modal="true">
      <div class="general-mini-modal-icon">⚖</div>
      <h3>Судебный акт подлежит обжалованию?</h3>
      <p>Если да — откроется блок расчёта сроков и планирования жалобы.</p>
      <div class="general-mini-modal-actions">
        <button class="btn primary" data-general-appeal-intent-yes type="button">Да</button>
        <button class="btn" data-general-appeal-intent-no type="button">Нет</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = callback => {
    overlay.remove();
    if (typeof callback === 'function') callback();
  };

  overlay.querySelector('[data-general-appeal-intent-yes]')?.addEventListener('click', () => close(onYes));
  overlay.querySelector('[data-general-appeal-intent-no]')?.addEventListener('click', () => close(onNo));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close(onNo);
  });
}

function fillEmptyAppealDates(value) {
  document.querySelectorAll('[data-general-appeal-date]').forEach(input => {
    if (!input.value.trim()) input.value = value;
  });
}

function __old_collectAppealRows_1() {
  return Array.from(document.querySelectorAll('[data-general-appeal-row]'))
    .map(row => ({
      process_kind: row.querySelector('[data-general-appeal-process]')?.value || 'ГПК',
      act_instance: row.querySelector('[data-general-appeal-instance]')?.value || 'Первая инстанция',
      appeal_kind: row.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция',
      event_date: row.querySelector('[data-general-appeal-date]')?.value?.trim() || '',
      late_motivated_received: row.querySelector('[data-general-appeal-late]')?.value || 'Нет',
      title: row.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция',
      date: row.querySelector('[data-general-appeal-date]')?.value?.trim() || ''
    }))
    .filter(row => row.event_date || row.process_kind || row.act_instance || row.appeal_kind);
}

function __old_renderAppealRows_1(rows = []) {
  const container = document.querySelector('[data-general-appeal-rows]');
  if (!container) return;

  const motivated = document.querySelector('[data-general-form]')?.elements.motivated_decision_date?.value?.trim() || '';
  const list = Array.isArray(rows) && rows.length ? rows : [];
  container.innerHTML = list.map(row => renderAppealRow({
    process_kind: row.process_kind || row.processKind || 'ГПК',
    act_instance: row.act_instance || row.actInstance || 'Первая инстанция',
    appeal_kind: row.appeal_kind || row.appealKind || row.title || 'Апелляция',
    event_date: row.event_date || row.date || motivated,
    late_motivated_received: row.late_motivated_received || row.lateMotivatedReceived || 'Нет'
  })).join('');

  container.querySelectorAll('[data-general-appeal-row]').forEach(renderAppealRowResult);
  renderAppealSuggestions();
}

function __old_renderAppealRow_1(row = {}) {
  const processKind = row.process_kind || 'ГПК';
  const actInstance = row.act_instance || 'Первая инстанция';
  const appealKind = normalizeAppealKind(row.appeal_kind || 'Апелляция');
  const eventDate = row.event_date || '';
  const late = row.late_motivated_received || 'Нет';

  return `
    <div class="general-appeal-row general-appeal-event-row" data-general-appeal-row>
      <label>
        <span>Вид производства</span>
        <select data-general-appeal-control data-general-appeal-process required>
          ${option('ГПК', 'Гражданский процесс (ГПК РФ)', processKind)}
          ${option('АПК', 'Арбитражный процесс (АПК РФ)', processKind)}
          ${option('КАС', 'Административное судопроизводство (КАС РФ)', processKind)}
        </select>
      </label>

      <label>
        <span>Инстанция, вынесшая акт</span>
        <select data-general-appeal-control data-general-appeal-instance required>
          ${option('Первая инстанция', 'Первая инстанция', actInstance)}
          ${option('Апелляционная инстанция', 'Апелляционная инстанция', actInstance)}
          ${option('Кассационная инстанция', 'Кассационная инстанция', actInstance)}
        </select>
      </label>

      <label>
        <span>Вид обжалования</span>
        <select data-general-appeal-control data-general-appeal-kind required>
          ${option('Апелляция', 'Апелляция', appealKind)}
          ${option('Кассация', 'Кассация', appealKind)}
          ${option('Кассация в Верховный суд РФ', 'Кассация в Верховный суд РФ', appealKind)}
          ${option('Жалоба в Конституционный суд РФ', 'Жалоба в Конституционный суд РФ', appealKind)}
        </select>
      </label>

      <label>
        <span data-general-appeal-date-label>${appealDateLabel(appealKind)}</span>
        <input data-general-appeal-date value="${escapeAttr(eventDate)}" placeholder="ДД.ММ.ГГГГ" autocomplete="off">
      </label>

      <label class="general-appeal-late-field" data-general-appeal-late-wrap ${appealKind === 'Апелляция' ? '' : 'hidden'}>
        <span>Акт получен с нарушением срока изготовления мотивированной части?</span>
        <select data-general-appeal-control data-general-appeal-late>
          ${option('Нет', 'Нет', late)}
          ${option('Да', 'Да', late)}
        </select>
      </label>

      <button class="btn small" data-general-appeal-remove type="button" title="Удалить событие">−</button>
      <div class="general-appeal-event-result" data-general-appeal-row-result></div>
    </div>
  `;
}

function option(value, label, selected) {
  return `<option value="${escapeAttr(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function __old_addAppealRow_1(row = {}) {
  setAppealBlockVisible(true);
  const container = document.querySelector('[data-general-appeal-rows]');
  if (!container) return;

  const motivated = document.querySelector('[data-general-form]')?.elements.motivated_decision_date?.value?.trim() || '';
  container.insertAdjacentHTML('beforeend', renderAppealRow({
    event_date: motivated,
    ...row
  }));

  renderAppealRowResult(container.lastElementChild);
  renderAppealSuggestions(true);
}

function __old_removeAppealRow_1(button) {
  const row = button.closest('[data-general-appeal-row]');
  if (!row) return;
  row.remove();

  if (!document.querySelector('[data-general-appeal-row]')) {
    setAppealBlockVisible(false);
  }

  renderAppealSuggestions();
}

function __old_renderAppealRowResult(rowNode) {
  if (!rowNode) return;

  const dateLabel = rowNode.querySelector('[data-general-appeal-date-label]');
  const resultNode = rowNode.querySelector('[data-general-appeal-row-result]');
  const lateWrap = rowNode.querySelector('[data-general-appeal-late-wrap]');
  const processKind = rowNode.querySelector('[data-general-appeal-process]')?.value || 'ГПК';
  const appealKind = normalizeAppealKind(rowNode.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция');
  const late = rowNode.querySelector('[data-general-appeal-late]')?.value || 'Нет';

  if (dateLabel) dateLabel.textContent = appealDateLabel(appealKind);
  if (lateWrap) lateWrap.hidden = appealKind !== 'Апелляция';

  if (!resultNode) return;

  const rowData = getAppealRowData(rowNode);
  const result = calculateAppealDeadlineFromAppealEvent(rowData);

  const explanation = getAppealKindExplanation(processKind, appealKind);
  const lateWarning = appealKind === 'Апелляция' && late === 'Да'
    ? `<p class="danger">Акт получен с нарушением срока изготовления мотивированной части. Срок на апелляционное обжалование может быть восстановлен судом при наличии уважительных причин. Рекомендуется приложить ходатайство о восстановлении срока.</p>`
    : '';

  if (appealKind === 'Жалоба в Конституционный суд РФ') {
    resultNode.innerHTML = `
      <p>${escapeHtml(explanation)}</p>
      <ul>
        <li>Пройдена апелляция.</li>
        <li>Пройдена кассация в суд общей юрисдикции или арбитражный суд округа.</li>
        <li>Пройдена кассация в Верховный суд РФ.</li>
        <li>Проверяется не законность решения, а соответствие применённого закона Конституции РФ.</li>
      </ul>
    `;
    return;
  }

  const deadlineText = result?.dateRu
    ? `<b>Последний день подачи ${escapeHtml(appealKind.toLowerCase())} — ${escapeHtml(result.dateRu)}.</b>`
    : `<b>Введите дату, чтобы рассчитать срок.</b>`;

  const expired = result?.dateIso && isDeadlineExpired(result.dateIso)
    ? `<p class="danger">Срок подачи жалобы пропущен. Можно подать заявление о восстановлении процессуального срока в суд, вынесший обжалуемый акт, при наличии уважительных причин. Предельный срок — 6 месяцев со дня вступления акта в законную силу.</p>`
    : '';

  resultNode.innerHTML = `
    <p>${escapeHtml(explanation)}</p>
    <p>${deadlineText}</p>
    ${result?.rule ? `<p class="muted">${escapeHtml(result.rule)}</p>` : ''}
    ${lateWarning}
    ${expired}
  `;
}

function __old_getAppealRowData(rowNode) {
  return {
    process_kind: rowNode.querySelector('[data-general-appeal-process]')?.value || 'ГПК',
    act_instance: rowNode.querySelector('[data-general-appeal-instance]')?.value || 'Первая инстанция',
    appeal_kind: normalizeAppealKind(rowNode.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция'),
    event_date: rowNode.querySelector('[data-general-appeal-date]')?.value?.trim() || '',
    late_motivated_received: rowNode.querySelector('[data-general-appeal-late]')?.value || 'Нет'
  };
}

function __old_renderAppealSuggestions_1(forcePrompt = false) {
  const node = document.querySelector('[data-general-appeal-suggestions]');
  const form = document.querySelector('[data-general-form]');
  if (!node || !form) return;

  try {
    document.querySelectorAll('[data-general-appeal-row]').forEach(renderAppealRowResult);
    const data = collectGeneralCaseFormData(form);
    const tasks = buildGeneralCaseAutoTasks({ ...data, id: data.id || 'preview' }, data, { preview: true });

    if (!tasks.length) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }

    node.hidden = false;
    node.innerHTML = `
      <h5>Автоматически будут добавлены в план и календарь:</h5>
      ${tasks.map(task => `
        <div class="general-appeal-suggestion">
          <b>${formatText(task.dateRu)}</b>
          <span>${formatText(task.desc.replace('[Авто общего перечня] ', ''))}</span>
        </div>
      `).join('')}
    `;

    if (forcePrompt && tasks[0]) {
      alert(`Последний срок подачи жалобы — ${tasks[0].dateRu}.\n\nЭтот срок будет указан в плане и календаре после сохранения дела.`);
    }
  } catch (error) {
    console.warn('Ошибка расчета подсказок обжалования', error);
    node.hidden = true;
    node.innerHTML = '';
  }
}

function __old_getAppealSummary_1(row) {
  const rows = parseAppeals(row.appeals_json);
  const calculated = [];

  for (const item of rows) {
    const result = calculateAppealDeadlineFromAppealEvent(item);
    if (item.appeal_kind === 'Жалоба в Конституционный суд РФ') {
      calculated.push('Конституционный суд РФ: срок законом не ограничен, требуется проверка условий допустимости');
    } else if (result?.dateRu) {
      calculated.push(`${item.appeal_kind || 'Обжалование'}: ${item.event_date || item.date} → срок до ${result.dateRu}`);
    }
  }

  return calculated.length ? calculated.join('\n') : getAppealValue(row);
}

function __old_confirmAppealDeadlinesBeforeSave_1(data) {
  const lines = parseAppeals(data.appeals_json)
    .map(item => {
      const result = calculateAppealDeadlineFromAppealEvent(item);
      if (item.appeal_kind === 'Жалоба в Конституционный суд РФ') {
        return 'Конституционный суд РФ: срок не рассчитывается, проверьте исчерпание средств защиты.';
      }
      return result?.dateRu
        ? `${item.appeal_kind || 'Обжалование'}: последний срок подачи жалобы — ${result.dateRu}`
        : '';
    })
    .filter(Boolean);

  if (lines.length) {
    alert(`${lines.join('\n')}\n\nСроки будут добавлены в план и календарь после сохранения дела.`);
  }
}

async function __old_syncGeneralCaseAutoTasks_1(savedCase, data, previousRow = null) {
  const oldEvents = getHearingEventDates(previousRow);
  const newEvents = getHearingEventDates(data);
  const hearingDateChanged = oldEvents.length && newEvents.length && oldEvents.join('|') !== newEvents.join('|');

  let allTasks = [];
  try {
    allTasks = await dbApi.getCalendarTasks({});
  } catch (error) {
    console.warn('Не удалось получить задачи календаря', error);
  }

  const existingAutoTasks = allTasks.filter(task =>
    Number(task.general_case_id) === Number(savedCase.id) &&
    String(task.description || task.desc || '').startsWith('[Авто общего перечня]')
  );

  if (hearingDateChanged && existingAutoTasks.length) {
    const oldText = oldEvents.map(displayIsoAsRu).join(', ');
    const newText = newEvents.map(displayIsoAsRu).join(', ');
    const ok = confirm(`⚠️ Дата предварительного заседания изменена с ${oldText} на ${newText}.\nОбнаружены зависимые задачи.\n\nПересчитать сроки их исполнения автоматически?`);
    if (!ok) return;
  }

  for (const task of existingAutoTasks) {
    try {
      await dbApi.deleteCalendarTask(task.id);
    } catch (error) {
      console.warn('Не удалось удалить старую автозадачу', error);
    }
  }

  const tasks = buildGeneralCaseAutoTasks(savedCase, data);
  for (const task of tasks) {
    try {
      await dbApi.createCalendarTask({
        date: task.dateIso,
        user: task.user,
        type: task.type,
        desc: task.desc,
        time: '',
        court: data.court || '',
        subject: data.claim_subject || '',
        assignment: task.assignment,
        general_case_id: savedCase.id
      });
    } catch (error) {
      console.warn('Не удалось создать автозадачу', error);
    }
  }

  if (tasks.length) {
    showNotification(`Автоматически добавлено задач в план/календарь: ${tasks.length}`);
  }
}

function __old_buildGeneralCaseAutoTasks_1(savedCase, data, { preview = false } = {}) {
  const row = { ...savedCase, ...data };
  const tasks = [];
  const user = data.executor || getCurrentUserName() || 'Администратор';
  const caseNo = data.case_no || savedCase.case_no || '';
  const baseAssignment = `Дело № ${caseNo}\nИстец: ${data.plaintiff || ''}\nОтветчик: ${data.defendant || ''}\nПредмет: ${data.claim_subject || ''}${data.claim_address ? '\nАдрес: ' + data.claim_address : ''}`.trim();

  for (const item of parseAppeals(data.appeals_json)) {
    if (isHearingEvent(item.title || item.appeal_kind)) {
      const prepDate = subtractCalendarDaysWithWeekendShift(ruDateToDate(item.event_date || item.date), 5);
      if (prepDate) {
        tasks.push({
          dateIso: dateToIso(prepDate),
          dateRu: dateToRu(prepDate),
          user,
          type: 'поручение',
          desc: `[Авто общего перечня] Подготовить отзыв на иск по делу № ${caseNo}`,
          assignment: `${baseAssignment}\nЗаседание: ${item.event_date || item.date}\nВнутренняя инструкция: за 5 календарных дней до заседания; если срок выпал на выходной — перенос на ближайший рабочий день`
        });
      }
      continue;
    }

    const result = calculateAppealDeadlineFromAppealEvent(item);
    if (!result?.dateIso) continue;

    tasks.push({
      dateIso: result.dateIso,
      dateRu: result.dateRu,
      user,
      type: 'поручение',
      desc: `[Авто общего перечня] Последний день подачи ${String(item.appeal_kind || 'жалобы').toLowerCase()} по делу № ${caseNo}`,
      assignment: `${baseAssignment}\nВид производства: ${item.process_kind || 'ГПК'}\nИнстанция: ${item.act_instance || ''}\nВид обжалования: ${item.appeal_kind || ''}\nДата акта/мотивировки: ${item.event_date || item.date || ''}\nРасчёт: ${result.rule}`
    });
  }

  return preview ? tasks.slice(0, 6) : tasks;
}

function __old_calculateAppealDeadlineFromForm_1(data = {}) {
  const firstRow = parseAppeals(data.appeals_json)[0];
  return firstRow ? calculateAppealDeadlineFromAppealEvent(firstRow) : null;
}

function __old_calculateAppealDeadlineFromAppealEvent(item = {}) {
  const appealKind = normalizeAppealKind(item.appeal_kind || item.title || 'Апелляция');
  if (appealKind === 'Жалоба в Конституционный суд РФ') {
    return { dateIso: '', dateRu: '', rule: 'Конституционный суд РФ: срок законом не ограничен' };
  }

  const start = ruDateToDate(item.event_date || item.date);
  if (!start) return null;

  const processKind = item.process_kind || 'ГПК';
  let deadline;
  let rule;

  if (appealKind === 'Апелляция') {
    deadline = addMonths(addDays(start, 1), 1);
    rule = `апелляция: 1 календарный месяц (${processKind}); срок течёт со следующего календарного дня`;
  } else if (appealKind === 'Кассация') {
    const months = processKind === 'АПК' ? 2 : (processKind === 'КАС' ? 6 : 3);
    deadline = addMonths(addDays(start, 1), months);
    rule = `кассация: ${months} календарн. мес. (${processKind}); срок течёт со следующего календарного дня`;
  } else if (appealKind === 'Кассация в Верховный суд РФ') {
    deadline = addMonths(addDays(start, 1), 3);
    rule = `кассация в Верховный суд РФ: 3 календарных месяца (${processKind}); срок течёт со следующего календарного дня`;
  } else {
    return null;
  }

  const adjusted = moveToNextWorkingDay(deadline);
  const moved = adjusted.getTime() !== deadline.getTime();
  return {
    dateIso: dateToIso(adjusted),
    dateRu: dateToRu(adjusted),
    rule: `${rule}; последний день переносится только если выпал на выходной/праздник${moved ? '; перенесено на ближайший рабочий день' : ''}`
  };
}

function normalizeAppealKind(value = '') {
  const text = String(value || '').trim();
  if (/конституц/i.test(text)) return 'Жалоба в Конституционный суд РФ';
  if (/верхов/i.test(text) || /вс\s*рф/i.test(text)) return 'Кассация в Верховный суд РФ';
  if (/кассац/i.test(text)) return 'Кассация';
  return 'Апелляция';
}

function appealDateLabel(appealKind = 'Апелляция') {
  const kind = normalizeAppealKind(appealKind);
  if (kind === 'Кассация') return 'Дата изготовления апелляционного определения';
  if (kind === 'Кассация в Верховный суд РФ') return 'Дата изготовления определения кассационного суда / арбитражного суда округа';
  if (kind === 'Жалоба в Конституционный суд РФ') return 'Дата последнего судебного акта';
  return 'Дата изготовления мотивированного решения суда первой инстанции';
}

function getAppealKindExplanation(processKind = 'ГПК', appealKind = 'Апелляция') {
  const kind = normalizeAppealKind(appealKind);

  if (kind === 'Кассация') {
    if (processKind === 'АПК') {
      return 'Это означает, что судебный акт будет обжалован в арбитражный суд округа.';
    }
    if (processKind === 'КАС') {
      return 'Это означает, что апелляционное определение будет обжаловано в кассационный суд общей юрисдикции.';
    }
    return 'Это означает, что апелляционное определение будет обжаловано в кассационный суд общей юрисдикции, например Восьмой кассационный суд общей юрисдикции.';
  }

  if (kind === 'Кассация в Верховный суд РФ') {
    if (processKind === 'АПК') {
      return 'Это означает, что на постановление арбитражного суда округа подается кассационная жалоба в Верховный суд РФ, в Судебную коллегию по экономическим спорам.';
    }
    if (processKind === 'КАС') {
      return 'Это означает, что на определение кассационного суда общей юрисдикции подается кассационная жалоба в Верховный суд РФ, в Судебную коллегию по административным делам.';
    }
    return 'Это означает, что на определение кассационного суда общей юрисдикции подается кассационная жалоба в Верховный суд РФ, в соответствующую судебную коллегию.';
  }

  if (kind === 'Жалоба в Конституционный суд РФ') {
    return 'Жалоба в Конституционный Суд РФ возможна только после полного исчерпания всех внутригосударственных средств судебной защиты: апелляции, кассации и кассации в Верховный суд РФ. Предмет проверки — соответствие примененного закона Конституции РФ.';
  }

  if (processKind === 'АПК') return 'Апелляционная жалоба по арбитражному делу подается в арбитражный апелляционный суд.';
  if (processKind === 'КАС') return 'Апелляционная жалоба по административному делу подается в апелляционный суд общей юрисдикции.';
  return 'Апелляционная жалоба по гражданскому делу подается через суд первой инстанции в вышестоящий суд.';
}


/* ===== General cases documents/tabs/appeal final overrides ===== */
function __old_switchGeneralCaseTab(tab = 'info') {
  const safeTab = ['info', 'documents', 'appeal'].includes(tab) ? tab : 'info';
  document.querySelectorAll('[data-general-case-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.generalCaseTab === safeTab));
  document.querySelectorAll('[data-general-case-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.generalCaseTabPanel !== safeTab; panel.classList.toggle('is-active', panel.dataset.generalCaseTabPanel === safeTab); });
}
function parseDocuments(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function collectDocumentRows() {
  return Array.from(document.querySelectorAll('[data-general-document-row]')).map(row => ({
    name: row.dataset.name || '',
    path: row.dataset.path || '',
    type: row.dataset.type || 'Иной документ',
    mime: row.dataset.mime || '',
    note: row.querySelector('[data-general-document-row-note]')?.value?.trim() || '',
    comment: row.querySelector('[data-general-document-comment]')?.value?.trim() || '',
    added_at: row.dataset.addedAt || new Date().toISOString()
  })).filter(item => item.name || item.path || item.note || item.comment);
}
function syncDocumentsHiddenInput() { const form = document.querySelector('[data-general-form]'); if (form?.elements.documents_json) form.elements.documents_json.value = JSON.stringify(collectDocumentRows()); }
function renderDocumentsRows(rows = []) {
  const list = document.querySelector('[data-general-documents-list]');
  if (!list) return;
  const docs = Array.isArray(rows) ? rows : [];
  if (!docs.length) { list.innerHTML = '<div class="empty-card">Документы пока не прикреплены</div>'; syncDocumentsHiddenInput(); return; }
  list.innerHTML = docs.map((doc, index) => `<div class="general-document-row" data-general-document-row data-name="${escapeAttr(doc.name || '')}" data-path="${escapeAttr(doc.path || '')}" data-type="${escapeAttr(doc.type || 'Иной документ')}" data-mime="${escapeAttr(doc.mime || '')}" data-added-at="${escapeAttr(doc.added_at || new Date().toISOString())}"><div class="general-document-main"><div class="general-document-icon">${documentIcon(doc)}</div><div><span class="general-document-type-badge">${escapeHtml(doc.type || 'Иной документ')}</span><b>${escapeHtml(doc.name || doc.path || 'Документ')}</b><small>${escapeHtml(doc.path || 'локальный путь недоступен')}</small></div></div><label><span>Примечание к документу</span><input data-general-document-row-note value="${escapeAttr(doc.note || '')}" placeholder="копия жалобы / доказательство отправки / судебный акт"></label><label><span>Комментарии</span><textarea data-general-document-comment rows="2">${escapeHtml(doc.comment || '')}</textarea></label><div class="general-document-row-actions"><button class="btn small primary" data-general-document-open-item="${index}" type="button">👁 Предпросмотр</button><button class="btn small" data-general-document-external-item="${index}" type="button">↗ Открыть</button><button class="btn small danger" data-general-document-remove type="button">−</button></div></div>`).join('');
  syncDocumentsHiddenInput();
}
function documentIcon(doc = {}) {
  const ext = String(doc.name || doc.path || '').split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'W';
  return '📄';
}
const MAX_GENERAL_CASE_DOCUMENT_BYTES = 100 * 1024 * 1024;
async function handleDocumentFileInput(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const note = document.querySelector('[data-general-document-note]')?.value?.trim() || '';
  const type = document.querySelector('[data-general-document-type]')?.value || 'Иной документ';
  const docs = collectDocumentRows();
  const now = new Date().toISOString();
  const allowed = /\.(pdf|doc|docx)$/i;
  const rejected = [];
  for (const file of files) {
    if (!allowed.test(file.name || '')) { rejected.push(`${file.name || 'Файл'} (неподдерживаемый формат)`); continue; }
    if (Number(file.size || 0) > MAX_GENERAL_CASE_DOCUMENT_BYTES) { rejected.push(`${file.name || 'Файл'} (больше 100 МБ)`); continue; }
    try {
      const dataBase64 = await fileToBase64(file);
      const uploaded = await dbApi.uploadGeneralCaseDocument({
        name: file.name || 'Документ',
        mime: file.type || '',
        data_base64: dataBase64
      });
      docs.push({
        name: uploaded.name || file.name || 'Документ',
        path: uploaded.path || '',
        type,
        mime: uploaded.mime || file.type || '',
        note,
        comment: '',
        added_at: now
      });
    } catch (error) {
      console.error('Не удалось прикрепить документ', error);
      rejected.push(`${file.name || 'Файл'} (${error.message || 'ошибка загрузки'})`);
    }
  }
  input.value = '';
  renderDocumentsRows(docs);
  const noteField = document.querySelector('[data-general-document-note]');
  if (noteField) noteField.value = '';
  if (rejected.length) alert(`Не удалось добавить некоторые файлы:\n${rejected.join('\n')}\n\nРазрешены PDF, DOC и DOCX размером до 100 МБ.`);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
function removeDocumentRow(button) { button.closest('[data-general-document-row]')?.remove(); renderDocumentsRows(collectDocumentRows()); }
function openDocumentsPicker() {
  const docs = collectDocumentRows();
  if (!docs.length) { alert('Документы не прикреплены.'); return; }
  if (docs.length === 1) { openDocumentPreview(docs[0]); return; }
  const list = docs.map((doc, index) => `${index + 1}. [${doc.type || 'Документ'}] ${doc.name || doc.path || 'Документ'}`).join('\n');
  const selected = prompt(`Какой документ показать?\n\n${list}\n\nВведите номер документа:`, '1');
  const index = Number(selected) - 1;
  if (Number.isInteger(index) && docs[index]) openDocumentPreview(docs[index]);
}
function openDocumentByIndex(index) { const docs = collectDocumentRows(); if (docs[index]) openDocumentPreview(docs[index]); }
function getDocumentByIndex(index) { const docs = collectDocumentRows(); return docs[index] || null; }
function isAbsoluteWindowsPath(value) { return /^[a-zA-Z]:[\\/]/.test(String(value || '')); }
async function openDocumentPreview(doc) {
  const path = doc?.path || '';
  if (!path) {
    alert('Путь к документу не сохранён. Прикрепите файл заново.');
    return;
  }
  currentDocumentPreview = doc;
  const overlay = document.querySelector('[data-general-document-preview]');
  const frame = document.querySelector('[data-general-document-preview-frame]');
  const title = document.querySelector('[data-general-document-preview-title]');
  if (title) title.textContent = `${doc.type || 'Документ'}: ${doc.name || 'без названия'}`;
  if (overlay && !overlay.open) overlay.showModal();
  setDocumentPreviewState('loading');
  if (frame) {
    frame.hidden = true;
    frame.removeAttribute('src');
  }
  try {
    let blob;
    try {
      blob = await dbApi.previewGeneralCaseDocument(path);
    } catch (apiError) {
      if (!isAbsoluteWindowsPath(path)) throw apiError;
      const response = await fetch(`/files/preview?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(await response.text());
      blob = await response.blob();
    }
    if (currentDocumentPreviewUrl) URL.revokeObjectURL(currentDocumentPreviewUrl);
    currentDocumentPreviewUrl = URL.createObjectURL(blob);
    if (frame) {
      frame.onload = () => {
        frame.hidden = false;
        setDocumentPreviewState('ready');
      };
      frame.src = `${currentDocumentPreviewUrl}#toolbar=1&navpanes=0&scrollbar=1&view=FitH`;
    }
  } catch (error) {
    console.error('Не удалось открыть предпросмотр документа', error);
    setDocumentPreviewState('error', error.message || String(error));
  }
}

function setDocumentPreviewState(status, message = '') {
  const stateNode = document.querySelector('[data-general-document-preview-state]');
  const frame = document.querySelector('[data-general-document-preview-frame]');
  if (!stateNode) return;

  stateNode.classList.toggle('is-error', status === 'error');
  stateNode.hidden = status === 'ready';
  if (status !== 'ready' && frame) frame.hidden = true;

  const title = stateNode.querySelector('b');
  const details = stateNode.querySelector('small');
  if (status === 'error') {
    if (title) title.textContent = 'Предпросмотр недоступен';
    if (details) details.textContent = `${message || 'Не удалось подготовить документ.'}\nМожно открыть исходный файл во внешней программе.`;
    return;
  }
  if (title) title.textContent = 'Подготавливаем документ…';
  if (details) details.textContent = 'Для Word-файла это может занять несколько секунд.';
}

function closeDocumentPreview() {
  const overlay = document.querySelector('[data-general-document-preview]');
  const frame = document.querySelector('[data-general-document-preview-frame]');
  if (frame) {
    frame.onload = null;
    frame.removeAttribute('src');
    frame.hidden = true;
  }
  if (overlay?.open) overlay.close();
  if (currentDocumentPreviewUrl) URL.revokeObjectURL(currentDocumentPreviewUrl);
  currentDocumentPreviewUrl = '';
  currentDocumentPreview = null;
  setDocumentPreviewState('loading');
}
async function openDocumentExternal(doc) {
  const path = doc?.path || '';
  if (!path) { alert('Путь к документу не сохранён.'); return; }
  try {
    await dbApi.openGeneralCaseDocument(path);
  } catch (apiError) {
    if (!isAbsoluteWindowsPath(path)) {
      alert('Не удалось открыть документ:\n' + apiError.message);
      return;
    }
    try {
      const response = await fetch(`/meetings/open-local-file?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(await response.text());
    } catch (error) {
      alert('Не удалось открыть документ:\n' + error.message);
    }
  }
}
renderDocumentsRows = function renderDocumentsRowsWithReviewApproval(rows = []) {
  const list = document.querySelector('[data-general-documents-list]');
  if (!list) return;
  const docs = Array.isArray(rows) ? rows : [];
  if (!docs.length) {
    list.innerHTML = '<div class="empty-card">Документы пока не прикреплены</div>';
    syncDocumentsHiddenInput();
    return;
  }
  list.innerHTML = docs.map((doc, index) => {
    const approval = getReviewApprovalForDocument(doc);
    return `<div class="general-document-row" data-general-document-row data-document-index="${index}" data-name="${escapeAttr(doc.name || '')}" data-path="${escapeAttr(doc.path || '')}" data-type="${escapeAttr(doc.type || 'Иной документ')}" data-mime="${escapeAttr(doc.mime || '')}" data-added-at="${escapeAttr(doc.added_at || new Date().toISOString())}">
      <div class="general-document-main">
        <div class="general-document-icon">${documentIcon(doc)}</div>
        <div>
          <span class="general-document-type-badge">${escapeHtml(doc.type || 'Иной документ')}</span>
          <b>${escapeHtml(doc.name || doc.path || 'Документ')}</b>
          <small>${escapeHtml(doc.path || 'локальный путь недоступен')}</small>
        </div>
      </div>
      <label><span>Примечание к документу</span><input data-general-document-row-note value="${escapeAttr(doc.note || '')}" placeholder="копия жалобы / доказательство отправки / судебный акт"></label>
      <label><span>Комментарии</span><textarea data-general-document-comment rows="2">${escapeHtml(doc.comment || '')}</textarea></label>
      <div class="general-document-row-actions">
        <button class="btn small primary" data-general-document-open-item="${index}" type="button">Предпросмотр</button>
        <button class="btn small" data-general-document-external-item="${index}" type="button">Открыть</button>
        <button class="btn small danger" data-general-document-remove type="button">−</button>
      </div>
      ${renderReviewApprovalControls(doc, index, approval)}
    </div>`;
  }).join('');
  syncDocumentsHiddenInput();
};

function getReviewApprovalForDocument(doc = {}) {
  const path = String(doc.path || '').trim();
  return (state.reviewApprovals || []).find(item => String(item.document_path || '').trim() === path) || null;
}

function renderReviewApprovalControls(doc = {}, index = 0, approval = null) {
  const form = document.querySelector('[data-general-form]');
  const hasCase = Number(form?.elements.id?.value || 0) > 0;
  const isReviewDoc = /отзыв|review/i.test(String(`${doc.type || ''} ${doc.name || ''}`));
  const status = approval?.status || 'draft';
  const statusText = {
    draft: 'Черновик',
    pending: 'Ожидает согласования',
    revision_required: 'Требуется доработка',
    approved: 'Согласовано',
    completed: 'Исполнено'
  }[status] || status;
  const disabled = hasCase && isReviewDoc ? '' : ' disabled';
  const approvalId = approval?.id || '';
  const canSend = status === 'approved' ? '' : ' disabled';
  return `<div class="general-review-approval" data-general-review-approval>
    <div class="general-review-approval-status">
      <b>Согласование отзыва</b>
      <span class="general-review-approval-pill status-${escapeAttr(status)}">${escapeHtml(statusText)}</span>
      ${approval?.reviewer_comment ? `<small>${escapeHtml(approval.reviewer_comment)}</small>` : ''}
    </div>
    <div class="general-review-approval-actions">
      <button class="btn small primary" data-general-review-action="request" data-document-index="${index}" type="button"${disabled}>Отправить на согласование</button>
      <button class="btn small" data-general-review-action="comment" data-approval-id="${approvalId}" type="button"${approvalId ? '' : ' disabled'}>Комментарий</button>
      <button class="btn small" data-general-review-action="revision" data-approval-id="${approvalId}" type="button"${approvalId ? '' : ' disabled'}>На доработку</button>
      <button class="btn small primary" data-general-review-action="approve" data-approval-id="${approvalId}" type="button"${approvalId ? '' : ' disabled'}>Согласовано</button>
      <button class="btn small" data-general-review-action="court-sent" data-approval-id="${approvalId}" type="button"${approvalId ? canSend : ' disabled'}>Отправить в суд</button>
    </div>
    ${!hasCase ? '<p>Сначала сохраните дело, затем отправьте документ на согласование.</p>' : ''}
    ${hasCase && !isReviewDoc ? '<p>Согласование доступно для документов типа «Отзыв».</p>' : ''}
  </div>`;
}

async function refreshReviewApprovals(caseId = null) {
  const id = Number(caseId || document.querySelector('[data-general-form]')?.elements.id?.value || 0);
  if (!id) {
    state.reviewApprovals = [];
    return;
  }
  try {
    const response = await dbApi.getGeneralCaseReviewApprovals(id);
    state.reviewApprovals = Array.isArray(response?.items) ? response.items : [];
    renderDocumentsRows(collectDocumentRows());
  } catch (error) {
    console.warn('Не удалось загрузить согласования отзывов', error);
  }
}

async function handleReviewApprovalAction(button) {
  const form = document.querySelector('[data-general-form]');
  const caseId = Number(form?.elements.id?.value || 0);
  const action = button.dataset.generalReviewAction || '';
  if (!caseId) {
    alert('Сначала сохраните дело.');
    return;
  }
  try {
    if (action === 'request') {
      const index = Number(button.dataset.documentIndex || 0);
      const docs = collectDocumentRows();
      const doc = docs[index];
      if (!doc?.path) {
        alert('Документ не найден. Прикрепите файл заново.');
        return;
      }
      const comment = prompt('Комментарий руководителю:', '') || '';
      await dbApi.requestGeneralCaseReviewApproval(caseId, {
        document_index: index,
        document_path: doc.path,
        comment
      });
      showNotification('Отзыв отправлен на согласование');
    } else {
      const approvalId = Number(button.dataset.approvalId || 0);
      if (!approvalId) return;
      const comment = ['comment', 'revision', 'approve'].includes(action)
        ? (prompt('Комментарий:', '') || '')
        : '';
      if (action === 'comment') {
        await dbApi.commentGeneralCaseReviewApproval(caseId, approvalId, { comment });
        showNotification('Комментарий сохранён');
      } else if (action === 'revision') {
        await dbApi.requestGeneralCaseReviewRevision(caseId, approvalId, { comment });
        showNotification('Отзыв отправлен на доработку');
      } else if (action === 'approve') {
        await dbApi.approveGeneralCaseReview(caseId, approvalId, { comment });
        showNotification('Отзыв согласован');
      } else if (action === 'court-sent') {
        await dbApi.markGeneralCaseReviewSentToCourt(caseId, approvalId, {});
        showNotification('Статус отправки в суд отмечен как исполненный');
      }
    }
    await refreshReviewApprovals(caseId);
  } catch (error) {
    alert('Не удалось выполнить действие согласования:\n' + error.message);
  }
}

function openDocumentRecord(doc) { openDocumentPreview(doc); }

async function loadCasePlanEntries() {
  const list = document.querySelector('[data-general-case-plan-list]');
  const form = document.querySelector('[data-general-form]');
  const id = Number(form?.elements.id?.value || 0);
  if (!list) return;
  if (!id) { list.innerHTML = '<div class="empty-card">Сначала сохраните дело, затем добавляйте события и заметки.</div>'; return; }
  list.innerHTML = '<div class="empty-card">Загрузка плана...</div>';
  try {
    const tasks = await dbApi.getCalendarTasks({ generalCaseId: id, user: getCurrentUserName() });
    const visible = (tasks || []).filter(task => String(task.event_scope || 'work') !== 'personal');
    if (!visible.length) { list.innerHTML = '<div class="empty-card">Связанных событий и заметок пока нет.</div>'; return; }
    list.innerHTML = visible.map(task => `<article class="general-case-plan-item"><div><span>${escapeHtml(formatPlanDate(task))}</span><b>${escapeHtml(task.description || task.desc || 'Событие')}</b><p>${escapeHtml(task.note_text || task.assignment || '')}</p></div><em>${escapeHtml(planTaskLabel(task))}</em></article>`).join('');
  } catch (error) {
    list.innerHTML = `<div class="empty-card error">Не удалось загрузить план: ${escapeHtml(error.message)}</div>`;
  }
}
function formatPlanDate(task = {}) { const date = String(task.date_str || task.date || ''); const end = String(task.end_date || ''); const time = String(task.time_val || task.time || ''); const startText = date ? date.split('-').reverse().join('.') : 'Без даты'; const endText = end && end !== date ? ` — ${end.split('-').reverse().join('.')}` : ''; return `${startText}${endText}${time ? ` · ${time}` : ''}`; }
function planTaskLabel(task = {}) { const type = String(task.task_type || task.type || ''); if (type === 'судебное_заседание') return 'Судебное заседание'; if (type === 'процессуальный_срок' || type === 'поручение') return 'Процессуальный срок'; if (String(task.event_scope || '') === 'note' || type === 'рабочая_заметка') return 'Заметка'; return 'Рабочее событие'; }
function openCasePlanInCalendar() {
  const form = document.querySelector('[data-general-form]');
  const id = Number(form?.elements.id?.value || 0);
  if (!id) { alert('Сначала сохраните карточку дела.'); return; }
  const row = state.rows.find(item => Number(item.id) === id) || collectGeneralCaseFormData(form);
  closeGeneralDialog();
  if (typeof window.openView === 'function') window.openView('calendar');
  setTimeout(() => window.dispatchEvent(new CustomEvent('calendar:create-for-case', { detail: { case: { ...row, id } } })), 180);
}
function readCommentViewState() { try { return JSON.parse(localStorage.getItem(GENERAL_CASE_COMMENTS_VIEWED_KEY) || '{}'); } catch { return {}; } }
function saveCommentViewState(stateObject) { localStorage.setItem(GENERAL_CASE_COMMENTS_VIEWED_KEY, JSON.stringify(stateObject || {})); }
function commentSignature(row = {}) { return String(row.comments || '').trim(); }
function markCommentViewed(row = {}) { if (!row?.id || !commentSignature(row)) return; const map = readCommentViewState(); map[row.id] = { signature: commentSignature(row), viewed_at: getTodayRu() }; saveCommentViewState(map); }
function getCommentBadge(row = {}) { const comment = commentSignature(row); if (!comment) return ''; const map = readCommentViewState(); const viewed = map[row.id]; if (viewed?.signature === comment && viewed?.viewed_at) return `<span class="case-badge comment viewed">Просмотрено ${escapeHtml(viewed.viewed_at)}</span>`; return '<span class="case-badge comment new">Есть комментарий</span>'; }
function applyRuDateMask(input) { const digits = String(input.value || '').replace(/\D/g, '').slice(0, 8); let value = digits; if (digits.length > 4) value = `${digits.slice(0,2)}.${digits.slice(2,4)}.${digits.slice(4)}`; else if (digits.length > 2) value = `${digits.slice(0,2)}.${digits.slice(2)}`; input.value = value; }

function setAppealBlockVisible(visible) { const block = document.querySelector('[data-general-appeal-block]'); const empty = document.querySelector('[data-general-appeal-empty]'); if (block) block.hidden = !visible; if (empty) empty.hidden = Boolean(visible); }
function collectAppealRows() { return Array.from(document.querySelectorAll('[data-general-appeal-row]')).map(row => { const item = getAppealRowData(row); return { ...item, title: item.appeal_kind || 'Апелляция', date: item.event_date || '' }; }).filter(row => row.event_date || row.process_kind || row.act_instance || row.appeal_kind || row.submitted || row.note || row.next_motivated_date); }
function __old_renderAppealRows_2(rows = []) { const container = document.querySelector('[data-general-appeal-rows]'); if (!container) return; const motivated = document.querySelector('[data-general-form]')?.elements.motivated_decision_date?.value?.trim() || ''; const list = Array.isArray(rows) && rows.length ? rows : []; container.innerHTML = list.map(row => renderAppealRow({ process_kind: row.process_kind || row.processKind || 'ГПК', act_instance: row.act_instance || row.actInstance || 'Первая инстанция', appeal_kind: row.appeal_kind || row.appealKind || row.title || 'Апелляция', event_date: row.event_date || row.date || motivated, late_motivated_received: row.late_motivated_received || row.lateMotivatedReceived || 'Нет', submitted: row.submitted || false, note: row.note || '', next_motivated_date: row.next_motivated_date || '' })).join(''); setAppealBlockVisible(Boolean(list.length)); container.querySelectorAll('[data-general-appeal-row]').forEach(renderAppealRowResult); renderAppealSuggestions(); }
function __old_renderAppealRow_2(row = {}) {
  const processKind = row.process_kind || 'ГПК', actInstance = row.act_instance || 'Первая инстанция', appealKind = normalizeAppealKind(row.appeal_kind || 'Апелляция'), eventDate = row.event_date || '', late = row.late_motivated_received || 'Нет', submitted = Boolean(row.submitted), note = row.note || '', nextMotivatedDate = row.next_motivated_date || '';
  return `<div class="general-appeal-row general-appeal-event-row ${submitted ? 'is-submitted' : ''}" data-general-appeal-row>
    <label><span>Вид производства</span><select data-general-appeal-control data-general-appeal-process required>${option('ГПК','Гражданский процесс (ГПК РФ)',processKind)}${option('АПК','Арбитражный процесс (АПК РФ)',processKind)}${option('КАС','Административное судопроизводство (КАС РФ)',processKind)}</select></label>
    <label><span>Инстанция, вынесшая акт</span><select data-general-appeal-control data-general-appeal-instance required>${option('Первая инстанция','Первая инстанция',actInstance)}${option('Апелляционная инстанция','Апелляционная инстанция',actInstance)}${option('Кассационная инстанция','Кассационная инстанция',actInstance)}</select></label>
    <label><span>Вид обжалования</span><select data-general-appeal-control data-general-appeal-kind required>${option('Апелляция','Апелляция',appealKind)}${option('Кассация','Кассация',appealKind)}${option('Кассация в Верховный суд РФ','Кассация в Верховный суд РФ',appealKind)}${option('Жалоба в Конституционный суд РФ','Жалоба в Конституционный суд РФ',appealKind)}</select></label>
    <label><span data-general-appeal-date-label>${appealDateLabel(appealKind)}</span><input data-general-appeal-date data-ru-date value="${escapeAttr(eventDate)}" placeholder="ДД.ММ.ГГГГ" autocomplete="off" inputmode="numeric" maxlength="10"></label>
    <label class="general-appeal-late-field" data-general-appeal-late-wrap ${appealKind === 'Апелляция' ? '' : 'hidden'}><span>Акт получен с нарушением срока изготовления мотивированной части?</span><select data-general-appeal-control data-general-appeal-late>${option('Нет','Нет',late)}${option('Да','Да',late)}</select></label>
    <button class="btn small" data-general-appeal-remove type="button" title="Удалить событие">−</button><div class="general-appeal-event-result" data-general-appeal-row-result></div>
    <div class="general-appeal-submitted-line"><button class="general-appeal-check ${submitted ? 'checked' : ''}" data-general-appeal-submitted type="button">${submitted ? '✓' : ''}</button><span class="general-appeal-submitted-text" ${submitted ? '' : 'hidden'}>Жалоба подана</span></div>
    <div class="general-appeal-after-submit" data-general-appeal-after-submit ${submitted ? '' : 'hidden'}><label><span>Примечание</span><textarea data-general-appeal-note rows="2">${escapeHtml(note)}</textarea></label><label><span>Дата изготовления мотивированной части судебного акта</span><input data-general-appeal-next-date data-ru-date value="${escapeAttr(nextMotivatedDate)}" placeholder="ДД.ММ.ГГГГ" autocomplete="off" inputmode="numeric" maxlength="10"></label></div>
  </div>`;
}
function addAppealRow(row = {}) { setAppealBlockVisible(true); switchGeneralCaseTab('appeal'); const container = document.querySelector('[data-general-appeal-rows]'); if (!container) return; const form = document.querySelector('[data-general-form]'); const motivated = form?.elements.motivated_decision_date?.value?.trim() || ''; const appealAct = form?.elements.appeal_act_date?.value?.trim() || ''; const cassationAct = form?.elements.cassation_act_date?.value?.trim() || ''; const base = { event_date: row.event_date || row.date || motivated, ...row }; const kind = normalizeAppealKind(base.appeal_kind || 'Апелляция'); if (!base.event_date) { if (kind === 'Кассация' && appealAct) base.event_date = appealAct; if (kind === 'Кассация в Верховный суд РФ' && cassationAct) base.event_date = cassationAct; } container.insertAdjacentHTML('beforeend', renderAppealRow(base)); renderAppealRowResult(container.lastElementChild); renderAppealSuggestions(true); }
function removeAppealRow(button) { button.closest('[data-general-appeal-row]')?.remove(); if (!document.querySelector('[data-general-appeal-row]')) setAppealBlockVisible(false); renderAppealSuggestions(); }
function __old_renderAppealRowResult_2(rowNode) {
  if (!rowNode) return;
  const dateLabel = rowNode.querySelector('[data-general-appeal-date-label]'), resultNode = rowNode.querySelector('[data-general-appeal-row-result]'), lateWrap = rowNode.querySelector('[data-general-appeal-late-wrap]'), submitted = rowNode.classList.contains('is-submitted'), check = rowNode.querySelector('[data-general-appeal-submitted]'), submittedText = rowNode.querySelector('.general-appeal-submitted-text'), afterSubmit = rowNode.querySelector('[data-general-appeal-after-submit]'), processKind = rowNode.querySelector('[data-general-appeal-process]')?.value || 'ГПК', appealKind = normalizeAppealKind(rowNode.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция'), late = rowNode.querySelector('[data-general-appeal-late]')?.value || 'Нет';
  if (dateLabel) dateLabel.textContent = appealDateLabel(appealKind); if (lateWrap) lateWrap.hidden = appealKind !== 'Апелляция'; if (check) { check.classList.toggle('checked', submitted); check.textContent = submitted ? '✓' : ''; } if (submittedText) submittedText.hidden = !submitted; if (afterSubmit) afterSubmit.hidden = !submitted; if (!resultNode) return;
  const rowData = getAppealRowData(rowNode), result = calculateAppealDeadlineFromAppealEvent(rowData), explanation = getAppealKindExplanation(processKind, appealKind), lateWarning = appealKind === 'Апелляция' && late === 'Да' ? `<p class="danger">Акт получен с нарушением срока изготовления мотивированной части. Рекомендуется приложить ходатайство о восстановлении срока.</p>` : '';
  if (appealKind === 'Жалоба в Конституционный суд РФ') { resultNode.innerHTML = `<p>${escapeHtml(explanation)}</p><ul><li>Пройдена апелляция.</li><li>Пройдена кассация.</li><li>Пройдена кассация в Верховный суд РФ.</li><li>Проверяется соответствие применённого закона Конституции РФ.</li></ul>`; return; }
  const deadlineText = result?.dateRu ? `<b>Последний день подачи ${escapeHtml(appealKind.toLowerCase())} — ${escapeHtml(result.dateRu)}.</b>` : `<b>Введите дату, чтобы рассчитать срок.</b>`;
  const expired = result?.dateIso && isDeadlineExpired(result.dateIso) ? `<p class="danger">Срок подачи жалобы пропущен. Можно подать заявление о восстановлении процессуального срока.</p>` : '';
  resultNode.innerHTML = `<p>${escapeHtml(explanation)}</p><p>${deadlineText}</p>${result?.rule ? `<p class="muted">${escapeHtml(result.rule)}</p>` : ''}${lateWarning}${expired}`;
}
function __old_getAppealRowData_2(rowNode) { return { process_kind: rowNode.querySelector('[data-general-appeal-process]')?.value || 'ГПК', act_instance: rowNode.querySelector('[data-general-appeal-instance]')?.value || 'Первая инстанция', appeal_kind: normalizeAppealKind(rowNode.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция'), event_date: rowNode.querySelector('[data-general-appeal-date]')?.value?.trim() || '', late_motivated_received: rowNode.querySelector('[data-general-appeal-late]')?.value || 'Нет', submitted: rowNode.classList.contains('is-submitted'), note: rowNode.querySelector('[data-general-appeal-note]')?.value?.trim() || '', next_motivated_date: rowNode.querySelector('[data-general-appeal-next-date]')?.value?.trim() || '' }; }
function renderAppealSuggestions(forcePrompt = false) { const node = document.querySelector('[data-general-appeal-suggestions]'), form = document.querySelector('[data-general-form]'); if (!node || !form) return; try { document.querySelectorAll('[data-general-appeal-row]').forEach(renderAppealRowResult); const data = collectGeneralCaseFormData(form), tasks = buildGeneralCaseAutoTasks({ ...data, id: data.id || 'preview' }, data, { preview: true }); if (!tasks.length) { node.hidden = true; node.innerHTML = ''; return; } node.hidden = false; node.innerHTML = `<h5>Автоматически будут добавлены в план и календарь:</h5>${tasks.map(task => `<div class="general-appeal-suggestion"><b>${formatText(task.dateRu)}</b><span>${formatText(task.desc.replace('[Авто общего перечня] ', ''))}</span></div>`).join('')}`; if (forcePrompt && tasks[0]) alert(`Последний срок подачи жалобы — ${tasks[0].dateRu}.\n\nЭтот срок будет указан в плане и календаре после сохранения дела.`); } catch (error) { console.warn('Ошибка расчета подсказок обжалования', error); node.hidden = true; node.innerHTML = ''; } }
function getAppealSummary(row) { const rows = parseAppeals(row.appeals_json), calculated = []; for (const item of rows) { const result = calculateAppealDeadlineFromAppealEvent(item), submitted = item.submitted ? ' · жалоба подана' : ''; if (item.appeal_kind === 'Жалоба в Конституционный суд РФ') calculated.push('Конституционный суд РФ: срок законом не ограничен' + submitted); else if (result?.dateRu) calculated.push(`${item.appeal_kind || 'Обжалование'}: ${item.event_date || item.date} → срок до ${result.dateRu}${submitted}`); } return calculated.length ? calculated.join('\n') : getAppealValue(row); }
function confirmAppealDeadlinesBeforeSave(data) { const lines = parseAppeals(data.appeals_json).map(item => { const result = calculateAppealDeadlineFromAppealEvent(item); if (item.appeal_kind === 'Жалоба в Конституционный суд РФ') return 'Конституционный суд РФ: срок не рассчитывается.'; return result?.dateRu ? `${item.appeal_kind || 'Обжалование'}: последний срок подачи жалобы — ${result.dateRu}` : ''; }).filter(Boolean); if (lines.length) alert(`${lines.join('\n')}\n\nСроки будут добавлены в план и календарь после сохранения дела.`); }
async function syncGeneralCaseAutoTasks(savedCase, data, previousRow = null) { const allTasks = await dbApi.getCalendarTasks({}).catch(() => []); const existingAutoTasks = allTasks.filter(task => Number(task.general_case_id) === Number(savedCase.id) && String(task.description || task.desc || '').startsWith('[Авто общего перечня]')); for (const task of existingAutoTasks) { try { await dbApi.deleteCalendarTask(task.id); } catch {} } const tasks = buildGeneralCaseAutoTasks(savedCase, data); for (const task of tasks) { try { await dbApi.createCalendarTask({ date: task.dateIso, user: task.user, type: task.type, desc: task.desc, time: '', court: data.court || '', subject: data.claim_subject || '', assignment: task.assignment, general_case_id: savedCase.id }); } catch (error) { console.warn('Не удалось создать автозадачу', error); } } if (tasks.length) showNotification(`Автоматически добавлено задач в план/календарь: ${tasks.length}`); }
function buildGeneralCaseAutoTasks(savedCase, data, { preview = false } = {}) { const tasks = [], user = data.executor || getCurrentUserName() || 'Администратор', caseNo = data.case_no || savedCase.case_no || '', baseAssignment = `Дело № ${caseNo}\nИстец: ${data.plaintiff || ''}\nОтветчик: ${data.defendant || ''}\nПредмет: ${data.claim_subject || ''}${data.claim_address ? '\nАдрес: ' + data.claim_address : ''}`.trim(); for (const item of parseAppeals(data.appeals_json)) { const result = calculateAppealDeadlineFromAppealEvent(item); if (!result?.dateIso) continue; tasks.push({ dateIso: result.dateIso, dateRu: result.dateRu, user, type: 'поручение', desc: `[Авто общего перечня] Последний день подачи ${String(item.appeal_kind || 'жалобы').toLowerCase()} по делу № ${caseNo}`, assignment: `${baseAssignment}\nВид производства: ${item.process_kind || 'ГПК'}\nИнстанция: ${item.act_instance || ''}\nВид обжалования: ${item.appeal_kind || ''}\nДата акта/мотивировки: ${item.event_date || item.date || ''}\nРасчёт: ${result.rule}${item.submitted ? '\nСтатус: жалоба подана' : ''}${item.note ? '\nПримечание: ' + item.note : ''}` }); } return preview ? tasks.slice(0, 6) : tasks; }
function calculateAppealDeadlineFromForm(data = {}) { const firstRow = parseAppeals(data.appeals_json)[0]; return firstRow ? calculateAppealDeadlineFromAppealEvent(firstRow) : null; }
function __old_calculateAppealDeadlineFromAppealEvent_2(item = {}) { const appealKind = normalizeAppealKind(item.appeal_kind || item.title || 'Апелляция'); if (appealKind === 'Жалоба в Конституционный суд РФ') return { dateIso: '', dateRu: '', rule: 'Конституционный суд РФ: срок законом не ограничен' }; const start = ruDateToDate(item.event_date || item.date); if (!start) return null; const processKind = item.process_kind || 'ГПК'; let deadline, rule; if (appealKind === 'Апелляция') { deadline = addMonths(addDays(start, 1), 1); rule = `апелляция: 1 календарный месяц (${processKind}); срок течёт со следующего календарного дня`; } else if (appealKind === 'Кассация') { const months = processKind === 'АПК' ? 2 : (processKind === 'КАС' ? 6 : 3); deadline = addMonths(addDays(start, 1), months); rule = `кассация: ${months} календарн. мес. (${processKind}); срок течёт со следующего календарного дня`; } else if (appealKind === 'Кассация в Верховный суд РФ') { deadline = addMonths(addDays(start, 1), 3); rule = `кассация в Верховный суд РФ: 3 календарных месяца (${processKind}); срок течёт со следующего календарного дня`; } else return null; const adjusted = moveToNextWorkingDay(deadline), moved = adjusted.getTime() !== deadline.getTime(); return { dateIso: dateToIso(adjusted), dateRu: dateToRu(adjusted), rule: `${rule}; последний день переносится только если выпал на выходной/праздник${moved ? '; перенесено на ближайший рабочий день' : ''}` }; }

/* ===== Appeal calculator full specification overrides 2026-06 ===== */
function switchGeneralCaseTab(tab = 'info') {
  const safeTab = ['info', 'documents', 'plan', 'appeal'].includes(tab) ? tab : 'info';
  document.querySelectorAll('[data-general-case-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.generalCaseTab === safeTab));
  document.querySelectorAll('[data-general-case-tab-panel]').forEach(panel => {
    panel.hidden = panel.dataset.generalCaseTabPanel !== safeTab;
    panel.classList.toggle('is-active', panel.dataset.generalCaseTabPanel === safeTab);
  });
  if (safeTab === 'plan') loadCasePlanEntries();
}

function renderAppealRow(row = {}) {
  const processKind = row.process_kind || 'ГПК';
  const actInstance = row.act_instance || 'Первая инстанция';
  const appealKind = normalizeAppealKind(row.appeal_kind || 'Апелляция');
  const actType = row.act_type || 'Итоговое решение';
  const eventDate = row.event_date || row.date || '';
  const late = row.late_motivated_received || 'Нет';
  const supremeCassationExists = row.supreme_cassation_exists || 'Да';
  const isDebtor = row.is_debtor || 'Да';
  const interimType = row.interim_type || '';
  const submitted = Boolean(row.submitted);
  const note = row.note || '';
  return `<div class="general-appeal-row general-appeal-event-row ${submitted ? 'is-submitted' : ''}" data-general-appeal-row>
    <label><span>Вид производства</span><select data-general-appeal-control data-general-appeal-process required>${option('ГПК','Гражданский процесс (ГПК РФ)',processKind)}${option('АПК','Арбитражный процесс (АПК РФ)',processKind)}${option('КАС','Административное судопроизводство (КАС РФ)',processKind)}${option('УПК','Уголовный процесс (УПК РФ)',processKind)}</select></label>
    <label><span>Инстанция, вынесшая акт</span><select data-general-appeal-control data-general-appeal-instance required>${option('Первая инстанция','Первая инстанция',actInstance)}${option('Апелляционная инстанция','Апелляционная инстанция',actInstance)}${option('Кассационная инстанция','Кассационная инстанция',actInstance)}</select></label>
    <label><span>Вид обжалования</span><select data-general-appeal-control data-general-appeal-kind required>${option('Апелляция','Апелляция',appealKind)}${option('Кассация','Кассация',appealKind)}${option('Кассация в Верховный суд РФ','Кассация (ВС РФ)',appealKind)}${option('Жалоба в Конституционный суд РФ','Конституционный суд РФ',appealKind)}</select></label>
    <label data-general-act-type-wrap><span>Тип судебного акта</span><select data-general-appeal-control data-general-appeal-act-type>${option('Итоговое решение','Итоговое решение',actType)}${option('Судебный приказ','Судебный приказ',actType)}${option('Заочное решение','Заочное решение',actType)}${option('Определение (промежуточное)','Определение (промежуточное)',actType)}</select></label>
    <label class="general-appeal-late-field" data-general-appeal-late-wrap><span>Акт получен с нарушением срока изготовления мотивированной части?</span><select data-general-appeal-control data-general-appeal-late>${option('Нет','Нет',late)}${option('Да','Да',late)}</select></label>
    <label data-general-supreme-cassation-wrap ${appealKind === 'Кассация в Верховный суд РФ' ? '' : 'hidden'}><span>Было ли вынесено определение кассационного суда?</span><select data-general-appeal-control data-general-supreme-cassation>${option('Да','Да',supremeCassationExists)}${option('Нет','Нет',supremeCassationExists)}</select></label>
    <label data-general-debtor-wrap ${actType === 'Судебный приказ' ? '' : 'hidden'}><span>Вы являетесь должником?</span><select data-general-appeal-control data-general-is-debtor>${option('Да','Да',isDebtor)}${option('Нет','Нет',isDebtor)}</select></label>
    <label data-general-interim-type-wrap><span>Вид определения</span><select data-general-appeal-control data-general-interim-type>${option('','Не выбрано',interimType)}${option('Определение о возвращении искового заявления','Определение о возвращении искового заявления',interimType)}${option('Определение об отказе в принятии искового заявления','Определение об отказе в принятии искового заявления',interimType)}${option('Определение об оставлении искового заявления без движения','Определение об оставлении искового заявления без движения',interimType)}${option('Определение об отказе в обеспечении иска','Определение об отказе в обеспечении иска',interimType)}${option('Определение о приостановлении производства по делу','Определение о приостановлении производства по делу',interimType)}${option('Определение о прекращении производства по делу','Определение о прекращении производства по делу',interimType)}${option('Определение о передаче дела по подсудности','Определение о передаче дела по подсудности',interimType)}${option('Определение о наложении судебного штрафа','Определение о наложении судебного штрафа',interimType)}${option('Определение об отказе в утверждении мирового соглашения','Определение об отказе в утверждении мирового соглашения',interimType)}${option('Определения по делам о банкротстве','Определения по делам о банкротстве',interimType)}</select></label>
    <label><span data-general-appeal-date-label>${appealDateLabelFull(appealKind, actType)}</span><input data-general-appeal-date data-ru-date value="${escapeAttr(eventDate)}" placeholder="ДД.ММ.ГГГГ" autocomplete="off" inputmode="numeric" maxlength="10"></label>
    <button class="btn small" data-general-appeal-remove type="button" title="Удалить событие">−</button>
    <div class="general-appeal-event-result" data-general-appeal-row-result></div>
    <div class="general-appeal-actions"><button class="btn small primary" data-general-calc-row type="button">Рассчитать срок</button><button class="btn small" data-general-print-row type="button">Распечатать результат</button><button class="btn small" data-general-restore-template type="button">Сформировать заявление о восстановлении срока</button></div>
    <div class="general-appeal-submitted-line"><button class="general-appeal-check ${submitted ? 'checked' : ''}" data-general-appeal-submitted type="button">${submitted ? '✓' : ''}</button><span class="general-appeal-submitted-text" ${submitted ? '' : 'hidden'}>Жалоба подана</span></div>
    <div class="general-appeal-after-submit" data-general-appeal-after-submit ${submitted ? '' : 'hidden'}><label><span>Примечание</span><textarea data-general-appeal-note rows="2">${escapeHtml(note)}</textarea></label></div>
  </div>`;
}

function appealDateLabelFull(appealKind, actType) {
  if (actType === 'Судебный приказ') return 'Дата получения копии судебного приказа';
  if (actType === 'Заочное решение') return 'Дата вручения копии заочного решения';
  return appealDateLabel(appealKind);
}

function getAppealRowData(rowNode) {
  return {
    process_kind: rowNode.querySelector('[data-general-appeal-process]')?.value || 'ГПК',
    act_instance: rowNode.querySelector('[data-general-appeal-instance]')?.value || 'Первая инстанция',
    appeal_kind: normalizeAppealKind(rowNode.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция'),
    act_type: rowNode.querySelector('[data-general-appeal-act-type]')?.value || 'Итоговое решение',
    event_date: rowNode.querySelector('[data-general-appeal-date]')?.value?.trim() || '',
    late_motivated_received: rowNode.querySelector('[data-general-appeal-late]')?.value || 'Нет',
    supreme_cassation_exists: rowNode.querySelector('[data-general-supreme-cassation]')?.value || 'Да',
    is_debtor: rowNode.querySelector('[data-general-is-debtor]')?.value || 'Да',
    interim_type: rowNode.querySelector('[data-general-interim-type]')?.value || '',
    submitted: rowNode.classList.contains('is-submitted'),
    note: rowNode.querySelector('[data-general-appeal-note]')?.value?.trim() || '',
    title: rowNode.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция',
    date: rowNode.querySelector('[data-general-appeal-date]')?.value?.trim() || ''
  };
}

function renderAppealRowResult(rowNode) {
  if (!rowNode) return;
  const data = getAppealRowData(rowNode);
  const resultNode = rowNode.querySelector('[data-general-appeal-row-result]');
  const kind = data.appeal_kind;
  const actType = data.act_type;
  const setHidden = (sel, hidden) => { const el = rowNode.querySelector(sel); if (el) el.hidden = hidden; };
  setHidden('[data-general-act-type-wrap]', data.act_instance !== 'Первая инстанция');
  setHidden('[data-general-appeal-late-wrap]', kind !== 'Апелляция');
  setHidden('[data-general-supreme-cassation-wrap]', kind !== 'Кассация в Верховный суд РФ');
  setHidden('[data-general-debtor-wrap]', actType !== 'Судебный приказ');
  setHidden('[data-general-interim-type-wrap]', actType !== 'Определение (промежуточное)');
  const dateLabel = rowNode.querySelector('[data-general-appeal-date-label]');
  if (dateLabel) dateLabel.textContent = appealDateLabelFull(kind, actType);
  const check = rowNode.querySelector('[data-general-appeal-submitted]');
  const submittedText = rowNode.querySelector('.general-appeal-submitted-text');
  const afterSubmit = rowNode.querySelector('[data-general-appeal-after-submit]');
  if (check) { check.classList.toggle('checked', data.submitted); check.textContent = data.submitted ? '✓' : ''; }
  if (submittedText) submittedText.hidden = !data.submitted;
  if (afterSubmit) afterSubmit.hidden = !data.submitted;
  if (!resultNode) return;
  const result = calculateAppealDeadlineFromAppealEvent(data);
  const lines = [];
  const warnings = [];
  if (kind === 'Апелляция' && data.late_motivated_received === 'Да') warnings.push('Акт получен с нарушением срока изготовления мотивированной части. Срок может быть восстановлен судом при наличии уважительных причин. Рекомендуется приложить ходатайство о восстановлении срока.');
  if (kind === 'Кассация в Верховный суд РФ' && data.supreme_cassation_exists === 'Нет') warnings.push('Для обращения в Верховный суд РФ необходимо сначала получить определение кассационного суда общей юрисдикции или арбитражного суда округа.');
  if (kind === 'Жалоба в Конституционный суд РФ') {
    resultNode.innerHTML = `<p>${escapeHtml(getAppealKindExplanation(data.process_kind, kind))}</p><ul><li>Пройдена ли апелляция?</li><li>Пройдена ли кассация в суд общей юрисдикции или арбитражный суд округа?</li><li>Пройдена ли кассация в Верховный суд РФ?</li><li>Обжалуется ли конституционность закона, а не фактические обстоятельства дела?</li></ul>`;
    return;
  }
  if (result?.dateRu) {
    const expired = result.dateIso && isDeadlineExpired(result.dateIso);
    lines.push(`<b>Вид производства:</b> ${escapeHtml(data.process_kind)}`);
    lines.push(`<b>Вид обжалования:</b> ${escapeHtml(kind)}`);
    lines.push(`<b>${escapeHtml(appealDateLabelFull(kind, actType))}:</b> ${escapeHtml(data.event_date)}`);
    lines.push(`<b>Начало срока:</b> ${escapeHtml(result.startRu || '')}`);
    lines.push(`<b>Срок подачи:</b> ${escapeHtml(result.period || '')}`);
    lines.push(`<b>Последний день подачи:</b> ${escapeHtml(result.dateRu)}`);
    lines.push(`<span class="muted">${escapeHtml(result.explanation || result.rule || '')}</span>`);
    if (expired) warnings.push('Срок подачи жалобы пропущен. Вы можете подать заявление о восстановлении процессуального срока в суд, вынесший обжалуемый акт, при наличии уважительных причин. Предельный срок для подачи заявления о восстановлении — 6 месяцев со дня вступления акта в законную силу.');
  } else {
    lines.push('<b>Введите дату, чтобы рассчитать срок.</b>');
  }
  resultNode.innerHTML = `<div class="general-appeal-result-structured">${lines.map(x => `<p>${x}</p>`).join('')}${warnings.map(w => `<p class="danger">${escapeHtml(w)}</p>`).join('')}</div>`;
}

function calculateAppealDeadlineFromAppealEvent(item = {}) {
  const appealKind = normalizeAppealKind(item.appeal_kind || item.title || 'Апелляция');
  if (appealKind === 'Жалоба в Конституционный суд РФ') return { dateIso: '', dateRu: '', rule: 'Конституционный суд РФ: срок законом прямо не рассчитывается' };
  const start = ruDateToDate(item.event_date || item.date);
  if (!start) return null;
  const processKind = item.process_kind || 'ГПК';
  const actType = item.act_type || 'Итоговое решение';
  const startDate = addDays(start, 1);
  let deadline, period, explanation;
  if (actType === 'Судебный приказ') {
    const days = processKind === 'КАС' ? 20 : 10;
    deadline = addDays(startDate, days - 1);
    period = `${days} дней`;
    explanation = `Возражения относительно исполнения судебного приказа: ${days} дней со дня получения копии. Если срок пропущен, подайте ходатайство о восстановлении срока.`;
  } else if (actType === 'Заочное решение') {
    deadline = addDays(startDate, 6);
    period = '7 дней для заявления об отмене ответчиком; далее апелляция — 1 месяц';
    explanation = 'По заочному решению: заявление об отмене может быть подано в течение 7 дней со дня вручения копии; апелляционное обжалование возможно после истечения этого срока либо после отказа в отмене.';
  } else if (actType === 'Определение (промежуточное)') {
    deadline = addDays(startDate, 14);
    period = '15 дней';
    explanation = `Частная жалоба на промежуточное определение: 15 дней. Вид определения: ${item.interim_type || 'не выбран'}.`;
  } else if (appealKind === 'Апелляция') {
    deadline = addMonths(startDate, 1);
    period = '1 месяц';
    explanation = `${courtExplanation(processKind, appealKind)} Срок течёт со следующего календарного дня.`;
  } else if (appealKind === 'Кассация') {
    const months = processKind === 'АПК' ? 2 : (processKind === 'КАС' ? 6 : (processKind === 'УПК' ? 6 : 3));
    deadline = addMonths(startDate, months);
    period = `${months} мес.`;
    explanation = `${courtExplanation(processKind, appealKind)} Срок течёт со следующего календарного дня.`;
  } else if (appealKind === 'Кассация в Верховный суд РФ') {
    deadline = addMonths(startDate, 3);
    period = '3 мес.';
    explanation = `${courtExplanation(processKind, appealKind)} Срок течёт со следующего календарного дня.`;
  } else return null;
  const rawIso = dateToIso(deadline);
  const adjusted = processKind === 'УПК' ? deadline : moveToNextWorkingDay(deadline);
  const moved = adjusted.getTime() !== deadline.getTime();
  const weekendWarning = processKind === 'УПК' && isWeekend(deadline) ? ' Для уголовного процесса перенос выходного дня не применён автоматически — проверьте порядок подачи.' : '';
  return { dateIso: dateToIso(adjusted), dateRu: dateToRu(adjusted), startRu: dateToRu(startDate), period, rule: explanation, explanation: `${explanation}${moved ? ' Последний день перенесён на ближайший рабочий день.' : ''}${weekendWarning}`, rawIso };
}
function courtExplanation(processKind, appealKind) {
  if (appealKind === 'Апелляция') {
    if (processKind === 'АПК') return 'Апелляционная жалоба подаётся в арбитражный апелляционный суд.';
    if (processKind === 'КАС') return 'Апелляционная жалоба подаётся в апелляционный суд общей юрисдикции.';
    if (processKind === 'УПК') return 'Апелляционная жалоба по уголовному делу подаётся через суд, постановивший приговор или иное решение.';
    return 'Апелляционная жалоба подаётся через суд первой инстанции в вышестоящий суд, в том числе по ст. 321 ГПК РФ.';
  }
  if (appealKind === 'Кассация в Верховный суд РФ') return 'Жалоба подаётся в Верховный Суд РФ после прохождения кассационного суда.';
  return processKind === 'АПК' ? 'Кассационная жалоба подаётся в арбитражный суд округа.' : 'Кассационная жалоба подаётся в кассационный суд общей юрисдикции.';
}
function isWeekend(date) { const day = date.getDay(); return day === 0 || day === 6; }

function handleGeneralAppealActionClick(event) {
  const calc = event.target.closest('[data-general-calc-row]');
  if (calc) {
    event.preventDefault();
    event.stopPropagation();
    renderAppealRowResult(calc.closest('[data-general-appeal-row]'));
    renderAppealSuggestions(true);
    return true;
  }

  const print = event.target.closest('[data-general-print-row]');
  if (print) {
    event.preventDefault();
    event.stopPropagation();
    printAppealRowResult(print.closest('[data-general-appeal-row]'));
    return true;
  }

  const restore = event.target.closest('[data-general-restore-template]');
  if (restore) {
    event.preventDefault();
    event.stopPropagation();
    showRestoreDeadlineTemplate(restore.closest('[data-general-appeal-row]'));
    return true;
  }

  return false;
}

function printAppealRowResult(row) {
  renderAppealRowResult(row);
  const html = row?.querySelector('[data-general-appeal-row-result]')?.innerHTML || 'Нет результата для печати';
  const win = window.open('', '_blank');
  if (!win) {
    alert('Окно печати заблокировано. Разрешите всплывающие окна и повторите печать.');
    return;
  }

  win.document.write(`<html><head><title>Расчёт срока</title><style>body{font-family:Arial,sans-serif;padding:24px;line-height:1.5}.danger{color:#b91c1c}.muted{color:#64748b}</style></head><body><h2>Расчёт срока обжалования</h2>${html}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function showRestoreDeadlineTemplate(row) {
  const data = getAppealRowData(row);
  const result = calculateAppealDeadlineFromAppealEvent(data);
  alert(`Заявление о восстановлении срока\n\nПрошу восстановить процессуальный срок по делу.\nВид обжалования: ${data.appeal_kind}.\nДата судебного акта/получения: ${data.event_date || 'не указана'}.\nПоследний день подачи: ${result?.dateRu || 'не рассчитан'}.\n\nУкажите уважительные причины пропуска и приложите подтверждающие документы.`);
}

/* ===== USER REQUEST FIX: simplified appeal calculator fields, 2026-06-06 ===== */



/* ===== User requested fixes: calendar source opening, appeal field visibility, calendar title, comment markers ===== */
function makeGeneralCaseCalendarDeadlineDescription(savedCase = {}, data = {}) {
  const caseNumber = String(data.court_no || savedCase.court_no || data.case_no || savedCase.case_no || '').trim();
  const plaintiff = String(data.plaintiff || savedCase.plaintiff || '').trim();
  const subject = String(data.claim_subject || savedCase.claim_subject || '').trim();
  const parts = [caseNumber ? `по делу № ${caseNumber}` : 'по делу №', plaintiff, subject].filter(Boolean);
  return `Последний день подачи жалобы ${parts.join(', ')}`;
}

function isGeneralAutoCalendarTask(task = {}) {
  const desc = String(task.description || task.desc || '');
  const assignment = String(task.assignment || '');
  return desc.startsWith('[Авто общего перечня]')
    || desc.startsWith('Последний день подачи жалобы по делу №')
    || assignment.includes('[Авто общего перечня]');
}

syncGeneralCaseAutoTasks = async function(savedCase, data, previousRow = null) {
  const allTasks = await dbApi.getCalendarTasks({}).catch(() => []);
  const existingAutoTasks = allTasks.filter(task =>
    Number(task.general_case_id) === Number(savedCase.id) && isGeneralAutoCalendarTask(task)
  );

  for (const task of existingAutoTasks) {
    try { await dbApi.deleteCalendarTask(task.id); } catch {}
  }

  const tasks = buildGeneralCaseAutoTasks(savedCase, data);
  for (const task of tasks) {
    try {
      await dbApi.createCalendarTask({
        date: task.dateIso,
        user: task.user,
        type: task.type,
        desc: task.desc,
        time: '',
        court: data.court || savedCase.court || '',
        subject: data.claim_subject || savedCase.claim_subject || '',
        assignment: task.assignment,
        general_case_id: savedCase.id
      });
    } catch (error) {
      console.warn('Не удалось создать автозадачу', error);
    }
  }

  if (tasks.length) showNotification(`Автоматически добавлено задач в план/календарь: ${tasks.length}`);
};

buildGeneralCaseAutoTasks = function(savedCase, data, { preview = false } = {}) {
  const tasks = [];
  const user = data.executor || getCurrentUserName() || 'Администратор';
  const caseNo = data.case_no || savedCase.case_no || '';
  const courtNo = data.court_no || savedCase.court_no || '';
  const plaintiff = data.plaintiff || savedCase.plaintiff || '';
  const defendant = data.defendant || savedCase.defendant || '';
  const claimSubject = data.claim_subject || savedCase.claim_subject || '';
  const baseAssignment = `[Авто общего перечня]\nДело № ${caseNo}\n№ дела в суде: ${courtNo}\nИстец: ${plaintiff}\nОтветчик: ${defendant}\nПредмет: ${claimSubject}${data.claim_address || savedCase.claim_address ? '\nАдрес: ' + (data.claim_address || savedCase.claim_address || '') : ''}`.trim();
  const desc = makeGeneralCaseCalendarDeadlineDescription(savedCase, data);

  for (const item of parseAppeals(data.appeals_json)) {
    const result = calculateAppealDeadlineFromAppealEvent(item);
    if (!result?.dateIso) continue;
    tasks.push({
      dateIso: result.dateIso,
      dateRu: result.dateRu,
      user,
      type: 'поручение',
      desc,
      assignment: `${baseAssignment}\nВид производства: ${item.process_kind || 'ГПК'}\nИнстанция: ${item.act_instance || ''}\nВид обжалования: ${item.appeal_kind || ''}\nДата акта/мотивировки: ${item.event_date || item.date || ''}\nРасчёт: ${result.rule || result.explanation || ''}${item.submitted ? '\nСтатус: жалоба подана' : ''}${item.note ? '\nПримечание: ' + item.note : ''}`
    });
  }

  return preview ? tasks.slice(0, 6) : tasks;
};

renderAppealRow = function(row = {}) {
  const processKind = row.process_kind || 'ГПК';
  const actInstance = row.act_instance || 'Первая инстанция';
  const appealKind = normalizeAppealKind(row.appeal_kind || 'Апелляция');
  const actType = row.act_type || 'Итоговое решение';
  const eventDate = row.event_date || row.date || '';
  const late = row.late_motivated_received || 'Нет';
  const supremeCassationExists = row.supreme_cassation_exists || 'Да';
  const isDebtor = row.is_debtor || 'Да';
  const interimType = row.interim_type || '';
  const submitted = Boolean(row.submitted);
  const note = row.note || '';
  return `<div class="general-appeal-row general-appeal-event-row ${submitted ? 'is-submitted' : ''}" data-general-appeal-row>
    <label><span>Вид производства</span><select data-general-appeal-control data-general-appeal-process required>${option('ГПК','Гражданский процесс (ГПК РФ)',processKind)}${option('АПК','Арбитражный процесс (АПК РФ)',processKind)}${option('КАС','Административное судопроизводство (КАС РФ)',processKind)}${option('УПК','Уголовный процесс (УПК РФ)',processKind)}</select></label>
    <label><span>Инстанция, вынесшая акт</span><select data-general-appeal-control data-general-appeal-instance required>${option('Первая инстанция','Первая инстанция',actInstance)}${option('Апелляционная инстанция','Апелляционная инстанция',actInstance)}${option('Кассационная инстанция','Кассационная инстанция',actInstance)}</select></label>
    <label><span>Вид обжалования</span><select data-general-appeal-control data-general-appeal-kind required>${option('Апелляция','Апелляция',appealKind)}${option('Кассация','Кассация',appealKind)}${option('Кассация в Верховный суд РФ','Кассация (ВС РФ)',appealKind)}${option('Жалоба в Конституционный суд РФ','Конституционный суд РФ',appealKind)}</select></label>
    <label data-general-act-type-wrap><span>Тип судебного акта</span><select data-general-appeal-control data-general-appeal-act-type>${option('Итоговое решение','Итоговое решение',actType)}${option('Судебный приказ','Судебный приказ',actType)}${option('Заочное решение','Заочное решение',actType)}${option('Определение (промежуточное)','Определение (промежуточное)',actType)}</select></label>
    <label class="general-appeal-late-field" data-general-appeal-late-wrap ${appealKind === 'Апелляция' ? '' : 'hidden'}><span>Акт получен с нарушением срока изготовления мотивированной части?</span><select data-general-appeal-control data-general-appeal-late>${option('Нет','Нет',late)}${option('Да','Да',late)}</select></label>
    <label data-general-supreme-cassation-wrap ${appealKind === 'Кассация в Верховный суд РФ' ? '' : 'hidden'}><span>Было ли вынесено определение кассационного суда?</span><select data-general-appeal-control data-general-supreme-cassation>${option('Да','Да',supremeCassationExists)}${option('Нет','Нет',supremeCassationExists)}</select></label>
    <label data-general-debtor-wrap ${actType === 'Судебный приказ' ? '' : 'hidden'}><span>Вы являетесь должником?</span><select data-general-appeal-control data-general-is-debtor>${option('Да','Да',isDebtor)}${option('Нет','Нет',isDebtor)}</select></label>
    <label data-general-interim-type-wrap ${actType === 'Определение (промежуточное)' ? '' : 'hidden'}><span>Вид определения</span><select data-general-appeal-control data-general-interim-type>${option('','Не выбрано',interimType)}${option('Определение о возвращении искового заявления','Определение о возвращении искового заявления',interimType)}${option('Определение об отказе в принятии искового заявления','Определение об отказе в принятии искового заявления',interimType)}${option('Определение об оставлении искового заявления без движения','Определение об оставлении искового заявления без движения',interimType)}${option('Определение об отказе в обеспечении иска','Определение об отказе в обеспечении иска',interimType)}${option('Определение о приостановлении производства по делу','Определение о приостановлении производства по делу',interimType)}${option('Определение о прекращении производства по делу','Определение о прекращении производства по делу',interimType)}${option('Определение о передаче дела по подсудности','Определение о передаче дела по подсудности',interimType)}${option('Определение о наложении судебного штрафа','Определение о наложении судебного штрафа',interimType)}${option('Определение об отказе в утверждении мирового соглашения','Определение об отказе в утверждении мирового соглашения',interimType)}</select></label>
    <label><span data-general-appeal-date-label>${appealDateLabelFull(appealKind, actType)}</span><input data-general-appeal-date data-ru-date value="${escapeAttr(eventDate)}" placeholder="ДД.ММ.ГГГГ" autocomplete="off" inputmode="numeric" maxlength="10"></label>
    <button class="btn small" data-general-appeal-remove type="button" title="Удалить событие">−</button>
    <div class="general-appeal-event-result" data-general-appeal-row-result></div>
    <div class="general-appeal-actions"><button class="btn small primary" data-general-calc-row type="button">Рассчитать срок</button><button class="btn small" data-general-print-row type="button">Распечатать результат</button><button class="btn small" data-general-restore-template type="button">Сформировать заявление о восстановлении срока</button></div>
    <div class="general-appeal-submitted-line"><button class="general-appeal-check ${submitted ? 'checked' : ''}" data-general-appeal-submitted type="button">${submitted ? '✓' : ''}</button><span class="general-appeal-submitted-text" ${submitted ? '' : 'hidden'}>Жалоба подана</span></div>
    <div class="general-appeal-after-submit" data-general-appeal-after-submit ${submitted ? '' : 'hidden'}><label><span>Примечание</span><textarea data-general-appeal-note rows="2">${escapeHtml(note)}</textarea></label></div>
  </div>`;
};

renderAppealRowResult = function(rowNode) {
  if (!rowNode) return;
  const data = getAppealRowData(rowNode);
  const resultNode = rowNode.querySelector('[data-general-appeal-row-result]');
  const kind = normalizeAppealKind(data.appeal_kind);
  const actType = data.act_type;
  const setHidden = (sel, hidden) => {
    const el = rowNode.querySelector(sel);
    if (el) {
      el.hidden = Boolean(hidden);
      el.style.display = hidden ? 'none' : '';
    }
  };

  setHidden('[data-general-act-type-wrap]', data.act_instance !== 'Первая инстанция');
  setHidden('[data-general-appeal-late-wrap]', kind !== 'Апелляция');
  setHidden('[data-general-supreme-cassation-wrap]', kind !== 'Кассация в Верховный суд РФ');
  setHidden('[data-general-debtor-wrap]', actType !== 'Судебный приказ');
  setHidden('[data-general-interim-type-wrap]', actType !== 'Определение (промежуточное)');

  const dateLabel = rowNode.querySelector('[data-general-appeal-date-label]');
  if (dateLabel) dateLabel.textContent = appealDateLabelFull(kind, actType);

  const check = rowNode.querySelector('[data-general-appeal-submitted]');
  const submittedText = rowNode.querySelector('.general-appeal-submitted-text');
  const afterSubmit = rowNode.querySelector('[data-general-appeal-after-submit]');
  if (check) { check.classList.toggle('checked', data.submitted); check.textContent = data.submitted ? '✓' : ''; }
  if (submittedText) submittedText.hidden = !data.submitted;
  if (afterSubmit) afterSubmit.hidden = !data.submitted;
  if (!resultNode) return;

  const result = calculateAppealDeadlineFromAppealEvent({ ...data, appeal_kind: kind });
  const lines = [];
  const warnings = [];
  if (kind === 'Апелляция' && data.late_motivated_received === 'Да') warnings.push('Акт получен с нарушением срока изготовления мотивированной части. Срок может быть восстановлен судом при наличии уважительных причин. Рекомендуется приложить ходатайство о восстановлении срока.');
  if (kind === 'Кассация в Верховный суд РФ' && data.supreme_cassation_exists === 'Нет') warnings.push('Для обращения в Верховный Суд РФ необходимо сначала получить определение кассационного суда общей юрисдикции или арбитражного суда округа.');
  if (kind === 'Жалоба в Конституционный суд РФ') {
    resultNode.innerHTML = `<p>${escapeHtml(getAppealKindExplanation(data.process_kind, kind))}</p><ul><li>Пройдена ли апелляция?</li><li>Пройдена ли кассация в суд общей юрисдикции или арбитражный суд округа?</li><li>Пройдена ли кассация в Верховный Суд РФ?</li><li>Обжалуется ли конституционность закона, а не фактические обстоятельства дела?</li></ul>`;
    return;
  }
  if (result?.dateRu) {
    const expired = result.dateIso && isDeadlineExpired(result.dateIso);
    lines.push(`<b>Вид производства:</b> ${escapeHtml(data.process_kind)}`);
    lines.push(`<b>Вид обжалования:</b> ${escapeHtml(kind)}`);
    lines.push(`<b>${escapeHtml(appealDateLabelFull(kind, actType))}:</b> ${escapeHtml(data.event_date)}`);
    lines.push(`<b>Начало срока:</b> ${escapeHtml(result.startRu || '')}`);
    lines.push(`<b>Срок подачи:</b> ${escapeHtml(result.period || '')}`);
    lines.push(`<b>Последний день подачи:</b> ${escapeHtml(result.dateRu)}`);
    lines.push(`<span class="muted">${escapeHtml(result.explanation || result.rule || '')}</span>`);
    if (expired) warnings.push('Срок подачи жалобы пропущен. Можно подать заявление о восстановлении процессуального срока при наличии уважительных причин.');
  } else {
    lines.push('<b>Введите дату, чтобы рассчитать срок.</b>');
  }
  resultNode.innerHTML = `<div class="general-appeal-result-structured">${lines.map(x => `<p>${x}</p>`).join('')}${warnings.map(w => `<p class="danger">${escapeHtml(w)}</p>`).join('')}</div>`;
};

markCommentViewed = function(row = {}) {
  if (!row?.id || !commentSignature(row)) return;
  const map = readCommentViewState();
  map[row.id] = { signature: commentSignature(row), viewed_at: getTodayRu() };
  saveCommentViewState(map);
  setTimeout(() => {
    try { renderCards(); } catch {}
  }, 0);
};

getCommentBadge = function(row = {}) {
  const comment = commentSignature(row);
  if (!comment) return '';
  const map = readCommentViewState();
  const viewed = map[row.id];
  const title = escapeAttr(comment.length > 180 ? `${comment.slice(0, 180)}…` : comment);
  if (viewed?.signature === comment && viewed?.viewed_at) {
    return `<span class="case-badge comment viewed" title="${title}">💬 Комментарий просмотрен</span>`;
  }
  return `<span class="case-badge comment new" title="${title}">💬 Новый комментарий</span>`;
};

if (!window.__generalCasesExternalOpenInstalled) {
  window.__generalCasesExternalOpenInstalled = true;
  window.addEventListener('general-cases:open-case', async event => {
    const id = Number(event.detail?.id || event.detail?.general_case_id || 0);
    const sourceView = event.detail?.sourceView || event.detail?.returnView || '';
    if (!id) return;
    try {
      state.archived = false;
      syncArchiveToggleButton();
      await loadGeneralCases();
      await openGeneralCaseById(id, null, { sourceView });
    } catch (error) {
      console.error('Не удалось открыть дело из календаря:', error);
      showNotification('Не удалось открыть связанное дело из общего перечня', 'error');
    }
  });
}

/* ===== User request: dependent calendar tasks recalc after hearing date change, 2026-06 ===== */
function normalizeGeneralAutoTaskText(value = '') {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function isGeneralHearingEventRow(item = {}) {
  const text = normalizeGeneralAutoTaskText([
    item.title,
    item.appeal_kind,
    item.act_type,
    item.note,
    item.description,
  ].filter(Boolean).join(' '));
  return text.includes('заседан') || text.includes('слушан') || text.includes('предварит');
}

function getGeneralHearingEventRows(source = {}) {
  return parseAppeals(source?.appeals_json)
    .filter(item => isGeneralHearingEventRow(item))
    .map(item => ({ ...item, date: item.event_date || item.date || '' }))
    .filter(item => isValidRuDate(item.date));
}

function getGeneralHearingEventDateLabels(source = {}) {
  return getGeneralHearingEventRows(source).map(item => item.date).filter(Boolean);
}

function getGeneralHearingTaskOffset(desc = '', fallback = 5) {
  const text = normalizeGeneralAutoTaskText(desc);
  if (text.includes('егрюл') || text.includes('выписк')) return 3;
  if (text.includes('отзыв')) return 5;
  const match = text.match(/минус\s+(\d+)\s*д/);
  return match ? Number(match[1]) : fallback;
}

function calculateGeneralDependentTaskDate(hearingDateRu, offsetDays) {
  const hearing = ruDateToDate(hearingDateRu);
  if (!hearing) return null;
  return subtractCalendarDaysWithWeekendShift(hearing, offsetDays);
}

function makeGeneralCaseAutoTaskBase(savedCase = {}, data = {}) {
  const caseNo = data.case_no || savedCase.case_no || '';
  const courtNo = data.court_no || savedCase.court_no || '';
  const plaintiff = data.plaintiff || savedCase.plaintiff || '';
  const defendant = data.defendant || savedCase.defendant || '';
  const claimSubject = data.claim_subject || savedCase.claim_subject || '';
  return `[Авто общего перечня]\nДело № ${caseNo}\n№ дела в суде: ${courtNo}\nИстец: ${plaintiff}\nОтветчик: ${defendant}\nПредмет: ${claimSubject}${data.claim_address || savedCase.claim_address ? '\nАдрес: ' + (data.claim_address || savedCase.claim_address || '') : ''}`.trim();
}

buildGeneralCaseAutoTasks = function(savedCase, data, { preview = false } = {}) {
  const tasks = [];
  const user = data.executor || getCurrentUserName() || 'Администратор';
  const caseNo = data.case_no || savedCase.case_no || '';
  const baseAssignment = makeGeneralCaseAutoTaskBase(savedCase, data);
  const appealDesc = makeGeneralCaseCalendarDeadlineDescription(savedCase, data);

  for (const item of parseAppeals(data.appeals_json)) {
    if (isGeneralHearingEventRow(item)) continue;
    const result = calculateAppealDeadlineFromAppealEvent(item);
    if (!result?.dateIso) continue;
    tasks.push({
      dateIso: result.dateIso,
      dateRu: result.dateRu,
      user,
      type: 'поручение',
      desc: appealDesc,
      assignment: `${baseAssignment}\nВид производства: ${item.process_kind || 'ГПК'}\nИнстанция: ${item.act_instance || ''}\nВид обжалования: ${item.appeal_kind || ''}\nДата акта/мотивировки: ${item.event_date || item.date || ''}\nРасчёт: ${result.rule || result.explanation || ''}${item.submitted ? '\nСтатус: жалоба подана' : ''}${item.note ? '\nПримечание: ' + item.note : ''}`
    });
  }

  for (const hearing of getGeneralHearingEventRows(data)) {
    const prepOffset = 5;
    const egrulOffset = 3;
    const prepDate = calculateGeneralDependentTaskDate(hearing.date, prepOffset);
    const egrulDate = calculateGeneralDependentTaskDate(hearing.date, egrulOffset);

    if (prepDate) {
      tasks.push({
        dateIso: dateToIso(prepDate),
        dateRu: dateToRu(prepDate),
        user,
        type: 'поручение',
        desc: `[Авто общего перечня] Подготовить отзыв по делу № ${caseNo}`,
        assignment: `${baseAssignment}\nЗаседание: ${hearing.date}\nРасчёт: минус ${prepOffset} дн.; если дата выпала на выходной, перенос на ближайший рабочий день.`
      });
    }

    if (egrulDate) {
      tasks.push({
        dateIso: dateToIso(egrulDate),
        dateRu: dateToRu(egrulDate),
        user,
        type: 'поручение',
        desc: `[Авто общего перечня] Запросить выписку из ЕГРЮЛ по делу № ${caseNo}`,
        assignment: `${baseAssignment}\nЗаседание: ${hearing.date}\nРасчёт: минус ${egrulOffset} дн.; если дата выпала на выходной, перенос на ближайший рабочий день.`
      });
    }
  }

  return preview ? tasks.slice(0, 6) : tasks;
};

function isGeneralDependentAutoTask(task = {}) {
  const text = normalizeGeneralAutoTaskText(`${task.description || task.desc || ''} ${task.assignment || ''}`);
  return text.includes('подготовить отзыв') || text.includes('егрюл') || text.includes('выписк');
}

syncGeneralCaseAutoTasks = async function(savedCase, data, previousRow = null) {
  const allTasks = await dbApi.getCalendarTasks({}).catch(() => []);
  const existingAutoTasks = allTasks.filter(task =>
    Number(task.general_case_id) === Number(savedCase.id) && isGeneralAutoCalendarTask(task)
  );

  const oldHearingDates = getGeneralHearingEventDateLabels(previousRow);
  const newHearingDates = getGeneralHearingEventDateLabels(data);
  const hearingDateChanged = oldHearingDates.length && newHearingDates.length && oldHearingDates.join('|') !== newHearingDates.join('|');
  const dependentTasks = existingAutoTasks.filter(isGeneralDependentAutoTask);

  if (hearingDateChanged && dependentTasks.length) {
    const oldText = oldHearingDates.join(', ');
    const newText = newHearingDates.join(', ');
    const details = dependentTasks
      .map(task => `• ${String(task.description || task.desc || 'Задача').replace('[Авто общего перечня] ', '')}`)
      .join('\n');
    const ok = confirm(
      `Дата предварительного заседания изменена с ${oldText} на ${newText}.\n` +
      `Обнаружены зависимые задачи (${dependentTasks.length}).\n${details}\n\n` +
      'Пересчитать сроки их исполнения автоматически?\n\n' +
      'При пересчёте система берёт новую дату заседания, отнимает период задачи и переносит дедлайн на ближайший рабочий день, если он выпал на выходной.'
    );
    if (!ok) return;
  }

  for (const task of existingAutoTasks) {
    try { await dbApi.deleteCalendarTask(task.id); } catch {}
  }

  const tasks = buildGeneralCaseAutoTasks(savedCase, data);
  for (const task of tasks) {
    try {
      await dbApi.createCalendarTask({
        date: task.dateIso,
        user: task.user,
        type: task.type,
        desc: task.desc,
        time: '',
        court: data.court || savedCase.court || '',
        subject: data.claim_subject || savedCase.claim_subject || '',
        assignment: task.assignment,
        general_case_id: savedCase.id
      });
    } catch (error) {
      console.warn('Не удалось создать автозадачу', error);
    }
  }

  if (tasks.length) showNotification(`Автоматически добавлено задач в план/календарь: ${tasks.length}`);
};
