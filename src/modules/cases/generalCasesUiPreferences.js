const VIEW_STORAGE_KEY = 'legal-dashboard-general-cases-default-view-v1';
const CATEGORY_PALETTE = [
  ['#eff6ff', '#bfdbfe', '#2563eb'],
  ['#f5f3ff', '#ddd6fe', '#7c3aed'],
  ['#ecfeff', '#a5f3fc', '#0891b2'],
  ['#fff7ed', '#fed7aa', '#ea580c'],
  ['#f0fdf4', '#bbf7d0', '#16a34a'],
  ['#fff1f2', '#fecdd3', '#e11d48'],
  ['#f8fafc', '#cbd5e1', '#475569']
];

const state = {
  initialized: false,
  observer: null,
  pendingRemove: null,
  preferenceApplied: false
};

export function initGeneralCasesUiPreferences() {
  if (state.initialized) return;
  state.initialized = true;

  ensurePreferenceDialog();
  ensureDeleteDialog();
  decorate();

  document.addEventListener('click', handleClick, true);
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId !== 'cases') return;
    state.preferenceApplied = false;
    window.setTimeout(() => {
      decorate();
      applySavedViewPreference();
    }, 80);
  });
  window.addEventListener('general-cases:updated', () => window.setTimeout(decorate, 30));
  window.addEventListener('general-cases:reload', () => window.setTimeout(decorate, 120));

  const root = document.querySelector('#cases');
  if (root) {
    state.observer = new MutationObserver(() => window.requestAnimationFrame(decorate));
    state.observer.observe(root, { childList: true, subtree: true });
  }
  window.setTimeout(applySavedViewPreference, 100);
}

function handleClick(event) {
  const defaultButton = event.target.closest?.('[data-general-default-view]');
  if (defaultButton) {
    event.preventDefault();
    openPreferenceDialog();
    return;
  }

  const viewChoice = event.target.closest?.('[data-general-default-view-choice]');
  if (viewChoice) {
    event.preventDefault();
    const view = viewChoice.dataset.generalDefaultViewChoice === 'cards' ? 'cards' : 'table';
    localStorage.setItem(VIEW_STORAGE_KEY, view);
    closePreferenceDialog();
    activateView(view);
    return;
  }

  if (event.target.closest?.('[data-general-default-view-close]')) {
    event.preventDefault();
    closePreferenceDialog();
    return;
  }

  const removeButton = event.target.closest?.('[data-general-appeal-remove]');
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    state.pendingRemove = removeButton;
    openDeleteDialog();
    return;
  }

  if (event.target.closest?.('[data-general-appeal-delete-no]')) {
    event.preventDefault();
    closeDeleteDialog();
    return;
  }

  if (event.target.closest?.('[data-general-appeal-delete-yes]')) {
    event.preventDefault();
    removePendingAppealRow();
  }
}

function decorate() {
  ensureDefaultViewButton();
  decorateAppealRows();
  decorateCategoryBadges();
}

function ensureDefaultViewButton() {
  const viewbar = document.querySelector('#cases .general-case-viewbar');
  const switcher = viewbar?.querySelector('.general-case-view-switch');
  if (!viewbar || !switcher || viewbar.querySelector('[data-general-default-view]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small general-case-default-view-button';
  button.dataset.generalDefaultView = '1';
  button.textContent = 'Установить по умолчанию';
  viewbar.insertBefore(button, switcher);
}

function ensurePreferenceDialog() {
  let dialog = document.querySelector('[data-general-default-view-dialog]');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'general-choice-dialog';
  dialog.dataset.generalDefaultViewDialog = '1';
  dialog.innerHTML = `
    <div class="general-choice-card">
      <div class="general-choice-head">
        <h3>Вид общего перечня</h3>
        <button class="icon-button" type="button" data-general-default-view-close aria-label="Закрыть">×</button>
      </div>
      <p>При открытии раздела открывать:</p>
      <div class="general-choice-actions">
        <button class="btn primary" type="button" data-general-default-view-choice="table">Таблицу</button>
        <button class="btn" type="button" data-general-default-view-choice="cards">Карточки</button>
      </div>
    </div>`;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closePreferenceDialog();
  });
  document.body.append(dialog);
  return dialog;
}

function openPreferenceDialog() {
  const dialog = ensurePreferenceDialog();
  if (!dialog.open) dialog.showModal();
}

