// Workflow engine: triggers (event | schedule | manual), conditions, branches, delays,
// tool/agent actions, notifications, approval gates, retries, cancellation and run history.
//
// Workflow shape:
// { name, enabled, trigger: { type:'event', event:'wealth.transaction_imported' } | { type:'schedule', everyMinutes:60 } | { type:'manual' },
//   steps: [ { type:'tool', tool:'wealth.analysis', args:{}, retries:2, saveAs:'analysis' },
//            { type:'condition', if:{ path:'analysis.calculations.anomalies.unusual.length', op:'>', value:0 }, then:[...], else:[...] },
//            { type:'notify', title:'...', body:'{{analysis.month}}', priority:'high' },
//            { type:'approval', summary:'...' }, { type:'delay', ms:1000 }, { type:'agent', prompt:'...' } ] }
import { now } from '../lib/store.js';
import { riskOf } from '../tools/index.js';

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b, contains: (a, b) => String(a).includes(b), exists: (a) => a !== undefined && a !== null };
const tpl = (s, vars) => String(s).replace(/\{\{([\w.]+)\}\}/g, (_, p) => { const v = get(vars, p); return v === undefined ? '' : String(v); });

export class Automations {
  constructor({ store, tools, policy, notifications, audit, core, ctx }) {
    Object.assign(this, { store, tools, policy, notifications, audit, core, ctx });
    this.cancelled = new Set();
  }
  list() { return this.store.all('workflows'); }
  create(wf) {
    validate(wf);
    return this.store.insert('workflows', { enabled: true, ...wf, lastRunAt: null });
  }
  update(id, patch) { const wf = { ...this.store.get('workflows', id), ...patch }; validate(wf); return this.store.update('workflows', id, patch); }
  delete(id) { return this.store.remove('workflows', id); }
  runs(workflowId) { return this.store.all('workflow_runs', (r) => !workflowId || r.workflowId === workflowId).slice(-50).reverse(); }
  cancel(runId) { this.cancelled.add(runId); const r = this.store.get('workflow_runs', runId); if (r && r.status === 'awaiting_approval') this.store.update('workflow_runs', runId, { status: 'cancelled' }); return true; }

  async emit(event, payload = {}) {
    const out = [];
    for (const wf of this.list().filter((w) => w.enabled && w.trigger?.type === 'event' && w.trigger.event === event)) out.push(await this.run(wf.id, payload));
    return out;
  }

  async tick(at = Date.now()) {
    for (const wf of this.list().filter((w) => w.enabled && w.trigger?.type === 'schedule')) {
      const last = wf.lastRunAt ? Date.parse(wf.lastRunAt) : 0;
      if (at - last >= wf.trigger.everyMinutes * 6e4) await this.run(wf.id, { scheduled: true });
    }
  }

  async run(workflowId, payload = {}, resume = null) {
    const wf = this.store.get('workflows', workflowId);
    if (!wf) throw new Error('workflow not found');
    const run = resume ?? this.store.insert('workflow_runs', { workflowId, name: wf.name, status: 'running', startedAt: now(), log: [], vars: { payload }, cursor: [] });
    if (!resume) this.store.update('workflows', wf.id, { lastRunAt: now() });
    try {
      const res = await this.exec(wf.steps, run, []);
      if (res === 'paused') return run;
      run.status = 'completed';
    } catch (e) {
      run.status = this.cancelled.has(run.id) ? 'cancelled' : 'failed';
      run.error = e.message;
    }
    run.finishedAt = now();
    this.store.update('workflow_runs', run.id, run);
    this.audit.log('automation', 'workflow.run', { workflowId, runId: run.id, status: run.status });
    return run;
  }

  async approve(runId, decision = 'approve') {
    const run = this.store.get('workflow_runs', runId);
    if (!run || run.status !== 'awaiting_approval') throw new Error('run is not awaiting approval');
    this.audit.log('user', `workflow.approval.${decision}`, { runId });
    if (decision !== 'approve') { run.status = 'cancelled'; run.finishedAt = now(); this.store.update('workflow_runs', runId, run); return run; }
    run.approvedGates = [...(run.approvedGates ?? []), run.pendingGate];
    run.status = 'running';
    return this.run(run.workflowId, run.vars.payload, run);
  }

