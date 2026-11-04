// Self-Improvement dashboard. Screens (per spec):
// A Intelligence Overview · B Model Intelligence · C Agent Intelligence · D Learning Center
// E Development Lab · F Improvement History · G Security Monitor
import { api, esc, toast, $, $$, confirmDialog, promptDialog } from './api.js';
import { getLang } from './i18n.js';
import { lineChart, gauge } from './charts.js';
import { coreHTML } from './core.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
const B = '/api/v1/learning';
let tab = 'A';
const TABS = [['A', 'Intelligence Overview', 'סקירת אינטליגנציה'], ['B', 'Model Intelligence', 'אינטליגנציית מודלים'], ['C', 'Agent Intelligence', 'אינטליגנציית סוכנים'], ['D', 'Learning Center', 'מרכז למידה'], ['E', 'Development Lab', 'מעבדת פיתוח'], ['F', 'Improvement History', 'היסטוריית שיפורים'], ['G', 'Security Monitor', 'ניטור אבטחה']];
const ST = { proposed: 'info', testing: 'warn', tested: 'ok', 'failed-test': 'bad', approved: 'ok', deployed: 'ok', rejected: '', rolled_back: 'warn', open: 'warn', resolved: 'ok', dismissed: '', 'recurring-after-fix': 'bad', active: 'ok', superseded: '', likely: 'ok', 'insufficient-evidence': 'warn', fresh: 'ok', stale: 'warn', missing: 'bad', expiring: 'warn', info: 'info', good: 'ok', watch: 'warn', 'needs-attention': 'bad', 'insufficient-data': '', pending: 'warn', pass: 'ok', regression: 'bad', 'ready-for-review': 'ok', blocked: 'bad', 'tests-failed': 'bad', 'tests-blocked': 'warn', installed: 'ok', draft: 'info', 'needs-code': '', measured: 'ok', unavailable: '', recommendation: 'ok', high: 'warn', normal: '', low: '' };
const tag = (s, txt = s) => `<span class="tag ${ST[s] ?? ''} xs">${esc(txt)}</span>`;
const dt = (iso) => (iso ? esc(String(iso).slice(0, 16).replace('T', ' ')) : '–');
const nz = (x) => (x ?? '–');
const empty = (t) => `<li class="empty">${t}</li>`;
const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message); return null; } };
const post = (p, body = {}) => api(`${B}${p}`, { method: 'POST', body });

