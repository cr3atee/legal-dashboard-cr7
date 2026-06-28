const DICTIONARY_CATEGORIES = [
  ['case_category', 'Категории дел'],
  ['claim_subject', 'Предметы спора'],
  ['case_party', 'Истцы и ответчики'],
  ['procedural_position', 'Процессуальные положения'],
  ['appeal_act_type', 'Типы судебных актов'],
  ['appeal_type', 'Виды обжалования'],
  ['court', 'Суды'],
  ['stage', 'Результаты рассмотрения'],
  ['requirements', 'Требования'],
  ['prosecutor', 'Прокуроры'],
  ['district', 'Районы'],
  ['representatives', 'Представители'],
  ['msu_ip', 'Участники совещания'],
  ['invited_ip', 'Приглашенные'],
];

export function renderAdminDictionariesPage() {
  return `
    <section class="view admin-dictionaries-view" id="adminDictionaries">
      <div class="page-head admin-page-head">
        <div>
          <h2>Справочники</h2>
          <p>Управление значениями, которые используются в карточках дел, графике, реестре, аварийном фонде и совещаниях.</p>
        </div>
        <button class="btn primary admin-back-btn" data-view="admin" type="button">Назад</button>
      </div>

      <div class="admin-users-layout admin-dictionaries-layout">
        <form class="panel admin-users-form" data-admin-dictionary-form>
          <input type="hidden" name="id">
          <label>
            <span>Справочник</span>
            <select name="category">
              ${DICTIONARY_CATEGORIES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
            </select>
          </label>
          <label>
            <span data-admin-dictionary-value-label>Значение</span>
            <input name="value" required autocomplete="off">
          </label>
          <label data-admin-meeting-field hidden>
            <span>Должность</span>
            <input name="position" autocomplete="off">
          </label>
          <label data-admin-meeting-field hidden>
            <span>Руководство</span>
            <input name="leadership" list="admin-dictionary-leadership-options" autocomplete="off">
            <datalist id="admin-dictionary-leadership-options" data-admin-leadership-options></datalist>
          </label>
          <label class="admin-users-active admin-dictionary-leadership-empty" data-admin-meeting-field hidden>
            <input name="leadership_empty" type="checkbox">
            <span>Не добавлять в руководство</span>
          </label>
          <div class="admin-users-actions">
            <button class="btn primary" type="submit">Сохранить</button>
            <button class="btn" data-admin-dictionary-reset type="button">Новое значение</button>
          </div>
          <p class="admin-users-status" data-admin-dictionaries-status></p>
        </form>

        <article class="panel admin-users-list-panel">
          <div class="case-card-head">
            <h3>Значения справочников</h3>
          </div>
          <div class="table-wrap">
            <table class="admin-users-table">
              <thead data-admin-dictionaries-head></thead>
              <tbody data-admin-dictionaries-body>
                <tr><td colspan="5">Загрузка...</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  `;
}

export { DICTIONARY_CATEGORIES };
