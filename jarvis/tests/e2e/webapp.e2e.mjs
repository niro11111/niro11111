// End-to-end test of the standalone web app (dist/webapp): JARVIS running entirely in the
// browser. Checks commands, new capabilities, persistence across reloads, and the claude.ai
// mode (per-user database + Claude with page tools) against a simulated viewer runtime.
//   npm run build:webapp && node tests/e2e/webapp.e2e.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/webapp');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  const f = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch();
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e.message.split('\n')[0]}`); } };

async function ask(page, text, expect) {
  await page.fill('.composer input[dir=auto]', text); await page.press('.composer input[dir=auto]', 'Enter');
  try {
    await page.waitForFunction((re) => new RegExp(re).test([...document.querySelectorAll('.chat .msg.jarvis')].pop()?.textContent ?? ''), expect.source, { timeout: 15000 });
  } catch { throw new Error(`"${text}" -> ${await page.evaluate(() => [...document.querySelectorAll('.chat .msg.jarvis')].pop()?.textContent)}`); }
}

try {
  // ---------------- standalone browser mode ----------------
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|open-meteo|fonts/.test(m.text())) errors.push(m.text()); });

  await check('boots with no server and no login, Hebrew RTL', async () => {
    await page.goto(`${url}#conversation`);
    await page.waitForSelector('#view .composer', { timeout: 15000 });
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
    assert.ok(!(await page.isVisible('#login')));
  });
  await check('core commands answer in Hebrew', async () => {
    await ask(page, 'תארגן לי את היום', /תדריך ליום/);
    await ask(page, 'כמה הוצאנו החודש?', /הוצאתם/);
  });
  await check('new capabilities: calculator, dates, units, timer, notes, habits', async () => {
    await ask(page, 'כמה זה 15% מ-340', /= 51/);
    await ask(page, 'convert 10 km to mi', /6\.2137/);
    await ask(page, 'כמה ימים עד 1.1', /ימים עד/);
    await ask(page, 'טיימר 3 דקות', /טיימר ל-3 דקות/);
    await ask(page, 'רשום פתק: לקנות מתנה לנועה', /הפתק נשמר/);
    await ask(page, 'עשיתי ספורט היום', /רצף: 1/);
  });
  await check('household records: expense, bill paid, goal deposit', async () => {
    await ask(page, 'הוצאתי 120 שקל על סופר', /נרשמה הוצאה: ₪120/);
    await ask(page, 'שילמתי את החשמל', /סומן כשולם/);
    await ask(page, 'הפקדתי 500 לקרן חירום', /נרשמה הפקדה/);
  });
  await check('money is still never moved', async () => {
    await ask(page, 'תעביר 500 לדני', /צריך את אישורך/);
  });
  await check('data survives a reload (localStorage)', async () => {
    await page.waitForTimeout(2000); // debounced save
    await page.reload();
    await page.goto(`${url}#planner`); await page.waitForSelector('#nf', { timeout: 15000 });
    assert.match(await page.textContent('#view'), /לקנות מתנה לנועה/);
    assert.match(await page.textContent('#view'), /ספורט/);
  });
  await check('every screen renders in the standalone app', async () => {
    for (const v of ['command', 'map', 'agents', 'automations', 'knowledge', 'planner', 'wealth', 'home', 'devices', 'console', 'privacy', 'preferences']) {
      await page.goto(`${url}#${v}`); await page.waitForTimeout(400);
      assert.ok(!(await page.$('#view .panel.err')), v);
    }
    assert.deepEqual(errors, []);
  });
  await check('wealth forms record a transaction', async () => {
    await page.goto(`${url}#wealth`); await page.waitForSelector('#txF');
    await page.fill('#txF [name=amount]', '42.5'); await page.fill('#txF [name=description]', 'קפה עם חברים'); await page.click('#txF button');
    await page.waitForFunction(() => /קפה עם חברים/.test(document.querySelector('#view').textContent));
  });
  await ctx.close();

  // ---------------- claude.ai mode (simulated viewer runtime) ----------------
  const c2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.addInitScript(() => {
    const docs = (window.__docs = new Map(JSON.parse(sessionStorage.getItem('fakedb') ?? '[]')));
    const persist = () => sessionStorage.setItem('fakedb', JSON.stringify([...docs]));
    const snap = (p) => ({ id: p.split('/').pop(), exists: docs.has(p), data: () => (docs.has(p) ? structuredClone(docs.get(p)) : undefined) });
    const db = { doc: (p) => ({ path: p, get: async () => snap(p), set: async (d) => { if (JSON.stringify(d).length > 262144) throw { code: 'invalid_argument' }; docs.set(p, structuredClone(d)); persist(); }, delete: async () => { docs.delete(p); persist(); } }) };
    window.__toolCalls = [];
    const sample = async (input, opts = {}) => {
      const last = input[input.length - 1].content;
      if (opts.tools && /מטלה/.test(last)) {
        const create = opts.tools.find((t) => t.name === 'tasks_create');
        const unlock = opts.tools.find((t) => t.name === 'home_control');
        const r1 = await create.execute({ title: 'לתקן את הברז' }, { signal: new AbortController().signal });
        const r2 = await unlock.execute({ entityId: 'lock.front_door', action: 'unlock' }, { signal: new AbortController().signal });
        window.__toolCalls.push(r1, r2);
        return { text: `יצרתי מטלה. לגבי הדלת: ${r2.awaitingApproval ? 'ממתין לאישור שלך' : 'בוצע'}.`, truncated: false, modelTierApplied: 'default' };
      }
      return { text: 'שלום, אני Claude.', truncated: false, modelTierApplied: 'default' };
    };
    sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 64 } });
    const caps = { db, sample, user: { id: async () => 'viewer1' }, downloads: { save: async () => ({}) }, permissions: { manage: async () => {} } };
    window.claude = { use: async (n) => caps[n] ?? null };
  });
  const p2 = await c2.newPage();
  const e2 = []; p2.on('pageerror', (e) => e2.push(e.message));
  await check('claude.ai mode: data goes to the per-user database', async () => {
    await p2.goto(`${url}#conversation`); await p2.waitForSelector('#view .composer', { timeout: 15000 });
    await ask(p2, 'רשום פתק: נשמר בענן', /הפתק נשמר/);
    await p2.waitForTimeout(2000);
    const keys = await p2.evaluate(() => [...window.__docs.keys()]);
    assert.ok(keys.includes('data/users/viewer1/manifest'), keys.join(','));
    assert.ok(keys.some((k) => k.startsWith('data/users/viewer1/cnotes.')));
    const memDoc = await p2.evaluate(() => JSON.stringify([...window.__docs].filter(([k]) => k.includes('cmemories'))));
    assert.ok(!memDoc.includes('"vector"'), 'derived vectors are not stored');
  });
  await check('claude.ai mode: Claude answers open questions and acts through JARVIS tools, sensitive ones wait for approval', async () => {
    await ask(p2, 'מה שלומך?', /שלום, אני Claude/);
    await ask(p2, 'בבקשה תטפל במטלה של הברז ובמנעול של הכניסה', /ממתין לאישור שלך/);
    const calls = await p2.evaluate(() => window.__toolCalls);
    assert.equal(calls[0].executed, true);
    assert.equal(calls[1].executed, false); assert.equal(calls[1].awaitingApproval, true);
    await p2.goto(`${url}#planner`); await p2.waitForSelector('#nf');
    assert.match(await p2.textContent('#view'), /לתקן את הברז/);
  });
  await check('claude.ai mode: data survives reload from the database', async () => {
    await p2.reload(); await p2.goto(`${url}#planner`); await p2.waitForSelector('#nf', { timeout: 15000 });
    assert.match(await p2.textContent('#view'), /נשמר בענן/);
    assert.deepEqual(e2, []);
  });
} finally { await browser.close(); srv.close(); }
console.log(failures ? `\n${failures} failed` : '\nall webapp checks passed');
process.exit(failures ? 1 : 0);
