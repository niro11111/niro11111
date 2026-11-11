// Digital World Control Center. Every control calls the real /api/worlds endpoints; every status
// shown comes from execution results (build exit codes, test runs, HTTP verification, health checks).
import { api, esc, toast, $, $$, confirmDialog, auth } from './api.js';
import { getLang } from './i18n.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
const W = '/api/worlds';
let current = null; let tab = 'overview'; let wtab = 'pipeline';
const ST = { VERIFIED: 'ok', TESTED: 'ok', CONNECTED: 'ok', CONFIGURED: 'info', IMPLEMENTED: 'info', PLANNED: '', BLOCKED: 'warn', FAILED: 'bad', verified: 'ok', generated: 'info', specified: 'info', 'needs-input': 'warn', failed: 'bad', completed: 'ok', running: 'info', done: 'ok', pending: '', blocked: 'warn' };
const tag = (s, t = s) => `<span class="tag ${ST[s] ?? ''} xs">${esc(t)}</span>`;
const dt = (iso) => (iso ? esc(String(iso).slice(0, 16).replace('T', ' ')) : '–');
const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message); return null; } };
const post = (p, body = {}) => api(`${W}${p}`, { method: 'POST', body });
const PRESETS = [
  ['Business Builder', 'בונה עסקים', 'Build a complete digital business for handmade candles', 'תבנה עסק דיגיטלי שלם למכירת נרות בעבודת יד'],
  ['Website Builder', 'בונה אתרים', 'Create a website for my company called Blue Bay Dental', 'תבנה אתר לחברה בשם מרפאת שיניים כחול'],
  ['CRM', 'CRM', 'Build me a CRM system for my company called Acme Solar', 'תבנה מערכת CRM לחברה בשם אקמה סולאר'],
  ['Online store', 'חנות מקוונת', 'Create an online store named Green Leaf', 'תבנה חנות מקוונת בשם עלה ירוק'],
  ['Booking system', 'מערכת תורים', 'Build a booking system for a barber shop', 'תבנה מערכת תורים לעסק בשם מספרת דנה'],
  ['Custom data model', 'מבנה נתונים משלך', 'Build a system with customers (name, phone, email) and orders (customer, total, date)', 'תבנה מערכת עם לקוחות (שם, טלפון, אימייל) והזמנות (לקוח, סכום, תאריך)'],
];
const STAGE_HE = { understand: 'הבנה', architect: 'ארכיטקטורה', plan: 'תכנון', build: 'בנייה', integrate: 'אינטגרציה', test: 'בדיקות', deploy: 'פריסה', operate: 'הפעלה', improve: 'שיפור' };

