import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, ask } from './helpers.js';
import { createServer } from '../server/index.js';
import { ModelRouter } from '../server/core/router.js';
import { AGENTS, validate } from '../server/agents/registry.js';
import { workflowFromText } from '../server/automation/nl.js';
import { Weather } from '../server/context/weather.js';
import { Store } from '../server/lib/store.js';

test('19 agents, each with scope, tools, schemas and data domains; tools exist', async () => {
  const s = await app();
  assert.equal(AGENTS.length, 19);
  for (const a of AGENTS) {
    assert.ok(a.scope && a.tools.length && a.input && a.output && a.dataScopes.length, a.id);
    for (const t of a.tools) assert.ok(s.tools[t], `${a.id} -> ${t}`);
  }
  assert.deepEqual(validate({ x: { type: 'string', required: true } }, {}), ['x is required']);
});

test('Hebrew in, Hebrew out', async () => {
  const s = await app();
  const t = await ask(s, 'תארגן לי את היום');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /תדריך ליום/);
  const w = await ask(s, 'כמה הוצאנו החודש?');
  assert.match(w.response, /החודש .* הוצאתם/);
  const r = await ask(s, 'תזכיר לי לשלם חשמל מחר ב-9');
  assert.match(r.response, /תזכורת נקבעה/);
});

test('autonomy level 1 (advisory) proposes but never executes', async () => {
  const s = await app();
  s.policy.setAutonomy(1);
  const t = await ask(s, 'turn off the lights downstairs');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /Advisory mode/);
  assert.equal((await s.home.devices()).find((d) => d.id === 'light.kitchen').state, 'on');
  assert.ok(t.plan.steps.every((x) => x.status === 'proposed'));
});

test('autonomy level 2 (assisted) asks before a routine write', async () => {
  const s = await app();
  s.policy.setAutonomy(2);
  const t = await ask(s, 'add task buy milk');
  assert.equal(t.state, 'AWAITING_APPROVAL');
  assert.equal(s.productivity.listTasks().length, 0);
  const d = await s.core.decide(t.approvalId, 'approve');
  assert.equal(d.state, 'COMPLETED');
  assert.equal(s.productivity.listTasks()[0].title, 'buy milk');
  assert.throws(() => s.policy.setAutonomy(7));
});

test('approval is bound to the exact action and expires (silence is not consent)', async () => {
  const s = await app();
  const t = await ask(s, 'unlock the front door');
  const ap = s.store.get('approvals', t.approvalId);
  assert.ok(ap.actionHash && ap.expiresAt && ap.consequences);
  // tamper: the step changes after approval was requested
  s.store.get('tasks_exec', t.id).plan.steps[0].args.entityId = 'lock.back_door';
  await assert.rejects(s.core.decide(ap.id, 'approve'), /changed/);
  assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'locked');

  const t2 = await ask(s, 'unlock the front door');
  s.store.update('approvals', t2.approvalId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(s.core.decide(t2.approvalId, 'approve'), /expired/);
  assert.equal(s.store.get('tasks_exec', t2.id).state, 'CANCELLED');
  assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'locked');
});

test('scheduler expires stale approvals', async () => {
  const s = await app();
  const t = await ask(s, 'transfer 300 to Dan');
  assert.equal(s.core.expireApprovals(Date.now() + 16 * 60e3), 1);
  assert.equal(s.store.get('tasks_exec', t.id).state, 'CANCELLED');
});

test('memory: duplicates reinforced, hybrid search, domain permissions, off switch', async () => {
  const s = await app();
  const a = s.memory.add({ content: 'My daughter Noa has piano lessons on Tuesdays', type: 'person', workspace: 'family' });
  const b = s.memory.add({ content: 'My daughter Noa has piano lessons on Tuesdays.', type: 'person', workspace: 'family' });
  assert.equal(b.duplicate, true); assert.equal(b.id, a.id);
  s.memory.add({ content: 'Pension fund management fee is 0.2%', workspace: 'financial' });
  const r = s.memory.search('when are Noa piano lessons');
  assert.equal(r[0].id, a.id); assert.ok(r[0].keyword > 0 && r[0].semantic > 0);
  assert.equal(s.memory.search('pension management fee').length, 0, 'financial domain hidden from general context');
  assert.equal(s.memory.search('pension management fee', { domains: ['financial'] }).length, 1);
  const conv = s.memory.add({ content: 'we talked about the trip', type: 'conversation_summary' });
  assert.ok(conv.expiresAt, 'conversation summaries are not permanent');
  s.privacy.set({ memoryEnabled: false });
  assert.equal(s.memory.search('Noa').length, 0);
  assert.throws(() => s.memory.add({ content: 'x' }), /disabled/);
  const t = await ask(s, 'remember that I like tea');
  assert.equal(t.state, 'FAILED');
});

