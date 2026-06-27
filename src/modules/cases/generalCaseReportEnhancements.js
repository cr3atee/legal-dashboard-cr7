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
  rowsById: new Map(),
  observer: null,
  timer: null
};

export function initGeneralCaseReportEnhancements() {
  if (state.initialized) return;
  state.initialized = true;

  installFormEnhancements();
  document.addEventListener('click', handleOpenClick, true);
  window.addEventListener('general-cases:updated', event => {
    const rows = Array.isArray(event.detail) ? event.detail : [];
    rows.forEach(row => state.rowsById.set(Number(row.id), row));
    scheduleDecorate();
  });

  const root = document.querySelector('#cases');
  if (root) {
    state.observer = new MutationObserver(scheduleDecorate);
    state.observer.observe(root, { childList: true, subtree: true });
  }
  scheduleDecorate();
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
  const values = current && !DISPUTE_CATEGORIES.includes(current)
    ? [current, ...DISPUTE_CATEGORIES]
    : DISPUTE_CATEGORIES;
  select.innerHTML = `<option value="${escapeAttr(emptyValue)}">${escapeHtml(emptyLabel)}</option>${values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = current || emptyValue;
}

function handleOpenClick(event) {
  const open = event.target.closest?.('[data-general-open]');
  const create = event.target.closest?.('[data-general-new]');
  if (!open && !create) return;
  const id = Number(open?.dataset.generalOpen || 0);
  window.setTimeout(() => {
    installFormEnhancements();
    const input = document.querySelector('[data-general-form] [name="prosecutor_claim_flag"]');
    if (!input) return;
    input.checked = id ? Number(state.rowsById.get(id)?.prosecutor_claim_flag || 0) === 1 : false;
  }, 180);
}

function scheduleDecorate() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    installFormEnhancements();
    decorateCaseCards();
  }, 30);
}

function decorateCaseCards() {
  document.querySelectorAll('[data-general-card]').forEach(card => {
    const id = Number(card.dataset.generalCard || 0);
    const row = state.rowsById.get(id);
    const badges = card.querySelector('.general-case-badges');
    const existing = badges?.querySelector('[data-prosecutor-case-badge]');
    if (Number(row?.prosecutor_claim_flag || 0) === 1) {
      if (!existing) badges?.insertAdjacentHTML('beforeend', '<span class="case-badge prosecutor" data-prosecutor-case-badge>Иск прокурора</span>');
    } else {
      existing?.remove();
    }
  });

  document.querySelectorAll('[data-general-row]').forEach(tableRow => {
    const id = Number(tableRow.dataset.generalRow || 0);
    const row = state.rowsById.get(id);
    const badges = tableRow.querySelector('.general-cases-table-badges');
    const existing = badges?.querySelector('[data-prosecutor-case-marker]');
    if (Number(row?.prosecutor_claim_flag || 0) === 1) {
      if (!existing) badges?.insertAdjacentHTML('beforeend', '<span class="case-table-marker prosecutor" data-prosecutor-case-marker title="Иск прокурора" aria-label="Иск прокурора"></span>');
    } else {
      existing?.remove();
    }
  });
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
