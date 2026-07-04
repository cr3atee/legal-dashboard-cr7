let initialized = false;

const OLD_LABEL = 'Дата СЗ';
const NEW_LABEL = 'Дата судебного заседания';

export function initScheduleDateLabelFix() {
  if (initialized) return;
  initialized = true;

  patchAlertText();
  replaceVisibleText();

  const observer = new MutationObserver(() => replaceVisibleText());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function replaceVisibleText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue?.includes(OLD_LABEL)) nodes.push(node);
    node = walker.nextNode();
  }

  nodes.forEach(textNode => {
    textNode.nodeValue = textNode.nodeValue.replaceAll(OLD_LABEL, NEW_LABEL);
  });
}

function patchAlertText() {
  if (window.__scheduleDateLabelAlertPatch) return;
  window.__scheduleDateLabelAlertPatch = true;

  const originalAlert = window.alert.bind(window);
  window.alert = message => {
    const nextMessage = String(message ?? '').replaceAll(OLD_LABEL, NEW_LABEL);
    return originalAlert(nextMessage);
  };
}
