// JARVIS CORE: intent -> context -> plan -> validate -> permissions -> approval -> execute -> verify -> respond.
// A task is only COMPLETED after every executed step's verification passed against real state.
import crypto from 'node:crypto';
import { S, transition, TERMINAL } from './states.js';
import { parse } from './intent.js';
import { agentById, validate } from '../agents/registry.js';
import { riskOf } from '../tools/index.js';
import { now } from '../lib/store.js';
import { bus } from '../lib/events.js';
import { detectLang, t } from '../lib/i18n.js';
import { analyzeRequest, clarifyQuestion, fillValue, riskRank } from '../brain/analyze.js';
import { emitBrain } from '../brain/events.js';
import { analyzeFailure, recordFailure } from '../brain/failures.js';

function withTimeout(p, ms, label) {
  let timer;
  const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

const AREA_WORDS = [
  [/downstairs|למטה|קומה תחתונה/, (d) => d.floor === 'downstairs'],
  [/upstairs|למעלה|קומה עליונה/, (d) => d.floor === 'upstairs'],
  [/living room|סלון/, (d) => d.area === 'living room'],
  [/kitchen|מטבח/, (d) => d.area === 'kitchen'],
  [/bedroom|חדר שינה/, (d) => d.area === 'bedroom'],
];
const APPROVAL_TTL_MS = 15 * 60e3;

/** Stable hash of exactly what will run. An approval is only valid for this hash. */
export function actionHash(step) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return crypto.createHash('sha256').update(JSON.stringify({ tool: step.tool, agent: step.agent, args: canon(stripCtx(step.args)) })).digest('hex');
}

export class Core {
  constructor(services) {
    Object.assign(this, services);
    this.conversations = new Map();
  }

  convo(id) {
    if (!this.conversations.has(id)) this.conversations.set(id, { history: [], lastSteps: [], lastEntities: [] });
    return this.conversations.get(id);
  }

  emit(task) { if (!this.store.silent) bus.emit('event', { type: 'task', data: publicTask(task) }); }
  save(task) { this.store.update('tasks_exec', task.id, task); this.emit(task); }

  /** Expands abstract home steps ("lights downstairs") into concrete device steps. */
  async resolve(step, convo) {
    if (step.tool !== 'home.control' || step.args.entityId) return [step];
    const devices = await this.home.devices();
    let targets;
    if (step.args.useLast && convo.lastEntities.length) targets = devices.filter((d) => convo.lastEntities.includes(d.id));
    else if (step.args.query === 'climate') targets = devices.filter((d) => d.domain === 'climate').slice(0, 1);
    else {
      const q = String(step.args.query ?? '').toLowerCase();
      targets = devices.filter((d) => d.domain === (step.args.domain ?? 'light'));
      const named = targets.filter((d) => q.includes(d.name.toLowerCase()));
      const filters = AREA_WORDS.filter(([re]) => re.test(q)).map(([, f]) => f);
      if (named.length) targets = named;
      else if (filters.length) targets = targets.filter((d) => filters.some((f) => f(d)));
    }
    if (!targets.length) throw new Error('No matching device found');
    return targets.map((d) => ({ ...step, args: { entityId: d.id, action: step.args.action, data: step.args.data } }));
  }

  lang(message) {
    const pref = this.personality?.get().language;
    return pref && pref !== 'auto' ? pref : detectLang(message);
  }

  async handle(message, { conversationId = 'default', actor = 'user', channel = 'text', householdId, deviceId = null } = {}) {
    const convo = this.convo(conversationId);
    const started = Date.now();
    // A pending clarification: this message is probably the answer to our question.
    if (convo.pending && actor === convo.pending.actor) {
      const p = convo.pending;
      const fresh = parse(message, convo);
      const looksNew = fresh.some((st) => !['llm.answer', 'chat.smalltalk'].includes(st.tool));
      const task = this.store.get('tasks_exec', p.taskId);
      if (!looksNew && task && task.state === S.AWAITING_INPUT) {
        const tool = this.tools[p.tool];
        const value = fillValue(p.field, tool.input?.[p.field], message);
        if (value === null) { task.response = clarifyQuestion(p.tool, p.field, task.lang); this.save(task); return publicTask(task); }
        const steps = p.steps.map((st) => (st.tool === p.tool ? { ...st, args: { ...st.args, [p.field]: value } } : st));
        convo.pending = null;
        transition(task, S.PLANNING, `clarified ${p.field}`);
        try { const out = await this.plan(task, steps, convo, `${task.objective} · ${message}`); this.recordVoice(task, started); return out; } catch (e) { return this.fail(task, e); }
      }
      if (task && task.state === S.AWAITING_INPUT) { transition(task, S.CANCELLED, 'superseded by a new request'); this.save(task); }
      convo.pending = null;
    }
    const lang = this.lang(message);
    const task = this.store.insert('tasks_exec', {
      objective: message, state: S.PENDING, history: [], channel, conversationId, actor, householdId, deviceId, lang,
      plan: null, results: [], approvalId: null, response: null, startedAt: now(),
    });
    try {
      transition(task, S.PLANNING); this.emit(task);
      const resolved = [];
      for (const st of this.learned(parse(message, convo), message)) resolved.push(...(await this.resolve(st, convo)));
      emitBrain(this.store, 'request.received', { taskId: task.id, kind: 'pending-analysis', lang });
      const out = await this.plan(task, resolved, convo, message);
      this.recordVoice(task, started);
      return out;
    } catch (e) {
      return this.fail(task, e);
    }
  }

