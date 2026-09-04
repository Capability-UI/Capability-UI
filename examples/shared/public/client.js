const baseMeta = document.querySelector('meta[name="cup-base"]');
export const BASE = baseMeta?.getAttribute('content') ?? '';

export function href(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${normalized}`;
}

export async function api(path, options = {}) {
  const response = await fetch(href(path), {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

export async function runAction({ subjectId, capability, input, confirm = true }) {
  return api('/api/execute', {
    method: 'POST',
    body: JSON.stringify({
      subjectId,
      capability,
      input,
      confirm,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
}

export function money(value) {
  if (value == null || value === '') return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
}

export function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
