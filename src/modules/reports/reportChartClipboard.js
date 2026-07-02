let initialized = false;

function setReportStatus(message, isError = false) {
  const node = document.querySelector('[data-reports-status]');
  if (node) {
    node.textContent = message;
    node.classList.toggle('error', isError);
    node.hidden = false;
    return;
  }
  if (isError) window.alert(message);
}

function extractChartRows(root) {
  return [...root.querySelectorAll('[data-reports-structure-chart] .reports-column-bar')]
    .map(button => {
      const label = button.querySelector('.reports-column-bar-label')?.textContent?.trim() || '';
      const valueText = button.querySelector('b')?.textContent?.trim() || '0';
      const value = Number((valueText.match(/-?\d+(?:[.,]\d+)?/)?.[0] || '0').replace(',', '.')) || 0;
      const color = getComputedStyle(button).getPropertyValue('--category-color').trim() || '#2563eb';
      return { label, value, valueText, color };
    })
    .filter(row => row.label);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
}

function buildChartCanvas(root) {
  const rows = extractChartRows(root);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 650;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не поддерживает создание изображения');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 30px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Структура судебных дел', 48, 52);

  const period = document.querySelector('[data-reports-quarter] option:checked')?.textContent?.trim();
  const year = document.querySelector('[data-reports-year]')?.value;
  if (period || year) {
    ctx.fillStyle = '#64748b';
    ctx.font = '16px Arial';
    ctx.fillText([period, year].filter(Boolean).join(' '), 48, 80);
  }

  if (!rows.length) {
    ctx.fillStyle = '#475569';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Нет данных по структуре дел за выбранный период', canvas.width / 2, canvas.height / 2);
    return canvas;
  }

  const max = Math.max(...rows.map(row => row.value), 1);
  const chartLeft = 64;
  const chartRight = canvas.width - 48;
  const chartTop = 120;
  const chartBottom = 510;
  const availableWidth = chartRight - chartLeft;
  const gap = Math.max(12, Math.min(28, availableWidth / Math.max(rows.length * 6, 1)));
  const barWidth = Math.max(36, Math.min(110, (availableWidth - gap * (rows.length - 1)) / rows.length));
  const usedWidth = rows.length * barWidth + (rows.length - 1) * gap;
  const startX = chartLeft + Math.max(0, (availableWidth - usedWidth) / 2);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom + 0.5);
  ctx.lineTo(chartRight, chartBottom + 0.5);
  ctx.stroke();

  rows.forEach((row, index) => {
    const x = startX + index * (barWidth + gap);
    const height = Math.max(10, Math.round((row.value / max) * (chartBottom - chartTop)));
    const y = chartBottom - height;

    ctx.fillStyle = row.color;
    ctx.fillRect(x, y, barWidth, height);

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(row.valueText, x + barWidth / 2, y - 10);

    ctx.fillStyle = '#334155';
    ctx.font = '14px Arial';
    wrapText(ctx, row.label, x + barWidth / 2, chartBottom + 24, barWidth + gap - 4, 17, 4);
  });

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  ctx.fillStyle = '#475569';
  ctx.font = '16px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`Всего: ${total}`, 48, 620);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось сформировать PNG')), 'image/png');
  });
}

function downloadPng(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `diagramma-otcheta-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyChart(root, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Копирование…';
  try {
    const canvas = buildChartCanvas(root);
    const blob = await canvasToBlob(canvas);
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setReportStatus('Диаграмма скопирована в буфер обмена');
      button.textContent = 'Скопировано';
    } else {
      downloadPng(blob);
      setReportStatus('Копирование изображений не поддерживается браузером — диаграмма сохранена как PNG');
      button.textContent = 'PNG сохранён';
    }
  } catch (error) {
    try {
      const canvas = buildChartCanvas(root);
      const blob = await canvasToBlob(canvas);
      downloadPng(blob);
      setReportStatus('Браузер запретил доступ к буферу обмена — диаграмма сохранена как PNG');
      button.textContent = 'PNG сохранён';
    } catch (fallbackError) {
      setReportStatus(`Не удалось скопировать диаграмму: ${fallbackError?.message || error?.message || 'неизвестная ошибка'}`, true);
      button.textContent = 'Ошибка';
    }
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
    void copyChart(root, button);
  }, true);
}