  /** Learned phrases (versioned, read-only targets) apply only where the deterministic parser had no rule. */
  learned(steps, message) {
    if (steps.length === 1 && steps[0].tool === 'llm.answer' && !steps[0].args?.deep) return this.learn?.aliasFor(message) ?? steps;
    return steps;
  }

  /** Analysis -> clarification or plan -> permissions -> run. */
  async plan(task, resolved, convo, message) {
    const { actor, lang } = task;
    const analysis = analyzeRequest(message, resolved, this.tools);
    task.analysis = analysis;
    if (analysis.missing.length) {
      const m0 = analysis.missing[0];
      convo.pending = { taskId: task.id, steps: resolved, tool: m0.tool, field: m0.field, actor };
      transition(task, S.AWAITING_INPUT, `missing ${m0.tool}.${m0.field}`);
      task.response = clarifyQuestion(m0.tool, m0.field, lang);
      this.save(task);
      return publicTask(task);
    }
    // Context: only general/family/work memories are used as conversational context.
    const memories = this.memory.search(message, { k: 4 });
    const steps = resolved.map((st, i) => {
      const tool = this.tools[st.tool];
      if (!tool) throw new Error(`unknown tool ${st.tool}`);
      const agent = agentById(st.agent);
      if (!agent) throw new Error(`unknown agent ${st.agent}`);
      const args = st.tool === 'llm.answer' ? { ...st.args, memories, history: convo.history.slice(-8) } : st.args;
      const errors = validate(tool.input, args);
      if (errors.length) throw new Error(`invalid input for ${st.tool}: ${errors.join(', ')}`);
      const risk = riskOf(tool, args);
      let permission = this.policy.effective({ name: tool.name, risk, alwaysConfirm: tool.alwaysConfirm }, agent);
      // An agent can never act above its own risk ceiling, whatever the policy says.
      if (riskRank(risk) > riskRank(agent.riskLimit ?? 'external') && permission !== 'deny') permission = 'deny';
      const step = { n: i + 1, agent: st.agent, tool: st.tool, args, risk, permission, status: 'pending' };
      step.hash = actionHash(step);
      return step;
    });
    const byAgent = {};
    for (const st of steps) byAgent[st.agent] = (byAgent[st.agent] ?? 0) + 1;
    for (const [a, n] of Object.entries(byAgent)) {
      const budget = this.policy.stepBudget(agentById(a));
      if (n > budget) throw new Error(`agent ${a} exceeded its step limit (${n} > ${budget})`);
    }
    const agents = [...new Set(steps.map((st) => st.agent))];
    task.plan = {
      objective: message,
      kind: analysis.kind, strategy: analysis.strategy, complexity: analysis.complexity, risk: analysis.risk, confidence: analysis.confidence,
      autonomy: this.policy.autonomy(),
      coordinator: agents.length > 1 ? 'executive' : agents[0],
      delegation: agents.length > 1 ? agents.map((a) => ({ to: a, steps: steps.filter((st) => st.agent === a).map((st) => st.n) })) : [],
      context: { memories: memories.map((m) => ({ id: m.id, content: m.content, provenance: m.provenance, score: m.score })) },
      agents,
      tools: [...new Set(steps.map((st) => st.tool))],
      steps,
      dependencies: steps.map((st, i) => ({ step: st.n, after: i ? [i] : [] })),
      permissions: steps.map((st) => ({ step: st.n, risk: st.risk, decision: st.permission })),
      successCriteria: 'Every executed step returns without error and passes its state verification.',
      verification: 'Tool-specific verify() re-reads the real state (store, device, provider).',
      recovery: 'Stop at the first failure, keep completed steps, report exactly what did and did not happen. Destructive steps are never retried automatically.',
    };
    const denied = steps.filter((st) => st.permission === 'deny');
    if (denied.length) {
      for (const st of denied) this.audit.log(actor, 'permission.denied', { tool: st.tool, agent: st.agent }, 'denied');
      throw new Error(t(lang, 'denied', { list: denied.map((st) => st.tool).join(', ') }));
    }
    this.audit.log(actor, 'task.planned', { taskId: task.id, tools: task.plan.tools, autonomy: task.plan.autonomy, strategy: analysis.strategy });
    // Learning: explicit preferences in what the user says are queued for review (never auto-verified).
    if (actor === 'user' && !steps.some((st) => st.tool === 'memory.remember')) { const l = this.learning?.observe(message); if (l && !l.duplicate) task.learned = { id: l.id, content: l.content }; }
    convo.lastSteps = steps.map(({ agent, tool, args }) => ({ agent, tool, args: stripCtx(args) }));
    convo.history.push({ role: 'user', content: message });
    return this.run(task);
  }

