// Universal Mission Engine: a goal becomes a directed task graph (DAG) that runs to completion
// with dependencies, parallelism, approval checkpoints, pause/resume/cancel, timeouts, safe
// retries, idempotency, partial completion and recovery after a restart. Every task executes
// through Core.runFromModel, so agent allow-lists, risk ceilings and the permission policy apply.
import { now } from '../lib/store.js';
import { agentById } from '../agents/registry.js';
import { riskOf } from '../tools/index.js';
import { emitBrain } from './events.js';
import { analyzeFailure, recordFailure } from './failures.js';
import { riskRank } from './analyze.js';

const DONE = new Set(['done', 'skipped']);
const DEAD = new Set(['failed', 'rejected', 'blocked', 'cancelled', 'invalid']);
const MAX_PARALLEL = 3;

/** Validates a plan: unique ids, known deps, no cycles, known tools, and the tool must be on the agent's own allow-list. */
export function validatePlan(tasks, tools) {
  const ids = new Set();
  const out = tasks.slice(0, 20).map((t, i) => {
    const id = String(t.id ?? `t${i + 1}`).replace(/[^\w-]/g, '').slice(0, 20) || `t${i + 1}`;
    if (ids.has(id)) throw Object.assign(new Error(`duplicate task id ${id}`), { status: 400 });
    ids.add(id);
    const tool = t.tool && t.tool !== 'null' ? String(t.tool) : null;
    let agent = String(t.agent ?? '');
    const issues = [];
    if (tool && !tools[tool]) issues.push(`unknown tool ${tool}`);
    if (tool && tools[tool]) {
      // Agents never grant themselves permissions: if the planner picked an agent that may not use
      // the tool, choose an agent that may; if none may, the task is invalid and will not run.
      if (!agentById(agent)?.tools.includes(tool)) {
        const owner = ['assistant', 'finance', 'household', 'smarthome', 'knowledge', 'creative', 'executive', 'health', 'research', 'browser', 'communication', 'coding', 'automation', 'security', 'learning', 'vision', 'audio', 'computer']
          .map(agentById).find((a) => a?.tools.includes(tool));
        if (owner) agent = owner.id; else issues.push(`no agent may use ${tool}`);
      }
    }
    if (!agentById(agent)) agent = 'executive';
    return { id, title: String(t.title ?? tool ?? 'step').slice(0, 160), agent, tool, args: t.args && typeof t.args === 'object' ? t.args : {},
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [], status: issues.length ? 'invalid' : 'pending', issues, attempts: 0, result: null, evidence: [] };
  });
  for (const t of out) t.dependsOn = t.dependsOn.filter((d) => ids.has(d) && d !== t.id);
  // cycle check (Kahn)
  const indeg = Object.fromEntries(out.map((t) => [t.id, t.dependsOn.length]));
  const q = out.filter((t) => !indeg[t.id]).map((t) => t.id); let seen = 0;
  while (q.length) { const id = q.shift(); seen++; for (const t of out) if (t.dependsOn.includes(id) && --indeg[t.id] === 0) q.push(t.id); }
  if (seen !== out.length) throw Object.assign(new Error('the plan has a dependency cycle'), { status: 400 });
  return out;
}

export class Missions {
  constructor(s) { this.s = s; this.running = new Set(); }
  get(id) { return this.s.store.get('missions', id); }
  list() { return this.s.store.all('missions').slice().reverse(); }
  save(m) { m.updatedAt = now(); this.s.store.update('missions', m.id, m); }
  log(m, text) { (m.log ??= []).push({ at: now(), text }); if (m.log.length > 80) m.log.shift(); }

  /** Model-planned mission. The plan is data; it is validated before anything runs. */
  async plan(goal, { lang = 'en' } = {}) {
    const catalog = this.s.ai.toolCatalog();
    const out = await this.s.ai.ask({ complexity: 'high' }, `${this.s.ai.sysPrompt(lang)}
You are the JARVIS mission planner. Turn the goal into a small directed task graph that JARVIS can execute.
Tools (name: description; args):
${catalog.map((c) => `- ${c.name}: ${c.desc}; ${JSON.stringify(c.args)}`).join('\n')}
Agents: ${['assistant', 'finance', 'household', 'smarthome', 'knowledge', 'creative', 'executive', 'health'].join(', ')}.
Rules: at most 10 tasks; tasks without a dependency run in parallel; use "dependsOn" for real prerequisites only; "tool": null for a human/advice step; for home.control use a known entityId or plan home.devices first.
Return ONLY JSON: {"objective": string, "successCriteria": string, "constraints": string[], "tasks": [{"id": "t1", "title": string, "agent": string, "tool": string|null, "args": object, "dependsOn": string[]}]}`, String(goal));
    const { parseJson } = await import('../ai/engines.js');
    return parseJson(out.text);
  }

