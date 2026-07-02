let initialized = false;

function getFieldContainer(control) {
  return control?.closest('label, .form-field, .field, .general-form-field') || control?.parentElement || null;
}

function getControls(form) {
  const category = form?.querySelector('select[name="category"], input[name="category"], [data-general-category]');
  const subject = form?.querySelector('input[name="claim_subject"], textarea[name="claim_subject"], [data-general-claim-subject]');
  return { category, subject };
}

function isNewCase(form) {
  return !String(form?.elements?.id?.value || '').trim();
}

function hasCategory(category) {
  return Boolean(String(category?.value || '').trim());
}

function syncSubjectAvailability(form) {
  const { category, subject } = getControls(form);
  if (!category || !subject) return;

  const blocked = isNewCase(form) && !hasCategory(category);
  subject.disabled = blocked;
  subject.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  subject.placeholder = blocked
    ? 'Сначала выберите категорию спора'
    : (subject.dataset.originalPlaceholder || subject.placeholder || '');

  if (!subject.dataset.originalPlaceholder) {
    subject.dataset.originalPlaceholder = blocked ? '' : subject.placeholder || '';
  }

  const container = getFieldContainer(subject);
  container?.classList.toggle('is-disabled-until-category', blocked);
}

function reorderFields(form) {
  const { category, subject } = getControls(form);
  if (!category || !subject) return;

  const categoryField = getFieldContainer(category);
  const subjectField = getFieldContainer(subject);
  if (!categoryField || !subjectField || categoryField === subjectField) return;
  if (categoryField.parentElement !== subjectField.parentElement) return;

  const parent = categoryField.parentElement;
  if (categoryField.nextElementSibling !== subjectField) {
    parent.insertBefore(categoryField, subjectField);
  }
}

function enhanceForm() {
  const form = document.querySelector('[data-general-form]');
  if (!(form instanceof HTMLFormElement)) return;
  reorderFields(form);
  syncSubjectAvailability(form);
}

export function initGeneralCaseCategorySubjectOrder() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-general-new], [data-general-open]')) return;
    setTimeout(enhanceForm, 40);
    setTimeout(enhanceForm, 140);
  }, true);

  document.addEventListener('change', event => {
    const form = event.target.closest?.('[data-general-form]');
    if (!form) return;
    if (event.target.matches('select[name="category"], input[name="category"], [data-general-category]')) {
      syncSubjectAvailability(form);
    }
  }, true);

  document.addEventListener('input', event => {
    const form = event.target.closest?.('[data-general-form]');
    if (!form) return;
    if (event.target.matches('input[name="category"], [data-general-category]')) {
      syncSubjectAvailability(form);
    }
  }, true);

  window.addEventListener('general-cases:updated', () => setTimeout(enhanceForm, 40));
}