  recordVoice(task, started) {
    task.durationMs = Date.now() - started;
    const pv = this.store.getMeta('privacy', {});
    if (['voice', 'watch'].includes(task.channel) && pv.storeTranscripts !== false) {
      this.store.insert('voice_transcripts', { taskId: task.id, text: task.objective, response: task.response, channel: task.channel, deviceId: task.deviceId });
    }
  }

  ctxFor(task) {
    return { actor: task.actor, householdId: task.householdId, channel: task.channel, lang: task.lang ?? 'en', deviceId: task.deviceId };
  }

  async run(task) {
    const convo = this.convo(task.conversationId);
    const lang = task.lang ?? 'en';
    const advisory = task.plan.steps.filter((s) => s.permission === 'advise');
    if (task.state === S.PLANNING) transition(task, S.EXECUTING);
    this.save(task);
    for (const step of task.plan.steps) {
      if (step.status === 'done' || step.permission === 'advise') { if (step.permission === 'advise') step.status = 'proposed'; continue; }
      if (step.permission === 'approve' && !step.approved) {
        const ap = this.store.insert('approvals', {
          taskId: task.id, step: step.n, tool: step.tool, agent: step.agent, risk: step.risk,
          summary: describe(step, lang), consequences: consequences(step, lang), args: stripCtx(step.args),
          actionHash: step.hash, status: 'pending', requestedAt: now(), expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
        });
        task.approvalId = ap.id;
        transition(task, S.AWAITING_APPROVAL, `step ${step.n} ${step.tool}`);
        task.response = t(lang, 'approval_needed', { d: ap.summary });
        this.save(task);
        await this.notifications.send({ title: lang === 'he' ? 'נדרש אישור' : 'Approval required', body: ap.summary, priority: 'high', event: 'approval', approvalId: ap.id });
        this.audit.log(task.actor, 'approval.requested', { taskId: task.id, tool: step.tool, risk: step.risk, actionHash: step.hash });
        emitBrain(this.store, 'approval.required', { approvalId: ap.id, tool: step.tool });
        return publicTask(task);
      }
      const tool = this.tools[step.tool];
      try {
        emitBrain(this.store, 'tool.invoked', { tool: step.tool, risk: step.risk, decision: step.permission });
        const out = await withTimeout(tool.run(step.args, this.ctxFor(task)), agentById(step.agent)?.timeoutMs ?? 30000, step.tool);
        emitBrain(this.store, 'tool.completed', { tool: step.tool, ok: true });
        this.evidence({ taskId: task.id, tool: step.tool, agent: step.agent, args: stripCtx(step.args), risk: step.risk, decision: step.permission, summary: out.summary, executed: true });
        step.status = 'done';
        step.summary = out.summary;
        step.data = out.data;
        if (out.output) (task.outputs ??= []).push(out.output); // files / apps the step produced
        this.audit.log(task.actor, `tool.${step.tool}`, { taskId: task.id, agent: step.agent, args: redact(stripCtx(step.args)) });
        if (step.tool === 'home.control') convo.lastEntities = task.plan.steps.filter((s) => s.tool === 'home.control').map((s) => s.args.entityId);
      } catch (e) {
        step.status = 'failed'; step.error = e.message;
        this.audit.log(task.actor, `tool.${step.tool}`, { taskId: task.id, error: e.message }, 'error');
        return this.fail(task, e);
      }
      this.save(task);
    }
    transition(task, S.VERIFYING); this.save(task);
    for (const step of task.plan.steps.filter((s) => s.status === 'done')) {
      const tool = this.tools[step.tool];
      const ok = tool.verify ? await tool.verify({ data: step.data }, step.args) : true;
      step.verified = !!ok;
      emitBrain(this.store, 'verification.completed', { tool: step.tool, verified: step.verified });
      if (!ok) return this.fail(task, new Error(`verification failed for step ${step.n} (${step.tool})`));
    }
    transition(task, S.COMPLETED);
    const parts = task.plan.steps.filter((s) => s.status === 'done').map((s) => s.summary).filter(Boolean);
    if (advisory.length) parts.push(`${t(lang, 'advisory')}\n${advisory.map((s) => `- ${describe(s, lang)}`).join('\n')}`);
    task.response = parts.join('\n\n');
    task.finishedAt = now();
    convo.history.push({ role: 'assistant', content: task.response });
    this.save(task);
    return publicTask(task);
  }