  create(spec, ctx = {}) {
    if (!Array.isArray(spec.tasks) || !spec.tasks.length) throw Object.assign(new Error('a mission needs at least one task'), { status: 400 });
    const tasks = validatePlan(spec.tasks, this.s.tools);
    const risk = tasks.reduce((r, t) => { if (!t.tool || !this.s.tools[t.tool]) return r; const x = riskOf(this.s.tools[t.tool], t.args); return riskRank(x) > riskRank(r) ? x : r; }, 'read');
    const m = this.s.store.insert('missions', {
      objective: String(spec.objective ?? spec.goal ?? 'Mission').slice(0, 300), goal: String(spec.goal ?? spec.objective ?? '').slice(0, 2000),
      successCriteria: String(spec.successCriteria ?? 'Every task completes and its result is verified.'), constraints: (spec.constraints ?? []).map(String).slice(0, 10),
      context: { lang: ctx.lang ?? 'en', householdId: ctx.householdId ?? this.s.householdId, actor: ctx.actor ?? 'user' },
      risk, tasks, status: 'planned', verification: 'pending', log: [], heartbeatAt: null, createdAt: now(),
    });
    emitBrain(this.s.store, 'mission.created', { missionId: m.id, tasks: tasks.length });
    this.s.audit.log(m.context.actor, 'mission.create', { id: m.id, tasks: tasks.length, risk });
    return m;
  }

  async startFromGoal(goal, ctx = {}) {
    const spec = await this.plan(goal, ctx);
    const m = this.create({ ...spec, goal }, ctx);
    return this.run(m.id);
  }

  ready(m) {
    const byId = Object.fromEntries(m.tasks.map((t) => [t.id, t]));
    for (const t of m.tasks) {
      if (t.status !== 'pending') continue;
      if (t.dependsOn.some((d) => DEAD.has(byId[d]?.status))) { t.status = 'blocked'; t.result = `prerequisite ${t.dependsOn.find((d) => DEAD.has(byId[d]?.status))} did not complete`; }
    }
    return m.tasks.filter((t) => t.status === 'pending' && t.dependsOn.every((d) => DONE.has(byId[d]?.status)));
  }

  async run(id) {
    if (this.running.has(id)) return this.get(id); // one runner per mission
    this.running.add(id);
    try {
      let m = this.get(id);
      if (!m || ['completed', 'partially_completed', 'failed', 'cancelled'].includes(m.status)) return m;
      if (m.status === 'paused') return m;
      m.status = 'running'; this.save(m);
      for (;;) {
        m = this.get(id);
        if (m.status === 'paused' || m.status === 'cancelled') return m;
        const batch = this.ready(m).slice(0, MAX_PARALLEL);
        if (!batch.length) break;
        m.heartbeatAt = now(); this.save(m);
        await Promise.all(batch.map((t) => this.runTask(m, t)));
        this.save(m);
      }
      return this.finish(this.get(id));
    } finally { this.running.delete(id); }
  }

  async runTask(m, t) {
    t.status = 'running'; t.startedAt = now(); t.attempts++;
    emitBrain(this.s.store, 'task.assigned', { missionId: m.id, taskId: t.id, agent: t.agent });
    emitBrain(this.s.store, 'agent.started', { missionId: m.id, taskId: t.id, agent: t.agent });
    if (!t.tool) { t.status = 'done'; t.result = 'advice / manual step'; t.finishedAt = now(); return; }
    const ctx = { actor: m.context.actor, householdId: m.context.householdId, lang: m.context.lang, channel: 'mission', missionId: m.id, idempotencyKey: `${m.id}:${t.id}` };
    const agent = agentById(t.agent);
    const maxAttempts = 1 + (agent?.retry?.max ?? 0);
    for (;;) {
      try {
        const r = await this.s.core.runFromModel(t.tool, t.args, ctx, t.agent);
        if (r.executed) { t.status = 'done'; t.result = r.summary; t.verified = r.verified ?? null; t.evidence.push({ at: now(), duplicate: !!r.duplicate, summary: String(r.summary ?? '').slice(0, 300) }); }
        else if (r.awaitingApproval) { t.status = 'awaiting_approval'; t.approvalId = r.approvalId; t.result = r.note; this.log(m, `${t.id} waits for approval ${r.approvalId}`); }
        else { t.status = 'failed'; t.result = r.note ?? 'not executed'; }
        break;
      } catch (e) {
        const fa = analyzeFailure(e, { risk: riskOf(this.s.tools[t.tool], t.args), tool: t.tool });
        recordFailure(this.s.store, fa, { missionId: m.id, taskId: t.id });
        // Safe retry only: transient failure, read-only operation, attempts left.
        if (fa.retrySafe && t.attempts < maxAttempts) { t.attempts++; this.log(m, `${t.id} retry after ${fa.kind} error`); await new Promise((r) => setTimeout(r, this.retryDelayMs ?? 300)); continue; }
        t.status = fa.kind === 'policy' ? 'rejected' : 'failed'; t.result = e.message; t.failure = fa;
        break;
      }
    }
    t.finishedAt = now();
  }

