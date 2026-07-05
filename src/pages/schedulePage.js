export function renderSchedulePage() {
  const chevronLeft = renderChevronIcon('left');
  const chevronRight = renderChevronIcon('right');

  return `
    <section class="view schedule-view" id="schedule">
      <div class="page-head schedule-page-head">
        <div class="schedule-title-row">
          <span class="schedule-title-icon" aria-hidden="true">🏛️</span>
          <h2>График судебных заседаний</h2>
          <button class="icon-button schedule-refresh-icon" data-schedule-refresh type="button" aria-label="Обновить" title="Обновить">↻</button>
          <button class="btn primary schedule-add-date-action" data-schedule-date-new type="button">📅 Добавить дату</button>
        </div>
      </div>

      <div class="cases-toolbar schedule-search-toolbar">
        <div class="search-field-wrap">
          <input
            class="search-input"
            data-schedule-search
            type="search"
            placeholder="Поиск через запятую: дата, суд, время, представитель, истец, ответчик, результат, предмет."
          >
          <span class="search-field-icon" aria-hidden="true">🔍</span>
        </div>
        <div class="cases-toolbar-status">
          <span data-schedule-count>0 дел</span>
          <span data-schedule-db-status>База не проверена</span>
        </div>
      </div>

      <div class="schedule-board">
        <aside class="schedule-dates-panel">
          <div class="schedule-dates-head">
            <h3>Даты заседаний</h3>
            <p data-schedule-date-total>0 дел в 0 датах</p>
          </div>
          <div class="schedule-date-list" data-schedule-date-list>
            <div class="schedule-empty-line">Загрузка...</div>
          </div>
        </aside>

        <section class="schedule-groups-panel" data-schedule-groups>
          <div class="schedule-empty-line">Загрузка...</div>
        </section>
      </div>

      <dialog class="schedule-date-dialog" data-schedule-date-dialog>
        <div class="schedule-dialog-head schedule-date-dialog-head">
          <div>
            <h3>Добавить дату</h3>
            <p>Выберите дату в мини-календаре</p>
          </div>
          <button class="icon-button" data-schedule-date-close type="button">×</button>
        </div>

        <div class="schedule-dialog-body schedule-date-dialog-body">
          <input data-schedule-date-input type="hidden">
          <div class="schedule-mini-calendar" data-schedule-mini-calendar>
            <div class="schedule-mini-calendar-head">
              <button class="icon-button" data-schedule-mini-prev type="button" aria-label="Предыдущий месяц">${chevronLeft}</button>
              <strong data-schedule-mini-title></strong>
              <button class="icon-button" data-schedule-mini-next type="button" aria-label="Следующий месяц">${chevronRight}</button>
            </div>
            <div class="schedule-mini-weekdays">
              <span>ПН</span><span>ВТ</span><span>СР</span><span>ЧТ</span><span>ПТ</span><span>СБ</span><span>ВС</span>
            </div>
            <div class="schedule-mini-days" data-schedule-mini-days></div>
          </div>
          <button class="btn small schedule-mini-today" data-schedule-date-today type="button">Сегодня</button>
        </div>

        <div class="schedule-dialog-actions">
          <button class="btn" data-schedule-date-close type="button">Отмена</button>
          <button class="btn primary" data-schedule-date-save type="button">OK</button>
        </div>
      </dialog>

      <dialog class="schedule-case-dialog" data-schedule-case-dialog>
        <form data-schedule-case-form>
          <div class="schedule-dialog-head">
            <div>
              <h3 data-schedule-case-title>Добавить дело</h3>
              <p data-schedule-case-subtitle>Дата-группа</p>
            </div>
            <button class="icon-button" data-schedule-case-close type="button">×</button>
          </div>

          <input type="hidden" name="id">
          <input type="hidden" name="session_date">
          <input type="hidden" name="general_case_id">
          <input type="hidden" name="meeting_id">

          <div class="schedule-dialog-body">
            <div class="schedule-form-grid">
              <label>
                <span>Суд</span>
                <input name="court" list="scheduleCourtsList" autocomplete="off">
              </label>

              <label>
                <span>Результат</span>
                <input name="category" list="scheduleStagesList" autocomplete="off">
              </label>

              <label>
                <span>Истец</span>
                <input name="plaintiff" autocomplete="off">
              </label>

              <label>
                <span>Ответчик</span>
                <input name="defendant" autocomplete="off">
              </label>

              <label class="wide">
                <span>Предмет спора</span>
                <input name="result" autocomplete="off">
              </label>

              <div class="schedule-meta-row wide">
                <label class="schedule-representative-field">
                  <span>Представитель</span>
                  <input name="representative" list="scheduleRepresentativesList" autocomplete="off">
                </label>

                <label class="schedule-hearing-date-field" data-schedule-hearing-date-wrap>
                  <span>Дата судебного заседания</span>
                  <input class="schedule-hearing-date-input" name="hearing_date" data-schedule-date maxlength="10" placeholder="ДД.ММ.ГГГГ">
                </label>

                <label class="schedule-hearing-time-field">
                  <span>Время</span>
                  <input class="schedule-hearing-time-input" name="time" data-schedule-time maxlength="5" placeholder="ЧЧ:ММ" autocomplete="off" aria-label="Время судебного заседания">
                </label>

                <button class="btn small schedule-hearing-today-button" data-schedule-hearing-today type="button">Сегодня</button>
              </div>
            </div>

            <datalist id="scheduleCourtsList"></datalist>
            <datalist id="scheduleRepresentativesList"></datalist>
            <datalist id="scheduleStagesList"></datalist>
          </div>

          <div class="schedule-dialog-actions schedule-case-dialog-actions">
            <button class="btn" data-schedule-case-more type="button" hidden>Подробнее</button>
            <button class="btn danger" data-schedule-delete type="button" hidden>🗑️ Удалить</button>
            <span class="schedule-case-actions-spacer"></span>
            <button class="btn" data-schedule-case-close type="button">Отмена</button>
            <button class="btn primary" type="submit">💾 Сохранить</button>
          </div>
        </form>
      </dialog>
    </section>
  `;
}

function renderChevronIcon(direction) {
  const paths = {
    left: 'm15 18-6-6 6-6',
    right: 'm9 18 6-6-6-6',
  };
  return `<svg class="schedule-mini-chevron-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[direction]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
