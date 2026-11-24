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

/**
 * Remote JARVIS server. When set, this page (also the single HTML file or the in-browser build)
 * talks to that server instead of its own in-page runtime: same data on every device.
 */
export const remote = {
  url: () => String(local.get('serverUrl', '') || '').replace(/\/+$/, ''),
  active: () => !!remote.url(),
  async test(url, token) {
    const base = String(url).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('the address starts with https://');
    let h;
    try { h = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) })).json(); } catch (e) { throw new Error(`no JARVIS server answers at ${base} (${e.message})`); }
    if (h?.name !== 'J.A.R.V.I.S') throw new Error(`${base} is not a JARVIS server`);
    const r = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (r.status === 401) throw new Error('the server is there, but the access token is wrong');
    if (!r.ok) throw new Error(`server error ${r.status}`);
    return { base, health: h, status: await r.json() };
  },
  connect(url, token) { local.set('serverUrl', String(url).trim().replace(/\/+$/, '')); auth.set(token); },
  disconnect() { local.set('serverUrl', ''); },
};

export async function api(path, opts = {}) {
  // Prototype/demo build: a recorded in-browser backend answers instead of the server.
  // In-browser runtime: the full JARVIS runs in this page (unless a remote server is connected).
  if (window.JARVIS_LOCAL && !remote.active()) return window.JARVIS_LOCAL.api(path, { method: opts.method ?? 'GET', body: opts.body });
  if (window.JARVIS_MOCK && !remote.active()) return window.JARVIS_MOCK(path, { ...opts, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const r = await fetch(remote.url() + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) },
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

// In-page confirm / prompt (the browser's native dialogs are blocked in some embeds).
export function dialog({ message, input = null, okText = 'OK', cancelText = '✕', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = `<form class="dlg glass" role="dialog" aria-modal="true"><p class="dlg-msg" dir="auto"></p>${input !== null ? '<input class="dlg-in" dir="auto">' : ''}<div class="row" style="justify-content:flex-end"><button type="button" class="btn sm dlg-no"></button><button class="btn sm ${danger ? 'danger' : 'ok'} dlg-yes"></button></div></form>`;
    wrap.querySelector('.dlg-msg').textContent = message;
    wrap.querySelector('.dlg-yes').textContent = okText;
    wrap.querySelector('.dlg-no').textContent = cancelText;
    const inp = wrap.querySelector('.dlg-in'); if (inp) inp.value = input;
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') done(input !== null ? null : false); };
    document.addEventListener('keydown', esc);
    wrap.querySelector('.dlg-no').onclick = () => done(input !== null ? null : false);
    wrap.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(input !== null ? inp.value : true); };
    document.body.append(wrap);
    (inp ?? wrap.querySelector('.dlg-yes')).focus();
  });
}
export const confirmDialog = (message, opts = {}) => dialog({ message, ...opts });
export const promptDialog = (message, value = '') => dialog({ message, input: value });
