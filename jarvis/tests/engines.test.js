import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, ask } from './helpers.js';
import { ModelRouter } from '../server/core/router.js';
import { buildIcs, parseJson } from '../server/ai/engines.js';

const TIERS = { fast: { provider: 'claude', model: 'quick' }, balanced: { provider: 'claude', model: 'default' }, deep: { provider: 'claude', model: 'complex' }, local: { provider: 'local', model: 'local' } };
function fakeClaude(log = []) {
  return { name: 'claude', capabilities: () => ({ text: true, vision: true, webSearch: false, tools: true }), complete: async ({ system, messages, tools }) => {
    const user = messages.at(-1).content;
    log.push({ system, user, tools: tools?.map((t) => t.name) });
    if (/Return ONLY CSV/.test(system)) return { text: '```csv\ncategory,amount\ngroceries,2700\ndining,380\n```' };
    if (/JSON array of events/.test(system)) return { text: 'Here you go: [{"title":"Piano lesson","start":"2026-11-10T16:00:00","end":"2026-11-10T17:00:00","location":"Music school"},{"title":"Swimming","start":"2026-11-12T17:30:00"}]' };
    if (/self-contained web apps/.test(system)) return { text: '<!doctype html><html><head><title>Water tracker</title><script src="https://evil.example/x.js"></script></head><body><button id="b">+1</button><script>let n=0;b.onclick=()=>b.textContent=++n</script></body></html>' };
    if (/advisory council/.test(system)) return { text: `- view of ${system.match(/"([^"]+)"/)[1]}` };
    if (/chair the council/.test(system)) return { text: 'Recommendation: wait a year.' };
    if (/turn a goal into/.test(system)) return { text: JSON.stringify({ summary: 'Prepare the week', steps: [{ title: 'Add a task', tool: 'tasks.create', args: { title: 'Plan meals' } }, { title: 'Unlock for the cleaner', tool: 'home.control', args: { entityId: 'lock.front_door', action: 'unlock' } }, { title: 'Sleep early', tool: null }, { title: 'Hack', tool: 'not.a.tool', args: {} }] }) };
    if (/Design a JARVIS specialist agent/.test(system)) return { text: '{"name":"Chef","handle":"chef","description":"Plans meals","instructions":"Suggest dinners and add groceries.","tools":["shopping.add","shopping.list","home.control","rm.rf"]}' };
    if (/You are "Chef"/.test(system)) {
      const add = tools.find((t) => t.name === 'shopping_add');
      await add.execute({ item: 'tomatoes' });
      return { text: `Pasta tonight. Tools I had: ${tools.map((t) => t.name).join(',')}` };
    }
    return { text: '# Document\nHello' };
  } };
}
const boot = async (log) => app({ router: new ModelRouter({ providers: { claude: fakeClaude(log) }, tiers: TIERS }) });

test('generator: CSV table is cleaned, saved and indexed; documents saved', async () => {
  const s = await boot();
  const t = await ask(s, 'צור לי טבלה של הוצאות חודשיות לפי קטגוריה');
  assert.equal(t.state, 'COMPLETED');
  const g = s.store.all('generated')[0];
  assert.equal(g.kind, 'table'); assert.equal(g.content, 'category,amount\ngroceries,2700\ndining,380');
  assert.match(g.filename, /\.csv$/);
  assert.equal(t.outputs[0].type, 'file');
  assert.ok(s.documents.list().some((d) => d.name.endsWith('.csv')));
});

test('generator: calendar file built deterministically from model events; can be added to the calendar', async () => {
  const s = await boot();
  await ask(s, 'צור קובץ יומן לחוגים של הילדים');
  const g = s.store.all('generated')[0];
  assert.match(g.content, /BEGIN:VCALENDAR[\s\S]*SUMMARY:Piano lesson[\s\S]*SUMMARY:Swimming[\s\S]*END:VCALENDAR/);
  assert.equal(g.events.length, 2);
  assert.equal(buildIcs([{ title: 'x', start: 'not a date' }]).includes('VEVENT'), false);
});

test('app builder strips remote scripts and stores a sandboxable app', async () => {
  const s = await boot();
  const t = await ask(s, 'בנה לי אפליקציה למעקב שתיית מים');
  assert.equal(t.state, 'COMPLETED');
  const a = s.store.all('apps')[0];
  assert.equal(a.title, 'Water tracker');
  assert.ok(!a.html.includes('evil.example'));
  assert.ok(a.html.includes('b.onclick'));
});

test('council: one call per expert, then a synthesis', async () => {
  const log = [];
  const s = await boot(log);
  const t = await ask(s, 'מועצה: האם לקנות רכב חשמלי?');
  assert.equal(t.state, 'COMPLETED');
  assert.match(t.response, /Recommendation: wait a year/);
  assert.equal(log.filter((l) => /advisory council/.test(l.system)).length, 3);
});

test('plan & execute: runs allowed steps, parks sensitive ones for approval, ignores unknown tools', async () => {
  const s = await boot();
  const t = await ask(s, 'תכנן ובצע: להתכונן לשבוע עמוס');
  assert.equal(t.state, 'COMPLETED');
  const p = s.store.all('plans')[0];
  assert.deepEqual(p.steps.map((x) => x.status), ['done', 'awaiting_approval', 'advice', 'advice']);
  assert.ok(s.productivity.listTasks().some((x) => x.title === 'Plan meals'));
  assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'locked');
  assert.equal(s.store.all('approvals', (a) => a.status === 'pending').length, 1);
});

test('custom agents: designed from words, tools limited to the allow-list, invoked with @handle', async () => {
  const log = [];
  const s = await boot(log);
  const c = await ask(s, 'צור סוכן: מתכנן ארוחות שבועי');
  assert.equal(c.state, 'COMPLETED');
  const a = s.store.all('custom_agents')[0];
  assert.equal(a.handle, 'chef');
  assert.deepEqual(a.tools.sort(), ['home.control', 'shopping.add', 'shopping.list']);
  const r = await ask(s, '@chef מה נבשל היום?');
  assert.equal(r.state, 'COMPLETED');
  assert.match(r.response, /Pasta tonight/);
  assert.ok(s.store.all('shopping').some((x) => x.item === 'tomatoes'));
  assert.deepEqual(log.at(-1).tools.sort(), ['home_control', 'shopping_add', 'shopping_list'], 'agent only gets its own tools');
  assert.equal((await ask(s, '@nobody hi')).state, 'FAILED');
});

test('engines need a model and say so; JSON parsing is tolerant', async () => {
  const s = await app();
  const t = await ask(s, 'צור לי מסמך על תכנון חופשה');
  assert.equal(t.state, 'FAILED');
  assert.match(t.response, /needs an AI model/);
  assert.deepEqual(parseJson('sure! {"a":1} thanks'), { a: 1 });
  assert.equal(s.ai.list().find((e) => e.id === 'deterministic').status, 'online');
});