  async decide(approvalId, decision, actor = 'user') {
    const ap = this.store.get('approvals', approvalId);
    if (!ap || ap.status !== 'pending') throw Object.assign(new Error('approval not pending'), { status: 409 });
    const task = this.store.get('tasks_exec', ap.taskId);
    const lang = task.lang ?? 'en';
    // Silence is never consent: an approval that waited too long can only be re-requested.
    if (Date.parse(ap.expiresAt) <= Date.now()) {
      this.store.update('approvals', ap.id, { status: 'expired' });
      this.audit.log(actor, 'approval.expired', { approvalId, taskId: task.id }, 'denied');
      if (!TERMINAL.has(task.state)) { transition(task, S.CANCELLED, 'approval expired'); task.response = t(lang, 'cancelled', { d: ap.summary }); this.save(task); }
      throw Object.assign(new Error('approval expired; ask again'), { status: 410 });
    }
    const step = task.plan.steps.find((s) => s.n === ap.step);
    if (actionHash(step) !== ap.actionHash) {
      this.store.update('approvals', ap.id, { status: 'invalid' });
      this.audit.log(actor, 'approval.mismatch', { approvalId }, 'denied');
      throw Object.assign(new Error('the action changed after approval was requested'), { status: 409 });
    }
    this.store.update('approvals', ap.id, { status: decision === 'approve' ? 'approved' : 'rejected', decidedAt: now(), decidedBy: actor });
    this.audit.log(actor, `approval.${decision}`, { approvalId, taskId: task.id, tool: ap.tool, actionHash: ap.actionHash });
    if (decision !== 'approve') {
      transition(task, S.CANCELLED, 'rejected by user');
      task.response = t(lang, 'cancelled', { d: ap.summary });
      this.save(task);
      await this.onApprovalDecided?.(ap.id); // a waiting mission learns the step was rejected
      return publicTask(task);
    }
    step.approved = true;
    transition(task, S.EXECUTING, 'approved');
    const out = await this.run(task);
    await this.onApprovalDecided?.(ap.id); // the approved action has finished: a waiting mission may continue
    return out;
  }

  expireApprovals(at = Date.now()) {
    let n = 0;
    for (const ap of this.store.all('approvals', (a) => a.status === 'pending' && Date.parse(a.expiresAt) <= at)) {
      this.store.update('approvals', ap.id, { status: 'expired' });
      const task = this.store.get('tasks_exec', ap.taskId);
      if (task && !TERMINAL.has(task.state)) { transition(task, S.CANCELLED, 'approval expired'); task.response = t(task.lang ?? 'en', 'cancelled', { d: ap.summary }); this.save(task); }
      n++;
    }
    return n;
  }

  // ---------- model-driven tool use ----------
  /** JARVIS tools offered to a language model. Each call goes through validate + policy. */
  modelTools(ctx) {
    const SKIP = new Set(['llm.answer', 'research.web', 'research.fetch', 'vision.describe', 'automation.run', 'voice.note']);
    return Object.values(this.tools).filter((t) => !SKIP.has(t.name) && !/^(computer|ai|agents)\./.test(t.name)).map((t) => ({
      name: t.name.replace(/\./g, '_'),
      description: `${t.desc}. Risk: ${typeof t.risk === 'function' ? 'depends on the device (locks/alarms are sensitive)' : t.risk}. Returns a short summary.`.slice(0, 1000),
      inputSchema: toJsonSchema(t.input, t.name),
      execute: (input) => this.runFromModel(t.name, input ?? {}, ctx),
    }));
  }

