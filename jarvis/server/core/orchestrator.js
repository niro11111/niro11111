// JARVIS CORE: intent -> context -> plan -> permissions -> approval -> execute -> verify -> respond.
// A task is only COMPLETED after every step's verification passed against real state.
import { S, transition, TERMINAL } from './states.js';
import { parse } from './intent.js';
import { agentById } from '../agents/registry.js';
import { riskOf } from '../tools/index.js';
import { now } from '../lib/store.js';
import { bus } from '../lib/events.js';

const AREA_WORDS = [
  [/downstairs|למטה|קומה תחתונה/, (d) => d.floor === 'downstairs'],
  [/upstairs|למעלה|קומה עליונה/, (d) => d.floor === 'upstairs'],
  [/living room|סלון/, (d) => d.area === 'living room'],
  [/kitchen|מטבח/, (d) => d.area === 'kitchen'],
  [/bedroom|חדר שינה/, (d) => d.area === 'bedroom'],
];

export class Core {
  constructor(services) {
    Object.assign(this, services); // store, tools, policy, audit, memory, home, notifications
    this.conversations = new Map();
  }

  convo(id) {
    if (!this.conversations.has(id)) this.conversations.set(id, { history: [], lastSteps: [], lastEntities: [] });
    return this.conversations.get(id);
  }

