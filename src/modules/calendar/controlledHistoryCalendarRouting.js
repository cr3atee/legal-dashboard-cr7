import { dbApi } from '../../api/dbApi.js';
import { getCurrentUserName } from '../../auth/session.js';
import { showNotification } from '../../layout/notifications.js';

let initialized = false;

export function initControlledHistoryCalendarRouting() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-calendar-task-id], [data-calendar-week-task-id]');
    if (!target || target.dataset.calendarRoutingBypass === '1') return;

    const id = Number(target.dataset.calendarTaskId || target.dataset.calendarWeekTaskId || 0);
    if (!id) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openLinkedCalendarSource(id).catch(error => {
      console.warn('Не удалось открыть источник события календаря:', error);
      showNotification('Не удалось открыть связанную карточку', 'error');
    });
  }, true);
}

async function openLinkedCalendarSource(id) {
  const user = getCurrentUserName();
  const rows = await dbApi.getCalendarTasks({ user }).catch(() => []);
  const task = rows.find(row => Number(row.id || 0) === Number(id));

  if (!task) {
    showNotification('Событие календаря не найдено', 'error');
    return;
  }

  const metadata = parseMetadata(task.metadata_json || task.metadata || '{}');
  if (metadata.source !== 'controlled_history') {
    redispatchOrdinaryCalendarClick(id);
    return;
  }

  const controlledCaseId = Number(metadata.controlled_case_id || 0);
  const generalCaseId = Number(task.general_case_id || 0);

  if (metadata.history_type === 'hearing' && generalCaseId) {
    document.querySelector('[data-view="schedule"]')?.click();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('schedule:open-general-case', {
        detail: { generalCaseId }
      }));
    }, 160);
    showNotification('Открываю связанное судебное заседание');
    return;
  }

  if (controlledCaseId) {
    document.querySelector('[data-view="controlledCases"]')?.click();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('reports:open-controlled-case', {
        detail: { id: controlledCaseId, sourceView: 'calendar' }
      }));
    }, 160);
    showNotification('Открываю связанное контрольное дело');
    return;
  }

  if (generalCaseId) {
    document.querySelector('[data-view="cases"]')?.click();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('general-cases:open-case', {
        detail: { id: generalCaseId, sourceView: 'calendar' }
      }));
    }, 160);
    showNotification('Открываю связанное дело');
    return;
  }

  showNotification('У события не найдена связанная карточка', 'error');
}

function redispatchOrdinaryCalendarClick(id) {
  const selector = `[data-calendar-task-id="${id}"], [data-calendar-week-task-id="${id}"]`;
  const node = document.querySelector(selector);
  if (!node) return;
  node.dataset.calendarRoutingBypass = '1';
  setTimeout(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    delete node.dataset.calendarRoutingBypass;
  }, 0);
}

function parseMetadata(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
