import { dbApi } from '../../api/dbApi.js';
import { DEFAULT_CASE_PARTIES } from '../../data/legalSuggestionDefaults.js';

const SUBJECT_NAMES = new Set(['claim_subject', 'subject', 'dispute_subject', 'subject_of_dispute', 'claimsubject']);
const PARTY_NAMES = new Set(['plaintiff', 'defendant', 'claimant', 'respondent', 'applicant', 'interested_person']);

const state = {
  initialized: false,
  popup: null,
  input: null,
  items: [],
  activeIndex: -1,
  listboxId: 'legal-field-suggestions-listbox',
  subjects: [],
  parties: [...DEFAULT_CASE_PARTIES],
  loading: null
};

export function initLegalFieldSuggestions() {
  if (state.initialized) return;
  state.initialized = true;
  ensurePopup();
  void loadSuggestions();

  document.addEventListener('focusin', event => handleFocusIn(event.target));
  document.addEventListener('input', event => updateSuggestions(event.target));
  document.addEventListener('keydown', event => {
    if (state.input !== event.target) return;
    if (event.key === 'Escape') {
      hide();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && state.activeIndex >= 0) {
      event.preventDefault();
      choose(state.items[state.activeIndex]?.value || '');
    }
  });
  document.addEventListener('pointerdown', event => {
    const option = event.target.closest?.('[data-legal-suggestion]');
    if (option) {
      event.preventDefault();
      choose(option.dataset.legalSuggestion || '');
      return;
    }
    if (!event.target.closest?.('[data-legal-suggestions], input, textarea')) hide();
  });
  document.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  window.addEventListener('app:view-changed', () => void loadSuggestions(true));
}

async function loadSuggestions(force = false) {
  if (state.loading && !force) return state.loading;
  state.loading = Promise.all([
    dbApi.getOptions('claim_subject').catch(() => []),
    dbApi.getOptions('case_party').catch(() => []),
    dbApi.getGeneralCases().catch(() => []),
    dbApi.getArchivedGeneralCases().catch(() => [])
  ]).then(([subjectOptions, partyOptions, active, archived]) => {
    const cases = [...array(active), ...array(archived)];
    state.subjects = unique([...array(subjectOptions), ...cases.map(row => row.claim_subject)]);
    state.parties = unique([
      ...DEFAULT_CASE_PARTIES,
      ...array(partyOptions),
      ...cases.flatMap(row => [row.plaintiff, row.defendant])
    ]);
  }).finally(() => { state.loading = null; });
  return state.loading;
}

function handleFocusIn(target) {
  if (target === state.input && !state.popup?.hidden) {
    position();
    return;
  }
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    if (!target?.closest?.('[data-legal-suggestions]')) hide();
    return;
  }
  const kind = fieldKind(target);
  if (!kind) {
    hide();
    return;
  }
  if (!normalize(target.value)) {
    hide();
    return;
  }
  updateSuggestions(target);
}

function updateSuggestions(target) {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
  if (target.disabled || target.readOnly) return;
  const kind = fieldKind(target);
  if (!kind) return;
  if (kind === 'subject' && target.matches('[data-general-claim-subject]') && target.value.includes(',')) {
    hide();
    return;
  }

  const query = normalize(target.value);
  if (!query) {
    hide();
    return;
  }
  const source = kind === 'party' ? state.parties : state.subjects;
  const matches = source
    .map(value => ({ value, score: score(value, query) }))
    .filter(item => item.score < 9)
    .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value, 'ru'))
    .slice(0, 14);
  if (!matches.length) {
    hide();
    return;
  }

  state.input = target;
  state.items = matches;
  state.activeIndex = matches.findIndex(item => normalize(item.value) === query);
  if (state.activeIndex < 0) state.activeIndex = 0;
  const popup = ensurePopup();
  popup.innerHTML = matches.map((item, index) => `
    <button
      type="button"
      id="${state.listboxId}-option-${index}"
      role="option"
      aria-selected="${index === state.activeIndex ? 'true' : 'false'}"
      data-legal-suggestion="${escapeAttr(item.value)}"
      data-legal-suggestion-index="${index}"
    >${escapeHtml(item.value)}</button>
  `).join('');
  popup.hidden = false;
  applyInputA11y(target, popup);
  try {
    if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) popup.showPopover();
  } catch {}
  syncActiveOption();
  position();
}

