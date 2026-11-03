// Screens. Each view renders into #view and may register a cleanup for timers.
import { api, esc, money, toast, $, $$, local, auth } from './api.js';
import { t, getLang } from './i18n.js';
import { coreHTML, setCoreState } from './core.js';
import { chatPanel, renderChats, clearChat, chatEvents } from './chat.js';
import { voice, startListening, stopAll, saveVoicePrefs, toggleListening } from './voice.js';
import { lineChart, donut, gauge } from './charts.js';

let cleanups = [];
export function cleanup() { cleanups.forEach((f) => f()); cleanups = []; }
const every = (ms, fn) => { const h = setInterval(fn, ms); cleanups.push(() => clearInterval(h)); };
const he = () => getLang() === 'he';
const fmtTime = (iso) => new Date(iso).toLocaleString(he() ? 'he-IL' : 'en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const stateTag = (s) => `<span class="tag ${s === 'COMPLETED' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'AWAITING_APPROVAL' ? 'warn' : s === 'CANCELLED' ? '' : 'info'} mono xs">${s}</span>`;
const dotFor = (st) => (['online', 'built', 'connected'].includes(st) ? 'ok' : ['disabled', 'source', 'demo'].includes(st) ? 'warn' : st === 'offline' ? 'bad' : '');
const ENGINE_IC = { memory: '⛁', voice: '〰', computer: '🖥', agents: '⎔', security: '⛨', automation: '⟳' };
const agentName = (a) => (he() ? a.nameHe : a.name);
const CAT_COLORS = ['#22e08a', '#2ee6ff', '#8a6cff', '#ffbf3c', '#ff5d6c', '#4aa3ff', '#9fe8ff', '#f472b6'];

function steps(task) {
  return `<div class="progress-steps">${(task.steps ?? task.plan?.steps ?? []).map((s) => `<i class="${s.status === 'done' ? 'done' : s.status === 'failed' ? 'fail' : task.state === 'AWAITING_APPROVAL' && s.status === 'pending' ? 'wait' : ['EXECUTING', 'VERIFYING', 'PLANNING'].includes(task.state) ? 'run' : ''}" title="${esc(s.tool)}"></i>`).join('')}</div>`;
}

// ===================================================== Command Center
async function command(v) {
  v.innerHTML = `<div class="hud">
    <div class="hud-col">
      <div class="panel glass corner"><h2>${t('system_status')}</h2><div id="hEngines"></div></div>
      <div class="panel glass corner"><h2>${t('active_agents')}</h2><div id="hAgents" class="agent-grid"></div></div>
      <div class="panel glass corner"><h2>${t('notifications')}</h2><ul id="hNotes" class="list"></ul></div>
    </div>
    <div class="hud-col hud-center">
      ${coreHTML()}
      <div class="interim muted small" dir="auto" style="min-height:20px"></div>
      <button id="talkBtn" class="talk-btn">◉ ${esc(t('talk').toUpperCase())}</button>
      <div class="panel glass corner" style="width:100%"><h2>${t('current_task')}</h2><div id="hTask"></div></div>
      <div class="panel glass corner" style="width:100%"><div class="gauges" id="hGauges"></div></div>
    </div>
    <div class="hud-col">
      <div class="panel glass corner"><h2>${t('weather')}</h2><div id="hWeather"></div></div>
      <div class="panel glass corner"><h2>${t('calendar')}</h2><ul id="hCal" class="list"></ul></div>
      <div class="panel glass corner"><h2>${t('finance')} <a class="right xs muted" href="#wealth">→</a></h2><div id="hFin"></div></div>
      <div class="panel glass corner"><h2>${t('smart_home')} <a class="right xs muted" href="#home">→</a></h2><div id="hHome"></div></div>
      <div class="panel glass corner"><h2>${t('approvals')}</h2><ul id="hAppr" class="list"></ul></div>
    </div>
  </div>
  <div class="grid" style="margin-top:16px"><div class="c7" id="hChat"></div>
    <div class="c5 col"><div class="panel glass corner"><h2>${t('suggestions')}</h2><ul id="hSug" class="list"></ul></div>
    <div class="panel glass corner"><h2>${t('recent')}</h2><ul id="hRecent" class="list"></ul></div></div></div>`;
  $('#hChat').append(chatPanel({ cls: 'short' }));
  renderChats();
  $('#talkBtn').onclick = () => { if (voice.live) stopAll(); else { voice.conversation = true; startListening(); } };

  const load = async () => {
    const [map, agents, tasks, notes, metrics, ov, devices, ap, events, prop] = await Promise.all([
      api('/api/system/map'), api('/api/agents'), api('/api/tasks/exec'), api('/api/notifications'), api('/api/system/metrics'),
      api('/api/wealth/overview'), api('/api/home/devices'), api('/api/approvals'), api(`/api/events?from=${new Date().toISOString()}`), api('/api/proactive')]);
    $('#hEngines').innerHTML = map.engines.map((e) => `<div class="engine-row"><span class="dot ${dotFor(e.status)}"></span><span class="grow"><b class="small">${esc(he() ? e.nameHe : e.name)}</b><div class="xs muted">${esc(e.detail)}</div></span></div>`).join('');
    const active = agents.filter((a) => a.activeTasks || a.lastRun).sort((a, b) => (b.activeTasks - a.activeTasks) || String(b.lastRun?.at).localeCompare(String(a.lastRun?.at))).slice(0, 8);
    $('#hAgents').innerHTML = (active.length ? active : agents.slice(0, 6)).map((a) => `<div class="agent-chip"><span class="dot ${a.activeTasks ? 'info pulse' : a.lastRun?.state === 'FAILED' ? 'bad' : a.lastRun ? 'ok' : ''}"></span><span class="grow">${esc(agentName(a))}</span>${a.activeTasks ? `<span class="tag info xs">${a.activeTasks}</span>` : ''}</div>`).join('');
    $('#hNotes').innerHTML = notes.slice(0, 5).map((n) => `<li class="small"><span class="dot ${n.priority === 'high' || n.priority === 'critical' ? 'warn' : 'info'}"></span><span class="grow" dir="auto">${esc(n.title)}${n.body ? ` <span class="muted">${esc(n.body)}</span>` : ''}</span></li>`).join('') || `<li class="empty">${t('no_notifications')}</li>`;
    const cur = tasks.find((x) => ['PLANNING', 'EXECUTING', 'VERIFYING', 'AWAITING_APPROVAL'].includes(x.state)) ?? tasks[0];
    $('#hTask').innerHTML = cur ? `<div class="row">${stateTag(cur.state)}<span class="grow small" dir="auto">${esc(cur.objective)}</span></div>${steps(cur)}<div class="xs muted mono" style="margin-top:6px">${esc((cur.steps ?? []).map((s) => s.agent).join(' → '))}</div>` : `<p class="empty">${t('no_task')}</p>`;
    $('#hGauges').innerHTML = gauge(metrics.cpuLoadPct, { label: t('cpu') }) + gauge(metrics.memoryPct, { label: t('memory'), color: 'var(--violet)' })
      + gauge(metrics.aiLatencyMs == null ? null : Math.min(100, metrics.aiLatencyMs / 100), { label: `${t('latency')}${metrics.aiLatencyMs != null ? ` ${metrics.aiLatencyMs}ms` : ''}`, suffix: '', color: 'var(--amber)' })
      + gauge(metrics.taskSuccessPct, { label: t('success'), color: 'var(--green)' });
    const nw = ov.facts.netWorth;
    $('#hFin').innerHTML = `<div class="xs muted">${t('net_worth')}</div><div class="stat">${money(nw.netWorth)}</div><div class="kv small" style="margin-top:6px"><span class="muted">${t('spent_month')}</span><span class="num">${money(ov.facts.month.expenses)}</span><span class="muted">${t('bills_soon')}</span><span>${ov.upcomingBills.length}${ov.upcomingBills.some((b) => b.overdue) ? ' <span class="tag bad xs">!</span>' : ''}</span></div>`;
    const on = devices.filter((d) => d.state === 'on').length; const off = devices.filter((d) => !d.online);
    $('#hHome').innerHTML = `<div class="row"><span class="stat">${on}</span><span class="muted small">${t('devices_on')}</span></div>${off.map((d) => `<div class="small"><span class="dot bad"></span> ${esc(d.name)} · ${t('offline')}</div>`).join('')}`;
    $('#hAppr').innerHTML = ap.map((a) => `<li class="small"><span class="grow" dir="auto">${esc(a.summary)}<div class="xs muted">${esc(a.consequences ?? '')}</div></span><button class="btn ok sm" data-approve="${a.id}">${t('approve')}</button><button class="btn danger sm" data-reject="${a.id}">${t('reject')}</button></li>`).join('') || `<li class="empty">${t('none_waiting')}</li>`;
    $('#hCal').innerHTML = events.slice(0, 4).map((e) => `<li class="small"><span class="tag info mono xs">${esc(fmtTime(e.start))}</span><span class="grow" dir="auto">${esc(e.title)}</span></li>`).join('') || `<li class="empty">${t('no_events')}</li>`;
    $('#hSug').innerHTML = prop.slice(0, 5).map((p) => `<li class="small"><span class="dot ${p.score > 0.8 ? 'warn' : 'info'}"></span><span class="grow" dir="auto">${esc(p.title)}<div class="xs muted">${esc(p.why ?? '')}</div></span><span class="mono xs muted">${p.score}</span></li>`).join('') || `<li class="empty">—</li>`;
    $('#hRecent').innerHTML = tasks.slice(0, 6).map((x) => `<li class="small">${stateTag(x.state)}<span class="grow" dir="auto">${esc(x.objective)}</span></li>`).join('') || '<li class="empty">—</li>';
    if (ap.length) setCoreState('approval');
  };
  const loadWeather = async () => {
    const w = await api('/api/context/weather');
    $('#hWeather').innerHTML = w.available ? `<div class="row"><span class="stat big">${w.temperature}°</span><span class="grow"><div>${esc(he() ? w.textHe : w.text)}</div><div class="xs muted">${esc(w.location)} · ${w.min}°–${w.max}° · 💧${w.humidity}%</div></span></div>` : `<p class="empty">${t('weather_na')} <span class="xs">(${esc(w.reason ?? '')})</span></p>`;
  };
  await Promise.all([load(), loadWeather()]);
  every(10000, load);
  const onTask = () => load(); chatEvents.addEventListener('task', onTask); cleanups.push(() => chatEvents.removeEventListener('task', onTask));
}

// ===================================================== Conversation
async function conversation(v) {
  v.innerHTML = `<div class="grid"><div class="c5 panel glass corner" style="display:flex;flex-direction:column;align-items:center;gap:12px">${coreHTML()}
    <button id="convBtn" class="talk-btn">◉ ${esc(t('talk').toUpperCase())}</button>
    <div class="row"><button id="stopBtn" class="btn sm">■ ${t('stop')}</button><span class="xs muted">Alt+Space · Esc</span></div>
    ${voice.supported ? '' : `<p class="err small">${t('no_stt')}</p>`}
    <div class="kv small" style="width:100%"><label for="vLang">${t('language')}</label><select id="vLang"><option value="he-IL">עברית</option><option value="en-US">English</option></select>
    <label for="vVoice">${t('voice')}</label><select id="vVoice"></select>
    <label for="vRate">${t('voice_rate')}</label><input id="vRate" type="range" min="0.6" max="1.6" step="0.1">
    <span></span><label class="row"><input id="vBarge" type="checkbox"> ${t('barge')}</label></div></div>
    <div class="c7" id="convChat"></div></div>`;
  $('#convChat').append(chatPanel({ cls: 'tall' }));
  renderChats();
  $('#vLang').value = voice.lang; $('#vRate').value = voice.rate; $('#vBarge').checked = voice.bargeIn;
  const fill = () => { $('#vVoice').innerHTML = `<option value="">Default</option>${speechSynthesis.getVoices().filter((x) => /^(he|en)/.test(x.lang)).map((x) => `<option ${x.name === voice.voiceName ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`; };
  fill(); speechSynthesis.onvoiceschanged = fill;
  $('#vLang').onchange = (e) => { voice.lang = e.target.value; saveVoicePrefs(); };
  $('#vRate').oninput = (e) => { voice.rate = Number(e.target.value); saveVoicePrefs(); };
  $('#vVoice').onchange = (e) => { voice.voiceName = e.target.value; saveVoicePrefs(); };
  $('#vBarge').onchange = (e) => { voice.bargeIn = e.target.checked; saveVoicePrefs(); };
  $('#convBtn').onclick = () => { if (voice.live) stopAll(); else { voice.conversation = true; startListening(); } };
  $('#stopBtn').onclick = () => { stopAll(); setCoreState('idle'); };
}

// ===================================================== System Map
async function map(v) {
  const m = await api('/api/system/map');
  const stLabel = (s) => t(`status_${s}`);
  v.innerHTML = `<div class="panel glass map-core"><div style="font-size:34px;filter:drop-shadow(0 0 10px var(--cyan))">🧠</div><h2>JARVIS CORE</h2><div class="muted">${t('core_desc')}</div><div class="xs muted mono" style="margin-top:6px">AI: ${esc(m.core.ai)}</div></div>
  <div class="map-arrow">↓</div>
  <div class="grid">${m.engines.map((e) => `<div class="c4 panel glass corner engine-tile"><div class="ic">${ENGINE_IC[e.id]}</div><h3>${esc(he() ? e.nameHe : e.name)}</h3><div class="row" style="justify-content:center"><span class="dot ${dotFor(e.status)}"></span><span class="small">${esc(e.status)}</span></div><div class="xs muted" style="margin-top:6px">${esc(e.detail)}</div></div>`).join('')}</div>
  <div class="map-arrow">↓</div>
  <div class="grid">${m.clients.map((c) => `<div class="c3 panel glass corner"><h2>${esc(c.kind)} <span class="right tag ${c.status === 'built' ? 'ok' : 'warn'} xs">${esc(stLabel(c.status))}</span></h2><div class="xs muted">${esc(c.caps.join(' · '))}</div>${c.note ? `<div class="xs dim" style="margin-top:6px">${esc(c.note)}</div>` : ''}<div class="xs" style="margin-top:6px">${t('devices')}: ${c.connected}</div></div>`).join('')}</div>`;
}

// ===================================================== Agent Workspace
async function agents(v) {
  const [list, tasks] = await Promise.all([api('/api/agents'), api('/api/tasks/exec')]);
  let sel = local.get('agentSel', 'executive');
  const draw = () => {
    const a = list.find((x) => x.id === sel) ?? list[0];
    const mine = tasks.filter((x) => (x.steps ?? []).some((s) => s.agent === a.id));
    v.innerHTML = `<div class="grid">
      <div class="c3 panel glass corner"><h2>${t('agents')} <span class="right tag info xs">${list.length}</span></h2><ul class="list">${list.map((x) => `<li class="small" style="cursor:pointer" data-sel="${x.id}"><span class="dot ${x.activeTasks ? 'info pulse' : x.lastRun?.state === 'FAILED' ? 'bad' : x.lastRun ? 'ok' : ''}"></span><span class="grow" style="${x.id === a.id ? 'color:var(--cyan)' : ''}">${esc(agentName(x))}</span><span class="xs muted mono">${x.completed}</span></li>`).join('')}</ul></div>
      <div class="c6 panel glass corner"><div style="display:flex;gap:16px;align-items:center"><div style="width:110px">${coreHTML({ mini: true, label: false })}</div><div class="grow"><h2 style="margin:0">${esc(agentName(a))}</h2><div class="small">${esc(a.scope)}</div>
        <div class="row" style="margin-top:8px"><span class="tag ok xs">✓ ${a.completed}</span><span class="tag bad xs">✕ ${a.failed}</span><span class="tag info xs">${t('steps_limit')}: ${a.maxSteps}</span></div></div></div>
        <h2 style="margin-top:16px">${t('tools')}</h2><div class="row">${a.tools.map((x) => `<span class="tag mono xs">${esc(x)}</span>`).join('')}</div>
        <h2 style="margin-top:16px">${t('data_domains')}</h2><div class="row">${a.dataScopes.map((x) => `<span class="tag ${['financial', 'health'].includes(x) ? 'warn' : ''} xs">${esc(x)}</span>`).join('')}</div>
        ${a.delegatesTo.length ? `<h2 style="margin-top:16px">${t('delegates_to')}</h2><div class="row">${a.delegatesTo.map((x) => `<span class="tag info xs">${esc(x)}</span>`).join('')}</div>` : ''}
        <h2 style="margin-top:16px">I/O</h2><pre class="out xs mono muted" dir="ltr">input:  ${esc(JSON.stringify(a.input))}\noutput: ${esc(JSON.stringify(a.output))}</pre></div>
      <div class="c3 panel glass corner"><h2>${t('activity')}</h2><ul class="list">${mine.slice(0, 12).map((x) => `<li class="small col" style="align-items:stretch">${stateTag(x.state)}<span dir="auto">${esc(x.objective)}</span>${steps(x)}</li>`).join('') || '<li class="empty">—</li>'}</ul></div></div>`;
    $$('[data-sel]', v).forEach((li) => { li.onclick = () => { sel = li.dataset.sel; local.set('agentSel', sel); draw(); }; });
  };
  draw();
}

// ===================================================== Automation Studio
async function automations(v) {
  const [wfs, runs] = await Promise.all([api('/api/automations'), api('/api/automations/runs')]);
  const block = (st) => `<div class="block ${st.type}"><span class="bt">${esc(st.type)}</span><span class="grow" dir="auto">${esc(st.label ?? st.tool ?? st.title ?? st.summary ?? st.prompt ?? (st.if ? `${st.if.path} ${st.if.op} ${st.if.value}` : ''))}</span>${st.tool && st.label ? `<span class="xs mono muted">${esc(st.tool)}</span>` : ''}</div>${st.then?.length ? `<div style="margin-inline-start:18px">${st.then.map(block).join('')}</div>` : ''}${st.onError?.length ? `<div style="margin-inline-start:18px" class="xs muted">on error:</div><div style="margin-inline-start:18px">${st.onError.map(block).join('')}</div>` : ''}`;
  const trig = (tr) => (tr.type === 'event' ? `⚡ ${tr.event}` : tr.type === 'schedule' ? `⏱ ${tr.everyMinutes}m` : '▶ manual');
  v.innerHTML = `<div class="grid">
    <div class="c6 panel glass corner"><h2>${t('nl_workflow')}</h2><textarea id="nlText" dir="auto" style="font-family:var(--font)">${he() ? 'כשאני מגיע הביתה: הדלק את האורות למטה; מה יש לי היום; אל תפתח את הדלת' : 'When I arrive home: turn on the lights downstairs; organize my day; do not unlock doors'}</textarea>
      <div class="row" style="margin-top:8px"><button id="nlPrev" class="btn">${t('preview')}</button><button id="nlCreate" class="btn primary">${t('create')}</button><button id="simHome" class="btn sm">⚡ presence.arrived_home</button></div><div id="nlOut" style="margin-top:10px"></div></div>
    <div class="c6 panel glass corner"><h2>${t('workflows')} <span class="right tag info xs">${wfs.length}</span></h2><ul class="list">${wfs.map((w) => `<li class="col" style="align-items:stretch"><div class="row"><span class="dot ${w.enabled ? 'ok' : ''}"></span><b class="grow" dir="auto">${esc(w.name)}</b><span class="tag mono xs">${esc(trig(w.trigger))}</span></div>${w.steps.map(block).join('')}${w.guardrails?.length ? `<div class="xs warn-t">⛨ ${t('guardrails')}: ${esc(w.guardrails.join('; '))}</div>` : ''}
      <div class="row"><button class="btn sm" data-run="${w.id}">▶ ${t('run')}</button><button class="btn sm" data-tog="${w.id}" data-en="${w.enabled}">${w.enabled ? t('disable') : t('enable')}</button><button class="btn danger sm" data-del="${w.id}">${t('delete')}</button></div></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="c12 panel glass corner"><h2>${t('history')}</h2><table><tr><th>${t('workflows')}</th><th>Status</th><th>Start</th><th>Log</th><th></th></tr>${runs.map((r) => `<tr><td dir="auto">${esc(r.name)}</td><td>${esc(r.status)}${r.error ? `<div class="err xs">${esc(r.error)}</div>` : ''}</td><td class="xs mono">${esc(r.startedAt?.slice(5, 19).replace('T', ' '))}</td><td class="xs">${r.log.map((l) => esc(l.tool ?? (l.condition ? `if→${l.result}` : l.notify ? `notify:${l.notify}` : l.awaitingApproval ? '⏸ approval' : l.agentTask ? `agent:${l.state}` : ''))).join(' · ')}</td><td>${r.status === 'awaiting_approval' ? `<button class="btn ok sm" data-wfa="${r.id}">${t('approve')}</button> <button class="btn danger sm" data-wfc="${r.id}">${t('reject')}</button>` : ''}</td></tr>`).join('')}</table></div></div>`;
  const preview = async (save) => {
    try {
      const wf = await api('/api/automations/from-text', { method: 'POST', body: { text: $('#nlText').value, preview: !save } });
      $('#nlOut').innerHTML = `<div class="tag mono xs">${esc(trig(wf.trigger))}</div>${wf.steps.map(block).join('')}${wf.guardrails?.length ? `<div class="xs warn-t">⛨ ${esc(wf.guardrails.join('; '))}</div>` : ''}${wf.skipped?.length ? `<div class="xs muted">skipped: ${esc(wf.skipped.map((x) => x.line).join('; '))}</div>` : ''}`;
      if (save) { toast(t('created')); automations(v); }
    } catch (e) { toast(e.message); }
  };
  $('#nlPrev').onclick = () => preview(false);
  $('#nlCreate').onclick = () => preview(true);
  $('#simHome').onclick = async () => { const r = await api('/api/presence', { method: 'POST', body: { state: 'arrived_home' } }); toast(`${r.length} workflow run(s)`); automations(v); };
  $$('[data-run]', v).forEach((b) => { b.onclick = async () => { const r = await api(`/api/automations/${b.dataset.run}/run`, { method: 'POST', body: {} }); toast(r.status); automations(v); }; });
  $$('[data-tog]', v).forEach((b) => { b.onclick = async () => { await api(`/api/automations/${b.dataset.tog}`, { method: 'PATCH', body: { enabled: b.dataset.en !== 'true' } }); automations(v); }; });
  $$('[data-del]', v).forEach((b) => { b.onclick = async () => { if (confirm(t('delete'))) { await api(`/api/automations/${b.dataset.del}`, { method: 'DELETE' }); automations(v); } }; });
  $$('[data-wfa]', v).forEach((b) => { b.onclick = async () => { await api(`/api/automations/runs/${b.dataset.wfa}/approve`, { method: 'POST', body: { decision: 'approve' } }); automations(v); }; });
  $$('[data-wfc]', v).forEach((b) => { b.onclick = async () => { await api(`/api/automations/runs/${b.dataset.wfc}/cancel`, { method: 'POST' }); automations(v); }; });
}

// ===================================================== Knowledge Center
async function knowledge(v) {
  const [list, meta, docs] = await Promise.all([api('/api/memory'), api('/api/memory/meta'), api('/api/documents')]);
  const pv = (p) => ({ verified: 'ok', user_statement: 'info', inferred: 'warn', ai_suggestion: 'warn', outdated: 'bad' }[p]);
  v.innerHTML = `<div class="grid">
    <div class="c4 col"><div class="panel glass corner"><h2>${t('add')}</h2><form id="memForm" class="col">
      <input name="content" dir="auto" required placeholder="…">
      <select name="type">${meta.types.map((x) => `<option>${x}</option>`).join('')}</select>
      <select name="provenance">${meta.provenance.filter((p) => p !== 'outdated').map((x) => `<option ${x === 'user_statement' ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <select name="workspace">${['personal', 'family', 'projects', 'financial', 'health', 'research', 'documents'].map((w) => `<option>${w}</option>`).join('')}</select>
      <input name="expiresAt" type="date"><button class="btn primary">${t('save')}</button></form>
      <div class="row" style="margin-top:10px"><button id="memExport" class="btn sm">${t('export')}</button></div></div>
      <div class="panel glass corner"><h2>${t('documents')}</h2><input id="docFile" type="file" accept=".txt,.md,.csv,.json,.html"><ul class="list" style="margin-top:8px">${docs.map((d) => `<li class="small"><span class="grow" dir="auto">${esc(d.name)} <span class="xs muted">· ${d.chunks}</span>${d.flagged ? ' <span class="tag warn xs">⚠</span>' : ''}</span><button class="btn danger sm" data-ddel="${d.id}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul></div></div>
    <div class="c8 panel glass corner"><h2>${t('memories')} <span class="right"><input id="memQ" dir="auto" placeholder="${t('search')}…"></span></h2><ul class="list" id="memList"></ul></div></div>`;
  const draw = (items) => {
    $('#memList').innerHTML = items.map((m) => `<li><span class="grow" dir="auto">${esc(m.content)}<div class="xs muted">${m.type} · ${m.domain ?? m.workspace} · conf ${m.confidence ?? '–'}${m.score != null ? ` · score ${m.score} (sem ${m.semantic} / kw ${m.keyword})` : ''}${m.expiresAt ? ` · ⏳ ${m.expiresAt.slice(0, 10)}` : ''}${m.confirmations > 1 ? ` · ×${m.confirmations}` : ''}</div></span>
      <select data-prov="${m.id}" class="xs">${meta.provenance.map((p) => `<option ${p === m.provenance ? 'selected' : ''}>${p}</option>`).join('')}</select><span class="tag ${pv(m.provenance)} xs">${m.provenance}</span>
      <button class="btn sm" data-edit="${m.id}">${t('edit')}</button><button class="btn danger sm" data-mdel="${m.id}">✕</button></li>`).join('') || '<li class="empty">—</li>';
    $$('[data-prov]', v).forEach((s) => { s.onchange = async () => { await api(`/api/memory/${s.dataset.prov}`, { method: 'PATCH', body: { provenance: s.value } }); toast(t('updated')); }; });
    $$('[data-edit]', v).forEach((b) => { b.onclick = async () => { const m = items.find((x) => x.id === b.dataset.edit); const c = prompt(t('edit'), m.content); if (c) { await api(`/api/memory/${m.id}`, { method: 'PATCH', body: { content: c } }); knowledge(v); } }; });
    $$('[data-mdel]', v).forEach((b) => { b.onclick = async () => { if (confirm(t('delete'))) { await api(`/api/memory/${b.dataset.mdel}`, { method: 'DELETE' }); knowledge(v); } }; });
  };
  draw(list.filter((m) => !m.tags?.some((x) => String(x).startsWith('doc:'))));
  let tm; $('#memQ').oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => draw(e.target.value ? await api(`/api/memory/search?q=${encodeURIComponent(e.target.value)}`) : list), 250); };
  $('#memForm').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (f.expiresAt) f.expiresAt = new Date(f.expiresAt).toISOString(); else delete f.expiresAt;
    try { const r = await api('/api/memory', { method: 'POST', body: f }); toast(r.duplicate ? '≈ duplicate' : t('saved')); knowledge(v); } catch (err) { toast(err.message); } };
  $('#memExport').onclick = async () => { const d = await api('/api/memory/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'jarvis-memory.json'; a.click(); };
  $('#docFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 1.5e6) return toast('1.5 MB max'); try { await api('/api/documents', { method: 'POST', body: { name: f.name, text: await f.text() } }); toast(t('saved')); knowledge(v); } catch (err) { toast(err.message); } };
  $$('[data-ddel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/documents/${b.dataset.ddel}`, { method: 'DELETE' }); knowledge(v); }; });
}

// ===================================================== Planner
async function planner(v) {
  const [tasks, events, shop, rem] = await Promise.all([api('/api/tasks'), api(`/api/events?from=${new Date(Date.now() - 864e5).toISOString()}`), api('/api/shopping'), api('/api/reminders')]);
  v.innerHTML = `<div class="grid">
    <div class="c6 panel glass corner"><h2>${t('tasks')}</h2><form id="tf" class="row"><input name="title" class="grow" dir="auto" required placeholder="${t('new_task')}"><select name="priority"><option>normal</option><option>high</option><option>low</option></select><input name="due" type="date"><button class="btn primary sm">${t('add')}</button></form>
      <ul class="list" style="margin-top:8px">${tasks.map((x) => `<li><input type="checkbox" ${x.done ? 'checked disabled' : ''} data-done="${x.id}" aria-label="done"><span class="grow" dir="auto" style="${x.done ? 'opacity:.5;text-decoration:line-through' : ''}">${esc(x.title)}<div class="xs muted">${x.priority}${x.due ? ` · ${x.due.slice(0, 10)}` : ''}${x.project ? ` · ${esc(x.project)}` : ''}</div></span><button class="btn danger sm" data-tdel="${x.id}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="c6 col"><div class="panel glass corner"><h2>${t('events')}</h2><form id="ef" class="row"><input name="title" class="grow" dir="auto" required placeholder="${t('new_event')}"><input name="start" type="datetime-local" required><button class="btn primary sm">${t('add')}</button></form>
      <ul class="list" style="margin-top:8px">${events.map((e) => `<li class="small"><span class="tag info mono xs">${esc(fmtTime(e.start))}</span><span class="grow" dir="auto">${esc(e.title)}</span></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
      <div class="panel glass corner"><h2>${t('shopping')}</h2><form id="sf" class="row"><input name="item" class="grow" dir="auto" required><button class="btn primary sm">${t('add')}</button></form>
      <ul class="list" style="margin-top:8px">${shop.map((x) => `<li class="small"><input type="checkbox" ${x.done ? 'checked' : ''} data-stog="${x.id}"><span class="grow" dir="auto" style="${x.done ? 'opacity:.5;text-decoration:line-through' : ''}">${esc(x.item)}</span><button class="btn danger sm" data-sdel="${x.id}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
      <div class="panel glass corner"><h2>${t('reminders')}</h2><ul class="list">${rem.map((r) => `<li class="small"><span class="tag mono xs">${esc(fmtTime(r.at))}</span><span class="grow" dir="auto">${esc(r.text)}</span></li>`).join('') || '<li class="empty">—</li>'}</ul></div></div></div>`;
  $('#tf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.due = f.due ? new Date(f.due).toISOString() : null; await api('/api/tasks', { method: 'POST', body: f }); planner(v); };
  $('#ef').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.start = new Date(f.start).toISOString(); const r = await api('/api/events', { method: 'POST', body: f }); if (r.conflicts.length) toast(`⚠ ${r.conflicts.join(', ')}`, 'high'); planner(v); };
  $('#sf').onsubmit = async (e) => { e.preventDefault(); await api('/api/shopping', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); planner(v); };
  $$('[data-done]', v).forEach((c) => { c.onchange = async () => { try { await api(`/api/tasks/${c.dataset.done}/complete`, { method: 'POST' }); } catch (err) { toast(err.message); } planner(v); }; });
  $$('[data-tdel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/tasks/${b.dataset.tdel}`, { method: 'DELETE' }); planner(v); }; });
  $$('[data-stog]', v).forEach((c) => { c.onchange = async () => { await api(`/api/shopping/${c.dataset.stog}/toggle`, { method: 'POST' }); planner(v); }; });
  $$('[data-sdel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/shopping/${b.dataset.sdel}`, { method: 'DELETE' }); planner(v); }; });
}

// ===================================================== Family Wealth OS
async function wealth(v) {
  const [ov, an, budgets, accounts, series] = await Promise.all([api('/api/wealth/overview'), api('/api/wealth/analysis', { method: 'POST', body: {} }), api('/api/wealth/budgets'), api('/api/wealth/accounts'), api('/api/wealth/series?months=6')]);
  const f = an.facts.currentMonth; const nw = ov.facts.netWorth; const ch = an.calculations.expenseChange;
  const cats = Object.entries(f.byCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const compact = (m) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(m / 100);
  v.innerHTML = `<div class="grid fin">
    <div class="c3 glass kpi hero"><div class="lbl muted">${t('net_worth')}</div><div class="stat big num">${money(nw.netWorth)}</div><div class="delta muted">${t('assets')} ${money(nw.assets)} · ${t('liabilities')} ${money(nw.liabilities)}</div></div>
    <div class="c3 glass kpi corner"><div class="lbl">${t('spent_month')} · ${an.month}</div><div class="stat num">${money(f.expenses)}</div><div class="delta ${ch > 0 ? 'err' : 'ok-t'}">${ch > 0 ? '▲' : '▼'} ${money(Math.abs(ch))} ${t('vs_prev')}</div></div>
    <div class="c3 glass kpi corner"><div class="lbl">${t('income')}</div><div class="stat num">${money(f.income)}</div><div class="delta muted">${t('net')} ${money(f.net)}</div></div>
    <div class="c3 glass kpi corner"><div class="lbl">${t('savings_potential')}</div><div class="stat num ok-t">${money(an.calculations.potentialMonthlySaving)}</div><div class="delta muted">${t('per_month_calc')}</div></div>
    <div class="c8 panel glass corner"><h2>${t('cashflow')} <span class="right legend"><span><i style="background:var(--green)"></i>${t('income')}</span><span><i style="background:var(--red)"></i>${t('expenses')}</span><span><i style="background:var(--cyan)"></i>${t('net')}</span></span></h2>
      ${lineChart(series, { keys: ['income', 'expenses', 'net'], colors: ['#22e08a', '#ff5d6c', '#2ee6ff'], fmt: compact, labels: (d) => d.month.slice(5) })}<div class="xs muted">${t('months_6')} · ${an.month} = month to date</div></div>
    <div class="c4 panel glass corner" style="text-align:center"><h2>${t('by_category')}</h2>${donut(cats, { colors: CAT_COLORS, center: money(f.expenses), sub: an.month })}
      <div class="legend" style="justify-content:center;margin-top:8px">${cats.map((c, i) => `<span><i style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></i>${esc(c.label)}</span>`).join('')}</div></div>
    <div class="c6 panel glass corner"><h2>${t('budgets')}</h2>${budgets.map((b) => `<div class="row small" style="justify-content:space-between;margin-top:10px"><span>${esc(b.category)}</span><span class="num muted" dir="ltr">${money(b.spent)} / ${money(b.limit)}</span></div><div class="bar ${b.over ? 'over' : 'green'}"><i style="width:${Math.min(100, b.usedPct ?? 0)}%"></i></div>`).join('')}</div>
    <div class="c6 panel glass corner"><h2>${t('recommendations')}</h2><ul class="list">${an.recommendations.map((r) => `<li class="small"><span class="tag xs">${r.kind}</span><span class="grow" dir="auto">${esc(he() ? r.textHe : r.text)}</span></li>`).join('') || '<li class="empty">—</li>'}</ul><p class="xs muted">${esc(an.disclaimer)}</p></div>
    <div class="c4 panel glass corner"><h2>${t('goals')}</h2>${ov.goals.map((g) => `<div class="row small" style="justify-content:space-between;margin-top:10px"><span dir="auto">${esc(g.name)}</span><span>${g.pct}%${g.onTrack === false ? ' <span class="tag bad xs">!</span>' : g.onTrack ? ' <span class="tag ok xs">✓</span>' : ''}</span></div><div class="bar green"><i style="width:${Math.min(100, g.pct)}%"></i></div><div class="xs muted" dir="ltr">${money(g.saved)} / ${money(g.target)} · ${g.monthsToGoal ?? '–'} mo</div>`).join('')}</div>
    <div class="c4 panel glass corner"><h2>${t('bills_soon')}</h2><ul class="list">${ov.upcomingBills.map((b) => `<li class="small"><span class="grow" dir="auto">${esc(b.name)}<div class="xs muted">${b.dueDate}</div></span>${b.overdue ? '<span class="tag bad xs">overdue</span>' : ''}<b class="num">${money(b.amount)}</b></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="c4 panel glass corner"><h2>${t('forecast')} · ${t('data_sources')}</h2><div class="kv small"><span class="muted">avg ${t('income')}</span><span class="num">${money(an.forecasts.avgIncome)}</span><span class="muted">avg ${t('expenses')}</span><span class="num">${money(an.forecasts.avgExpenses)}</span><span class="muted">+6 mo</span><span class="num">${money(an.forecasts.projection.at(-1).cumulativeNet)}</span></div>
      <div class="xs muted" style="margin-top:8px">${esc(an.forecasts.assumption)}</div><div class="row" style="margin-top:8px">${Object.entries(an.dataQuality.transactionsBySource).map(([k, n]) => `<span class="tag ${k === 'demo' ? 'warn' : 'ok'} xs">${esc(k)}: ${n}</span>`).join('')}</div></div>
    <div class="c6 panel glass corner"><h2>${t('scenario')}</h2><form id="simF" class="row">${cats.slice(0, 5).map((c) => `<label class="small">${esc(c.label)} <input name="${esc(c.label)}" type="number" min="0" max="100" value="0" style="width:64px">%</label>`).join('')}<button class="btn ok sm">${t('simulate')}</button></form><p id="simOut" class="small"></p></div>
    <div class="c6 panel glass corner"><h2>${t('accounts')}</h2><table>${accounts.map((a) => `<tr><td dir="auto">${esc(a.name)}<div class="xs muted">${esc(a.institution)}</div></td><td class="n">${money(a.balance)}</td></tr>`).join('')}</table></div>
    <div class="c12 panel glass corner"><h2>${t('by_category')} · ${t('vs_prev')}</h2><table><tr><th></th><th class="n">${an.month}</th><th class="n">−1</th><th class="n">Δ</th><th style="width:30%"></th></tr>${an.calculations.categoryChanges.map((c) => `<tr><td>${esc(c.category)}</td><td class="n">${money(c.current)}</td><td class="n">${money(c.previous)}</td><td class="n" style="color:${c.change > 0 ? 'var(--red)' : 'var(--green)'}">${money(c.change)}</td><td><div class="bar ${c.change > 0 ? 'over' : 'green'}"><i style="width:${Math.min(100, (Math.max(c.current, c.previous) / Math.max(1, ...an.calculations.categoryChanges.map((x) => Math.max(x.current, x.previous)))) * 100)}%"></i></div></td></tr>`).join('')}</table></div></div>`;
  $('#simF').onsubmit = async (e) => { e.preventDefault(); const cuts = Object.fromEntries([...new FormData(e.target)].map(([k, x]) => [k, Number(x)]).filter(([, x]) => x > 0));
    const r = await api('/api/wealth/recommendations', { method: 'POST', body: { cuts } }); $('#simOut').textContent = `≈ ${money(r.simulation.monthlySaving)} / month · ${money(r.simulation.yearlySaving)} / year (calculation, not a guarantee)`; };
}

// ===================================================== Smart Home
async function home(v) {
  const devices = await api('/api/home/devices');
  const cmd = async (text) => { const r = await api('/api/home/command', { method: 'POST', body: { text } }); if (r.state === 'AWAITING_APPROVAL') { toast(r.response, 'high'); location.hash = 'conversation'; } else toast(r.response); home(v); };
  v.innerHTML = `<div class="grid"><div class="c8 panel glass corner"><h2>${t('smart_home')} <span class="right tag info xs">${devices.length}</span></h2><ul class="list">${devices.map((d) => `<li><span class="dot ${!d.online ? 'bad' : d.state === 'on' || d.state === 'cool' ? 'info' : d.state === 'locked' ? 'ok' : ''}"></span><span class="grow">${esc(d.name)}<div class="xs muted">${esc(d.area ?? '')} · ${esc(d.domain)}${d.attributes?.temperature ? ` · ${d.attributes.temperature}°` : ''}</div></span>
    ${!d.online ? `<span class="tag bad xs">${t('offline')}</span>` : d.domain === 'light' ? `<button class="switch ${d.state === 'on' ? 'on' : ''}" data-dev="${esc(d.name)}" data-on="${d.state === 'on'}" aria-label="${esc(d.name)}"></button>` : d.domain === 'lock' ? `<span class="tag ${d.state === 'locked' ? 'ok' : 'warn'} xs">🔒 ${esc(d.state)}</span>` : `<span class="tag xs">${esc(d.state)}</span>`}</li>`).join('')}</ul></div>
    <div class="c4 panel glass corner"><h2>Scenes</h2><div class="col"><button class="btn" data-cmd="activate evening mode">🌆 Evening</button><button class="btn" data-cmd="activate night mode">🌙 Night</button><button class="btn" data-cmd="set the temperature to 23">❄ 23°</button><button class="btn" data-cmd="lock the front door">🔒 Lock</button><button class="btn danger" data-cmd="unlock the front door">🔓 Unlock (approval)</button></div>
    <p class="xs muted">Unlocking and disarming always require approval.</p></div></div>`;
  $$('[data-dev]', v).forEach((b) => { b.onclick = () => cmd(`turn ${b.dataset.on === 'true' ? 'off' : 'on'} the ${b.dataset.dev}`); });
  $$('[data-cmd]', v).forEach((b) => { b.onclick = () => cmd(b.dataset.cmd); });
}

// ===================================================== Device Center
async function devices(v) {
  const [list, caps, status] = await Promise.all([api('/api/devices'), api('/api/devices/capabilities'), api('/api/status')]);
  v.innerHTML = `<div class="grid"><div class="c4 col"><div class="panel glass corner"><h2>${t('register_device')}</h2><form id="regF" class="col"><input name="name" required placeholder="${t('name')}"><select name="kind">${Object.keys(caps).map((k) => `<option>${k}</option>`).join('')}</select><button class="btn primary">${t('add')}</button></form><div id="regOut" class="small" style="margin-top:8px;word-break:break-all"></div></div>
    <div class="panel glass corner"><h2>Desktop bridge <span class="right dot ${status.bridge.connected ? 'ok' : 'bad'}"></span></h2><pre class="out xs mono muted" dir="ltr">JARVIS_TOKEN=… JARVIS_ALLOWED_DIRS=~/Documents node desktop/bridge.js</pre>${status.bridge.info ? `<div class="xs">${esc(status.bridge.info.platform)} · ${esc((status.bridge.info.capabilities ?? []).join(', '))}</div>` : ''}</div></div>
    <div class="c8 col"><div class="panel glass corner"><h2>${t('devices')}</h2><ul class="list">${list.map((d) => `<li><span class="dot ${d.revoked ? 'bad' : 'ok'}"></span><span class="grow">${esc(d.name)} <span class="tag xs">${esc(d.kind)}</span><div class="xs muted">${d.lastSeenAt ? esc(d.lastSeenAt.slice(0, 19)) : '—'} · scopes: ${esc(d.scopes.join(','))}</div></span>${d.revoked ? '<span class="tag bad xs">revoked</span>' : `<button class="btn danger sm" data-rev="${d.id}">${t('revoke')}</button>`}</li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="panel glass corner"><h2>${t('capabilities')}</h2><table><tr><th>${t('kind')}</th><th>Status</th><th>${t('capabilities')}</th></tr>${Object.entries(caps).map(([k, c]) => `<tr><td class="mono">${k}</td><td><span class="tag ${c.status === 'built' ? 'ok' : 'warn'} xs">${t(`status_${c.status}`)}</span></td><td class="xs">${esc(c.caps.join(', '))}${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</td></tr>`).join('')}</table></div></div></div>`;
  $('#regF').onsubmit = async (e) => { e.preventDefault(); const r = await api('/api/devices', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); $('#regOut').innerHTML = `${t('token_once')}<br><code class="mono" dir="ltr">${esc(r.token)}</code>`; };
  $$('[data-rev]', v).forEach((b) => { b.onclick = async () => { if (confirm(t('revoke'))) { await api(`/api/devices/${b.dataset.rev}`, { method: 'DELETE' }); devices(v); } }; });
}

// ===================================================== Developer Console
async function consoleView(v) {
  const c = await api('/api/console');
  const s = c.system;
  v.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><div class="gauges" style="grid-template-columns:repeat(6,1fr)">${gauge(s.cpuLoadPct, { label: t('cpu') })}${gauge(s.memoryPct, { label: t('memory'), color: 'var(--violet)' })}${gauge(s.processMemoryMb, { label: 'RSS MB', suffix: '', max: 1024, color: 'var(--ice)' })}${gauge(s.aiLatencyMs == null ? null : s.aiLatencyMs / 100, { label: `${t('latency')} ${s.aiLatencyMs ?? '—'}ms`, suffix: '', color: 'var(--amber)' })}${gauge(s.taskSuccessPct, { label: t('success'), color: 'var(--green)' })}${gauge(s.uptimeSec / 60, { label: 'uptime min', suffix: '', max: 1440 })}</div></div>
    <div class="c6 panel glass corner"><h2>${t('models')}</h2><table><tr><th>Model</th><th class="n">Calls</th><th class="n">Err</th><th class="n">ms</th><th class="n">${t('cost')}</th></tr>${c.models.map((m) => `<tr><td class="mono xs">${esc(m.model)}</td><td class="n">${m.calls}</td><td class="n">${m.errors}</td><td class="n">${m.avgLatencyMs}</td><td class="n">$${m.costUsd}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">—</td></tr>'}</table>
      <div class="row" style="margin-top:8px">${c.providers.map((p) => `<span class="tag ${p.capabilities.local ? '' : 'ok'} xs">${esc(p.provider)}</span>`).join('')}<span class="tag info xs">autonomy L${c.autonomy}</span><span class="tag ${c.bridge.connected ? 'ok' : ''} xs">bridge</span></div></div>
    <div class="c6 panel glass corner"><h2>${t('api_usage')}</h2><div style="max-height:300px;overflow:auto"><table><tr><th>Path</th><th class="n">#</th><th class="n">Err</th><th class="n">ms</th></tr>${c.api.map((r) => `<tr><td class="mono xs" dir="ltr">${esc(r.path)}</td><td class="n">${r.count}</td><td class="n">${r.errors}</td><td class="n">${r.avgMs}</td></tr>`).join('')}</table></div></div>
    <div class="c6 panel glass corner"><h2>${t('failed_tasks')}</h2><ul class="list">${c.failedTasks.map((f) => `<li class="small"><span class="grow"><span class="mono xs">${esc(f.tools.join(','))}</span><div class="err xs" dir="auto">${esc(f.error)}</div></span><span class="xs muted">${esc(String(f.at).slice(5, 16))}</span></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="c6 panel glass corner"><h2>${t('security_events')}</h2><ul class="list">${c.securityEvents.map((e) => `<li class="small"><span class="dot ${e.outcome === 'ok' ? 'info' : 'bad'}"></span><span class="grow mono xs">${esc(e.action)} · ${esc(e.actor)}</span><span class="xs muted">${esc(e.at.slice(5, 19))}</span></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="c12 panel glass corner"><h2>Automations / ${t('devices')}</h2><div class="row">${c.automationRuns.map((r) => `<span class="tag xs ${r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'}">${esc(r.name)}: ${r.status}</span>`).join('')}${c.devices.map((d) => `<span class="tag xs">${esc(d.kind)} ${esc(d.name)}${d.revoked ? ' ✕' : ''}</span>`).join('')}</div></div></div>`;
  every(15000, () => { if (location.hash.slice(1) === 'console') consoleView(v); });
}

// ===================================================== Privacy Center
async function privacy(v) {
  const [p, policy, audit, auto, transcripts] = await Promise.all([api('/api/privacy'), api('/api/security/policy'), api('/api/security/audit'), api('/api/autonomy'), api('/api/voice/transcripts')]);
  const s = p.settings;
  const sw = (k, label) => `<div class="row" style="justify-content:space-between;padding:6px 0"><span>${label}</span><button class="switch ${s[k] ? 'on' : ''}" data-pk="${k}" aria-pressed="${!!s[k]}" aria-label="${esc(label)}"></button></div>`;
  v.innerHTML = `<div class="grid">
    <div class="c4 col"><div class="panel glass corner"><h2>${t('autonomy')}</h2>${[1, 2, 3, 4].map((l) => `<label class="row" style="padding:5px 0"><input type="radio" name="auto" value="${l}" ${auto.level === l ? 'checked' : ''}> <b>L${l}</b> ${t(`autonomy_${l}`)}</label>`).join('')}<p class="xs muted">Money, purchases, unlocking, security changes and sensitive sharing always need explicit approval at every level.</p></div>
      <div class="panel glass corner"><h2>${t('privacy_settings')}</h2>${sw('memoryEnabled', t('memory_enabled'))}${sw('healthEnabled', t('health_enabled'))}${sw('storeTranscripts', t('store_transcripts'))}${sw('proactiveEnabled', t('proactive_enabled'))}${sw('financialAlertsOnWatch', t('watch_fin'))}
      <div class="row" style="justify-content:space-between"><label for="ret">${t('retention')}</label><input id="ret" type="number" min="0" max="3650" value="${s.voiceRetentionDays}" style="width:90px"></div></div></div>
    <div class="c4 col"><div class="panel glass corner"><h2>${t('inventory')}</h2><div class="kv small">${Object.entries(p.inventory).map(([k, n]) => `<span class="muted">${esc(k)}</span><span class="num">${n}</span>`).join('')}</div>
      <div class="col" style="margin-top:12px"><button id="expAll" class="btn sm">⬇ ${t('export_all')}</button><button id="delVoice" class="btn danger sm">${t('delete_voice')} (${transcripts.length})</button>
      <div class="row">${['financial', 'health', 'family', 'work'].map((d) => `<button class="btn danger sm" data-dd="${d}">✕ ${d}</button>`).join('')}</div></div></div>
      <div class="panel glass corner"><h2>${t('permissions')}</h2><table>${Object.entries(policy).map(([k, m]) => `<tr><td>${k}</td><td><select data-risk="${k}">${['allow', 'approve', 'deny'].filter((x) => !(['financial', 'sensitive'].includes(k) && x === 'allow')).map((x) => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select></td></tr>`).join('')}</table></div></div>
    <div class="c4 col"><div class="panel glass corner"><h2>${t('agent_access')}</h2><ul class="list">${p.agents.map((a) => `<li class="small"><span class="grow">${esc(a.name)}</span>${a.dataScopes.map((d) => `<span class="tag ${['financial', 'health'].includes(d) ? 'warn' : ''} xs">${d}</span>`).join('')}</li>`).join('')}</ul></div></div>
    <div class="c12 panel glass corner"><h2>${t('audit')}</h2><div style="max-height:46vh;overflow:auto"><table><tr><th>Time</th><th>Actor</th><th>Action</th><th>Outcome</th></tr>${audit.map((a) => `<tr><td class="xs mono">${esc(a.at.slice(5, 19).replace('T', ' '))}</td><td class="xs">${esc(a.actor)}</td><td class="xs mono">${esc(a.action)}</td><td><span class="tag ${a.outcome === 'ok' ? '' : 'bad'} xs">${esc(a.outcome)}</span></td></tr>`).join('')}</table></div></div></div>`;
  $$('[data-pk]', v).forEach((b) => { b.onclick = async () => { await api('/api/privacy', { method: 'PUT', body: { [b.dataset.pk]: !s[b.dataset.pk] } }); toast(t('updated')); privacy(v); }; });
  $('#ret').onchange = async (e) => { try { await api('/api/privacy', { method: 'PUT', body: { voiceRetentionDays: Number(e.target.value) } }); toast(t('updated')); } catch (err) { toast(err.message); } };
  $$('input[name=auto]', v).forEach((r) => { r.onchange = async () => { await api('/api/autonomy', { method: 'PUT', body: { level: Number(r.value) } }); toast(`L${r.value}`); }; });
  $$('[data-risk]', v).forEach((sel) => { sel.onchange = async () => { try { await api('/api/security/policy', { method: 'PUT', body: { risk: sel.dataset.risk, mode: sel.value } }); toast(t('updated')); } catch (err) { toast(err.message); privacy(v); } }; });
  $('#delVoice').onclick = async () => { if (confirm(t('delete_voice'))) { await api('/api/privacy/voice', { method: 'DELETE' }); privacy(v); } };
  $$('[data-dd]', v).forEach((b) => { b.onclick = async () => { if (confirm(`${t('delete_domain')}: ${b.dataset.dd}?`)) { const r = await api(`/api/privacy/domain/${b.dataset.dd}`, { method: 'DELETE' }); toast(`✕ ${r.deleted}`); privacy(v); } }; });
  $('#expAll').onclick = async () => { const d = await api('/api/privacy/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'jarvis-export.json'; a.click(); };
}

// ===================================================== Settings
async function settings(v) {
  const [p, w, st] = await Promise.all([api('/api/settings/personality'), api('/api/context/weather'), api('/api/status')]);
  v.innerHTML = `<div class="grid"><div class="c6 panel glass corner"><h2>${t('personality')}</h2><form id="pf" class="kv">
    <label>${t('name')}</label><input name="name" value="${esc(p.name)}">
    <label>${t('style')}</label><select name="style">${['professional', 'friendly', 'witty', 'concise'].map((x) => `<option ${x === p.style ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label>${t('verbosity')}</label><select name="verbosity">${['auto', 'short', 'detailed'].map((x) => `<option ${x === p.verbosity ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label>${t('language')}</label><select name="language">${['auto', 'he', 'en'].map((x) => `<option ${x === p.language ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label>${t('address_as')}</label><input name="address" value="${esc(p.address)}">
    <label>${t('humor')}</label><input name="humor" type="checkbox" ${p.humor ? 'checked' : ''} style="justify-self:start">
    <span></span><button class="btn primary">${t('save')}</button></form></div>
    <div class="c6 col"><div class="panel glass corner"><h2>${t('location')}</h2><form id="lf" class="row"><input name="name" value="${esc(w.location ?? '')}" placeholder="City"><input name="lat" type="number" step="0.01" placeholder="lat" style="width:90px"><input name="lon" type="number" step="0.01" placeholder="lon" style="width:90px"><button class="btn sm">${t('save')}</button></form></div>
    <div class="panel glass corner"><h2>System</h2><div class="kv small"><span class="muted">AI</span><span>${esc(st.providers.map((x) => x.provider).join(', '))}</span><span class="muted">Home</span><span>${esc(st.home)}</span><span class="muted">Voice</span><span>${esc(st.route.voice.model)}</span><span class="muted">Deep</span><span>${esc(st.route.deep.model)}</span></div>
      <div class="row" style="margin-top:12px"><button id="logout" class="btn danger sm">${t('logout')}</button><button id="clr" class="btn sm">${t('clear_chat')}</button></div></div></div></div>`;
  $('#pf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.humor = !!e.target.humor.checked; await api('/api/settings/personality', { method: 'PUT', body: f }); toast(t('saved')); };
  $('#lf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('/api/context/location', { method: 'PUT', body: { name: f.name, lat: Number(f.lat), lon: Number(f.lon) } }); toast(t('saved')); } catch (err) { toast(err.message); } };
  $('#logout').onclick = () => { auth.set(''); location.reload(); };
  $('#clr').onclick = () => { clearChat(); toast(t('updated')); };
}

export const VIEWS = [
  ['sec_core'], ['command', '◉', command], ['conversation', '◍', conversation], ['map', '⌬', map], ['agents', '⎔', agents], ['automations', '⟳', automations], ['knowledge', '⛁', knowledge],
  ['sec_life'], ['planner', '✓', planner], ['wealth', '₪', wealth], ['home', '⌂', home],
  ['sec_system'], ['devices', '⌚', devices], ['console', '⌨', consoleView], ['privacy', '⛨', privacy], ['settings', '⚙', settings],
];
export { toggleListening };
