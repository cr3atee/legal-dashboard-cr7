import { startGlobalLoading } from '../core/loadingManager.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function loadingTextForRequest(path, options = {}) {
  if (options.loadingText) return options.loadingText;
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'DELETE') return 'Удаление...';
  if (method === 'PUT' || method === 'PATCH') return 'Обновление...';
  if (method === 'POST') return String(path || '').includes('/auth/') ? 'Загрузка...' : 'Сохранение...';
  return 'Загрузка...';
}

export async function request(path, options = {}) {
  const { loading = true, loadingText, ...fetchOptions } = options;
  const finishLoading = loading === false ? null : startGlobalLoading(loadingTextForRequest(path, { ...options, loadingText }));

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {})
      },
      ...fetchOptions
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  } finally {
    finishLoading?.();
  }
}
