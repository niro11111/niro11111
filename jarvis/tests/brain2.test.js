import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, ask } from './helpers.js';
import { createServer } from '../server/index.js';
import { ModelRouter } from '../server/core/router.js';
import { analyzeRequest } from '../server/brain/analyze.js';
import { parse } from '../server/core/intent.js';
import { analyzeFailure } from '../server/brain/failures.js';
import { analyzeTable } from '../server/brain/multimodal.js';
import { validatePlan } from '../server/brain/missions.js';
import { runEvaluation } from '../server/brain/evaluation.js';
import { coverageReport } from '../server/brain/coverage.js';
import { brainEvents } from '../server/brain/events.js';

test('intent analysis: kind, language, entities, urgency, risk, strategy, confidence', async () => {
  const s = await app();
  const a = (text) => analyzeRequest(text, parse(text, {}), s.tools);
  const x = a('הוצאתי 120 שקל על סופר היום, דחוף');
  assert.equal(x.lang, 'he'); assert.equal(x.kind, 'task'); assert.equal(x.urgency, 'high');
  assert.deepEqual(x.entities.find((e) => e.type === 'money'), { type: 'money', value: 120, currency: 'ILS' });
  assert.equal(a('add task לקנות חלב').lang, 'mixed');
  assert.equal(a('unlock the front door').risk, 'sensitive');
  assert.equal(a('unlock the front door').kind, 'command');
  assert.equal(a('כמה זה 15% מ-340').strategy, 'computation');
  assert.equal(a('מה הסיכוי שנגיע ליעד החיסכון?').strategy, 'scenario-modeling');
  assert.equal(a('שלום').kind, 'conversation');
  assert.ok(a('Explain black holes').confidence < a('turn off the lights').confidence);
  assert.equal(a('תזכיר לי').missing[0].field, 'text');
});

test('clarification: missing details are asked one at a time and the same task resumes', async () => {
  const s = await app();
  const q1 = await ask(s, 'תזכיר לי');
  assert.equal(q1.state, 'AWAITING_INPUT'); assert.equal(q1.response, 'על מה להזכיר לך?');
  const q2 = await ask(s, 'לקנות פרחים');
  assert.equal(q2.id, q1.id, 'same task'); assert.equal(q2.state, 'AWAITING_INPUT'); assert.equal(q2.response, 'מתי להזכיר?');
  const q3 = await ask(s, 'בעוד 2 שעות');
  assert.equal(q3.id, q1.id); assert.equal(q3.state, 'COMPLETED');
  assert.ok(s.store.all('reminders').some((r) => r.text === 'לקנות פרחים'));
  // a new command instead of an answer supersedes the question
  const p = await ask(s, 'add task');
  const n = await ask(s, 'turn off the lights downstairs');
  assert.equal(n.state, 'COMPLETED');
  assert.equal(s.store.get('tasks_exec', p.id).state, 'CANCELLED');
  // a bad answer gets the question again
  await ask(s, 'set a timer'); const again = await ask(s, 'soon');
  assert.equal(again.state, 'AWAITING_INPUT'); assert.equal(again.response, 'For how many minutes?');
});

