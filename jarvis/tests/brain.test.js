import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, ask } from './helpers.js';
import { ModelRouter } from '../server/core/router.js';
import { AnthropicProvider } from '../server/providers/anthropic.js';
import { parseRule } from '../server/brain/watchers.js';
import { goalProbability, decisionMatrix } from '../server/wealth/calc.js';

const TIERS = { fast: { provider: 'claude', model: 'quick' }, balanced: { provider: 'claude', model: 'default' }, deep: { provider: 'claude', model: 'complex' }, local: { provider: 'local', model: 'local' } };
const withModel = (complete, caps = {}) => app({ router: new ModelRouter({ providers: { claude: { name: 'claude', capabilities: () => ({ text: true, vision: false, webSearch: false, tools: false, ...caps }), complete } }, tiers: TIERS }) });

test('RAG: answers get personal context and cite sources', async () => {
  let seen;
  const s = await withModel(async ({ system }) => { seen = system; return { text: 'Noa has piano on Tuesday [1].' }; });
  s.productivity.addNote({ text: 'Noa piano lesson every Tuesday at 16:00' });
  const t = await ask(s, 'when is the piano lesson for Noa this week?');
  assert.equal(t.state, 'COMPLETED');
  assert.match(seen, /\[1\] \(note; user_statement; \d{4}-\d{2}-\d{2}\) Noa piano lesson/);
  assert.match(t.response, /Sources: \[1\] note: Noa piano lesson/);
});

test('RAG keeps finances out of general context', async () => {
  let seen;
  const s = await withModel(async ({ system }) => { seen = system; return { text: 'ok' }; });
  s.memory.add({ content: 'Our pension fund fee is 0.2 percent', workspace: 'financial' });
  await ask(s, 'tell me about the pension fund fee please');
  assert.ok(!/pension fund fee/.test(seen));
});

test('deep thinking: draft, critique, revision', async () => {
  const calls = [];
  const s = await withModel(async ({ system, messages }) => { calls.push(system); if (/rigorous reviewer/.test(system)) return { text: 'Missing: emergency fund.' }; if (/Rewrite the answer/.test(system)) return { text: `FINAL with fix (${messages[0].content.includes('Missing: emergency fund') ? 'used review' : 'no review'})` }; return { text: 'draft' }; });
  const t = await ask(s, 'חשוב לעומק: איך לשפר את התקציב המשפחתי?');
  assert.equal(t.state, 'COMPLETED');
  assert.equal(calls.length, 3);
  assert.match(t.response, /FINAL with fix \(used review\)/);
});

test('learning: stated preferences are queued as inferred, approved or rejected by the user', async () => {
  const s = await app();
  const t = await ask(s, 'אני מעדיף פגישות בבוקר, תוסיף משימה לקבוע פגישה עם רואה החשבון');
  assert.ok(t.learned);
  const q = s.learning.queue();
  assert.equal(q.length, 1); assert.equal(q[0].provenance, 'inferred'); assert.match(q[0].content, /מעדיף פגישות בבוקר/);
  assert.equal(s.learning.approve(q[0].id).provenance, 'user_statement');
  assert.equal(s.learning.queue().length, 0);
  await ask(s, 'I hate long meetings');
  const id = s.learning.queue()[0].id;
  assert.ok(s.learning.reject(id));
  s.privacy.set({ learningEnabled: false });
  await ask(s, 'I always drink coffee at 7');
  assert.equal(s.learning.queue().length, 0, 'learning can be turned off');
});

test('feedback produces adaptation suggestions the user applies', async () => {
  const s = await app();
  const t = await ask(s, 'organize my day');
  s.learning.feedback({ taskId: t.id, rating: -1, note: 'too long' });
  s.learning.feedback({ taskId: t.id, rating: -1, note: 'ארוך מדי' });
  s.learning.feedback({ taskId: t.id, rating: 1 });
  const st = s.learning.stats();
  assert.equal(st.satisfactionPct, 33);
  assert.equal(st.suggestions[0].id, 'shorter');
  assert.equal(s.learning.applySuggestion('shorter').verbosity, 'short');
  assert.throws(() => s.learning.feedback({ taskId: t.id, rating: 5 }));
});

