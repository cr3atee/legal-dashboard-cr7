export function renderReportsPage() {
  const currentYear = new Date().getFullYear();
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  return `
    <section class="view reports-view reports-redesign-view" id="reports" data-reports-root>
      <article class="panel reports-analytics-bar" aria-labelledby="reports-title">
        <form class="reports-filters" data-reports-filters>
          <div class="reports-title-block">
            <div class="reports-eyebrow">Аналитика</div>
            <div class="reports-title-line">
              <h2 id="reports-title" data-reports-title>Ежедневный отчёт</h2>
              <button class="btn primary icon-only reports-refresh-btn" type="button" data-reports-refresh aria-label="Обновить" title="Обновить">
                <span aria-hidden="true">↻</span>
              </button>
            </div>
            <p class="muted reports-updated" data-reports-updated>Данные ещё не загружены.</p>
          </div>

          <fieldset class="reports-mode-toggle" aria-label="Режим отчёта">
            <label>
              <input type="radio" name="reports-mode" value="day" data-reports-mode checked>
              <span>За день</span>
            </label>
            <label>
              <input type="radio" name="reports-mode" value="quarter" data-reports-mode>
              <span>За квартал</span>
            </label>
          </fieldset>

          <label class="reports-period-field" data-reports-day-field>
            <span>Дата</span>
            <input type="date" value="${today}" data-reports-date>
          </label>

          <label class="reports-period-field" data-reports-quarter-field hidden>
            <span>Год</span>
            <input type="number" min="2000" max="2100" step="1" value="${currentYear}" data-reports-year>
          </label>

          <label class="reports-period-field" data-reports-quarter-field hidden>
            <span>Квартал</span>
            <select data-reports-quarter>
              <option value="1">I квартал</option>
              <option value="2">II квартал</option>
              <option value="3">III квартал</option>
              <option value="4">IV квартал</option>
            </select>
          </label>

          <div class="reports-user-picker" data-reports-manager-panel hidden>
            <span>Сотрудники</span>
            <button class="reports-user-picker-toggle" type="button" data-reports-users-toggle aria-expanded="false">
              <span data-reports-users-label>Выберите сотрудников</span>
            </button>
            <div class="reports-user-picker-menu" data-reports-users-menu hidden>
              <div class="reports-user-picker-options" data-reports-users-options></div>
            </div>
          </div>
          <select multiple data-reports-users hidden></select>
          <input type="checkbox" data-reports-all-users checked hidden>

          <button class="btn primary reports-show-btn" type="submit">Показать</button>
          <button class="btn ghost" type="button" data-reports-reset>Сбросить</button>
        </form>
      </article>

      <div class="reports-status" data-reports-status></div>

      <section class="reports-mode-panel" data-reports-day-panel>
        <section class="reports-kpi-grid" data-reports-day-kpis></section>

        <article class="panel reports-card reports-employees-card">
          <div class="reports-card-head">
            <div>
              <h3>Карточки сотрудников</h3>
              <p class="muted">Статус, задачи, заседания и ближайшее событие по выбранному фильтру.</p>
            </div>
          </div>
          <div class="reports-employee-grid" data-reports-employee-cards></div>
        </article>

        <section class="reports-grid reports-grid-wide">
          <article class="panel reports-card">
            <div class="reports-card-head">
              <div>
                <h3>Ближайшие контрольные дела</h3>
                <p class="muted">Контрольные дела из серверного ответа.</p>
              </div>
            </div>
            <div class="reports-list" data-reports-controlled></div>
          </article>
        </section>
      </section>

      <section class="reports-mode-panel reports-quarter-reference" data-reports-quarter-panel hidden>
        <header class="reports-quarter-reference-head">
          <div>
            <h2>Квартальный отчёт</h2>
            <p>Динамика судебной работы, исполнители и структура дел за выбранный период.</p>
          </div>
          <span class="reports-quarter-badge" data-reports-quarter-badge>Квартал не выбран</span>
        </header>

        <section class="reports-quarter-kpi-grid" data-reports-quarter-kpis></section>

        <section class="reports-quarter-overview">
          <article class="panel reports-card reports-quarter-inflow-card">
            <div class="reports-card-head reports-quarter-card-head">
              <div>
                <h3>Поступило за квартал</h3>
                <p class="muted">Количество новых дел по месяцам и сравнение с прошлым годом.</p>
              </div>
              <div class="reports-quarter-total-badge" data-reports-quarter-total-badge></div>
            </div>
            <div class="reports-quarter-months" data-reports-quarter-months></div>
            <div class="reports-quarter-month-footer" data-reports-quarter-month-footer></div>
          </article>

          <article class="panel reports-card reports-quarter-summary-card">
            <div class="reports-card-head">
              <div>
                <h3>Общие итоги судебного отдела</h3>
                <p class="muted">Сравнение с аналогичным периодом прошлого года.</p>
              </div>
            </div>
            <div class="reports-quarter-summary" data-reports-quarter-totals></div>
          </article>
        </section>

        <article class="panel reports-card reports-executors-card">
          <div class="reports-card-head">
            <div>
              <h3>Отчёт по исполнителям</h3>
              <p class="muted">Выполнение плана по категориям спора за выбранный квартал.</p>
            </div>
          </div>
          <div class="reports-table-wrap">
            <table class="reports-table reports-executor-table">
              <thead>
                <tr>
                  <th>Исполнитель</th>
                  <th>Категория спора</th>
                  <th>За квартал</th>
                  <th>С начала года</th>
                  <th>Выполнение</th>
                </tr>
              </thead>
              <tbody data-reports-executor-report></tbody>
            </table>
          </div>
        </article>

        <article class="panel reports-card reports-structure-card">
          <div class="reports-card-head">
            <div>
              <h3>Структура судебных дел по категориям и предмету спора</h3>
              <p class="muted">Распределение дел за выбранный квартал.</p>
            </div>
            <div class="reports-copy-actions">
              <button class="btn tiny" type="button" data-reports-copy="chart">Копировать диаграмму</button>
            </div>
          </div>
          <div class="reports-chart-layout">
            <div class="reports-chart" data-reports-structure-chart></div>
          </div>
          <div class="reports-table-tools">
            <label>
              <span>Сортировка</span>
              <select data-reports-structure-sort>
                <option value="count">По количеству</option>
                <option value="category">По категории</option>
              </select>
            </label>
          </div>
          <div class="reports-table-wrap reports-structure-table-wrap">
            <table class="reports-table" data-reports-structure-table>
              <thead>
                <tr>
                  <th>Категория</th>
                  <th>Предмет спора</th>
                  <th>Количество</th>
                  <th>Доля</th>
                  <th>Период</th>
                </tr>
              </thead>
              <tbody data-reports-structure-rows></tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  `;
}