function closePreferenceDialog() {
  const dialog = document.querySelector('[data-general-default-view-dialog]');
  if (dialog?.open) dialog.close();
}

function applySavedViewPreference() {
  if (state.preferenceApplied) return;
  const view = localStorage.getItem(VIEW_STORAGE_KEY);
  if (view !== 'table' && view !== 'cards') return;
  state.preferenceApplied = true;
  activateView(view);
}

function activateView(view) {
  const button = document.querySelector(`#cases [data-general-view="${view}"]`);
  if (button && !button.classList.contains('is-active')) button.click();
}

function decorateAppealRows() {
  document.querySelectorAll('#cases [data-general-appeal-row]').forEach(row => {
    const kind = row.querySelector('[data-general-appeal-kind]');
    if (kind) kind.classList.add('general-appeal-kind-highlight');

    const dateInput = row.querySelector('[data-general-appeal-date]');
    const dateLabel = dateInput?.closest('label');
    const remove = row.querySelector('[data-general-appeal-remove]');
    if (!dateLabel || !remove) return;

    dateLabel.classList.add('general-appeal-date-compact');
    remove.textContent = '×';
    remove.classList.add('general-appeal-remove-cross');
    remove.setAttribute('aria-label', 'Удалить событие');
    remove.title = 'Удалить событие';

    let group = row.querySelector(':scope > .general-appeal-date-actions');
    if (!group) {
      group = document.createElement('div');
      group.className = 'general-appeal-date-actions';
      dateLabel.replaceWith(group);
      group.append(dateLabel, remove);
    } else if (remove.parentElement !== group) {
      group.append(remove);
    }
  });
}

function ensureDeleteDialog() {
  let dialog = document.querySelector('[data-general-appeal-delete-dialog]');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'general-choice-dialog';
  dialog.dataset.generalAppealDeleteDialog = '1';
  dialog.innerHTML = `
    <div class="general-choice-card">
      <div class="general-choice-head"><h3>Удаление события</h3></div>
      <p>Вы уверены, что хотите удалить событие?</p>
      <div class="general-choice-actions">
        <button class="btn" type="button" data-general-appeal-delete-no>Нет</button>
        <button class="btn danger" type="button" data-general-appeal-delete-yes>Да</button>
      </div>
    </div>`;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDeleteDialog();
  });
  document.body.append(dialog);
  return dialog;
}

function openDeleteDialog() {
  const dialog = ensureDeleteDialog();
  if (!dialog.open) dialog.showModal();
}

function closeDeleteDialog() {
  const dialog = document.querySelector('[data-general-appeal-delete-dialog]');
  if (dialog?.open) dialog.close();
  state.pendingRemove = null;
}

function removePendingAppealRow() {
  const button = state.pendingRemove;
  const row = button?.closest('[data-general-appeal-row]');
  if (row) {
    const form = row.closest('[data-general-form]');
    row.remove();
    form?.dispatchEvent(new Event('input', { bubbles: true }));
    form?.dispatchEvent(new Event('change', { bubbles: true }));
    if (!form?.querySelector('[data-general-appeal-row]')) {
      const block = form?.querySelector('[data-general-appeal-block]');
      const empty = form?.querySelector('[data-general-appeal-empty]');
      if (block) block.hidden = true;
      if (empty) empty.hidden = false;
    }
  }
  closeDeleteDialog();
}

function decorateCategoryBadges() {
  document.querySelectorAll('#cases [data-general-row]').forEach(row => {
    const cells = [...row.children];
    const cell = cells[2];
    if (!cell || cell.querySelector('[data-general-category-badge]')) return;
    const raw = String(cell.textContent || '').trim();
    if (!raw || raw === '—') return;
    const palette = CATEGORY_PALETTE[Math.abs(hash(raw)) % CATEGORY_PALETTE.length];
    cell.innerHTML = `<span class="general-table-category-badge" data-general-category-badge style="--badge-bg:${palette[0]};--badge-border:${palette[1]};--badge-color:${palette[2]}"><span aria-hidden="true">▱</span><span>${escapeHtml(raw)}</span></span>`;
  });
}

function hash(value) {
  let result = 0;
  for (const char of String(value || '').toLocaleLowerCase('ru-RU')) result = ((result << 5) - result + char.charCodeAt(0)) | 0;
  return result;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}