  /** Called when an approval is decided anywhere in JARVIS. */
  async onApprovalDecided(approvalId) {
    const m = this.s.store.all('missions', (x) => x.tasks.some((t) => t.approvalId === approvalId && t.status === 'awaiting_approval'))[0];
    if (!m) return null;
    this.settleApprovals(m);
    this.save(m);
    return this.run(m.id);
  }

  settleApprovals(m) {
    for (const t of m.tasks.filter((x) => x.status === 'awaiting_approval')) {
      const ap = this.s.store.get('approvals', t.approvalId);
      if (!ap || ap.status === 'pending') continue;
      const exec = this.s.store.get('tasks_exec', ap.taskId);
      if (ap.status === 'approved' && exec?.state === 'COMPLETED') { t.status = 'done'; t.result = exec.response; t.verified = exec.plan?.steps?.every((st) => st.verified !== false) ?? null; t.evidence.push({ at: now(), approvalId: ap.id, taskExec: exec.id }); }
      else if (ap.status === 'approved' && exec?.state === 'FAILED') { t.status = 'failed'; t.result = exec.error; }
      else if (ap.status !== 'approved') { t.status = 'rejected'; t.result = `approval ${ap.status}`; }
    }
  }

  finish(m) {
    this.settleApprovals(m);
    this.ready(m); // propagates "blocked"
    const waiting = m.tasks.some((t) => t.status === 'awaiting_approval');
    const done = m.tasks.filter((t) => DONE.has(t.status)).length;
    if (m.status === 'cancelled' || m.status === 'paused') { this.save(m); return m; }
    if (waiting) { m.status = 'waiting_approval'; this.save(m); return m; }
    const all = m.tasks.length;
    m.status = done === all ? 'completed' : done > 0 ? 'partially_completed' : 'failed';
    const executed = m.tasks.filter((t) => t.status === 'done' && t.tool);
    m.verification = executed.length && executed.every((t) => t.verified !== false) ? (executed.some((t) => t.verified === true) ? 'verified' : 'unverifiable') : done === all ? 'not_applicable' : 'incomplete';
    m.finishedAt = now();
    this.save(m);
    // Episodic memory: a factual record of what happened, used as context later.
    this.s.store.insert('episodes', { kind: 'mission', ref: m.id, text: `${m.objective}: ${m.status} (${done}/${all} tasks)`, at: now() });
    if (m.status === 'completed') emitBrain(this.s.store, 'mission.completed', { missionId: m.id, status: m.status });
    else emitBrain(this.s.store, 'mission.failed', { missionId: m.id, reason: m.status });
    return m;
  }

  pause(id) { const m = this.get(id); if (m && ['running', 'planned', 'waiting_approval'].includes(m.status)) { m.status = 'paused'; this.log(m, 'paused'); this.save(m); } return m; }
  resume(id) { const m = this.get(id); if (m?.status === 'paused') { m.status = 'running'; this.log(m, 'resumed'); this.save(m); return this.run(id); } return m; }
  cancel(id) {
    const m = this.get(id);
    if (!m || ['completed', 'partially_completed', 'failed', 'cancelled'].includes(m.status)) return m;
    for (const t of m.tasks) if (['pending', 'awaiting_approval'].includes(t.status)) { t.status = 'cancelled'; if (t.approvalId) this.s.store.update('approvals', t.approvalId, { status: 'cancelled' }); }
    m.status = 'cancelled'; m.finishedAt = now(); this.log(m, 'cancelled'); this.save(m);
    emitBrain(this.s.store, 'mission.failed', { missionId: m.id, reason: 'cancelled' });
    return m;
  }

  /** Scheduler: continue missions interrupted by a restart, and ones whose approvals were decided. */
  async tick() {
    const out = [];
    for (const m of this.s.store.all('missions', (x) => ['running', 'waiting_approval'].includes(x.status))) {
      if (this.running.has(m.id)) continue;
      for (const t of m.tasks) if (t.status === 'running') { t.status = 'pending'; this.log(m, `${t.id} recovered after interruption`); } // idempotency keys stop double execution
      this.settleApprovals(m); this.save(m);
      out.push((await this.run(m.id)).status);
    }
    return out;
  }
}
