// WCAG contrast check for every theme, in light and dark system mode. Fails on any pair below 4.5:1.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const THEMES = ['default', 'midnight', 'ocean', 'paper', 'solar', 'contrast', 'retro'];
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({colorScheme: scheme}); const p = await c.newPage();
    await p.route(/^https:/, r => r.abort()); await p.goto(U); await p.waitForTimeout(400);
    for (const th of THEMES) {
      const r = await p.evaluate(th => {
        const h = document.documentElement;
        ['theme-midnight', 'theme-ocean', 'theme-paper', 'theme-solar', 'theme-contrast', 'retro'].forEach(x => h.classList.remove(x));
        if (th === 'retro') h.classList.add('retro'); else if (th !== 'default') h.classList.add('theme-' + th);
        const cs = getComputedStyle(h), g = n => cs.getPropertyValue(n).trim();
        const rgb = col => { const d = document.createElement('div'); d.style.color = col; document.body.appendChild(d); const v = getComputedStyle(d).color.match(/\d+/g).map(Number); d.remove(); return v; };
        const L = col => { const [x, y, z] = rgb(col).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * x + .7152 * y + .0722 * z; };
        const cr = (a, bb) => { const x = L(a), y = L(bb); return +((Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(2); };
        return {text: cr(g('--ink'), g('--bg')), muted: cr(g('--muted'), g('--bg')), mutedOnCard: cr(g('--muted'), g('--surface')), accent: cr(g('--accent'), g('--bg')), button: cr(g('--accent-ink'), g('--accent')), warning: cr(g('--amber'), g('--surface')), error: cr(g('--red'), g('--surface')), code: cr(g('--term-ink'), g('--term-bg')), codeDim: cr(g('--term-dim'), g('--term-bg'))};
      }, th);
      const low = Object.entries(r).filter(([, v]) => v < 4.5);
      bad += low.length;
      console.log((low.length ? 'FAIL ' : 'PASS ') + scheme.padEnd(5) + ' ' + th.padEnd(9) + (low.length ? low.map(([k, v]) => k + '=' + v).join(' ') : 'all pairs ≥ 4.5:1'));
    }
    await c.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
