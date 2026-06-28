export function renderCalendarPage() {
  return `
    <section class="view" id="calendar">
      <div class="page-head cases-head calendar-head">
        <div class="calendar-title-row">
          <h2>Календарь</h2>
          <button class="btn icon-only calendar-refresh-icon" data-calendar-refresh type="button" title="Обновить" aria-label="Обновить">↻</button>
        </div>
      </div>

      <div class="calendar-shell" data-calendar-shell>
        <aside class="calendar-month-panel" data-calendar-month-panel>
          <div class="calendar-toolbar">
            <div class="calendar-nav">
              <button class="btn small" data-calendar-prev type="button">‹</button>
              <strong data-calendar-month-title>Месяц</strong>
              <button class="btn small" data-calendar-next type="button">›</button>
              <button class="btn small" data-calendar-today type="button">Сегодня</button>
            </div>
          </div>

          <div class="calendar-main-card" data-calendar-main-card>
            <div class="calendar-weekdays">
              <span>ПН</span><span>ВТ</span><span>СР</span><span>ЧТ</span><span>ПТ</span><span>СБ</span><span>ВС</span>
            </div>
            <div class="calendar-month-grid" data-calendar-grid></div>
          </div>
        </aside>

        <button class="calendar-collapse-toggle" data-calendar-collapse-toggle type="button" aria-label="Скрыть календарь">‹</button>

        <section class="calendar-week-card">
          <div class="calendar-week-new-row">
            <label class="calendar-user-filter calendar-executor-inline" data-calendar-executor-control>
              <span>Исполнители</span>
              <select data-calendar-user>
                <option value="0">Только мой календарь</option>
              </select>
            </label>
            <button class="btn small calendar-execution-toggle" data-calendar-execution-mode type="button" aria-pressed="false">Отметить исполнения</button>
            <button class="btn primary" data-calendar-new type="button">Новая запись</button>
          </div>

          <div class="calendar-week-card-head">
            <button class="btn small calendar-week-arrow" data-calendar-week-prev type="button">‹</button>
            <div>
              <h3>План на неделю</h3>
              <p data-calendar-week-range>Текущая неделя</p>
            </div>
            <button class="btn small calendar-week-arrow" data-calendar-week-next type="button">›</button>
          </div>

          <div class="calendar-week-tools">
            <label>
              <span>Закрасить по типу:</span>
              <select data-calendar-color-filter>
                <option value="">Не выбрано</option>
                <option value="судебное_заседание">Судебное заседание</option>
                <option value="отзыв">Отзыв/жалоба</option>
                <option value="поручение">Поручение</option>
                <option value="иное">Иное</option>
              </select>
            </label>
            <input data-calendar-color-picker type="color" value="#dbeafe" title="Цвет строки">
            <button class="btn small" data-calendar-color-reset type="button">Сбросить цвет</button>
            <button class="btn small" data-calendar-plan-run type="button">Сформировать план</button>
          </div>

          <div class="calendar-week-plan" data-calendar-week-plan-grid></div>
        </section>
      </div>

      <aside class="calendar-side-card">
        <div class="calendar-side-head">
          <h3 data-calendar-side-title>Задачи на выбранную дату</h3>
        </div>
        <div class="calendar-task-list" data-calendar-task-list></div>
      </aside>


<dialog class="calendar-move-dialog" data-calendar-move-dialog>
  <div class="calendar-dialog-head compact">
    <div><h3>Изменить время?</h3><p data-calendar-move-date></p></div>
    <button class="icon-button" data-calendar-move-cancel type="button">×</button>
  </div>
  <div class="calendar-move-body">
    <p>Перенести запись на выбранный день?</p>
  </div>
  <div class="calendar-dialog-actions">
    <button class="btn" data-calendar-move-no type="button">Нет</button>
    <button class="btn primary" data-calendar-move-yes type="button">Да</button>
  </div>
</dialog>

<dialog class="calendar-move-time-dialog" data-calendar-move-time-dialog>
  <div class="calendar-dialog-head compact">
    <div><h3>Новое время</h3><p data-calendar-move-time-date></p></div>
    <button class="icon-button" data-calendar-time-move-back type="button">×</button>
  </div>
  <div class="calendar-move-body">
    <label>
      <span>Время (ЧЧ:ММ)</span>
      <input data-calendar-move-time-input data-calendar-time maxlength="5" placeholder="ЧЧ:ММ" autocomplete="off">
    </label>
  </div>
  <div class="calendar-dialog-actions">
    <button class="btn" data-calendar-time-move-back type="button">Назад</button>
    <button class="btn primary" data-calendar-time-move-save type="button">Сохранить</button>
  </div>
</dialog>


<dialog class="calendar-conflict-dialog" data-calendar-conflict-dialog>
  <div class="calendar-dialog-head">
    <div><h3>Конфликт расписания</h3><p data-calendar-conflict-summary></p></div>
    <button class="icon-button" data-calendar-conflict-cancel type="button">×</button>
  </div>
  <div class="calendar-conflict-body">
    <div class="calendar-conflict-list" data-calendar-conflict-list></div>
    <label><span>Замещающий сотрудник</span><select data-calendar-conflict-delegate><option value="">Не выбран</option></select></label>
    <p class="calendar-conflict-hint">При жестком конфликте выберите коллегу: связанные заседания и сроки появятся в его графике как делегированные.</p>
  </div>
  <div class="calendar-dialog-actions">
    <button class="btn" data-calendar-conflict-cancel type="button">Отмена</button>
    <button class="btn primary" data-calendar-conflict-confirm type="button">Подтвердить и делегировать коллеге</button>
  </div>
</dialog>

<dialog class="calendar-dependent-dialog" data-calendar-dependent-dialog>
  <div class="calendar-dialog-head compact">
    <div>
      <h3 data-calendar-dependent-title>Связанные задачи</h3>
      <p data-calendar-dependent-message></p>
    </div>
    <button class="icon-button" data-calendar-dependent-close type="button">×</button>
  </div>
  <div class="calendar-dependent-body">
    <p class="calendar-dependent-hint">Можно пересчитать сроки автоматически или выбрать дату вручную.</p>
    <ul class="calendar-dependent-list" data-calendar-dependent-list></ul>
    <label class="calendar-dependent-date-field">
      <span>Указать дату вручную</span>
      <input data-calendar-dependent-date type="date">
    </label>
  </div>
  <div class="calendar-dialog-actions calendar-dependent-actions">
    <button class="btn" data-calendar-dependent-skip type="button">Нет, оставлю как есть</button>
    <button class="btn" data-calendar-dependent-manual type="button">Применить выбранную дату</button>
    <button class="btn primary" data-calendar-dependent-auto type="button">Да, пересчитать</button>
  </div>
</dialog>

<dialog class="calendar-task-dialog" data-calendar-task-dialog>
        <form data-calendar-task-form>
          <div class="calendar-dialog-head">
            <div>
              <h3 data-calendar-dialog-title>Новое событие</h3>
              <p data-calendar-dialog-subtitle>Единая форма рабочего и личного плана</p>
            </div>
            <button class="icon-button" data-calendar-close type="button">×</button>
          </div>

          <input type="hidden" name="id">

          <div class="calendar-dialog-body">
            <div class="calendar-event-scope" role="tablist" aria-label="Тип планирования">
              <label><input type="radio" name="event_scope" value="work" checked><span>Рабочее</span></label>
              <label><input type="radio" name="event_scope" value="personal"><span>Личное</span></label>
            </div>
            <input name="end_date" type="hidden">
            <input name="end_time" type="hidden">
            <input name="personal_kind" type="hidden" value="Личное событие">

            <fieldset class="calendar-task-type-section" data-calendar-work-fields>
              <legend>Тип записи</legend>
              <div class="calendar-task-types">
                <label><input type="radio" name="type" value="судебное_заседание"><span>⚖️ Судебное заседание</span></label>
                <label><input type="radio" name="type" value="процессуальный_срок"><span>⏰ Процессуальный срок</span></label>
                <label><input type="radio" name="type" value="отзыв"><span>✎ Подготовка отзыва/жалобы</span></label>
                <label><input type="radio" name="type" value="поручение"><span>! Контрольное поручение</span></label>
                <label><input type="radio" name="type" value="рабочая_заметка"><span>📝 Рабочая заметка</span></label>
                <label><input type="radio" name="type" value="иное"><span>◆ Иное</span></label>
              </div>
            </fieldset>

            <div class="calendar-form-grid">
              <label data-calendar-field="date"><span>Дата</span><input name="date" type="date" required></label>
              <label data-calendar-field="time"><span>Время начала</span><input name="time" data-calendar-time maxlength="5" autocomplete="off"></label>
            </div>

            <label class="calendar-full-field" data-calendar-field="desc"><span>Название события</span><input name="desc" autocomplete="off"></label>

            <div class="calendar-form-grid" data-calendar-case-fields>
              <label data-calendar-field="court"><span>Суд</span><input name="court" list="calendarCourtsList" autocomplete="off"></label>
              <label data-calendar-field="subject"><span>Предмет</span><input name="subject" autocomplete="off"></label>
              <label class="calendar-full-field" data-calendar-field="assignment"><span>Поручение</span><input name="assignment" autocomplete="off"></label>
            </div>

            <label class="calendar-full-field" data-calendar-field="note_text"><span data-calendar-note-label>Заметка / напоминание</span><textarea name="note_text" rows="3"></textarea></label>
            <div class="calendar-form-error" data-calendar-form-error hidden></div>
            <p class="calendar-privacy-hint" data-calendar-privacy-hint hidden>Личная заметка видна только вам. При просмотре руководителем отображается только занятость «Отсутствие».</p>

            <datalist id="calendarCourtsList"></datalist>
          </div>

          <div class="calendar-dialog-actions calendar-task-dialog-actions">
            <div class="calendar-dialog-left-actions">
              <button class="btn" data-calendar-form-link type="button" hidden>Связать с общим перечнем</button>
              <button class="btn" data-calendar-form-more type="button" hidden>Подробнее</button>
            </div>
            <div class="calendar-dialog-right-actions">
              <button class="btn danger calendar-delete-icon-btn" data-calendar-delete type="button" title="Удалить событие" aria-label="Удалить событие" hidden>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 6h18"></path>
                  <path d="M8 6V4h8v2"></path>
                  <path d="M19 6l-1 14H6L5 6"></path>
                  <path d="M10 11v5"></path>
                  <path d="M14 11v5"></path>
                </svg>
              </button>
              <button class="btn primary" type="submit">Сохранить</button>
            </div>
          </div>
        </form>
      </dialog>

      <dialog class="calendar-case-link-dialog" data-calendar-case-link-dialog>
        <div class="calendar-dialog-head">
          <div><h3>Связь с общим перечнем</h3><p>Выберите дело, не покидая календарь.</p></div>
          <button class="icon-button" data-calendar-case-link-close type="button">&times;</button>
        </div>
        <div class="calendar-case-link-body">
          <label><span>Поиск по № ПК, суду, сторонам или предмету</span><input data-calendar-case-link-query autocomplete="off"></label>
          <div class="calendar-form-error" data-calendar-case-link-error hidden></div>
          <div class="calendar-case-link-results" data-calendar-case-link-results></div>
        </div>
        <div class="calendar-dialog-actions">
          <button class="btn" data-calendar-case-link-close type="button">Закрыть</button>
          <button class="btn primary" data-calendar-case-link-search type="button">Найти</button>
        </div>
      </dialog>

      <dialog class="calendar-case-question-dialog" data-calendar-case-question-dialog>
        <div class="calendar-dialog-head">
          <div><h3>Связать дело с общим перечнем?</h3><p>Можно заполнить суд и предмет из выбранной карточки.</p></div>
          <button class="icon-button" data-calendar-case-question-no type="button">&times;</button>
        </div>
        <div class="calendar-dialog-actions">
          <button class="btn" data-calendar-case-question-no type="button">Нет</button>
          <button class="btn primary" data-calendar-case-question-yes type="button">Да</button>
        </div>
      </dialog>

      <dialog class="calendar-confirm-dialog" data-calendar-confirm-dialog>
        <div class="calendar-dialog-head">
          <div><h3 data-calendar-confirm-title>Подтверждение</h3><p data-calendar-confirm-message></p></div>
          <button class="icon-button" data-calendar-confirm-cancel type="button">&times;</button>
        </div>
        <div class="calendar-dialog-actions">
          <button class="btn" data-calendar-confirm-cancel type="button">Отмена</button>
          <button class="btn danger" data-calendar-confirm-ok type="button">Удалить</button>
        </div>
      </dialog>

      <dialog class="calendar-detail-dialog" data-calendar-detail-dialog>
        <div class="calendar-dialog-head">
          <div><h3>Просмотр дела</h3><p data-calendar-detail-date></p></div>
          <button class="icon-button" data-calendar-detail-close type="button">×</button>
        </div>
        <div class="calendar-detail-body" data-calendar-detail-body></div>
        <div class="calendar-dialog-actions">
          <button class="btn danger" data-calendar-detail-delete type="button">Удалить</button>
          <button class="btn" data-calendar-detail-more type="button" hidden>Подробнее</button>
          <button class="btn" data-calendar-detail-close type="button">Закрыть</button>
        </div>
      </dialog>
    </section>
  `;
}