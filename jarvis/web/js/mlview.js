// Neural Lab (ML layer), Knowledge Graph and Database screens.
import { api, esc, toast, $, $$, money } from './api.js';
import { getLang } from './i18n.js';
import { lineChart } from './charts.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
const nz = (x) => (x ?? '–');
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message); return null; } };
const post = (p, body = {}) => api(p, { method: 'POST', body });
const TYPE_COLORS = { person: '#2ee6ff', org: '#8a6cff', place: '#22e08a', project: '#ffbf3c', date: '#ff8fb1', 'person-or-org': '#9fe8ff' };

// ---------- network architecture visual ----------
function netSvg(sizes, { w = 520, h = 190 } = {}) {
  const show = sizes.map((n) => Math.min(n, 10));
  const xs = show.map((_, i) => 40 + (i * (w - 80)) / (show.length - 1));
  const pos = show.map((n, i) => Array.from({ length: n }, (_, j) => [xs[i], 20 + ((j + 0.5) * (h - 40)) / n]));
  let g = '';
  for (let l = 0; l < pos.length - 1; l++) for (const a of pos[l]) for (const b of pos[l + 1]) g += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="nn-edge"/>`;
  pos.forEach((layer, l) => { layer.forEach(([x, y], j) => { g += `<circle cx="${x}" cy="${y}" r="5" class="nn-node" style="animation-delay:${(l * 0.25 + j * 0.05).toFixed(2)}s"/>`; }); g += `<text x="${xs[l]}" y="${h - 2}" text-anchor="middle" class="nn-lbl">${sizes[l]}${l === 0 ? ' in' : l === sizes.length - 1 ? ' out' : ' ReLU'}</text>`; });
  return `<svg class="nn-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="network architecture" dir="ltr">${g}</svg>`;
}
function confusionSvg(cm, labels) {
  const n = labels.length; const c = 16; const pad = 120; const max = Math.max(1, ...cm.flat());
  let g = '';
  cm.forEach((row, i) => row.forEach((v, j) => { g += `<rect x="${pad + j * c}" y="${10 + i * c}" width="${c - 1}" height="${c - 1}" fill="${i === j ? '#22e08a' : '#ff5d6c'}" fill-opacity="${v ? 0.15 + (0.85 * v) / max : 0.04}"><title>${esc(labels[i])} → ${esc(labels[j])}: ${v}</title></rect>`; }));
  labels.forEach((l, i) => { g += `<text x="${pad - 4}" y="${10 + i * c + 11}" text-anchor="end" class="nn-lbl">${esc(l.replace(/^(wealth|briefing|brain)\./, ''))}</text>`; });
  return `<svg viewBox="0 0 ${pad + n * c + 10} ${20 + n * c}" class="cm-svg" dir="ltr">${g}</svg>`;
}

