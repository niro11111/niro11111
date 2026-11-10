// Browser end-to-end test of the web command center: every screen renders without errors,
// Hebrew RTL and English LTR, accessible names on buttons, approval flow, phone width.
//   npm run test:e2e   (needs Playwright + Chromium)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { createServer } from '../../server/index.js';
import { ModelRouter } from '../../server/core/router.js';
import { DemoHomeAdapter } from '../../server/home/smarthome.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const VIEWS = ['command', 'conversation', 'map', 'agents', 'brain', 'learn', 'neural', 'graph', 'worlds', 'missions', 'ai', 'automations', 'knowledge', 'planner', 'wealth', 'home', 'devices', 'console', 'database', 'privacy', 'preferences'];

const s = await createApp({ router: new ModelRouter(), home: new DemoHomeAdapter(), fetch: async () => { throw new Error('offline'); } });
const { WorldRunner } = await import('../../server/worlds/runner.js');
const fsx = await import('node:fs'); const osx = await import('node:os'); const pathx = await import('node:path');
const worldsDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'e2e-worlds-'));
s.worldRunner = new WorldRunner({ root: worldsDir });
const srv = createServer(s, 'e2e', { rateLimit: 100000 });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch();
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e.message}`); } };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);

  await check('login gate, then Hebrew RTL by default', async () => {
    await page.fill('#tokenInput', 'e2e'); await page.click('#loginForm button');
    await page.waitForSelector('#view .core-wrap');
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
    assert.equal(await page.getAttribute('html', 'lang'), 'he');
    assert.match(await page.textContent('#viewTitle'), /מרכז פיקוד/);
  });

  for (const v of VIEWS) {
    await check(`screen ${v} renders without errors`, async () => {
      errors.length = 0;
      await page.goto(`${url}#${v}`); await page.waitForTimeout(450);
      assert.ok(!(await page.$('#view .panel.err')), 'error panel shown');
      assert.ok((await page.$$('#view .panel, #view .glass')).length > 0, 'no panels');
      assert.deepEqual(errors, []);
    });
  }

  await check('every visible button has an accessible name', async () => {
    for (const v of VIEWS) {
      await page.goto(`${url}#${v}`); await page.waitForTimeout(300);
      const unnamed = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && !(b.textContent.trim() || b.getAttribute('aria-label') || b.title)).map((b) => b.outerHTML.slice(0, 80)));
      assert.deepEqual(unnamed, [], `${v}: ${unnamed.join(' | ')}`);
    }
  });

  await check('Hebrew command gets a Hebrew answer; approval flow from the chat', async () => {
    await page.goto(`${url}#conversation`); await page.waitForTimeout(300);
    await page.fill('.composer input[dir=auto]', 'תארגן לי את היום'); await page.press('.composer input[dir=auto]', 'Enter');
    await page.waitForFunction(() => /תדריך ליום/.test(document.querySelector('.chat').textContent));
    await page.fill('.composer input[dir=auto]', 'פתח את הדלת'); await page.press('.composer input[dir=auto]', 'Enter');
    await page.waitForSelector('.chat [data-approve]');
    assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'locked', 'nothing happens before approval');
    await page.click('.chat [data-approve]');
    await page.click('.dlg-yes'); // in-page confirmation, showing what will happen
    await page.waitForFunction(() => !document.querySelector('.chat [data-approve]'));
    await page.waitForTimeout(200);
    assert.equal((await s.home.devices()).find((d) => d.id === 'lock.front_door').state, 'unlocked');
  });

  await check('English switches the layout to LTR', async () => {
    await page.click('#langBtn');
    assert.equal(await page.getAttribute('html', 'dir'), 'ltr');
    assert.match(await page.textContent('#viewTitle'), /Conversation/);
    await page.click('#langBtn');
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  });

  await check('phone width: no horizontal scroll on any screen', async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(url); await m.fill('#tokenInput', 'e2e'); await m.click('#loginForm button'); await m.waitForSelector('#view .core-wrap');
    for (const v of VIEWS) {
      await m.goto(`${url}#${v}`); await m.waitForTimeout(350);
      const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(over <= 1, `${v} overflows by ${over}px`);
    }
  });
  await check('Digital Worlds: create from a builder preset → real pipeline → verified → deploy → live app → kill switch', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${url}#worlds`); await page.waitForSelector('[data-wt=create]');
    await page.click('[data-wt=create]'); await page.waitForSelector('#wF');
    await page.click('[data-pre="2"]'); await page.click('#wF button.primary');
    await page.waitForSelector('[data-wtab=pipeline]', { timeout: 15000 });
    await page.waitForFunction(() => /\bverified\b/.test(document.querySelector('#view h2 .tag')?.textContent ?? '') || /VERIFIED/.test(document.querySelector('.pipeline')?.textContent ?? '') && !/PLANNED.*PLANNED.*PLANNED.*PLANNED.*PLANNED.*PLANNED/.test(document.querySelector('.pipeline')?.textContent ?? ''), null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('.pstage.ok').length >= 5, null, { timeout: 60000 });
    await page.click('[data-wtab=tests]'); await page.waitForSelector('#bT');
    assert.match(await page.textContent('#wtBody'), /✓/);
    await page.click('[data-wtab=code]'); await page.click('[data-file="schema.json"]'); await page.waitForFunction(() => /entities/.test(document.querySelector('#fBody')?.textContent ?? ''));
    await page.click('[data-wtab=deploy]'); await page.click('[data-dep="local-preview"]');
    await page.waitForSelector('#dStop', { timeout: 20000 });
    const appUrl = await page.getAttribute('#wtBody a.btn.ok', 'href');
    const live = await fetch(appUrl); assert.equal(live.status, 200);
    if (process.env.SHOTW) await page.screenshot({ path: process.env.SHOTW, fullPage: true });
    await page.click('[data-dep="cloud"]'); await page.waitForTimeout(400);
    assert.match(await page.textContent('#wtBody'), /BLOCKED/);
    await page.click('[data-wt=security]'); await page.click('[data-kill]'); await page.click('.dlg-yes'); await page.waitForSelector('[data-rel]');
    assert.equal(s.worldRunner.preview(s.store.all('worlds')[0].id), null);
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });
} finally { await browser.close(); srv.close(); s.worldRunner.stopAll(); fsx.rmSync(worldsDir, { recursive: true, force: true }); }
console.log(failures ? `\n${failures} failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