export async function learnView(v) {
  const d = await api(`${B}/dashboard`);
  const m = d.mode.modes[d.mode.current - 1];
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Self-improvement', 'שיפור עצמי')} <span class="right row">${tag('info', `${L('mode', 'מצב')} ${d.mode.current} · ${he() ? m.nameHe : m.name}`)}<button id="lCycle" class="btn primary sm">⟳ ${L('Run improvement cycle', 'הרץ מחזור שיפור')}</button></span></h2>
      <div class="row" role="tablist">${TABS.map(([id, en, h]) => `<button class="btn sm ${tab === id ? 'primary' : ''}" role="tab" aria-selected="${tab === id}" data-ltab="${id}">${id} · ${L(en, h)}</button>`).join('')}</div></div>
    <div id="lBody" class="c12"></div></div>`;
  $$('[data-ltab]', v).forEach((b) => { b.onclick = () => { tab = b.dataset.ltab; learnView(v); }; });
  $('#lCycle').onclick = async () => { const b = $('#lCycle'); b.disabled = true; b.textContent = '…'; const r = await act(() => post('/cycle')); if (r) toast(L(`${r.patterns} recurring pattern(s), ${r.tested} experiment(s)`, `${r.patterns} דפוסים חוזרים, ${r.tested} ניסויים`)); learnView(v); };
  const redraw = () => learnView(v);
  await ({ A: overview, B: models, C: agents, D: learning, E: lab, F: history, G: security })[tab]($('#lBody'), d, redraw);
}

// ---------- shared: proposal list with the full lifecycle ----------
function proposalItems(list) {
  return list.map((p) => `<li class="small" style="align-items:flex-start"><span class="grow"><div class="row">${tag(p.status)}<b dir="auto">${esc(he() ? p.changeHe : p.change)}</b>${p.systemChange ? tag('info', L('system change', 'שינוי מערכת')) : tag('', L('personalization', 'התאמה אישית'))}<span class="tag xs">${L('risk', 'סיכון')} ${esc(p.risk)}</span></div>
    <div class="xs muted" dir="auto">${esc(he() ? p.rationaleHe : p.rationale)}</div><div class="xs mono muted">${esc(p.target)} · ${esc(p.createdBy)} · ${dt(p.at)}</div></span>
    <span class="row">${['proposed', 'failed-test'].includes(p.status) ? `<button class="btn sm" data-pexp="${p.id}">🧪 ${L('Test in sandbox', 'בדוק בסביבה מבודדת')}</button>` : ''}${p.experimentId ? `<button class="btn sm" data-prep="${p.experimentId}">${L('Report', 'דוח')}</button>` : ''}${p.status === 'tested' ? `<button class="btn ok sm" data-pok="${p.id}">✓ ${L('Approve', 'אשר')}</button>` : ''}${p.status === 'approved' ? `<button class="btn ok sm" data-pdep="${p.id}">🚀 ${L('Deploy', 'פרוס')}</button>` : ''}${!['deployed', 'rejected', 'rolled_back'].includes(p.status) ? `<button class="btn danger sm" data-pno="${p.id}">${L('Reject', 'דחה')}</button>` : ''}</span></li>`).join('') || empty(L('No proposals. They appear when a recurring problem has a supported cause.', 'אין הצעות. הן מופיעות כשלבעיה חוזרת יש סיבה נתמכת.'));
}
async function showReport(box, id) {
  const e = await api(`${B}/experiments/${id}`);
  const R = e.report;
  box.innerHTML = `<div class="panel glass corner"><h2>${L('Evaluation report', 'דוח הערכה')} ${tag(e.verdict)} <span class="right xs muted">${esc(e.environment)}</span></h2>
    ${e.reasons?.length ? `<p class="small err">${esc(e.reasons.join(' · '))}</p>` : `<p class="small">${L('No regressions: every case that passed before still passes.', 'אין נסיגות: כל מקרה שעבר קודם עדיין עובר.')}</p>`}
    ${R ? `<div class="row xs">${Object.entries(R.metrics).map(([k, m]) => `<span class="tag xs" dir="ltr">${esc(k)}: ${esc(nz(m.baseline))} → ${esc(nz(m.candidate))}</span>`).join('')}</div>
    <div class="row xs" style="margin-top:6px">${Object.entries(R.categories ?? {}).map(([k, c]) => `<span class="tag ${c.candidate.pass < c.baseline.pass ? 'bad' : c.candidate.pass > c.baseline.pass ? 'ok' : ''} xs" dir="ltr">${esc(k)} ${c.baseline.pass}/${c.baseline.total} → ${c.candidate.pass}/${c.candidate.total}</span>`).join('')}</div>
    <div style="max-height:340px;overflow:auto;margin-top:8px"><table><tr><th>case</th><th>${L('current', 'נוכחי')}</th><th>${L('candidate', 'מועמד')}</th><th></th><th></th></tr>${(R.rows ?? []).map((r) => `<tr><td class="xs mono" dir="auto">${esc(r.id)}</td><td>${r.baseline == null ? '–' : r.baseline ? '✓' : '✕'}</td><td>${r.candidate ? '✓' : '✕'}</td><td>${r.change === 'regressed' ? tag('regression', L('regressed', 'נסוג')) : r.change === 'improved' ? tag('pass', L('improved', 'השתפר')) : ''}</td><td class="xs muted" dir="auto">${esc(r.candidateDetail ?? '')}</td></tr>`).join('')}</table></div>` : ''}
    ${e.checks?.length ? `<ul class="list">${e.checks.map((c) => `<li class="xs">${c.pass === null ? 'ⓘ' : c.pass ? '✓' : '✕'} ${esc(c.check)}${c.note ? ` <span class="muted">${esc(c.note)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function wireProposals(el, redraw, repBox) {
  $$('[data-prep]', el).forEach((b) => { b.onclick = () => showReport(repBox, b.dataset.prep); });
  $$('[data-pexp]', el).forEach((b) => { b.onclick = async () => { b.disabled = true; b.textContent = '…'; const e = await act(() => post(`/proposals/${b.dataset.pexp}/experiment`)); if (e) toast(e.verdict); redraw(); }; });
  $$('[data-pok]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L('Approve and deploy this change now? The previous version is kept and can be restored.', 'לאשר ולפרוס את השינוי עכשיו? הגרסה הקודמת נשמרת ואפשר לשחזר אותה.')))) return; await act(() => post(`/proposals/${b.dataset.pok}/approve`, { deploy: true }), L('Deployed', 'נפרס')); redraw(); }; });
  $$('[data-pdep]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/proposals/${b.dataset.pdep}/deploy`), L('Deployed', 'נפרס')); redraw(); }; });
  $$('[data-pno]', el).forEach((b) => { b.onclick = async () => { const reason = await promptDialog(L('Reason (optional)', 'סיבה (לא חובה)'), ''); if (reason === null) return; await act(() => post(`/proposals/${b.dataset.pno}/reject`, { reason })); redraw(); }; });
}
function suggestionItems(list) {
  return list.map((s) => `<li class="small" style="align-items:flex-start">${tag(s.priority, s.kind)}<span class="grow" dir="auto"><b>${esc(he() ? s.titleHe ?? s.title : s.title)}</b>
    <div class="xs"><span class="muted">${L('Detected', 'זוהה')}:</span> ${esc(he() ? s.detectedHe ?? s.detected : s.detected)}</div>
    <div class="xs"><span class="muted">${L('Why it matters', 'למה זה חשוב')}:</span> ${esc(he() ? s.whyHe ?? s.why : s.why)}</div>
    ${s.benefit ? `<div class="xs"><span class="muted">${L('Expected benefit', 'תועלת צפויה')}:</span> ${esc(he() ? s.benefitHe || s.benefit : s.benefit)}</div>` : ''}
    <div class="xs muted">${L('Risk', 'סיכון')}: ${esc(s.risk)} · ${s.approvalRequired ? L('needs your approval', 'דורש את אישורך') : L('no approval needed', 'לא דורש אישור')}</div></span>
    ${['proposal', 'profile', 'fwos', 'automation', 'rollback'].includes(s.kind) || s.ref === 'brain.evaluation' ? `<button class="btn ok sm" data-sa="approve" data-sid="${esc(s.id)}">✓</button>` : ''}<button class="btn sm" data-sa="postpone" data-sid="${esc(s.id)}" title="${L('Postpone a week', 'דחה בשבוע')}">⏰</button><button class="btn sm" data-sa="dismiss" data-sid="${esc(s.id)}" aria-label="${L('Dismiss', 'התעלם')}">✕</button></li>`).join('') || empty(L('Nothing to improve right now.', 'אין מה לשפר כרגע.'));
}
const wireSuggestions = (el, redraw) => $$('[data-sa]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/suggestions/${encodeURIComponent(b.dataset.sid)}/${b.dataset.sa}`), L('Done', 'בוצע')); redraw(); }; });

// ---------- A: Intelligence Overview ----------
async function overview(el, d, redraw) {
  const [agentsList, devs] = await Promise.all([api('/api/agents'), api('/api/devices').catch(() => [])]);
  const draw = async (q = 'days=14') => {
    const p = await api(`${B}/performance?${q}`);
    const T = p.totals;
    $('#perfOut').innerHTML = `<div class="row xs" style="margin:4px 0 8px">${[['avg ms', T.avgMs], ['p95 ms', T.p95Ms], [L('clarifications %', 'הבהרות %'), T.clarificationPct], [L('model calls', 'קריאות מודל'), T.modelCalls], [L('model errors %', 'שגיאות מודל %'), T.modelErrorPct], ['USD', T.costUsd], [L('feedback', 'משוב'), T.feedback]].map(([k, x]) => `<span class="tag xs">${esc(k)}: ${esc(nz(x))}</span>`).join('')}</div>
      ${lineChart(p.series.map((s) => ({ ...s, successPct: s.successPct ?? 0, satisfactionPct: s.satisfactionPct ?? 0 })), { keys: ['successPct', 'satisfactionPct'], colors: ['#22e08a', '#8a6cff'], labels: (s) => s.day.slice(5), fmt: (x) => `${Math.round(x)}%`, max: 100 })}
      ${lineChart(p.series, { keys: ['tasks', 'failed'], colors: ['#2ee6ff', '#ff5d6c'], labels: (s) => s.day.slice(5), fmt: (x) => (x < 10 ? x.toFixed(1) : Math.round(x)), max: Math.max(4, ...p.series.map((x) => x.tasks)) * 1.15 })}
      <div class="grid" style="margin-top:8px">${[['byTool', L('By capability', 'לפי יכולת')], ['byAgent', L('By agent', 'לפי סוכן')], ['byKind', L('By mission type', 'לפי סוג משימה')], ['byChannel', L('By application', 'לפי אפליקציה')]].map(([k, title]) => `<div class="c3"><h3 class="small">${title}</h3><table>${p[k].slice(0, 6).map((x) => `<tr><td class="xs mono">${esc(x.key)}</td><td class="xs">${x.tasks}</td><td class="xs">${x.successPct == null ? '–' : `${x.successPct}%`}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>`).join('')}</div>`;
  };
  const sel = (name, label, opts) => `<label>${label} <select name="${name}"><option value="">${L('all', 'הכל')}</option>${opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`;
  el.innerHTML = `<div class="grid">
    <div class="c4 panel glass corner learn-core"><div class="lc-core">${coreHTML({ mini: true, label: false })}</div><div class="gauges">${d.scorecards.map((c) => gauge(c.value ?? 0, { label: he() ? c.labelHe : c.label, suffix: c.suffix ?? '%', max: c.suffix === '' ? Math.max(10, c.value ?? 0) : 100, color: c.id === 'security' ? 'var(--amber)' : c.id === 'satisfaction' ? 'var(--violet)' : 'var(--cyan)' })).join('')}</div></div>
    <div class="c8 panel glass corner"><h2>${L('Improvement opportunities', 'הזדמנויות לשיפור')}</h2><ul class="list" id="sgList">${suggestionItems(d.suggestions)}</ul></div>
    <div class="c8 panel glass corner"><h2>${L('Performance trends', 'מגמות ביצועים')}</h2>
      <form id="pf" class="row small">${sel('days', L('period', 'תקופה'), [[7, '7d'], [14, '14d'], [30, '30d'], [90, '90d']]).replace(`<option value="">${L('all', 'הכל')}</option>`, '')}
        ${sel('agent', L('agent', 'סוכן'), agentsList.map((a) => [a.id, a.id]))}${sel('channel', L('application', 'אפליקציה'), [['text', 'web/text'], ['voice', 'voice'], ['watch', 'watch']])}
        ${sel('device', L('device', 'מכשיר'), devs.map((x) => [x.id, x.name]))}${sel('model', L('model', 'מודל'), [['fast', 'fast'], ['balanced', 'balanced'], ['deep', 'deep']])}${sel('kind', L('mission type', 'סוג משימה'), ['question', 'task', 'command', 'mission', 'conversation'].map((x) => [x, x]))}
        <label>${L('capability', 'יכולת')} <input name="tool" dir="ltr" style="width:120px" placeholder="wealth.overview"></label><button class="btn sm">${L('Filter', 'סינון')}</button></form>
      <div id="perfOut" style="margin-top:8px"></div></div>
    <div class="c4 panel glass corner"><h2>${L('Learning mode', 'מצב למידה')}</h2>${d.mode.modes.map((m) => `<label class="block ${m.id === d.mode.current ? 'notify' : ''}" style="cursor:pointer"><input type="radio" name="lmode" value="${m.id}" ${m.id === d.mode.current ? 'checked' : ''}> <span class="grow"><b>${m.id}. ${esc(he() ? m.nameHe : m.name)}</b><div class="xs muted">${esc(he() ? m.descHe : m.desc)}</div></span></label>`).join('')}
      <h3 class="small" style="margin-top:10px">${L('Automatic changes you allow (mode 4 only)', 'שינויים אוטומטיים שאת/ה מאשר/ת (רק במצב 4)')}</h3>
      <div class="row small">${d.mode.autoEligible.map((x) => `<label><input type="checkbox" data-auto="${x}" ${d.mode.autoApply.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('')}</div>
      <p class="xs muted">${L('Only you can change these. The engine cannot raise its own autonomy.', 'רק את/ה יכול/ה לשנות את אלה. המנוע לא יכול להעלות את האוטונומיה של עצמו.')}</p>
      <h3 class="small" style="margin-top:10px">${L('Learning activity', 'פעילות למידה')}</h3><ul class="list">${d.activity.slice(0, 8).map((a) => `<li class="xs"><span class="mono muted">${dt(a.at)}</span><span class="grow mono">${esc(a.type)}</span></li>`).join('') || empty('—')}</ul></div></div>`;
  $('#pf').onsubmit = (e) => { e.preventDefault(); draw(new URLSearchParams([...new FormData(e.target)].filter(([, x]) => x)).toString()); };
  $$('[name=lmode]', el).forEach((r) => { r.onchange = async () => { if (!(await confirmDialog(L(`Switch learning to mode ${r.value}?`, `לעבור למצב למידה ${r.value}?`)))) return redraw(); await act(() => api(`${B}/mode`, { method: 'PUT', body: { mode: Number(r.value) } }), L('Mode updated', 'המצב עודכן')); redraw(); }; });
  $$('[data-auto]', el).forEach((c) => { c.onchange = async () => { await act(() => api(`${B}/auto-apply`, { method: 'PUT', body: { types: $$('[data-auto]', el).filter((x) => x.checked).map((x) => x.dataset.auto) } }), L('Saved', 'נשמר')); }; });
  wireSuggestions(el, redraw);
  await draw();
}

// ---------- B: Model Intelligence ----------
async function models(el, d, redraw) {
  const mi = await api(`${B}/models/intelligence`);
  const last = mi.suites[0];
  el.innerHTML = `<div class="grid">
    <div class="c5 panel glass corner"><h2>${L('Models and health', 'מודלים ובריאות')}</h2><table>${Object.entries(mi.tiers).map(([k, t]) => { const h = mi.health?.[t.provider]; return `<tr><td class="xs">${esc(k)}</td><td class="xs mono">${esc(t.provider)}/${esc(t.model)}</td><td>${h?.downUntil > Date.now() ? tag('missing', L('resting', 'במנוחה')) : tag('fresh', L('healthy', 'תקין'))}</td><td class="xs mono">${esc(mi.preferences ? Object.entries(mi.preferences).filter(([, v]) => v === k).map(([c]) => c).join(', ') : '')}</td></tr>`; }).join('')}</table>
      <p class="xs muted">${esc(mi.policy)}</p></div>
    <div class="c7 panel glass corner"><h2>${L('Benchmark suites', 'חבילות מדידה')} <span class="right row"><button id="mEval" class="btn primary sm">▶ ${L('Evaluate models', 'הערך מודלים')}</button>${last?.recommendations?.some((r) => r.status === 'recommendation') ? `<button id="mProp" class="btn sm">${L('Propose routing', 'הצע ניתוב')}</button>` : ''}</span></h2>
      <p class="xs muted">${L('Math, Hebrew, extraction, planning, data analysis, research, coding and safety. Synthetic prompts with automatic graders; no user data is sent.', 'מתמטיקה, עברית, חילוץ, תכנון, ניתוח נתונים, מחקר, קוד ובטיחות. שאלות סינתטיות עם בודק אוטומטי; לא נשלח מידע של המשתמש.')}</p>
      ${last ? `<table><tr><th>tier</th><th>${L('status', 'סטטוס')}</th><th>${L('accuracy', 'דיוק')}</th>${Object.keys(last.results.find((r) => r.byCategory)?.byCategory ?? {}).map((c) => `<th class="xs">${esc(c)}</th>`).join('')}</tr>${last.results.map((r) => `<tr><td class="xs mono">${esc(r.tier)}</td><td>${tag(r.status)}</td><td class="xs">${r.accuracyPct == null ? esc(r.note ?? '–') : `${r.accuracyPct}%`}</td>${Object.values(r.byCategory ?? {}).map((c) => `<td class="xs">${c.accuracyPct}% · ${c.avgMs}ms</td>`).join('')}</tr>`).join('')}</table>
        <ul class="list">${last.recommendations.map((r) => `<li class="xs">${tag(r.status)}<span class="mono">${esc(r.category)}</span><span class="grow muted">${esc(r.status === 'recommendation' ? `${r.tier} · ${r.basis}` : r.note)}</span></li>`).join('')}</ul>` : `<p class="empty">${L('Not measured yet.', 'עדיין לא נמדד.')}</p>`}</div>
    <div class="c12 panel glass corner"><h2>${L('Live usage by task', 'שימוש חי לפי משימה')}</h2><p class="xs muted">${esc(mi.live.note)}</p>
      <table><tr><th>task</th><th>model</th><th>calls</th><th>err%</th><th>avg ms</th><th>p95</th><th>$/call</th></tr>${mi.live.rows.map((r) => `<tr><td class="xs mono">${esc(r.task)}</td><td class="xs mono">${esc(r.model)}</td><td class="xs">${r.calls}</td><td class="xs">${r.errorPct}%</td><td class="xs">${r.avgMs}</td><td class="xs">${nz(r.p95Ms)}</td><td class="xs">${r.costPerCallUsd}</td></tr>`).join('') || `<tr><td class="empty" colspan="7">${L('No model calls recorded in this session yet.', 'עדיין לא נרשמו קריאות למודל בהפעלה הזו.')}</td></tr>`}</table></div></div>`;
  $('#mEval').onclick = async () => { const b = $('#mEval'); b.disabled = true; b.textContent = '…'; await act(() => post('/models/evaluate'), L('Measured', 'נמדד')); redraw(); };
  $('#mProp')?.addEventListener('click', async () => { await act(() => post('/models/propose-routing', { benchmarkId: last.id }), L('Proposal created: test it in Agent Intelligence', 'נוצרה הצעה: בדקו אותה באינטליגנציית סוכנים')); redraw(); });
}

// ---------- C: Agent Intelligence ----------
async function agents(el, d, redraw) {
  const [ai, rd] = await Promise.all([api(`${B}/agents/intelligence`), api(`${B}/research`)]);
  el.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Improvement proposals', 'הצעות שיפור')}</h2><ul class="list">${proposalItems(d.proposals)}</ul></div>
    <div id="lRep" class="c12"></div>
    <div class="c12 panel glass corner"><h2>${L('Agent performance', 'ביצועי סוכנים')} <button id="aSnap" class="right btn sm">📌 ${L('Save evaluation', 'שמור הערכה')}</button></h2>
      <table><tr><th>agent</th><th>${L('tasks', 'משימות')}</th><th>${L('success', 'הצלחה')}</th><th>${L('verified', 'מאומת')}</th><th>ms</th><th>${L('satisfaction', 'שביעות רצון')}</th><th>${L('denied', 'נחסם')}</th><th>score</th><th></th></tr>${ai.evaluations.map((a) => `<tr><td class="xs mono">${esc(a.agent)}</td><td class="xs">${a.tasks}</td><td class="xs">${nz(a.successPct)}%</td><td class="xs">${nz(a.verifiedPct)}%</td><td class="xs">${nz(a.avgMs)}</td><td class="xs">${a.satisfactionPct == null ? '–' : `${a.satisfactionPct}%`}</td><td class="xs">${a.deniedAttempts}</td><td class="xs">${nz(a.score)}</td><td>${tag(a.rating)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>
    <div class="c6 panel glass corner"><h2>${L('Findings', 'ממצאים')}</h2><ul class="list">${ai.findings.map((f) => `<li class="small">${tag(f.protected ? 'blocked' : 'watch', f.kind)}<span class="grow"><span class="mono xs">${esc(f.agent)}</span> ${esc(f.detail)}<div class="xs muted">${esc(f.recommendation)}</div></span></li>`).join('') || empty(L('No agent issues found.', 'לא נמצאו בעיות בסוכנים.'))}</ul>
      <h3 class="small">${L('Overlapping responsibilities', 'אחריות חופפת')}</h3><ul class="list">${ai.overlaps.map((o) => `<li class="xs"><span class="mono">${esc(o.a)} ⇄ ${esc(o.b)}</span><span class="grow muted">${Math.round(o.similarity * 100)}% · ${esc(o.shared.slice(0, 5).join(', '))}</span></li>`).join('') || empty('—')}</ul></div>
    <div class="c6 panel glass corner"><h2>${L('Error history', 'היסטוריית שגיאות')}</h2><ul class="list">${d.patterns.slice(0, 10).map((p) => { const h = p.hypothesis ?? {}; return `<li class="small" style="align-items:flex-start"><span class="grow"><div class="row">${tag(p.status)}${tag(h.status)}<b>${esc(he() ? p.label.he : p.label.en)}</b><span class="tag xs">×${p.occurrences}</span><span class="tag xs mono">${esc(p.component ?? '')}</span></div>
        <div dir="auto" class="xs">${esc(h.cause ? (he() ? h.causeHe ?? h.cause : h.cause) : (he() ? h.noteHe ?? h.note : h.note))}</div>
        ${h.solutions?.length ? `<details><summary class="xs muted">${L('Possible solutions', 'פתרונות אפשריים')} (${h.solutions.length})</summary><ul class="list">${h.solutions.map((x) => `<li class="xs">${tag(x.risk === 'none' || x.risk === 'low' ? 'fresh' : 'stale', x.risk)}<span class="grow">${esc(he() ? x.he : x.en)}</span>${x.requiresApproval ? `<span class="xs muted">${L('approval', 'אישור')}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
        <details><summary class="xs muted">${L('Evidence', 'ראיות')} (${p.evidence.length})</summary><table>${p.evidence.map((e) => `<tr><td class="xs mono">${dt(e.at)}</td><td class="xs">${esc(e.source)}</td><td class="xs" dir="auto">${esc(e.message)}</td><td class="xs muted" dir="auto">${esc(e.error)}</td></tr>`).join('')}</table></details></span>
        ${p.status !== 'dismissed' ? `<button class="btn sm" data-pdis="${p.id}">✕</button>` : ''}</li>`; }).join('') || empty(L('No failure patterns yet.', 'עדיין אין דפוסי כשל.'))}</ul><button id="lAn" class="btn sm">🔍 ${L('Analyze now', 'נתח עכשיו')}</button></div>
    <div class="c6 panel glass corner"><h2>${L('Capability gaps', 'פערי יכולות')}</h2><p class="xs muted">${esc(rd.policy)}</p><ul class="list">${rd.items.map((i) => `<li class="small">${tag(i.kind === 'existing-capability' ? 'tested' : 'proposed', i.kind)}<span class="grow">${i.tool ? `<span class="mono xs">${esc(i.tool)}</span> · ` : ''}×${i.count}<div class="xs muted" dir="auto">${esc(i.requests.join(' · '))}</div><div class="xs" dir="auto">${esc(he() ? i.feasibilityHe : i.feasibility)}</div></span>${i.kind === 'capability-gap' ? `<button class="btn sm" data-gap="${esc(i.requests[0])}">🧪 ${L('Prototype', 'אב טיפוס')}</button>` : ''}</li>`).join('') || empty(L('No unmet requests detected.', 'לא זוהו בקשות שלא נענו.'))}</ul></div>
    <div class="c6 panel glass corner"><h2>${L('Missions and instructions', 'משימות-על והנחיות')}</h2><table>${ai.missions.slice(0, 8).map((m) => `<tr><td class="xs" dir="auto">${esc(String(m.objective).slice(0, 40))}</td><td>${tag(m.status === 'completed' ? 'pass' : 'stale', m.status)}</td><td class="xs">${m.done}/${m.tasks}</td><td class="xs muted">${esc(m.issues.join('; '))}</td></tr>`).join('') || `<tr><td class="empty">${L('No missions yet.', 'עדיין אין משימות-על.')}</td></tr>`}</table>
      <ul class="list" style="margin-top:8px">${ai.prompts.map((p) => `<li class="xs"><span class="mono">${esc(p.label)}</span><span class="grow muted">${p.findings.length ? esc(p.findings.map((f) => `${f.kind}: ${f.note}`).join(' · ')) : L('no issues', 'אין בעיות')}</span></li>`).join('')}</ul></div></div>`;
  wireProposals(el, redraw, $('#lRep'));
  $('#aSnap').onclick = async () => { await act(() => post('/agents/evaluate'), L('Saved', 'נשמר')); };
  $('#lAn').onclick = async () => { await act(() => post('/analyze')); redraw(); };
  $$('[data-pdis]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/patterns/${b.dataset.pdis}/dismiss`)); redraw(); }; });
  $$('[data-gap]', el).forEach((b) => { b.onclick = async () => { await act(() => post('/lab/branches', { title: b.dataset.gap.slice(0, 40), description: `Requested: ${b.dataset.gap}`, source: 'research' }), L('Branch created in the Development Lab', 'נוצר ענף במעבדת הפיתוח')); tab = 'E'; redraw(); }; });
}

// ---------- D: Learning Center ----------
async function learning(el, d, redraw) {
  const [p, fb, kn, hist] = await Promise.all([api(`${B}/profile`), api(`${B}/feedback`), api(`${B}/knowledge`), api(`${B}/history?n=40`)]);
  el.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('What JARVIS has learned about you', 'מה JARVIS למד עליך')} <button id="pExp" class="right btn sm">⬇ ${L('Export', 'ייצוא')}</button></h2>
      <p class="xs muted">${L('Every item shows its source, confidence, when it was observed, its scope and expiry. Turn a category off to stop learning in it.', 'לכל פריט מוצגים מקור, ביטחון, מתי נצפה, היקף ותפוגה. כבו קטגוריה כדי להפסיק ללמוד בה.')} ${esc(p.sensitive ?? '')}</p></div>
    ${p.categories.map((c) => `<div class="c4 panel glass corner"><h2>${esc(he() ? c.label.he : c.label.en)} <button class="right switch ${c.enabled ? 'on' : ''}" data-pcat="${c.id}" data-en="${c.enabled}" aria-label="${esc(c.label.en)}"></button></h2>
      <ul class="list">${c.items.map((it) => `<li class="small"><span class="grow"><b class="mono xs">${esc(it.key)}</b> <span dir="auto">${esc(it.value)}</span> ${tag(it.status)}
        <div class="xs muted">${esc(it.source ?? '')}${it.confidence != null ? ` · ${L('confidence', 'ביטחון')} ${it.confidence}` : ''}${it.observedAt ? ` · ${dt(it.observedAt)}` : ''}${it.scope ? ` · ${esc(it.scope)}` : ''}${it.expiresAt ? ` · ${L('expires', 'פג')} ${esc(String(it.expiresAt).slice(0, 10))}` : ''}</div></span>
        ${!it.live && !it.memory && it.category !== 'finance_categorization' ? `${it.status === 'proposed' ? `<button class="btn ok sm" data-piok="${it.id}">✓</button>` : ''}<button class="btn sm" data-piedit="${it.id}" data-v="${esc(it.value)}">✎</button><button class="btn danger sm" data-pidel="${it.id}">✕</button>` : ''}</li>`).join('') || empty('—')}</ul></div>`).join('')}
    <div class="c6 panel glass corner"><h2>${L('Recent feedback', 'משוב אחרון')}</h2><ul class="list">${fb.slice(0, 12).map((f) => `<li class="xs"><span>${f.rating > 0 ? '👍' : '👎'}</span><span class="grow" dir="auto">${esc(f.category ?? '')}${f.categoryInferred ? ' (inferred)' : ''} ${esc(f.note ?? '')}<div class="muted">${esc(f.source ?? 'rating')} · ${esc(f.channel ?? '')} · ${dt(f.at)}</div></span></li>`).join('') || empty(L('No feedback yet. Rate answers with 👍/👎 or just say "זה ארוך מדי".', 'אין משוב עדיין. דרגו תשובות ב-👍/👎 או פשוט אמרו "זה ארוך מדי".'))}</ul></div>
    <div class="c6 panel glass corner"><h2>${L('Memory and knowledge quality', 'איכות זיכרון וידע')} <span class="right tag ${kn.freshness.stale ? 'warn' : 'ok'} xs">${kn.freshness.stale}</span></h2><ul class="list">${kn.freshness.checks.map((c) => `<li class="small">${tag(c.status)}<span class="grow">${esc(c.area)}<div class="xs muted" dir="auto">${esc(c.detail)}${c.status !== 'fresh' ? ` · ${esc(he() ? c.actionHe : c.action)}` : ''}</div></span>${c.id === 'knowledge.links' && c.count ? '<button id="kLinks" class="btn sm">🔗</button>' : ''}</li>`).join('')}</ul></div>
    <div class="c12 panel glass corner"><h2>${L('Learning history', 'היסטוריית למידה')}</h2><div style="max-height:300px;overflow:auto"><table>${hist.map((h) => `<tr><td class="xs mono">${dt(h.at)}</td><td class="xs mono">${esc(h.type)}</td><td class="xs">${esc(h.actor ?? '')}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div></div>`;
  $$('[data-pcat]', el).forEach((b) => { b.onclick = async () => { await act(() => api(`${B}/profile/categories/${b.dataset.pcat}`, { method: 'PUT', body: { enabled: b.dataset.en !== 'true' } })); redraw(); }; });
  $$('[data-piok]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/profile/items/${b.dataset.piok}/approve`), L('Applied', 'הוחל')); redraw(); }; });
  $$('[data-pidel]', el).forEach((b) => { b.onclick = async () => { await act(() => api(`${B}/profile/items/${b.dataset.pidel}`, { method: 'DELETE' })); redraw(); }; });
  $$('[data-piedit]', el).forEach((b) => { b.onclick = async () => { const val = await promptDialog(L('Correct value', 'ערך מתוקן'), b.dataset.v); if (val === null) return; await act(() => api(`${B}/profile/items/${b.dataset.piedit}`, { method: 'PATCH', body: { value: val } })); redraw(); }; });
  $('#kLinks')?.addEventListener('click', async () => { const r = await act(() => post('/knowledge/check-links')); if (r) toast(L(`${r.filter((x) => x.broken).length} broken of ${r.length}`, `${r.filter((x) => x.broken).length} שבורים מתוך ${r.length}`)); });
  $('#pExp').onclick = async () => {
    const data = JSON.stringify(await api(`${B}/profile/export`), null, 2);
    if (window.JARVIS_LOCAL) return toast(await window.JARVIS_LOCAL.exportFile('jarvis-profile.json', data));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'jarvis-profile.json'; a.click();
  };
}

// ---------- E: Development Lab ----------
async function lab(el, d, redraw) {
  const lb = await api(`${B}/lab`);
  const example = { title: 'VAT calculator', description: 'Adds 18% VAT to an amount in agorot', code: 'function run(input) {\n  return { total: Math.round(input.amount * 1.18) };\n}', tests: [{ input: { amount: 1000 }, expect: { total: 1180 } }] };
  el.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Development Lab', 'מעבדת פיתוח')} <span class="right row xs">${tag('info', lb.status.isolation)}${tag('fresh', `${L('network', 'רשת')}: ${lb.status.network}`)}</span></h2>
      <p class="xs muted">${L('Experimental branches for new capabilities: pure functions only, statically analyzed, scanned for dependencies and secrets, signed, and tested in isolation. Installing one needs your approval and it can only read.', 'ענפים ניסיוניים ליכולות חדשות: פונקציות טהורות בלבד, עם ניתוח סטטי, סריקת תלויות וסודות, חתימה ובדיקות בבידוד. התקנה דורשת את אישורך, והיכולת יכולה רק לקרוא.')}</p>
      <details ${lb.branches.length ? '' : 'open'}><summary class="small">+ ${L('New branch', 'ענף חדש')}</summary><form id="labF" class="grid" style="margin-top:8px">
        <input name="title" class="c6" required dir="auto" placeholder="${L('Title', 'כותרת')}" value="${esc(example.title)}"><input name="description" class="c6" dir="auto" placeholder="${L('What should it do?', 'מה היא צריכה לעשות?')}" value="${esc(example.description)}">
        <textarea name="code" class="c6" dir="ltr" rows="6" placeholder="function run(input) { ... }">${esc(example.code)}</textarea><textarea name="tests" class="c6" dir="ltr" rows="6">${esc(JSON.stringify(example.tests, null, 1))}</textarea>
        <div class="c12 row"><button class="btn primary sm">${L('Create branch', 'צור ענף')}</button><span class="xs muted">${L('Leave the code empty and press "Generate" to let the AI write it (needs a model).', 'השאירו קוד ריק ולחצו "צור קוד" כדי שה-AI יכתוב אותו (דורש מודל).')}</span></div></form></details></div>
    ${lb.branches.map((b) => `<div class="c6 panel glass corner"><h2><span class="mono small">${esc(b.name)}</span> <span class="right">${tag(b.status)}</span></h2><div class="small" dir="auto">${esc(b.title)} · <span class="mono xs">${esc(b.capId)}</span></div><div class="xs muted" dir="auto">${esc(b.description)}</div>
      <div class="row" style="margin-top:8px">${b.status === 'needs-code' ? `<button class="btn sm" data-lgen="${b.id}">✦ ${L('Generate code', 'צור קוד')}</button>` : ''}${['draft', 'tests-failed', 'blocked', 'tests-blocked'].includes(b.status) ? `<button class="btn sm" data-lver="${b.id}">🛡 ${L('Scan & test', 'סרוק ובדוק')}</button>` : ''}${b.status === 'ready-for-review' ? `<button class="btn ok sm" data-linst="${b.id}">✓ ${L('Approve & install', 'אשר והתקן')}</button>` : ''}${b.status === 'installed' ? `<button class="btn danger sm" data-lun="${b.id}">↶ ${L('Uninstall', 'הסר')}</button>` : ''}<button class="btn sm" data-lview="${b.id}">${L('Details', 'פרטים')}</button></div><div id="lv-${b.id}"></div></div>`).join('')}
    <div class="c12 panel glass corner"><h2>${L('Deployment approvals', 'אישורי פריסה')}</h2><table>${d.approvals.map((a) => `<tr><td>${tag(a.status)}</td><td class="xs" dir="auto">${esc(a.change)}</td><td class="xs mono">${esc(a.target)}</td><td class="xs">${esc(a.verdict ?? '')}</td><td class="xs">${dt(a.requestedAt)}</td><td>${a.status === 'pending' ? `<button class="btn ok sm" data-aok="${a.proposalId}">✓ ${L('Approve', 'אשר')}</button>` : a.status === 'approved' ? `<button class="btn ok sm" data-adep="${a.proposalId}">🚀 ${L('Deploy', 'פרוס')}</button>` : ''}</td></tr>`).join('') || `<tr><td class="empty">${L('No approval requests.', 'אין בקשות אישור.')}</td></tr>`}</table></div>
    <div class="c12 panel glass corner"><h2>${L('Experiments', 'ניסויים')}</h2><table>${d.experiments.map((e) => `<tr><td>${tag(e.verdict)}</td><td class="xs mono">${esc(e.target)}</td><td class="xs" dir="ltr">${e.baseline ? `${e.baseline.passRate}% → ${e.candidate.passRate}%` : esc((e.reasons ?? []).join('; '))}</td><td class="xs" dir="ltr">+${e.improvements.length} / −${e.regressions.length}</td><td><button class="btn sm" data-prep="${e.id}">${L('Report', 'דוח')}</button></td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>
    <div id="lRep" class="c12"></div></div>`;
  $('#labF').onsubmit = async (e) => { e.preventDefault(); const f = e.target; let tests = []; try { tests = JSON.parse(f.tests.value || '[]'); } catch { return toast('tests: JSON'); } await act(() => post('/lab/branches', { title: f.title.value, description: f.description.value, code: f.code.value, tests }), L('Branch created', 'נוצר ענף')); redraw(); };
  $$('[data-lgen]', el).forEach((b) => { b.onclick = async () => { b.disabled = true; b.textContent = '…'; await act(() => post(`/lab/branches/${b.dataset.lgen}/generate`)); redraw(); }; });
  $$('[data-lver]', el).forEach((b) => { b.onclick = async () => { b.disabled = true; b.textContent = '…'; const r = await act(() => post(`/lab/branches/${b.dataset.lver}/verify`)); if (r) toast(r.status); redraw(); }; });
  $$('[data-linst]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L('Install this capability? It will be read-only and available to the Executive agent.', 'להתקין את היכולת? היא תהיה לקריאה בלבד ותהיה זמינה לסוכן המנהל.')))) return; await act(() => post(`/lab/branches/${b.dataset.linst}/install`), L('Installed', 'הותקן')); redraw(); }; });
  $$('[data-lun]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/lab/branches/${b.dataset.lun}/uninstall`)); redraw(); }; });
  $$('[data-aok]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/proposals/${b.dataset.aok}/approve`), L('Approved', 'אושר')); redraw(); }; });
  $$('[data-adep]', el).forEach((b) => { b.onclick = async () => { await act(() => post(`/proposals/${b.dataset.adep}/deploy`), L('Deployed', 'נפרס')); redraw(); }; });
  $$('[data-prep]', el).forEach((b) => { b.onclick = () => showReport($('#lRep'), b.dataset.prep); });
  $$('[data-lview]', el).forEach((b) => { b.onclick = async () => {
    const x = await api(`${B}/lab/branches/${b.dataset.lview}`); const T = x.testsResult; const scan = x.scan?.id ? (await api(`${B}/lab/scans`)).find((sc) => sc.id === x.scan.id) : null;
    $(`#lv-${x.id}`).innerHTML = `<pre class="xs" dir="ltr" style="white-space:pre-wrap;max-height:180px;overflow:auto">${esc(x.code || '—')}</pre>
      ${scan ? `<div class="row xs">${tag(scan.staticAnalysis.passed ? 'pass' : 'blocked', L('static analysis', 'ניתוח סטטי'))}${tag(scan.dependencies.passed ? 'pass' : 'blocked', L('dependencies', 'תלויות'))}${tag(scan.secrets.passed ? 'pass' : 'blocked', L('secrets', 'סודות'))}</div>${scan.staticAnalysis.findings.map((f) => `<div class="xs err">✕ ${esc(f.rule)}: ${esc(f.note)}</div>`).join('')}` : ''}
      ${T?.unit?.length ? `<table>${T.unit.map((u) => `<tr><td>${u.pass ? '✓' : '✕'}</td><td class="xs mono" dir="ltr">${esc(JSON.stringify(u.input))}</td><td class="xs mono" dir="ltr">${esc(JSON.stringify(u.got ?? u.error))}</td><td class="xs">${u.ms == null ? '' : `${u.ms} ms`}</td></tr>`).join('')}</table><div class="row xs">${T.security.map((sx) => tag(sx.ok ? 'pass' : 'blocked', `security: ${sx.case}`)).join('')}</div>` : ''}
      ${x.artifact ? `<div class="xs mono muted" dir="ltr">sha256 ${esc(x.artifact.digest.slice(0, 16))}… · signed ${dt(x.artifact.signedAt)}</div>` : ''}`;
  }; });
}

// ---------- F: Improvement History ----------
async function history(el, d, redraw) {
  const [hist, reg] = await Promise.all([Promise.all(d.versions.map(async (t) => [t, await api(`${B}/versions/${encodeURIComponent(t.target)}`)])), api(`${B}/regression`)]);
  el.innerHTML = `<div class="grid">
    <div class="c6 panel glass corner"><h2>${L('Deployments', 'פריסות')}</h2><table>${d.deployments.map((x) => `<tr><td>${tag(x.status === 'active' ? 'deployed' : 'rolled_back', x.status)}</td><td class="xs mono" dir="ltr">${esc(x.target)} v${x.fromVersion}→v${x.toVersion}</td><td class="xs">${esc(x.by)}</td><td class="xs">${x.occurrencesSinceDeploy == null ? '' : `${L('since', 'מאז')}: ×${x.occurrencesSinceDeploy}`}</td><td>${x.status === 'active' && !x.kind ? `<button class="btn danger sm" data-drb="${x.id}">↶</button>` : ''}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>
      <h3 class="small">${L('Approval records', 'רישומי אישור')}</h3><table>${d.approvals.map((a) => `<tr><td>${tag(a.status)}</td><td class="xs" dir="auto">${esc(a.change)}</td><td class="xs">${esc(a.approvedBy ?? a.requestedBy)}</td><td class="xs">${dt(a.approvedAt ?? a.requestedAt)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>
      <h3 class="small">${L('Rollbacks', 'שחזורים')}</h3><table>${d.rollbacks.map((r) => `<tr><td class="xs mono">${esc(r.target)}</td><td class="xs" dir="ltr">v${nz(r.fromVersion)} → v${nz(r.restoredVersion)}</td><td class="xs">${esc(r.by)}</td><td class="xs">${esc(r.reason ?? '')}</td><td class="xs">${dt(r.at)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>
    <div class="c6 panel glass corner"><h2>${L('Regression runs', 'הרצות רגרסיה')} <button id="rRun" class="right btn primary sm">▶ ${L('Run regression tests', 'הרץ בדיקות רגרסיה')}</button></h2><table>${reg.map((r) => `<tr><td class="xs">${dt(r.at)}</td><td class="xs">${r.passed}/${r.total}</td><td class="xs">${r.passRate}%</td><td class="xs">${r.violations} ${L('violations', 'הפרות')}</td><td>${r.comparison ? (r.comparison.regressions.length ? tag('regression', `−${r.comparison.regressions.length}`) : tag('pass', L('no regressions', 'ללא נסיגות'))) : ''}</td></tr>`).join('') || `<tr><td class="empty">${L('Not run yet.', 'עדיין לא הורץ.')}</td></tr>`}</table></div>
    ${hist.map(([t, h]) => `<div class="c6 panel glass corner"><h2>${esc(t.label)} <span class="right mono xs muted">${esc(t.target)}</span></h2>
      <ul class="list">${h.map((x, i) => `<li class="small"><span class="tag xs">v${x.version}</span>${tag(x.status)}${x.signature ? '<span class="xs" title="signed">🔏</span>' : ''}<span class="grow xs" dir="auto">${esc(x.reason)}<div class="muted">${esc(x.createdBy)} · ${dt(x.createdAt)}${x.evaluation ? ` · ${esc(x.evaluation.verdict)}` : ''}${x.rollbackRef ? ` · ↶ ${esc(x.rollbackRef)}` : ''}</div></span>${h[i + 1] ? `<button class="btn sm" data-vcmp="${esc(t.target)}" data-a="${h[i + 1].version}" data-b="${x.version}">⇄</button>` : ''}${x.status !== 'active' ? `<button class="btn sm" data-vrb="${esc(t.target)}" data-vv="${x.version}">↶ v${x.version}</button>` : ''}</li>`).join('') || empty(L('No changes yet (production value untouched).', 'אין שינויים עדיין (הערך בייצור לא נגע).'))}</ul><div class="vcmp"></div></div>`).join('')}</div>`;
  $('#rRun').onclick = async () => { const b = $('#rRun'); b.disabled = true; b.textContent = '…'; await act(() => post('/regression')); redraw(); };
  $$('[data-drb]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L('Roll back this deployment?', 'לשחזר את הפריסה?'), { danger: true }))) return; await act(() => post(`/deployments/${b.dataset.drb}/rollback`), L('Rolled back', 'שוחזר')); redraw(); }; });
  $$('[data-vrb]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L(`Restore v${b.dataset.vv}?`, `לשחזר את v${b.dataset.vv}?`)))) return; await act(() => post(`/versions/${encodeURIComponent(b.dataset.vrb)}/rollback`, { version: Number(b.dataset.vv) }), L('Restored', 'שוחזר')); redraw(); }; });
  $$('[data-vcmp]', el).forEach((b) => { b.onclick = async () => { const c = await act(() => api(`${B}/versions/${encodeURIComponent(b.dataset.vcmp)}/compare?a=${b.dataset.a}&b=${b.dataset.b}`)); if (!c) return; b.closest('.panel').querySelector('.vcmp').innerHTML = `<table><tr><th>field</th><th>v${c.a.version}</th><th>v${c.b.version}</th></tr>${c.changes.map((x) => `<tr><td class="xs mono">${esc(x.field)}</td><td class="xs mono" dir="ltr">${esc(String(x.a ?? '–').slice(0, 80))}</td><td class="xs mono" dir="ltr">${esc(String(x.b ?? '–').slice(0, 80))}</td></tr>`).join('') || '<tr><td class="empty">=</td></tr>'}</table>`; }; });
}

// ---------- G: Security Monitor ----------
async function security(el, d) {
  const sec = await api(`${B}/security`);
  el.innerHTML = `<div class="grid">
    <div class="c4 panel glass corner"><h2>${L('Experimental environments', 'סביבות ניסוי')}</h2><div class="kv small"><span class="muted">${L('experiments', 'ניסויים')}</span><span class="xs">${esc(sec.sandbox.experiments)}</span><span class="muted">${L('lab', 'מעבדה')}</span><span class="xs">${esc(sec.sandbox.lab.isolation)}</span><span class="muted">${L('network', 'רשת')}</span><span class="xs">${esc(sec.sandbox.lab.network)}</span><span class="muted">${L('production access', 'גישה לייצור')}</span><span class="xs">${esc(sec.sandbox.lab.productionAccess)}</span><span class="muted">${L('secrets', 'סודות')}</span><span class="xs">${esc(sec.sandbox.secrets)}</span></div>
      <h3 class="small" style="margin-top:10px">${L('Protected: never changed by learning', 'מוגן: הלמידה לעולם לא משנה')}</h3><div class="row">${d.mode.protected.map((p) => `<span class="tag xs">⛨ ${esc(p)}</span>`).join('')}</div></div>
    <div class="c8 panel glass corner"><h2>${L('Suspicious activity', 'פעילות חשודה')}</h2><ul class="list">${sec.suspicious.map((x) => `<li class="small">${tag(x.kind === 'tampered-version' ? 'missing' : 'stale', x.kind)}<span class="grow" dir="auto">${esc(x.detail)}</span></li>`).join('') || empty(L('Nothing suspicious detected.', 'לא זוהתה פעילות חשודה.'))}</ul>
      <h2 style="margin-top:12px">${L('Blocked changes', 'שינויים שנחסמו')}</h2><table>${sec.blockedChanges.slice(0, 20).map((e) => `<tr><td class="xs mono">${dt(e.at)}</td><td class="xs mono">${esc(e.type)}</td><td class="xs muted mono" dir="ltr">${esc(JSON.stringify(e.detail).slice(0, 120))}</td></tr>`).join('') || `<tr><td class="empty">${L('None yet.', 'אין עדיין.')}</td></tr>`}</table></div>
    <div class="c12 panel glass corner"><h2>${L('Permission events', 'אירועי הרשאות')}</h2><div style="max-height:300px;overflow:auto"><table>${sec.permissionEvents.map((a) => `<tr><td class="xs mono">${dt(a.at ?? a.createdAt)}</td><td class="xs mono">${esc(a.action)}</td><td class="xs">${esc(a.actor)}</td><td>${tag(a.outcome === 'denied' ? 'blocked' : 'fresh', a.outcome ?? 'ok')}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div>
    <div class="c12 panel glass corner"><h2>${L('Learning audit', 'תיעוד הלמידה')}</h2><div style="max-height:320px;overflow:auto"><table>${d.audit.map((a) => `<tr><td class="xs mono">${dt(a.at)}</td><td class="xs mono">${esc(a.action)}</td><td class="xs">${esc(a.actor)}</td><td class="xs muted mono" dir="ltr">${esc(JSON.stringify(a.detail).slice(0, 140))}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div></div>`;
}
