import { dbApi } from '../../api/dbApi.js';
import { initAttendanceBadgeFix } from './attendanceBadgeFix.js';

let userNames = [];
let initialized = false;

function normalize(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function uniqueNames(users = []) {
  const seen = new Set();
  return (Array.isArray(users) ? users : [])
    .map(user => typeof user === 'string'
      ? user
      : user?.full_name || user?.name || user?.login || user?.username || '')
    .map(value => String(value || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter(value => {
      const key = normalize(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

async function loadUsers() {
  try {
    const payload = await dbApi.getUsers();
    userNames = uniqueNames(Array.isArray(payload) ? payload : payload?.items || payload?.users || []);
  } catch (error) {
    console.warn('Не удалось загрузить подсказки исполнителей:', error);
    userNames = [];
  }
}

function ensureBox(input) {
  let box = input.parentElement?.querySelector('[data-general-executor-suggestions]');
  if (box) return box;
  box = document.createElement('div');
  box.dataset.generalExecutorSuggestions = '1';
  box.className = 'general-executor-suggestions';
  box.hidden = true;
  input.parentElement?.append(box);
  return box;
}

function hide(input) {
  const box = input?.parentElement?.querySelector('[data-general-executor-suggestions]');
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';
}

function render(input) {
  const box = ensureBox(input);
  const query = normalize(input.value);
  if (!query) {
    hide(input);
    return;
  }

  const matches = userNames
    .filter(name => normalize(name).includes(query))
    .sort((a, b) => {
      const aValue = normalize(a);
      const bValue = normalize(b);
      const aStarts = aValue.startsWith(query) ? 0 : 1;
      const bStarts = bValue.startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b, 'ru');
    })
    .slice(0, 8);

  if (!matches.length) {
    hide(input);
    return;
  }

  box.innerHTML = matches.map(name => `
    <button type="button" data-general-executor-suggestion="${escapeAttr(name)}">${escapeHtml(name)}</button>
  `).join('');
  box.hidden = false;
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

function executorInput(target) {
  if (!(target instanceof HTMLInputElement)) return null;
  if (target.name === 'executor') return target;
  return target.matches('[data-general-executor]') ? target : null;
}

export function initGeneralCaseExecutorSuggestions() {
  if (initialized) return;
  initialized = true;
  initAttendanceBadgeFix();
  void loadUsers();

  document.addEventListener('input', event => {
    const input = executorInput(event.target);
    if (input) render(input);
  });

  document.addEventListener('focusin', event => {
    const input = executorInput(event.target);
    if (input && input.value.trim()) render(input);
  });

  document.addEventListener('click', event => {
    const option = event.target.closest?.('[data-general-executor-suggestion]');
    if (option) {
      const form = option.closest('[data-general-form]');
      const input = form?.querySelector('input[name="executor"], [data-general-executor]');
      if (input) {
        input.value = option.dataset.generalExecutorSuggestion || option.textContent || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        hide(input);
        input.focus();
      }
      return;
    }

    const active = document.querySelector('input[name="executor"]:focus, [data-general-executor]:focus');
    if (!event.target.closest?.('[data-general-executor-suggestions]') && !active) {
      document.querySelectorAll('[data-general-executor-suggestions]').forEach(box => {
        box.hidden = true;
        box.innerHTML = '';
      });
    }
  });

  document.addEventListener('keydown', event => {
    const input = executorInput(event.target);
    if (input && event.key === 'Escape') hide(input);
  });

  window.addEventListener('auth:changed', () => void loadUsers());
}
