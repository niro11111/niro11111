// Real external integrations. The services' HTTP APIs are stood in by a recorder that returns the
// response shapes documented by each service (Telegram Bot API, Make API v2, Airtable Web API,
// Frankfurter, MediaWiki, RSS), so these tests check the exact requests JARVIS sends and how it
// treats real answers and real errors. Live calls are covered by the manual check in docs/INTEGRATIONS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { ModelRouter } from '../server/core/router.js';
import { DemoHomeAdapter } from '../server/home/smarthome.js';
import { createApi } from '../server/api/routes.js';
import { parse } from '../server/core/intent.js';
import { parseFeed } from '../server/integrations/hub.js';
import { matchWake, wakePhrases, setWakeSensitivity } from '../web/js/wake.js';

const TG = '123456789:AAHfakeTokenForTests_abcdefghijk';
function fakeNet() {
  const calls = [];
  const json = (b, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
  const fetch = async (url, o = {}) => {
    const u = new URL(url); const body = o.body ? JSON.parse(o.body) : null; const h = o.headers ?? {};
    calls.push({ url: String(url), method: o.method ?? 'GET', body, headers: h });
    if (u.hostname === 'api.telegram.org') {
      if (!u.pathname.startsWith(`/bot${TG}/`)) return json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);
      const m = u.pathname.split('/').pop();
      if (m === 'getMe') return json({ ok: true, result: { id: 1, is_bot: true, username: 'my_jarvis_bot' } });
      if (m === 'getUpdates') return json({ ok: true, result: [{ update_id: 9, message: { message_id: 1, chat: { id: 55501, first_name: 'Nir', type: 'private' }, text: '/start' } }] });
      if (m === 'sendMessage') return json({ ok: true, result: { message_id: 77, chat: { id: body.chat_id }, text: body.text } });
    }
    if (u.hostname === 'eu1.make.com') {
      if (h.authorization !== 'Token make-tok') return json({ message: 'Access denied', code: 'IM005' }, 401);
      if (u.pathname === '/api/v2/users/me') return json({ authUser: { id: 3, name: 'Owner', email: 'x' } });
      if (u.pathname === '/api/v2/scenarios') return json({ scenarios: [{ id: 8663233, name: 'JARVIS daily summary', isActive: true, scheduling: { type: 'daily' } }, { id: 42, name: 'Lead intake', isActive: false }] });
      if (u.pathname === '/api/v2/scenarios/8663233/run') return json({ executionId: 'ex-abc', status: 1 });
    }
    if (u.hostname === 'hook.eu1.make.com') return { ok: true, status: 200, text: async () => 'Accepted' };
    if (u.hostname === 'api.airtable.com') {
      if (h.authorization !== 'Bearer pat-test') return json({ error: { type: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } }, 401);
      if (u.pathname === '/v0/meta/bases') return json({ bases: [{ id: 'appeuBOJ6UVx2hxF3', name: 'Personal Task Manager' }] });
      if (u.pathname === '/v0/meta/bases/appeuBOJ6UVx2hxF3/tables') return json({ tables: [{ id: 'tbl1', name: 'Table 1', primaryFieldId: 'f1', fields: [{ id: 'f1', name: 'Name', type: 'singleLineText' }, { id: 'f2', name: 'Status', type: 'singleSelect' }] }] });
      if (u.pathname === '/v0/appeuBOJ6UVx2hxF3/Table%201' && o.method === 'POST') return json({ records: [{ id: 'recNEW1', createdTime: 'now', fields: body.records[0].fields }] });
      if (u.pathname === '/v0/appeuBOJ6UVx2hxF3/Table%201/recNEW1') return json({ id: 'recNEW1', fields: {} });
      if (u.pathname === '/v0/appeuBOJ6UVx2hxF3/Table%201') return json({ records: [{ id: 'rec1', createdTime: 't', fields: { Name: 'Fix the door', Status: 'Todo' } }] });
    }
    if (u.hostname === 'api.frankfurter.dev') return json({ amount: 1, base: u.searchParams.get('from'), date: '2026-11-20', rates: { [u.searchParams.get('to')]: 3.3428 } });
    if (u.hostname === 'he.wikipedia.org') {
      if (u.pathname === '/w/api.php') return json([u.searchParams.get('search'), ['דוד בן-גוריון'], [''], ['https://he.wikipedia.org/wiki/x']]);
      return json({ title: 'דוד בן-גוריון', extract: 'ראש הממשלה הראשון של מדינת ישראל.', content_urls: { desktop: { page: 'https://he.wikipedia.org/wiki/%D7%93' } } });
    }
    if (u.hostname === 'www.ynet.co.il') return { ok: true, status: 200, text: async () => '<rss><channel><item><title><![CDATA[כותרת ראשונה]]></title><link>https://ynet.co.il/1</link><pubDate>Sat, 21 Nov 2026</pubDate></item><item><title>Second &amp; more</title><link>https://ynet.co.il/2</link></item></channel></rss>' };
    if (u.hostname === 'feeds.bbci.co.uk') throw new TypeError('fetch failed');
    return json({ error: 'unexpected host' }, 404);
  };
  return { fetch, calls };
}

