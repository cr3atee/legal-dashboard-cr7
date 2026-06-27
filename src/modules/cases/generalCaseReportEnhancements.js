import { dbApi } from '../../api/dbApi.js';

const DISPUTE_CATEGORIES = [
  'Выселение, признание утратившим право на жилое помещение',
  'Дела (материалы) об исполнении судебных решений',
  'Дела, рассматриваемые в порядке особого производства',
  'Задолженность за ЖКУ',
  'Изъятие жилых помещений и нежилых помещений в МКД, признанном аварийным',
  'Иные споры',
  'Иски материального характера (взыскание убытков, неосновательное обогащение, компенсации и т.п.)',
  'Неполучение паспорта/акта готовности к отопительному сезону',
  'О компенсации морального вреда',
  'О привлечении к административной ответственности',
  'Обжалование действий (бездействия), актов органов государственной власти и иных органов местного самоуправления',
  'Обжалование действий (бездействия), ненормативных правовых актов администрации города',
  'Обжалование нормативных правовых актов администрации города, БГД',
  'Пересмотр решения суда по вновь открывшимся обстоятельствам',
  'Признание жилого дома многоквартирным',
  'Признание незаконным решения МВК',
  'Создание, благоустройство, содержание площадок для размещения ТКО',
  'Споры о кадастровой стоимости объекта',
  'Споры о понуждении ОМС к совершению действий',
  'Споры о порядке пользования имуществом (жилыми помещениями, земельными участками и т.п.)',
  'Споры о правах на здания, строения, сооружения, жилые помещения (право собственности, право пользования)',
  'Споры о правах на землю и земельные участки',
  'Споры о признании сделок недействительными, прекращении обязательств, расторжении договоров',
  'Споры о самовольных постройках/узаконение перепланировки, переустройства, переводе помещения'
];

const state = {
  initialized: false,
  apiPatched: false,
  rowsById: new Map(),
  observer: null,
  timer: null
};

export function initGeneralCaseReportEnhancements() {
  if (state.initialized) return;
  state.initialized = true;
  patchCaseSaveMethods();
  installFormEnhancements();
  document.addEventListener('click', handleOpenClick, true);
  window.addEventListener('general-cases:updated', event => {
    const rows = Array.isArray(event.detail) ? event.detail : [];
    rows.forEach(row => state.rowsById.set(Number(row.id), row));
    scheduleDecorate();
  });

  const root = document.querySelector('#cases');
  if (root) {
    state.observer = new MutationObserver(mutations => {
      scheduleDecorate();
      if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'open')) {
        window.setTimeout(syncOpenFormEnhancements, 40);
      }
    });
    state.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  scheduleDecorate();
}

function patchCaseSaveMethods() {
  if (state.apiPatched) return;
  state.apiPatched = true;
  const originalCreate = dbApi.createGeneralCase.bind(dbApi);
  const originalUpdate = dbApi.updateGeneralCase.bind(dbApi);
  dbApi.createGeneralCase = data => originalCreate(attachAppealMetricIds(data));
  dbApi.updateGeneralCase = (id, data) => originalUpdate(id, attachAppealMetricIds(data));
}

function attachAppealMetricIds(data = {}) {
  let rows = [];
  try {
    const parsed = JSON.parse(data.appeals_json || '[]');
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {}
  const domRows = [...document.querySelectorAll('[data-general-appeal-row]')];
  rows = rows.map((row, index) => {
    const node = domRows[index];
    const counterId = row.counter_id || node?.dataset.metricCounterId || randomId();
    const createdAt = row.counter_created_at || node?.dataset.metricCreatedAt || new Date().toISOString();
    if (node) {
      node.dataset.metricCounterId = counterId;
      node.dataset.metricCreatedAt = createdAt;
    }
    return { ...row, counter_id: counterId, counter_created_at: createdAt };
  });
  return { ...data, appeals_json: JSON.stringify(rows) };
}

function installFormEnhancements() {
  const form = document.querySelector('[data-general-form]');
  if (!form) return;
  const flags = form.querySelector('.case-form-flags');
  if (flags && !flags.querySelector('[name="prosecutor_claim_flag"]')) {
    flags.insertAdjacentHTML('beforeend', '<label class="check-row case-flag-toggle prosecutor-flag-toggle"><input type="checkbox" name="prosecutor_claim_flag"><span>Иск прокурора</span></label>');
  }
  flags?.querySelectorAll('label.check-row').forEach(label => label.classList.add('case-flag-toggle'));
  const categorySelect = form.elements.category;
  if (categorySelect) replaceCategoryOptions(categorySelect, 'Не выбрано');
  const categoryFilter = document.querySelector('[data-general-dispute-category-filter]');
  if (categoryFilter) replaceCategoryOptions(categoryFilter, 'Все категории', 'all');
}

function replaceCategoryOptions(select, emptyLabel, emptyValue = '') {
  const current = String(select.value || '').trim();
  const values = current && !DISPUTE_CATEGORIES.includes(current) ? [current, ...DISPUTE_CATEGORIES] : DISPUTE_CATEGORIES;
  const signature = `${emptyValue}|${current}|${values.join('|')}`;
  if (select.dataset.reportCategorySignature === signature) return;
  select.dataset.reportCategorySignature = signature;
  select.innerHTML = `<option value="${escapeAttr(emptyValue)}">${escapeHtml(emptyLabel)}</option>${values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = current || emptyValue;
}

function handleOpenClick(event) {
  const open = event.target.closest?.('[data-general-open]');
  const create = event.target.closest?.('[data-general-new]');
  if (!open && !create) return;
  const id = Number(open?.dataset.generalOpen || 0);
  const row = id ? state.rowsById.get(id) : null;
  window.setTimeout(() => syncFormWithRow(row), 190);
  window.setTimeout(() => syncFormWithRow(row), 380);
}

function syncOpenFormEnhancements() {
  const dialog = document.querySelector('[data-general-dialog]');
  if (!dialog?.open && !dialog?.hasAttribute('open')) return;
  const id = Number(document.querySelector('[data-general-form] [name="id"]')?.value || 0);
  syncFormWithRow(id ? state.rowsById.get(id) : null);
}

function syncFormWithRow(row) {
  installFormEnhancements();
  const input = document.querySelector('[data-general-form] [name="prosecutor_claim_flag"]');
  if (input) input.checked = Number(row?.prosecutor_claim_flag || 0) === 1;
  let appeals = [];
  try {
    const parsed = JSON.parse(row?.appeals_json || '[]');
    appeals = Array.isArray(parsed) ? parsed : [];
  } catch {}
  [...document.querySelectorAll('[data-general-appeal-row]')].forEach((node, index) => {
    const appeal = appeals[index];
    const legacyId = appeal ? `legacy-${index + 1}` : '';
    node.dataset.metricCounterId = appeal?.counter_id || node.dataset.metricCounterId || legacyId || randomId();
    node.dataset.metricCreatedAt = appeal?.counter_created_at || node.dataset.metricCreatedAt || new Date().toISOString();
  });
}

function scheduleDecorate() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    installFormEnhancements();
    decorateCaseCards();
  }, 40);
}

function decorateCaseCards() {
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

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export { DISPUTE_CATEGORIES };
