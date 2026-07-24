let initialized = false;
let scheduled = false;

const REPLACEMENTS = [
  ['Исполнители', 'Представители'],
  ['исполнители', 'представители'],
  ['Исполнитель', 'Представитель'],
  ['исполнитель', 'представитель'],
  ['Исполнителя', 'Представителя'],
  ['исполнителя', 'представителя'],
  ['Исполнителем', 'Представителем'],
  ['исполнителем', 'представителем']
];

export function initRepresentativeLabelTextFix() {
  if (initialized) return;
  initialized = true;

  const runSoon = () => scheduleReplace();

  document.addEventListener('click', runSoon, true);
  document.addEventListener('change', runSoon, true);
  document.addEventListener('submit', runSoon, true);

  window.addEventListener('app:view-changed', runSoon);
  window.addEventListener('general-cases:updated', runSoon);
  window.addEventListener('general-cases:reload', runSoon);
  window.addEventListener('controlled-cases:updated', runSoon);
  window.addEventListener('controlled-cases:reload', runSoon);
  window.addEventListener('calendar:updated', runSoon);
  window.addEventListener('calendar:reload', runSoon);
  window.addEventListener('schedule:reload', runSoon);
  window.addEventListener('reports:reload', runSoon);

  scheduleReplace();
  window.setTimeout(scheduleReplace, 150);
  window.setTimeout(scheduleReplace, 600);
}

function scheduleReplace() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    scheduled = false;
    replaceExecutorLabels(document.body);
  }, 0);
}

function replaceExecutorLabels(root) {
  if (!root) return;
  replaceTextNodes(root);
  replaceAttributes(root);
}

function replaceTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('script, style, textarea, input')) return NodeFilter.FILTER_REJECT;
      if (parent.closest('#calendar [data-calendar-field="executor"], #calendar [data-calendar-task-owner]')) return NodeFilter.FILTER_REJECT;
      return hasExecutorLabel(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }

  nodes.forEach(textNode => {
    textNode.nodeValue = replaceExecutorText(textNode.nodeValue);
  });
}

function replaceAttributes(root) {
  const selector = '[placeholder*="Исполн"], [title*="Исполн"], [aria-label*="Исполн"], [data-label*="Исполн"]';
  const nodes = [];
  if (root.matches?.(selector)) nodes.push(root);
  nodes.push(...root.querySelectorAll?.(selector) || []);

  nodes.forEach(node => {
    if (node.closest?.('#calendar [data-calendar-field="executor"], #calendar [data-calendar-task-owner]')) return;
    ['placeholder', 'title', 'aria-label', 'data-label'].forEach(attribute => {
      const value = node.getAttribute(attribute);
      if (hasExecutorLabel(value)) node.setAttribute(attribute, replaceExecutorText(value));
    });
  });
}

function hasExecutorLabel(value) {
  return REPLACEMENTS.some(([from]) => String(value || '').includes(from));
}

function replaceExecutorText(value) {
  return REPLACEMENTS.reduce((text, [from, to]) => text.replaceAll(from, to), String(value || ''));
}