  async runFromModel(name, input, ctx, agentId = null) {
    const tool = this.tools[name];
    if (!tool) throw new Error(`unknown tool ${name}`);
    const args = { ...input };
    if (name === 'home.control' && !args.entityId) throw new Error('call home_devices first and pass entityId');
    const errors = validate(tool.input, args);
    if (errors.length) throw new Error(errors.join(', '));
    // Idempotency: an operation that already ran under this key is never repeated.
    if (ctx.idempotencyKey) {
      const prev = this.store.all('tool_executions', (x) => x.idempotencyKey === ctx.idempotencyKey && x.executed)[0];
      if (prev) return { executed: true, duplicate: true, summary: prev.summary };
    }
    const risk = riskOf(tool, args);
    const agent = agentId ? agentById(agentId) : null;
    let decision = this.policy.effective({ name, risk, alwaysConfirm: tool.alwaysConfirm }, agent);
    if (agent && riskRank(risk) > riskRank(agent.riskLimit ?? 'external')) decision = 'deny';
    this.audit.log(`model:${ctx.actor}`, 'model.tool_call', { tool: name, risk, decision, agent: agentId });
    emitBrain(this.store, 'tool.invoked', { tool: name, risk, decision });
    if (decision === 'deny') throw new Error("not permitted by the user's permission policy");
    if (decision === 'advise') return { executed: false, note: 'Advisory mode is on: describe what you would do, do not claim it was done.' };
    if (decision === 'approve') {
      const t = await this.proposeStep(name, args, ctx);
      return { executed: false, awaitingApproval: true, approvalId: t.approvalId, note: 'Not done yet. The user must approve it in JARVIS (Approvals). Tell them that.' };
    }
    const out = await withTimeout(tool.run(args, ctx), agent?.timeoutMs ?? 60000, name);
    const ok = tool.verify ? await tool.verify({ data: out.data }, args) : true;
    emitBrain(this.store, 'tool.completed', { tool: name, ok: true });
    emitBrain(this.store, 'verification.completed', { tool: name, verified: !!ok });
    this.evidence({ tool: name, agent: agentId, args, risk, decision, summary: out.summary, executed: true, verified: tool.verify ? !!ok : null, idempotencyKey: ctx.idempotencyKey ?? null, missionId: ctx.missionId ?? null });
    if (!ok) throw new Error('the action ran but verification failed');
    return { executed: true, verified: !!tool.verify, summary: String(out.summary ?? '').slice(0, 3000) };
  }

  /** Creates a one-step task for a model-proposed sensitive action and parks it for approval. */
  async proposeStep(name, args, ctx) {
    const tool = this.tools[name];
    const step = { n: 1, agent: 'executive', tool: name, args, risk: riskOf(tool, args), permission: 'approve', status: 'pending' };
    step.hash = actionHash(step);
    const task = this.store.insert('tasks_exec', {
      objective: `(${ctx.lang === 'he' ? 'הוצע על ידי ה-AI' : 'proposed by the AI'}) ${describe(step, ctx.lang)}`, state: S.PENDING, history: [], channel: ctx.channel ?? 'text',
      conversationId: 'model', actor: ctx.actor ?? 'user', householdId: ctx.householdId, lang: ctx.lang ?? 'en', results: [], approvalId: null, response: null, startedAt: now(),
      plan: { objective: name, autonomy: this.policy.autonomy(), coordinator: 'executive', delegation: [], context: { memories: [] }, agents: ['executive'], tools: [name], steps: [step], dependencies: [], permissions: [{ step: 1, risk: step.risk, decision: 'approve' }], successCriteria: '', verification: '', recovery: '' },
    });
    transition(task, S.PLANNING);
    return this.run(task);
  }

  cancel(taskId, actor = 'user') {
    const task = this.store.get('tasks_exec', taskId);
    if (!task) return null;
    if (TERMINAL.has(task.state)) return publicTask(task);
    transition(task, S.CANCELLED, `cancelled by ${actor}`);
    for (const a of this.store.all('approvals', (x) => x.taskId === taskId && x.status === 'pending')) this.store.update('approvals', a.id, { status: 'cancelled' });
    this.save(task);
    return publicTask(task);
  }