async function mk() {
  const net = fakeNet();
  const s = await createApp({ file: null, router: new ModelRouter(), home: new DemoHomeAdapter(), seed: true, fetch: net.fetch });
  return { s, net, api: createApi(s, 'owner-token') };
}
const call = (api, method, url, body, token = 'owner-token') => api.handle({ method, url, authorization: token ? `Bearer ${token}` : undefined, body });

test('status comes only from real calls; tokens are never returned; bad tokens are reported as the service said', async () => {
  const { s, api } = await mk();
  let list = (await call(api, 'GET', '/api/integrations/hub')).body;
  assert.equal(list.find((x) => x.id === 'telegram').status, 'not_configured');
  assert.equal(list.find((x) => x.id === 'fx').status, 'configured'); // keyless, never tested yet
  assert.throws(() => s.integrations.configure('telegram', { botToken: 'nonsense' }), /Telegram bot token/);
  const put = await call(api, 'PUT', '/api/integrations/hub/telegram', { botToken: TG });
  assert.equal(put.status, 200);
  assert.equal(put.body.config.botToken, undefined);
  assert.equal(put.body.config.botTokenSet, true);
  assert.match(put.body.config.botTokenHint, /hijk$/);
  assert.ok(!JSON.stringify((await call(api, 'GET', '/api/integrations/hub')).body).includes(TG), 'token leaked');
  const t = await call(api, 'POST', '/api/integrations/hub/telegram/test');
  assert.equal(t.status, 200); assert.match(t.body.detail, /@my_jarvis_bot/);
  // a wrong token: the service's own error, and the status becomes failed
  s.integrations.configure('telegram', { botToken: '999999:AAHwrongTokenForTests_abcdefghijk' });
  const bad = await call(api, 'POST', '/api/integrations/hub/telegram/test');
  assert.equal(bad.status, 401); assert.match(bad.body.error, /Unauthorized/);
  list = (await call(api, 'GET', '/api/integrations/hub')).body;
  assert.equal(list.find((x) => x.id === 'telegram').status, 'not_configured'); // no chat yet
  assert.equal(list.find((x) => x.id === 'telegram').last.ok, false);
});

test('Telegram: find my chat, send by voice command, verified, and notifications forwarded', async () => {
  const { s, net } = await mk();
  s.integrations.configure('telegram', { botToken: TG });
  const chat = await s.integrations.telegramFindChat();
  assert.equal(chat.chatId, '55501');
  const r = await s.core.handle('שלח לי לטלגרם: לקנות חלב', { householdId: s.householdId, conversationId: 't' });
  assert.equal(r.state, 'COMPLETED', r.response);
  assert.match(r.response, /נשלח לטלגרם/);
  const sent = net.calls.find((c) => c.url.endsWith('/sendMessage'));
  assert.deepEqual(sent.body, { chat_id: '55501', text: 'לקנות חלב' });
  assert.equal(s.integrations.status('telegram'), 'connected');
  s.integrations.configure('telegram', { forwardNotifications: true });
  const n = await s.notifications.send({ title: 'בדיקת התראה', priority: 'critical' });
  assert.deepEqual(n.deliveries.find((d) => d.channel === 'telegram'), { channel: 'telegram', status: 'sent' });
  assert.match(net.calls.filter((c) => c.url.endsWith('/sendMessage')).pop().body.text, /בדיקת התראה/);
});

test('Make: scenarios, run by name (real run endpoint), webhooks; private URLs refused', async () => {
  const { s, net } = await mk();
  await assert.rejects(() => s.integrations.makeScenarios(), /team id/);
  s.integrations.configure('make', { zone: 'eu1', teamId: '3659232', apiToken: 'make-tok', webhooks: [{ name: 'tasks', url: 'https://hook.eu1.make.com/abc123' }] });
  assert.match((await s.integrations.test('make')).detail, /Owner/);
  const r = await s.core.handle('הפעל את התרחיש JARVIS daily summary', { householdId: s.householdId, conversationId: 't' });
  assert.equal(r.state, 'COMPLETED', r.response);
  assert.match(r.response, /8663233/);
  const run = net.calls.find((c) => c.url.endsWith('/scenarios/8663233/run'));
  assert.equal(run.method, 'POST'); assert.equal(run.headers.authorization, 'Token make-tok');
  const miss = await s.core.handle('run the scenario nothing like this', { householdId: s.householdId, conversationId: 't2' });
  assert.notEqual(miss.state, 'COMPLETED'); assert.match(miss.response, /Lead intake/);
  const w = await s.core.handle('שלח ל-Make: משימה חדשה', { householdId: s.householdId, conversationId: 't3' });
  assert.equal(w.state, 'COMPLETED', w.response);
  assert.equal(net.calls.find((c) => c.url.startsWith('https://hook.eu1.make.com')).body.text, 'משימה חדשה');
  for (const url of ['http://hook.eu1.make.com/x', 'https://127.0.0.1/x', 'https://192.168.1.5/x', 'https://intranet.local/x']) assert.throws(() => s.integrations.configure('make', { webhooks: [{ name: 'x', url }] }), /https|private/);
});

