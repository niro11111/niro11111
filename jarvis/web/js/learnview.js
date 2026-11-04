// Self-Improvement dashboard (screens A-G) for the Autonomous Learning Engine.
// A Overview & performance · B Failures & causes · C Proposals, experiments & deployments
// D Personalization profile · E Models & agents · F Versions & audit · G Suggestions, freshness & R&D
import { api, esc, toast, $, $$, confirmDialog, promptDialog } from './api.js';
import { getLang } from './i18n.js';
import { lineChart, gauge } from './charts.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
const B = '/api/v1/learning';
let tab = 'A';
const TABS = [['A', 'Overview', 'סקירה'], ['B', 'Failures', 'כשלים'], ['C', 'Proposals', 'הצעות'], ['D', 'Profile', 'פרופיל'], ['E', 'Models & agents', 'מודלים וסוכנים'], ['F', 'Versions & audit', 'גרסאות ותיעוד'], ['G', 'Suggestions & R&D', 'הצעות ומחקר']];
const stTag = { proposed: 'info', testing: 'warn', tested: 'ok', 'failed-test': 'bad', approved: 'ok', deployed: 'ok', rejected: '', rolled_back: 'warn', open: 'warn', resolved: 'ok', dismissed: '', 'recurring-after-fix': 'bad', active: 'ok', superseded: '', likely: 'ok', 'insufficient-evidence': 'warn', fresh: 'ok', stale: 'warn', missing: 'bad', expiring: 'warn', info: 'info', good: 'ok', watch: 'warn', 'needs-attention': 'bad', 'insufficient-data': '' };
const tag = (s, txt = s) => `<span class="tag ${stTag[s] ?? ''} xs">${esc(txt)}</span>`;
const dt = (iso) => (iso ? esc(String(iso).slice(0, 16).replace('T', ' ')) : '–');
const nz = (x) => x ?? '–';

