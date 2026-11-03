export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (minor, digits = 0) => new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: digits }).format((minor ?? 0) / 100);
export const local = {
  get(k, d) { try { const v = localStorage.getItem(`jarvis.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`jarvis.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let TOKEN = local.get('token', '');
let onUnauthorized = () => {};
export const auth = { get: () => TOKEN, set(tok) { TOKEN = tok; local.set('token', tok); }, onUnauthorized(fn) { onUnauthorized = fn; } };

export async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  if (r.status === 401) { onUnauthorized(); throw new Error('unauthorized'); }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? r.statusText);
  return data;
}

export function toast(text, priority = 'normal') {
  const el = document.createElement('div');
  el.className = `toast ${priority}`; el.textContent = text; el.dir = 'auto';
  $('#toasts').append(el); setTimeout(() => el.remove(), 6000);
}
