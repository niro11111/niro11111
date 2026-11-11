// The Make.com section: its own group in the table of contents, and every chapter's tools.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(400);
  const go = async id => { await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(150); };
  const pre = id => p.$eval(id + ' pre', e => e.textContent);

  // its own group in the table of contents, all six chapters together
  const toc = await p.$$eval('#toc li', li => li.map(x => x.classList.contains('grp') ? '#' + x.textContent.trim() : (x.querySelector('button') || {}).dataset.go));
  const at = toc.indexOf('#Make.com');
  ok(at > 0 && toc.filter(x => x === '#Make.com').length === 1, 'Make.com is its own group in the chapter list');
  const group = toc.slice(at + 1, at + 7);
  ok(JSON.stringify(group) === JSON.stringify(['make', 'makecore', 'makefx', 'makeai', 'makesecrets', 'makelab']), 'all six Make chapters are in the group: ' + group.join(','));
  ok(toc[at + 7] && toc[at + 7].startsWith('#'), 'the next group starts right after');

  // makecore
  await go('makecore');
  ok(await p.$$eval('#mcSteps details', x => x.length) === 12, '12 build steps');
  ok(await p.$$eval('#mcSettings tr', x => x.length) === 5 && await p.$$eval('#mcKeys tr', x => x.length) >= 10, 'settings and shortcuts tables');
  for (const c of await p.$$('#mcCheck input')) await c.check();
  ok(/מוכן להפעלה/.test(await p.$eval('#mcCheckN', e => e.textContent)), 'pre-launch checklist completes');
  ok(Object.keys(JSON.parse(await p.evaluate(() => localStorage.getItem('cca-mkChk')))).length === 10, 'checklist is saved (synced key)');

  // makefx
  await go('makefx');
  const tasks = await p.$$eval('#fxTask option', o => o.map(x => x.value));
  for (const t of tasks) { await p.selectOption('#fxTask', t); const f = await pre('#fxOut'); const open = (f.match(/\(/g) || []).length, close = (f.match(/\)/g) || []).length; ok(f.length > 8 && open === close && !/undefined/.test(f), 'formula ' + t + ': ' + f); }
  await p.selectOption('#fxTask', '3'); ok(/join\(map\(Items; name\); , \)/.test(await pre('#fxOut')), 'separator keeps its space');
  await p.selectOption('#fxTask', '2'); await p.fill('#fxInputs [data-k="k"]', 'size');
  ok(/first\(map\(Meta data; value; key; size\)\)/.test(await pre('#fxOut')), 'formula follows the inputs');
  await p.fill('#fxQ', 'formatDate'); ok(await p.$$eval('#fxRows tr', x => x.length) === 1, 'function search');
  await p.fill('#fxQ', ''); for (const c of await p.$$('#fxCats button')) await c.click();
  ok(await p.$$eval('#fxRows tr', x => x.length) >= 3, 'category filter');
  ok(await p.$$eval('#fxVars .trick', x => x.length) === 4 && await p.$$eval('#fxMore .trick', x => x.length) === 6, 'variables and advanced cards');

  // makeai
  await go('makeai');
  ok(await p.$$eval('#aiCards details', x => x.length) === 5, '5 AI tools explained');
  ok(await p.$$eval('#aiCost tr', x => x.length) === 4 && await p.$$eval('#aiPick tr', x => x.length) === 6, 'cost and decision tables');

  // makesecrets
  await go('makesecrets');
  const n = await p.$$eval('#msList .trick', x => x.length);
  ok(n >= 25, n + ' secrets');
  for (let i = 0; i < n; i++) await p.check(`[data-mks="${i}"]`);   // the list re-renders after each check
  ok(new RegExp(n + '/' + n).test(await p.$eval('#msCount', e => e.textContent)), 'mark every secret as learned');
  await p.fill('#msQ', 'DevTool'); ok(await p.$$eval('#msList .trick', x => x.length) >= 2, 'search secrets');
  await p.fill('#msQ', '');

  // makelab
  await go('makelab');
  const kpi = async () => p.$$eval('#mlKpis b', x => x.map(e => e.textContent));
  await p.fill('#mlRuns', '40'); await p.fill('#mlMods', '5');
  ok((await kpi())[0] === '5' && (await kpi())[1].replace(/\D/g, '') === '6000', 'credits: 5 per run, 6000 a month');
  await p.check('#mlIter'); await p.fill('#mlItems', '10'); await p.fill('#mlIterMods', '2');
  ok((await kpi())[0] === '23', 'iterator adds 2 x 9 extra items: 23 per run');
  await p.fill('#mlRuns', '2000');
  ok(/Warnings/.test(await pre('#mlPlanOut')) && /% of the plan/.test(await pre('#mlPlanOut')), 'over-budget warning');
  await p.selectOption('#mlTrigger', 'mcp');
  ok(/Return output/.test(await pre('#mlPlanOut')), 'MCP trigger adds Return output and a description');
  await p.selectOption('#mlAi', 'simple');
  ok(/Simple Text Prompt/.test(await pre('#mlMaia')) && /Resume on the AI step/.test(await pre('#mlClaude')), 'AI step and its error handler go into both prompts');
  await p.check('#mlResp'); ok(/Webhook response as the LAST module/.test(await pre('#mlPlanOut')), 'waiting sender: webhook response last');
  await p.fill('#mlName', 'בדיקה 1'); await p.click('#mlSave');
  ok(await p.$$eval('#mlLib li button', x => x.length) === 2, 'plan saved to the library');
  await p.fill('#mlName', 'other'); await p.click('[data-mll="0"]');
  ok(await p.inputValue('#mlName') === 'בדיקה 1', 'plan loads back');
  const [d] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#mlDl')]);
  ok(d && d.suggestedFilename() === 'scenario-plan.md', 'plan downloads');
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.makelab), 'lab chapter completes');
  // quizzes complete the other chapters
  for (const id of ['make', 'makecore', 'makefx', 'makeai', 'makesecrets']) {
    await go(id);
    await p.evaluate(id => { const qz = document.querySelector('#' + id + ' .quiz'); const Q = window.__Q[id]; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); }, id);
  }
  ok(await p.evaluate(() => ['make', 'makecore', 'makefx', 'makeai', 'makesecrets', 'makelab'].every(id => JSON.parse(localStorage.getItem('cca-state')).done[id])), 'whole Make section completes');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