test('small talk is answered without a model and honestly', async () => {
  const s = await app();
  assert.equal((await ask(s, 'שלום')).response, 'שלום! במה אפשר לעזור?');
  assert.match((await ask(s, 'how are you?')).response, /I'm software/);
});

test('agents have contracts and cannot act above their risk ceiling', async () => {
  const s = await app();
  const { AGENTS } = await import('../server/agents/registry.js');
  for (const a of AGENTS) assert.ok(a.timeoutMs > 0 && a.retry && a.riskLimit, a.id);
  await assert.rejects(s.core.runFromModel('home.control', { entityId: 'lock.front_door', action: 'unlock' }, { actor: 'user', householdId: s.householdId }, 'coding'), /not permitted/);
  const r = await s.core.runFromModel('home.control', { entityId: 'lock.front_door', action: 'unlock' }, { actor: 'user', householdId: s.householdId }, 'smarthome');
  assert.equal(r.awaitingApproval, true, 'the smart-home agent may propose it, the owner still approves');
});

test('missions: parallel independent tasks, dependencies, blocked branches, evidence, idempotency', async () => {
  const s = await app();
  const m = s.missions.create({ objective: 'Weekend prep', tasks: [
    { id: 'a', agent: 'assistant', tool: 'tasks.create', args: { title: 'Buy charcoal' } },
    { id: 'b', agent: 'household', tool: 'shopping.add', args: { item: 'pita' } },
    { id: 'c', agent: 'assistant', tool: 'tasks.complete', args: { id: 'nope' } },
    { id: 'd', agent: 'assistant', tool: 'tasks.create', args: { title: 'after c' }, dependsOn: ['c'] },
    { id: 'e', agent: 'assistant', tool: 'tasks.create', args: { title: 'after a+b' }, dependsOn: ['a', 'b'] },
  ] }, { householdId: s.householdId });
  const done = await s.missions.run(m.id);
  const st = Object.fromEntries(done.tasks.map((t) => [t.id, t.status]));
  assert.deepEqual(st, { a: 'done', b: 'done', c: 'failed', d: 'blocked', e: 'done' });
  assert.equal(done.status, 'partially_completed');
  assert.equal(done.tasks.find((t) => t.id === 'c').failure.kind, 'permanent');
  assert.ok(s.store.all('tool_executions', (x) => x.missionId === m.id).length >= 3);
  // running again never repeats completed operations
  done.status = 'running'; done.tasks.find((t) => t.id === 'a').status = 'pending'; s.missions.save(done);
  await s.missions.run(m.id);
  assert.equal(s.productivity.listTasks().filter((t) => t.title === 'Buy charcoal').length, 1);
  assert.ok(s.store.all('episodes').some((e) => e.ref === m.id));
});

test('missions: cycles and unknown tools are rejected; agents cannot borrow tools', async () => {
  const s = await app();
  assert.throws(() => validatePlan([{ id: 'a', tool: null, dependsOn: ['b'] }, { id: 'b', tool: null, dependsOn: ['a'] }], s.tools), /cycle/);
  const [t] = validatePlan([{ id: 'x', agent: 'coding', tool: 'shopping.add', args: { item: 'x' } }], s.tools);
  assert.notEqual(t.agent, 'coding', 'reassigned to an agent that owns the tool');
  assert.equal(validatePlan([{ id: 'y', tool: 'rm.rf' }], s.tools)[0].status, 'invalid');
});

test('missions: pause, resume, cancel; safe retry only for read-only steps; timeouts', async () => {
  const s = await app();
  const m = s.missions.create({ objective: 'p', tasks: [{ id: 'a', agent: 'assistant', tool: 'tasks.create', args: { title: 'P1' } }] }, { householdId: s.householdId });
  s.missions.pause(m.id);
  assert.equal((await s.missions.run(m.id)).status, 'paused');
  assert.equal(s.productivity.listTasks().length, 0);
  assert.equal((await s.missions.resume(m.id)).status, 'completed');
  const c = s.missions.create({ objective: 'c', tasks: [{ id: 'a', agent: 'smarthome', tool: 'home.control', args: { entityId: 'lock.front_door', action: 'unlock' } }] }, { householdId: s.householdId });
  await s.missions.run(c.id);
  assert.equal(s.missions.get(c.id).status, 'waiting_approval');
  s.missions.cancel(c.id);
  assert.equal(s.missions.get(c.id).status, 'cancelled');
  assert.equal(s.store.get('approvals', s.missions.get(c.id).tasks[0].approvalId).status, 'cancelled');
  // transient failure on a read: retried once; on a write: never retried
  let n = 0; const real = s.tools['tasks.list'].run;
  s.tools['tasks.list'].run = async (...x) => { if (n++ === 0) throw new Error('network glitch'); return real(...x); };
  s.missions.retryDelayMs = 1;
  const r = s.missions.create({ objective: 'r', tasks: [{ id: 'a', agent: 'assistant', tool: 'tasks.list', args: {} }] }, { householdId: s.householdId });
  assert.equal((await s.missions.run(r.id)).tasks[0].status, 'done');
  let w = 0; s.tools['tasks.create'].run = async () => { w++; throw new Error('network glitch'); };
  const wr = s.missions.create({ objective: 'w', tasks: [{ id: 'a', agent: 'assistant', tool: 'tasks.create', args: { title: 'x' } }] }, { householdId: s.householdId });
  assert.equal((await s.missions.run(wr.id)).tasks[0].status, 'failed');
  assert.equal(w, 1, 'a write is not retried');
  const { AGENTS } = await import('../server/agents/registry.js');
  const asst = AGENTS.find((a) => a.id === 'assistant'); const old = asst.timeoutMs; asst.timeoutMs = 20;
  s.tools['shopping.list'].run = () => new Promise(() => {});
  const to = s.missions.create({ objective: 't', tasks: [{ id: 'a', agent: 'assistant', tool: 'shopping.list', args: {} }] }, { householdId: s.householdId });
  const tr = await s.missions.run(to.id); asst.timeoutMs = old;
  assert.equal(tr.tasks[0].status, 'failed'); assert.match(tr.tasks[0].result, /timed out/);
});

test('capability registry: describe, search, health; extensions need six checks and the owner', async () => {
  const s = await app();
  const all = s.capabilities.list();
  const cal = all.find((c) => c.id === 'calc.evaluate');
  assert.equal(cal.domain, 'calc'); assert.equal(cal.availability, 'available'); assert.deepEqual(cal.inputSchema.required, ['expression']);
  assert.equal(all.find((c) => c.id === 'llm.answer').availability, 'unavailable', 'needs a model');
  assert.ok(s.capabilities.search('add something to buy at the supermarket', 3).some((c) => c.id === 'shopping.add'));
  const bad = await s.capabilities.register({ id: 'exchange', description: 'x', risk: 'read', inputSchema: {}, adapter: { type: 'http', url: 'http://127.0.0.1/x' } });
  assert.equal(bad.status, 'rejected');
  assert.ok(bad.checks.filter((c) => !c.ok).length >= 3);
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => '{"rate":3.7}' });
  const good = await s.capabilities.register({ id: 'ext.fx_rate', description: 'Get the exchange rate for a currency pair', risk: 'external', inputSchema: { pair: { type: 'string', required: true } }, adapter: { type: 'http', url: 'https://api.example.com/fx', method: 'GET' }, test: { input: { pair: 'USD/ILS' } } }, { fetchImpl: fakeFetch });
  assert.equal(good.status, 'pending_review'); assert.ok(good.checks.every((c) => c.ok));
  assert.equal(s.tools['ext.fx_rate'], undefined, 'not usable before the owner approves');
  s.capabilities.approve(good.id, { fetchImpl: fakeFetch });
  const r = await s.core.runFromModel('ext.fx_rate', { pair: 'USD/ILS' }, { actor: 'user', householdId: s.householdId }, 'executive');
  assert.equal(r.executed, true); assert.match(r.summary, /3\.7/);
  s.capabilities.disable('ext.fx_rate');
  await assert.rejects(s.core.runFromModel('ext.fx_rate', { pair: 'x' }, { actor: 'user' }), /unknown tool/);
});

