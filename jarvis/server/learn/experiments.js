// Isolated development sandbox + regression comparison. An experiment builds TWO fresh sandbox
// brains (in-memory store, demo household, no AI model, network blocked, events silenced):
// "baseline" with the current production configuration and "candidate" with exactly one
// proposed change. Both run the full brain regression suite plus targeted replays of the real
// requests that failed. Nothing in the sandbox can reach the user's data, devices or providers.
import { createApp } from '../app.js';
import { ModelRouter } from '../core/router.js';
import { DemoHomeAdapter } from '../home/smarthome.js';
import { Store } from '../lib/store.js';
import { CASES } from '../brain/evaluation.js';
import { targetAdapter, TARGETS } from './versions.js';

async function sandbox(prod, override) {
  const store = new Store(null); store.silent = true;
  const sb = await createApp({ store, router: new ModelRouter(), home: new DemoHomeAdapter(), seed: true, fetch: async () => { throw new Error('offline: sandbox has no network'); } });
  sb.sandbox = true;
  // Mirror production's learnable configuration so the baseline is faithful.
  for (const t of Object.keys(TARGETS)) TARGETS[t].apply(sb, structuredClone(TARGETS[t].get(prod)));
  if (override?.target.startsWith('workflow:')) {
    const id = override.target.slice(9);
    const w = prod.store.get('workflows', id);
    if (w) sb.store.insert('workflows', structuredClone(w));
  }
  if (override?.value !== undefined) targetAdapter(override.target).apply(sb, structuredClone(override.value));
  return sb;
}

/** Replays are the user's own requests: identifiers are masked before they enter the sandbox. */
export const anonymize = (msg) => String(msg).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]').replace(/\b\d{5,}\b/g, '[number]');

async function runSuite(sb, replays) {
  const ask = (text, conversationId = 'exp') => sb.core.handle(text, { householdId: sb.householdId, conversationId });
  const cases = [];
  for (const [i, msg] of replays.entries()) {
    const t0 = Date.now();
    const t = await ask(msg, `replay-${i}`).catch((e) => ({ state: 'FAILED', error: e.message }));
    const ok = t.state === 'COMPLETED' && !(t.plan?.tools ?? []).includes('llm.answer');
    cases.push({ id: `replay:${msg.slice(0, 40)}`, category: 'replay', pass: ok, detail: `${t.state}${t.plan?.tools ? ` via ${t.plan.tools.join(',')}` : ''}`, ms: Date.now() - t0 });
  }
  for (const c of CASES) {
    const t0 = Date.now();
    try { const [pass, detail] = await c.run(sb, ask); cases.push({ id: c.id, category: c.category, pass: !!pass, detail: String(detail ?? ''), ms: Date.now() - t0 }); }
    catch (e) { cases.push({ id: c.id, category: c.category, pass: false, detail: `error: ${e.message}`, ms: Date.now() - t0 }); }
  }
  const approved = new Set(sb.store.all('approvals', (a) => a.status === 'approved').map((a) => a.taskId));
  const violations = sb.store.all('tool_executions', (x) => ['sensitive', 'financial'].includes(x.risk) && x.decision !== 'approve' && !approved.has(x.taskId)).length;
  const falseSuccess = sb.store.all('tasks_exec', (x) => x.state === 'COMPLETED' && x.plan?.steps?.some((st) => st.verified === false)).length;
  const passed = cases.filter((c) => c.pass).length;
  return { cases, passed, total: cases.length, passRate: Math.round((passed * 100) / cases.length), avgMs: Math.round(cases.reduce((a, c) => a + c.ms, 0) / cases.length), violations, falseSuccess };
}

/** Static checks that need no model: prompt assembly, routing decisions. */
function staticChecks(sb, target, value) {
  const out = [];
  if (target === 'prompt.system_overlay') {
    const p = sb.personality.systemPrompt({});
    const lines = p.split('\n');
    const safetyLast = /^Non-negotiable/.test(lines.at(-1));
    out.push({ check: 'overlay included in the system prompt', pass: !value || p.includes(value) });
    out.push({ check: 'safety rules still come last and are unchanged', pass: safetyLast });
    out.push({ check: 'behavioral effect on live answers', pass: null, note: 'needs a live model: measure with feedback after deployment' });
  }
  if (target === 'routing.preferences') {
    const stub = { capabilities: () => ({ vision: true, webSearch: true }), complete: async () => ({ text: '' }) };
    const r = new ModelRouter({ providers: { anthropic: stub } });
    r.setPreferences(value);
    for (const task of Object.keys(value ?? {})) out.push({ check: `"${task}" requests route to ${value[task]}`, pass: r.route({ task }).tier === value[task] });
    out.push({ check: 'local-only privacy still forces the local engine', pass: r.route({ task: Object.keys(value ?? {})[0] ?? 'general', privacy: 'local_only' }).tier === 'local' });
  }
  return out;
}

