// J.A.R.V.I.S Command Center - vanilla ES module, no build step.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (minor) => new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format((minor ?? 0) / 100);
const isHebrew = (s) => /[֐-׿]/.test(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(`jarvis.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`jarvis.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let TOKEN = store.get('token', '');
const conversationId = store.get('conversationId', null) ?? (() => { const id = `c_${Date.now().toString(36)}`; store.set('conversationId', id); return id; })();

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  return data;
}

function toast(text, priority = 'normal') {
  const t = document.createElement('div');
  t.className = `toast ${priority}`; t.textContent = text; t.dir = 'auto';
  $('#toasts').append(t); setTimeout(() => t.remove(), 6000);
}

// ---------------- AI core state ----------------
const CORE_LABEL = { idle: 'online', listening: 'listening', processing: 'processing', thinking: 'thinking', speaking: 'speaking', executing: 'executing', approval: 'awaiting approval', error: 'error' };
let coreState = 'idle';
function setCore(state) {
  coreState = state;
  document.querySelectorAll('.core').forEach((c) => { c.dataset.state = state; const l = $('.core-label', c); if (l) l.textContent = CORE_LABEL[state]; });
}
function coreEl() { const n = $('#tpl-core').content.cloneNode(true); const c = n.firstElementChild; c.dataset.state = coreState; $('.core-label', c).textContent = CORE_LABEL[coreState]; return c; }

// ---------------- conversation ----------------
const messages = store.get('messages', []);
function pushMsg(m) { messages.push(m); if (messages.length > 80) messages.shift(); store.set('messages', messages); renderChat(); }
function renderChat() {
  document.querySelectorAll('.chat').forEach((box) => {
    box.innerHTML = messages.map((m) => `<div class="msg ${m.role}" dir="auto">${esc(m.text)}${m.meta ? `<span class="meta">${esc(m.meta)}</span>` : ''}${m.approvalId ? `<div class="row" style="margin-top:8px"><button class="btn ok small" data-approve="${m.approvalId}">Approve</button><button class="btn danger small" data-reject="${m.approvalId}">Reject</button></div>` : ''}</div>`).join('')
      || '<p class="muted small">Try: "organize my day", "כמה הוצאנו החודש?", "turn off the lights downstairs", "remind me to pay the electricity bill tomorrow at 9".</p>';
    box.scrollTop = box.scrollHeight;
  });
}

async function send(text, channel = 'text') {
  if (!text.trim()) return;
  pushMsg({ role: 'user', text });
  setCore('processing');
  try {
    const t = await api('/api/command', { method: 'POST', body: { text, conversationId, channel } });
    handleTaskResult(t, channel);
  } catch (e) { setCore('error'); pushMsg({ role: 'jarvis', text: `Error: ${e.message}` }); }
}

function handleTaskResult(t, channel) {
  const steps = t.plan?.steps?.map((s) => `${s.agent}:${s.tool}${s.verified ? ' ✓' : ''}`).join(' → ') ?? '';
  const pending = t.state === 'AWAITING_APPROVAL' ? t.approvalId : null;
  pushMsg({ role: 'jarvis', text: t.response ?? t.error ?? t.state, meta: `${t.state}${steps ? ` · ${steps}` : ''}`, approvalId: pending });
  setCore(t.state === 'FAILED' ? 'error' : pending ? 'approval' : 'idle');
  if (channel === 'voice' && t.response) speak(t.response);
  refreshBadges();
  if (current === 'overview') render();
}

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-approve],[data-reject]');
  if (!a) return;
  const id = a.dataset.approve ?? a.dataset.reject;
  const decision = a.dataset.approve ? 'approve' : 'reject';
  if (decision === 'approve' && !confirm('Approve this sensitive action?')) return;
  try {
    setCore('executing');
    const t = await api(`/api/approvals/${id}`, { method: 'POST', body: { decision } });
    messages.forEach((m) => { if (m.approvalId === id) delete m.approvalId; });
    handleTaskResult(t);
    if (current === 'overview' || current === 'security') render();
  } catch (err) { toast(err.message); setCore('error'); }
});

// ---------------- voice ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = { rec: null, live: false, conversation: false, lang: store.get('voiceLang', 'he-IL'), rate: store.get('voiceRate', 1), voiceName: store.get('voiceName', ''), bargeIn: store.get('bargeIn', true) };

function micIndicator(on) { $('#micIndicator').classList.toggle('hidden', !on); document.querySelectorAll('.mic-btn').forEach((b) => b.classList.toggle('live', on)); }

function startListening() {
  if (!SR) { toast('Speech recognition is not supported in this browser. Use Chrome or Edge, or type instead.'); return; }
  if (voice.live) return;
  const rec = new SR();
  rec.lang = voice.lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec.onstart = () => { voice.live = true; micIndicator(true); setCore('listening'); };
  rec.onresult = (ev) => {
    const r = ev.results[ev.results.length - 1];
    const txt = r[0].transcript;
    document.querySelectorAll('.interim').forEach((x) => { x.textContent = txt; });
    if (speechSynthesis.speaking && voice.bargeIn) speechSynthesis.cancel(); // user interrupted JARVIS
    if (r.isFinal) { document.querySelectorAll('.interim').forEach((x) => { x.textContent = ''; }); send(txt, 'voice'); }
  };
  rec.onerror = (ev) => { if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast(`Microphone: ${ev.error}`); };
  rec.onend = () => { voice.live = false; micIndicator(false); if (coreState === 'listening') setCore('idle'); };
  voice.rec = rec;
  try { rec.start(); } catch { /* already started */ }
}
function stopListening() { voice.conversation = false; voice.rec?.stop(); }

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[‏‎]/g, '').slice(0, 1200));
  u.lang = isHebrew(text) ? 'he-IL' : 'en-US';
  u.rate = voice.rate;
  const v = speechSynthesis.getVoices().find((x) => x.name === voice.voiceName && x.lang.slice(0, 2) === u.lang.slice(0, 2));
  if (v) u.voice = v;
  u.onstart = () => setCore('speaking');
  u.onend = () => { if (coreState === 'speaking') setCore('idle'); if (voice.conversation) startListening(); };
  speechSynthesis.speak(u);
  if (voice.conversation && voice.bargeIn) setTimeout(startListening, 400); // allow interruption while speaking
}

