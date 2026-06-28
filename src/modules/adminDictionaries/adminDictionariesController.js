import { dbApi } from '../../api/dbApi.js';
import { DICTIONARY_CATEGORIES } from '../../pages/adminDictionariesPage.js';

const meetingDictionaryCategories = new Set(['msu_ip', 'invited_ip']);
const state = {
  options: [],
};

export function initAdminDictionariesPage() {
  const form = document.querySelector('[data-admin-dictionary-form]');
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = '1';

  form.addEventListener('submit', event => {
    event.preventDefault();
    saveOption(form);
  });
  form.elements.category?.addEventListener('change', () => {
    form.elements.id.value = '';
    updateFormMode(form);
    renderLeadershipOptions();
    renderOptions();
  });
  form.elements.leadership_empty?.addEventListener('change', () => updateLeadershipInput(form));
  document.querySelector('[data-admin-dictionary-reset]')?.addEventListener('click', () => resetForm(form));
  document.querySelector('[data-admin-dictionaries-body]')?.addEventListener('click', event => {
    const editButton = event.target.closest('[data-admin-option-edit]');
    const deleteButton = event.target.closest('[data-admin-option-delete]');
    const moveButton = event.target.closest('[data-admin-option-move]');
    if (editButton) fillForm(form, editButton.dataset.adminOptionEdit);
    if (deleteButton) deleteOption(deleteButton.dataset.adminOptionDelete);
    if (moveButton) moveOption(moveButton.dataset.adminOptionMove, Number(moveButton.dataset.direction || 0));
  });

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'adminDictionaries') loadOptions();
  });
  updateFormMode(form);
  loadOptions();
}

async function loadOptions() {
  const body = document.querySelector('[data-admin-dictionaries-body]');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5">Загрузка...</td></tr>';
  try {
    state.options = await dbApi.getAdminOptions();
    renderLeadershipOptions();
    renderOptions();
    setStatus('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message || 'Ошибка загрузки')}</td></tr>`;
  }
}

function renderOptions() {
  const body = document.querySelector('[data-admin-dictionaries-body]');
  const form = document.querySelector('[data-admin-dictionary-form]');
  if (!body) return;
  const category = form?.elements.category?.value || '';
  const options = state.options.filter(option => option.category === category);
  const meetingMode = isMeetingCategory(category);
  const appealTypeMode = category === 'appeal_type';
  renderTableHead(meetingMode, appealTypeMode);

  if (!options.length) {
    body.innerHTML = `<tr><td colspan="${meetingMode ? 5 : appealTypeMode ? 5 : 3}">Значения не найдены</td></tr>`;
    return;
  }

  body.innerHTML = options.map((option, index) => meetingMode
    ? renderMeetingOptionRow(option)
    : appealTypeMode
      ? renderAppealTypeOptionRow(option, index, options.length)
      : renderSimpleOptionRow(option, index)
  ).join('');
}

function renderTableHead(meetingMode, appealTypeMode = false) {
  const head = document.querySelector('[data-admin-dictionaries-head]');
  if (!head) return;
  head.innerHTML = meetingMode
    ? `
      <tr>
        <th>ID</th>
        <th>ФИО</th>
        <th>Должность</th>
        <th>Руководство</th>
        <th></th>
      </tr>
    `
    : appealTypeMode
      ? `
      <tr>
        <th>№</th>
        <th>Название</th>
        <th>Код</th>
        <th>Порядок</th>
        <th></th>
      </tr>
    `
      : `
      <tr>
        <th>№</th>
        <th>Значение</th>
        <th></th>
      </tr>
    `;
}

function renderSimpleOptionRow(option, index) {
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(option.value)}</td>
      <td class="admin-users-row-actions">
        <button class="btn tiny" data-admin-option-edit="${escapeAttr(option.id)}" type="button">Изменить</button>
        <button class="btn tiny danger" data-admin-option-delete="${escapeAttr(option.id)}" type="button">Удалить</button>
      </td>
    </tr>
  `;
}

function renderAppealTypeOptionRow(option, index, total) {
  const system = Number(option.system_flag || 0) === 1;
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(option.value)}</td>
      <td>${escapeHtml(option.code || (system ? 'system' : 'custom'))}</td>
      <td class="admin-users-row-actions">
        <button class="btn tiny" data-admin-option-move="${escapeAttr(option.id)}" data-direction="-1" type="button" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn tiny" data-admin-option-move="${escapeAttr(option.id)}" data-direction="1" type="button" ${index === total - 1 ? 'disabled' : ''}>↓</button>
      </td>
      <td class="admin-users-row-actions">
        <button class="btn tiny" data-admin-option-edit="${escapeAttr(option.id)}" type="button">Изменить</button>
        <button class="btn tiny danger" data-admin-option-delete="${escapeAttr(option.id)}" type="button" ${system ? 'disabled title="Системное значение нельзя удалить"' : ''}>Удалить</button>
      </td>
    </tr>
  `;
}

function renderMeetingOptionRow(option) {
  return `
    <tr>
      <td>${escapeHtml(formatOptionId(option.id))}</td>
      <td>${escapeHtml(option.value)}</td>
      <td>${escapeHtml(option.position || '')}</td>
      <td>${escapeHtml(option.leadership || '')}</td>
      <td class="admin-users-row-actions">
        <button class="btn tiny" data-admin-option-edit="${escapeAttr(option.id)}" type="button">Изменить</button>
        <button class="btn tiny danger" data-admin-option-delete="${escapeAttr(option.id)}" type="button">Удалить</button>
      </td>
    </tr>
  `;
}

