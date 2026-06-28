export function initCalendarExecutorPlacement() {
  if (window.__calendarExecutorPlacementInitialized) return;
  window.__calendarExecutorPlacementInitialized = true;

  const place = () => {
    const filter = document.querySelector('#calendar .calendar-user-filter');
    const toolbar = document.querySelector('#calendar .calendar-week-new-row');
    const executionButton = toolbar?.querySelector('[data-calendar-execution-mode]');
    if (!filter || !toolbar || !executionButton) return;

    const label = filter.querySelector('span');
    if (label) label.textContent = 'Исполнители';
    filter.classList.add('calendar-executor-inline-filter');
    if (filter.parentElement !== toolbar || filter.nextElementSibling !== executionButton) {
      toolbar.insertBefore(filter, executionButton);
    }
  };

  const root = document.querySelector('#calendar');
  if (root) {
    new MutationObserver(place).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('app:view-changed', event => {
    if (event.detail?.viewId === 'calendar') window.setTimeout(place, 0);
  });
  window.setTimeout(place, 0);
}