const SHOW_DELAY_MS = 180;
const MIN_VISIBLE_MS = 360;

let nextOperationId = 1;
let visible = false;
let shownAt = 0;
let showTimer = 0;
let hideTimer = 0;

const operations = new Map();
const listeners = new Set();

function currentMessage() {
  const items = Array.from(operations.values());
  return items.length ? items[items.length - 1].message : 'Загрузка...';
}

function snapshot() {
  return {
    active: operations.size > 0,
    count: operations.size,
    visible,
    message: currentMessage()
  };
}

function emit() {
  const state = snapshot();
  listeners.forEach(listener => listener(state));
}

function clearTimer(timerId) {
  if (timerId) window.clearTimeout(timerId);
}

function setVisible(value) {
  if (visible === value) return;
  visible = value;
  if (visible) shownAt = Date.now();
  emit();
}

function scheduleShow() {
  clearTimer(hideTimer);
  hideTimer = 0;
  if (visible || showTimer) {
    emit();
    return;
  }

  showTimer = window.setTimeout(() => {
    showTimer = 0;
    if (operations.size > 0) setVisible(true);
  }, SHOW_DELAY_MS);
  emit();
}

function scheduleHide() {
  clearTimer(showTimer);
  showTimer = 0;
  if (!visible) {
    emit();
    return;
  }

  const elapsed = Date.now() - shownAt;
  const wait = Math.max(MIN_VISIBLE_MS - elapsed, 0);
  clearTimer(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    if (operations.size === 0) setVisible(false);
  }, wait);
  emit();
}

export function startGlobalLoading(message = 'Загрузка...') {
  const id = nextOperationId;
  nextOperationId += 1;
  operations.set(id, { message: message || 'Загрузка...' });
  scheduleShow();

  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    operations.delete(id);
    if (operations.size > 0) {
      emit();
      return;
    }
    scheduleHide();
  };
}

export function subscribeGlobalLoading(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export async function withGlobalLoading(task, message = 'Загрузка...') {
  const finish = startGlobalLoading(message);
  try {
    return await (typeof task === 'function' ? task() : task);
  } finally {
    finish();
  }
}

export function isGlobalLoadingActive() {
  return operations.size > 0;
}
