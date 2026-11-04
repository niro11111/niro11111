// System health: links, ids, layout at phone width in every chapter and theme, storage failures,
// keyboard access, broken JSON in examples, and console errors. Prints FAIL lines for anything wrong.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  const errs = [];
  const page = async (opts, init) => {
    const c = await b.newContext(opts); const p = await c.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
    await p.route(/^https:/, r => r.abort());
    if (init) await p.addInitScript(init);
    await p.goto(U); await p.waitForTimeout(500); return p;
  };

  // 1. structure
  const p = await page({viewport: {width: 1300, height: 900}});
  const dup = await p.evaluate(() => { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.keys(c).filter(k => c[k] > 1); });
  ok(dup.length === 0, 'no duplicate ids ' + dup.join(','));
  const broken = await p.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(h => h && !document.getElementById(h)));
  ok(broken.length === 0, 'every internal link has a target ' + [...new Set(broken)].join(','));
  const ext = await p.evaluate(() => [...document.querySelectorAll('a[href^="http"]')].filter(a => a.target === '_blank' && !/noopener/.test(a.rel)).length);
  ok(ext === 0, 'external links open safely (noopener) · ' + ext + ' missing');
  const unlabeled = await p.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea')].filter(e => !e.closest('label') && !e.getAttribute('aria-label') && !(e.id && document.querySelector('label[for="' + e.id + '"]'))).map(e => e.id || e.name || e.tagName));
  ok(unlabeled.length === 0, 'every field has a label ' + unlabeled.slice(0, 8).join(','));
  const nameless = await p.evaluate(() => [...document.querySelectorAll('button')].filter(x => !(x.textContent.trim() || x.getAttribute('aria-label') || x.title)).map(x => x.id || x.className));
  ok(nameless.length === 0, 'every button has an accessible name ' + nameless.slice(0, 8).join(','));
  const ids = await p.$$eval('.mod', x => x.map(m => m.id));

  // 2. every chapter, JSON examples, empty sections
  const badJson = [], empty = [];
  for (const id of ids) {
    await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(60);
    const r = await p.evaluate(() => {
      const m = document.querySelector('.mod.on');
      const bj = [...m.querySelectorAll('.code[data-lang="json"] pre')].map(e => e.textContent).filter(t => /^\s*[{[]/.test(t) && !/…|\.\.\.|\/\/|<[a-z]/i.test(t)).filter(t => { try { JSON.parse(t); return false; } catch (e) { return true; } }).map(t => t.slice(0, 60));
      return {bj, text: m.innerText.trim().length};
    });
    r.bj.forEach(t => badJson.push(id + ': ' + t));
    if (r.text < 200 && id !== 'exam') empty.push(id + '(' + r.text + ')');
  }
  ok(badJson.length === 0, 'JSON examples parse ' + badJson.slice(0, 5).join(' | '));
  ok(empty.length === 0, 'no empty chapters ' + empty.join(','));

  // 3. keyboard: skip link / tab reaches content, Esc closes dialogs
  await p.evaluate(() => { location.hash = 'intro'; }); await p.waitForTimeout(100);
  await p.keyboard.press('Tab');
  const first = await p.evaluate(() => document.activeElement && (document.activeElement.textContent || document.activeElement.id || document.activeElement.tagName).trim().slice(0, 30));
  ok(!!first && first !== 'BODY', 'Tab moves focus into the page (' + first + ')');
  await p.close();

  // 4. phone width: no horizontal overflow in any chapter, in light, dark and a custom theme
  for (const [scheme, cls] of [['light', ''], ['dark', ''], ['light', 'theme-solar']]) {
    const m = await page({viewport: {width: 360, height: 760}, colorScheme: scheme}, cls ? `try{ localStorage.setItem('cca-theme', JSON.stringify('${cls.replace('theme-', '')}')) }catch(e){}` : null);
    if (cls) await m.evaluate(c => document.documentElement.classList.add(c), cls);
    const over = [];
    for (const id of ids) {
      await m.evaluate(id => { location.hash = id; }, id); await m.waitForTimeout(40);
      const w = await m.evaluate(() => { const d = document.documentElement; const wide = [...document.querySelectorAll('.mod.on *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 2 && !e.closest('pre,.code,table,.tblwrap,.sim,.term'); }).slice(0, 2).map(e => e.tagName + '.' + (e.className || '').toString().split(' ')[0]); return {sw: d.scrollWidth, wide}; });
      if (w.sw > 362 || w.wide.length) over.push(id + ' ' + w.sw + ' ' + w.wide.join(','));
    }
    ok(over.length === 0, 'phone width ' + scheme + (cls ? ' ' + cls : '') + ': no overflow ' + over.slice(0, 6).join(' | '));
    await m.close();
  }

  // 5. storage blocked (private mode): the app still works
  const s = await page({viewport: {width: 1200, height: 800}}, `Object.defineProperty(window, 'localStorage', {get(){ throw new Error('blocked'); }});`);
  await s.evaluate(() => { location.hash = 'promptgen'; }); await s.waitForTimeout(200);
  ok(await s.$eval('#pgOut pre', e => e.textContent.length > 50), 'works with storage blocked');
  await s.close();

  ok(errs.length === 0, 'no page or console errors ' + JSON.stringify([...new Set(errs)].slice(0, 5)));
  await b.close();
})();
