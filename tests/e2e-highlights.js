// Highlights: select text → 🖍 → <mark>, saved and restored after reload, listed in the notebook,
// exported to Markdown, removable from the notebook or from the text; code and form fields can't be highlighted.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.route(/^https:/, r => r.abort());
  await p.goto(U + '#israel'); await p.waitForTimeout(500);
  // select a phrase inside the chapter lead
  const select = (sel, from, len) => p.evaluate(([sel, from, len]) => {
    const el = document.querySelector(sel); el.scrollIntoView({block: 'center'});
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const n = w.nextNode();
    const r = document.createRange(); r.setStart(n, from); r.setEnd(n, from + len);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true})); return s.toString();
  }, [sel, from, len]);
  const q = await select('#israel .lead', 0, 20);
  await p.waitForTimeout(120);
  ok(await p.isVisible('#hlBtn'), 'selecting text shows the 🖍 button (' + q + ')');
  await p.click('#hlBtn');
  const m1 = await p.evaluate(() => { const m = document.querySelectorAll('#israel mark.hl'); return {n: m.length, txt: [...m].map(x => x.textContent).join(''), saved: JSON.parse(localStorage.getItem('cca-hl') || '[]')}; });
  ok(m1.n >= 1 && m1.txt === q && m1.saved.length === 1 && m1.saved[0].ch === 'israel' && m1.saved[0].q === q, 'the exact text is marked and saved');
  ok(await p.evaluate(() => getSelection().isCollapsed) && !(await p.isVisible('#hlBtn')), 'selection clears and the button hides');
  // a second highlight in a list item
  const q2 = await select('#ilHebrew .trick p', 0, 15); await p.waitForTimeout(120); await p.click('#hlBtn');
  // code can't be highlighted
  await p.evaluate(() => { const pre = document.querySelector('#israel .code pre'); pre.scrollIntoView({block: 'center'}); const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true})); });
  await p.waitForTimeout(120);
  ok(!(await p.isVisible('#hlBtn')), 'code blocks are not highlightable');
  await p.evaluate(() => getSelection().removeAllRanges());
  // reload: restored
  await p.reload(); await p.waitForTimeout(500);
  const back = await p.evaluate(() => [...document.querySelectorAll('#israel mark.hl')].map(x => x.textContent).join('|'));
  ok(back.includes(q) && back.includes(q2), 'both highlights come back after reload');
  // they work with term buttons and in another chapter after navigation
  await p.evaluate(() => { location.hash = 'glossary'; }); await p.waitForTimeout(200);
  const nb = await p.$$eval('#hlAll li', x => x.map(l => l.textContent));
  ok(nb.length === 2 && nb.some(t => t.includes(q.trim())), 'the notebook lists both, by chapter');
  const [d] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#hlExport')]);
  let md = ''; if (d) { const f = await d.path(); md = require('fs').readFileSync(f, 'utf8'); }
  ok(d && d.suggestedFilename() === 'my-highlights.md' && /^# ההדגשות שלי/.test(md) && md.includes('> ' + q.trim().replace(/\s+/g, ' ')), 'export to Markdown');
  await p.click('#hlAll [data-hlx]');
  ok(await p.$$eval('#hlAll li', x => x.length) === 1 && JSON.parse(await p.evaluate(() => localStorage.getItem('cca-hl'))).length === 1, 'remove from the notebook');
  await p.evaluate(() => { location.hash = 'israel'; }); await p.waitForTimeout(200);
  const left = await p.$$eval('#israel mark.hl', x => x.length);
  await p.focus('#israel mark.hl'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok(left >= 1 && await p.$$eval('#israel mark.hl', x => x.length) === 0 && JSON.parse(await p.evaluate(() => localStorage.getItem('cca-hl'))).length === 0, 'keyboard Enter on a highlight removes it');
  ok(await p.evaluate(() => /עוד אין הדגשות/.test(document.getElementById('hlAll').textContent)), 'notebook shows the empty state');
  ok(await p.evaluate(() => [...document.querySelectorAll('#israel .lead, #ilHebrew p')].every(el => !el.querySelector('mark') && el.childNodes.length < 20)), 'unwrapping leaves the text clean');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
