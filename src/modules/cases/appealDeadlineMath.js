export function readAppealRow(row) {
  return {
    process_kind: row?.querySelector('[data-general-appeal-process]')?.value || 'ГПК',
    appeal_kind: normalizeKind(row?.querySelector('[data-general-appeal-kind]')?.value || 'Апелляция'),
    act_type: row?.querySelector('[data-general-appeal-act-type]')?.value || 'Итоговое решение',
    event_date: row?.querySelector('[data-general-appeal-date]')?.value?.trim() || '',
    late_motivated_received: row?.querySelector('[data-general-appeal-late]')?.value || 'Нет',
    interim_type: row?.querySelector('[data-general-interim-type]')?.value || ''
  };
}

export function calculateAppealDeadline(item = {}) {
  const kind = normalizeKind(item.appeal_kind || 'Апелляция');
  if (kind === 'Жалоба в Конституционный суд РФ') return { noCalendarPeriod: true };
  const base = parseStrictDate(item.event_date || item.date);
  if (!base) return null;

  const processKind = item.process_kind || 'ГПК';
  const actType = item.act_type || 'Итоговое решение';
  const start = addDays(base, 1);
  let deadline;
  let period;
  let explanation;

  if (actType === 'Судебный приказ') {
    const days = processKind === 'КАС' ? 20 : 10;
    deadline = addDays(base, days);
    period = `${days} дней`;
    explanation = 'Срок исчислен со дня, следующего за получением копии судебного приказа.';
  } else if (actType === 'Заочное решение') {
    deadline = addDays(base, 7);
    period = '7 дней';
    explanation = 'Рассчитан срок подачи заявления об отмене заочного решения со дня вручения его копии.';
  } else if (actType === 'Определение (промежуточное)') {
    deadline = addDays(base, 15);
    period = '15 дней';
    explanation = `Рассчитан срок подачи частной жалобы. Вид определения: ${item.interim_type || 'не выбран'}.`;
  } else if (kind === 'Апелляция') {
    deadline = addCalendarMonths(base, 1);
    period = '1 месяц';
    explanation = 'Течение срока начинается на следующий день и оканчивается в соответствующее число следующего месяца.';
  } else if (kind === 'Кассация') {
    const months = processKind === 'АПК' ? 2 : (processKind === 'КАС' || processKind === 'УПК' ? 6 : 3);
    deadline = addCalendarMonths(base, months);
    period = `${months} мес.`;
    explanation = 'Месячный срок оканчивается в соответствующее число последнего месяца срока.';
  } else if (kind === 'Кассация в Верховный суд РФ') {
    deadline = addCalendarMonths(base, 3);
    period = '3 мес.';
    explanation = 'Срок рассчитан до соответствующего числа третьего календарного месяца.';
  } else {
    return null;
  }

  const adjusted = processKind === 'УПК' ? deadline : moveFromWeekend(deadline);
  return {
    baseRu: formatRu(base),
    startRu: formatRu(start),
    dateRu: formatRu(adjusted),
    dateIso: formatIso(adjusted),
    period,
    explanation,
    weekendShifted: adjusted.getTime() !== deadline.getTime()
  };
}

export function normalizeKind(value) {
  const text = String(value || '').trim();
  if (/конституц/i.test(text)) return 'Жалоба в Конституционный суд РФ';
  if (/верховн/i.test(text)) return 'Кассация в Верховный суд РФ';
  if (/кассац/i.test(text)) return 'Кассация';
  return 'Апелляция';
}

export function parseStrictDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function validDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function addDays(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function addCalendarMonths(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

function moveFromWeekend(date) {
  const result = new Date(date);
  while (result.getDay() === 0 || result.getDay() === 6) result.setDate(result.getDate() + 1);
  return result;
}

function formatRu(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function formatIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
