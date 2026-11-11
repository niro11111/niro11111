// Monkey test: thousands of random actions (navigate, click, type, keys, toggles) with a fixed seed so any
// failure can be replayed. Fails on any page error, any element with [hidden] showing, or a broken chapter list.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const SEED = +(process.argv[2] || 20261111), STEPS = +(process.argv[3] || 1500);
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  let s = SEED; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.dismiss().catch(() => {}));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(500);
  await p.evaluate(() => { HTMLAnchorElement.prototype.click = function(){}; if (navigator.clipboard) navigator.clipboard.writeText = async () => {}; window.open = () => null; });
  const ids = await p.$$eval('.mod', x => x.map(m => m.id));
  const TEXT = ['', 'a', 'שלום', '0', '-1', '99999999999', '{"a":1}', '[1,2', 'ctrl+k ctrl+s', '/compact', 'claude --help', '<b>x</b>', ' '.repeat(50), 'x'.repeat(3000), '😀🚀', 'null', 'NaN'];
  const log = [];
  for (let i = 0; i < STEPS; i++) {
    const r = rnd(), act = r < 0.12 ? 'nav' : r < 0.6 ? 'click' : r < 0.82 ? 'type' : r < 0.92 ? 'select' : 'key';
    try {
      if (act === 'nav') { const id = pick(ids); log.push('nav ' + id); await p.evaluate(id => { location.hash = id; }, id); continue; }
      const info = await p.evaluate(({act, k, t, kk}) => {
        const scope = [...document.querySelectorAll('.pal:not([hidden])')].pop() || document.querySelector('.mod.on');
        const vis = el => el.offsetParent !== null && !el.disabled;
        if (act === 'click') { const xs = [...scope.querySelectorAll('button, summary, label, [role=button], input[type=checkbox], input[type=radio]')].filter(vis).filter(x => !/איפוס|reset/i.test(x.textContent + x.id)); if (!xs.length) return 'none'; const x = xs[Math.floor(k * xs.length)]; x.click(); return 'click ' + (x.id || x.textContent.trim().slice(0, 20)); }
        if (act === 'type') { const xs = [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')].filter(vis); if (!xs.length) return 'none'; const x = xs[Math.floor(k * xs.length)]; x.value = x.type === 'number' ? String(Math.floor(k * 1e6) - 500) : t; x.dispatchEvent(new Event('input', {bubbles: true})); x.dispatchEvent(new Event('change', {bubbles: true})); return 'type ' + (x.id || x.name); }
        if (act === 'select') { const xs = [...scope.querySelectorAll('select')].filter(vis); if (!xs.length) return 'none'; const x = xs[Math.floor(k * xs.length)]; x.selectedIndex = Math.floor(k * x.options.length); x.dispatchEvent(new Event('change', {bubbles: true})); return 'select ' + x.id; }
        return 'key';
      }, {act, k: rnd(), t: pick(TEXT), kk: 0});
      if (act === 'key') { const key = pick(['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', '?', 'Control+k']); await p.keyboard.press(key); log.push('key ' + key); }
      else log.push(info);
    } catch (e) { log.push('error ' + e.message.slice(0, 80)); }
    if (errs.length) break;
  }
  await p.waitForTimeout(300);
  ok(errs.length === 0, STEPS + ' random actions (seed ' + SEED + ') without page errors' + (errs.length ? ': ' + errs[0] + ' | last actions: ' + log.slice(-6).join(' → ') : ''));
  const shown = await p.evaluate(() => [...document.querySelectorAll('[hidden]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0; }).length);
  ok(shown === 0, 'no [hidden] element visible after the run');
  ok(await p.$$eval('#toc button', x => x.length) === ids.length, 'chapter list intact');
  await b.close();
})();
