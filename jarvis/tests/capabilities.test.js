import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, ask } from './helpers.js';
import { evaluate, parseDate, daysUntil, convert } from '../server/tools/utility.js';
import { ModelRouter } from '../server/core/router.js';
import { Store } from '../server/lib/store.js';

test('calculator: precedence, %, power, parentheses; rejects code', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('(2+3)*4'), 20);
  assert.equal(evaluate('2^10'), 1024);
  assert.equal(evaluate('15% of 340'), 51);
  assert.equal(evaluate('15% מ-340'), 51);
  assert.equal(evaluate('0.1+0.2'), 0.3);
  assert.throws(() => evaluate('1/0'), /zero/);
  assert.throws(() => evaluate('alert(1)'), /pure arithmetic/);
});

test('dates and units', () => {
  const base = new Date(2026, 10, 3);
  assert.equal(daysUntil(parseDate('1.1', base), base), 59);
  assert.equal(daysUntil(parseDate('2026-11-10', base), base), 7);
  assert.equal(convert(100, 'c', 'f'), 212);
  assert.equal(convert(10, 'ק"מ', 'מייל'), 6.2137);
  assert.throws(() => convert(1, 'kg', 'km'), /cannot convert/);
});

test('household records via natural language, in Hebrew', async () => {
  const s = await app();
  const r = await ask(s, 'הוצאתי 120 שקל על סופר');
  assert.equal(r.state, 'COMPLETED'); assert.match(r.response, /נרשמה הוצאה/);
  const tx = s.store.all('transactions', (x) => x.source === 'manual')[0];
  assert.deepEqual([tx.amount, tx.category], [-12000, 'groceries']);
  assert.match((await ask(s, 'קיבלתי 3000 ממשכורת')).response, /נרשמה הכנסה/);
  assert.equal((await ask(s, 'שילמתי את החשמל')).state, 'COMPLETED');
  assert.ok(s.store.all('bills', (b) => b.name === 'Electricity')[0].paid);
  const g = await ask(s, 'הפקדתי 500 לקרן חירום');
  assert.equal(g.state, 'COMPLETED');
  assert.equal(s.store.all('goals', (x) => x.name === 'Emergency fund')[0].saved, 3450000 + 50000);
  assert.ok(s.wealth.clearDemo({ actor: 'user', householdId: s.householdId }) > 10);
  assert.equal(s.store.all('transactions', (x) => x.demo).length, 0);
  assert.equal(s.store.all('transactions', (x) => x.source === 'manual').length, 2, 'user records are kept');
});

test('notes, habits with streaks, timers', async () => {
  const s = await app();
  await ask(s, 'רשום פתק: הקוד של השער 4521');
  assert.match((await ask(s, 'הפתקים שלי')).response, /4521/);
  s.productivity.logHabit('ריצה', '2026-11-01'); s.productivity.logHabit('ריצה', '2026-11-02');
  const h = s.productivity.logHabit('ריצה', '2026-11-03');
  assert.equal(h.streak, 3);
  assert.equal(s.productivity.habitStatus(h.id, '2026-11-04').streak, 3, 'streak survives until the day ends');
  assert.equal(s.productivity.habitStatus(h.id, '2026-11-05').streak, 0);
  const t = await ask(s, 'טיימר 5 דקות');
  assert.equal(t.state, 'COMPLETED');
  const rem = s.store.all('reminders').at(-1);
  assert.ok(Math.abs(Date.parse(rem.at) - Date.now() - 5 * 6e4) < 5000);
});

test('the model acts only through the permission policy', async () => {
  let toolResults = [];
  const fake = { name: 'claude', capabilities: () => ({ text: true, vision: false, webSearch: false, tools: true }), complete: async ({ tools }) => {
    const byName = Object.fromEntries(tools.map((x) => [x.name, x]));
    toolResults = [await byName.tasks_create.execute({ title: 'From the model' }), await byName.home_control.execute({ entityId: 'lock.front_door', action: 'unlock' }), await byName.wealth_transfer.execute({ action: 'transfer' })];
    return { text: 'done' };
  } };
  const s = await app({ router: new ModelRouter({ providers: { claude: fake }, tiers: { fast: { provider: 'claude', model: 'quick' }, balanced: { provider: 'claude', model: 'default' }, deep: { provider: 'claude', model: 'complex' }, local: { provider: 'local', model: 'local' } } }) });
  const t = await ask(s, 'please sort out my week, the leaky tap and the front entrance');
  assert.equal(t.state, 'COMPLETED');
  assert.equal(toolResults[0].executed, true);
  assert.ok(s.productivity.listTasks().some((x) => x.title === 'From the model'));
  assert.equal(toolResults[1].awaitingApproval, true, 'unlock needs approval');
  assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'locked');
  assert.equal(toolResults[2].awaitingApproval, true, 'money needs approval (and is never executed)');
  assert.equal(s.store.all('approvals', (a) => a.status === 'pending').length, 2);
  assert.ok(s.audit.list().some((a) => a.action === 'model.tool_call' && a.detail.tool === 'home.control'));
  s.policy.setAutonomy(1);
  await ask(s, 'please sort out my week again');
  assert.equal(toolResults[0].executed, false, 'advisory mode: the model cannot act');
});

test('store persistence hooks: dirty collections and external save', () => {
  const saved = [];
  const st = new Store(null, { data: { tasks: [] }, onSave: (d) => saved.push([...d]) });
  st.insert('notes', { text: 'x' }); st.setMeta('k', 1);
  assert.ok(saved.at(-1).includes('notes') && saved.at(-1).includes('_meta'));
});