// ===================================================== Neural Lab
export async function neuralView(v) {
  const [st, fc, an, cats, cl] = await Promise.all([api('/api/ml/status'), api('/api/ml/forecast'), api('/api/ml/anomalies'), api('/api/ml/categories'), api('/api/ml/clusters')]);
  const intent = st.models.find((m) => m.name === 'intent-router');
  const detail = intent ? await api(`/api/ml/models/${intent.id}`) : null;
  const M = detail?.metrics;
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Neural Lab', 'מעבדת רשתות נוירונים')} <span class="right row">
      <span class="tag ${st.routing.enabled ? 'ok' : ''} xs">${L('neural routing', 'ניתוב נוירוני')}: ${st.routing.enabled ? L('on', 'פעיל') : L('off', 'כבוי')}</span>
      <button id="trI" class="btn primary sm">🧠 ${L('Train intent network', 'אמן רשת כוונות')}</button><button id="trC" class="btn sm">₪ ${L('Train categorizer', 'אמן מסווג הוצאות')}</button></span></h2>
      <p class="xs muted">${L('All models train on this device from your own data. Weights contain hashed features only (no raw text). The neural router becomes active only after a sandbox experiment and your approval.', 'כל המודלים מתאמנים על המכשיר הזה מהנתונים שלך. המשקולות מכילות רק תכונות מגובבות (בלי טקסט גולמי). הניתוב הנוירוני נכנס לפעולה רק אחרי ניסוי בסביבה מבודדת ואישורך.')}</p></div>
    ${detail ? `<div class="c7 panel glass corner"><h2>${L('Intent network', 'רשת הכוונות')} v${detail.version} <span class="right row"><span class="tag ${detail.status === 'champion' ? 'ok' : 'info'} xs">${esc(detail.status)}</span><span class="tag ${detail.intact ? 'ok' : 'bad'} xs">${detail.intact ? '🔏 signed' : 'tampered'}</span></span></h2>
      ${netSvg(detail.config.architecture.match(/\d+/g).map(Number))}
      <div class="xs muted mono" dir="ltr">${esc(detail.config.architecture)} · ${esc(detail.config.optimizer)} · ${nz(detail.parameters)} params</div>
      <div class="row xs" style="margin-top:6px">${[[L('held-out accuracy', 'דיוק על נתוני בדיקה'), pct(M.testAccuracy)], ['macro-F1', nz(M.macroF1)], [L('routing precision', 'דיוק ניתוב'), pct(M.routedPrecision)], [L('coverage', 'כיסוי'), pct(M.routedCoverage)], [L('false routes', 'ניתובים שגויים'), M.falseRoutes], ['ECE', M.calibration?.ece], [L('train', 'אימון'), `${M.trainSize} · ${M.trainMs} ms`]].map(([k, x]) => `<span class="tag xs">${esc(k)}: ${esc(String(x))}</span>`).join('')}</div>
      <h3 class="small">${L('Training curve', 'עקומת אימון')}</h3>${lineChart(detail.history.map((h) => ({ ...h, valLoss: h.valLoss ?? h.loss })), { keys: ['loss', 'valLoss'], colors: ['#2ee6ff', '#ffbf3c'], labels: (h) => String(h.epoch), fmt: (x) => x.toFixed(2) })}
      <div class="row">${detail.status !== 'champion' ? `<button id="prM" class="btn sm">⇧ ${L('Promote to champion', 'קדם לאלוף')}</button>` : ''}${!st.routing.enabled || st.routing.modelId !== detail.id ? `<button id="prR" class="btn ok sm">🧪 ${L('Test in production pipeline', 'בדוק בצינור הייצור')}</button>` : ''}</div></div>
    <div class="c5 panel glass corner"><h2>${L('Try it', 'נסו')}</h2><form id="plF" class="row"><input name="t" class="grow" dir="auto" placeholder="${L('e.g. what bills do I have to pay this week', 'למשל: אילו חשבונות צריך לשלם השבוע')}" aria-label="text"><button class="btn primary sm">▶</button></form><div id="plOut" style="margin-top:8px"></div>
      <h3 class="small" style="margin-top:12px">${L('Confusion matrix (held-out)', 'מטריצת בלבול (נתוני בדיקה)')}</h3>${confusionSvg(M.confusion, detail.labels)}
      <h3 class="small">${L('Calibration', 'כיול')}</h3><div class="row xs">${M.calibration.bins.map((b) => `<span class="tag xs" dir="ltr">${b.range.map((x) => x.toFixed(1)).join('-')}: ${b.n ? `${pct(b.accuracy)} / ${pct(b.confidence)}` : '–'}</span>`).join('')}</div></div>`
    : `<div class="c12 panel glass corner"><p class="empty">${L('No intent network yet: press "Train intent network" (takes a few seconds).', 'עדיין אין רשת כוונות: לחצו "אמן רשת כוונות" (לוקח כמה שניות).')}</p></div>`}
    <div class="c8 panel glass corner"><h2>${L('Spending forecast', 'תחזית הוצאות')} <span class="right xs muted">${esc(fc.total.method ?? fc.total.note ?? '')}</span></h2><div id="fcOut"></div>
      <table>${fc.categories.slice(0, 6).map((c) => `<tr><td class="xs">${esc(c.category)}</td><td class="xs" dir="ltr">${c.forecast.map((f) => `${money(f.value)} [${money(Math.max(0, f.low))}–${money(f.high)}]`).join(' · ')}</td><td class="xs muted">α=${c.alpha} β=${c.beta} · MAPE ${Math.round(c.mape * 100)}%</td></tr>`).join('')}</table><p class="xs muted">${esc(fc.note)}</p></div>
    <div class="c4 panel glass corner"><h2>${L('Unusual expenses', 'הוצאות חריגות')}</h2><ul class="list">${an.anomalies.slice(0, 8).map((a) => `<li class="small"><span class="tag warn xs">z ${a.score}</span><span class="grow" dir="auto">${esc(a.description)}<div class="xs muted">${esc(a.category)} · ${esc(a.date)} · ${L('median', 'חציון')} ${money(a.median)}</div></span><b class="num">${money(-a.amount)}</b></li>`).join('') || `<li class="empty">${L('Nothing unusual.', 'אין חריגות.')}</li>`}</ul><p class="xs muted">${esc(an.method)}</p></div>
    <div class="c6 panel glass corner"><h2>${L('Category suggestions (Naive Bayes)', 'הצעות סיווג (Naive Bayes)')}</h2>${cats.status === 'no-model' ? `<p class="empty">${L('Train the categorizer first.', 'אמנו קודם את מסווג ההוצאות.')}</p>` : `<p class="xs muted">${esc(cats.note)} · LOO ${pct(cats.looAccuracy)}</p><ul class="list">${cats.suggestions.map((x) => `<li class="small"><span class="grow" dir="auto">${esc(x.description)} → <b>${esc(x.category)}</b><div class="xs muted">p=${x.prob} · ${x.examples} ${L('examples', 'דוגמאות')} · ${x.matchingWords} ${L('matching words', 'מילים תואמות')}</div></span><button class="btn ok sm" data-cat="${x.transactionId}">✓</button></li>`).join('') || `<li class="empty">${L('No confident suggestions.', 'אין הצעות בטוחות.')}</li>`}</ul>`}</div>
    <div class="c6 panel glass corner"><h2>${L('Unmet requests (k-means)', 'בקשות שלא נענו (k-means)')}</h2>${cl.clusters?.length ? `<p class="xs muted">k=${cl.k}${cl.silhouette != null ? ` · silhouette ${cl.silhouette}` : ''}</p><ul class="list">${cl.clusters.map((c) => `<li class="small"><span class="tag info xs">×${c.members.length}</span><span class="grow" dir="auto"><b>${esc(c.label)}</b><div class="xs muted">${esc(c.members.slice(0, 4).join(' · '))}</div></span></li>`).join('')}</ul>` : `<p class="empty">${L('No unmet requests yet.', 'אין עדיין בקשות שלא נענו.')}</p>`}</div>
    <div class="c12 panel glass corner"><h2>${L('Model registry', 'מאגר המודלים')}</h2><table><tr><th>model</th><th>v</th><th>algorithm</th><th>status</th><th>${L('quality', 'איכות')}</th><th></th></tr>${st.models.map((m) => `<tr><td class="xs mono">${esc(m.name)}</td><td class="xs">${m.version}</td><td class="xs">${esc(m.algorithm)}</td><td><span class="tag ${m.status === 'champion' ? 'ok' : m.status === 'retired' ? '' : 'info'} xs">${esc(m.status)}</span></td><td class="xs">${m.metrics?.testAccuracy != null ? `acc ${pct(m.metrics.testAccuracy)} · F1 ${m.metrics.macroF1} · route-prec ${pct(m.metrics.routedPrecision)}` : m.metrics?.looAccuracy != null ? `LOO ${pct(m.metrics.looAccuracy)}` : ''}</td><td class="xs">${m.intact ? '🔏' : '⚠'}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div></div>`;
  if (fc.total.status === 'ok') {
    const hist = fc.history.map((x, i) => ({ label: fc.months[i].slice(2), actual: x, forecast: null }));
    const fut = fc.total.forecast.map((f) => ({ label: `+${f.step}`, actual: null, forecast: f.value, low: f.low, high: f.high }));
    const series = [...hist, ...fut].map((x, i, a) => ({ ...x, actual: x.actual ?? (i === hist.length ? a[i - 1]?.actual : null) ?? x.forecast, forecast: x.forecast ?? x.actual }));
    $('#fcOut').innerHTML = lineChart(series, { keys: ['actual', 'forecast'], colors: ['#2ee6ff', '#8a6cff'], labels: (x) => x.label, fmt: (x) => money(x) });
  } else $('#fcOut').innerHTML = `<p class="empty">${esc(fc.total.note)}</p>`;
  const busy = async (btn, fn) => { btn.disabled = true; const t = btn.textContent; btn.textContent = '…'; await fn(); btn.disabled = false; btn.textContent = t; };
  $('#trI').onclick = (e) => busy(e.target, async () => { const m = await act(() => post('/api/ml/train/intent'), L('Trained', 'אומן')); if (m) neuralView(v); });
  $('#trC').onclick = (e) => busy(e.target, async () => { const m = await act(() => post('/api/ml/train/categorizer'), L('Trained', 'אומן')); if (m) neuralView(v); });
  $('#prM')?.addEventListener('click', async () => { await act(() => post(`/api/ml/models/${detail.id}/promote`), L('Promoted', 'קודם')); neuralView(v); });
  $('#prR')?.addEventListener('click', async () => { const p = await act(() => post(`/api/ml/models/${detail.id}/propose-routing`), L('Proposal created in Self-Improvement → Agent Intelligence', 'נוצרה הצעה בשיפור עצמי ← אינטליגנציית סוכנים')); if (p) location.hash = '#learn'; });
  $$('[data-cat]', v).forEach((b) => { b.onclick = async () => { await act(() => post(`/api/ml/categories/${b.dataset.cat}/apply`), L('Applied', 'הוחל')); neuralView(v); }; });
  $('#plF')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const t = e.target.t.value; if (!t) return;
    const r = await act(() => post('/api/ml/predict', { text: t, modelId: detail.id })); if (!r) return;
    $('#plOut').innerHTML = `${r.top.map((x) => `<div class="row small"><span class="mono xs grow" dir="ltr">${esc(x.label)}</span><span class="xs">${pct(x.prob)}</span></div><div class="bar ${x.label === r.decision.label && r.decision.route ? 'green' : ''}"><i style="width:${Math.round(x.prob * 100)}%"></i></div>`).join('')}
      <p class="small" style="margin-top:6px">${r.decision.route ? `✓ ${L('would route to', 'ינותב אל')} <b class="mono">${esc(r.decision.label)}</b>` : `— ${L('would not route', 'לא ינותב')}`} <span class="xs muted">(${esc(r.decision.reason)})</span></p>`;
  });
}

