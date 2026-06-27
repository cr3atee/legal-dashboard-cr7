import { renderAppLayout } from './layout/appLayout.js';
import { initRouter } from './core/router.js';
import { initDashboard } from './dashboard/dashboard.js';
import { initGeneralCasesPage } from './modules/cases/generalCasesController.js';
import { initControlledCasesPage } from './modules/controlledCases/controlledCasesController.js';
import { initEnforcementPage } from './modules/enforcement/enforcementController.js';
import { initCalendarPage } from './modules/calendar/calendarController.js';
import { initSchedulePage } from './modules/schedule/scheduleController.js';
import { initEmergencyFundPage } from './modules/emergencyFund/emergencyFundController.js';
import { initMunicipalRegistryPage } from './modules/municipalRegistry/municipalRegistryController.js';
import { initMeetingsPage } from './modules/meetings/meetingsController.js';
import { initMeetingsWorkflowUi } from './modules/meetings/meetingsWorkflowUi.js';
import { initReportsPage } from './modules/reports/reportsController.js';
import { initReportsCompatibilityController } from './modules/reports/reportsCompatibilityController.js';
import { initAdminUsersPage } from './modules/adminUsers/adminUsersController.js';
import { initAdminDictionariesPage } from './modules/adminDictionaries/adminDictionariesController.js';
import { initMapFullscreenButton } from './modules/map/mapFullscreen.js';
import { initUtilityPanels } from './modules/utility/utilityPanelsController.js';
import { initAuthGate, initAuthUi } from './auth/authController.js';
import { initSidebarCollapse } from './layout/sidebarCollapse.js';
import { initThemeUi } from './core/theme.js';

export function initApp() {
  initAuthGate(session => {
    document.querySelector('#app').innerHTML = renderAppLayout(session);

    initAuthUi();
    initThemeUi();
    initSidebarCollapse();
    initRouter();
    initDashboard();
    initGeneralCasesPage();
    initControlledCasesPage();
    initEnforcementPage();
    initCalendarPage();
    initSchedulePage();
    initEmergencyFundPage();
    initMunicipalRegistryPage();
    initMeetingsPage();
    initMeetingsWorkflowUi();
    initReportsPage();
    initReportsCompatibilityController();
    initAdminUsersPage();
    initAdminDictionariesPage();
    initMapFullscreenButton();
    initUtilityPanels();
    initCaseNumberAutoYear();
  });
}

function initCaseNumberAutoYear() {
  if (window.__caseNumberAutoYearInitialized) return;
  window.__caseNumberAutoYearInitialized = true;
  document.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const name = String(input.name || '').toLowerCase();
    const label = input.closest('label')?.textContent?.toLowerCase() || '';
    const isPkField = name === 'case_no' || name === 'pk_number' || name === 'case_number' || label.includes('№ пк');
    if (!isPkField) return;
    const value = String(input.value || '');
    if (!value.endsWith('/')) return;
    input.value = `${value}${new Date().getFullYear()}`;
  });
}