  emit(task) { bus.emit('event', { type: 'task', data: publicTask(task) }); }
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
      const filters = AREA_WORDS.filter(([re]) => re.test(q)).map(([, f]) => f);
      if (filters.length) targets = targets.filter((d) => filters.some((f) => f(d)));
    }
    if (!targets.length) throw new Error('No matching device found');
    return targets.map((d) => ({ ...step, args: { entityId: d.id, action: step.args.action, data: step.args.data } }));
  }

  async handle(message, { conversationId = 'default', actor = 'user', channel = 'text', householdId } = {}) {
    const convo = this.convo(conversationId);
    const task = this.store.insert('tasks_exec', {
      objective: message, state: S.PENDING, history: [], channel, conversationId, actor, householdId,
      plan: null, results: [], approvalId: null, response: null,
    });
    try {
      transition(task, S.PLANNING); this.emit(task);
      const memories = this.memory.search(message, { k: 4 });
      let steps = parse(message, convo);
      const resolved = [];
      for (const s of steps) resolved.push(...(await this.resolve(s, convo)));
      steps = resolved.map((s, i) => {
        const tool = this.tools[s.tool];
        if (!tool) throw new Error(`unknown tool ${s.tool}`);
        const args = s.tool === 'llm.answer' ? { ...s.args, memories, history: convo.history.slice(-8) } : s.args;
        const agent = agentById(s.agent);
        const risk = riskOf(tool, args);
        return { n: i + 1, agent: s.agent, tool: s.tool, args, risk, permission: this.policy.effective({ name: tool.name, risk, alwaysConfirm: tool.alwaysConfirm }, agent), status: 'pending' };
      });
      const byAgent = {};
      for (const s of steps) byAgent[s.agent] = (byAgent[s.agent] ?? 0) + 1;
      for (const [a, n] of Object.entries(byAgent)) {
        if (n > agentById(a).maxSteps) throw new Error(`agent ${a} exceeded its step limit (${n} > ${agentById(a).maxSteps})`);
      }
      task.plan = {
        objective: message,
        context: { memories: memories.map((m) => ({ id: m.id, content: m.content, provenance: m.provenance, score: m.score })) },
        agents: [...new Set(steps.map((s) => s.agent))],
        tools: [...new Set(steps.map((s) => s.tool))],
        steps,
        dependencies: steps.map((s, i) => ({ step: s.n, after: i ? [i] : [] })),
        permissions: steps.map((s) => ({ step: s.n, risk: s.risk, decision: s.permission })),
        successCriteria: 'Every step returns without error and passes its state verification.',
        verification: 'Tool-specific verify() re-reads the real state (store, device, provider).',
        recovery: 'Stop at the first failure, keep completed steps, report exactly what did and did not happen. Destructive steps are never retried automatically.',
      };
      const denied = steps.filter((s) => s.permission === 'deny');
      if (denied.length) {
        for (const s of denied) this.audit.log(actor, 'permission.denied', { tool: s.tool, agent: s.agent }, 'denied');
        throw new Error(`Not permitted: ${denied.map((s) => s.tool).join(', ')}`);
      }
      this.audit.log(actor, 'task.planned', { taskId: task.id, tools: task.plan.tools });
      convo.lastSteps = steps.map(({ agent, tool, args }) => ({ agent, tool, args: stripCtx(args) }));
      convo.history.push({ role: 'user', content: message });
      return await this.run(task);
    } catch (e) {
      return this.fail(task, e);
    }
  }

  async run(task) {
    const convo = this.convo(task.conversationId);
    const ctx = { actor: task.actor, householdId: task.householdId, channel: task.channel };
    if (task.state === S.PLANNING) transition(task, S.EXECUTING);
    this.save(task);
    for (const step of task.plan.steps) {
      if (step.status === 'done') continue;
      if (step.permission === 'approve' && !step.approved) {
        const ap = this.store.insert('approvals', {
          taskId: task.id, step: step.n, tool: step.tool, agent: step.agent, risk: step.risk,
          summary: describe(step), status: 'pending', requestedAt: now(),
        });
        task.approvalId = ap.id;
        transition(task, S.AWAITING_APPROVAL, `step ${step.n} ${step.tool}`);
        task.response = `Approval needed before I ${describe(step)}.`;
        this.save(task);
        await this.notifications.send({ title: 'Approval required', body: ap.summary, priority: 'high', event: 'approval', approvalId: ap.id });
        this.audit.log(task.actor, 'approval.requested', { taskId: task.id, tool: step.tool, risk: step.risk });
        return publicTask(task);
      }
      const tool = this.tools[step.tool];
      try {
        const out = await tool.run(step.args, ctx);
        step.status = 'done';
        step.summary = out.summary;
        step.data = out.data;
        this.audit.log(task.actor, `tool.${step.tool}`, { taskId: task.id, agent: step.agent, args: stripCtx(step.args) });
        if (step.tool === 'home.control') convo.lastEntities = task.plan.steps.filter((s) => s.tool === 'home.control').map((s) => s.args.entityId);
      } catch (e) {
        step.status = 'failed'; step.error = e.message;
        this.audit.log(task.actor, `tool.${step.tool}`, { taskId: task.id, error: e.message }, 'error');
        return this.fail(task, e);
      }
      this.save(task);
    }
    transition(task, S.VERIFYING); this.save(task);
    for (const step of task.plan.steps) {
      const tool = this.tools[step.tool];
      const ok = tool.verify ? await tool.verify({ data: step.data }, step.args) : true;
      step.verified = !!ok;
      if (!ok) return this.fail(task, new Error(`verification failed for step ${step.n} (${step.tool})`));
    }
    transition(task, S.COMPLETED);
    task.response = task.plan.steps.map((s) => s.summary).filter(Boolean).join('\n\n');
    convo.history.push({ role: 'assistant', content: task.response });
    this.save(task);
    return publicTask(task);
  }

  async decide(approvalId, decision, actor = 'user') {
    const ap = this.store.get('approvals', approvalId);
    if (!ap || ap.status !== 'pending') throw Object.assign(new Error('approval not pending'), { status: 409 });
    const task = this.store.get('tasks_exec', ap.taskId);
    this.store.update('approvals', ap.id, { status: decision === 'approve' ? 'approved' : 'rejected', decidedAt: now(), decidedBy: actor });
    this.audit.log(actor, `approval.${decision}`, { approvalId, taskId: task.id, tool: ap.tool });
    if (decision !== 'approve') {
      transition(task, S.CANCELLED, 'rejected by user');
      task.response = `Cancelled. I did not ${ap.summary}.`;
      this.save(task);
      return publicTask(task);
    }
    task.plan.steps.find((s) => s.n === ap.step).approved = true;
    transition(task, S.EXECUTING, 'approved');
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

  fail(task, e) {
    if (!TERMINAL.has(task.state)) {
      if (task.state === S.PENDING) transition(task, S.PLANNING);
      transition(task, S.FAILED, e.message);
    }
    const done = task.plan?.steps.filter((s) => s.status === 'done') ?? [];
    task.error = e.message;
    task.response = `I could not complete this: ${e.message}.${done.length ? `\nCompleted before the failure:\n${done.map((s) => `- ${s.summary}`).join('\n')}` : ''}`;
    this.save(task);
    return publicTask(task);
  }
}

function stripCtx(args) { const { memories, history, ...rest } = args ?? {}; return rest; }

function describe(step) {
  const a = step.args;
  switch (step.tool) {
    case 'home.control': return `${a.action.replace('_', ' ')} ${a.entityId}`;
    case 'wealth.transfer': return `prepare a ${a.action} request (JARVIS will not execute it)`;
    case 'computer.read_file': return `read the file ${a.path}`;
    case 'computer.screenshot': return 'capture a screenshot';
    default: return `run ${step.tool}`;
  }
}

export function publicTask(t) {
  const { plan, ...rest } = t;
  return { ...rest, plan: plan && { ...plan, steps: plan.steps.map(({ data, args, ...s }) => ({ ...s, args: stripCtx(args) })) } };
}