export async function worldsView(v) {
  if (tab === 'world' && current) document.body.dataset.worldId = current; else delete document.body.dataset.worldId; // copilot context
  const ov = await api(W);
  const TABS = [['overview', 'Digital Worlds', 'עולמות דיגיטליים'], ['create', 'Create New World', 'יצירת עולם חדש'], ['integrations', 'Integration Center', 'מרכז אינטגרציות'], ['security', 'Security & Audit', 'אבטחה ותיעוד']];
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Digital World Engine', 'מנוע העולמות הדיגיטליים')} <span class="right row">${tag(ov.runtime.startsWith('browser') ? 'BLOCKED' : 'CONNECTED', ov.runtime)}</span></h2>
      <div class="row" role="tablist">${TABS.map(([id, en, h]) => `<button class="btn sm ${tab === id ? 'primary' : ''}" role="tab" aria-selected="${tab === id}" data-wt="${id}">${L(en, h)}</button>`).join('')}${current ? `<button class="btn sm ${tab === 'world' ? 'primary' : ''}" data-wt="world">◈ ${esc(ov.worlds.find((x) => x.id === current)?.title ?? '')}</button>` : ''}</div>
      ${ov.runtime.startsWith('browser') ? `<p class="xs warn" style="margin:8px 0 0">${L('This browser build designs and generates projects; real builds, tests and deployments need the JARVIS server (npm start) and are shown as BLOCKED here.', 'הגרסה הזו בדפדפן מאפיינת ומייצרת פרויקטים; בנייה, בדיקות ופריסה אמיתיות דורשות את שרת JARVIS (npm start) ומוצגות כאן כחסומות.')}</p>` : ''}</div>
    <div id="wBody" class="c12"></div></div>`;
  $$('[data-wt]', v).forEach((b) => { b.onclick = () => { tab = b.dataset.wt; worldsView(v); }; });
  const body = $('#wBody');
  const redraw = () => worldsView(v);
  const open = (id) => { current = id; tab = 'world'; wtab = 'pipeline'; worldsView(v); };
  if (tab === 'create') return createTab(body, open);
  if (tab === 'integrations') return integrationsTab(body);
  if (tab === 'security') return securityTab(body, ov);
  if (tab === 'world' && current) return worldTab(body, redraw);
  // ---------- overview ----------
  const T = ov.totals;
  body.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><div class="row">${[[L('worlds', 'עולמות'), T.worlds], [L('verified', 'מאומתים'), T.verified], [L('running', 'פועלים'), T.running], [L('open incidents', 'תקלות פתוחות'), T.openIncidents], [L('builds', 'בניות'), T.builds], [L('test runs', 'הרצות בדיקה'), T.testRuns]].map(([k, x]) => `<div class="stat-box"><div class="stat">${x}</div><div class="xs muted">${esc(k)}</div></div>`).join('')}<button id="wNew" class="right btn primary">＋ ${L('Create new world', 'יצירת עולם חדש')}</button></div></div>
    ${ov.worlds.map((w) => `<div class="c6 panel glass corner world-card" data-open="${w.id}" tabindex="0" role="button"><h2><span dir="auto">${esc(w.title)}</span> <span class="right row">${tag(w.status)}${w.preview?.running ? tag('CONNECTED', L('running', 'פועל')) : ''}${w.killed ? tag('BLOCKED', 'kill switch') : ''}</span></h2>
      <div class="xs muted">${esc(w.type)} · v${w.version} · ${dt(w.updatedAt ?? w.createdAt)}</div>
      <div class="stages">${Object.entries(w.stages ?? {}).map(([k, s]) => `<span class="stage ${ST[s.status] ?? ''}" title="${esc(`${k}: ${s.status} ${s.detail ?? ''}`)}">${esc(he() ? STAGE_HE[k] ?? k : k)}</span>`).join('')}</div>
      <div class="row xs">${Object.entries(w.featureCounts).map(([k, n]) => tag(k, `${k} ${n}`)).join('')}</div></div>`).join('') || `<div class="c12 panel glass"><p class="empty">${L('No digital worlds yet. Describe one in "Create New World", or just tell JARVIS: "Build me a CRM system".', 'אין עדיין עולמות דיגיטליים. תארו אחד ב"יצירת עולם חדש", או פשוט אמרו ל-JARVIS: "תבנה לי מערכת CRM".')}</p></div>`}</div>`;
  $('#wNew').onclick = () => { tab = 'create'; worldsView(v); };
  $$('[data-open]', body).forEach((c) => { c.onclick = () => open(c.dataset.open); c.onkeydown = (e) => { if (e.key === 'Enter') open(c.dataset.open); }; });
}

