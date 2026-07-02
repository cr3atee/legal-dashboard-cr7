let initialized = false;

function setReportStatus(message, isError = false) {
  const node = document.querySelector('[data-reports-status]');
  if (node) {
    node.textContent = message;
    node.classList.toggle('error', isError);
    node.hidden = false;
  } else if (isError) {
    window.alert(message);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getPeriod(root) {
  const quarter = root.querySelector('[data-reports-quarter] option:checked')?.textContent?.trim()
    || root.querySelector('[data-reports-quarter]')?.value
    || '';
  const year = root.querySelector('[data-reports-year]')?.value || '';
  return [quarter, year].filter(Boolean).join(' ');
}

function getVisibleTableRows(root) {
  return [...root.querySelectorAll('[data-reports-structure-rows] tr')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
    .filter(cells => cells.length >= 5 && !cells.join(' ').includes('Нет данных'))
    .map(cells => ({
      category: cells[0],
      subject: cells[1],
      count: cells[2],
      share: cells[3],
      period: cells[4]
    }));
}

function getVisibleChartRows(root) {
  return [...root.querySelectorAll('[data-reports-structure-chart] .reports-column-bar')]
    .map(button => ({
      category: button.querySelector('.reports-column-bar-label')?.textContent?.trim() || '',
      valueText: button.querySelector('b')?.textContent?.trim() || '0',
      value: Number((button.querySelector('b')?.textContent?.match(/\d+(?:[.,]\d+)?/)?.[0] || '0').replace(',', '.')) || 0,
      color: getComputedStyle(button).getPropertyValue('--category-color').trim() || '#2f67e8'
    }))
    .filter(row => row.category);
}

function buildChartHtml(rows) {
  if (!rows.length) return '<p style="text-align:center;color:#475569;padding:40px 0">Нет данных по структуре дел за выбранный период</p>';
  const max = Math.max(...rows.map(row => row.value), 1);
  const valueRow = rows.map(row => `<td style="border:0;text-align:center;font-weight:700;padding:0 6pt 7pt">${escapeHtml(row.valueText)}</td>`).join('');
  const barsRow = rows.map(row => {
    const height = Math.max(18, Math.round(row.value / max * 220));
    return `<td style="border:0;vertical-align:bottom;text-align:center;padding:0 6pt;height:230px">
      <table align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:46px;height:${height}px">
        <tr style="height:${height}px"><td bgcolor="${escapeHtml(row.color)}" style="background-color:${escapeHtml(row.color)};height:${height}px;width:46px;border:0;font-size:1px;line-height:1px">&nbsp;</td></tr>
      </table>
    </td>`;
  }).join('');
  const labelsRow = rows.map(row => `<td style="border:0;text-align:center;padding:8pt 6pt 0;font-size:10pt;line-height:1.2">${escapeHtml(row.category)}</td>`).join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:18pt 0 24pt">
    <tr>${valueRow}</tr>
    <tr style="height:230px">${barsRow}</tr>
    <tr>${labelsRow}</tr>
  </table>`;
}

function buildWordHtml(root) {
  const period = getPeriod(root);
  const tableRows = getVisibleTableRows(root);
  const chartRows = getVisibleChartRows(root);
  const total = chartRows.reduce((sum, row) => sum + row.value, 0);

  const bodyRows = tableRows.length
    ? tableRows.map(row => `<tr>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.subject)}</td>
        <td style="text-align:center">${escapeHtml(row.count)}</td>
        <td style="text-align:center">${escapeHtml(row.share)}</td>
        <td>${escapeHtml(row.period || period)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center">Нет данных</td></tr>';

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word">
<title>Структура судебных дел</title>
<style>
@page { size:A4; margin:1.5cm; }
body { font-family:Arial,sans-serif; font-size:11pt; color:#111827; }
h1 { font-size:16pt; margin:0 0 10pt; }
p.period { margin:0 0 14pt; }
table.data { width:100%; border-collapse:collapse; margin-top:16pt; }
table.data th, table.data td { border:1px solid #9ca3af; padding:7pt; vertical-align:top; }
table.data th { background:#eef2f7; font-weight:700; }
</style>
</head>
<body>
<h1>Структура судебных дел по категориям и предмету спора</h1>
<p class="period">${escapeHtml(period)}</p>
<h2 style="font-size:14pt">Структура судебных дел</h2>
${buildChartHtml(chartRows)}
<p>Всего: ${escapeHtml(total)}</p>
<table class="data">
<thead><tr><th>Категория</th><th>Предмет спора</th><th>Количество</th><th>Доля</th><th>Период</th></tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</body></html>`;
}

function downloadWord(html, period) {
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `struktura-sudebnyh-del-${String(period || 'otchet').replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '')}.doc`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportWord(root, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Формирование…';
  try {
    const rows = getVisibleTableRows(root);
    const chartRows = getVisibleChartRows(root);
    if (!rows.length && !chartRows.length) throw new Error('На экране нет данных для выгрузки');
    const period = getPeriod(root);
    downloadWord(buildWordHtml(root), period);
    setReportStatus('Word-документ сформирован из данных, показанных на экране');
    button.textContent = 'Word создан';
  } catch (error) {
    setReportStatus(`Не удалось создать Word: ${error?.message || 'неизвестная ошибка'}`, true);
    button.textContent = 'Ошибка';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
    }, 1400);
  }
}

export function initReportChartClipboard() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-reports-copy]');
    if (!button) return;
    const root = button.closest('[data-reports-root]');
    if (!root) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void exportWord(root, button);
  }, true);
}
