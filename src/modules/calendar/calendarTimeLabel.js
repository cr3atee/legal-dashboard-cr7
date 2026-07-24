let initialized = false;

function renameCalendarTimeLabel(root = document) {
  const inputs = root.querySelectorAll?.('[data-calendar-task-form] input[name="time"], [data-calendar-task-form] [data-calendar-time]') || [];
  inputs.forEach(input => {
    const label = input.closest('label');
    if (!label) return;

    const textNode = [...label.childNodes].find(node =>
      node.nodeType === Node.TEXT_NODE && /время\s+начала/i.test(node.textContent || '')
    );
    if (textNode) {
      textNode.textContent = textNode.textContent.replace(/Время\s+начала/gi, 'Время');
      return;
    }

    const caption = label.querySelector('span, strong, b');
    if (caption && /время\s+начала/i.test(caption.textContent || '')) {
      caption.textContent = caption.textContent.replace(/Время\s+начала/gi, 'Время');
    }
  });
}

export function initCalendarTimeLabel() {
  if (initialized) return;
  initialized = true;

  renameCalendarTimeLabel();
  window.addEventListener('app:view-changed', () => queueMicrotask(() => renameCalendarTimeLabel()));
  window.addEventListener('calendar:updated', () => renameCalendarTimeLabel());
  window.addEventListener('calendar:edit-task', () => queueMicrotask(() => renameCalendarTimeLabel()));
  document.addEventListener('click', () => queueMicrotask(() => renameCalendarTimeLabel()), true);
}