test('health is opt-in, separate, and never diagnoses', async () => {
  const s = await app();
  const off = await ask(s, 'how did I sleep this week?');
  assert.equal(off.state, 'FAILED');
  s.privacy.set({ healthEnabled: true });
  const days = Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), steps: i < 7 ? 9000 : 6000, sleepMinutes: 420, restingHeartRate: 60 }));
  assert.equal(s.health.ingest(days, 'watchos').ingested, 14);
  const t = await ask(s, 'how did I sleep this week?');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /9000 steps.*\+50%.*7\.0 h/s);
  assert.match(t.response, /not medical advice/);
  assert.equal(s.memory.search('steps sleep heart').length, 0, 'health never enters memory');
});

test('personality shapes the system prompt but keeps the safety rules', async () => {
  let seen;
  const fake = { name: 'fake', capabilities: () => ({ text: true, vision: true, webSearch: false }), complete: async (r) => { seen = r; return { text: 'ok' }; } };
  const s = await app({ router: new ModelRouter({ providers: { anthropic: fake } }) });
  s.personality.set({ style: 'witty', verbosity: 'short', humor: true, address: 'Nir' });
  await ask(s, 'tell me something interesting about octopuses');
  assert.match(seen.system, /witty/); assert.match(seen.system, /"Nir"/); assert.match(seen.system, /never invent facts/);
  assert.throws(() => s.personality.set({ style: 'rude' }));
});

test('model calls are metered without content', async () => {
  const fake = { name: 'fake', capabilities: () => ({ text: true, vision: true, webSearch: false }), complete: async () => ({ text: 'secret answer', usage: { input_tokens: 1000, output_tokens: 500 } }) };
  const s = await app({ router: new ModelRouter({ providers: { anthropic: fake } }) });
  await ask(s, 'explain the tides in detail please, compare and analyze');
  const c = s.metrics.console();
  assert.equal(c.models[0].model, 'claude-opus-5-5');
  assert.ok(c.models[0].costUsd > 0);
  assert.ok(!JSON.stringify(c).includes('secret answer'));
});

test('natural-language automation: arrive-home workflow with guardrails', async () => {
  const s = await app();
  const wf = workflowFromText('When I arrive home: turn on the lights downstairs; read my calendar; show my tasks; do not unlock doors', s.tools, s.policy);
  assert.deepEqual(wf.trigger, { type: 'event', event: 'presence.arrived_home' });
  assert.deepEqual(wf.guardrails, ['do not unlock doors']);
  assert.ok(!JSON.stringify(wf.steps).includes('unlock'));
  const saved = s.automations.create(wf);
  for (const d of await s.home.devices()) if (d.domain === 'light' && d.online) await s.home.call(d.id, 'turn_off');
  const [run] = await s.automations.emit('presence.arrived_home');
  assert.equal(run.status, 'completed', JSON.stringify(run.log));
  assert.equal((await s.home.devices()).find((d) => d.id === 'light.kitchen').state, 'on');
  assert.equal(saved.trigger.event, 'presence.arrived_home');
  // a sensitive action written into a workflow gets an approval gate
  const g = workflowFromText('every 60 minutes: unlock the front door', s.tools, s.policy);
  assert.equal(g.steps[0].type, 'approval');
});

test('automation error branch runs instead of failing', async () => {
  const s = await app();
  const wf = s.automations.create({ name: 'E', trigger: { type: 'manual' }, steps: [
    { type: 'tool', tool: 'tasks.complete', args: { id: 'missing' }, onError: [{ type: 'notify', title: 'Recovered: {{lastError}}' }] },
    { type: 'tool', tool: 'tasks.create', args: { title: 'after' } }] });
  const r = await s.automations.run(wf.id);
  assert.equal(r.status, 'completed');
  assert.ok(s.notifications.list().some((n) => n.title === 'Recovered: task not found'));
});