test('model gateway: fallback chain, circuit breaker, rate-limit retry, preferences', async () => {
  const calls = [];
  const prov = { name: 'claude', capabilities: () => ({ text: true }), complete: async ({ model }) => { calls.push(model); if (model === 'complex') throw new Error('upstream 503'); if (model === 'default' && calls.filter((x) => x === 'default').length === 1) throw new Error('rate limited 429'); return { text: `ok from ${model}` }; } };
  const r = new ModelRouter({ providers: { claude: prov }, tiers: { fast: { provider: 'claude', model: 'quick' }, balanced: { provider: 'claude', model: 'default' }, deep: { provider: 'claude', model: 'complex' }, local: { provider: 'local', model: 'local' } } });
  r.retryDelayMs = 1;
  const out = await r.complete({ complexity: 'high' }, { system: '', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(out.text, 'ok from default');
  assert.deepEqual(calls, ['complex', 'default', 'default'], 'deep failed -> balanced, rate limit retried once');
  assert.deepEqual(out.route.fallbackFrom, ['claude/complex']);
  for (let i = 0; i < 3; i++) r.markResult('claude', false, 'down');
  assert.equal(r.healthy('claude'), false);
  assert.deepEqual(r.setPreferences({ coding: 'deep', bogus: 'nope' }), { coding: 'deep' });
  r.markResult('claude', true);
  assert.equal(r.route({ task: 'coding', complexity: 'low' }).tier, 'deep');
});

test('failure analysis classifies and only allows safe retries', () => {
  assert.deepEqual([analyzeFailure(new Error('fetch failed'), { risk: 'read' }).kind, analyzeFailure(new Error('fetch failed'), { risk: 'read' }).retrySafe], ['transient', true]);
  assert.equal(analyzeFailure(new Error('fetch failed'), { risk: 'write' }).retrySafe, false);
  assert.equal(analyzeFailure(new Error('Kitchen lights is offline')).kind, 'external');
  assert.equal(analyzeFailure(new Error('Not permitted: home.control')).kind, 'policy');
  assert.equal(analyzeFailure(new Error('this needs a language model')).kind, 'missing_capability');
});

test('multimodal: CSV statistics are exact; unsupported formats say so', async () => {
  const st = analyzeTable('item,price,qty\nmilk,7.5,2\nbread,12,1\n"cheese, yellow",30,1');
  assert.equal(st.rows, 3);
  assert.deepEqual(st.columns[1], { name: 'price', type: 'number', count: 3, sum: 49.5, mean: 16.5, sd: 9.72, min: 7.5, median: 12, max: 30 });
  assert.equal(st.columns[0].distinct, 3);
  const s = await app();
  const { processInput } = await import('../server/brain/multimodal.js');
  const a = await processInput(s, { kind: 'audio' }, { actor: 'user', householdId: s.householdId });
  assert.equal(a.state, 'FAILED'); assert.match(a.response, /speech-to-text/);
});

test('typed events are emitted for a request', async () => {
  const s = await app();
  await ask(s, 'add task test events');
  const types = brainEvents(s.store).map((e) => e.type);
  for (const tp of ['request.received', 'tool.invoked', 'tool.completed', 'verification.completed']) assert.ok(types.includes(tp), tp);
  assert.ok(brainEvents(s.store).every((e) => e.v === 1 && e.at));
});

test('the built-in evaluation suite passes with no permission violations', async () => {
  const run = await runEvaluation();
  const failed = run.results.filter((r) => !r.pass);
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.equal(run.permissionViolations, 0);
  assert.equal(run.falseSuccess, 0);
  assert.ok(Object.keys(run.perCategory).length >= 10);
});

test('coverage report and v1 API', async () => {
  const c = coverageReport();
  assert.ok(c.total >= 50); assert.ok(c.counts['implemented-tested'] > 30);
  const s = await app();
  const srv = createServer(s, 'owner');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/v1/brain`;
  const call = async (p, o = {}) => (await fetch(base + p, { ...o, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) })).json();
  try {
    const req = await call('/requests', { method: 'POST', body: { text: 'add task from v1' } });
    assert.equal(req.state, 'COMPLETED');
    const m = await call('/missions', { method: 'POST', body: { objective: 'v1', tasks: [{ id: 'a', agent: 'household', tool: 'shopping.add', args: { item: 'v1 item' } }] } });
    assert.equal(m.status, 'completed');
    assert.equal((await call(`/missions/${m.id}`)).tasks[0].status, 'done');
    assert.ok((await call('/capabilities?q=shopping')).length > 0);
    assert.equal((await call('/coverage')).total, c.total);
    assert.ok((await call('/events')).contract.types['mission.created']);
    assert.ok((await call('/executions')).length > 0);
    assert.equal((await call('/analyze', { method: 'POST', body: { text: 'unlock the front door' } })).risk, 'sensitive');
  } finally { srv.close(); }
});

test('the evaluation sandbox is isolated: nothing reaches the live event bus', async () => {
  const { bus } = await import('../server/lib/events.js');
  const seen = []; const on = (e) => seen.push(e); bus.on('event', on);
  try { await runEvaluation(); } finally { bus.off('event', on); }
  assert.deepEqual(seen, []);
});