function createTab(el, open) {
  el.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><h2>${L('Describe what to build', 'תארו מה לבנות')}</h2>
    <form id="wF"><textarea name="text" dir="auto" rows="4" style="width:100%" required placeholder="${L('e.g. Build a booking system for my clinic with services, customers and appointments', 'למשל: תבנה מערכת תורים לקליניקה עם שירותים, לקוחות ותורים')}"></textarea>
    <div class="row" style="margin-top:8px"><label class="small"><input type="checkbox" name="run" checked> ${L('Run the full pipeline now (architecture → code → build → tests → verification)', 'להריץ עכשיו את כל הצינור (ארכיטקטורה ← קוד ← בנייה ← בדיקות ← אימות)')}</label>
      <label class="small"><input type="checkbox" name="ai"> ✦ ${L('Design the data model with AI (needs a model; the result is validated and marked "proposed by AI")', 'לתכנן את מבנה הנתונים עם AI (דורש מודל; התוצאה נבדקת ומסומנת "הוצע על ידי AI")')}</label><button class="btn primary right">◈ ${L('Create', 'צור')}</button></div></form>
    <h3 class="small" style="margin-top:14px">${L('Builders', 'בונים')}</h3><div class="row">${PRESETS.map(([en, h, pen, phe], i) => `<button class="btn sm" data-pre="${i}" title="${esc(he() ? phe : pen)}">${esc(L(en, h))}</button>`).join('')}</div>
    <p class="xs muted" style="margin-top:10px">${L('JARVIS never invents requirements: if the request is unclear it asks one question; template-based parts are listed as assumptions you can edit.', 'JARVIS לא ממציא דרישות: אם הבקשה לא ברורה הוא שואל שאלה אחת; חלקים שמבוססים על תבנית מוצגים כהנחות שאפשר לערוך.')}</p></div></div>`;
  $$('[data-pre]', el).forEach((b) => { b.onclick = () => { const p = PRESETS[Number(b.dataset.pre)]; $('#wF').text.value = he() ? p[3] : p[2]; }; });
  $('#wF').onsubmit = async (e) => { e.preventDefault(); const btn = e.target.querySelector('button.primary'); btn.disabled = true; const w = await act(() => api(W, { method: 'POST', body: { text: e.target.text.value, run: e.target.run.checked, ai: e.target.ai.checked, lang: getLang() } })); btn.disabled = false; if (w) open(w.id); };
}

async function integrationsTab(el) {
  const draw = async (verify = false) => {
    const list = await api(`${W}/integrations${verify ? '?verify=1' : ''}`);
    el.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><h2>${L('Integration Center', 'מרכז אינטגרציות')} <button id="iVer" class="right btn sm">✓ ${L('Verify connections', 'אמת חיבורים')}</button></h2>
      <p class="xs muted">${L('Statuses come from real checks. Credentials are entered on the JARVIS server (environment or secrets), never in the browser or in generated code, and are never faked.', 'הסטטוסים מגיעים מבדיקות אמיתיות. פרטי גישה מוזנים בשרת JARVIS (משתני סביבה או סודות), אף פעם לא בדפדפן או בקוד שנוצר, ואף פעם לא מזויפים.')}</p>
      <table>${list.map((i) => `<tr><td>${tag(i.status)}</td><td class="small">${esc(i.name)}</td><td class="xs muted">${esc(i.detail)}</td></tr>`).join('')}</table></div></div>`;
    $('#iVer').onclick = () => draw(true);
  };
  await draw();
}

