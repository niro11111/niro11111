// Deterministic analyses used by the learning engine. Every function only READS the brain
// state and returns findings with the evidence they rest on; none of them changes anything.
import { normalize } from './classify.js';
import { AGENTS } from '../agents/registry.js';
import { recurring } from '../wealth/calc.js';

const DAY = 86400e3;
const pct = (a, b) => (b ? Math.round((a * 100) / b) : null);
const jaccard = (a, b) => { const A = new Set(a); const B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return A.size + B.size - i ? i / (A.size + B.size - i) : 0; };
const words = (t) => normalize(t).split(' ').filter((w) => w.length > 2);

// ---------------- mission evaluation ----------------
export function evaluateMissions(s) {
  return s.store.all('missions').slice(-100).map((m) => {
    const tasks = m.tasks ?? [];
    const done = tasks.filter((t) => t.status === 'done').length;
    const failed = tasks.filter((t) => ['failed', 'blocked', 'rejected', 'invalid'].includes(t.status)).length;
    const retries = tasks.reduce((a, t) => a + Math.max(0, (t.attempts ?? 0) - 1), 0);
    const ms = m.finishedAt && m.createdAt ? Date.parse(m.finishedAt) - Date.parse(m.createdAt) : null;
    const verified = tasks.filter((t) => t.verified === true || (t.evidence ?? []).some((e) => e.verified)).length;
    const score = tasks.length ? Math.round((done * 100) / tasks.length - retries * 5) : null;
    return { missionId: m.id, objective: m.objective, status: m.status, tasks: tasks.length, done, failed, retries, durationMs: ms, verification: m.verification, verifiedTasks: verified, score, at: m.createdAt,
      issues: [...(failed ? [`${failed} task(s) failed or blocked`] : []), ...(retries ? [`${retries} retr${retries === 1 ? 'y' : 'ies'}`] : []), ...(m.verification === 'failed' ? ['verification failed'] : [])] };
  }).reverse();
}

// ---------------- agent intelligence ----------------
export function agentIntelligence(s, evaluations) {
  const all = [...AGENTS.map((a) => ({ id: a.id, tools: a.tools, builtIn: true })), ...s.store.all('custom_agents').map((a) => ({ id: `@${a.handle}`, tools: a.tools ?? [], builtIn: false, instructions: a.instructions }))];
  const overlaps = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const sim = jaccard(all[i].tools, all[j].tools);
    if (sim >= 0.6 && all[i].tools.length && all[j].tools.length) overlaps.push({ a: all[i].id, b: all[j].id, similarity: +sim.toFixed(2), shared: all[i].tools.filter((t) => all[j].tools.includes(t)) });
  }
  const findings = [];
  const avgMs = evaluations.filter((e) => e.avgMs != null); const mean = avgMs.length ? avgMs.reduce((x, e) => x + e.avgMs, 0) / avgMs.length : null;
  for (const e of evaluations) {
    if (e.rating === 'needs-attention') findings.push({ agent: e.agent, kind: 'frequent-failures', detail: `${e.failed} of ${e.completed + e.failed} tasks failed`, recommendation: 'Review its failures in the Failures view; fix inputs or capabilities.' });
    if (mean && e.avgMs > mean * 3 && e.tasks >= 3) findings.push({ agent: e.agent, kind: 'slow', detail: `avg ${e.avgMs} ms vs ${Math.round(mean)} ms across agents`, recommendation: 'Split its responsibilities or route its model calls to a faster tier after benchmarking.' });
    if (e.deniedAttempts >= 3) findings.push({ agent: e.agent, kind: 'insufficient-permissions', detail: `${e.deniedAttempts} actions denied`, recommendation: 'Permissions are never raised automatically. Review the policy yourself if these actions should be allowed.', protected: true });
    if (e.unnecessaryWork) findings.push({ agent: e.agent, kind: 'unnecessary-work', detail: e.unnecessaryWork, recommendation: 'Reduce repeated tool calls in its plans.' });
  }
  for (const a of all.filter((x) => !x.builtIn)) {
    const p = analyzePrompt(a.instructions ?? '');
    if (p.findings.length) findings.push({ agent: a.id, kind: 'instructions', detail: p.findings.map((f) => f.note).join('; '), recommendation: 'Improve its instructions through a versioned, tested proposal.', target: `agent:${a.id.slice(1)}` });
  }
  return { overlaps, findings, agents: all.length };
}

