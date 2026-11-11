import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, ask } from './helpers.js';
import { transition, S } from '../server/core/states.js';
import { parse } from '../server/core/intent.js';
import { ModelRouter } from '../server/core/router.js';

test('state machine rejects illegal transitions', () => {
  const t = { state: S.PENDING, history: [] };
  transition(t, S.PLANNING);
  assert.throws(() => transition(t, S.COMPLETED), /Illegal/);
});

test('intent: Hebrew and English map to the same tools', () => {
  assert.equal(parse('כמה הוצאנו החודש?')[0].tool, 'wealth.analysis');
  assert.equal(parse('How much did we spend this month?')[0].tool, 'wealth.analysis');
  assert.equal(parse('תארגן לי את היום')[0].tool, 'briefing.daily');
  assert.equal(parse('Remind me to pay the electricity bill')[0].tool, 'reminders.create', 'reminder wins over payment');
  assert.equal(parse('transfer 500 to Dan')[0].tool, 'wealth.transfer');
  assert.equal(parse('Explain black holes')[0].tool, 'llm.answer');
});

test('multi-step command is split into ordered steps', () => {
  const steps = parse('turn off the lights downstairs and then remind me to lock up in 10 minutes');
  assert.deepEqual(steps.map((s) => s.tool), ['home.control', 'reminders.create']);
});

test('read task completes and is verified', async () => {
  const s = await app();
  const t = await ask(s, 'organize my day');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /Briefing/);
  assert.deepEqual(t.history.map((h) => h.to), ['PLANNING', 'EXECUTING', 'VERIFYING', 'COMPLETED']);
});

test('device control verifies real device state, pronouns use the last devices', async () => {
  const s = await app();
  const t = await ask(s, 'turn off the lights downstairs');
  assert.equal(t.state, 'COMPLETED');
  assert.ok(t.plan.steps.every((x) => x.verified));
  let d = await s.home.devices();
  assert.equal(d.find((x) => x.id === 'light.kitchen').state, 'off');
  assert.equal(d.find((x) => x.id === 'light.bedroom').state, 'off', 'upstairs untouched (was off)');
  await ask(s, 'turn them on');
  d = await s.home.devices();
  assert.equal(d.find((x) => x.id === 'light.kitchen').state, 'on');
  assert.equal(d.find((x) => x.id === 'light.bedroom').state, 'off', 'only "them" changed');
});

test('correction updates the previous numeric argument', async () => {
  const s = await app();
  await ask(s, 'set the temperature to 23');
  const t = await ask(s, 'no, 21');
  assert.equal(t.state, 'COMPLETED');
  assert.equal((await s.home.devices()).find((x) => x.id === 'climate.living_room').attributes.temperature, 21);
});

test('unlocking a door waits for approval and runs only after approve', async () => {
  const s = await app();
  const t = await ask(s, 'unlock the front door');
  assert.equal(t.state, 'AWAITING_APPROVAL');
  assert.equal((await s.home.devices()).find((x) => x.id === 'lock.front_door').state, 'locked');
  const done = await s.core.decide(t.approvalId, 'approve');
  assert.equal(done.state, 'COMPLETED');
  assert.equal((await s.home.devices()).find((x) => x.id === 'lock.front_door').state, 'unlocked');
});

test('rejected approval cancels and changes nothing', async () => {
  const s = await app();
  const t = await ask(s, 'unlock the front door');
  const r = await s.core.decide(t.approvalId, 'reject');
  assert.equal(r.state, 'CANCELLED');
  assert.equal((await s.home.devices()).find((x) => x.id === 'lock.front_door').state, 'locked');
});

test('money movement is never executed, even after approval', async () => {
  const s = await app();
  const t = await ask(s, 'transfer 500 to my brother');
  assert.equal(t.state, 'AWAITING_APPROVAL');
  const r = await s.core.decide(t.approvalId, 'approve');
  assert.match(r.response, /Not executed/);
  assert.ok(s.audit.list().some((a) => a.action === 'wealth.blocked_action' && a.outcome === 'blocked'));
});

test('financial/sensitive policy cannot be set to allow', async () => {
  const s = await app();
  assert.throws(() => s.policy.set('financial', 'allow'));
  assert.throws(() => s.policy.set('sensitive', 'allow'));
  s.policy.set('external', 'deny');
  const t = await ask(s, 'turn off the lights');
  assert.equal(t.state, 'FAILED');
  assert.match(t.response, /Not permitted/);
});

test('failure is reported honestly: no LLM configured -> FAILED, not COMPLETED', async () => {
  const s = await app();
  const t = await ask(s, 'Write me a poem about the sea');
  assert.equal(t.state, 'FAILED');
  assert.match(t.response, /language model/);
});

test('device failure stops the plan and lists only what really happened', async () => {
  const s = await app();
  const t = await ask(s, 'turn off the lights downstairs and then remind me to check the boiler in 5 minutes');
  assert.equal(t.state, 'COMPLETED');
  s.home.state.find((x) => x.id === 'light.kitchen').online = false;
  const f = await ask(s, 'turn on the lights in the kitchen');
  assert.equal(f.state, 'FAILED');
  assert.match(f.response, /offline/);
});

test('router: privacy and availability drive the choice, never a hard-coded vendor', () => {
  const fake = { name: 'fake', capabilities: () => ({ text: true, vision: true, webSearch: true }), complete: async () => ({ text: 'x' }) };
  const r = new ModelRouter({ providers: { anthropic: fake } });
  assert.equal(r.route({ complexity: 'high' }).model, 'claude-opus-5-5');
  assert.equal(r.route({ complexity: 'low' }).tier, 'fast');
  assert.equal(r.route({ latency: 'realtime' }).tier, 'fast');
  assert.equal(r.route({ privacy: 'local_only', complexity: 'high' }).tier, 'local');
  const off = new ModelRouter();
  assert.equal(off.route({ complexity: 'high' }).tier, 'local');
  assert.ok(off.route({ complexity: 'high' }).degraded);
});

test('LLM answers are routed through the provider with memory context', async () => {
  let seen;
  const fake = { name: 'fake', capabilities: () => ({ text: true, vision: false, webSearch: false }), complete: async (req) => { seen = req; return { text: 'Short answer.' }; } };
  const s = await app({ router: new ModelRouter({ providers: { anthropic: fake } }) });
  s.memory.add({ content: 'I prefer short answers', type: 'preference' });
  const t = await ask(s, 'what should I prefer for answers, short or long?');
  assert.equal(t.state, 'COMPLETED');
  assert.equal(t.response, 'Short answer.');
  assert.match(seen.system, /prefer short answers/);
});