function securityTab(el, ov) {
  el.innerHTML = `<div class="grid"><div class="c6 panel glass corner"><h2>${L('Isolation and limits', 'בידוד ומגבלות')}</h2><ul class="list">${[
    L('One workspace directory per world and version; paths are checked (no traversal).', 'תיקיית עבודה נפרדת לכל עולם וגרסה; נתיבים נבדקים (אין חריגה).'),
    L('Builds, tests and previews run as child processes with only PATH/NODE_ENV/HOME/TMPDIR: JARVIS secrets are never passed.', 'בנייה, בדיקות ותצוגות רצות כתהליכי-בן עם PATH/NODE_ENV/HOME/TMPDIR בלבד: סודות JARVIS לא מועברים.'),
    L('Hard timeouts (tests 120 s, start 10 s) and output caps; apps bind to 127.0.0.1.', 'מגבלות זמן קשיחות (בדיקות 120 שנ׳, עלייה 10 שנ׳) ותקרת פלט; אפליקציות מאזינות ל-127.0.0.1 בלבד.'),
    L('Each world gets its own admin token, stored on the JARVIS server only.', 'לכל עולם אסימון מנהל משלו, שנשמר רק בשרת JARVIS.'),
    L('Only the owner can create, run, deploy, stop or kill worlds; device tokens are refused.', 'רק הבעלים יכול ליצור, להריץ, לפרוס, לעצור או להפעיל מתג חירום; אסימוני מכשירים נדחים.'),
    L('Cloud and container deployment stay BLOCKED until a provider and a deployment policy are configured.', 'פריסה לענן ולקונטיינר נשארת חסומה עד שמוגדרים ספק ומדיניות פריסה.'),
    L('Daily budget per world (pipeline runs) and a kill switch per world.', 'תקציב יומי לכל עולם (הרצות צינור) ומתג חירום לכל עולם.'),
  ].map((x) => `<li class="small">⛨ ${esc(x)}</li>`).join('')}</ul></div>
  <div class="c6 panel glass corner"><h2>${L('Worlds', 'עולמות')}</h2><table>${ov.worlds.map((w) => `<tr><td class="small" dir="auto">${esc(w.title)}</td><td>${w.killed ? tag('BLOCKED', 'kill switch') : tag(w.status)}</td><td>${w.killed ? `<button class="btn sm" data-rel="${w.id}">${L('Release', 'שחרר')}</button>` : `<button class="btn danger sm" data-kill="${w.id}">⏻ ${L('Kill switch', 'מתג חירום')}</button>`}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div>`;
  $$('[data-kill]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L('Stop everything for this world (processes, mission) and block further runs?', 'לעצור הכל בעולם הזה (תהליכים, משימה) ולחסום הרצות נוספות?'), { danger: true }))) return; await act(() => post(`/${b.dataset.kill}/kill`), L('Stopped', 'נעצר')); securityTab(el, { ...ov, worlds: ov.worlds.map((w) => (w.id === b.dataset.kill ? { ...w, killed: true } : w)) }); }; });
  $$('[data-rel]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/${b.dataset.rel}/kill`, { release: true }), L('Released', 'שוחרר')); securityTab(el, { ...ov, worlds: ov.worlds.map((w) => (w.id === b.dataset.rel ? { ...w, killed: false } : w)) }); }; });
}

