// Search across all knowledge, the printable cheat sheet (print media checked), and the Make flashcards.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(500);

  // search
  const search = async q => { if (await p.isHidden('#pal')) await p.keyboard.press('Control+k'); await p.fill('#palIn', q); await p.waitForTimeout(60); return p.$$eval('#palList li', x => x.map(l => l.textContent)); };
  let r = await search('הפורט תפוס');
  ok(r.some(x => /שגיאה/.test(x) && /הפורט תפוס/.test(x)), 'search finds an error: ' + r[0]);
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => location.hash === '#errdoc' && [...document.querySelectorAll('#edCats button.on')].some(b => b.textContent === 'פיתוח')), 'error result opens the decoder on its category');
  r = await search('Playwright MCP');
  ok(r.some(x => /חבילה/.test(x)), 'search finds a package');
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => location.hash === '#ecosystem' && document.querySelector('#ecQ').value === 'Playwright MCP' && document.querySelectorAll('#ecList .ecCard').length === 1), 'package result filters the catalog to it');
  r = await search('formatDate');
  ok(r.some(x => /פונקציית Make/.test(x)), 'search finds a Make function');
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => location.hash === '#makefx' && document.querySelectorAll('#fxRows tr').length >= 1 && /formatDate/.test(document.querySelector('#fxRows').textContent)), 'function result filters the reference');
  r = await search('DevTool');
  ok(r.some(x => /סוד Make/.test(x)), 'search finds a Make secret');
  await p.keyboard.press('Escape');

  // cheat sheet
  await p.evaluate(() => { location.hash = 'cheatsheet'; }); await p.waitForTimeout(200);
  const count = async () => +(await p.$eval('#csCount', e => e.textContent)).match(/\d+/)[0];
  const base = await count();
  ok(base > 60 && await p.$$eval('#csSheet .csSec', x => x.length) === 3, 'default sheet: 3 topics, ' + base + ' items');
  for (const v of ['errors', 'makefx', 'makesec', 'hooks']) await p.check(`#csTopics input[value="${v}"]`);
  ok(await count() > base + 60 && await p.$$eval('#csSheet .csSec', x => x.length) === 7, 'adding topics grows the sheet (' + await count() + ')');
  await p.uncheck('#csDesc'); ok(await p.$$eval('#csSheet dd', x => x.length) === 0, 'without descriptions');
  await p.check('#csDesc');
  await p.selectOption('#csCols', '3'); ok(/column-count:\s*3/.test(await p.$eval('#csSheet .csBody', e => e.getAttribute('style'))), '3 columns');
  await p.check('#csOnlyMine'); await p.check('#csTopics input[value="tricks"]');
  ok(!(await p.$$eval('#csSheet h2', x => x.map(h => h.textContent))).includes('טריקים'), 'only-mine hides tricks you have not learned');
  await p.uncheck('#csOnlyMine');
  ok((await p.$$eval('#csSheet h2', x => x.map(h => h.textContent))).includes('טריקים'), 'and shows them again');
  ok(!/<script|undefined/.test(await p.$eval('#csSheet', e => e.innerHTML)), 'sheet has no scripts or undefined values');
  const [d] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#csDl')]);
  let fileOk = false;
  if (d) { const f = await d.path(); const html = require('fs').readFileSync(f, 'utf8'); fileOk = /^<!DOCTYPE html><html lang="he" dir="rtl">/.test(html) && /<style>/.test(html) && !/<script/i.test(html) && /formatDate/.test(html); }
  ok(d && d.suggestedFilename() === 'claude-code-cheatsheet.html' && fileOk, 'standalone HTML download (RTL, styled, no scripts)');
  // what actually prints
  await p.evaluate(() => { window.print = () => {}; document.body.classList.add('printing-cheat'); });
  await p.emulateMedia({media: 'print'});
  const vis = await p.evaluate(() => ({sheet: document.querySelector('#csSheet').getBoundingClientRect().height > 100, form: document.querySelector('#csForm').getBoundingClientRect().height, toc: document.querySelector('#toc').getBoundingClientRect().height, title: document.querySelector('#cheatsheet h1').getBoundingClientRect().height}));
  ok(vis.sheet && vis.form === 0 && vis.toc === 0 && vis.title === 0, 'print shows only the sheet ' + JSON.stringify(vis));
  await p.emulateMedia({media: 'screen'}); await p.evaluate(() => document.body.classList.remove('printing-cheat'));
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('cca-csSel')).includes('makefx')), 'topic choice is saved (synced key)');
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.cheatsheet), 'chapter completes');

  // flashcards
  await p.evaluate(() => { location.hash = 'cards'; }); await p.waitForTimeout(200);
  let sawMake = false;
  for (let i = 0; i < 400 && !sawMake; i++) { sawMake = await p.evaluate(() => /^Make:/.test(document.querySelector('#fcF').textContent)); if (!sawMake) await p.evaluate(() => { const b = [...document.querySelectorAll('#cards button')].find(x => /יודע|קל|הבא|לא/.test(x.textContent)); if (b) b.click(); }); }
  ok(sawMake, 'Make flashcards show up in the deck');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
