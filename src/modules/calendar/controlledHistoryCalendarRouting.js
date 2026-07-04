let initialized = false;

export function initControlledHistoryCalendarRouting() {
  if (initialized) return;
  initialized = true;

  // Клик по карточке календаря не должен переносить пользователя в другие разделы.
  // Связанное дело можно открыть штатно через кнопку «Подробнее» внутри окна события.
}
