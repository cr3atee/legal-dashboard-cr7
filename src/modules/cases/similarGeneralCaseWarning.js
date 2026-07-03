import { dbApi } from '../../api/dbApi.js';
import { showNotification } from '../../layout/notifications.js';

let initialized = false;
let checking = false;
let activeForm = null;

export function initSimilarGeneralCaseWarning() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-general-form]');
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.similarCheckBypass === '1') return;
    if (String(form.elements?.id?.value || '').trim()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (checking) {
      showNotification('Проверка похожих дел уже выполняется');
      return;
    }

    checkBeforeCreate(form).catch(error => {
      console.error('Не удалось проверить похожие дела:', error);
      showNotification(`Не удалось проверить похожие дела: ${error.message}`, 'error');
    });
  }, true);

  document.addEventListener('click', event => {
    const openButton = event.target.closest?.('[data-similar-case-open]');
    if (openButton) {
      event.preventDefault();
      openExistingCase(Number(openButton.dataset.similarCaseOpen || 0));
      return;
    }

    if (event.target.closest?.('[data-similar-case-create]')) {
      event.preventDefault();
      continueCreatingCase();
      return;
    }

    if (event.target.closest?.('[data-similar-case-cancel]') || event.target.matches?.('[data-similar-case-overlay]')) {
      event.preventDefault();
      closeWarning();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('[data-similar-case-overlay]')) {
      event.preventDefault();
      closeWarning();
    }
  }, true);
}

async function checkBeforeCreate(form) {
  const criteria = collectCriteria(form);
  if (!hasCompleteCriteria(criteria)) {
    submitWithBypass(form);
    return;
  }

  checking = true;
  activeForm = form;
  setFormChecking(form, true);

  try {
    const rows = await dbApi.getGeneralCases();
    const items = (Array.isArray(rows) ? rows : [])
      .filter(row => isSimilarCase(criteria, row))
      .slice(0, 10);

    if (!items.length) {
      activeForm = null;
      submitWithBypass(form);
      return;
    }

    openWarning(items);
  } finally {
    checking = false;
    if (form.dataset.caseSubmitLocked !== '1') setFormChecking(form, false);
  }
}

function collectCriteria(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    court_no: String(data.court_no || '').trim(),
    court: String(data.court || '').trim(),
    category: String(data.category || '').trim(),
    claim_subject: String(data.claim_subject || '').trim()
  };
}

function hasCompleteCriteria(criteria) {
  return Boolean(criteria.court_no && criteria.court && criteria.category && criteria.claim_subject);
}

function isSimilarCase(criteria, row) {
  return normalizeCaseNumber(criteria.court_no) === normalizeCaseNumber(row.court_no)
    && normalizeText(criteria.court) === normalizeText(row.court)
    && normalizeText(criteria.category) === normalizeText(row.category)
    && subjectMatches(criteria.claim_subject, row.claim_subject);
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, '')
    .replace(/[.,;:()\[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCaseNumber(value) {
  return normalizeText(value)
    .replace(/^№\s*/u, '')
    .replace(/[^0-9a-zа-я/\\-]+/giu, '');
}

function subjectMatches(inputValue, storedValue) {
  const input = normalizeText(inputValue);
  const stored = normalizeText(storedValue);
  if (!input || !stored) return false;
  return input === stored || input.startsWith(`${stored} `);
}

function openWarning(items) {
  closeWarning(false);

  const overlay = document.createElement('div');
  overlay.className = 'similar-case-overlay';
  overlay.dataset.similarCaseOverlay = '1';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'similar-case-warning-title');

  overlay.innerHTML = `
    <section class="similar-case-dialog" data-similar-case-dialog>
      <header class="similar-case-dialog-header">
        <div class="similar-case-warning-icon" aria-hidden="true">!</div>
        <div>
          <span>Проверка на дубли</span>
          <h2 id="similar-case-warning-title">Найдено похожее дело</h2>
          <p>Совпали № дела в суде, суд, категория и предмет спора.</p>
        </div>
        <button class="similar-case-close" data-similar-case-cancel type="button" aria-label="Закрыть">×</button>
      </header>
      <div class="similar-case-list">${items.map(renderSimilarCase).join('')}</div>
      <footer class="similar-case-actions">
        <button class="btn" data-similar-case-cancel type="button">Вернуться к редактированию</button>
        <button class="btn danger-outline" data-similar-case-create type="button">Всё равно создать новое</button>
      </footer>
    </section>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add('similar-case-warning-open');
  window.setTimeout(() => overlay.querySelector('[data-similar-case-open]')?.focus(), 0);
}

function renderSimilarCase(row) {
  return `
    <article class="similar-case-item">
      <div class="similar-case-item-main">
        <div class="similar-case-number-line">
          <strong>№ ПК ${escapeHtml(row.case_no || 'Без номера')}</strong>
          <span>${escapeHtml(row.registration_date || '')}</span>
        </div>
        <h3>${escapeHtml(row.court_no || '№ дела в суде не указан')}</h3>
        <dl>
          <div><dt>Суд</dt><dd>${escapeHtml(row.court || '—')}</dd></div>
          <div><dt>Категория</dt><dd>${escapeHtml(row.category || '—')}</dd></div>
          <div><dt>Предмет</dt><dd>${escapeHtml(row.claim_subject || '—')}</dd></div>
          <div><dt>Стороны</dt><dd>${escapeHtml(formatParties(row))}</dd></div>
          <div><dt>Исполнитель</dt><dd>${escapeHtml(row.executor || '—')}</dd></div>
        </dl>
      </div>
      <button class="btn primary" data-similar-case-open="${Number(row.id || 0)}" type="button">Открыть существующее</button>
    </article>
  `;
}

function formatParties(row) {
  const values = [row.plaintiff, row.defendant].map(value => String(value || '').trim()).filter(Boolean);
  return values.length ? values.join(' / ') : '—';
}

function openExistingCase(id) {
  if (!id) return;
  closeWarning();
  closeCurrentGeneralDialog();

  window.setTimeout(() => {
    if (typeof window.__generalCasesOpenExisting === 'function') {
      window.__generalCasesOpenExisting(id, null, { force: true });
    } else {
      window.dispatchEvent(new CustomEvent('general-cases:open-case', { detail: { id } }));
    }
  }, 50);
}

function continueCreatingCase() {
  const form = activeForm;
  closeWarning();
  if (form?.isConnected) submitWithBypass(form);
}

function submitWithBypass(form) {
  form.dataset.similarCheckBypass = '1';
  try {
    form.requestSubmit();
  } finally {
    window.setTimeout(() => delete form.dataset.similarCheckBypass, 0);
  }
}

function setFormChecking(form, value) {
  form.querySelectorAll('button[type="submit"], [data-general-save]').forEach(button => {
    button.disabled = Boolean(value);
    button.setAttribute('aria-busy', value ? 'true' : 'false');
  });
}

function closeWarning(clearForm = true) {
  document.querySelector('[data-similar-case-overlay]')?.remove();
  document.body.classList.remove('similar-case-warning-open');
  if (clearForm) activeForm = null;
}

function closeCurrentGeneralDialog() {
  const dialog = document.querySelector('[data-general-dialog]');
  if (!dialog) return;
  try {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.classList.remove('is-open');
    }
  } catch {
    dialog.removeAttribute('open');
    dialog.classList.remove('is-open');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