// ===================================================== Knowledge Graph
function layout(nodes, edges, w, h) {
  const P = new Map(nodes.map((n, i) => [n.id, { x: w / 2 + Math.cos(i * 2.4) * (40 + i * 6), y: h / 2 + Math.sin(i * 2.4) * (40 + i * 6), vx: 0, vy: 0 }]));
  for (let it = 0; it < 260; it++) {
    const t = 1 - it / 260;
    for (const a of nodes) for (const b of nodes) { if (a === b) continue; const pa = P.get(a.id); const pb = P.get(b.id); const dx = pa.x - pb.x; const dy = pa.y - pb.y; const d2 = dx * dx + dy * dy + 0.01; const f = 1800 / d2; pa.vx += (dx / Math.sqrt(d2)) * f; pa.vy += (dy / Math.sqrt(d2)) * f; }
    for (const e of edges) { const pa = P.get(e.from); const pb = P.get(e.to); if (!pa || !pb) continue; const dx = pb.x - pa.x; const dy = pb.y - pa.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 90) * 0.02 * Math.min(2, e.weight); pa.vx += (dx / d) * f; pa.vy += (dy / d) * f; pb.vx -= (dx / d) * f; pb.vy -= (dy / d) * f; }
    for (const p of P.values()) { p.vx += (w / 2 - p.x) * 0.004; p.vy += (h / 2 - p.y) * 0.004; p.x = Math.max(30, Math.min(w - 30, p.x + Math.max(-12, Math.min(12, p.vx)) * t)); p.y = Math.max(24, Math.min(h - 24, p.y + Math.max(-12, Math.min(12, p.vy)) * t)); p.vx *= 0.5; p.vy *= 0.5; }
  }
  return P;
}
export async function graphView(v) {
  const g = await api('/api/knowledge/graph');
  const w = 900; const h = 520;
  const P = layout(g.nodes, g.edges, w, h);
  const maxR = Math.max(0.0001, ...g.nodes.map((n) => n.rank));
  const svg = `<svg class="kg-svg" viewBox="0 0 ${w} ${h}" dir="ltr" role="img" aria-label="knowledge graph">
    ${g.edges.map((e) => { const a = P.get(e.from); const b = P.get(e.to); return a && b ? `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="kg-edge ${e.rel === 'mentioned_with' ? 'weak' : ''}" stroke-width="${Math.min(4, 0.6 + e.weight * 0.5)}"><title>${esc(e.rel)}</title></line>${e.rel !== 'mentioned_with' ? `<text x="${((a.x + b.x) / 2).toFixed(1)}" y="${((a.y + b.y) / 2).toFixed(1)}" class="kg-rel">${esc(e.rel)}</text>` : ''}` : ''; }).join('')}
    ${g.nodes.map((n) => { const p = P.get(n.id); const r = 7 + (n.rank / maxR) * 14; return `<g class="kg-node" data-node="${esc(n.label)}" tabindex="0"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${TYPE_COLORS[n.type] ?? '#9fe8ff'}"/><text x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}" text-anchor="middle">${esc(n.label)}</text></g>`; }).join('')}</svg>`;
  v.innerHTML = `<div class="grid">
    <div class="c12 panel glass corner"><h2>${L('Knowledge graph', 'גרף ידע')} <span class="right row"><span class="tag xs">${g.stats.nodes} ${L('entities', 'ישויות')} · ${g.stats.edges} ${L('relations', 'קשרים')}</span><button id="kgR" class="btn sm">↻ ${L('Rebuild', 'בנה מחדש')}</button></span></h2>
      <div class="row xs">${Object.entries(TYPE_COLORS).map(([t, c]) => `<span class="tag xs"><span class="dot" style="background:${c}"></span> ${esc(t)}</span>`).join('')}</div>
      <div class="kg-wrap">${g.nodes.length > 1 ? svg : `<p class="empty">${L('Tell JARVIS about people and places, e.g. "remember that my wife Dana works at Acme", or "תזכור ש אחי יואב עובד באינטל".', 'ספרו ל-JARVIS על אנשים ומקומות, למשל "תזכור ש אחי יואב עובד באינטל".')}</p>`}</div></div>
    <div class="c6 panel glass corner"><h2>${L('About', 'על')}</h2><div id="kgAbout" class="small muted">${L('Click an entity.', 'לחצו על ישות.')}</div></div>
    <div class="c6 panel glass corner"><h2>${L('How are they related?', 'מה הקשר?')}</h2><form id="kgP" class="row"><input name="a" class="grow" dir="auto" placeholder="Dana" aria-label="from"><input name="b" class="grow" dir="auto" placeholder="Acme" aria-label="to"><button class="btn primary sm">⇄</button></form><div id="kgPath" class="small" style="margin-top:8px"></div></div></div>`;
  const about = async (name) => { const r = await api(`/api/knowledge/graph/about?name=${encodeURIComponent(name)}`); $('#kgAbout').innerHTML = r.node ? `<b>${esc(r.node.label)}</b> <span class="tag xs">${esc(r.node.type)}</span> <span class="xs muted">PageRank ${r.node.rank} · ${r.node.mentions} ${L('mentions', 'אזכורים')}</span><ul class="list">${r.facts.map((f) => `<li class="xs"><span class="grow" dir="auto">${esc(f.subject)} <b>${esc(f.rel)}</b> ${esc(f.object)}</span><span class="mono muted">${esc(f.sources.map((s) => s.id).join(', '))}</span></li>`).join('')}</ul>` : '—'; };
  $$('[data-node]', v).forEach((n) => { n.onclick = () => about(n.dataset.node); n.onkeydown = (e) => { if (e.key === 'Enter') about(n.dataset.node); }; });
  $('#kgR').onclick = async () => { await act(() => post('/api/knowledge/graph/rebuild'), L('Rebuilt', 'נבנה מחדש')); graphView(v); };
  $('#kgP').onsubmit = async (e) => { e.preventDefault(); const r = await act(() => api(`/api/knowledge/graph/path?a=${encodeURIComponent(e.target.a.value)}&b=${encodeURIComponent(e.target.b.value)}`)); if (!r) return; $('#kgPath').innerHTML = r.found ? r.steps.map((s) => `<div dir="auto">${esc(s.fromLabel)} —<b>${esc(s.rel)}</b>→ ${esc(s.toLabel)} <span class="xs muted mono">${esc(s.sources.map((x) => x.id).join(', '))}</span></div>`).join('') : `<span class="muted">${L('No connection found.', 'לא נמצא קשר.')}${r.missing?.length ? ` (${esc(r.missing.join(', '))})` : ''}</span>`; };
}

