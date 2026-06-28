import { dbApi } from '../../api/dbApi.js';

let initialized = false;
let refreshTimer = 0;
let applying = false;
const employeeTasks = new Map();

export function initReportsCalendarDetails() {
  if (initialized) return;
  initialized = true;

  const root = document.querySelector('[data-reports-root]');
  if (!root) return;

  const schedule = (delay = 220) => {
    if (applying) return;
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refreshCards(root), delay);
  };

  root.addEventListener('change', () => schedule(260), true);
  root.addEventListener('submit', () => schedule(420), true);
  root.addEventListener('click', event => {
    const overdue = event.target.closest('[data-reports-overdue-user]');
    if (overdue) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openTaskDialog(root, overdue.dataset.reportsOverdueUser || '', 'overdue');
      return;
    }

    const completed = event.target.closest('[data-reports-completed-calendar]');
    if (completed) {
      event.preventDefault();
      openEmployeeCalendar(completed.dataset.reportsCompletedCalendar || '');
      return;
    }

    if (event.target.closest('[data-reports-refresh], [data-reports-reset], .reports-show-btn')) {
      schedule(500);
    }
  }, true);

  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'reports') {
      schedule(300);
      window.setTimeout(() => schedule(0), 900);
    }
  });
  window.addEventListener('reports:reload', () => schedule(350));

  schedule(350);
  window.setTimeout(() => schedule(0), 1000);
}

async function refreshCards(root) {
  if (applying || root.dataset.reportsMode === 'quarter') return;
  const cards = [...root.querySelectorAll('.reports-employee-card')];
  if (!cards.length) return;

  const selectedDate = root.querySelector('[data-reports-date]')?.value || todayIso();
  applying = true;
  try {
    const [allPlanRows, selectedDayRows] = await Promise.all([
      dbApi.getCalendarTasks({ start: '2000-01-01', end: selectedDate }),
      dbApi.getCalendarTasks({ date: selectedDate })
    ]);
    const planRows = mergeTasks(allPlanRows, selectedDayRows);
    cards.forEach(card => refreshCardFromPlan(card, selectedDate, planRows));
  } catch (error) {
    console.warn('Не удалось получить задачи блока «План на неделю» для отчётов:', error);
  } finally {
    applying = false;
  }
}

function refreshCardFromPlan(card, selectedDate, planRows) {
  const name = card.querySelector('.reports-employee-head h4')?.textContent?.trim() || '';
  if (!name) return;

  const rows = planRows.filter(task => taskBelongsToEmployee(task, name));
  employeeTasks.set(employeeKey(name), rows);

  const hearings = rows.filter(task => taskDate(task) === selectedDate && isHearing(task));
  renderHearings(card, hearings, selectedDate);

  const overdue = rows.filter(task => !isDone(task) && taskDate(task) && taskDate(task) < selectedDate);
  const overdueButton = card.querySelector('[data-reports-overdue-user]');
  if (overdueButton) {
    overdueButton.dataset.reportsOverdueUser = employeeKey(name);
    const value = overdueButton.querySelector('strong');
    if (value) value.textContent = String(overdue.length);
  }

  const completed = rows.filter(isDone);
  addCompletedButton(card, name, completed.length);
  addPlanExclusionNote(card);
}

function taskBelongsToEmployee(task, employeeName) {
  const expected = normalize(employeeName);
  if (!expected) return false;

  const candidates = [
    task.user_name,
    task.user,
    task.full_name,
    task.owner_name,
    task.employee,
    task.executor,
    task.representative,
    task.case_executor,
    task.assigned_to_name,
    task.assignee_name
  ].map(normalize).filter(Boolean);

  return candidates.some(value => namesMatch(value, expected));
}

function namesMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftParts = left.split(' ').filter(Boolean);
  const rightParts = right.split(' ').filter(Boolean);
  if (!leftParts.length || !rightParts.length) return false;
  if (leftParts[0] !== rightParts[0]) return false;
  return leftParts.slice(1).every((part, index) => !rightParts[index + 1] || part[0] === rightParts[index + 1][0]);
}

function renderHearings(card, rows, selectedDate) {
  const section = card.querySelector('.reports-hearings-card');
  if (!section) return;
  const signature = rows.map(task => [task.id ?? task.task_id, taskTime(task), task.court, task.subject || task.description || task.desc].join('|')).join('||');
  const nextSignature = `${selectedDate}:${signature}`;
  if (section.dataset.calendarDetailsSignature === nextSignature) return;
  section.dataset.calendarDetailsSignature = nextSignature;

  const heading = section.querySelector('h5');
  const count = section.querySelector('.reports-section-title-row > span');
  if (heading) heading.textContent = `Судебные заседания ${formatDate(selectedDate)}`;
  if (count) count.textContent = String(rows.length);

  [...section.children].forEach(child => {
    if (!child.classList.contains('reports-section-title-row')) child.remove();
  });

  section.insertAdjacentHTML('beforeend', rows.length
    ? `<div class="reports-hearing-list">${rows.map(task => `<div class="reports-hearing-chip"><b>${escapeHtml(taskTime(task) || '—')}</b><span>${escapeHtml(task.court || 'Суд не указан')}</span><small>${escapeHtml(task.subject || task.description || task.desc || 'Данные дела не указаны')}</small></div>`).join('')}</div>`
    : '<div class="reports-hearings-empty"><i aria-hidden="true">⚖</i><strong>На выбранную дату заседаний нет</strong><p>Заседания выбранного сотрудника появятся здесь</p></div>');
}

