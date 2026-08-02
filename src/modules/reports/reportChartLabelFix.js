let initialized = false;
let observer = null;

export function initReportChartLabelFix() {
  if (initialized) return;
  initialized = true;

  const patch = () => {
    document.querySelectorAll('#reports .reports-column-chart .reports-column-bar').forEach(bar => {
      if (bar.dataset.labelValueMerged === '1') return;

      const value = bar.querySelector(':scope > b');
      const label = bar.querySelector('.reports-column-bar-label');
      if (!value || !label) return;

      const categoryText = String(label.textContent || '').trim();
      const valueText = String(value.textContent || '').trim();
      if (!categoryText || !valueText) return;

      label.textContent = `${categoryText} — ${valueText}`;
      value.remove();
      bar.dataset.labelValueMerged = '1';
    });
  };

  patch();
  observer = new MutationObserver(patch);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('app:view-changed', patch);
  window.addEventListener('reports:reload', patch);
}
