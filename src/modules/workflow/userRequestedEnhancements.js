let initialized = false;

export function initUserRequestedEnhancements() {
  if (initialized) return;
  initialized = true;

  // Временно отключён глобальный MutationObserver. Он отслеживал весь document.body,
  // а обработчик сам изменял DOM, из-за чего после входа запускался бесконечный цикл.
  // Основные контроллеры приложения и загрузка данных работают независимо от этого модуля.
}
