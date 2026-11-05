// JARVIS Command Center: boot, navigation, live events.
import { api, auth, toast, $, $$, local } from './api.js';
import { t, setLang, getLang } from './i18n.js';
import { coreHTML, setCoreState, getCoreState } from './core.js';
import { VIEWS, cleanup } from './views.js';
import { renderChats } from './chat.js';

const views = Object.fromEntries(VIEWS.filter((x) => x[2]).map(([id, , fn]) => [id, fn]));
let current = location.hash.slice(1) || 'command';

function buildNav() {
  $('#nav').innerHTML = VIEWS.map(([id, ic]) => (ic ? `<a href="#${id}" data-v="${id}"><span class="ic">${ic}</span><span>${t(id)}</span></a>` : `<div class="sec">${t(id)}</div>`)).join('');
}

async function render() {
  cleanup();
  if (!views[current]) current = 'command';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.v === current));
  $('#viewTitle').textContent = t(current);
  $('#viewSub').textContent = t(`sub_${current}`);
  document.title = `J.A.R.V.I.S · ${t(current)}`;
  const v = $('#view');
  try { await views[current](v); } catch (e) { if (e.message !== 'unauthorized') v.innerHTML = `<div class="panel glass err">${e.message}</div>`; }
  renderChats();
}

function tickClock() {
  const d = new Date();
  $('#clockTime').textContent = d.toLocaleTimeString(getLang() === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#clockDate').textContent = d.toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function refreshBadges() {
  try {
    const [n, s] = await Promise.all([api('/api/notifications?unread=1'), api('/api/status')]);
    $('#bellCount').textContent = n.length;
    $('#demoBadge').classList.toggle('hidden', !s.demoData);
    const ai = s.providers.find((p) => !p.capabilities.local);
    $('#aiBadge').textContent = ai ? `AI · ${ai.provider}` : 'AI · local';
    $('#aiBadge').className = `tag ${ai ? 'ok' : 'warn'}`;
  } catch { /* handled in api() */ }
}

let es;
function connectStream() {
  if (window.JARVIS_MOCK) return; // no live stream in the recorded demo
  es?.close();
  es = new EventSource(`/api/stream?token=${encodeURIComponent(auth.get())}`);
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'notification') {
      toast(`${e.data.title}${e.data.body ? ` — ${e.data.body}` : ''}`, e.data.priority);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(e.data.title, { body: e.data.body });
      refreshBadges();
    } else if (e.type === 'task' && getCoreState() !== 'speaking' && getCoreState() !== 'listening') {
      const map = { PLANNING: 'thinking', EXECUTING: 'executing', VERIFYING: 'executing', AWAITING_APPROVAL: 'approval', FAILED: 'error' };
      if (map[e.data.state]) setCoreState(map[e.data.state]);
    }
  };
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) setCoreState('error'); };
}

function showLogin() { $('#login').classList.remove('hidden'); $('#loginCore').innerHTML = coreHTML({ label: false }); $('#tokenInput').focus(); }
auth.onUnauthorized(showLogin);
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  auth.set($('#tokenInput').value.trim());
  try { await api('/api/status'); $('#login').classList.add('hidden'); boot(); } catch { $('#loginErr').textContent = '✕'; }
};

$('#menuBtn').onclick = () => $('#sideNav').classList.toggle('open');
$('#bellBtn').onclick = () => { location.hash = 'command'; };
$('#themeBtn').onclick = () => { const th = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = th; local.set('theme', th); };
$('#langBtn').onclick = () => { setLang(getLang() === 'he' ? 'en' : 'he'); $('#langBtn').textContent = getLang() === 'he' ? 'EN' : 'עב'; buildNav(); render(); tickClock(); };
window.addEventListener('hashchange', () => { current = location.hash.slice(1) || 'command'; $('#sideNav').classList.remove('open'); render(); $('#view').focus({ preventScroll: true }); });

document.documentElement.dataset.theme = local.get('theme', 'dark');
setLang(getLang());
$('#langBtn').textContent = getLang() === 'he' ? 'EN' : 'עב';
buildNav();
tickClock(); setInterval(tickClock, 1000);

async function boot() {
  if (!auth.get() && !window.JARVIS_MOCK) return showLogin();
  connectStream(); refreshBadges(); setInterval(refreshBadges, 30000);
  await render();
}
boot();