async function saveOption(form) {
  const meetingMode = isMeetingCategory(form.elements.category.value);
  const payload = {
    id: form.elements.id.value || null,
    category: form.elements.category.value,
    value: form.elements.value.value.trim(),
  };
  if (payload.id) {
    const existing = state.options.find(option => String(option.id) === String(payload.id));
    if (existing?.category === 'appeal_type') payload.sort_order = Number(existing.sort_order ?? 999);
  }
  if (meetingMode) {
    payload.position = form.elements.position.value.trim();
    payload.leadership = form.elements.leadership.value.trim();
    payload.is_leadership = form.elements.leadership_empty.checked ? 0 : 1;
  }
  if (!payload.value) {
    setStatus(meetingMode ? 'Заполните ФИО участника.' : 'Заполните значение справочника.');
    return;
  }
  const normalizedValue = normalizeDictionaryValue(payload.value);
  const duplicate = state.options.some(option =>
    option.category === payload.category
    && String(option.id) !== String(payload.id || '')
    && normalizeDictionaryValue(option.value) === normalizedValue
  );
  if (duplicate) {
    setStatus('Такое значение уже есть в справочнике.');
    return;
  }
  if (meetingMode && !payload.position) {
    setStatus('Заполните должность участника.');
    return;
  }
  try {
    await dbApi.saveAdminOption(payload);
    resetForm(form);
    await loadOptions();
    setStatus('Значение сохранено.');
  } catch (error) {
    setStatus(error.message === 'position_required'
      ? 'Заполните должность участника.'
      : error.message === 'option_duplicate'
        ? 'Такое значение уже есть в справочнике.'
      : error.message || 'Ошибка сохранения.');
  }
}

async function moveOption(id, direction) {
  const form = document.querySelector('[data-admin-dictionary-form]');
  const category = form?.elements.category?.value || '';
  if (category !== 'appeal_type' || !direction) return;
  const options = state.options
    .filter(option => option.category === category)
    .sort((a, b) => Number(a.sort_order ?? 999) - Number(b.sort_order ?? 999) || String(a.value || '').localeCompare(String(b.value || ''), 'ru'));
  const index = options.findIndex(option => String(option.id) === String(id));
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= options.length) return;
  const current = options[index];
  const target = options[nextIndex];
  const currentOrder = Number(current.sort_order ?? (index + 1) * 10);
  const targetOrder = Number(target.sort_order ?? (nextIndex + 1) * 10);
  try {
    await dbApi.saveAdminOption({ id: current.id, category: current.category, value: current.value, sort_order: targetOrder });
    await dbApi.saveAdminOption({ id: target.id, category: target.category, value: target.value, sort_order: currentOrder });
    await loadOptions();
    setStatus('Порядок обновлён.');
  } catch (error) {
    setStatus(error.message === 'option_duplicate' ? 'Такое значение уже есть в справочнике.' : error.message || 'Не удалось изменить порядок.');
  }
}

function normalizeDictionaryValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

async function deleteOption(id) {
  const option = state.options.find(item => String(item.id) === String(id));
  if (!option) return;
  if (!confirm(`Удалить значение "${option.value}"?`)) return;
  try {
    await dbApi.deleteAdminOption(id);
    await loadOptions();
    setStatus('Значение удалено.');
  } catch (error) {
    setStatus(error.message === 'option_in_use'
      ? 'Значение используется в данных и не может быть удалено.'
      : error.message === 'system_option_protected'
        ? 'Системное значение нельзя удалить, можно изменить только название.'
      : error.message || 'Ошибка удаления.');
  }
}

function fillForm(form, id) {
  const option = state.options.find(item => String(item.id) === String(id));
  if (!option) return;
  form.elements.id.value = option.id;
  form.elements.category.value = option.category;
  form.elements.value.value = option.value || '';
  form.elements.position.value = option.position || '';
  form.elements.leadership.value = option.leadership || '';
  form.elements.leadership_empty.checked = Number(option.is_leadership ?? 1) === 0;
  updateFormMode(form);
}

function resetForm(form) {
  const category = form.elements.category.value;
  form.reset();
  form.elements.category.value = category;
  form.elements.id.value = '';
  updateFormMode(form);
  setStatus('');
}

function updateFormMode(form) {
  const meetingMode = isMeetingCategory(form.elements.category.value);
  document.querySelector('[data-admin-dictionary-value-label]').textContent = meetingMode ? 'ФИО' : 'Значение';
  document.querySelectorAll('[data-admin-meeting-field]').forEach(node => {
    node.hidden = !meetingMode;
  });
  form.elements.position.required = meetingMode;
  if (!meetingMode) {
    form.elements.position.value = '';
    form.elements.leadership.value = '';
    form.elements.leadership_empty.checked = false;
  }
  updateLeadershipInput(form);
}

function updateLeadershipInput(form) {
  if (form.elements.leadership) {
    form.elements.leadership.disabled = false;
  }
}

function renderLeadershipOptions() {
  const list = document.querySelector('[data-admin-leadership-options]');
  if (!list) return;
  const category = document.querySelector('[data-admin-dictionary-form]')?.elements.category?.value || '';
  const values = [...new Set(state.options
    .filter(option => option.category === category && isMeetingCategory(option.category))
    .flatMap(option => [
      option.leadership || '',
      Number(option.is_leadership ?? 1) ? option.position || '' : '',
    ])
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ru')))];
  list.innerHTML = values.map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
}

function isMeetingCategory(category) {
  return meetingDictionaryCategories.has(String(category || ''));
}

function formatOptionId(id) {
  const value = String(id || '');
  return value.startsWith('meeting:') ? value.slice('meeting:'.length) : value;
}

function setStatus(message) {
  const node = document.querySelector('[data-admin-dictionaries-status]');
  if (node) node.textContent = message;
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
  return escapeHtml(value);
}