function addPlanExclusionNote(card) {
  const textBlock = card.querySelector('.reports-plan-main > div:first-child');
  if (!textBlock || textBlock.querySelector('[data-reports-plan-note]')) return;
  const note = document.createElement('small');
  note.dataset.reportsPlanNote = '';
  note.className = 'reports-plan-exclusion-note';
  note.textContent = '*без учета судебных заседаний';
  const remaining = textBlock.querySelector('p');
  if (remaining) textBlock.insertBefore(note, remaining);
  else textBlock.append(note);
}

function addCompletedButton(card, name, count) {
  const plan = card.querySelector('.reports-plan-main');
  if (!plan) return;
  let button = plan.querySelector('[data-reports-completed-calendar]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tiny reports-completed-calendar-btn';
    button.dataset.reportsCompletedCalendar = name;
    plan.append(button);
  }
  button.dataset.reportsCompletedCalendar = name;
  button.textContent = `Посмотреть (${count})`;
}

function openTaskDialog(root, key, mode) {
  const rows = employeeTasks.get(key) || [];
  const selectedDate = root.querySelector('[data-reports-date]')?.value || todayIso();
  const tasks = mode === 'overdue'
    ? rows.filter(task => !isDone(task) && taskDate(task) && taskDate(task) < selectedDate)
    : rows.filter(isDone);

  let dialog = root.querySelector('[data-reports-calendar-task-dialog]');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.dataset.reportsCalendarTaskDialog = '';
    dialog.className = 'reports-overdue-dialog';
    root.append(dialog);
  }

  dialog.innerHTML = `<div class="reports-overdue-dialog-head"><div><h3>Просроченные задачи</h3><p>${tasks.length} задач</p></div><button class="icon-button" type="button" data-close-reports-calendar-task-dialog>×</button></div><div class="reports-overdue-dialog-body">${tasks.length ? tasks.map(renderTaskRow).join('') : '<div class="reports-task-empty">Просроченных задач нет</div>'}</div>`;
  dialog.querySelector('[data-close-reports-calendar-task-dialog]')?.addEventListener('click', () => dialog.close());
  dialog.showModal();
}

function renderTaskRow(task) {
  const title = task.description || task.desc || task.assignment || task.subject || task.task_type || task.type || 'Задача';
  return `<div class="reports-task-row"><strong>${escapeHtml(title)}</strong><span class="reports-task-date is-overdue">${escapeHtml(formatDate(taskDate(task)))}</span></div>`;
}

function openEmployeeCalendar(name) {
  try {
    sessionStorage.setItem('legal-dashboard-calendar-open-user-name', name);
  } catch {}
  window.openView?.('calendar');
  window.setTimeout(() => {
    const select = document.querySelector('#calendar [data-calendar-user]');
    if (!select) return;
    const option = [...select.options].find(item => normalize(item.textContent) === normalize(name));
    if (!option) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, 120);
}

function mergeTasks(...groups) {
  const result = [];
  const seen = new Set();
  for (const group of groups) {
    for (const task of Array.isArray(group) ? group : []) {
      const key = task.id ?? task.task_id ?? `${taskDate(task)}|${taskTime(task)}|${task.description || task.desc || task.assignment || ''}`;
      if (seen.has(String(key))) continue;
      seen.add(String(key));
      result.push(task);
    }
  }
  return result;
}

function isHearing(task) {
  const type = normalize(task.task_type || task.type || task.kind || task.event_type);
  return (type.includes('судеб') && type.includes('засед')) || type === 'hearing';
}

function isDone(task) {
  if (Number(task.done || task.is_done || task.completed || 0) === 1) return true;
  return ['done', 'completed', 'выполнено', 'исполнено'].includes(normalize(task.status));
}

function taskDate(task) {
  const value = String(task.date_str || task.date || task.start_date || task.deadline || task.event_date || '').trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return ru ? `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}` : '';
}

function taskTime(task) {
  return String(task.time_val || task.time || task.start_time || '').trim();
}

function employeeKey(name) { return normalize(name); }
function normalize(value) { return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function formatDate(value) { const [y, m, d] = String(value || '').split('-'); return d && m && y ? `${d}.${m}.${y}` : String(value || ''); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
