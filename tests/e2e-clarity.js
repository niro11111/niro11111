// Clarity for new users: the "how it works" card (hide, bring back, start, placement), quizzes that say what to do
// and lead to the next chapter, every tool button and counter explained, and jump targets not hidden on phones.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(500);
  ok(await p.isVisible('#howto') && await p.$$eval('#howto .howtoSteps li', x => x.length) === 4, 'first visit: the 4-step "how it works" card is on the home page');
  ok(await p.evaluate(() => { const h = [...document.querySelectorAll('#intro h1, #intro h2')]; return h[0].tagName === 'H1' && h.some(x => x.id === 'howtoH'); }), 'it comes after the page title (heading order kept)');
  await p.click('#howto [data-go="install"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => location.hash === '#install'), '"start" goes to the install chapter');
  await p.goto(U + '#intro'); await p.waitForTimeout(300);
  await p.click('#howtoPlace'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => location.hash === '#dashboard' && document.getElementById('dbPlace').getBoundingClientRect().top < innerHeight), '"not sure" opens the placement test');
  await p.goto(U + '#intro'); await p.waitForTimeout(300);
  await p.click('#howtoX');
  ok(await p.isHidden('#howto'), 'it can be hidden');
  await p.reload(); await p.waitForTimeout(400);
  ok(await p.isHidden('#howto'), 'and stays hidden after reload');
  await p.click('#lookBtn'); await p.click('#lookX');
  await p.evaluate(() => { location.hash = 'mcp'; }); await p.waitForTimeout(150);
  await p.click('#howBtn'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => location.hash === '#intro' && !document.getElementById('howto').hidden && document.activeElement.id === 'howtoH'), '❓ brings it back from any chapter and focuses its heading');

  // quizzes
  const qz = await p.evaluate(() => { const q = [...document.querySelectorAll('.quiz')].filter(x => x.querySelector('.q')); return {n: q.length, h: q.every(x => x.querySelector('h2').textContent === 'בוחן סיום הפרק'), how: q.every(x => x.querySelector('.quizHow'))}; });
  ok(qz.n >= 50 && qz.h && qz.how, qz.n + ' quizzes have a clear title and say what to do');
  await p.evaluate(() => { location.hash = 'mcp'; }); await p.waitForTimeout(150);
  await p.evaluate(() => { const qz = document.querySelector('#mcp .quiz'); const Q = window.__Q.mcp; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); });
  await p.waitForTimeout(100);
  const nx = await p.evaluate(() => { const b = document.querySelector('#mcp .quiz .res [data-go]'); return b && [b.dataset.go, b.textContent]; });
  const ids = await p.$$eval('.mod', m => m.map(x => x.id));
  ok(nx && nx[0] === ids[ids.indexOf('mcp') + 1], 'finishing a quiz offers the next chapter: ' + (nx && nx[1]));
  await p.click('#mcp .quiz .res [data-go]'); await p.waitForTimeout(150);
  ok(await p.evaluate(n => location.hash === '#' + n, nx[0]), 'and the button goes there');
  // wrong answers: no next button yet
  await p.evaluate(() => { location.hash = 'skills'; }); await p.waitForTimeout(150);
  await p.evaluate(() => { const qz = document.querySelector('#skills .quiz'); const Q = window.__Q.skills; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[(Q[+q.dataset.i][2] + 1) % 4].click()); });
  await p.waitForTimeout(100);
  ok(!(await p.$('#skills .quiz .res [data-go]')), 'no "next chapter" button while answers are wrong');

  // labels
  const tips = await p.evaluate(() => ({tools: [...document.querySelectorAll('.rail-tools button')].filter(b => !b.title).map(b => b.textContent), stats: [...document.querySelector('.stats').children].every(d => d.title)}));
  ok(tips.tools.length === 0, 'every tool button explains itself ' + JSON.stringify(tips.tools));
  ok(tips.stats && await p.$$eval('.statsWhat li', x => x.length) === 4, 'XP, rank and streak are explained');

  // phone: a jump does not hide the heading under the top bar
  const m = await b.newPage({viewport: {width: 390, height: 800}}); await m.route(/^https:/, r => r.abort());
  await m.goto(U + '#israel'); await m.waitForTimeout(500);
  await m.click('#israel nav.onpage summary'); await m.click('#israel nav.onpage li:nth-child(4) [data-jump]'); await m.waitForTimeout(1500);
  ok(await m.evaluate(() => { const h = document.activeElement; return h.tagName === 'H2' && h.getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom - 1; }), 'phone: a jumped-to heading is not hidden under the top bar');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