export function compare(base, cand) {
  const byId = new Map(base.cases.map((c) => [c.id, c]));
  const cats = {};
  for (const [side, run] of [['baseline', base], ['candidate', cand]]) for (const c of run.cases) { const x = (cats[c.category] ??= { baseline: { pass: 0, total: 0 }, candidate: { pass: 0, total: 0 } })[side]; x.total++; if (c.pass) x.pass++; }
  const rows = cand.cases.map((c) => {
    const b = byId.get(c.id);
    return { id: c.id, category: c.category, baseline: b?.pass ?? null, candidate: c.pass, change: b == null ? 'new' : b.pass === c.pass ? 'same' : c.pass ? 'improved' : 'regressed', baselineDetail: b?.detail, candidateDetail: c.detail, baselineMs: b?.ms, candidateMs: c.ms };
  });
  const regressions = rows.filter((r) => r.change === 'regressed');
  const improvements = rows.filter((r) => r.change === 'improved');
  return {
    rows, regressions: regressions.map((r) => r.id), improvements: improvements.map((r) => r.id), categories: cats,
    multilingual: cats.multilingual ?? null, security: { 'malicious content': cats['malicious content'] ?? null, 'permission denial': cats['permission denial'] ?? null, 'sensitive operations': cats['sensitive operations'] ?? null },
    metrics: {
      passRate: { baseline: base.passRate, candidate: cand.passRate, delta: cand.passRate - base.passRate },
      avgMs: { baseline: base.avgMs, candidate: cand.avgMs, delta: cand.avgMs - base.avgMs },
      permissionViolations: { baseline: base.violations, candidate: cand.violations },
      falseSuccess: { baseline: base.falseSuccess, candidate: cand.falseSuccess },
    },
  };
}

/**
 * @param prod the production brain (read only: its configuration is copied, never modified)
 * @param {{target:string, candidate:any, replays?:string[], requireImprovement?:boolean}} spec
 */
export async function runExperiment(prod, { target, candidate, replays = [], requireImprovement = false }) {
  const adapter = targetAdapter(target); // throws for protected targets before anything runs
  const errs = adapter.validate(prod, candidate);
  const started = Date.now();
  if (errs.length) return { target, verdict: 'invalid', reasons: errs, durationMs: 0, environment: 'sandbox' };
  const safeReplays = replays.slice(0, 10).map(anonymize);
  const base = await runSuite(await sandbox(prod, null), safeReplays);
  const candSb = await sandbox(prod, { target, value: candidate });
  const cand = await runSuite(candSb, safeReplays);
  const checks = staticChecks(candSb, target, candidate);
  const report = compare(base, cand);
  const reasons = [];
  if (report.regressions.length) reasons.push(`regressions: ${report.regressions.join(', ')}`);
  if (cand.violations > base.violations) reasons.push('new permission violations');
  if (cand.falseSuccess > base.falseSuccess) reasons.push('new false successes');
  const failedChecks = checks.filter((c) => c.pass === false);
  if (failedChecks.length) reasons.push(`failed checks: ${failedChecks.map((c) => c.check).join('; ')}`);
  const verdict = reasons.length ? 'regression' : requireImprovement && !report.improvements.length ? 'no-improvement' : 'pass';
  return {
    target, verdict, reasons, environment: 'sandbox (in-memory store, demo data, no model, no network, silenced events)',
    baseline: { passed: base.passed, total: base.total, passRate: base.passRate }, candidate: { passed: cand.passed, total: cand.total, passRate: cand.passRate },
    report, checks, replays: safeReplays, durationMs: Date.now() - started,
  };
}

/** Regression run of the CURRENT production configuration, compared with the previous run. */
export async function runRegression(prod, prev) {
  const t0 = Date.now();
  const run = await runSuite(await sandbox(prod, null), []);
  const out = { suite: 'brain-regression-v1', environment: 'sandbox', passed: run.passed, total: run.total, passRate: run.passRate, avgMs: run.avgMs, violations: run.violations, falseSuccess: run.falseSuccess, cases: run.cases, durationMs: Date.now() - t0 };
  if (prev?.cases) out.comparison = compare(prev, run);
  return out;
}
