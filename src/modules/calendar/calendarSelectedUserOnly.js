import { dbApi } from '../../api/dbApi.js';
import { getCurrentUserName } from '../../auth/session.js';

let initialized = false;

export function initCalendarSelectedUserOnly() {
  if (initialized) return;
  initialized = true;

  const original = dbApi.getCalendarTasks.bind(dbApi);
  dbApi.getCalendarTasks = async params => {
    const calendar = document.querySelector('#calendar');
    const select = calendar?.querySelector('[data-calendar-user]');
    const selectedEmployee = Number(select?.value || 0) > 0;
    const calendarVisible = calendar && calendar.offsetParent !== null;
    const asksCurrentUser = normalize(params?.user) === normalize(getCurrentUserName());

    if (calendarVisible && selectedEmployee && asksCurrentUser) return [];
    return original(params);
  };
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}
