// Screens. Each view renders into #view and may register a cleanup for timers.
import { api, esc, money, toast, $, $$, local, auth, confirmDialog, promptDialog } from './api.js';
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
    <div class="panel glass" style="width:100%;padding:12px"><div class="row"><b class="small grow">${t('mic_state')}</b><span id="micState" class="tag xs">…</span><button id="micReq" class="btn sm">🎙 ${t('mic_request')}</button></div>
      <p id="micNote" class="xs muted" style="margin:6px 0 0"></p>
      <div class="row" style="margin-top:8px"><b class="small grow">${t('notif_perm')}</b><span id="notifState" class="tag xs">…</span><button id="notifReq" class="btn sm">🔔 ${t('notif_request')}</button></div>
      <label class="row small" style="margin-top:8px"><input id="speakAll" type="checkbox"> ${t('speech_out')}</label></div>
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
  // Microphone permission: show the real state and ask through the browser's own prompt.
  const showMic = async () => {
    let st = 'prompt';
    try { st = (await navigator.permissions.query({ name: 'microphone' })).state; } catch { /* not supported */ }
    const el = $('#micState'); if (!el) return;
    el.textContent = t(st === 'granted' ? 'mic_granted' : st === 'denied' ? 'mic_denied' : 'mic_prompt');
    el.className = `tag xs ${st === 'granted' ? 'ok' : st === 'denied' ? 'bad' : 'warn'}`;
  };
  showMic();
  $('#micReq').onclick = async () => {
    try { const s2 = await navigator.mediaDevices.getUserMedia({ audio: true }); s2.getTracks().forEach((tr) => tr.stop()); $('#micNote').textContent = ''; toast(t('mic_granted')); }
    catch { $('#micNote').textContent = t('mic_blocked_frame'); }
    showMic();
  };
  const showNotif = () => { const n = 'Notification' in window ? Notification.permission : 'denied'; $('#notifState').textContent = t(n === 'granted' ? 'mic_granted' : n === 'denied' ? 'mic_denied' : 'mic_prompt'); $('#notifState').className = `tag xs ${n === 'granted' ? 'ok' : n === 'denied' ? 'bad' : 'warn'}`; };
  showNotif();
  $('#notifReq').onclick = async () => { try { await Notification.requestPermission(); } catch { /* blocked in this frame */ } showNotif(); };
  $('#speakAll').checked = local.get('speakAll', false);
  $('#speakAll').onchange = (e) => local.set('speakAll', e.target.checked);
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
  $$('[data-del]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('delete'), { danger: true, okText: t('delete') })) { await api(`/api/automations/${b.dataset.del}`, { method: 'DELETE' }); automations(v); } }; });
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
    $$('[data-edit]', v).forEach((b) => { b.onclick = async () => { const m = items.find((x) => x.id === b.dataset.edit); const c = await promptDialog(t('edit'), m.content); if (c) { await api(`/api/memory/${m.id}`, { method: 'PATCH', body: { content: c } }); knowledge(v); } }; });
    $$('[data-mdel]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('delete'), { danger: true, okText: t('delete') })) { await api(`/api/memory/${b.dataset.mdel}`, { method: 'DELETE' }); knowledge(v); } }; });
  };
  draw(list.filter((m) => !m.tags?.some((x) => String(x).startsWith('doc:'))));
  let tm; $('#memQ').oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => draw(e.target.value ? await api(`/api/memory/search?q=${encodeURIComponent(e.target.value)}`) : list), 250); };
  $('#memForm').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (f.expiresAt) f.expiresAt = new Date(f.expiresAt).toISOString(); else delete f.expiresAt;
    try { const r = await api('/api/memory', { method: 'POST', body: f }); toast(r.duplicate ? '≈ duplicate' : t('saved')); knowledge(v); } catch (err) { toast(err.message); } };
  $('#memExport').onclick = async () => { if (window.JARVIS_MOCK) return toast(t('demo_no_export')); const d = await api('/api/memory/export'); if (window.JARVIS_LOCAL) return toast(await window.JARVIS_LOCAL.exportFile('jarvis-memory.json', JSON.stringify(d, null, 2))); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'jarvis-memory.json'; a.click(); };
  $('#docFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 1.5e6) return toast('1.5 MB max'); try { await api('/api/documents', { method: 'POST', body: { name: f.name, text: await f.text() } }); toast(t('saved')); knowledge(v); } catch (err) { toast(err.message); } };
  $$('[data-ddel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/documents/${b.dataset.ddel}`, { method: 'DELETE' }); knowledge(v); }; });
}

// ===================================================== Planner
async function planner(v) {
  const [tasks, events, shop, rem, notes, habits] = await Promise.all([api('/api/tasks'), api(`/api/events?from=${new Date(Date.now() - 864e5).toISOString()}`), api('/api/shopping'), api('/api/reminders'), api('/api/notes'), api('/api/habits')]);
  v.innerHTML = `<div class="grid">
    <div class="c6 col"><div class="panel glass corner"><h2>${t('tasks')}</h2><form id="tf" class="row"><input name="title" class="grow" dir="auto" required placeholder="${t('new_task')}"><select name="priority"><option>normal</option><option>high</option><option>low</option></select><input name="due" type="date"><button class="btn primary sm">${t('add')}</button></form>
      <ul class="list" style="margin-top:8px">${tasks.map((x) => `<li><input type="checkbox" ${x.done ? 'checked disabled' : ''} data-done="${x.id}" aria-label="done"><span class="grow" dir="auto" style="${x.done ? 'opacity:.5;text-decoration:line-through' : ''}">${esc(x.title)}<div class="xs muted">${x.priority}${x.due ? ` · ${x.due.slice(0, 10)}` : ''}${x.project ? ` · ${esc(x.project)}` : ''}</div></span><button class="btn danger sm" data-tdel="${x.id}" aria-label="${t('delete')}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
      <div class="panel glass corner"><h2>${t('habits')}</h2><form id="hf" class="row"><input name="name" class="grow" dir="auto" required placeholder="${t('habit_ph')}"><button class="btn ok sm">✓ ${t('done_today')}</button></form>
      <ul class="list" style="margin-top:8px">${habits.map((h) => `<li class="small"><span class="dot ${h.doneToday ? 'ok' : ''}"></span><span class="grow" dir="auto">${esc(h.name)}<div class="xs muted">${h.streak} ${t('day_streak')} · ${h.last30}/30</div></span>${h.doneToday ? '' : `<button class="btn ok sm" data-hlog="${esc(h.name)}">✓</button>`}<button class="btn danger sm" data-hdel="${h.id}" aria-label="${t('delete')}">✕</button></li>`).join('') || `<li class="empty">${t('habits_empty')}</li>`}</ul></div>
      <div class="panel glass corner"><h2>${t('notes')}</h2><form id="nf" class="col"><textarea name="text" dir="auto" required style="min-height:70px;font-family:var(--font)" placeholder="${t('note_ph')}"></textarea><button class="btn primary sm" style="align-self:flex-start">${t('save')}</button></form>
      <ul class="list" style="margin-top:8px">${notes.slice(0, 30).map((n) => `<li class="small"><span class="grow out" dir="auto">${esc(n.text)}<div class="xs muted">${esc(fmtTime(n.createdAt))}</div></span><button class="btn danger sm" data-ndel="${n.id}" aria-label="${t('delete')}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul></div></div>
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
  $('#hf').onsubmit = async (e) => { e.preventDefault(); await api('/api/habits/log', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); planner(v); };
  $$('[data-hlog]', v).forEach((b) => { b.onclick = async () => { await api('/api/habits/log', { method: 'POST', body: { name: b.dataset.hlog } }); planner(v); }; });
  $$('[data-hdel]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('delete'), { danger: true, okText: t('delete') })) { await api(`/api/habits/${b.dataset.hdel}`, { method: 'DELETE' }); planner(v); } }; });
  $('#nf').onsubmit = async (e) => { e.preventDefault(); await api('/api/notes', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); planner(v); };
  $$('[data-ndel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/notes/${b.dataset.ndel}`, { method: 'DELETE' }); planner(v); }; });
}