test('sync: change feed, idempotent offline ops, conflicts, minimal watch payloads', async () => {
  const s = await app();
  const { device: watch } = s.devices.register({ name: 'Nir watch', kind: 'watchos' });
  const w = s.store.get('devices', watch.id);
  const before = s.store.seq();
  const op = { opId: 'op-1', type: 'task.create', payload: { title: 'Call mom' } };
  const r1 = await (await import('../server/devices/devices.js')).applyOps(s, w, [op]);
  const r2 = await (await import('../server/devices/devices.js')).applyOps(s, w, [op]);
  assert.equal(r1.results[0].status, 'applied'); assert.equal(r2.results[0].status, 'duplicate');
  assert.equal(s.productivity.listTasks().filter((t) => t.title === 'Call mom').length, 1);
  const pull = s.devices.pull(w, before);
  assert.ok(pull.changes.some((c) => c.col === 'tasks' && c.rec.title === 'Call mom'));
  assert.deepEqual(Object.keys(pull.changes.find((c) => c.col === 'tasks').rec).sort(), ['done', 'due', 'id', 'priority', 'title']);
  s.memory.add({ content: 'family thing', workspace: 'family' });
  assert.ok(!s.devices.pull(w, before).changes.some((c) => c.col === 'memories'), 'watch never receives memories');
  // conflict: server changed after the client's edit
  const id = r1.results[0].id;
  s.store.update('tasks', id, { title: 'Call mom tonight' });
  const c = await (await import('../server/devices/devices.js')).applyOps(s, w, [{ opId: 'op-2', type: 'task.complete', payload: { id }, clientTime: new Date(Date.now() - 60e3).toISOString() }]);
  assert.equal(c.results[0].status, 'conflict');
});

test('weather degrades honestly when the network fails', async () => {
  const w = new Weather(new Store(), async () => { throw new Error('offline'); });
  const r = await w.current();
  assert.equal(r.available, false);
  const ok = new Weather(new Store(), async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 21.4, weather_code: 2, wind_speed_10m: 9, relative_humidity_2m: 60 }, daily: { temperature_2m_max: [24], temperature_2m_min: [17] } }) }));
  const d = await ok.current();
  assert.equal(d.temperature, 21); assert.equal(d.textHe, 'מעונן חלקית');
});

test('HTTP: device tokens are scoped and revocable; watch glance/actions; rate limit', async () => {
  const s = await app();
  const srv = createServer(s, 'owner', { rateLimit: 60 });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (p, tok, o = {}) => fetch(base + p, { ...o, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) });
  try {
    const reg = await (await call('/api/devices', 'owner', { method: 'POST', body: { name: 'Watch', kind: 'watchos' } })).json();
    assert.match(reg.token, /^jd_/);
    const g = await (await call('/api/watch/glance', reg.token)).json();
    assert.ok(Array.isArray(g.tasks) && 'approvals' in g && !('transactions' in g));
    assert.equal((await call('/api/wealth/transactions', reg.token)).status, 403, 'watch cannot read transactions');
    assert.equal((await call('/api/memory', reg.token)).status, 403);
    const a = await (await call('/api/watch/action', reg.token, { method: 'POST', body: { action: 'shopping_add', text: 'חלב', opId: 'x1' } })).json();
    assert.equal(a.status, 'applied');
    const again = await (await call('/api/watch/action', reg.token, { method: 'POST', body: { action: 'shopping_add', text: 'חלב', opId: 'x1' } })).json();
    assert.equal(again.status, 'duplicate');
    assert.equal(s.store.all('shopping').length, 1);
    const fp = await (await call('/api/watch/action', reg.token, { method: 'POST', body: { action: 'find_phone' } })).json();
    assert.equal(fp.status, 'unavailable', 'no phone registered: says so');
    const ask2 = await (await call('/api/watch/action', reg.token, { method: 'POST', body: { action: 'ask', text: 'מה המשימות שלי', opId: 'x2' } })).json();
    assert.equal(ask2.state, 'COMPLETED');
    assert.equal((await call(`/api/devices/${reg.device.id}`, 'owner', { method: 'DELETE' })).status, 200);
    assert.equal((await call('/api/watch/glance', reg.token)).status, 401, 'revoked token rejected');
    assert.equal((await (await call('/api/system/map', 'owner')).json()).engines.length, 8);
    const img = await (await call('/api/input', 'owner', { method: 'POST', body: { kind: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' } })).json();
    assert.equal(img.state, 'FAILED', 'no vision provider: honest failure');
    let last;
    for (let i = 0; i < 70; i++) last = await call('/api/status', 'owner');
    assert.equal(last.status, 429);
  } finally { srv.close(); }
});