function micButton() {
  const b = document.createElement('button');
  b.className = 'mic-btn'; b.title = 'Push to talk (hold) / click to toggle'; b.textContent = '🎙';
  b.addEventListener('click', () => (voice.live ? stopListening() : startListening()));
  return b;
}
window.addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'Space') { e.preventDefault(); voice.live ? stopListening() : startListening(); }
  if (e.key === 'Escape') { speechSynthesis.cancel(); stopListening(); }
});

// ---------------- navigation ----------------
const VIEWS = [
  ['overview', '◉', 'Overview'], ['assistant', '💬', 'AI Assistant'], ['voice', '🎙', 'Voice'], ['agents', '🧠', 'Agents'],
  ['computer', '🖥', 'Computer Control'], ['automations', '⚙', 'Automations'], ['memory', '🗂', 'Memory'], ['research', '🔎', 'Research'],
  ['documents', '📄', 'Documents'], ['wealth', '₪', 'Family Wealth'], ['home', '🏠', 'Smart Home'], ['tasks', '✓', 'Tasks'],
  ['calendar', '📅', 'Calendar'], ['integrations', '🔌', 'Integrations'], ['notifications', '🔔', 'Notifications'], ['security', '🛡', 'Security'], ['settings', '⚙', 'Settings'],
];
let current = location.hash.slice(1) || 'overview';
$('#nav').innerHTML = VIEWS.map(([id, ic, label]) => `<a href="#${id}" data-v="${id}"><span>${ic}</span>${label}</a>`).join('');
window.addEventListener('hashchange', () => { current = location.hash.slice(1) || 'overview'; $('.nav').classList.remove('open'); render(); });
$('#menuBtn').onclick = () => $('.nav').classList.toggle('open');
$('#bellBtn').onclick = () => { location.hash = 'notifications'; };
$('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store.set('theme', t); };
document.documentElement.dataset.theme = store.get('theme', 'dark');

async function render() {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.v === current));
  $('#viewTitle').textContent = VIEWS.find((v) => v[0] === current)?.[2] ?? '';
  const view = $('#view');
  try { await (R[current] ?? R.overview)(view); } catch (e) { if (e.message !== 'unauthorized') view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  renderChat();
}

function chatCard(span = 'span-7') {
  const c = document.createElement('div');
  c.className = `card ${span}`;
  c.innerHTML = '<h3>Conversation</h3><div class="chat"></div><div class="interim muted small" dir="auto"></div><form class="composer"><input placeholder="Ask JARVIS… / שאל את ג׳ארוויס…" dir="auto" aria-label="Command"><button class="btn primary">Send</button></form>';
  const f = $('form', c);
  f.prepend(micButton());
  f.onsubmit = (e) => { e.preventDefault(); const i = $('input', f); send(i.value); i.value = ''; };
  return c;
}

const stateBadge = (s) => `<span class="state ${s}">${s}</span>`;

