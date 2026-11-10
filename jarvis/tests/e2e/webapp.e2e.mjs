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
    for (const v of ['command', 'map', 'agents', 'brain', 'learn', 'neural', 'graph', 'worlds', 'missions', 'ai', 'automations', 'knowledge', 'planner', 'wealth', 'home', 'devices', 'console', 'database', 'privacy', 'preferences']) {
      await page.goto(`${url}#${v}`); await page.waitForTimeout(400);
      assert.ok(!(await page.$('#view .panel.err')), v);
    }
    assert.deepEqual(errors, []);
  });
  await check('self-improvement: recurring failure → proposal → sandbox test → approve & deploy → rollback; lab runs code in a worker; all screens render', async () => {
    await page.goto(`${url}#conversation`); await page.waitForSelector('#view .composer');
    for (const m of ['תמונת מצב כספית', 'מצב כספי', 'מה המצב הכספי שלי']) await ask(page, m, /מודל|model/);
    await page.goto(`${url}#learn`); await page.waitForSelector('#lCycle', { timeout: 15000 });
    await page.click('#lCycle'); await page.waitForTimeout(800);
    await page.click('[data-ltab=C]'); await page.waitForSelector('[data-pexp]', { timeout: 15000 });
    await page.click('[data-pexp]'); await page.waitForSelector('[data-pok]', { timeout: 20000 });
    await page.click('[data-pok]'); await page.click('.dlg-yes'); await page.waitForTimeout(500);
    await page.goto(`${url}#conversation`); await page.waitForSelector('#view .composer');
    await ask(page, 'תמונת מצב כספית', /הכנסות|הוצאות|תזרים|₪/);
    await page.goto(`${url}#learn`); await page.waitForSelector('[data-ltab]'); await page.click('[data-ltab=F]'); await page.waitForSelector('[data-drb]');
    await page.click('[data-drb]'); await page.click('.dlg-yes'); await page.waitForFunction(() => !document.querySelector('[data-drb]'), null, { timeout: 10000 });
    await page.click('[data-ltab=E]'); await page.waitForSelector('#labF');
    await page.click('#labF button.primary'); await page.waitForSelector('[data-lver]');
    await page.click('[data-lver]'); await page.waitForSelector('[data-linst]', { timeout: 15000 });
    await page.click('[data-linst]'); await page.click('.dlg-yes'); await page.waitForSelector('[data-lun]', { timeout: 10000 });
    if (process.env.SHOT) { await page.click('[data-ltab=A]'); await page.waitForTimeout(1600); await page.screenshot({ path: process.env.SHOT, fullPage: true }); }
    for (const tb of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) { await page.goto(`${url}#learn`); await page.waitForSelector('[data-ltab]'); await page.click(`[data-ltab=${tb}]`); await page.waitForTimeout(500); assert.ok(!(await page.$('#view .panel.err')), tb); }
    assert.deepEqual(errors, []);
  });
  await check('neural lab: trains the intent network in the browser, predicts, knowledge graph from memories', async () => {
    await page.goto(`${url}#conversation`); await page.waitForSelector('#view .composer');
    await ask(page, 'remember that my wife Dana works at Acme', /./);
    await page.goto(`${url}#neural`); await page.waitForSelector('#trI', { timeout: 15000 });
    await page.click('#trI'); await page.waitForSelector('#plF', { timeout: 60000 });
    await page.fill('#plF input', 'what bills do I have to pay this week'); await page.click('#plF button');
    await page.waitForFunction(() => /wealth\.bills/.test(document.querySelector('#plOut')?.textContent ?? ''), null, { timeout: 10000 });
    if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2, fullPage: true });
    await page.goto(`${url}#graph`); await page.waitForSelector('[data-node]', { timeout: 15000 });
    await page.click('[data-node="Dana"]'); await page.waitForFunction(() => /works_at/.test(document.querySelector('#kgAbout')?.textContent ?? ''), null, { timeout: 10000 });
    if (process.env.SHOT3) await page.screenshot({ path: process.env.SHOT3, fullPage: true });
    await page.goto(`${url}#database`); await page.waitForTimeout(500);
    assert.match(await page.textContent('#view'), /browser|localStorage|דפדפן/i);
    assert.deepEqual(errors, []);
  });
  await check('Digital Worlds in the browser build: generates the project, execution stages honestly BLOCKED', async () => {
    await page.goto(`${url}#worlds`); await page.waitForSelector('[data-wt=create]', { timeout: 15000 });
    assert.match(await page.textContent('#view'), /npm start/);
    await page.click('[data-wt=create]'); await page.click('[data-pre="3"]'); await page.click('#wF button.primary');
    await page.waitForFunction(() => /BLOCKED/.test(document.querySelector('.pipeline')?.textContent ?? ''), null, { timeout: 30000 });
    assert.match(await page.textContent('.pipeline'), /IMPLEMENTED|BLOCKED/);
    assert.doesNotMatch(await page.$eval('#wtBody table', (t) => t.textContent), /\b(?:TESTED|VERIFIED)\b/); // no feature claims tests in the browser
    await page.click('[data-wtab=code]'); await page.waitForSelector('[data-file="server.js"]');
    assert.deepEqual(errors, []);
  });
  await check('dictation mode sends automatically after a pause', async () => {
    await page.goto(`${url}#conversation`); await page.waitForSelector('#view .composer');
    await page.click('.dict-btn');
    assert.equal(await page.getAttribute('.dict-btn', 'aria-pressed'), 'true');
    await page.type('.composer input[dir=auto]', 'הפתקים שלי', { delay: 20 });
    await page.waitForFunction(() => /לקנות מתנה לנועה/.test([...document.querySelectorAll('.chat .msg.jarvis')].pop()?.textContent ?? ''), null, { timeout: 8000 });
    await page.click('.dict-btn');
  });
  await check('brain: feedback, learning queue and a watcher from words', async () => {
    await page.goto(`${url}#conversation`); await page.waitForSelector('#view .composer');
    await ask(page, 'אני מעדיף תשובות קצרות, מה המשימות שלי', /./);
    await page.click('.chat .msg.jarvis:last-child [data-fb="1"]');
    await page.waitForSelector('.chat .msg.jarvis:last-child .fb .muted');
    await page.goto(`${url}#brain`); await page.waitForSelector('#wF');
    assert.match(await page.textContent('#view'), /אני מעדיף תשובות קצרות/);
    await page.click('[data-lok]');
    await page.waitForFunction(() => !document.querySelector('[data-lok]'));
    await page.fill('#wF input', 'תתריע לי אם ההוצאות על מסעדות עוברות 500'); await page.click('#wF button');
    await page.waitForFunction(() => /spend_category_month\(dining\) > 500/.test(document.querySelector('#view').textContent));
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
    if (window.top !== window) return; // the simulated viewer runtime exists only in the top page, not in sandboxed app frames
    const docs = (window.__docs = new Map(JSON.parse(sessionStorage.getItem('fakedb') ?? '[]')));
    const persist = () => sessionStorage.setItem('fakedb', JSON.stringify([...docs]));
    const snap = (p) => ({ id: p.split('/').pop(), exists: docs.has(p), data: () => (docs.has(p) ? structuredClone(docs.get(p)) : undefined) });
    const db = { doc: (p) => ({ path: p, get: async () => snap(p), set: async (d) => { if (JSON.stringify(d).length > 262144) throw { code: 'invalid_argument' }; docs.set(p, structuredClone(d)); persist(); }, delete: async () => { docs.delete(p); persist(); } }) };
    window.__toolCalls = [];
    const sample = async (input, opts = {}) => {
      const last = input[input.length - 1].content;
      const sys = input[0].content;
      if (/Return ONLY CSV/.test(sys)) return { text: 'item,price\nmilk,7\nbread,12', truncated: false, modelTierApplied: 'default' };
      if (/self-contained web apps/.test(sys)) return { text: '<!doctype html><html><head><title>Counter</title></head><body><button id="b">0</button><script>let n=0;b.onclick=()=>b.textContent=++n</script></body></html>', truncated: false, modelTierApplied: 'default' };
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
    await ask(p2, 'ספר לי משהו מעניין על כוכבים', /שלום, אני Claude/);
    await ask(p2, 'בבקשה תטפל במטלה של הברז ובמנעול של הכניסה', /ממתין לאישור שלך/);
    const calls = await p2.evaluate(() => window.__toolCalls);
    assert.equal(calls[0].executed, true);
    assert.equal(calls[1].executed, false); assert.equal(calls[1].awaitingApproval, true);
    await p2.goto(`${url}#planner`); await p2.waitForSelector('#nf');
    assert.match(await p2.textContent('#view'), /לתקן את הברז/);
  });
  await check('claude.ai mode: generator makes a CSV table and AI Studio shows it', async () => {
    await p2.goto(`${url}#conversation`); await p2.waitForSelector('#view .composer');
    await ask(p2, 'צור לי טבלה של מחירי מצרכים', /נוצר/);
    await p2.goto(`${url}#ai`); await p2.waitForSelector('#genF');
    assert.match(await p2.textContent('#view'), /\.csv/);
    await p2.click('[data-fopen]'); await p2.waitForSelector('#fileView table');
    assert.match(await p2.textContent('#fileView'), /bread/);
  });
  await check('claude.ai mode: app builder runs the app in a sandboxed frame', async () => {
    await p2.fill('#appF textarea', 'מונה לחיצות'); await p2.click('#appF button');
    const frame = await (await p2.waitForSelector('#appStage iframe', { timeout: 15000 })).contentFrame();
    assert.equal(await p2.getAttribute('#appStage iframe', 'sandbox'), 'allow-scripts allow-forms');
    await frame.click('#b'); await frame.click('#b');
    assert.equal(await frame.textContent('#b'), '2');
    assert.equal(await frame.evaluate(() => { try { return !!window.parent.document; } catch { return 'blocked'; } }), 'blocked', 'the app cannot reach JARVIS');
  });
  await check('claude.ai mode: data survives reload from the database', async () => {
    await p2.reload(); await p2.goto(`${url}#planner`); await p2.waitForSelector('#nf', { timeout: 15000 });
    assert.match(await p2.textContent('#view'), /נשמר בענן/);
    assert.deepEqual(e2, [], JSON.stringify(e2));
  });
  // ---------------- single-file build opened straight from disk ----------------
  await check('single HTML file runs from file:// with no server (chat, isolated code, persistence)', async () => {
    const fileUrl = `file://${path.resolve(dist, '../jarvis.html')}`;
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p3 = await c3.newPage();
    const e3 = []; p3.on('pageerror', (e) => e3.push(e.message));
    await p3.goto(`${fileUrl}#conversation`); await p3.waitForSelector('#view .composer', { timeout: 20000 });
    await ask(p3, 'כמה הוצאנו החודש?', /הוצאתם/);
    await ask(p3, 'run code: [1,2,3].map(x=>x*x)', /1,4,9/);
    await ask(p3, 'add task single file check', /./);
    await p3.reload(); await p3.goto(`${fileUrl}#planner`); await p3.waitForTimeout(1200);
    assert.match(await p3.textContent('#view'), /single file check/);
    assert.deepEqual(e3, []); await c3.close();
  });
  await check('single HTML file also works in a sandboxed preview (storage blocked) and without crypto.randomUUID', async () => {
    const htmlText = fs.readFileSync(path.resolve(dist, '../jarvis.html'), 'utf8');
    const c4 = await browser.newContext(); const p4 = await c4.newPage();
    const e4 = []; p4.on('pageerror', (e) => e4.push(e.message));
    await p4.addInitScript(() => { try { delete Crypto.prototype.randomUUID; } catch {} });
    await p4.setContent('<iframe id="f" sandbox="allow-scripts allow-forms allow-modals" style="width:1200px;height:800px;border:0"></iframe>');
    await p4.$eval('#f', (f, h) => { f.srcdoc = h; }, htmlText);
    const fr = () => p4.frames()[1];
    await fr().waitForSelector('#nav a', { timeout: 20000 });
    await fr().evaluate(() => { location.hash = '#conversation'; });
    await fr().waitForSelector('.composer input[dir=auto]');
    await fr().fill('.composer input[dir=auto]', 'כמה הוצאנו החודש?'); await fr().press('.composer input[dir=auto]', 'Enter');
    await fr().waitForFunction(() => /הוצאתם/.test([...document.querySelectorAll('.chat .msg.jarvis')].pop()?.textContent ?? ''), null, { timeout: 15000 });
    assert.ok(await fr().evaluate(() => /האחסון חסום/.test(document.body.innerText)), 'storage warning shown');
    assert.deepEqual(e4, []); await c4.close();
  });
} finally { await browser.close(); srv.close(); }
console.log(failures ? `\n${failures} failed` : '\nall webapp checks passed');
process.exit(failures ? 1 : 0);