async function worldTab(el, redraw) {
  const d = await api(`${W}/${current}`);
  const w = d.world;
  const TABS = [['pipeline', 'Pipeline', 'צינור'], ['spec', 'Architect', 'אפיון וארכיטקטורה'], ['code', 'Code', 'קוד'], ['tests', 'Build & tests', 'בנייה ובדיקות'], ['deploy', 'Deploy & monitor', 'פריסה וניטור'], ['audit', 'Activity', 'פעילות']];
  const running = !['verified', 'failed', 'generated', 'needs-input', 'specified'].includes(w.status) || d.mission?.status === 'running';
  el.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><h2><span dir="auto">${esc(w.title)}</span> <span class="right row">${tag(w.status)} <span class="tag xs">v${w.version}</span>
      ${w.status !== 'needs-input' ? `<button id="wRun" class="btn primary sm">▶ ${L('Run pipeline', 'הרץ צינור')}</button>` : ''}<button id="wArch" class="btn danger sm" aria-label="archive">🗑</button></span></h2>
      <div class="xs muted" dir="auto">${esc(w.request)}</div>
      <div class="row" role="tablist" style="margin-top:8px">${TABS.map(([id, en, h]) => `<button class="btn sm ${wtab === id ? 'primary' : ''}" data-wtab="${id}">${L(en, h)}</button>`).join('')}</div></div>
    <div id="wtBody" class="c12"></div></div>`;
  $$('[data-wtab]', el).forEach((b) => { b.onclick = () => { wtab = b.dataset.wtab; worldTab(el, redraw); }; });
  $('#wRun')?.addEventListener('click', async () => { const b = $('#wRun'); b.disabled = true; b.textContent = '…'; await act(() => post(`/${w.id}/run`, { wait: true }), L('Pipeline finished', 'הצינור הסתיים')); worldTab(el, redraw); });
  $('#wArch').onclick = async () => { if (!(await confirmDialog(L('Archive this world? Running processes stop.', 'להעביר לארכיון? תהליכים פעילים ייעצרו.'), { danger: true }))) return; await act(() => api(`${W}/${w.id}`, { method: 'DELETE' })); current = null; redraw(); };
  const b = $('#wtBody');
  if (wtab === 'pipeline') {
    b.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><h2>${L('Stages', 'שלבים')}</h2><div class="pipeline">${Object.entries(w.stages).map(([k, s]) => `<div class="pstage ${ST[s.status] ?? ''}"><b>${esc(he() ? STAGE_HE[k] ?? k : k)}</b>${tag(s.status)}<div class="xs muted" dir="auto">${esc(s.detail ?? '')}</div></div>`).join('')}</div>
      ${w.status === 'needs-input' ? `<form id="clF" class="row" style="margin-top:10px"><span class="small warn" dir="auto">${esc(w.spec.question)}</span><input name="a" class="grow" dir="auto" required aria-label="answer"><button class="btn primary sm">${L('Answer', 'ענה')}</button></form>` : ''}</div>
      <div class="c7 panel glass corner"><h2>${L('Features (honest status)', 'יכולות (סטטוס אמיתי)')}</h2><table>${(w.features ?? []).map((f) => `<tr><td>${tag(f.status)}</td><td class="small">${esc(f.name)}</td><td class="xs muted">${esc(f.evidence ?? '')}</td></tr>`).join('') || `<tr><td class="empty">${L('Nothing implemented yet.', 'עוד לא מומש דבר.')}</td></tr>`}</table>
        <p class="xs muted">${d.statuses.map((x) => tag(x)).join(' ')}</p></div>
      <div class="c5 panel glass corner"><h2>${L('Mission and agents', 'משימה וסוכנים')}</h2>${d.mission ? `<div class="small">${tag(d.mission.status)} <span class="mono xs">${esc(d.mission.id)}</span></div><ul class="list">${d.mission.tasks.map((t) => `<li class="small">${tag(t.status)}<span class="grow">${esc(t.title)}<div class="xs muted">${esc(t.agent)} · ${esc(t.tool ?? '')}${t.result ? ` · ${esc(String(t.result).slice(0, 120))}` : ''}</div></span></li>`).join('')}</ul>` : `<p class="empty">${L('No mission yet: press "Run pipeline".', 'אין עדיין משימה: לחצו "הרץ צינור".')}</p>`}
        <h3 class="small">${L('Usage and budget', 'שימוש ותקציב')}</h3><div class="kv small"><span class="muted">${L('pipeline runs', 'הרצות צינור')}</span><span>${w.usage.pipelineRuns} / ${w.budget.maxPipelineRunsPerDay} ${L('per day', 'ליום')}</span><span class="muted">build</span><span>${w.usage.buildMs} ms</span><span class="muted">tests</span><span>${w.usage.testMs} ms</span><span class="muted">${L('AI model calls', 'קריאות מודל')}</span><span>${w.usage.modelCalls}</span></div></div></div>`;
    $('#clF')?.addEventListener('submit', async (e) => { e.preventDefault(); await act(() => post(`/${w.id}/clarify`, { answer: e.target.a.value })); worldTab(el, redraw); });
    if (running && d.mission) setTimeout(() => { if (wtab === 'pipeline' && document.getElementById('wtBody')) worldTab(el, redraw); }, 1500);
  } else if (wtab === 'spec') {
    const A = w.architecture;
    b.innerHTML = `<div class="grid"><div class="c6 panel glass corner"><h2>${L('Specification', 'אפיון')}</h2>
      ${w.spec.templateLabel ? `<p class="xs muted">${L('Template', 'תבנית')}: ${esc(w.spec.templateLabel)}</p>` : ''}
      <h3 class="small">${L('Requirements', 'דרישות')}</h3><ul class="list">${(w.spec.requirements ?? []).map((r) => `<li class="small" dir="auto">${esc(r)}</li>`).join('')}</ul>
      <h3 class="small">${L('Assumptions (editable)', 'הנחות (ניתן לשנות)')}</h3><ul class="list">${(w.spec.assumptions ?? []).map((r) => `<li class="small warn" dir="auto">${esc(r)}</li>`).join('')}</ul>
      ${w.spec.openQuestions?.length ? `<h3 class="small">${L('Open questions', 'שאלות פתוחות')}</h3><ul class="list">${w.spec.openQuestions.map((r) => `<li class="small" dir="auto">${esc(r)}</li>`).join('')}</ul>` : ''}
      <h3 class="small">${L('Data model (JSON, edit and save to create a new version)', 'מבנה נתונים (JSON, ערכו ושמרו ליצירת גרסה חדשה)')}</h3>
      <textarea id="specJ" dir="ltr" rows="12" style="width:100%">${esc(JSON.stringify(w.spec.entities, null, 1))}</textarea><button id="specS" class="btn sm">💾 ${L('Save as new version', 'שמור כגרסה חדשה')}</button></div>
    <div class="c6 panel glass corner"><h2>${L('Architecture', 'ארכיטקטורה')} ${A ? '' : `<button id="arch" class="right btn sm">${L('Design', 'תכנן')}</button>`}</h2>${A ? `<p class="small">${esc(A.style)}</p>
      <table>${A.components.map((c) => `<tr><td class="xs mono">${esc(c.name)}</td><td class="xs">${esc(c.role)}</td></tr>`).join('')}</table>
      <h3 class="small">${L('Database', 'מסד נתונים')}</h3>${A.database.map((t) => `<details><summary class="xs mono">${esc(t.table)} (${t.columns.length})</summary><table>${t.columns.map((c) => `<tr><td class="xs mono">${esc(c.name)}</td><td class="xs">${esc(c.type)}${c.required ? ' *' : ''}</td></tr>`).join('')}</table></details>`).join('')}
      <h3 class="small">API</h3><div style="max-height:220px;overflow:auto"><table>${A.api.map((x) => `<tr><td class="xs mono">${esc(x.method)}</td><td class="xs mono" dir="ltr">${esc(x.path)}</td><td class="xs">${esc(x.auth)}</td></tr>`).join('')}</table></div>
      <h3 class="small">${L('Security', 'אבטחה')}</h3><ul class="list">${A.security.map((x) => `<li class="xs">⛨ ${esc(x)}</li>`).join('')}</ul>
      <h3 class="small">${L('Deployment and testing', 'פריסה ובדיקות')}</h3><ul class="list">${[...A.deployment.map((x) => `${x.target}: ${x.how}`), ...A.testing].map((x) => `<li class="xs">${esc(x)}</li>`).join('')}</ul>` : `<p class="empty">${L('Not designed yet.', 'עוד לא תוכנן.')}</p>`}</div></div>`;
    $('#arch')?.addEventListener('click', async () => { await act(() => post(`/${w.id}/architect`)); worldTab(el, redraw); });
    $('#specS').onclick = async () => { let ents; try { ents = JSON.parse($('#specJ').value); } catch { return toast('JSON'); } const r = await act(() => api(`${W}/${w.id}/spec`, { method: 'PUT', body: { entities: ents, reason: 'edited in the Project Architect' } }), L('Saved as a new version', 'נשמר כגרסה חדשה')); if (r) worldTab(el, redraw); };
  } else if (wtab === 'code') {
    b.innerHTML = `<div class="grid"><div class="c4 panel glass corner"><h2>${L('Files', 'קבצים')} <span class="right xs muted">v${w.version}</span></h2><ul class="list">${d.files.map((f) => `<li class="small"><button class="btn sm grow" data-file="${esc(f.path)}" style="text-align:start">${esc(f.path)}</button><span class="xs muted">${f.bytes} B</span></li>`).join('') || `<li class="empty">${L('Not generated yet.', 'עוד לא נוצר.')}</li>`}</ul>
      ${d.artifacts[0] ? `<p class="small">📦 ${esc(d.artifacts[0].file)} · <span class="mono xs">sha256 ${esc(d.artifacts[0].sha256.slice(0, 16))}…</span><br><a class="btn sm" href="${W}/${w.id}/artifact?token=${encodeURIComponent(auth.get() ?? '')}" download>⬇ ${L('Download artifact', 'הורדת חבילה')}</a></p>` : ''}</div>
      <div class="c8 panel glass corner"><h2 id="fName">—</h2><pre id="fBody" class="xs" dir="ltr" style="white-space:pre;overflow:auto;max-height:560px"></pre></div></div>`;
    $$('[data-file]', b).forEach((x) => { x.onclick = async () => { const f = await act(() => api(`${W}/${w.id}/file?path=${encodeURIComponent(x.dataset.file)}`)); if (f) { $('#fName').textContent = f.path; $('#fBody').textContent = f.content; } }; });
  } else if (wtab === 'tests') {
    const tr = d.testRuns[0]; const bd = d.builds[0]; const vf = d.verifications[0];
    b.innerHTML = `<div class="grid"><div class="c4 panel glass corner"><h2>${L('Build', 'בנייה')} ${bd ? tag(bd.ok ? 'VERIFIED' : 'FAILED') : ''}<button id="bB" class="right btn sm">▶</button></h2>${bd ? `<ul class="list">${bd.steps.map((x) => `<li class="xs">${x.ok ? '✓' : '✕'} <span class="grow">${esc(x.name)}</span><span class="muted">${esc(String(x.detail ?? '').slice(0, 80))}</span></li>`).join('')}</ul><div class="xs muted">${bd.ms} ms · ${dt(bd.at)}</div>` : `<p class="empty">—</p>`}</div>
      <div class="c4 panel glass corner"><h2>${L('Tests', 'בדיקות')} ${tr ? tag(tr.ok ? 'VERIFIED' : 'FAILED', `${tr.passed}/${tr.total}`) : ''}<button id="bT" class="right btn sm">▶</button></h2>${tr ? `<ul class="list">${tr.cases.map((c) => `<li class="xs">${c.pass ? '✓' : '✕'} ${esc(c.name)}</li>`).join('')}</ul><div class="xs muted">${tr.durationMs} ms · ${dt(tr.at)}</div><button id="tOut" class="btn sm">${L('Show output', 'הצג פלט')}</button>` : `<p class="empty">—</p>`}</div>
      <div class="c4 panel glass corner"><h2>${L('Live verification', 'אימות חי')} ${vf ? tag(vf.ok ? 'VERIFIED' : 'FAILED') : ''}<button id="bV" class="right btn sm">▶</button></h2>${vf ? `<ul class="list">${vf.checks.map((c) => `<li class="xs">${c.ok ? '✓' : '✕'} <span class="grow">${esc(c.name)}</span><span class="muted">${esc(String(c.detail ?? '').slice(0, 60))}</span></li>`).join('')}</ul>` : `<p class="empty">—</p>`}</div>
      <div class="c12"><pre id="tBody" class="xs panel glass" dir="ltr" style="display:none;white-space:pre-wrap;max-height:400px;overflow:auto"></pre></div></div>`;
    const step = (id, p) => $(id)?.addEventListener('click', async () => { await act(() => post(`/${w.id}/${p}`)); worldTab(el, redraw); });
    step('#bB', 'build'); step('#bT', 'test'); step('#bV', 'verify');
    $('#tOut')?.addEventListener('click', async () => { const t = await act(() => api(`${W}/${w.id}/tests/${tr.id}`)); if (t) { $('#tBody').style.display = 'block'; $('#tBody').textContent = t.output; } });
  } else if (wtab === 'deploy') {
    b.innerHTML = `<div class="grid"><div class="c6 panel glass corner"><h2>${L('Deployment Center', 'מרכז פריסה')}</h2>
      <div class="row">${d.preview?.running ? `<a class="btn ok sm" dir="ltr" href="${esc(d.preview.url)}" target="_blank" rel="noopener">↗ ${esc(d.preview.url)}</a><button id="dStop" class="btn danger sm">■ ${L('Stop', 'עצור')}</button>` : `<button class="btn primary sm" data-dep="local-preview">▶ ${L('Deploy to local preview', 'פריסה לתצוגה מקומית')}</button>`}<button class="btn sm" data-dep="docker">🐳 Docker</button><button class="btn sm" data-dep="cloud">☁ ${L('Cloud', 'ענן')}</button></div>
      <table style="margin-top:8px">${d.deployments.map((x) => `<tr><td>${tag(x.status)}</td><td class="xs mono">${esc(x.target)}</td><td class="xs">v${x.version}</td><td class="xs muted" dir="${x.url ? 'ltr' : 'auto'}">${esc(x.url ?? x.detail ?? '')}</td><td class="xs">${dt(x.at)}</td></tr>`).join('') || `<tr><td class="empty">${L('No deployments.', 'אין פריסות.')}</td></tr>`}</table></div>
    <div class="c6 panel glass corner"><h2>${L('Monitoring', 'ניטור')} <button id="hc" class="right btn sm">♥ ${L('Health check', 'בדיקת בריאות')}</button></h2>
      <table>${d.health.map((h) => `<tr><td>${tag(h.ok ? 'CONNECTED' : 'FAILED', h.status)}</td><td class="xs">${h.latencyMs ?? '–'} ms</td><td class="xs">${h.metrics ? `${h.metrics.requests} req · ${h.metrics.errors} err · ${Object.entries(h.metrics.records ?? {}).map(([k, n]) => `${k}:${n}`).join(' ')}` : esc(h.detail ?? '')}</td><td class="xs">${dt(h.at)}</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</table>
      <h3 class="small">${L('Incidents', 'תקלות')}</h3><ul class="list">${d.incidents.map((i) => `<li class="small">${tag(i.severity === 'high' ? 'FAILED' : 'BLOCKED', i.stage)}<span class="grow">${esc(i.title)}<div class="xs muted">${esc(i.diagnosis)}</div><div class="xs">💡 ${esc(i.remediation)}</div></span></li>`).join('') || `<li class="empty">${L('No incidents.', 'אין תקלות.')}</li>`}</ul>
      <h3 class="small">${L('Logs', 'יומן')}</h3><pre class="xs" dir="ltr" style="max-height:200px;overflow:auto;white-space:pre-wrap">${esc(d.logs.map((l) => `${l.at.slice(11, 19)} ${l.stream} ${l.line}`).join('\n') || '—')}</pre></div></div>`;
    $$('[data-dep]', b).forEach((x) => { x.onclick = async () => { const r = await act(() => post(`/${w.id}/deploy`, { target: x.dataset.dep })); if (r) toast(`${r.target}: ${r.status}${r.detail ? ` · ${r.detail}` : ''}`); worldTab(el, redraw); }; });
    $('#dStop')?.addEventListener('click', async () => { await act(() => post(`/${w.id}/stop`)); worldTab(el, redraw); });
    $('#hc').onclick = async () => { await act(() => post(`/${w.id}/health`)); worldTab(el, redraw); };
  } else {
    b.innerHTML = `<div class="grid"><div class="c8 panel glass corner"><h2>${L('Activity and audit', 'פעילות ותיעוד')}</h2><table>${d.audit.map((a) => `<tr><td class="xs mono">${dt(a.at)}</td><td class="xs mono">${esc(a.action)}</td><td class="xs">${esc(a.actor)}</td><td class="xs muted mono" dir="ltr">${esc(JSON.stringify(a.detail).slice(0, 120))}</td></tr>`).join('')}</table></div>
      <div class="c4 panel glass corner"><h2>${L('Versions', 'גרסאות')}</h2><ul class="list">${d.versions.map((x) => `<li class="small"><span class="tag xs">v${x.version}</span><span class="grow" dir="auto">${esc(x.reason)}</span><span class="xs muted">${dt(x.at)}</span></li>`).join('')}</ul></div></div>`;
  }
}