test('watchers: parsed from words, evaluated exactly, fire once on the edge with cooldown', async () => {
  assert.deepEqual(parseRule('תתריע לי אם ההוצאות על מסעדות עוברות 500'), { metric: 'spend_category_month', params: { category: 'dining' }, op: '>', value: 500 });
  assert.deepEqual(parseRule('alert me if grocery spending goes over 1,000'.replace(',', '')), { metric: 'spend_category_month', params: { category: 'groceries' }, op: '>', value: 1000 });
  assert.equal(parseRule('תודיע לי כשיש חשבון באיחור').metric, 'bills_overdue');
  assert.deepEqual(parseRule('תתריע אם הרצף של ספורט נשבר'), { metric: 'habit_streak', params: { name: 'ספורט' }, op: '==', value: 0 });
  const s = await app();
  const t = await ask(s, 'תתריע לי אם ההוצאות על מסעדות עוברות 500');
  assert.equal(t.state, 'COMPLETED');
  const w = s.watchers.list()[0];
  const before = s.notifications.list().length;
  s.wealth.record({ actor: 'user', householdId: s.householdId }, { amount: -60000, description: 'מסעדה', category: 'dining' });
  assert.equal((await s.watchers.tick()).length, 1);
  assert.equal(s.notifications.list().length, before + 1);
  assert.equal((await s.watchers.tick()).length, 0, 'no repeat while still true');
  assert.ok(s.store.get('watchers', w.id).lastValue >= 600);
  const ov = await ask(s, 'תודיע לי כשיש חשבון באיחור');
  assert.match(ov.response, /התנאי כבר מתקיים/, 'the demo household has an overdue water bill');
});

test('watchers fall back to the model, and its rule is validated', async () => {
  const s = await withModel(async () => ({ text: '{"metric":"tasks_open","params":{},"op":">","value":20}' }));
  const t = await ask(s, 'alert me when my to-do pile gets out of hand, over 20 things');
  assert.equal(t.state, 'COMPLETED');
  assert.equal(s.watchers.list()[0].metric, 'tasks_open');
  const bad = await withModel(async () => ({ text: '{"metric":"rm_rf","op":">","value":1}' }));
  assert.equal((await ask(bad, 'alert me if something weird happens')).state, 'FAILED');
});

test('decision engine: exact weighted ranking and robustness', async () => {
  const d = decisionMatrix({ options: ['EV', 'Hybrid'], criteria: [{ name: 'cost', weight: 5 }, { name: 'range', weight: 3 }, { name: 'environment', weight: 2 }], scores: { EV: { cost: 6, range: 5, environment: 10 }, Hybrid: { cost: 7, range: 9, environment: 5 } } });
  assert.equal(d.winner, 'Hybrid');
  assert.deepEqual(d.ranking.map((r) => r.score), [72, 65]);
  const s = await withModel(async () => ({ text: JSON.stringify({ options: ['EV', 'Hybrid'], criteria: [{ name: 'cost', weight: 5 }, { name: 'range', weight: 3 }], scores: { EV: { cost: 6, range: 5 }, Hybrid: { cost: 7, range: 9 } }, notes: {} }) }));
  const t = await ask(s, 'תעזור לי להחליט: רכב חשמלי או היברידי');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /המלצה: Hybrid/);
});

test('Monte Carlo goal odds are reproducible and sensible', async () => {
  const now = Date.now();
  const deadline = new Date(now + 24.5 * 30.44 * 864e5).toISOString();
  const a = goalProbability({ target: 1000000, saved: 0, deadline }, { monthly: 50000, now });
  const b = goalProbability({ target: 1000000, saved: 0, deadline }, { monthly: 50000, now });
  assert.deepEqual(a, b, 'same seed, same result');
  assert.ok(a.probability > 0.95);
  assert.ok(goalProbability({ target: 1000000, saved: 0, deadline }, { monthly: 30000, now }).probability < 0.05);
  assert.equal(goalProbability({ target: 100, saved: 100, deadline }, { monthly: 0 }).probability, 1);
  const s = await app();
  const t = await ask(s, 'מה הסיכוי שנגיע ליעד החיסכון?');
  assert.equal(t.state, 'COMPLETED'); assert.match(t.response, /Emergency fund: \d+% סיכוי/);
});

test('Claude provider runs a manual tool loop (server mode) and returns all results in one turn', async () => {
  const sent = [];
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'tasks_create', input: { title: 'From Claude' } }, { type: 'tool_use', id: 't2', name: 'home_control', input: { entityId: 'lock.front_door', action: 'unlock' } }], usage: { input_tokens: 10, output_tokens: 5 } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Task added; the door needs your approval.' }], usage: { input_tokens: 20, output_tokens: 8 }, model: 'claude-opus-5-5' },
  ];
  const fake = { messages: { create: async (p) => { sent.push(structuredClone(p)); return replies.shift(); } }, beta: { messages: { create: async (p) => { sent.push(structuredClone(p)); return replies.shift(); } } } };
  const prov = new AnthropicProvider({ client: fake });
  const s = await app({ router: new ModelRouter({ providers: { anthropic: prov } }) });
  const t = await ask(s, 'please handle the house stuff for me today, whatever is pending');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /Task added/);
  assert.ok(s.productivity.listTasks().some((x) => x.title === 'From Claude'));
  assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'locked');
  const second = sent[1].messages;
  assert.equal(second.at(-2).role, 'assistant');
  const results = second.at(-1).content;
  assert.equal(results.length, 2, 'both tool results in one user message');
  assert.match(results[1].content, /awaitingApproval/);
  assert.ok(sent[0].tools.some((x) => x.name === 'tasks_create' && x.input_schema.type === 'object'));
});
