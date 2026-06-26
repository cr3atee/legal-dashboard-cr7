export function initAssignmentNotificationUi() {
  if (window.__assignmentNotificationUiInitialized) return;
  window.__assignmentNotificationUiInitialized = true;

  const sync = root => {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll('[data-notification-open][data-source-type="calendar_assignment"]').forEach(button => {
      button.textContent = 'Открыть';
      button.setAttribute('aria-label', 'Открыть поручение в календаре');
    });
  };

  sync(document);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node instanceof Element) sync(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