function fieldKind(input) {
  const name = String(input.name || input.dataset.field || '').toLowerCase();
  const label = String(input.closest('label')?.textContent || '').toLowerCase();
  if (SUBJECT_NAMES.has(name) || label.includes('предмет спора')) return 'subject';
  if (PARTY_NAMES.has(name) || label.includes('истец') || label.includes('ответчик')) return 'party';
  return '';
}

function ensurePopup() {
  if (state.popup?.isConnected) return state.popup;
  const popup = document.createElement('div');
  popup.className = 'legal-field-suggestions';
  popup.dataset.legalSuggestions = '1';
  popup.id = state.listboxId;
  popup.setAttribute('popover', 'manual');
  popup.setAttribute('role', 'listbox');
  popup.hidden = true;
  document.body.append(popup);
  state.popup = popup;
  return popup;
}

function position() {
  if (!state.popup || state.popup.hidden || !state.input?.isConnected) return;
  const rect = state.input.getBoundingClientRect();
  const width = Math.max(300, Math.min(560, rect.width));
  const above = window.innerHeight - rect.bottom < 230 && rect.top > 230;
  state.popup.style.width = `${width}px`;
  state.popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
  state.popup.style.top = above ? 'auto' : `${rect.bottom + 6}px`;
  state.popup.style.bottom = above ? `${window.innerHeight - rect.top + 6}px` : 'auto';
}

function choose(value) {
  const input = state.input;
  if (!input || !value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  hide();
  input.focus();
}

function hide() {
  clearInputA11y();
  if (!state.popup) return;
  try {
    if (typeof state.popup.hidePopover === 'function' && state.popup.matches(':popover-open')) state.popup.hidePopover();
  } catch {}
  state.popup.hidden = true;
  state.popup.innerHTML = '';
  state.items = [];
  state.activeIndex = -1;
  state.input = null;
}

function moveActive(step) {
  if (!state.input || !state.items.length) return;
  if (state.popup?.hidden) {
    updateSuggestions(state.input);
    return;
  }
  const total = state.items.length;
  state.activeIndex = state.activeIndex < 0
    ? 0
    : (state.activeIndex + step + total) % total;
  syncActiveOption();
}

function syncActiveOption() {
  if (!state.popup) return;
  state.popup.querySelectorAll('[data-legal-suggestion-index]').forEach(option => {
    const isActive = Number(option.dataset.legalSuggestionIndex) === state.activeIndex;
    option.setAttribute('aria-selected', isActive ? 'true' : 'false');
    option.classList.toggle('is-active', isActive);
    if (isActive) option.scrollIntoView({ block: 'nearest' });
  });
  if (state.input && state.activeIndex >= 0) {
    state.input.setAttribute('aria-activedescendant', `${state.listboxId}-option-${state.activeIndex}`);
  }
}

function applyInputA11y(input, popup) {
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', popup.hidden ? 'false' : 'true');
  input.setAttribute('aria-controls', state.listboxId);
}

function clearInputA11y() {
  if (!state.input) return;
  state.input.setAttribute('aria-expanded', 'false');
  state.input.removeAttribute('aria-activedescendant');
}

function score(value, query) {
  const text = normalize(value);
  if (!query) return 2;
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.split(/\s+/).some(word => word.startsWith(query))) return 2;
  if (text.includes(query)) return 3;
  return 9;
}

function unique(values) {
  const map = new Map();
  values.forEach(raw => {
    const value = String(raw || '').trim();
    const key = normalize(value);
    if (value && key && key !== 'all' && !map.has(key)) map.set(key, value);
  });
  return [...map.values()];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s.-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
