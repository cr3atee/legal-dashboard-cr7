import './styles/user-requested-enhancements.css';
import './styles/latest-user-requirements.css';
import { renderAppLayout } from './layout/appLayout.js';
import { initRouter } from './core/router.js';
import { initDashboard } from './dashboard/dashboard.js';
import { initCaseUiEnhancements } from './modules/cases/caseUiEnhancements.js';
import { initAppealCalculatorUiFix } from './modules/cases/appealCalculatorUiFix.js';
import { initAppealTaskDateBridge } from './modules/cases/appealTaskDateBridge.js';
import { initAppealActionCleanup } from './modules/cases/appealActionCleanup.js';
import { initLegalFieldSuggestions } from './modules/common/legalFieldSuggestions.js';
import { initGeneralCasesPage } from './modules/cases/generalCasesController.js';
import { initControlledCasesPage } from './modules/controlledCases/controlledCasesController.js';
import { initEnforcementPage } from './modules/enforcement/enforcementController.js';
import { initCalendarPage } from './modules/calendar/calendarController.js';
import { initCalendarSelectedUserOnly } from './modules/calendar/calendarSelectedUserOnly.js';
import { initSchedulePage } from './modules/schedule/scheduleController.js';
import { initEmergencyFundPage } from './modules/emergencyFund/emergencyFundController.js';
import { initMunicipalRegistryPage } from './modules/municipalRegistry/municipalRegistryController.js';
import { initMeetingsPage } from './modules/meetings/meetingsController.js';
import { initMeetingsWorkflowUi } from './modules/meetings/meetingsWorkflowUi.js';
import { initReportsPage } from './modules/reports/reportsController.js';
import { initReportsQuarterController } from './modules/reports/reportsQuarterController.js';
import { initAdminUsersPage } from './modules/adminUsers/adminUsersController.js';
import { initAdminDictionariesPage } from './modules/adminDictionaries/adminDictionariesController.js';
import { initMapFullscreenButton } from './modules/map/mapFullscreen.js';
import { initUtilityPanels } from './modules/utility/utilityPanelsController.js';
import { initUserRequestedEnhancements } from './modules/workflow/userRequestedEnhancements.js';
import { initAssignmentNotificationOpen } from './modules/workflow/assignmentNotificationOpen.js';
import { initNotificationViewedTab } from './modules/workflow/notificationViewedTab.js';
import { initParticipantCaseCreateGuard } from './modules/workflow/participantCaseCreateGuard.js';
import { initRoleUiPolicy } from './modules/workflow/roleUiPolicy.js';
import { initAuthGate, initAuthUi } from './auth/authController.js';
import { initSidebarCollapse } from './layout/sidebarCollapse.js';
import { initThemeUi } from './core/theme.js';

const initializers = [
  initAuthUi, initThemeUi, initSidebarCollapse, initRouter, initDashboard,
  initCaseUiEnhancements, initAppealCalculatorUiFix, initAppealTaskDateBridge,
  initAppealActionCleanup, initLegalFieldSuggestions, initParticipantCaseCreateGuard,
  initGeneralCasesPage, initControlledCasesPage, initEnforcementPage,
  initCalendarSelectedUserOnly, initCalendarPage, initSchedulePage,
  initEmergencyFundPage, initMunicipalRegistryPage, initMeetingsPage,
  initMeetingsWorkflowUi, initReportsPage, initReportsQuarterController,
  initAdminUsersPage, initAdminDictionariesPage, initMapFullscreenButton,
  initAssignmentNotificationOpen, initUtilityPanels, initNotificationViewedTab,
  initUserRequestedEnhancements, initRoleUiPolicy, initCaseNumberAutoYear
];

export function initApp() {
  initAuthGate(session => {
    document.querySelector('#app').innerHTML = renderAppLayout(session);
    for (const initialize of initializers) initialize();
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
    if (!['case_no', 'pk_number', 'case_number'].includes(name) && !label.includes('№ пк')) return;
    if (String(input.value || '').endsWith('/')) input.value += new Date().getFullYear();
  });
}
