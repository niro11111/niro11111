// AI copilot on every screen: a floating ✦ button opens a panel that answers questions about the
// screen you are on. The server builds the context from its own data (the page sends only the
// screen name), so answers rest on real numbers. Without a model it says what is needed.
import { api, esc, $ } from './api.js';
import { getLang, t } from './i18n.js';

const he = () => getLang() === 'he';
const screen = () => location.hash.slice(1) || 'command';

async function ask(q) {
  const out = $('#cpOut'); const btn = $('#cpF button');
  btn.disabled = true; out.innerHTML = `<p class="small muted">✦ ${he() ? 'חושב…' : 'Thinking…'}</p>`;
  try {
    const r = await api('/api/ai/copilot', { method: 'POST', body: { screen: screen(), question: q, lang: getLang(), worldId: document.body.dataset.worldId || undefined } });
    if (r.blocked) out.innerHTML = `<p class="small warn">${esc(r.reason)}</p>`;
    else out.innerHTML = `<div class="small cp-answer" dir="auto">${esc(r.answer).replace(/\n/g, '<br>')}</div><p class="xs muted">${esc(r.model ?? '')} · ${he() ? 'מבוסס על נתוני המסך' : 'based on this screen\'s data'}</p>`;
  } catch (e) { out.innerHTML = `<p class="small err">${esc(e.message)}</p>`; }
  btn.disabled = false;
}

async function open() {
  const p = $('#copilot');
  p.classList.remove('hidden');
  $('#cpTitle').textContent = `✦ ${he() ? 'עוזר AI' : 'AI copilot'} · ${t(screen())}`;
  $('#cpIn').focus();
  let sugg = [];
  try { sugg = await api(`/api/ai/suggested?screen=${encodeURIComponent(screen())}&lang=${getLang()}`); } catch { /* optional */ }
  $('#cpSug').innerHTML = sugg.map((q) => `<button type="button" class="btn sm" data-cq="${esc(q)}">${esc(q)}</button>`).join('');
  for (const b of document.querySelectorAll('[data-cq]')) b.onclick = () => { $('#cpIn').value = b.dataset.cq; ask(b.dataset.cq); };
}

export function initCopilot() {
  if (document.getElementById('copilotBtn')) return;
  document.body.insertAdjacentHTML('beforeend', `<button id="copilotBtn" class="copilot-btn" aria-label="AI copilot" title="AI copilot (Ctrl+K)">✦</button>
    <section id="copilot" class="copilot glass hidden" role="dialog" aria-labelledby="cpTitle"><header class="row"><h2 id="cpTitle" class="grow small"></h2><button id="cpX" class="btn sm" aria-label="close">✕</button></header>
    <div id="cpSug" class="row"></div><form id="cpF" class="row"><input id="cpIn" class="grow" dir="auto" autocomplete="off" aria-label="question"><button class="btn primary sm">➤</button></form><div id="cpOut"></div></section>`);
  $('#copilotBtn').onclick = () => ($('#copilot').classList.contains('hidden') ? open() : $('#copilot').classList.add('hidden'));
  $('#cpX').onclick = () => $('#copilot').classList.add('hidden');
  $('#cpF').onsubmit = (e) => { e.preventDefault(); const q = $('#cpIn').value.trim(); if (q) ask(q); };
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); } if (e.key === 'Escape') $('#copilot')?.classList.add('hidden'); });
  addEventListener('hashchange', () => { if (!$('#copilot').classList.contains('hidden')) { $('#cpOut').innerHTML = ''; open(); } });
}