  /** Structured execution evidence (ToolExecution / ExecutionEvidence). */
  evidence(rec) {
    return this.store.insert('tool_executions', { ...rec, summary: String(rec.summary ?? '').slice(0, 600), at: now() });
  }

  fail(task, e) {
    const lang = task.lang ?? 'en';
    const failedStep = task.plan?.steps.find((st) => st.status === 'failed');
    const fa = analyzeFailure(e, { risk: failedStep?.risk ?? 'read', tool: failedStep?.tool ?? null });
    task.failure = fa;
    recordFailure(this.store, fa, { taskId: task.id });
    if (!TERMINAL.has(task.state)) {
      if (task.state === S.PENDING) transition(task, S.PLANNING);
      transition(task, S.FAILED, e.message);
    }
    const done = task.plan?.steps.filter((s) => s.status === 'done') ?? [];
    task.error = e.message;
    task.finishedAt = now();
    task.response = `${t(lang, 'failed', { e: e.message })}${done.length ? `\n${t(lang, 'done_before')}\n${done.map((s) => `- ${s.summary}`).join('\n')}` : ''}${fa.kind !== 'input' || !/required/.test(e.message) ? `\n${lang === 'he' ? '💡 ' + fa.recommendationHe : '💡 ' + fa.recommendation}` : ''}`;
    this.save(task);
    return publicTask(task);
  }
}

function stripCtx(args) { const { memories, history, ...rest } = args ?? {}; return rest; }
function redact(args) { const r = { ...args }; if (r.image) r.image = `[${r.image.length} bytes]`; return r; }

function describe(step, lang = 'en') {
  const a = step.args; const he = lang === 'he';
  switch (step.tool) {
    case 'home.control': return he ? `אבצע ${a.action} על ${a.entityId}` : `${a.action.replace('_', ' ')} ${a.entityId}`;
    case 'wealth.transfer': return he ? `אכין בקשת ${a.action} (ג׳ארוויס לא יבצע אותה)` : `prepare a ${a.action} request (JARVIS will not execute it)`;
    case 'computer.read_file': return he ? `אקרא את הקובץ ${a.path}` : `read the file ${a.path}`;
    case 'computer.screenshot': return he ? 'אצלם את המסך' : 'capture a screenshot';
    default: return he ? `אריץ ${step.tool}` : `run ${step.tool}`;
  }
}

function consequences(step, lang = 'en') {
  const he = lang === 'he';
  if (step.tool === 'home.control' && step.args.action === 'unlock') return he ? 'הדלת תהיה לא נעולה עד שתינעל שוב.' : 'The door will stay unlocked until locked again.';
  if (step.tool === 'home.control' && /disarm/.test(step.args.action)) return he ? 'מערכת האזעקה תושבת.' : 'The alarm will be disarmed.';
  if (step.risk === 'financial') return he ? 'שום כסף לא יזוז. יירשם רק ניסיון חסום ביומן.' : 'No money moves. Only a blocked attempt is logged.';
  if (step.tool === 'computer.read_file') return he ? 'תוכן הקובץ יישלח לג׳ארוויס.' : 'The file content will be sent to JARVIS.';
  if (step.tool === 'computer.screenshot') return he ? 'תמונת המסך הנוכחית תישמר.' : 'An image of your current screen will be saved.';
  return he ? 'הפעולה תבוצע פעם אחת עם הפרמטרים שמוצגים.' : 'The action runs once with exactly the parameters shown.';
}

export function publicTask(t0) {
  const { plan, ...rest } = t0;
  return { ...rest, plan: plan && { ...plan, steps: plan.steps.map(({ data, args, ...s }) => ({ ...s, args: redact(stripCtx(args)) })) } };
}

/** Our tiny schema -> JSON Schema for model tool definitions. */
function toJsonSchema(schema = {}, name = '') {
  const properties = {}; const required = [];
  for (const [k, r] of Object.entries(schema)) {
    properties[k] = { type: r.type === 'any' ? 'string' : r.type, ...(r.enum ? { enum: r.enum } : {}) };
    if (r.required) required.push(k);
  }
  if (name === 'home.control') { properties.data = { type: 'object', description: 'e.g. {"temperature": 22} for set_temperature' }; }
  if (name === 'wealth.record') { properties.amount.description = 'amount in shekels (ILS), positive number'; properties.category = { type: 'string' }; }
  if (name === 'reminders.create') properties.at.description = 'ISO 8601 date-time';
  return { type: 'object', properties, required };
}