// ===================================================== Database
export async function databaseView(v) {
  const st = await api('/api/db/status');
  const samples = ['SELECT category, ROUND(SUM(-amount), 2) AS spent FROM v_transactions WHERE amount < 0 GROUP BY category ORDER BY spent DESC', 'SELECT state, COUNT(*) AS n, ROUND(AVG(duration_ms)) AS avg_ms FROM v_requests GROUP BY state', 'SELECT tool, COUNT(*) AS runs, SUM(verified) AS verified FROM v_tool_executions GROUP BY tool ORDER BY runs DESC LIMIT 15', 'SELECT target, version, status, created_by, reason FROM v_versions ORDER BY created_at DESC', 'SELECT name, version, algorithm, status, val_accuracy FROM v_ml_models', 'SELECT src, rel, dst, weight FROM v_kg_edges ORDER BY weight DESC LIMIT 20'];
  v.innerHTML = st.sql ? `<div class="grid">
    <div class="c4 panel glass corner"><h2>${L('Database', 'מסד נתונים')}</h2><div class="kv small"><span class="muted">engine</span><span>${esc(st.engine)} ${esc(st.version)}</span><span class="muted">file</span><span class="mono xs">${esc(st.file)}</span><span class="muted">schema</span><span>v${st.schemaVersion}</span><span class="muted">journal</span><span>${esc(st.journal)}</span><span class="muted">size</span><span>${(st.sizeBytes / 1024).toFixed(0)} KB</span><span class="muted">rows</span><span>${st.rows}</span><span class="muted">${L('writes', 'כתיבות')}</span><span>${st.flushes} ${L('transactions', 'טרנזקציות')} · ${st.rowsWritten} ${L('rows', 'שורות')}</span></div>
      <div class="row" style="margin-top:10px"><button id="dbI" class="btn sm">✓ ${L('Integrity check', 'בדיקת שלמות')}</button><button id="dbB" class="btn sm">⬇ ${L('Backup', 'גיבוי')}</button></div><div id="dbMsg" class="xs" style="margin-top:6px"></div>
      <h3 class="small" style="margin-top:12px">${L('Views', 'תצוגות')}</h3><div class="row">${st.views.map((x) => `<span class="tag xs mono">${esc(x)}</span>`).join('')}</div></div>
    <div class="c8 panel glass corner"><h2>${L('Tables', 'טבלאות')}</h2><div style="max-height:280px;overflow:auto"><table><tr><th>collection</th><th>rows</th><th>${L('last update', 'עדכון אחרון')}</th></tr>${st.tables.map((t) => `<tr><td class="xs mono">${esc(t.collection)}</td><td class="xs">${t.rows}</td><td class="xs mono">${esc(String(t.last_update ?? '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</table></div></div>
    <div class="c12 panel glass corner"><h2>${L('SQL console (read-only)', 'קונסולת SQL (קריאה בלבד)')}</h2>
      <div class="row">${samples.map((q, i) => `<button class="btn sm" data-sq="${i}">${['spend', 'requests', 'tools', 'versions', 'models', 'graph'][i]}</button>`).join('')}</div>
      <form id="sqlF"><textarea name="sql" dir="ltr" rows="4" style="width:100%;margin-top:8px">${esc(samples[0])}</textarea><button class="btn primary sm">▶ ${L('Run', 'הרץ')}</button></form><div id="sqlOut" style="margin-top:8px;max-height:380px;overflow:auto"></div></div></div>`
    : `<div class="grid"><div class="c12 panel glass corner"><h2>${L('Database', 'מסד נתונים')}</h2><p class="small">${L('In this web app, data is stored in', 'באפליקציית הווב הזו הנתונים נשמרים ב')}: <b>${esc(st.engine)}</b>.</p><p class="xs muted">${L('Run the JARVIS server (npm start) for the dedicated SQLite database with SQL views, a read-only SQL console, backups and integrity checks.', 'הריצו את שרת JARVIS (npm start) כדי לקבל את מסד הנתונים הייעודי ב-SQLite עם תצוגות SQL, קונסולת SQL לקריאה בלבד, גיבויים ובדיקות שלמות.')}</p></div></div>`;
  if (!st.sql) return;
  $$('[data-sq]', v).forEach((b) => { b.onclick = () => { $('#sqlF').sql.value = samples[Number(b.dataset.sq)]; $('#sqlF').requestSubmit(); }; });
  $('#sqlF').onsubmit = async (e) => { e.preventDefault(); const r = await act(() => post('/api/db/query', { sql: e.target.sql.value })); if (!r) return; $('#sqlOut').innerHTML = `<div class="xs muted">${r.count} ${L('rows', 'שורות')} · ${r.ms} ms</div><table><tr>${r.columns.map((c) => `<th class="xs mono">${esc(c)}</th>`).join('')}</tr>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td class="xs" dir="auto">${esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</table>`; };
  $('#dbI').onclick = async () => { const r = await act(() => api('/api/db/integrity')); if (r) $('#dbMsg').textContent = `integrity: ${r.result}`; };
  $('#dbB').onclick = async () => { const r = await act(() => post('/api/db/backup')); if (r) $('#dbMsg').textContent = `${r.file} (${(r.sizeBytes / 1024).toFixed(0)} KB)`; };
}