  log(run, entry) { run.log.push({ at: now(), ...entry }); this.store.update('workflow_runs', run.id, { log: run.log }); }

  async exec(steps, run, path) {
    for (let i = 0; i < steps.length; i++) {
      if (this.cancelled.has(run.id)) throw new Error('cancelled');
      const st = steps[i]; const key = [...path, i].join('.');
      if ((run.done ??= []).includes(key)) continue;
      switch (st.type) {
        case 'tool': {
          const tool = this.tools[st.tool];
          if (!tool) throw new Error(`unknown tool ${st.tool}`);
          const args = JSON.parse(tpl(JSON.stringify(st.args ?? {}), run.vars));
          const decision = this.policy.effective({ name: tool.name, risk: riskOf(tool, args), alwaysConfirm: tool.alwaysConfirm });
          if (decision === 'deny') throw new Error(`tool ${st.tool} denied by policy`);
          if (decision === 'approve' && !(run.approvedGates ?? []).includes(key)) return this.pause(run, key, `Workflow "${run.name}" wants to run ${st.tool}`);
          let attempt = 0; let lastErr;
          // retry only steps that are safe to repeat (read/write of own data)
          const maxAttempts = ['read', 'write'].includes(riskOf(tool, args)) ? (st.retries ?? 0) + 1 : 1;
          while (attempt < maxAttempts) {
            try {
              const out = await tool.run(args, { ...this.ctx, actor: 'automation' });
              if (st.saveAs) run.vars[st.saveAs] = out.data;
              this.log(run, { step: key, tool: st.tool, ok: true, summary: out.summary?.slice(0, 300) });
              lastErr = null; break;
            } catch (e) { lastErr = e; attempt++; this.log(run, { step: key, tool: st.tool, ok: false, error: e.message, attempt }); }
          }
          if (lastErr) { if (st.continueOnError) break; throw lastErr; }
          break;
        }
        case 'condition': {
          const v = get(run.vars, st.if.path);
          const ok = OPS[st.if.op]?.(v, st.if.value);
          this.log(run, { step: key, condition: st.if, value: v, result: !!ok });
          const r = await this.exec((ok ? st.then : st.else) ?? [], run, [...path, i, ok ? 't' : 'e']);
          if (r === 'paused') return r;
          break;
        }
        case 'notify': {
          const n = await this.notifications.send({ title: tpl(st.title, run.vars), body: tpl(st.body ?? '', run.vars), priority: st.priority ?? 'normal', event: `workflow:${run.workflowId}` });
          this.log(run, { step: key, notify: n.status });
          break;
        }
        case 'delay': await new Promise((r) => setTimeout(r, Math.min(st.ms ?? 0, 60_000))); this.log(run, { step: key, delay: st.ms }); break;
        case 'approval':
          if (!(run.approvedGates ?? []).includes(key)) return this.pause(run, key, tpl(st.summary ?? 'Workflow approval', run.vars));
          break;
        case 'agent': {
          const t = await this.core.handle(tpl(st.prompt, run.vars), { actor: 'automation', conversationId: `wf:${run.id}`, householdId: this.ctx.householdId });
          if (st.saveAs) run.vars[st.saveAs] = t.response;
          this.log(run, { step: key, agentTask: t.id, state: t.state });
          if (t.state === 'FAILED') throw new Error(t.error);
          break;
        }
        default: throw new Error(`unknown step type ${st.type}`);
      }
      run.done.push(key);
    }
    return 'ok';
  }

  async pause(run, key, summary) {
    run.status = 'awaiting_approval'; run.pendingGate = key;
    this.store.update('workflow_runs', run.id, run);
    await this.notifications.send({ title: 'Workflow approval required', body: summary, priority: 'high', event: 'approval' });
    this.log(run, { step: key, awaitingApproval: summary });
    return 'paused';
  }
}

function validate(wf) {
  if (!wf.name) throw new Error('workflow name required');
  if (!['event', 'schedule', 'manual'].includes(wf.trigger?.type)) throw new Error('trigger.type must be event|schedule|manual');
  if (wf.trigger.type === 'schedule' && !(wf.trigger.everyMinutes >= 1)) throw new Error('schedule needs everyMinutes >= 1');
  if (!Array.isArray(wf.steps) || !wf.steps.length) throw new Error('steps required');
}