// ===================================================== Family Wealth OS
async function wealth(v) {
  const [ov, an, budgets, accounts, series, txs, odds] = await Promise.all([api('/api/wealth/overview'), api('/api/wealth/analysis', { method: 'POST', body: {} }), api('/api/wealth/budgets'), api('/api/wealth/accounts'), api('/api/wealth/series?months=6'), api('/api/wealth/transactions'), api('/api/wealth/goal-odds').catch(() => [])]);
  const hasDemo = txs.some((x) => x.demo);
  const f = an.facts.currentMonth; const nw = ov.facts.netWorth; const ch = an.calculations.expenseChange;
  const cats = Object.entries(f.byCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const compact = (m) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(m / 100);
  v.innerHTML = `<div class="grid fin">
    <div class="c3 glass kpi hero"><div class="lbl muted">${t('net_worth')}</div><div class="stat big num">${money(nw.netWorth)}</div><div class="delta muted">${t('assets')} ${money(nw.assets)} · ${t('liabilities')} ${money(nw.liabilities)}</div></div>
    <div class="c3 glass kpi corner"><div class="lbl">${t('spent_month')} · ${an.month}</div><div class="stat num">${money(f.expenses)}</div><div class="delta ${ch > 0 ? 'err' : 'ok-t'}">${ch > 0 ? '▲' : '▼'} ${money(Math.abs(ch))} ${t('vs_prev')}</div></div>
    <div class="c3 glass kpi corner"><div class="lbl">${t('income')}</div><div class="stat num">${money(f.income)}</div><div class="delta muted">${t('net')} ${money(f.net)}</div></div>
    <div class="c3 glass kpi corner"><div class="lbl">${t('savings_potential')}</div><div class="stat num ok-t">${money(an.calculations.potentialMonthlySaving)}</div><div class="delta muted">${t('per_month_calc')}</div></div>
    <div class="c12 panel glass corner"><h2>${t('record_title')} <span class="right xs muted">${t('records_only')}</span></h2>
      <form id="txF" class="row"><select name="kind" aria-label="${t('kind')}"><option value="expense">${t('expense')}</option><option value="income">${t('income')}</option></select>
        <input name="amount" type="number" step="0.01" min="0.01" required placeholder="₪" style="width:110px" aria-label="₪"><input name="description" class="grow" dir="auto" required placeholder="${t('description')}" aria-label="${t('description')}">
        <input name="category" list="catList" placeholder="${t('category')}" style="width:140px" aria-label="${t('category')}"><datalist id="catList">${['groceries', 'dining', 'transport', 'utilities', 'housing', 'subscriptions', 'shopping', 'health', 'income', 'other'].map((c) => `<option>${c}</option>`).join('')}</datalist>
        <input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" aria-label="date"><button class="btn ok">${t('add')}</button></form>
      <div class="row" style="margin-top:10px"><details><summary class="small">${t('more_records')}</summary><div class="col" style="margin-top:8px">
        <form id="billF" class="row"><b class="small">${t('bill')}</b><input name="name" dir="auto" required placeholder="${t('name')}"><input name="amount" type="number" step="0.01" min="0" required placeholder="₪" style="width:100px"><input name="dueDate" type="date" required><button class="btn sm">${t('add')}</button></form>
        <form id="goalF" class="row"><b class="small">${t('goal')}</b><input name="name" dir="auto" required placeholder="${t('name')}"><input name="target" type="number" step="1" min="1" required placeholder="${t('target')} ₪" style="width:120px"><input name="deadline" type="date"><button class="btn sm">${t('add')}</button></form>
        <form id="budF" class="row"><b class="small">${t('budget')}</b><input name="category" list="catList" required placeholder="${t('category')}"><input name="limit" type="number" step="1" min="0" required placeholder="₪ / month" style="width:120px"><button class="btn sm">${t('save')}</button></form>
      </div></details>${hasDemo ? `<button id="clearDemo" class="btn danger sm" style="margin-inline-start:auto">${t('clear_demo')}</button>` : ''}</div></div>
    <div class="c8 panel glass corner"><h2>${t('cashflow')} <span class="right legend"><span><i style="background:var(--green)"></i>${t('income')}</span><span><i style="background:var(--red)"></i>${t('expenses')}</span><span><i style="background:var(--cyan)"></i>${t('net')}</span></span></h2>
      ${lineChart(series, { keys: ['income', 'expenses', 'net'], colors: ['#22e08a', '#ff5d6c', '#2ee6ff'], fmt: compact, labels: (d) => d.month.slice(5) })}<div class="xs muted">${t('months_6')} · ${an.month} = month to date</div></div>
    <div class="c4 panel glass corner" style="text-align:center"><h2>${t('by_category')}</h2>${donut(cats, { colors: CAT_COLORS, center: money(f.expenses), sub: an.month })}
      <div class="legend" style="justify-content:center;margin-top:8px">${cats.map((c, i) => `<span><i style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></i>${esc(c.label)}</span>`).join('')}</div></div>
    <div class="c6 panel glass corner"><h2>${t('budgets')}</h2>${budgets.map((b) => `<div class="row small" style="justify-content:space-between;margin-top:10px"><span>${esc(b.category)}</span><span class="num muted" dir="ltr">${money(b.spent)} / ${money(b.limit)}</span></div><div class="bar ${b.over ? 'over' : 'green'}"><i style="width:${Math.min(100, b.usedPct ?? 0)}%"></i></div>`).join('')}</div>
    <div class="c6 panel glass corner"><h2>${t('recommendations')}</h2><ul class="list">${an.recommendations.map((r) => `<li class="small"><span class="tag xs">${r.kind}</span><span class="grow" dir="auto">${esc(he() ? r.textHe : r.text)}</span></li>`).join('') || '<li class="empty">—</li>'}</ul><p class="xs muted">${esc(an.disclaimer)}</p></div>
    <div class="c4 panel glass corner"><h2>${t('goals')}</h2>${ov.goals.map((g) => `<div class="row small" style="justify-content:space-between;margin-top:10px"><span dir="auto">${esc(g.name)}</span><span>${g.pct}%${(() => { const o = odds.find((x) => x.goal === g.name); return o ? ` <span class="tag ${o.probability >= 0.7 ? 'ok' : o.probability >= 0.3 ? 'warn' : 'bad'} xs" title="Monte Carlo">${Math.round(o.probability * 100)}% ${t('odds')}</span>` : ''; })()}</span></div><div class="bar green"><i style="width:${Math.min(100, g.pct)}%"></i></div><div class="row xs muted"><span class="grow" dir="ltr">${money(g.saved)} / ${money(g.target)} · ${g.monthsToGoal ?? '–'} mo</span><input data-gamt="${g.goalId}" type="number" min="1" placeholder="₪" style="width:80px;padding:4px 8px" aria-label="${t('deposit')}"><button class="btn ok sm" data-gdep="${g.goalId}">${t('deposit')}</button></div>`).join('') || `<p class="empty">${t('goals_empty')}</p>`}</div>
    <div class="c4 panel glass corner"><h2>${t('bills_soon')}</h2><ul class="list">${ov.upcomingBills.map((b) => `<li class="small"><span class="grow" dir="auto">${esc(b.name)}<div class="xs muted">${b.dueDate}</div></span>${b.overdue ? '<span class="tag bad xs">overdue</span>' : ''}<b class="num">${money(b.amount)}</b><button class="btn ok sm" data-paid="${b.id}">${t('mark_paid')}</button></li>`).join('') || '<li class="empty">—</li>'}</ul></div>
    <div class="c4 panel glass corner"><h2>${t('forecast')} · ${t('data_sources')}</h2><div class="kv small"><span class="muted">avg ${t('income')}</span><span class="num">${money(an.forecasts.avgIncome)}</span><span class="muted">avg ${t('expenses')}</span><span class="num">${money(an.forecasts.avgExpenses)}</span><span class="muted">+6 mo</span><span class="num">${money(an.forecasts.projection.at(-1).cumulativeNet)}</span></div>
      <div class="xs muted" style="margin-top:8px">${esc(an.forecasts.assumption)}</div><div class="row" style="margin-top:8px">${Object.entries(an.dataQuality.transactionsBySource).map(([k, n]) => `<span class="tag ${k === 'demo' ? 'warn' : 'ok'} xs">${esc(k)}: ${n}</span>`).join('')}</div></div>
    <div class="c6 panel glass corner"><h2>${t('scenario')}</h2><form id="simF" class="row">${cats.slice(0, 5).map((c) => `<label class="small">${esc(c.label)} <input name="${esc(c.label)}" type="number" min="0" max="100" value="0" style="width:64px">%</label>`).join('')}<button class="btn ok sm">${t('simulate')}</button></form><p id="simOut" class="small"></p></div>
    <div class="c6 panel glass corner"><h2>${t('accounts')}</h2><table>${accounts.map((a) => `<tr><td dir="auto">${esc(a.name)}<div class="xs muted">${esc(a.institution)}</div></td><td class="n">${money(a.balance)}</td></tr>`).join('')}</table></div>
    <div class="c12 panel glass corner"><h2>${t('recent_tx')}</h2><div style="max-height:320px;overflow:auto"><table>${txs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40).map((x) => `<tr><td class="xs mono">${esc(x.date)}</td><td dir="auto">${esc(x.description)}${x.demo ? ' <span class="tag warn xs">demo</span>' : x.source === 'manual' ? ' <span class="tag ok xs">manual</span>' : ''}</td><td class="xs muted">${esc(x.category)}</td><td class="n" style="color:${x.amount > 0 ? 'var(--green)' : 'inherit'}">${money(x.amount, 2)}</td><td><button class="btn danger sm" data-txdel="${x.id}" aria-label="${t('delete')}">✕</button></td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div>
    <div class="c12 panel glass corner"><h2>${t('by_category')} · ${t('vs_prev')}</h2><table><tr><th></th><th class="n">${an.month}</th><th class="n">−1</th><th class="n">Δ</th><th style="width:30%"></th></tr>${an.calculations.categoryChanges.map((c) => `<tr><td>${esc(c.category)}</td><td class="n">${money(c.current)}</td><td class="n">${money(c.previous)}</td><td class="n" style="color:${c.change > 0 ? 'var(--red)' : 'var(--green)'}">${money(c.change)}</td><td><div class="bar ${c.change > 0 ? 'over' : 'green'}"><i style="width:${Math.min(100, (Math.max(c.current, c.previous) / Math.max(1, ...an.calculations.categoryChanges.map((x) => Math.max(x.current, x.previous)))) * 100)}%"></i></div></td></tr>`).join('')}</table></div></div>`;
  $('#simF').onsubmit = async (e) => { e.preventDefault(); const cuts = Object.fromEntries([...new FormData(e.target)].map(([k, x]) => [k, Number(x)]).filter(([, x]) => x > 0));
    const r = await api('/api/wealth/recommendations', { method: 'POST', body: { cuts } }); $('#simOut').textContent = `≈ ${money(r.simulation.monthlySaving)} / month · ${money(r.simulation.yearlySaving)} / year (calculation, not a guarantee)`; };
  const post = (path, body, okMsg) => api(path, { method: 'POST', body }).then(() => { toast(okMsg ?? t('saved')); wealth(v); }).catch((err) => toast(err.message));
  const form = (e) => { e.preventDefault(); return Object.fromEntries(new FormData(e.target)); };
  $('#txF').onsubmit = (e) => post('/api/wealth/transactions', form(e));
  $('#billF').onsubmit = (e) => post('/api/wealth/bills', form(e));
  $('#goalF').onsubmit = (e) => post('/api/wealth/goals', form(e));
  $('#budF').onsubmit = (e) => { const f = form(e); api('/api/wealth/budgets', { method: 'PUT', body: f }).then(() => { toast(t('saved')); wealth(v); }).catch((err) => toast(err.message)); };
  $$('[data-paid]', v).forEach((b) => { b.onclick = () => post(`/api/wealth/bills/${b.dataset.paid}/paid`, {}, t('marked_paid')); });
  $$('[data-gdep]', v).forEach((b) => { b.onclick = () => { const amount = v.querySelector(`[data-gamt="${b.dataset.gdep}"]`).value; if (amount > 0) post(`/api/wealth/goals/${b.dataset.gdep}/contribute`, { amount }); }; });
  $$('[data-txdel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/wealth/transactions/${b.dataset.txdel}`, { method: 'DELETE' }); wealth(v); }; });
  $('#clearDemo')?.addEventListener('click', async () => { if (await confirmDialog(t('clear_demo_q'), { danger: true, okText: t('clear_demo') })) { const r = await api('/api/wealth/demo', { method: 'DELETE' }); toast(`✕ ${r.removed}`); wealth(v); } });
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
  $$('[data-rev]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('revoke'), { danger: true, okText: t('delete') })) { await api(`/api/devices/${b.dataset.rev}`, { method: 'DELETE' }); devices(v); } }; });
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
  $('#delVoice').onclick = async () => { if (await confirmDialog(t('delete_voice'), { danger: true, okText: t('delete') })) { await api('/api/privacy/voice', { method: 'DELETE' }); privacy(v); } };
  $$('[data-dd]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(`${t('delete_domain')}: ${b.dataset.dd}?`, { danger: true, okText: t('delete') })) { const r = await api(`/api/privacy/domain/${b.dataset.dd}`, { method: 'DELETE' }); toast(`✕ ${r.deleted}`); privacy(v); } }; });
  $('#expAll').onclick = async () => { if (window.JARVIS_MOCK) return toast(t('demo_no_export')); const d = await api('/api/privacy/export'); if (window.JARVIS_LOCAL) return toast(await window.JARVIS_LOCAL.exportFile('jarvis-export.json', JSON.stringify(d, null, 2))); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'jarvis-export.json'; a.click(); };
}

// ===================================================== Settings
async function settings(v) {
  const [p, w, st] = await Promise.all([api('/api/settings/personality'), api('/api/context/weather'), api('/api/status')]);
  const L = window.JARVIS_LOCAL;
  const ls = L?.settings() ?? {};
  const store = L?.storage();
  const runtime = L ? `<div class="c12 panel glass corner"><h2>${t('runtime')}</h2>
    <div class="kv small"><span class="muted">${t('runtime')}</span><span>${t(L.mode === 'claude' ? 'rt_claude' : 'rt_browser')}</span>
      <span class="muted">${t('storage')}</span><span id="stState"><span class="tag ${store.state === 'error' ? 'bad' : 'ok'} xs">${t(`st_${store.state}`)}</span> ${esc(store.message ?? '')}</span>
      <span class="muted">${t('ai_brain')}</span><span><span class="tag ${L.ai === 'none' ? 'warn' : 'ok'} xs">${t(L.ai === 'claude' ? 'ai_claude' : L.ai === 'anthropic-key' ? 'ai_key' : 'ai_none')}</span></span></div>
    <form id="rtF" class="kv" style="margin-top:12px">
      ${L.ai === 'claude' ? '' : `<label for="akey">${t('api_key')}</label><input id="akey" name="anthropicKey" type="password" autocomplete="off" placeholder="${ls.anthropicKey ? '•••• (saved)' : 'sk-ant-…'}">`}
      <label for="haurl">${t('ha_url')}</label><input id="haurl" name="haUrl" value="${esc(ls.haUrl ?? '')}" placeholder="https://homeassistant.local:8123">
      <label for="hatok">${t('ha_token')}</label><input id="hatok" name="haToken" type="password" autocomplete="off" placeholder="${ls.haToken ? '•••• (saved)' : ''}">
      <span></span><div class="row"><button class="btn primary sm">${t('apply_reload')}</button>${L.permissions ? `<button type="button" id="permBtn" class="btn sm">⛨ ${t('manage_perms')}</button>` : ''}<button type="button" id="wipeBtn" class="btn danger sm">${t('wipe')}</button></div></form></div>` : '';
  v.innerHTML = `<div class="grid">${runtime}<div class="c6 panel glass corner"><h2>${t('personality')}</h2><form id="pf" class="kv">
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
  if (L) {
    $('#rtF').onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const patch = {};
      for (const [k, val] of Object.entries(f)) if (val || k === 'haUrl') patch[k] = val; // empty secret fields keep the saved value
      if (!L.saveSettings(patch)) return toast('storage blocked'); L.flush().then(() => location.reload()); };
    $('#permBtn')?.addEventListener('click', () => L.permissions.manage().catch(() => toast(t('manage_perms'))));
    $('#wipeBtn').onclick = async () => { if (await confirmDialog(t('wipe_q'), { danger: true, okText: t('wipe') })) L.wipe(); };
  }
  $('#clr').onclick = () => { clearChat(); toast(t('updated')); };
}

// ===================================================== AI Studio
async function aiStudio(v) {
  const [eng, files, apps, agents, councils, plans] = await Promise.all([api('/api/ai/engines'), api('/api/ai/generated'), api('/api/ai/apps'), api('/api/ai/agents'), api('/api/ai/councils'), api('/api/ai/plans')]);
  const kinds = ['document', 'table', 'email', 'plan', 'code', 'json', 'calendar'];
  const busy = (btn, on) => { btn.disabled = on; btn.dataset.label ??= btn.textContent; btn.textContent = on ? t('working') : btn.dataset.label; };
  const stIcon = { done: '✓', awaiting_approval: '⏸', failed: '✕', advice: '•', not_run: '–' };
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${t('engines_title')}</h2>${eng.ai ? '' : `<p class="small warn-t" style="margin:0 0 10px">⚠ ${t('needs_ai')}</p>`}
      <div class="agent-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${eng.engines.map((e) => `<div class="agent-chip"><span class="dot ${e.status === 'online' ? 'ok' : e.status === 'limited' ? 'warn' : 'bad'}"></span><span class="grow"><b>${esc(he() ? e.nameHe : e.name)}</b><div class="xs muted">${esc(e.detail)}</div></span></div>`).join('')}</div></div>
    <div class="c6 panel glass corner"><h2>${t('gen_title')}</h2><form id="genF" class="col"><select name="kind" aria-label="${t('kind')}">${kinds.map((k) => `<option value="${k}">${t(`kind_${k}`)}</option>`).join('')}</select>
      <textarea name="prompt" dir="auto" required style="font-family:var(--font);min-height:80px" placeholder="${t('gen_ph')}" aria-label="${t('gen_title')}"></textarea><button class="btn primary" style="align-self:flex-start">✦ ${t('generate')}</button></form><div id="genOut" style="margin-top:10px"></div></div>
    <div class="c6 panel glass corner"><h2>${t('apps_title')}</h2><form id="appF" class="col"><textarea name="prompt" dir="auto" required style="font-family:var(--font);min-height:80px" placeholder="${t('app_ph')}" aria-label="${t('apps_title')}"></textarea><button class="btn primary" style="align-self:flex-start">⚙ ${t('build')}</button></form>
      <ul class="list" style="margin-top:8px">${apps.map((a) => `<li class="small"><span class="grow" dir="auto">${esc(a.title)}<div class="xs muted">${(a.size / 1024).toFixed(1)} KB</div></span><button class="btn sm" data-appopen="${a.id}">▶ ${t('open')}</button><button class="btn danger sm" data-appdel="${a.id}" aria-label="${t('delete')}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul>
      <div id="appStage"></div><p class="xs muted">${t('app_sandbox')}</p></div>
    <div class="c12 panel glass corner"><h2>${t('files_title')}</h2><div style="max-height:320px;overflow:auto"><table>${files.map((f) => `<tr><td dir="auto">${esc(f.filename)}</td><td class="xs muted">${esc(t(`kind_${f.kind}`))}</td><td class="xs mono">${esc(f.createdAt.slice(0, 16).replace('T', ' '))}</td><td><div class="row"><button class="btn sm" data-fopen="${f.id}">${t('open')}</button><button class="btn sm" data-fdl="${f.id}">⬇ ${t('download')}</button>${f.kind === 'calendar' ? `<button class="btn ok sm" data-fcal="${f.id}">${t('add_to_cal')}</button>` : ''}<button class="btn danger sm" data-fdel="${f.id}" aria-label="${t('delete')}">✕</button></div></td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div><div id="fileView"></div></div>
    <div class="c6 panel glass corner"><h2>${t('council_title')}</h2><form id="cF" class="row"><input name="question" class="grow" dir="auto" required placeholder="${t('council_ph')}" aria-label="${t('council_title')}"><button class="btn primary sm">${t('ask_council')}</button></form><div id="cOut">${councils[0] ? councilHtml(councils[0]) : ''}</div></div>
    <div class="c6 panel glass corner"><h2>${t('plan_title')}</h2><form id="pF" class="row"><input name="goal" class="grow" dir="auto" required placeholder="${t('plan_ph')}" aria-label="${t('plan_title')}"><button class="btn primary sm">${t('run_plan')}</button></form><div id="pOut">${plans[0] ? planHtml(plans[0]) : ''}</div></div>
    <div class="c12 panel glass corner"><h2>${t('agents_title')}</h2><form id="agF" class="row"><input name="description" class="grow" dir="auto" required placeholder="${t('agent_ph')}" aria-label="${t('agents_title')}"><button class="btn primary sm">${t('create_agent')}</button></form>
      <ul class="list" style="margin-top:8px">${agents.map((a) => `<li class="small"><span class="tag info mono xs">@${esc(a.handle)}</span><span class="grow" dir="auto"><b>${esc(a.name)}</b> · ${esc(a.description)}<div class="xs muted">${esc(a.tools.join(', ') || '—')}</div></span><button class="btn sm" data-agtalk="${esc(a.handle)}">💬</button><button class="btn danger sm" data-agdel="${a.id}" aria-label="${t('delete')}">✕</button></li>`).join('') || `<li class="empty">—</li>`}</ul></div></div>`;
  function councilHtml(c) { return `<div class="small out" dir="auto" style="margin-top:10px"><b>${esc(c.question)}</b>\n\n${esc(c.synthesis)}</div><details style="margin-top:6px"><summary class="xs muted">${c.opinions.length} experts</summary>${c.opinions.map((o) => `<div class="small out" dir="auto" style="margin-top:6px"><b>${esc(o.expert)}</b>\n${esc(o.text)}</div>`).join('')}</details>`; }
  function planHtml(p) { return `<div class="small" style="margin-top:10px" dir="auto"><b>${esc(p.goal)}</b><div class="muted">${esc(p.summary)}</div>${p.steps.map((st) => `<div class="block ${st.status === 'awaiting_approval' ? 'approval' : st.status === 'done' ? 'notify' : ''}"><span class="bt">${stIcon[st.status] ?? '·'} ${esc(st.status)}</span><span class="grow" dir="auto">${esc(st.title)}${st.result ? `<div class="xs muted">${esc(String(st.result).slice(0, 200))}</div>` : ''}</span>${st.tool ? `<span class="xs mono muted">${esc(st.tool)}</span>` : ''}</div>`).join('')}</div>`; }
  const fileText = async (id) => api(`/api/ai/generated/${id}`);
  const showFile = (f) => {
    const box = $('#fileView');
    if (f.kind === 'table') {
      const rows = f.content.split(/\r?\n/).filter(Boolean).map((r) => r.match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((c) => c !== '').map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
      box.innerHTML = `<div style="overflow:auto;margin-top:10px"><table><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td dir="auto">${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    } else box.innerHTML = `<pre class="out small" dir="auto" style="margin-top:10px;max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:12px">${esc(f.content)}</pre>`;
  };
  const download = async (f) => {
    if (window.JARVIS_LOCAL) return toast(await window.JARVIS_LOCAL.exportFile(f.filename, f.content));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.content], { type: f.mime })); a.download = f.filename; a.click();
  };
  $('#genF').onsubmit = async (e) => { e.preventDefault(); const btn = e.submitter ?? $('#genF button'); busy(btn, true);
    try { const f = await api('/api/ai/generate', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), lang: getLang() } }); toast(f.filename); await aiStudio(v); showFile(f); }
    catch (err) { busy(btn, false); $('#genOut').innerHTML = `<p class="err small">${esc(err.message)}</p>`; } };
  $('#appF').onsubmit = async (e) => { e.preventDefault(); const btn = $('#appF button'); busy(btn, true);
    try { const a = await api('/api/ai/apps', { method: 'POST', body: { prompt: e.target.prompt.value, lang: getLang() } }); await aiStudio(v); openApp(a.id); }
    catch (err) { busy(btn, false); toast(err.message); } };
  const openApp = async (id) => {
    const a = await api(`/api/ai/apps/${id}`);
    const stage = $('#appStage'); stage.innerHTML = '';
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-forms'); // no allow-same-origin: the app cannot reach JARVIS or its data
    f.title = a.title; f.srcdoc = a.html;
    f.style.cssText = 'width:100%;height:440px;border:1px solid var(--line-strong);border-radius:12px;background:#03060d;margin-top:10px';
    stage.append(f);
  };
  $('#cF').onsubmit = async (e) => { e.preventDefault(); const btn = $('#cF button'); busy(btn, true);
    try { const c = await api('/api/ai/council', { method: 'POST', body: { question: e.target.question.value, lang: getLang() } }); $('#cOut').innerHTML = councilHtml(c); } catch (err) { toast(err.message); } busy(btn, false); };
  $('#pF').onsubmit = async (e) => { e.preventDefault(); const btn = $('#pF button'); busy(btn, true);
    try { const p = await api('/api/ai/plan', { method: 'POST', body: { goal: e.target.goal.value, lang: getLang() } }); $('#pOut').innerHTML = planHtml(p); } catch (err) { toast(err.message); } busy(btn, false); };
  $('#agF').onsubmit = async (e) => { e.preventDefault(); const btn = $('#agF button'); busy(btn, true);
    try { const a = await api('/api/ai/agents', { method: 'POST', body: { description: e.target.description.value, lang: getLang() } }); toast(`@${a.handle}`); aiStudio(v); } catch (err) { busy(btn, false); toast(err.message); } };
  $$('[data-appopen]', v).forEach((b) => { b.onclick = () => openApp(b.dataset.appopen); });
  $$('[data-appdel]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('delete'), { danger: true, okText: t('delete') })) { await api(`/api/ai/apps/${b.dataset.appdel}`, { method: 'DELETE' }); aiStudio(v); } }; });
  $$('[data-fopen]', v).forEach((b) => { b.onclick = async () => showFile(await fileText(b.dataset.fopen)); });
  $$('[data-fdl]', v).forEach((b) => { b.onclick = async () => download(await fileText(b.dataset.fdl)); });
  $$('[data-fcal]', v).forEach((b) => { b.onclick = async () => { const r = await api(`/api/ai/generated/${b.dataset.fcal}/to-calendar`, { method: 'POST' }); toast(`+${r.added}`); }; });
  $$('[data-fdel]', v).forEach((b) => { b.onclick = async () => { await api(`/api/ai/generated/${b.dataset.fdel}`, { method: 'DELETE' }); aiStudio(v); }; });
  $$('[data-agdel]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('delete'), { danger: true, okText: t('delete') })) { await api(`/api/ai/agents/${b.dataset.agdel}`, { method: 'DELETE' }); aiStudio(v); } }; });
  $$('[data-agtalk]', v).forEach((b) => { b.onclick = () => { location.hash = 'conversation'; setTimeout(() => { const i = document.querySelector('.composer input[dir=auto]'); if (i) { i.value = `@${b.dataset.agtalk} `; i.focus(); } }, 300); }; });
}

// ===================================================== Brain Center
async function brainView(v) {
  const [b, privacy, metrics] = await Promise.all([api('/api/brain'), api('/api/privacy'), api('/api/brain/metrics')]);
  const L = b.learning;
  const lastDec = b.decisions[0];
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${t('pipeline')}</h2>
      <div class="row" style="gap:6px">${b.pipeline.map((p2, i) => `<span class="tag info">${i + 1}. ${t(`st_${p2}`)}</span>${i < b.pipeline.length - 1 ? '<span class="muted">→</span>' : ''}`).join('')}</div>
      <div class="gauges" style="margin-top:14px">${gauge(b.successPct, { label: t('success'), color: 'var(--green)' })}${gauge(L.satisfactionPct, { label: t('satisfaction'), color: 'var(--violet)' })}${gauge(b.tasks, { label: t('tasks'), suffix: '', max: 200, color: 'var(--cyan)' })}${gauge(b.avgMs, { label: 'ms', suffix: '', max: 5000, color: 'var(--amber)' })}</div></div>
    <div class="c6 panel glass corner"><h2>${t('learn_queue')} <span class="right row xs"><label class="row"><input id="learnTog" type="checkbox" ${privacy.settings.learningEnabled ? 'checked' : ''}> ${t('learning_on')}</label></span></h2>
      <ul class="list">${L.queue.map((m) => `<li class="small"><span class="grow" dir="auto">${esc(m.content)}<div class="xs muted">${m.type} · ${m.provenance}</div></span><button class="btn ok sm" data-lok="${m.id}">${t('approve_l')}</button><button class="btn danger sm" data-lno="${m.id}">${t('reject_l')}</button></li>`).join('') || `<li class="empty">${t('learn_empty')}</li>`}</ul>
      ${L.suggestions.length ? `<h2 style="margin-top:14px">${t('adapt')}</h2>${L.suggestions.map((sg) => `<div class="row small" style="margin-top:6px"><span class="grow">${esc(he() ? sg.textHe : sg.text)}</span><button class="btn ok sm" data-sug="${sg.id}">${t('apply')}</button></div>`).join('')}` : ''}
      ${L.byAgent.length ? `<div class="row" style="margin-top:12px">${L.byAgent.map((a) => `<span class="tag xs">${esc(a.agent)} 👍${a.up} 👎${a.down}</span>`).join('')}</div>` : ''}</div>
    <div class="c6 panel glass corner"><h2>${t('watchers_title')} <button id="wCheck" class="right btn sm">↻ ${t('check_now')}</button></h2>
      <form id="wF" class="row"><input name="text" class="grow" dir="auto" required placeholder="${t('watch_ph')}" aria-label="${t('watchers_title')}"><button class="btn primary sm">${t('add_watch')}</button></form>
      <ul class="list" style="margin-top:8px">${b.watchers.map((w) => `<li class="small"><span class="dot ${w.error ? 'bad' : w.state ? 'warn pulse' : w.enabled ? 'ok' : ''}"></span><span class="grow" dir="auto">${esc(w.label)}<div class="xs muted mono" dir="ltr">${esc(w.metric)}${Object.keys(w.params).length ? `(${esc(Object.values(w.params).join(','))})` : ''} ${esc(w.op)} ${w.value} · now ${w.lastValue ?? '–'}${w.triggers ? ` · ⚡${w.triggers}` : ''}${w.error ? ` · ${esc(w.error)}` : ''}</div></span><button class="switch ${w.enabled ? 'on' : ''}" data-wtog="${w.id}" data-en="${w.enabled}" aria-label="${esc(w.label)}"></button><button class="btn danger sm" data-wdel="${w.id}" aria-label="${t('delete')}">✕</button></li>`).join('') || '<li class="empty">—</li>'}</ul>
      <details style="margin-top:8px"><summary class="xs muted">${t('metrics_cat')} (${Object.keys(metrics).length})</summary><ul class="list">${Object.entries(metrics).map(([k, m]) => `<li class="xs"><span class="mono">${esc(k)}</span><span class="grow muted">${esc(m.desc)}</span></li>`).join('')}</ul></details></div>
    <div class="c7 panel glass corner"><h2>${t('decide_title')}</h2><form id="dF" class="row"><input name="question" class="grow" dir="auto" required placeholder="${t('decide_ph')}" aria-label="${t('decide_title')}"><button class="btn primary sm">${t('decide_btn')}</button></form><div id="dOut">${lastDec ? decisionHtml(lastDec) : ''}</div></div>
    <div class="c5 panel glass corner"><h2>${t('top_tools')}</h2><ul class="list">${b.topTools.map((x) => `<li class="small"><span class="grow mono xs">${esc(x.tool)}</span><div class="bar" style="width:40%"><i style="width:${Math.min(100, (x.n / (b.topTools[0]?.n || 1)) * 100)}%"></i></div><span class="xs muted">${x.n}</span></li>`).join('') || '<li class="empty">—</li>'}</ul></div></div>`;
  function decisionHtml(d) {
    return `<div style="margin-top:10px"><div class="small" dir="auto"><b>${esc(d.question)}</b></div>${d.ranking.map((r, i) => `<div class="row small" style="margin-top:8px"><b style="min-width:24px">${i + 1}.</b><span class="grow" dir="auto">${esc(r.option)}${d.notes?.[r.option] ? `<div class="xs muted">${esc(d.notes[r.option])}</div>` : ''}</span><span class="num">${r.score}</span></div><div class="bar ${i ? '' : 'green'}"><i style="width:${r.score}%"></i></div>`).join('')}
      <div class="row xs" style="margin-top:10px">${d.criteria.map((c) => `<span class="tag xs">${esc(c.name)} ×${c.weight}</span>`).join('')}<span class="tag ${d.robust ? 'ok' : 'warn'} xs">${d.robust ? t('robust') : `${t('sensitive')}: ${esc(d.sensitiveTo.join(', ') || '—')}`}</span></div></div>`;
  }
  $('#learnTog').onchange = async (e) => { await api('/api/privacy', { method: 'PUT', body: { learningEnabled: e.target.checked } }); toast(t('updated')); };
  $$('[data-lok]', v).forEach((x) => { x.onclick = async () => { await api(`/api/brain/learn/${x.dataset.lok}/approve`, { method: 'POST' }); brainView(v); }; });
  $$('[data-lno]', v).forEach((x) => { x.onclick = async () => { await api(`/api/brain/learn/${x.dataset.lno}`, { method: 'DELETE' }); brainView(v); }; });
  $$('[data-sug]', v).forEach((x) => { x.onclick = async () => { await api(`/api/brain/suggestions/${x.dataset.sug}/apply`, { method: 'POST' }); toast(t('updated')); brainView(v); }; });
  $('#wF').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/brain/watchers', { method: 'POST', body: { text: e.target.text.value, lang: getLang() } }); brainView(v); } catch (err) { toast(err.message); } };
  $('#wCheck').onclick = async () => { const r = await api('/api/brain/watchers/check', { method: 'POST' }); toast(`⚡ ${r.fired.length}`); brainView(v); };
  $$('[data-wtog]', v).forEach((x) => { x.onclick = async () => { await api(`/api/brain/watchers/${x.dataset.wtog}`, { method: 'PATCH', body: { enabled: x.dataset.en !== 'true' } }); brainView(v); }; });
  $$('[data-wdel]', v).forEach((x) => { x.onclick = async () => { await api(`/api/brain/watchers/${x.dataset.wdel}`, { method: 'DELETE' }); brainView(v); }; });
  $('#dF').onsubmit = async (e) => { e.preventDefault(); const btn = $('#dF button'); btn.disabled = true; const lbl = btn.textContent; btn.textContent = t('working');
    try { const d = await api('/api/ai/decide', { method: 'POST', body: { question: e.target.question.value, lang: getLang() } }); $('#dOut').innerHTML = decisionHtml(d); } catch (err) { toast(err.message); } btn.disabled = false; btn.textContent = lbl; };
  await brainExtras(v);
}

// ===================================================== Missions
async function missionsView(v) {
  const list = await api('/api/v1/brain/missions');
  const ic = { done: '✓', awaiting_approval: '⏸', failed: '✕', rejected: '⛔', blocked: '⊘', invalid: '⚠', cancelled: '–', pending: '·', running: '…' };
  const cls = { done: 'notify', awaiting_approval: 'approval', failed: 'condition', rejected: 'condition', blocked: 'condition', invalid: 'condition' };
  v.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><h2>${t('missions')}</h2><form id="mF" class="row"><input name="goal" class="grow" dir="auto" required placeholder="${t('mission_ph')}" aria-label="${t('missions')}"><button class="btn primary">${t('start_mission')}</button></form><p class="xs muted" style="margin:6px 0 0">${t('needs_ai')}</p></div>
    ${list.map((m) => `<div class="c12 panel glass corner"><h2><span dir="auto">${esc(m.objective)}</span><span class="right row">
      <span class="tag ${m.status === 'completed' ? 'ok' : ['failed', 'cancelled'].includes(m.status) ? 'bad' : 'warn'} xs">${t(`m_${m.status}`)}</span><span class="tag xs">risk ${esc(m.risk)}</span><span class="tag xs">${esc(m.verification)}</span>
      ${['running', 'waiting_approval', 'planned'].includes(m.status) ? `<button class="btn sm" data-mp="${m.id}">${t('pause')}</button>` : ''}${m.status === 'paused' ? `<button class="btn ok sm" data-mr="${m.id}">${t('resume')}</button>` : ''}${!['completed', 'partially_completed', 'failed', 'cancelled'].includes(m.status) ? `<button class="btn danger sm" data-mc="${m.id}">${t('cancel_l')}</button>` : ''}</span></h2>
      <div class="xs muted" dir="auto">${esc(m.successCriteria)}</div>
      ${m.tasks.map((x) => `<div class="block ${cls[x.status] ?? ''}"><span class="bt">${ic[x.status] ?? '·'} ${esc(x.id)}</span><span class="grow" dir="auto">${esc(x.title)}${x.result ? `<div class="xs muted">${esc(String(x.result).split('\n')[0].slice(0, 180))}</div>` : ''}${x.issues?.length ? `<div class="xs err">${esc(x.issues.join('; '))}</div>` : ''}</span>
        <span class="xs mono muted">${esc(x.agent)}${x.tool ? ` · ${esc(x.tool)}` : ''}${x.dependsOn.length ? ` ← ${esc(x.dependsOn.join(','))}` : ''}</span>${x.status === 'awaiting_approval' ? `<button class="btn ok sm" data-approve="${x.approvalId}">${t('approve')}</button><button class="btn danger sm" data-reject="${x.approvalId}">${t('reject')}</button>` : ''}</div>`).join('')}
    </div>`).join('') || `<div class="c12 panel glass"><p class="empty">—</p></div>`}</div>`;
  $('#mF').onsubmit = async (e) => { e.preventDefault(); const btn = $('#mF button'); btn.disabled = true; btn.textContent = t('working');
    try { await api('/api/v1/brain/missions', { method: 'POST', body: { goal: e.target.goal.value, lang: getLang() } }); missionsView(v); } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = t('start_mission'); } };
  $$('[data-mp]', v).forEach((b) => { b.onclick = async () => { await api(`/api/v1/brain/missions/${b.dataset.mp}/pause`, { method: 'POST' }); missionsView(v); }; });
  $$('[data-mr]', v).forEach((b) => { b.onclick = async () => { await api(`/api/v1/brain/missions/${b.dataset.mr}/resume`, { method: 'POST' }); missionsView(v); }; });
  $$('[data-mc]', v).forEach((b) => { b.onclick = async () => { if (await confirmDialog(t('cancel_l'), { danger: true, okText: t('cancel_l') })) { await api(`/api/v1/brain/missions/${b.dataset.mc}/cancel`, { method: 'POST' }); missionsView(v); } }; });
  const onTask = () => { if (location.hash === '#missions') missionsView(v); }; chatEvents.addEventListener('task', onTask); cleanups.push(() => chatEvents.removeEventListener('task', onTask));
}

// ===================================================== Brain Center: evaluation, coverage, capabilities, failures, gateway
async function brainExtras(v) {
  const box = document.createElement('div'); box.className = 'grid'; box.style.marginTop = '16px'; v.append(box);
  const [evals, cov, fails, gw] = await Promise.all([api('/api/v1/brain/evaluations'), api('/api/v1/brain/coverage'), api('/api/v1/brain/failures'), api('/api/v1/brain/gateway')]);
  const stCls = { 'implemented-tested': 'ok', 'implemented-untested': 'info', partial: 'warn', planned: '', blocked: 'bad', unsupported: 'bad' };
  const last = evals[0];
  box.innerHTML = `
    <div class="c6 panel glass corner"><h2>${t('eval_title')} <button id="runEval" class="right btn primary sm">▶ ${t('run_eval')}</button></h2><div id="evalOut">${last ? `<div class="row"><span class="stat">${last.passRate}%</span><span class="small muted">${last.passed}/${last.cases} · ${last.avgMs} ms</span></div><div class="row xs" style="margin-top:6px"><span class="tag ${last.permissionViolations ? 'bad' : 'ok'} xs">${t('violations')}: ${last.permissionViolations}</span><span class="tag ${last.falseSuccess ? 'bad' : 'ok'} xs">${t('false_success')}: ${last.falseSuccess}</span></div><div class="row xs" style="margin-top:6px">${Object.entries(last.perCategory).map(([k, c]) => `<span class="tag ${c.pass === c.total ? 'ok' : 'warn'} xs">${esc(k)} ${c.pass}/${c.total}</span>`).join('')}</div><div class="xs muted" style="margin-top:6px">${esc(last.at.slice(0, 16).replace('T', ' '))}</div>` : '<p class="empty">—</p>'}</div></div>
    <div class="c6 panel glass corner"><h2>${t('gateway_title')}</h2><div class="kv small">${Object.entries(gw.tiers).map(([k, x]) => `<span class="muted">${k}</span><span class="mono xs">${esc(x.provider)}/${esc(x.model)}</span>`).join('')}</div>
      <div class="row" style="margin-top:8px">${gw.providers.map((p2) => { const h = gw.health[p2.provider]; return `<span class="tag ${h?.downUntil > Date.now() ? 'bad' : 'ok'} xs">${esc(p2.provider)} · ${h?.downUntil > Date.now() ? t('down') : t('healthy')}${h?.failures ? ` (${h.failures}✕)` : ''}</span>`; }).join('')}</div>
      <h2 style="margin-top:12px">${t('prefs')}</h2><form id="gwF" class="row">${['chat', 'coding', 'research', 'finance', 'creative'].map((k) => `<label class="small">${k} <select name="${k}"><option value="">auto</option>${['fast', 'balanced', 'deep'].map((x) => `<option ${gw.preferences[k] === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`).join('')}<button class="btn sm">${t('save')}</button></form></div>
    <div class="c6 panel glass corner"><h2>${t('caps_title')}</h2><input id="capQ" dir="auto" placeholder="${t('caps_ph')}" style="width:100%" aria-label="${t('caps_title')}"><ul id="capList" class="list" style="margin-top:8px"></ul>
      <details style="margin-top:10px"><summary class="small">${t('ext_title')}</summary><textarea id="extJson" dir="ltr" style="margin-top:8px">${esc(JSON.stringify({ id: 'ext.my_service', description: 'Describe what this capability does', risk: 'external', inputSchema: { query: { type: 'string', required: true } }, adapter: { type: 'http', url: 'https://example.com/api', method: 'POST' }, test: { input: { query: 'test' } } }, null, 2))}</textarea><button id="extReg" class="btn sm" style="margin-top:6px">${t('register')}</button><div id="extOut" class="small" style="margin-top:6px"></div></details></div>
    <div class="c6 panel glass corner"><h2>${t('failures_title')} <span class="right tag xs">${fails.total}</span></h2><div class="row xs">${Object.entries(fails.byKind).map(([k, n]) => `<span class="tag xs">${esc(k)}: ${n}</span>`).join('') || '<span class="empty">—</span>'}</div>
      <ul class="list" style="margin-top:8px">${fails.recent.map((f) => `<li class="small"><span class="tag ${f.kind === 'transient' ? 'warn' : 'bad'} xs">${esc(f.kind)}</span><span class="grow" dir="auto">${esc(f.message.slice(0, 120))}<div class="xs muted">${esc(he() ? f.recommendationHe : f.recommendation)}</div></span></li>`).join('')}</ul></div>
    <div class="c12 panel glass corner"><h2>${t('coverage_title')} <span class="right row">${Object.entries(cov.counts).map(([k, n]) => `<span class="tag ${stCls[k]} xs">${esc(k)}: ${n}</span>`).join('')}</span></h2>
      <div style="max-height:420px;overflow:auto"><table><tr><th>§</th><th>Capability</th><th>Status</th><th>Evidence</th></tr>${cov.rows.map((r) => `<tr><td class="xs mono">${esc(r.section)}</td><td class="small">${esc(r.capability)}</td><td><span class="tag ${stCls[r.status]} xs">${esc(r.label)}</span></td><td class="xs muted">${esc(r.evidence)}</td></tr>`).join('')}</table></div></div>`;
  const drawCaps = (items) => { $('#capList').innerHTML = items.map((c) => `<li class="small"><span class="dot ${c.availability === 'available' ? (c.health.status === 'degraded' ? 'warn' : 'ok') : 'bad'}"></span><span class="grow"><span class="mono xs">${esc(c.id)}</span> <span class="tag xs">${esc(String(c.permissions.risk))}</span>${c.source === 'extension' ? ' <span class="tag info xs">ext</span>' : ''}<div class="xs muted">${esc(c.description)} · ${esc(c.dependencies.join(', ') || 'no deps')} · v${esc(c.version)}${c.health.successPct != null ? ` · ${c.health.successPct}% ok` : ''}</div></span></li>`).join(''); };
  drawCaps((await api('/api/v1/brain/capabilities')).slice(0, 12));
  let tm; $('#capQ').oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => drawCaps(e.target.value ? await api(`/api/v1/brain/capabilities?q=${encodeURIComponent(e.target.value)}`) : (await api('/api/v1/brain/capabilities')).slice(0, 12)), 250); };
  $('#runEval').onclick = async () => { const b = $('#runEval'); b.disabled = true; b.textContent = t('working'); try { await api('/api/v1/brain/evaluations', { method: 'POST' }); } catch (err) { toast(err.message); } brainView(v); };
  $('#gwF').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries([...new FormData(e.target)].filter(([, x]) => x)); await api('/api/v1/brain/gateway/preferences', { method: 'PUT', body: f }); toast(t('saved')); };
  $('#extReg').onclick = async () => {
    let def; try { def = JSON.parse($('#extJson').value); } catch { return toast('JSON'); }
    try { const r = await api('/api/v1/brain/capabilities', { method: 'POST', body: def }); $('#extOut').innerHTML = `${r.checks.map((c) => `<div>${c.ok ? '✓' : '✕'} ${esc(c.name)} <span class="muted">${esc(c.note)}</span></div>`).join('')}<div><b>${esc(r.status)}</b>${r.status === 'pending_review' ? ` <button class="btn ok sm" id="extApprove">${t('approve')}</button>` : ''}</div>`;
      $('#extApprove')?.addEventListener('click', async () => { await api(`/api/v1/brain/capabilities/registrations/${r.id}/approve`, { method: 'POST' }); toast(t('saved')); brainView(v); }); } catch (err) { toast(err.message); }
  };
}

export const VIEWS = [
  ['sec_core'], ['command', '◉', command], ['conversation', '◍', conversation], ['map', '⌬', map], ['agents', '⎔', agents], ['brain', '🧠', brainView], ['missions', '◈', missionsView], ['ai', '✦', aiStudio], ['automations', '⟳', automations], ['knowledge', '⛁', knowledge],
  ['sec_life'], ['planner', '✓', planner], ['wealth', '₪', wealth], ['home', '⌂', home],
  ['sec_system'], ['devices', '⌚', devices], ['console', '⌨', consoleView], ['privacy', '⛨', privacy], ['preferences', '⚙', settings],
];
export { toggleListening };
