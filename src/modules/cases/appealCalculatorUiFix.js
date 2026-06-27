import { calculateAppealDeadline, readAppealRow } from './appealDeadlineMath.js';

let timer = null;

export function initAppealCalculatorUiFix() {
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-general-calc-row]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    renderRow(button.closest('[data-general-appeal-row]'));
  }, true);
  document.addEventListener('input', event => {
    if (event.target.closest?.('[data-general-appeal-row]')) schedule();
  }, true);
  document.addEventListener('change', event => {
    if (event.target.closest?.('[data-general-appeal-row]')) schedule();
  }, true);
  const root = document.querySelector('#cases');
  if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    document.querySelectorAll('[data-general-print-row], [data-general-restore-template]').forEach(node => node.remove());
    document.querySelectorAll('[data-general-appeal-row]').forEach(renderRow);
    renderSuggestions();
  }, 25);
}

function renderRow(row) {
  if (!row) return;
  const data = readAppealRow(row);
  const node = row.querySelector('[data-general-appeal-row-result]');
  if (!node) return;
  const result = calculateAppealDeadline(data);
  if (result?.noCalendarPeriod) {
    node.innerHTML = '<div class="general-appeal-result-structured"><p><b>Календарный срок автоматически не рассчитывается.</b></p></div>';
    return;
  }
  if (!data.event_date) {
    node.innerHTML = '<div class="general-appeal-result-structured"><p><b>Введите дату судебного акта или его получения.</b></p></div>';
    return;
  }
  if (!result) {
    node.innerHTML = '<div class="general-appeal-result-structured"><p class="danger">Неверная дата. Используйте формат ДД.ММ.ГГГГ.</p></div>';
    return;
  }
  node.innerHTML = `<div class="general-appeal-result-structured">
    <p><b>Исходная дата:</b> ${html(result.baseRu)}</p>
    <p><b>Начало срока:</b> ${html(result.startRu)}</p>
    <p><b>Срок подачи:</b> ${html(result.period)}</p>
    <p><b>Последний день подачи:</b> ${html(result.dateRu)}</p>
    <p class="muted">${html(result.explanation)}</p>
    ${result.weekendShifted ? '<p class="danger">Последний день перенесён с выходного на ближайший рабочий день.</p>' : ''}
    <p class="muted">Праздничные дни дополнительно сверяются с производственным календарём.</p>
  </div>`;
}

function renderSuggestions() {
  const node = document.querySelector('[data-general-appeal-suggestions]');
  if (!node) return;
  const rows = [...document.querySelectorAll('[data-general-appeal-row]')]
    .map(readAppealRow)
    .map(data => ({ data, result: calculateAppealDeadline(data) }))
    .filter(item => item.result?.dateRu);
  if (!rows.length) return;
  node.hidden = false;
  node.innerHTML = `<h5>Автоматически будут добавлены в план и календарь:</h5>${rows.map(item => `<div class="general-appeal-suggestion"><b>${html(item.result.dateRu)}</b><span>Последний день подачи ${html(item.data.appeal_kind.toLowerCase())}</span></div>`).join('')}`;
}

function html(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
