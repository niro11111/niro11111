// Accessibility audit with axe-core (WCAG rules) on every chapter, in light and dark mode. Fails on any violation.
// Reduced motion keeps the chapter fade-in from being measured as low contrast.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js', {paths: [path.resolve(__dirname, '..')]}), 'utf8');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const all = {};
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({viewport: {width: 1300, height: 900}, colorScheme: scheme, reducedMotion: 'reduce'});
    const p = await c.newPage(); await p.route(/^https:/, r => r.abort());
    await p.goto(U); await p.waitForTimeout(500);
    await p.addScriptTag({content: AXE});
    const ids = await p.$$eval('.mod', x => x.map(m => m.id));
    for (const id of ids) {
      await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(250);
      const res = await p.evaluate(async () => {
        const r = await axe.run(document, {resultTypes: ['violations'], rules: {region: {enabled: false}}});
        return r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 2).map(n => n.target.join(' '))}));
      });
      res.forEach(v => { const k = v.id + ' [' + v.impact + ']'; all[k] = all[k] || {n: 0, ex: []}; all[k].n += v.n; if (all[k].ex.length < 3) all[k].ex.push(...v.ex.map(e => scheme + ':' + id + ' ' + e)); });
    }
    await c.close();
  }
  const keys = Object.keys(all);
  console.log((keys.length ? 'FAIL ' : 'PASS ') + 'axe-core: ' + (keys.length ? keys.map(k => k + ' x' + all[k].n + ' (' + all[k].ex.join(', ') + ')').join(' | ') : 'no WCAG violations in any chapter, light and dark'));
  await b.close();
  process.exit(keys.length ? 1 : 0);
})();
