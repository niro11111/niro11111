// XSS fuzz: types attack payloads into every text field of every chapter, fires input/change, clicks the chapter's
// buttons, and fails if any payload ran (window flag or dialog) or became a real element in the page.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const PAYLOADS = [
  '"><img src=x onerror="window.__xss=(window.__xss||0)+1">',
  "'><svg onload=\"window.__xss=(window.__xss||0)+1\"></svg>",
  '</textarea></pre><script>window.__xss=(window.__xss||0)+1</script>',
  'javascript:window.__xss=1',
  '{{constructor.constructor("window.__xss=1")()}} ${7*7} <b data-x=1>bold</b>'
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}});
  const errs = [], dialogs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(500);
  await p.evaluate(() => { window.__downloads = 0; HTMLAnchorElement.prototype.click = function(){ window.__downloads++; }; navigator.clipboard && (navigator.clipboard.writeText = async () => {}); });
  const ids = await p.$$eval('.mod', x => x.map(m => m.id));
  const found = [];
  for (const id of ids) {
    if (id === 'speedrun' || id === 'exam') continue;   // timers and the exam flow are covered elsewhere
    await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(80);
    for (let k = 0; k < PAYLOADS.length; k++) {
      await p.evaluate(pl => {
        const m = document.querySelector('.mod.on');
        m.querySelectorAll('input[type=text], input[type=url], input[type=email], input[type=search], input:not([type]), textarea').forEach(el => {
          if (el.disabled || el.readOnly) return;
          el.value = pl; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
        });
      }, PAYLOADS[k]);
      // press the chapter's own buttons (not navigation, reset or account dangers)
      await p.evaluate(() => {
        const m = document.querySelector('.mod.on');
        [...m.querySelectorAll('button')].filter(x => !x.disabled && x.offsetParent && !/איפוס|reset|מחיקה|delete/i.test(x.textContent + x.id)).slice(0, 25).forEach(x => { try { x.click(); } catch (e) {} });
      });
      await p.waitForTimeout(60);
      const r = await p.evaluate(() => {
        const bad = [...document.querySelectorAll('img[src="x"], svg[onload], script:not([src])')].filter(e => !(e.tagName === 'SCRIPT' && e.textContent.length > 10000)).length;
        const bold = [...document.querySelectorAll('b[data-x]')].length;
        return {flag: window.__xss || 0, bad, bold};
      });
      if (r.flag || r.bad || r.bold) { found.push(id + ' payload#' + k + ' ' + JSON.stringify(r)); await p.evaluate(() => { window.__xss = 0; document.querySelectorAll('img[src="x"], svg[onload], b[data-x]').forEach(e => e.remove()); }); }
    }
  }
  ok(found.length === 0, 'no payload executed or became markup in ' + ids.length + ' chapters ' + found.slice(0, 8).join(' | '));
  ok(dialogs.length === 0, 'no dialogs ' + JSON.stringify(dialogs.slice(0, 3)));
  const real = errs;
  ok(real.length === 0, 'no page errors from hostile input ' + JSON.stringify([...new Set(real)].slice(0, 5)));
  await b.close();
})();