// Repeated identical tool calls within one task = unnecessary work.
export function unnecessaryWork(s) {
  const out = {};
  for (const t of s.store.all('tasks_exec').slice(-300)) {
    const seen = new Map();
    for (const st of t.plan?.steps ?? []) { const k = `${st.tool}:${JSON.stringify(st.args ?? {})}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
    const dup = [...seen.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
    if (dup) for (const a of t.plan.agents ?? []) out[a] = (out[a] ?? 0) + dup;
  }
  return out;
}

// ---------------- prompt analysis ----------------
const VAGUE = /\b(?:maybe|perhaps|try to|as needed|if possible|somehow|etc|and so on|whatever|stuff|things|sometimes)\b|אולי|לפעמים|וכו'|בערך|איכשהו/gi;
const CONFLICTS = [
  [/\b(?:short|concise|brief|briefly|1-3 sentences)\b|קצר|תמציתי/i, /\b(?:thorough|detailed|in depth|comprehensive)\b|מפורט|מעמיק/i, 'asks for both short and detailed answers'],
  [/always (?:reply|answer) in hebrew|תמיד בעברית/i, /always (?:reply|answer) in english|תמיד באנגלית/i, 'asks for two different fixed languages'],
  [/avoid jokes|no humou?r|בלי הומור/i, /humou?r is welcome|be funny|הומור מבורך/i, 'asks both to avoid and to use humor'],
  [/never use lists|no lists|בלי רשימות/i, /bullet|lists?|רשימ/i, 'forbids lists and asks for them'],
];
export function analyzePrompt(text) {
  const t = String(text ?? '');
  const findings = [];
  const vague = [...new Set((t.match(VAGUE) ?? []).map((x) => x.toLowerCase()))];
  if (vague.length) findings.push({ kind: 'ambiguity', note: `vague wording: ${vague.join(', ')}` });
  for (const [a, b, note] of CONFLICTS) {
    const aa = t.match(a); const bb = t.match(b);
    if (aa && bb && aa.index !== bb.index) findings.push({ kind: 'conflict', note });
  }
  if (t.length > 40 && !/language|hebrew|english|שפה|עברית|אנגלית/i.test(t)) findings.push({ kind: 'missing-requirement', note: 'no language rule' });
  if (t.length > 40 && !/(?:don'?t|do not|never) (?:invent|make up|guess)|not sure|לא בטוח|אל תמציא/i.test(t)) findings.push({ kind: 'missing-requirement', note: 'no rule for uncertainty (say when unsure)' });
  return { length: t.length, findings };
}
export function promptReport(s) {
  const sys = s.personality.systemPrompt({});
  return [
    { target: 'system', label: 'System prompt (assembled)', ...analyzePrompt(sys), note: 'the safety line is fixed and always last' },
    { target: 'prompt.system_overlay', label: 'Prompt overlay', ...analyzePrompt(s.store.getMeta('promptOverlay', '')) },
    ...s.store.all('custom_agents').map((a) => ({ target: `agent:${a.handle}`, label: `@${a.handle}`, ...analyzePrompt(a.instructions) })),
  ];
}

// ---------------- knowledge freshness (quality) ----------------
export function knowledgeQuality(s) {
  const mems = s.memory.list();
  const dup = []; const conflicts = [];
  for (let i = 0; i < mems.length; i++) for (let j = i + 1; j < mems.length && j < i + 200; j++) {
    const a = mems[i]; const b = mems[j];
    const wa = words(a.content); const wb = words(b.content);
    const sim = jaccard(wa, wb);
    if (sim >= 0.85) dup.push({ a: a.id, b: b.id, similarity: +sim.toFixed(2), text: a.content.slice(0, 80) });
    else if (sim >= 0.5) {
      const na = (a.content.match(/\d+(?:[.,]\d+)?/g) ?? []).join(','); const nb = (b.content.match(/\d+(?:[.,]\d+)?/g) ?? []).join(',');
      if (na && nb && na !== nb) conflicts.push({ a: a.id, b: b.id, aText: a.content.slice(0, 80), bText: b.content.slice(0, 80), note: 'similar statements with different numbers' });
    }
  }
  const docs = s.store.all('documents');
  const incomplete = docs.filter((d) => !String(d.text ?? d.content ?? '').trim() || String(d.text ?? d.content ?? '').length < 20).map((d) => ({ id: d.id, name: d.name ?? d.title }));
  const links = [...mems, ...docs].flatMap((x) => (String(x.source ?? x.url ?? '').match(/^https?:\/\/\S+/) ? [{ id: x.id, url: x.source ?? x.url, retrievedAt: x.retrievedAt ?? x.createdAt ?? null }] : []));
  const external = s.store.all('research_cache').concat(s.store.all('research')).slice(-50).map((r) => ({ id: r.id, source: r.url ?? r.source, retrievedAt: r.retrievedAt ?? r.createdAt, publishedAt: r.publishedAt ?? null, verified: r.verified ?? false }));
  const unverifiedOverVerified = mems.filter((m) => m.provenance === 'inferred' && m.supersedes && mems.find((x) => x.id === m.supersedes)?.provenance === 'user_statement');
  return { duplicates: dup.slice(0, 20), conflicts: conflicts.slice(0, 20), incomplete, links, linksNote: links.length ? 'links are checked only on request: the engine does not browse on its own' : null, external, unverifiedOverVerified: unverifiedOverVerified.map((m) => m.id) };
}

export async function checkLinks(links, fetchImpl) {
  const out = [];
  for (const l of links.slice(0, 20)) {
    try { const r = await fetchImpl(l.url, { method: 'HEAD', signal: AbortSignal.timeout(6000) }); out.push({ ...l, status: r.status, broken: r.status >= 400 }); }
    catch (e) { out.push({ ...l, status: null, broken: true, error: e.message }); }
  }
  return out;
}

// ---------------- Family Wealth OS: validation suggestions (never changes data) ----------------
export function financeValidation(s) {
  const tx = s.store.all('transactions', (t) => t.householdId === s.householdId);
  const findings = [];
  const key = (t) => `${t.date}|${t.amount}|${normalize(t.description)}`;
  const seen = {};
  for (const t of tx) (seen[key(t)] ??= []).push(t.id);
  for (const [k, ids] of Object.entries(seen)) if (ids.length > 1) findings.push({ kind: 'possible-duplicate-import', detail: `${ids.length} identical transactions (${k.split('|')[0]}, ${k.split('|')[2]})`, refs: ids, recommendation: 'Check whether the same statement was imported twice.' });
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().getDate();
  for (const r of recurring(tx)) {
    const list = tx.filter((t) => t.description === r.description);
    const days = list.map((t) => Number(String(t.date).slice(8, 10))).filter(Boolean);
    const usual = days.length ? Math.max(...days) : 28;
    if (!list.some((t) => String(t.date).startsWith(month)) && today > usual + 3) findings.push({ kind: 'possibly-missing-import', detail: `"${r.description}" usually appears by day ${usual} and is missing this month`, refs: list.slice(-3).map((t) => t.id), recommendation: 'Import the latest statement or confirm the charge stopped.' });
  }
  const months = new Set(tx.map((t) => String(t.date).slice(0, 7))).size;
  if (s.store.all('goals').length && months < 6) findings.push({ kind: 'unreliable-forecast-assumption', detail: `goal forecasts rely on ${months} month(s) of history (fewer than 6) and an assumed volatility`, recommendation: 'Treat goal odds as rough until 6+ months of data are available.' });
  const uncategorized = tx.filter((t) => t.amount < 0 && (!t.category || t.category === 'other')).length;
  if (uncategorized >= 5) findings.push({ kind: 'categorization-gap', detail: `${uncategorized} expenses are uncategorized`, recommendation: 'Review categorization suggestions in the Learning Center.' });
  return { findings, note: 'Suggestions only. Calculations stay deterministic; no transaction, rule or policy is changed without your approval.' };
}

// ---------------- repeated manual operations → automation opportunities ----------------
const AUTOMATABLE = /^(briefing\.|tasks\.list|wealth\.(overview|bills|analysis|report)|shopping\.list|habit\.status|calendar\.today|home\.devices|notes\.list)/;
export function automationOpportunities(s) {
  const by = {};
  for (const t of s.store.all('tasks_exec', (x) => x.actor === 'user' && x.state === 'COMPLETED' && x.plan?.tools?.length === 1)) {
    const tool = t.plan.tools[0];
    if (!AUTOMATABLE.test(tool)) continue;
    const d = new Date(t.createdAt);
    (by[`${tool}|${d.getHours()}`] ??= { tool, hour: d.getHours(), days: new Set(), count: 0 }).days.add(t.createdAt.slice(0, 10));
    by[`${tool}|${d.getHours()}`].count++;
  }
  return Object.values(by).filter((x) => x.days.size >= 3).map((x) => ({
    id: `auto:${x.tool}:${x.hour}`, tool: x.tool, hour: x.hour, days: x.days.size, count: x.count,
    workflow: { name: `Daily ${x.tool} at ${String(x.hour).padStart(2, '0')}:00`, trigger: { type: 'schedule', everyMinutes: 1440, atHour: x.hour }, steps: [{ type: 'tool', tool: x.tool, args: {} }, { type: 'notify', title: `JARVIS: ${x.tool}`, body: '{{result}}' }] },
  }));
}

// ---------------- observed preference patterns (proposals only, never sensitive domains) ----------------
export function observedPatterns(s) {
  const tasks = s.store.all('tasks_exec', (t) => t.actor === 'user').slice(-300);
  const out = [];
  if (tasks.length >= 10) {
    const ch = {}; for (const t of tasks) ch[t.channel ?? 'text'] = (ch[t.channel ?? 'text'] ?? 0) + 1;
    const [top, n] = Object.entries(ch).sort((a, b) => b[1] - a[1])[0];
    if (top !== 'text' && n / tasks.length >= 0.6) out.push({ category: 'devices', key: 'preferred_channel', value: top, confidence: +(n / tasks.length).toFixed(2), evidence: `${n} of ${tasks.length} requests` });
  }
  const apps = {}; for (const t of tasks) for (const st of t.plan?.steps ?? []) if (st.tool === 'computer.open_app' && st.args?.name) apps[st.args.name] = (apps[st.args.name] ?? 0) + 1;
  for (const [app, n] of Object.entries(apps)) if (n >= 3) out.push({ category: 'applications', key: 'frequent_app', value: app, confidence: Math.min(0.9, +(n / 10).toFixed(2)), evidence: `opened ${n} times` });
  const created = s.store.all('tasks').slice(-30);
  const pri = created.filter((t) => t.priority && t.priority !== 'normal').length;
  if (created.length >= 6 && pri / created.length >= 0.6) out.push({ category: 'task_organization', key: 'organize_by', value: 'priority', confidence: +(pri / created.length).toFixed(2), evidence: `${pri} of ${created.length} tasks were given a priority` });
  const hours = tasks.map((t) => new Date(t.createdAt).getHours());
  if (hours.length >= 15) { const first = Math.min(...hours.filter((h) => h >= 4)); if (Number.isFinite(first)) out.push({ category: 'schedule', key: 'active_from', value: `${String(first).padStart(2, '0')}:00`, confidence: 0.5, evidence: `earliest activity across ${hours.length} requests` }); }
  return out;
}

// ---------------- security monitor ----------------
export function securityMonitor(s, learn) {
  const events = s.store.all('learning_security').slice(-100).reverse();
  const permission = s.audit.list(500).filter((a) => /^(permission\.|policy\.|approval|learning\.mode)/.test(a.action) || a.outcome === 'denied').slice(0, 40);
  const suspicious = [];
  const recentDenied = s.audit.list(500).filter((a) => a.outcome === 'denied' && Date.now() - Date.parse(a.at ?? a.createdAt) < DAY);
  if (recentDenied.length >= 5) suspicious.push({ kind: 'many-denials', detail: `${recentDenied.length} denied actions in 24 hours` });
  const inj = s.store.all('tasks_exec', (t) => /ignore (?:all )?previous|admin mode|system prompt|jailbreak|התעלם מכל/i.test(t.objective ?? '') && Date.now() - Date.parse(t.createdAt) < 7 * DAY);
  if (inj.length) suspicious.push({ kind: 'prompt-injection-attempts', detail: `${inj.length} request(s) with injection phrasing this week`, refs: inj.slice(-5).map((t) => t.id) });
  for (const x of learn.versions.integrity()) suspicious.push({ kind: x.kind === 'tampered' ? 'tampered-version' : 'config-drift', detail: `${x.target} v${x.version}${x.note ? `: ${x.note}` : ''}` });
  return {
    blockedChanges: events.filter((e) => /blocked|protected|tampered|unauthorized/.test(e.type)),
    events, permissionEvents: permission, suspicious,
    sandbox: { experiments: 'in-memory sandbox brain · demo data · no model · network blocked · events silenced', lab: learn.devlab.status(), secrets: 'the sandbox copies only learnable configuration; keys and tokens are never copied' },
  };
}
export { pct };