export async function learnView(v) {
  const d = await api(`${B}/dashboard`);
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Self-improvement', 'שיפור עצמי')} <span class="right row">${tag('info', `${L('mode', 'מצב')} ${d.mode.current}: ${he() ? d.mode.modes[d.mode.current - 1].nameHe : d.mode.modes[d.mode.current - 1].name}`)}<button id="lCycle" class="btn primary sm">⟳ ${L('Run improvement cycle', 'הרץ מחזור שיפור')}</button></span></h2>
      <div class="row" role="tablist">${TABS.map(([id, en, h]) => `<button class="btn sm ${tab === id ? 'primary' : ''}" role="tab" aria-selected="${tab === id}" data-ltab="${id}">${id} · ${L(en, h)}</button>`).join('')}</div>
      <p class="xs muted" style="margin:8px 0 0">${L('Protected (never changed by learning):', 'מוגן (הלמידה לעולם לא משנה):')} ${d.mode.protected.map((p) => `<span class="tag xs">${esc(p)}</span>`).join(' ')}</p></div>
    <div id="lBody" class="c12"></div></div>`;
  $$('[data-ltab]', v).forEach((b) => { b.onclick = () => { tab = b.dataset.ltab; learnView(v); }; });
  $('#lCycle').onclick = async () => { const b = $('#lCycle'); b.disabled = true; b.textContent = '…'; try { const r = await api(`${B}/cycle`, { method: 'POST' }); toast(L(`${r.patterns} recurring pattern(s), ${r.tested} experiment(s)`, `${r.patterns} דפוסים חוזרים, ${r.tested} ניסויים`)); } catch (e) { toast(e.message); } learnView(v); };
  const body = $('#lBody');
  const redraw = () => learnView(v);
  await ({ A: overview, B: failures, C: proposals, D: profile, E: modelsAgents, F: versions, G: suggestions })[tab](body, d, redraw);
}

// ---------- A: overview, performance with filters, learning mode ----------
async function overview(el, d, redraw) {
  const agents = await api('/api/agents');
  const draw = async (q = 'days=14') => {
    const p = await api(`${B}/performance?${q}`);
    const T = p.totals;
    $('#perfOut').innerHTML = `<div class="gauges">${gauge(T.successPct ?? 0, { label: L('success', 'הצלחה'), color: 'var(--green)' })}${gauge(T.satisfactionPct ?? 0, { label: L('satisfaction', 'שביעות רצון'), color: 'var(--violet)' })}${gauge(T.clarificationPct ?? 0, { label: L('clarifications', 'הבהרות'), color: 'var(--amber)' })}${gauge(T.tasks, { label: L('tasks', 'משימות'), suffix: '', max: Math.max(50, T.tasks), color: 'var(--cyan)' })}</div>
      <div class="row xs" style="margin:8px 0">${[['avg ms', T.avgMs], ['p95 ms', T.p95Ms], [L('model calls', 'קריאות מודל'), T.modelCalls], [L('model errors %', 'שגיאות מודל %'), T.modelErrorPct], ['USD', T.costUsd], [L('feedback', 'משוב'), T.feedback]].map(([k, x]) => `<span class="tag xs">${esc(k)}: ${esc(nz(x))}</span>`).join('')}</div>
      ${lineChart(p.series.map((s) => ({ ...s, successPct: s.successPct ?? 0, satisfactionPct: s.satisfactionPct ?? 0 })), { keys: ['successPct', 'satisfactionPct'], colors: ['#22e08a', '#8a6cff'], labels: (s) => s.day.slice(5), fmt: (x) => `${Math.round(x)}%` })}
      ${lineChart(p.series, { keys: ['tasks', 'failed'], colors: ['#2ee6ff', '#ff5d6c'], labels: (s) => s.day.slice(5), fmt: (x) => Math.round(x) })}
      <div class="grid" style="margin-top:8px">${[['byTool', L('By tool', 'לפי כלי')], ['byAgent', L('By agent', 'לפי סוכן')], ['byChannel', L('By channel', 'לפי ערוץ')]].map(([k, title]) => `<div class="c4"><h3 class="small">${title}</h3><table>${p[k].slice(0, 8).map((x) => `<tr><td class="xs mono">${esc(x.key)}</td><td class="xs">${x.tasks}</td><td class="xs">${x.successPct == null ? '–' : `${x.successPct}%`}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>`).join('')}</div>
      ${p.history.length ? `<details style="margin-top:8px"><summary class="xs muted">${L('Daily snapshots', 'תמונות מצב יומיות')} (${p.history.length})</summary><table>${p.history.slice(-30).reverse().map((h) => `<tr><td class="xs mono">${esc(h.day)}</td><td class="xs">${h.tasks}</td><td class="xs">${nz(h.successPct)}%</td><td class="xs">${nz(h.satisfactionPct)}%</td></tr>`).join('')}</table></details>` : ''}`;
  };
  el.innerHTML = `<div class="grid">
    <div class="c8 panel glass corner"><h2>${L('Performance', 'ביצועים')}</h2>
      <form id="pf" class="row small"><label>${L('days', 'ימים')} <select name="days">${[7, 14, 30, 90].map((x) => `<option ${x === 14 ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>${L('channel', 'ערוץ')} <select name="channel"><option value="">${L('all', 'הכל')}</option>${['text', 'voice', 'watch'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>${L('agent', 'סוכן')} <select name="agent"><option value="">${L('all', 'הכל')}</option>${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select></label>
        <label>${L('tool', 'כלי')} <input name="tool" dir="ltr" style="width:130px" placeholder="wealth.overview"></label><button class="btn sm">${L('Filter', 'סינון')}</button></form>
      <div id="perfOut" style="margin-top:10px"></div></div>
    <div class="c4 panel glass corner"><h2>${L('Learning mode', 'מצב למידה')}</h2>${d.mode.modes.map((m) => `<label class="block ${m.id === d.mode.current ? 'notify' : ''}" style="cursor:pointer"><input type="radio" name="lmode" value="${m.id}" ${m.id === d.mode.current ? 'checked' : ''}> <span class="grow"><b>${m.id}. ${esc(he() ? m.nameHe : m.name)}</b><div class="xs muted">${esc(he() ? m.descHe : m.desc)}</div></span></label>`).join('')}
      <p class="xs muted">${L('Only you can change the mode. The engine cannot raise its own autonomy.', 'רק את/ה יכול/ה לשנות את המצב. המנוע לא יכול להעלות את האוטונומיה של עצמו.')}</p></div></div>`;
  $('#pf').onsubmit = (e) => { e.preventDefault(); draw(new URLSearchParams([...new FormData(e.target)].filter(([, x]) => x)).toString()); };
  $$('[name=lmode]', el).forEach((r) => { r.onchange = async () => { if (!(await confirmDialog(L(`Switch learning to mode ${r.value}?`, `לעבור למצב למידה ${r.value}?`)))) return redraw(); await api(`${B}/mode`, { method: 'PUT', body: { mode: Number(r.value) } }); toast(L('Mode updated', 'המצב עודכן')); redraw(); }; });
  await draw();
}

// ---------- B: failure patterns with evidence ----------
async function failures(el, d, redraw) {
  const cls = d.classes;
  el.innerHTML = `<div class="panel glass corner"><h2>${L('Recurring failures and likely causes', 'כשלים חוזרים וסיבות סבירות')} <button id="lAn" class="right btn sm">🔍 ${L('Analyze now', 'נתח עכשיו')}</button></h2>
    <p class="xs muted">${L('A cause is named only with enough evidence (3+ occurrences). Confidence is an estimate.', 'סיבה מוצגת רק כשיש מספיק ראיות (3 מקרים ומעלה). רמת הביטחון היא הערכה.')}</p>
    <div class="row xs">${Object.entries(cls).map(([k, c]) => `<span class="tag xs" title="${esc(k)}">${esc(he() ? c.he : c.en)}: ${d.patterns.filter((p) => p.cls === k).reduce((a, p) => a + p.occurrences, 0)}</span>`).join('')}</div>
    <ul class="list" style="margin-top:10px">${d.patterns.map((p) => { const h = p.hypothesis ?? {}; return `<li class="small" style="align-items:flex-start"><span class="grow">
      <div class="row">${tag(p.status)}${tag(h.status)}<b>${esc(he() ? p.label.he : p.label.en)}</b><span class="mono xs muted">${esc(p.tool ?? '')}${p.target ? ` · ${esc(p.target)}` : ''}</span><span class="tag xs">×${p.occurrences}</span><span class="tag xs">${L('confidence', 'ביטחון')} ${p.confidence}</span></div>
      <div dir="auto" style="margin-top:4px">${esc(h.cause ? (he() ? h.causeHe ?? h.cause : h.cause) : (he() ? h.noteHe ?? h.note : h.note))}</div>
      ${h.action?.type === 'guidance' ? `<div class="xs muted" dir="auto">💡 ${esc(he() ? h.action.textHe : h.action.text)}</div>` : ''}
      <details><summary class="xs muted">${L('Evidence', 'ראיות')} (${p.evidence.length}) · ${L('basis', 'בסיס')}: ${esc(p.classificationBasis.join('; '))}</summary><table>${p.evidence.map((e) => `<tr><td class="xs mono">${dt(e.at)}</td><td class="xs">${esc(e.source)}</td><td class="xs" dir="auto">${esc(e.message)}</td><td class="xs muted" dir="auto">${esc(e.error)}</td></tr>`).join('')}</table></details></span>
      ${p.status !== 'dismissed' ? `<button class="btn sm" data-pdis="${p.id}">${L('Dismiss', 'התעלם')}</button>` : ''}</li>`; }).join('') || `<li class="empty">${L('No failure patterns yet.', 'עדיין אין דפוסי כשל.')}</li>`}</ul></div>`;
  $('#lAn').onclick = async () => { await api(`${B}/analyze`, { method: 'POST', body: {} }); redraw(); };
  $$('[data-pdis]', el).forEach((b) => { b.onclick = async () => { await api(`${B}/patterns/${b.dataset.pdis}/dismiss`, { method: 'POST' }); redraw(); }; });
}

// ---------- C: proposals, experiments (comparison report), deployments ----------
async function proposals(el, d, redraw) {
  el.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Improvement proposals', 'הצעות שיפור')}</h2>
      <ul class="list">${d.proposals.map((p) => `<li class="small" style="align-items:flex-start"><span class="grow"><div class="row">${tag(p.status)}<b dir="auto">${esc(he() ? p.changeHe : p.change)}</b>${p.systemChange ? tag('info', L('system change', 'שינוי מערכת')) : tag('', L('personalization', 'התאמה אישית'))}<span class="tag xs">${L('risk', 'סיכון')} ${esc(p.risk)}</span></div>
        <div class="xs muted" dir="auto">${esc(he() ? p.rationaleHe : p.rationale)}</div><div class="xs mono muted">${esc(p.target)} · ${esc(p.createdBy)} · ${dt(p.at)}</div></span>
        <span class="row">${['proposed', 'failed-test'].includes(p.status) ? `<button class="btn sm" data-pexp="${p.id}">🧪 ${L('Test in sandbox', 'בדוק בסביבה מבודדת')}</button>` : ''}${p.experimentId ? `<button class="btn sm" data-prep="${p.experimentId}">${L('Report', 'דוח')}</button>` : ''}${p.status === 'tested' ? `<button class="btn ok sm" data-pok="${p.id}">✓ ${L('Approve & deploy', 'אשר ופרוס')}</button>` : ''}${!['deployed', 'rejected', 'rolled_back'].includes(p.status) ? `<button class="btn danger sm" data-pno="${p.id}">${L('Reject', 'דחה')}</button>` : ''}</span></li>`).join('') || `<li class="empty">${L('No proposals. They appear when a recurring failure has a supported cause.', 'אין הצעות. הן מופיעות כשלכשל חוזר יש סיבה נתמכת.')}</li>`}</ul></div>
    <div id="lRep" class="c12"></div>
    <div class="c6 panel glass corner"><h2>${L('Experiments', 'ניסויים')}</h2><table>${d.experiments.map((e) => `<tr><td>${tag(e.verdict === 'pass' ? 'tested' : 'failed-test', e.verdict)}</td><td class="xs mono">${esc(e.target)}</td><td class="xs" dir="ltr">${e.baseline ? `${e.baseline.passRate}% → ${e.candidate.passRate}%` : esc((e.reasons ?? []).join('; '))}</td><td class="xs" dir="ltr">+${e.improvements.length} / −${e.regressions.length}</td><td><button class="btn sm" data-prep="${e.id}">${L('Report', 'דוח')}</button></td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>
    <div class="c6 panel glass corner"><h2>${L('Deployments', 'פריסות')}</h2><table>${d.deployments.map((x) => `<tr><td>${tag(x.status === 'active' ? 'deployed' : 'rolled_back', x.status)}</td><td class="xs mono" dir="ltr">${esc(x.target)} v${x.fromVersion}→v${x.toVersion}</td><td class="xs">${esc(x.by)}</td><td class="xs">${x.occurrencesSinceDeploy == null ? '' : `${L('since', 'מאז')}: ×${x.occurrencesSinceDeploy}`}</td><td>${x.status === 'active' ? `<button class="btn danger sm" data-drb="${x.id}">↶ ${L('Roll back', 'שחזר')}</button>` : ''}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div>`;
  const report = async (id) => {
    const e = await api(`${B}/experiments/${id}`);
    const R = e.report;
    $('#lRep').innerHTML = `<div class="panel glass corner"><h2>${L('Comparison report', 'דוח השוואה')} ${tag(e.verdict === 'pass' ? 'tested' : 'failed-test', e.verdict)} <span class="right xs muted">${esc(e.environment)}</span></h2>
      ${e.reasons?.length ? `<p class="small err">${esc(e.reasons.join(' · '))}</p>` : ''}
      ${R ? `<div class="row xs">${Object.entries(R.metrics).map(([k, m]) => `<span class="tag xs" dir="ltr">${esc(k)}: ${esc(nz(m.baseline))} → ${esc(nz(m.candidate))}</span>`).join('')}</div>
      <div style="max-height:360px;overflow:auto;margin-top:8px"><table><tr><th>case</th><th>${L('current', 'נוכחי')}</th><th>${L('candidate', 'מועמד')}</th><th></th><th></th></tr>${R.rows.map((r) => `<tr><td class="xs mono" dir="auto">${esc(r.id)}</td><td>${r.baseline == null ? '–' : r.baseline ? '✓' : '✕'}</td><td>${r.candidate ? '✓' : '✕'}</td><td>${r.change === 'regressed' ? tag('failed-test', L('regressed', 'נסוג')) : r.change === 'improved' ? tag('tested', L('improved', 'השתפר')) : ''}</td><td class="xs muted" dir="auto">${esc(r.candidateDetail ?? '')}</td></tr>`).join('')}</table></div>` : ''}
      ${e.checks?.length ? `<ul class="list">${e.checks.map((c) => `<li class="xs">${c.pass === null ? 'ⓘ' : c.pass ? '✓' : '✕'} ${esc(c.check)}${c.note ? ` <span class="muted">${esc(c.note)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
    $('#lRep').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $$('[data-prep]', el).forEach((b) => { b.onclick = () => report(b.dataset.prep); });
  $$('[data-pexp]', el).forEach((b) => { b.onclick = async () => { b.disabled = true; b.textContent = '…'; try { const e = await api(`${B}/proposals/${b.dataset.pexp}/experiment`, { method: 'POST' }); toast(e.verdict); } catch (err) { toast(err.message); } await redraw(); }; });
  $$('[data-pok]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L('Deploy this change? The previous version is kept and can be restored.', 'לפרוס את השינוי? הגרסה הקודמת נשמרת ואפשר לשחזר אותה.')))) return; try { await api(`${B}/proposals/${b.dataset.pok}/approve`, { method: 'POST' }); toast(L('Deployed', 'נפרס')); } catch (err) { toast(err.message); } redraw(); }; });
  $$('[data-pno]', el).forEach((b) => { b.onclick = async () => { const reason = await promptDialog(L('Reason (optional)', 'סיבה (לא חובה)'), ''); if (reason === null) return; await api(`${B}/proposals/${b.dataset.pno}/reject`, { method: 'POST', body: { reason } }); redraw(); }; });
  $$('[data-drb]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L('Roll back this deployment?', 'לשחזר את הפריסה?'), { danger: true }))) return; try { await api(`${B}/deployments/${b.dataset.drb}/rollback`, { method: 'POST' }); toast(L('Rolled back', 'שוחזר')); } catch (err) { toast(err.message); } redraw(); }; });
}

// ---------- D: personalization profile ----------
async function profile(el, d, redraw) {
  const p = await api(`${B}/profile`);
  el.innerHTML = `<div class="grid"><div class="c12 panel glass corner"><h2>${L('What JARVIS has learned about you', 'מה JARVIS למד עליך')} <button id="pExp" class="right btn sm">⬇ ${L('Export', 'ייצוא')}</button></h2>
    <p class="xs muted">${L('Every item shows its source, confidence, when it was observed, its scope and expiry. Turn a category off to stop learning in it.', 'לכל פריט מוצגים מקור, ביטחון, מתי נצפה, היקף ותפוגה. כבו קטגוריה כדי להפסיק ללמוד בה.')}</p></div>
    ${p.categories.map((c) => `<div class="c6 panel glass corner"><h2>${esc(he() ? c.label.he : c.label.en)} <button class="right switch ${c.enabled ? 'on' : ''}" data-pcat="${c.id}" data-en="${c.enabled}" aria-label="${esc(c.label.en)}"></button></h2>
      <ul class="list">${c.items.map((it) => `<li class="small"><span class="grow"><b class="mono xs">${esc(it.key)}</b> <span dir="auto">${esc(it.value)}</span> ${tag(it.status)}
        <div class="xs muted">${esc(it.source ?? '')}${it.confidence != null ? ` · ${L('confidence', 'ביטחון')} ${it.confidence}` : ''}${it.observedAt ? ` · ${dt(it.observedAt)}` : ''}${it.scope ? ` · ${esc(it.scope)}` : ''}${it.expiresAt ? ` · ${L('expires', 'פג')} ${esc(String(it.expiresAt).slice(0, 10))}` : ''}</div></span>
        ${!it.live && !it.memory && it.category !== 'finance_categorization' ? `${it.status === 'proposed' ? `<button class="btn ok sm" data-piok="${it.id}">✓</button>` : ''}<button class="btn sm" data-piedit="${it.id}" data-v="${esc(it.value)}">✎</button><button class="btn danger sm" data-pidel="${it.id}">✕</button>` : ''}</li>`).join('') || '<li class="empty">—</li>'}</ul></div>`).join('')}</div>`;
  $$('[data-pcat]', el).forEach((b) => { b.onclick = async () => { await api(`${B}/profile/categories/${b.dataset.pcat}`, { method: 'PUT', body: { enabled: b.dataset.en !== 'true' } }); redraw(); }; });
  $$('[data-piok]', el).forEach((b) => { b.onclick = async () => { await api(`${B}/profile/items/${b.dataset.piok}/approve`, { method: 'POST' }); toast(L('Applied', 'הוחל')); redraw(); }; });
  $$('[data-pidel]', el).forEach((b) => { b.onclick = async () => { await api(`${B}/profile/items/${b.dataset.pidel}`, { method: 'DELETE' }); redraw(); }; });
  $$('[data-piedit]', el).forEach((b) => { b.onclick = async () => { const val = await promptDialog(L('Correct value', 'ערך מתוקן'), b.dataset.v); if (val === null) return; try { await api(`${B}/profile/items/${b.dataset.piedit}`, { method: 'PATCH', body: { value: val } }); } catch (err) { toast(err.message); } redraw(); }; });
  $('#pExp').onclick = async () => {
    const data = JSON.stringify(await api(`${B}/profile/export`), null, 2);
    if (window.JARVIS_LOCAL) return toast(await window.JARVIS_LOCAL.exportFile('jarvis-profile.json', data));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'jarvis-profile.json'; a.click();
  };
}

// ---------- E: model benchmarks and agent evaluations ----------
async function modelsAgents(el) {
  const [m, ag] = await Promise.all([api(`${B}/models`), api(`${B}/agents`)]);
  el.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Model benchmarks by task', 'מדדי מודלים לפי משימה')} <button id="mSnap" class="right btn sm">📌 ${L('Save snapshot', 'שמור תמונת מצב')}</button></h2><p class="xs muted">${esc(m.note)}</p>
      <table><tr><th>task</th><th>model</th><th>calls</th><th>err%</th><th>avg ms</th><th>p95</th><th>$/call</th></tr>${m.rows.map((r) => `<tr><td class="xs mono">${esc(r.task)}</td><td class="xs mono">${esc(r.model)}</td><td class="xs">${r.calls}</td><td class="xs">${r.errorPct}%</td><td class="xs">${r.avgMs}</td><td class="xs">${nz(r.p95Ms)}</td><td class="xs">${r.costPerCallUsd}</td></tr>`).join('') || `<tr><td class="empty" colspan="7">${L('No model calls recorded in this session yet.', 'עדיין לא נרשמו קריאות למודל בהפעלה הזו.')}</td></tr>`}</table>
      <ul class="list" style="margin-top:8px">${m.recommendations.map((r) => `<li class="small">${tag(r.status)}<span class="mono xs">${esc(r.task)}</span><span class="grow xs muted">${esc(r.status === 'recommendation' ? `${r.tier} (${r.model}): ${r.basis}` : he() ? r.noteHe : r.note)}</span></li>`).join('')}</ul></div>
    <div class="c12 panel glass corner"><h2>${L('Agent evaluation', 'הערכת סוכנים')}</h2>
      <table><tr><th>agent</th><th>${L('tasks', 'משימות')}</th><th>${L('success', 'הצלחה')}</th><th>${L('verified', 'מאומת')}</th><th>ms</th><th>${L('satisfaction', 'שביעות רצון')}</th><th>${L('denied', 'נחסם')}</th><th>score</th><th></th></tr>${ag.map((a) => `<tr><td class="xs mono">${esc(a.agent)}</td><td class="xs">${a.tasks}</td><td class="xs">${nz(a.successPct)}%</td><td class="xs">${nz(a.verifiedPct)}%</td><td class="xs">${nz(a.avgMs)}</td><td class="xs">${a.satisfactionPct == null ? '–' : `${a.satisfactionPct}%`}</td><td class="xs">${a.deniedAttempts}</td><td class="xs">${nz(a.score)}</td><td>${tag(a.rating)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div>`;
  $('#mSnap').onclick = async () => { await api(`${B}/models/benchmark`, { method: 'POST' }); toast(L('Saved', 'נשמר')); };
}

// ---------- F: versions with rollback, learning audit ----------
async function versions(el, d, redraw) {
  const hist = await Promise.all(d.versions.map(async (t) => [t, await api(`${B}/versions/${encodeURIComponent(t.target)}`)]));
  el.innerHTML = `<div class="grid">
    ${hist.map(([t, h]) => `<div class="c6 panel glass corner"><h2>${esc(t.label)} <span class="right mono xs muted">${esc(t.target)}</span></h2>
      <ul class="list">${h.map((x) => `<li class="small"><span class="tag xs">v${x.version}</span>${tag(x.status)}<span class="grow xs" dir="auto">${esc(x.reason)}<div class="muted">${esc(x.createdBy)} · ${dt(x.createdAt)}</div><details><summary class="xs muted">${L('value', 'ערך')}</summary><pre class="xs" dir="ltr" style="white-space:pre-wrap">${esc(JSON.stringify(x.value, null, 1))}</pre></details></span>${x.status !== 'active' ? `<button class="btn sm" data-vrb="${esc(t.target)}" data-vv="${x.version}">↶ v${x.version}</button>` : ''}</li>`).join('') || `<li class="empty">${L('No changes yet (production value untouched).', 'אין שינויים עדיין (הערך בייצור לא נגע).')}</li>`}</ul></div>`).join('')}
    <div class="c12 panel glass corner"><h2>${L('Learning audit', 'תיעוד הלמידה')}</h2><div style="max-height:380px;overflow:auto"><table>${d.audit.map((a) => `<tr><td class="xs mono">${dt(a.at)}</td><td class="xs mono">${esc(a.action)}</td><td class="xs">${esc(a.actor)}</td><td class="xs muted mono" dir="ltr">${esc(JSON.stringify(a.detail).slice(0, 160))}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div></div>`;
  $$('[data-vrb]', el).forEach((b) => { b.onclick = async () => { if (!(await confirmDialog(L(`Restore v${b.dataset.vv}?`, `לשחזר את v${b.dataset.vv}?`)))) return; try { await api(`${B}/versions/${encodeURIComponent(b.dataset.vrb)}/rollback`, { method: 'POST', body: { version: Number(b.dataset.vv) } }); toast(L('Restored', 'שוחזר')); } catch (err) { toast(err.message); } redraw(); }; });
}

// ---------- G: proactive suggestions, freshness, capability R&D ----------
async function suggestions(el, d, redraw) {
  const [fr, rd] = await Promise.all([api(`${B}/freshness`), api(`${B}/research`)]);
  el.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Improvement suggestions', 'הצעות לשיפור')}</h2><ul class="list">${d.suggestions.map((s) => `<li class="small"><span class="tag ${s.priority === 'high' ? 'warn' : ''} xs">${esc(s.kind)}</span><span class="grow" dir="auto">${esc(he() ? s.titleHe ?? s.title : s.title)}<div class="xs muted" dir="auto">${esc(he() ? s.whyHe ?? s.why : s.why)}</div></span>
      ${['proposal', 'profile', 'fwos'].includes(s.kind) || s.ref === 'brain.evaluation' ? `<button class="btn ok sm" data-sa="approve" data-sid="${esc(s.id)}">✓</button>` : ''}<button class="btn sm" data-sa="postpone" data-sid="${esc(s.id)}" title="${L('Postpone a week', 'דחה בשבוע')}">⏰</button><button class="btn sm" data-sa="dismiss" data-sid="${esc(s.id)}" aria-label="${L('Dismiss', 'התעלם')}">✕</button></li>`).join('') || `<li class="empty">${L('Nothing to improve right now.', 'אין מה לשפר כרגע.')}</li>`}</ul></div>
    <div class="c6 panel glass corner"><h2>${L('Knowledge freshness', 'עדכניות הידע')} <span class="right tag ${fr.stale ? 'warn' : 'ok'} xs">${fr.stale}</span></h2><ul class="list">${fr.checks.map((c) => `<li class="small">${tag(c.status)}<span class="grow">${esc(c.area)}<div class="xs muted" dir="auto">${esc(c.detail)}${c.status !== 'fresh' ? ` · ${esc(he() ? c.actionHe : c.action)}` : ''}</div></span></li>`).join('')}</ul></div>
    <div class="c6 panel glass corner"><h2>${L('Capability R&D', 'מחקר ופיתוח יכולות')}</h2><p class="xs muted">${esc(rd.policy)}</p>
      <ul class="list">${rd.items.map((i) => `<li class="small">${tag(i.kind === 'existing-capability' ? 'tested' : 'proposed', i.kind)}<span class="grow">${i.tool ? `<span class="mono xs">${esc(i.tool)}</span> · ` : ''}×${i.count}<div class="xs muted" dir="auto">${esc(i.requests.join(' · '))}</div><div class="xs" dir="auto">${esc(he() ? i.feasibilityHe : i.feasibility)}</div></span></li>`).join('') || `<li class="empty">${L('No unmet requests detected.', 'לא זוהו בקשות שלא נענו.')}</li>`}</ul>
      <details style="margin-top:8px"><summary class="xs muted">${L('Roadmap items', 'פריטי מפת דרכים')} (${rd.roadmap.length})</summary><ul class="list">${rd.roadmap.map((r) => `<li class="xs">${tag(r.status === 'blocked' ? 'missing' : 'stale', r.status)}<span class="grow">${esc(r.capability)}<div class="muted">${esc(r.evidence)}</div></span></li>`).join('')}</ul></details></div></div>`;
  $$('[data-sa]', el).forEach((b) => { b.onclick = async () => { try { await api(`${B}/suggestions/${encodeURIComponent(b.dataset.sid)}/${b.dataset.sa}`, { method: 'POST', body: {} }); toast(L('Done', 'בוצע')); } catch (err) { toast(err.message); } redraw(); }; });
}