test('Airtable: test lists bases, create a record by voice, verified by reading it back', async () => {
  const { s, net } = await mk();
  s.integrations.configure('airtable', { token: 'pat-test', baseId: 'appeuBOJ6UVx2hxF3', table: 'Table 1' });
  assert.match((await s.integrations.test('airtable')).detail, /Personal Task Manager/);
  const r = await s.core.handle('הוסף ל-Airtable: לתקן את הדלת', { householdId: s.householdId, conversationId: 't' });
  assert.equal(r.state, 'COMPLETED', r.response);
  assert.deepEqual(net.calls.find((c) => c.method === 'POST' && c.url.includes('api.airtable.com')).body, { records: [{ fields: { Name: 'לתקן את הדלת' } }], typecast: true });
  assert.ok(net.calls.some((c) => c.url.endsWith('/recNEW1')), 'verified by reading back');
  const l = await s.core.handle('show my airtable', { householdId: s.householdId, conversationId: 't2' });
  assert.match(l.response, /Fix the door/);
});

test('keyless knowledge: exchange rate, Wikipedia (with API user agent), news with a failing feed', async () => {
  const { s, net } = await mk();
  const fx = await s.core.handle('כמה זה 100 דולר בשקלים', { householdId: s.householdId, conversationId: 't' });
  assert.match(fx.response, /100 USD = 334\.28 ILS/);
  const w = await s.core.handle('חפש בוויקיפדיה דוד בן גוריון', { householdId: s.householdId, conversationId: 't2' });
  assert.deepEqual(w.plan.tools, ['wiki.lookup']);
  assert.match(w.response, /ראש הממשלה הראשון/); assert.match(w.response, /wikipedia\.org/);
  // no language model configured: a factual question is answered from Wikipedia, with its source
  const q = await s.core.handle('מי היה דוד בן גוריון', { householdId: s.householdId, conversationId: 't4' });
  assert.deepEqual(q.plan.tools, ['llm.answer']);
  assert.match(q.response, /ראש הממשלה הראשון/); assert.match(q.response, /מקור: https:\/\/he\.wikipedia\.org/);
  assert.ok(net.calls.filter((c) => c.url.includes('wikipedia')).every((c) => /JARVIS/.test(c.headers['api-user-agent'])));
  const n = await s.core.handle('חדשות', { householdId: s.householdId, conversationId: 't3' });
  assert.match(n.response, /כותרת ראשונה/); assert.match(n.response, /BBC/); // the failing feed is named, not hidden
  assert.deepEqual(parseFeed('<feed><entry><title>A</title><link href="https://x/1"/></entry></feed>'), [{ title: 'A', link: 'https://x/1', date: '' }]);
});

test('incoming webhook: own secret URL, no owner token, only notify/task/note, rate limited', async () => {
  const { s, api } = await mk();
  const c = (await call(api, 'POST', '/api/integrations/hub/inbound/create')).body;
  assert.match(c.path, /^\/api\/hooks\/in\/[0-9a-f]{36}$/);
  assert.equal((await call(api, 'POST', '/api/hooks/in/wrong', { text: 'x' }, null)).status, 404);
  const ok = await call(api, 'POST', c.path, { action: 'task', text: 'לחדש ביטוח רכב' }, null);
  assert.equal(ok.status, 200);
  assert.ok(s.store.all('tasks').some((t) => t.title === 'לחדש ביטוח רכב'));
  assert.equal((await call(api, 'POST', c.path, { action: 'command', text: 'transfer money' }, null)).status, 400);
  assert.equal((await call(api, 'GET', '/api/integrations/hub', null, null)).status, 401); // the rest still needs the owner token
  let last; for (let i = 0; i < 35; i++) last = await call(api, 'POST', c.path, { action: 'notify', text: `n${i}` }, null);
  assert.equal(last.status, 429);
});

test('intent routing for integrations does not steal other requests', () => {
  const tool = (q) => parse(q).steps?.[0]?.tool ?? parse(q)[0]?.tool;
  assert.equal(tool('מה מזג האוויר היום'), 'weather.now');
  assert.equal(tool('convert 20 usd to eur'), 'fx.rate');
  assert.equal(tool('אילו תרחישים יש לי'), 'make.scenarios');
  assert.notEqual(tool('כמה שקלים הוצאתי החודש'), 'fx.rate');
  assert.notEqual(tool('תתריע לי אם יירד גשם'), 'weather.now');
  assert.equal(tool('תזכיר לי מחר לקנות חלב'), 'reminders.create');
});

test('wake-word sensitivity: strict rejects a misheard name that normal accepts', () => {
  const P = wakePhrases('JARVIS', '');
  setWakeSensitivity('normal'); assert.equal(matchWake('jarvas turn on the light', P).matched, true);
  setWakeSensitivity('strict'); assert.equal(matchWake('jarvas turn on the light', P).matched, false);
  assert.equal(matchWake('jarvis turn on the light', P).matched, true);
  setWakeSensitivity('normal');
});
