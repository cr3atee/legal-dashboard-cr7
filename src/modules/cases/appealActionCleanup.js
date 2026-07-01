import '../../styles/general-case-marks.css';
import { initGeneralCaseUiPolish } from './generalCaseUiPolish.js';
import { initGeneralCasePkNumber } from './generalCasePkNumber.js';

let timer = null;

export function initAppealActionCleanup() {
  initGeneralCaseUiPolish();
  initGeneralCasePkNumber();

  const root = document.querySelector('#cases');
  if (!root) return;
  const clean = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      root.querySelectorAll('[data-general-print-row], [data-general-restore-template]').forEach(node => node.remove());
      root.querySelectorAll('[data-general-case-tab-panel="appeal"] button, [data-general-appeal-result] button').forEach(button => {
        const text = String(button.textContent || '').toLowerCase();
        if (text.includes('распечатать') || text.includes('восстановлен')) button.remove();
      });
    }, 20);
  };
  new MutationObserver(clean).observe(root, { childList: true, subtree: true });
  clean();
}