const R = {
  async overview(v) {
    const [status, brief, wealth, agents, tasks, approvals, notes, integ] = await Promise.all([
      api('/api/status'), api('/api/briefing/daily'), api('/api/wealth/overview'), api('/api/agents'), api('/api/tasks/exec'), api('/api/approvals'), api('/api/notifications'), api('/api/integrations')]);
    v.innerHTML = '<div class="grid"></div>';
    const g = $('.grid', v);
    const left = document.createElement('div'); left.className = 'card span-5';
    left.innerHTML = '<h3>JARVIS Core</h3>';
    left.append(coreEl());
    left.insertAdjacentHTML('beforeend', `<div style="margin-top:34px" class="row"><span class="badge ${status.providers.some((p) => !p.capabilities.local) ? 'ok' : 'warn'}">AI: ${esc(status.providers.map((p) => p.provider).join(', '))}</span><span class="badge info">voice → ${esc(status.route.voice.model)}</span><span class="badge info">deep → ${esc(status.route.deep.model)}</span><span class="badge ${status.bridge.connected ? 'ok' : ''}">desktop ${status.bridge.connected ? 'connected' : 'offline'}</span></div>`);
    g.append(left, chatCard());
    g.insertAdjacentHTML('beforeend', `
      <div class="card span-4"><h3>Today's briefing</h3><pre class="out small" dir="auto">${esc(brief.text)}</pre></div>
      <div class="card span-4"><h3>Family Wealth OS</h3>
        <div class="muted small">Net worth</div><div class="stat">${money(wealth.facts.netWorth.netWorth)}</div>
        <div class="kv small" style="margin-top:8px"><span class="muted">Spent this month</span><span>${money(wealth.facts.month.expenses)}</span><span class="muted">Income</span><span>${money(wealth.facts.month.income)}</span><span class="muted">Bills soon</span><span>${wealth.upcomingBills.length}</span></div>
        ${wealth.goals.map((x) => `<div class="small" style="margin-top:8px">${esc(x.name)} · ${x.pct}%</div><div class="bar"><i style="width:${Math.min(100, x.pct)}%"></i></div>`).join('')}
      </div>
      <div class="card span-4"><h3>Pending approvals <span class="badge ${approvals.length ? 'warn' : ''}">${approvals.length}</span></h3>
        <ul class="list">${approvals.map((a) => `<li><span class="grow small">${esc(a.summary)} <span class="badge bad">${a.risk}</span></span><button class="btn ok small" data-approve="${a.id}">Approve</button><button class="btn danger small" data-reject="${a.id}">Reject</button></li>`).join('') || '<li class="muted small">Nothing waiting.</li>'}</ul></div>
      <div class="card span-6"><h3>Current & recent tasks</h3><ul class="list">${tasks.slice(0, 7).map((t) => `<li>${stateBadge(t.state)}<span class="grow small" dir="auto">${esc(t.objective)}</span><span class="muted small">${esc((t.steps ?? []).map((s) => s.agent).join(', '))}</span></li>`).join('') || '<li class="muted small">No tasks yet.</li>'}</ul></div>
      <div class="card span-3"><h3>Active agents</h3><ul class="list">${agents.map((a) => `<li class="small"><span class="grow">${esc(a.name)}</span>${a.activeTasks ? `<span class="badge info">${a.activeTasks}</span>` : '<span class="muted">idle</span>'}</li>`).slice(0, 8).join('')}</ul></div>
      <div class="card span-3"><h3>Connected</h3><ul class="list">${integ.map((i) => `<li class="small"><span class="grow">${esc(i.name)}</span><span class="badge ${i.status === 'connected' ? 'ok' : i.status === 'demo' ? 'warn' : ''}">${i.status}</span></li>`).join('')}</ul></div>
      <div class="card span-12"><h3>Smart notifications</h3><ul class="list">${notes.slice(0, 6).map((n) => `<li class="small"><span class="badge ${n.priority === 'high' ? 'warn' : ''}">${n.priority}</span><span class="grow" dir="auto"><b>${esc(n.title)}</b> ${esc(n.body)}</span><span class="muted">${esc(n.status)}</span></li>`).join('') || '<li class="muted small">No notifications.</li>'}</ul></div>`);
  },

  async assistant(v) { v.innerHTML = '<div class="grid"></div>'; $('.grid', v).append(chatCard('span-12')); },

  async voice(v) {
    v.innerHTML = '<div class="grid"></div>';
    const g = $('.grid', v);
    const c = document.createElement('div'); c.className = 'card span-5'; c.innerHTML = '<h3>Voice</h3>';
    c.append(coreEl());
    c.insertAdjacentHTML('beforeend', `<div style="margin-top:36px" class="row"><button id="convBtn" class="btn primary">Start conversation</button><button id="stopBtn" class="btn">Stop</button></div>
      <p class="muted small">The microphone is only active while the red <b>MIC ON</b> indicator shows. Alt+Space toggles push-to-talk, Esc stops everything. ${SR ? '' : '<b class="err">This browser has no speech recognition; use Chrome/Edge.</b>'}</p>
      <div class="kv small"><label>Language</label><select id="vLang"><option value="he-IL">עברית</option><option value="en-US">English</option></select>
      <label>Voice</label><select id="vVoice"><option value="">Default</option></select>
      <label>Speed</label><input id="vRate" type="range" min="0.6" max="1.6" step="0.1">
      <label>Interruptions</label><label><input id="vBarge" type="checkbox"> let me interrupt JARVIS (best with headphones)</label></div>`);
    g.append(c, chatCard());
    $('#vLang').value = voice.lang; $('#vRate').value = voice.rate; $('#vBarge').checked = voice.bargeIn;
    const fill = () => { $('#vVoice').innerHTML = '<option value="">Default</option>' + speechSynthesis.getVoices().filter((x) => /^(he|en)/.test(x.lang)).map((x) => `<option ${x.name === voice.voiceName ? 'selected' : ''}>${esc(x.name)}</option>`).join(''); };
    fill(); speechSynthesis.onvoiceschanged = fill;
    $('#vLang').onchange = (e) => { voice.lang = e.target.value; store.set('voiceLang', voice.lang); };
    $('#vRate').oninput = (e) => { voice.rate = Number(e.target.value); store.set('voiceRate', voice.rate); };
    $('#vVoice').onchange = (e) => { voice.voiceName = e.target.value; store.set('voiceName', voice.voiceName); };
    $('#vBarge').onchange = (e) => { voice.bargeIn = e.target.checked; store.set('bargeIn', voice.bargeIn); };
    $('#convBtn').onclick = () => { voice.conversation = true; startListening(); };
    $('#stopBtn').onclick = () => { speechSynthesis.cancel(); stopListening(); setCore('idle'); };
  },

  async agents(v) {
    const [agents, tools] = await Promise.all([api('/api/agents'), api('/api/tools')]);
    const risk = Object.fromEntries(tools.map((t) => [t.name, t.risk]));
    v.innerHTML = `<div class="grid">${agents.map((a) => `<div class="card span-4"><h3>${esc(a.name)} ${a.activeTasks ? '<span class="badge info">active</span>' : ''}</h3><p class="small">${esc(a.desc)}</p><p class="muted small">Step limit: ${a.maxSteps}</p><div class="row">${a.tools.map((t) => `<span class="badge ${['sensitive', 'financial'].includes(risk[t]) ? 'bad' : risk[t] === 'external' || risk[t] === 'dynamic' ? 'warn' : ''}" title="risk: ${risk[t]}">${esc(t)}</span>`).join('')}</div></div>`).join('')}</div>`;
  },

  async computer(v) {
    const s = await api('/api/status');
    v.innerHTML = `<div class="grid"><div class="card span-6"><h3>Desktop bridge <span class="badge ${s.bridge.connected ? 'ok' : 'bad'}">${s.bridge.connected ? 'connected' : 'not connected'}</span></h3>
      <p class="small">Browsers cannot control your computer. JARVIS uses a separate desktop bridge that runs on your machine with its own allow-list of folders and apps, and polls this server for commands.</p>
      <pre class="out small muted">JARVIS_TOKEN=&lt;token&gt; JARVIS_ALLOWED_DIRS=~/Documents node desktop/bridge.js</pre>
      ${s.bridge.info ? `<div class="kv small"><span class="muted">Platform</span><span>${esc(s.bridge.info.platform)}</span><span class="muted">Capabilities</span><span>${esc((s.bridge.info.capabilities ?? []).join(', '))}</span><span class="muted">Allowed dirs</span><span>${esc((s.bridge.info.allowedDirs ?? []).join(', '))}</span></div>` : ''}
      </div><div class="card span-6"><h3>Quick actions</h3><div class="row">
      <button class="btn" data-cmd="open calculator">Open calculator</button><button class="btn" data-cmd="open https://example.com">Open URL</button></div>
      <p class="muted small">Reading files and screenshots are sensitive and always ask for approval.</p></div></div>`;
    v.querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = () => { location.hash = 'assistant'; send(b.dataset.cmd); }; });
  },

  async automations(v) {
    const [wfs, runs] = await Promise.all([api('/api/automations'), api('/api/automations/runs')]);
    const sample = { name: 'Imported transaction review', trigger: { type: 'event', event: 'wealth.transaction_imported' },
      steps: [{ type: 'tool', tool: 'wealth.analysis', saveAs: 'a', retries: 1 },
        { type: 'condition', if: { path: 'a.calculations.anomalies.unusual.length', op: '>', value: 0 },
          then: [{ type: 'notify', title: 'Unusual spending detected', body: '{{a.calculations.anomalies.unusual.0.description}}', priority: 'high' }], else: [] }] };
    v.innerHTML = `<div class="grid"><div class="card span-7"><h3>Workflows</h3><ul class="list">${wfs.map((w) => `<li><span class="grow"><b>${esc(w.name)}</b><br><span class="muted small">${esc(w.trigger.type)}${w.trigger.event ? `: ${esc(w.trigger.event)}` : ''}${w.trigger.everyMinutes ? ` every ${w.trigger.everyMinutes} min` : ''}</span>${w.steps.map((st) => `<div class="wf-step">${esc(st.type)} ${esc(st.tool ?? st.title ?? st.prompt ?? (st.if ? `${st.if.path} ${st.if.op} ${st.if.value}` : ''))}</div>`).join('')}</span>
      <button class="btn small" data-run="${w.id}">Run</button><button class="btn small" data-toggle="${w.id}" data-en="${w.enabled}">${w.enabled ? 'Disable' : 'Enable'}</button><button class="btn danger small" data-del="${w.id}">Delete</button></li>`).join('') || '<li class="muted small">No workflows yet.</li>'}</ul></div>
      <div class="card span-5"><h3>New workflow (JSON)</h3><textarea id="wfJson">${esc(JSON.stringify(sample, null, 2))}</textarea><div class="row" style="margin-top:8px"><button id="wfCreate" class="btn primary">Create</button></div>
      <p class="muted small">Step types: tool, condition, notify, delay, approval, agent. Triggers: event, schedule (everyMinutes), manual.</p></div>
      <div class="card span-12"><h3>Run history</h3><table><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Log</th><th></th></tr>${runs.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.status)}${r.error ? `<br><span class="err small">${esc(r.error)}</span>` : ''}</td><td class="small">${esc(r.startedAt?.slice(0, 19).replace('T', ' '))}</td><td class="small">${r.log.map((l) => esc(l.tool ?? (l.condition ? `if → ${l.result}` : l.notify ? `notify ${l.notify}` : l.awaitingApproval ? 'approval gate' : ''))).join(' · ')}</td><td>${r.status === 'awaiting_approval' ? `<button class="btn ok small" data-wfa="${r.id}">Approve</button><button class="btn danger small" data-wfc="${r.id}">Cancel</button>` : ''}</td></tr>`).join('')}</table></div></div>`;
    $('#wfCreate').onclick = async () => { try { await api('/api/automations', { method: 'POST', body: $('#wfJson').value }); toast('Workflow created'); render(); } catch (e) { toast(e.message); } };
    v.querySelectorAll('[data-run]').forEach((b) => { b.onclick = async () => { const r = await api(`/api/automations/${b.dataset.run}/run`, { method: 'POST', body: {} }); toast(`Run ${r.status}`); render(); }; });
    v.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = async () => { await api(`/api/automations/${b.dataset.toggle}`, { method: 'PATCH', body: { enabled: b.dataset.en !== 'true' } }); render(); }; });
    v.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (confirm('Delete workflow?')) { await api(`/api/automations/${b.dataset.del}`, { method: 'DELETE' }); render(); } }; });
    v.querySelectorAll('[data-wfa]').forEach((b) => { b.onclick = async () => { await api(`/api/automations/runs/${b.dataset.wfa}/approve`, { method: 'POST', body: { decision: 'approve' } }); render(); }; });
    v.querySelectorAll('[data-wfc]').forEach((b) => { b.onclick = async () => { await api(`/api/automations/runs/${b.dataset.wfc}/cancel`, { method: 'POST' }); render(); }; });
  },

  async memory(v) {
    const [list, meta] = await Promise.all([api('/api/memory'), api('/api/memory/meta')]);
    const pv = (p) => ({ verified: 'ok', user_statement: 'info', inferred: 'warn', ai_suggestion: 'warn', outdated: 'bad' }[p]);
    v.innerHTML = `<div class="grid"><div class="card span-4"><h3>Add memory</h3><form id="memForm" class="row" style="flex-direction:column;align-items:stretch">
      <input name="content" placeholder="Something JARVIS should remember" dir="auto" required>
      <select name="type">${meta.types.map((t) => `<option>${t}</option>`).join('')}</select>
      <select name="provenance">${meta.provenance.filter((p) => p !== 'outdated').map((t) => `<option ${t === 'user_statement' ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select name="workspace">${['personal', 'family', 'financial', 'business', 'projects', 'research', 'documents'].map((w) => `<option>${w}</option>`).join('')}</select>
      <input name="expiresAt" type="date" title="Expires (optional)"><button class="btn primary">Save</button></form>
      <div class="row" style="margin-top:12px"><button id="memExport" class="btn small">Export JSON</button></div></div>
      <div class="card span-8"><h3>Memories <input id="memQ" placeholder="Semantic search…" style="margin-left:auto" dir="auto"></h3><ul class="list" id="memList"></ul></div></div>`;
    const draw = (items) => { $('#memList').innerHTML = items.map((m) => `<li><span class="grow" dir="auto">${esc(m.content)}<br><span class="small muted">${m.type} · ${m.workspace}${m.score ? ` · score ${m.score}` : ''}${m.expiresAt ? ` · expires ${m.expiresAt.slice(0, 10)}` : ''}</span></span>
      <select data-prov="${m.id}" class="small">${meta.provenance.map((p) => `<option ${p === m.provenance ? 'selected' : ''}>${p}</option>`).join('')}</select><span class="badge ${pv(m.provenance)}">${m.provenance}</span>
      <button class="btn small" data-edit="${m.id}">Edit</button><button class="btn danger small" data-mdel="${m.id}">Delete</button></li>`).join('') || '<li class="muted small">No memories.</li>';
      $('#memList').querySelectorAll('[data-prov]').forEach((s) => { s.onchange = async () => { await api(`/api/memory/${s.dataset.prov}`, { method: 'PATCH', body: { provenance: s.value } }); toast('Updated'); render(); }; });
      $('#memList').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = async () => { const m = items.find((x) => x.id === b.dataset.edit); const c = prompt('Correct this memory', m.content); if (c) { await api(`/api/memory/${m.id}`, { method: 'PATCH', body: { content: c } }); render(); } }; });
      $('#memList').querySelectorAll('[data-mdel]').forEach((b) => { b.onclick = async () => { if (confirm('Delete this memory permanently?')) { await api(`/api/memory/${b.dataset.mdel}`, { method: 'DELETE' }); render(); } }; }); };
    draw(list);
    let tm; $('#memQ').oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => draw(e.target.value ? await api(`/api/memory/search?q=${encodeURIComponent(e.target.value)}`) : list), 250); };
    $('#memForm').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.expiresAt) delete f.expiresAt; else f.expiresAt = new Date(f.expiresAt).toISOString(); await api('/api/memory', { method: 'POST', body: f }); render(); };
    $('#memExport').onclick = async () => { const d = await api('/api/memory/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'jarvis-memory.json'; a.click(); };
  },

  async research(v) {
    v.innerHTML = `<div class="grid"><div class="card span-12"><h3>Research</h3><form id="rf" class="composer"><input id="rq" placeholder="A topic to research, or a URL to summarize" dir="auto"><button class="btn primary">Research</button></form>
      <p class="muted small">Web pages are treated as untrusted data: instructions inside them are ignored and flagged. Open-web research needs an AI provider.</p><pre id="rout" class="out" dir="auto"></pre></div></div>`;
    $('#rf').onsubmit = async (e) => { e.preventDefault(); const q = $('#rq').value.trim(); if (!q) return; $('#rout').textContent = 'Working…'; setCore('thinking');
      const t = await api('/api/command', { method: 'POST', body: { text: /^https?:/.test(q) ? q : `research ${q}`, conversationId } }); setCore(t.state === 'FAILED' ? 'error' : 'idle'); $('#rout').textContent = t.response; };
  },

  async documents(v) {
    const docs = await api('/api/documents');
    v.innerHTML = `<div class="grid"><div class="card span-5"><h3>Add document</h3><input id="docFile" type="file" accept=".txt,.md,.csv,.json,.html"><select id="docWs">${['personal', 'family', 'financial', 'business', 'projects', 'research', 'documents'].map((w) => `<option ${w === 'documents' ? 'selected' : ''}>${w}</option>`).join('')}</select>
      <p class="muted small">Text, Markdown, CSV, JSON and HTML are indexed for semantic search. PDF, DOCX, XLSX and OCR go through the document-extraction service (see docs/ARCHITECTURE.md).</p></div>
      <div class="card span-7"><h3>Ask your documents</h3><form id="dq" class="composer"><input placeholder="Search inside documents" dir="auto"><button class="btn">Search</button></form><ul id="dres" class="list"></ul></div>
      <div class="card span-12"><h3>Library</h3><table><tr><th>Name</th><th>Workspace</th><th>Chunks</th><th>Added</th><th></th></tr>${docs.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.workspace)}</td><td>${d.chunks}</td><td>${esc(d.createdAt.slice(0, 10))}</td><td><button class="btn danger small" data-ddel="${d.id}">Delete</button></td></tr>`).join('')}</table></div></div>`;
    $('#docFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 1.5e6) return toast('File too large (1.5 MB max)'); const text = await f.text(); await api('/api/documents', { method: 'POST', body: { name: f.name, text, workspace: $('#docWs').value } }); toast(`Indexed ${f.name}`); render(); };
    $('#dq').onsubmit = async (e) => { e.preventDefault(); const q = $('input', e.target).value; const r = await api(`/api/documents/search?q=${encodeURIComponent(q)}`); $('#dres').innerHTML = r.map((x) => `<li class="small" dir="auto"><span class="grow">${esc(x.content.slice(0, 300))}<br><span class="muted">${esc(x.tags.join(', '))} · ${x.score}</span></span></li>`).join('') || '<li class="muted small">No matches.</li>'; };
    v.querySelectorAll('[data-ddel]').forEach((b) => { b.onclick = async () => { await api(`/api/documents/${b.dataset.ddel}`, { method: 'DELETE' }); render(); }; });
  },

  async wealth(v) {
    const [ov, an, budgets, accounts] = await Promise.all([api('/api/wealth/overview'), api('/api/wealth/analysis', { method: 'POST', body: {} }), api('/api/wealth/budgets'), api('/api/wealth/accounts')]);
    const f = an.facts.currentMonth; const nw = ov.facts.netWorth;
    v.innerHTML = `<div class="grid">
      <div class="card span-3"><h3>Net worth</h3><div class="stat">${money(nw.netWorth)}</div><div class="muted small">Assets ${money(nw.assets)} · Liabilities ${money(nw.liabilities)}</div></div>
      <div class="card span-3"><h3>Spent · ${an.month} to date</h3><div class="stat">${money(f.expenses)}</div><div class="muted small">${an.calculations.expenseChange >= 0 ? '▲' : '▼'} ${money(Math.abs(an.calculations.expenseChange))} vs last month</div></div>
      <div class="card span-3"><h3>Income</h3><div class="stat">${money(f.income)}</div><div class="muted small">Net ${money(f.net)}</div></div>
      <div class="card span-3"><h3>Savings potential</h3><div class="stat">${money(an.calculations.potentialMonthlySaving)}</div><div class="muted small">per month (calculated)</div></div>
      <div class="card span-6"><h3>Budgets</h3>${budgets.map((b) => `<div class="row small" style="justify-content:space-between;margin-top:8px"><span>${esc(b.category)}</span><span>${money(b.spent)} / ${money(b.limit)}</span></div><div class="bar ${b.over ? 'over' : ''}"><i style="width:${Math.min(100, b.usedPct ?? 0)}%"></i></div>`).join('')}</div>
      <div class="card span-6"><h3>Recommendations</h3><ul class="list">${an.recommendations.map((r) => `<li class="small"><span class="badge">${r.kind}</span><span class="grow">${esc(r.text)}</span></li>`).join('') || '<li class="muted small">Nothing to flag.</li>'}</ul><p class="muted small">${esc(an.disclaimer)}</p></div>
      <div class="card span-4"><h3>Savings goals</h3>${ov.goals.map((x) => `<div class="small" style="margin-top:8px">${esc(x.name)} · ${x.pct}% · ${x.monthsToGoal ?? '–'} months ${x.onTrack === false ? '<span class="badge bad">behind</span>' : x.onTrack ? '<span class="badge ok">on track</span>' : ''}</div><div class="bar"><i style="width:${Math.min(100, x.pct)}%"></i></div>`).join('')}</div>
      <div class="card span-4"><h3>Upcoming bills</h3><ul class="list">${ov.upcomingBills.map((b) => `<li class="small"><span class="grow">${esc(b.name)}<br><span class="muted">${b.dueDate}</span></span>${b.overdue ? '<span class="badge bad">overdue</span>' : ''}<b>${money(b.amount)}</b></li>`).join('') || '<li class="muted small">None.</li>'}</ul></div>
      <div class="card span-4"><h3>Forecast (${an.forecasts.basedOnMonths.length}-month avg)</h3><div class="kv small"><span class="muted">Avg income</span><span>${money(an.forecasts.avgIncome)}</span><span class="muted">Avg expenses</span><span>${money(an.forecasts.avgExpenses)}</span><span class="muted">Avg net</span><span>${money(an.forecasts.avgNet)}</span><span class="muted">In 6 months</span><span>${money(an.forecasts.projection.at(-1).cumulativeNet)}</span></div><p class="muted small">${esc(an.forecasts.assumption)}</p></div>
      <div class="card span-6"><h3>Scenario simulator</h3><form id="simF" class="row">${Object.keys(f.byCategory).slice(0, 6).map((c) => `<label class="small">${esc(c)} <input name="${esc(c)}" type="number" min="0" max="100" value="0" style="width:70px">%</label>`).join('')}<button class="btn">Simulate</button></form><p id="simOut" class="small"></p></div>
      <div class="card span-6"><h3>Accounts</h3><table>${accounts.map((a) => `<tr><td>${esc(a.name)}<br><span class="muted small">${esc(a.institution)}</span></td><td class="num">${money(a.balance)}</td></tr>`).join('')}</table></div>
      <div class="card span-12"><h3>Spending by category · this month vs previous</h3><table><tr><th>Category</th><th class="num">This month</th><th class="num">Previous</th><th class="num">Change</th></tr>${an.calculations.categoryChanges.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${money(c.current)}</td><td class="num">${money(c.previous)}</td><td class="num" style="color:${c.change > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(c.change)}</td></tr>`).join('')}</table></div></div>`;
    $('#simF').onsubmit = async (e) => { e.preventDefault(); const cuts = Object.fromEntries([...new FormData(e.target)].map(([k, x]) => [k, Number(x)]).filter(([, x]) => x > 0));
      const r = await api('/api/wealth/recommendations', { method: 'POST', body: { cuts } }); $('#simOut').textContent = `Estimated saving: ${money(r.simulation.monthlySaving)} / month, ${money(r.simulation.yearlySaving)} / year (calculation, not a guarantee).`; };
  },

  async home(v) {
    const devices = await api('/api/home/devices');
    v.innerHTML = `<div class="grid"><div class="card span-8"><h3>Devices</h3><ul class="list">${devices.map((d) => `<li class="device"><span class="grow">${esc(d.name)}<br><span class="muted small">${esc(d.area ?? '')} · ${esc(d.domain)}${d.attributes?.temperature ? ` · ${d.attributes.temperature}°` : ''}</span></span>
      ${!d.online ? '<span class="badge bad">offline</span>' : d.domain === 'light' ? `<button class="switch ${d.state === 'on' ? 'on' : ''}" data-dev="${d.name}" data-on="${d.state === 'on'}" aria-label="toggle"></button>` : d.domain === 'lock' ? `<span class="badge ${d.state === 'locked' ? 'ok' : 'warn'}">${d.state}</span>` : `<span class="badge">${esc(d.state)}</span>`}</li>`).join('')}</ul></div>
      <div class="card span-4"><h3>Scenes & climate</h3><div class="row"><button class="btn" data-cmd="activate evening mode">Evening mode</button><button class="btn" data-cmd="activate night mode">Night mode</button><button class="btn" data-cmd="set the temperature to 23">AC 23°</button><button class="btn" data-cmd="lock the front door">Lock front door</button></div>
      <p class="muted small">Unlocking doors and disarming alarms always require your approval.</p></div></div>`;
    v.querySelectorAll('[data-dev]').forEach((b) => { b.onclick = async () => { const t = await api('/api/home/command', { method: 'POST', body: { text: `turn ${b.dataset.on === 'true' ? 'off' : 'on'} the ${b.dataset.dev}` } }); if (t.state !== 'COMPLETED') toast(t.response); render(); }; });
    v.querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = async () => { const t = await api('/api/home/command', { method: 'POST', body: { text: b.dataset.cmd } }); toast(t.response); render(); }; });
  },

  async tasks(v) {
    const tasks = await api('/api/tasks');
    v.innerHTML = `<div class="grid"><div class="card span-4"><h3>New task</h3><form id="tf" class="row" style="flex-direction:column;align-items:stretch"><input name="title" placeholder="Task" required dir="auto"><select name="priority"><option>normal</option><option>high</option><option>low</option></select><input name="due" type="date"><input name="project" placeholder="Project (optional)"><select name="repeat"><option value="">No repeat</option><option>daily</option><option>weekly</option><option>monthly</option></select><button class="btn primary">Add</button></form></div>
      <div class="card span-8"><h3>Tasks</h3><ul class="list">${tasks.map((t) => `<li><input type="checkbox" ${t.done ? 'checked disabled' : ''} data-done="${t.id}"><span class="grow" dir="auto" style="${t.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.title)}<br><span class="muted small">${t.priority}${t.due ? ` · due ${t.due.slice(0, 10)}` : ''}${t.project ? ` · ${esc(t.project)}` : ''}${t.repeat ? ` · ${t.repeat}` : ''}</span></span><button class="btn danger small" data-tdel="${t.id}">✕</button></li>`).join('') || '<li class="muted small">No tasks.</li>'}</ul></div></div>`;
    $('#tf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.due = f.due ? new Date(f.due).toISOString() : null; f.repeat = f.repeat || null; await api('/api/tasks', { method: 'POST', body: f }); render(); };
    v.querySelectorAll('[data-done]').forEach((c) => { c.onchange = async () => { try { await api(`/api/tasks/${c.dataset.done}/complete`, { method: 'POST' }); } catch (e) { toast(e.message); } render(); }; });
    v.querySelectorAll('[data-tdel]').forEach((b) => { b.onclick = async () => { await api(`/api/tasks/${b.dataset.tdel}`, { method: 'DELETE' }); render(); }; });
  },

  async calendar(v) {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const events = await api(`/api/events?from=${from.toISOString()}`);
    v.innerHTML = `<div class="grid"><div class="card span-4"><h3>New event</h3><form id="ef" class="row" style="flex-direction:column;align-items:stretch"><input name="title" placeholder="Title" required dir="auto"><input name="start" type="datetime-local" required><input name="end" type="datetime-local"><input name="location" placeholder="Location"><button class="btn primary">Add</button></form><p id="efOut" class="small"></p></div>
      <div class="card span-8"><h3>Upcoming</h3><ul class="list">${events.map((e) => `<li><span class="badge info">${new Date(e.start).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span class="grow" dir="auto">${esc(e.title)}${e.location ? ` <span class="muted small">· ${esc(e.location)}</span>` : ''}</span></li>`).join('') || '<li class="muted small">Nothing scheduled.</li>'}</ul></div></div>`;
    $('#ef').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.start = new Date(f.start).toISOString(); f.end = f.end ? new Date(f.end).toISOString() : null; const r = await api('/api/events', { method: 'POST', body: f }); if (r.conflicts.length) toast(`Conflicts with: ${r.conflicts.join(', ')}`, 'high'); render(); };
  },

  async integrations(v) {
    const list = await api('/api/integrations');
    v.innerHTML = `<div class="grid">${list.map((i) => `<div class="card span-4"><h3>${esc(i.name)} <span class="badge ${i.status === 'connected' ? 'ok' : i.status === 'demo' ? 'warn' : ''}">${i.status}</span></h3><div class="kv small"><span class="muted">Category</span><span>${esc(i.category)}</span><span class="muted">Auth</span><span>${esc(i.auth)}</span><span class="muted">Permissions</span><span>${esc(i.permissions.join(', ') || '–')}</span>${i.lastSeen ? `<span class="muted">Last sync</span><span>${esc(i.lastSeen)}</span>` : ''}</div></div>`).join('')}</div>`;
  },

  async notifications(v) {
    const [list, prefs] = await Promise.all([api('/api/notifications'), api('/api/notifications/prefs')]);
    v.innerHTML = `<div class="grid"><div class="card span-8"><h3>Notifications</h3><ul class="list">${list.map((n) => `<li class="small" style="${n.read ? 'opacity:.55' : ''}"><span class="badge ${n.priority === 'high' || n.priority === 'critical' ? 'warn' : ''}">${n.priority}</span><span class="grow" dir="auto"><b>${esc(n.title)}</b>${n.count > 1 ? ` ×${n.count}` : ''} ${esc(n.body)}<br><span class="muted">${esc(n.event)} · ${esc(n.status)} · ${esc(n.at?.slice(0, 16).replace('T', ' '))}</span></span>${n.read ? '' : `<button class="btn small" data-read="${n.id}">Mark read</button>`}</li>`).join('') || '<li class="muted">Empty.</li>'}</ul></div>
      <div class="card span-4"><h3>Preferences</h3><form id="np" class="kv small"><label>Quiet from</label><input name="qs" type="time" value="${prefs.quietHours.start}"><label>Quiet until</label><input name="qe" type="time" value="${prefs.quietHours.end}"><label>Minimum priority</label><select name="minPriority">${['low', 'normal', 'high', 'critical'].map((p) => `<option ${p === prefs.minPriority ? 'selected' : ''}>${p}</option>`).join('')}</select><label>Muted events</label><input name="muted" value="${esc(prefs.muted.join(', '))}" placeholder="e.g. proactive:device_offline"><span></span><button class="btn primary">Save</button></form>
      <div class="row" style="margin-top:10px"><button id="pushBtn" class="btn small">Enable desktop notifications</button></div></div></div>`;
    v.querySelectorAll('[data-read]').forEach((b) => { b.onclick = async () => { await api(`/api/notifications/${b.dataset.read}/read`, { method: 'POST' }); render(); refreshBadges(); }; });
    $('#np').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api('/api/notifications/prefs', { method: 'PUT', body: { quietHours: { start: f.qs, end: f.qe }, minPriority: f.minPriority, muted: f.muted.split(',').map((x) => x.trim()).filter(Boolean) } }); toast('Saved'); };
    $('#pushBtn').onclick = async () => { if (!('Notification' in window)) return toast('Not supported'); toast(`Desktop notifications: ${await Notification.requestPermission()}`); };
  },

  async security(v) {
    const [policy, audit, approvals] = await Promise.all([api('/api/security/policy'), api('/api/security/audit'), api('/api/approvals')]);
    const desc = { read: 'Read data you authorized', write: 'Change your own records (tasks, memory)', external: 'Talk to outside services/devices', sensitive: 'Locks, alarms, files, screenshots', financial: 'Money movement (never executed by JARVIS)' };
    v.innerHTML = `<div class="grid"><div class="card span-5"><h3>Permission policy</h3><table>${Object.entries(policy).map(([k, m]) => `<tr><td><b>${k}</b><br><span class="muted small">${desc[k] ?? ''}</span></td><td><select data-risk="${k}">${['allow', 'approve', 'deny'].filter((x) => !(['financial', 'sensitive'].includes(k) && x === 'allow')).map((x) => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select></td></tr>`).join('')}</table>
      <h3 style="margin-top:16px">Pending approvals</h3><ul class="list">${approvals.map((a) => `<li class="small"><span class="grow">${esc(a.summary)}</span><button class="btn ok small" data-approve="${a.id}">Approve</button><button class="btn danger small" data-reject="${a.id}">Reject</button></li>`).join('') || '<li class="muted small">None.</li>'}</ul></div>
      <div class="card span-7"><h3>Audit log</h3><div style="max-height:65vh;overflow:auto"><table><tr><th>Time</th><th>Actor</th><th>Action</th><th>Outcome</th></tr>${audit.map((a) => `<tr><td class="small">${esc(a.at.slice(5, 19).replace('T', ' '))}</td><td class="small">${esc(a.actor)}</td><td class="small">${esc(a.action)}</td><td><span class="badge ${a.outcome === 'ok' ? '' : 'bad'}">${esc(a.outcome)}</span></td></tr>`).join('')}</table></div></div></div>`;
    v.querySelectorAll('[data-risk]').forEach((s) => { s.onchange = async () => { try { await api('/api/security/policy', { method: 'PUT', body: { risk: s.dataset.risk, mode: s.value } }); toast('Policy updated'); } catch (e) { toast(e.message); render(); } }; });
  },

  async settings(v) {
    const s = await api('/api/status');
    v.innerHTML = `<div class="grid"><div class="card span-6"><h3>Connection</h3><div class="kv small"><span class="muted">Server</span><span>${esc(location.origin)}</span><span class="muted">AI providers</span><span>${esc(s.providers.map((p) => p.provider).join(', '))}</span><span class="muted">Smart home</span><span>${esc(s.home)}</span></div><div class="row" style="margin-top:12px"><button id="logout" class="btn danger small">Forget token</button><button id="clearChat" class="btn small">Clear conversation</button></div></div>
      <div class="card span-6"><h3>Model routing</h3><div class="kv small">${['low', 'medium', 'high'].map((c) => `<span class="muted">${c} complexity</span><span id="rt-${c}">…</span>`).join('')}<span class="muted">Voice (realtime)</span><span>${esc(s.route.voice.model)}</span><span class="muted">Local only</span><span>local</span></div><p class="muted small">Override with JARVIS_MODEL_FAST / _BALANCED / _DEEP.</p></div></div>`;
    for (const c of ['low', 'medium', 'high']) api(`/api/models/route?complexity=${c}`).then((r) => { $(`#rt-${c}`).textContent = `${r.model} — ${r.reason}`; });
    $('#logout').onclick = () => { store.set('token', ''); TOKEN = ''; showLogin(); };
    $('#clearChat').onclick = () => { messages.length = 0; store.set('messages', []); toast('Cleared'); };
  },
};

// ---------------- live events ----------------
let es;
function connectStream() {
  es?.close();
  es = new EventSource(`/api/stream?token=${encodeURIComponent(TOKEN)}`);
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'notification') {
      toast(`${e.data.title}${e.data.body ? ` — ${e.data.body}` : ''}`, e.data.priority);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(e.data.title, { body: e.data.body });
      refreshBadges();
    } else if (e.type === 'task') {
      const map = { PLANNING: 'thinking', EXECUTING: 'executing', VERIFYING: 'executing', AWAITING_APPROVAL: 'approval', FAILED: 'error' };
      if (map[e.data.state] && coreState !== 'speaking') setCore(map[e.data.state]);
    }
  };
}

async function refreshBadges() {
  try {
    const [n, s] = await Promise.all([api('/api/notifications?unread=1'), api('/api/status')]);
    $('#bellCount').textContent = n.length;
    $('#demoBadge').classList.toggle('hidden', !s.demoData);
    const ai = s.providers.find((p) => !p.capabilities.local);
    $('#providerBadge').textContent = ai ? `AI: ${ai.provider}` : 'AI: local only';
    $('#providerBadge').className = `badge ${ai ? 'ok' : 'warn'}`;
  } catch { /* handled by api() */ }
}

function showLogin() { $('#login').classList.remove('hidden'); }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  TOKEN = $('#tokenInput').value.trim();
  try { await api('/api/status'); store.set('token', TOKEN); $('#login').classList.add('hidden'); boot(); }
  catch (err) { $('#loginErr').textContent = 'Token rejected.'; }
};

async function boot() {
  if (!TOKEN) return showLogin();
  connectStream(); refreshBadges(); render();
}
boot();
