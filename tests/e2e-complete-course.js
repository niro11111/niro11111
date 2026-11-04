// Completes every chapter through its real completion path and checks 100%, the certificate,
// and that every simulator command answers.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  await p.goto(U); await p.waitForTimeout(600);
  const ids = await p.$$eval('.mod', x => x.map(m => m.id));
  const go = async id => { await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(120); };

  // 1. every chapter quiz, answered correctly from the quiz data
  for (const id of ids) {
    await go(id);
    await p.evaluate(() => {
      const quiz = document.querySelector('.mod.on .quiz'); if (!quiz) return;
      const Q = window.__Q[quiz.dataset.q];
      quiz.querySelectorAll('.q').forEach(q => { const x = Q[+q.dataset.i]; q.querySelectorAll('input')[x[2]].click(); });
    });
  }

  // 2. chapters finished by doing something
  await go('challenges');
  const sol = [
    '{"permissions":{"allow":["Bash(npm run test *)"],"deny":["Read(./.env)"]}}',
    '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"./guard.sh"}]}]}}',
    '---\nname: security-auditor\ndescription: Audits code changes for security issues\ntools: Read, Grep, Glob\n---\nYou are a security expert. Review the diff carefully.',
    '---\ndescription: fix an issue\n---\nFix issue $ARGUMENTS',
    'claude -p "fix" --output-format json --allowedTools "Read" --max-turns 5',
    '{"mcpServers":{"a":{"type":"http","url":"https://x"},"b":{"command":"npx","args":["y"]}}}'
  ];
  for (let i = 0; i < 6; i++) { await p.fill('#ch' + i, sol[i]); await p.click(`.ch[data-i="${i}"] [data-act]`); }
  await go('project'); for (let i = 0; i < 10; i++) await p.check(`[data-step="${i}"]`);
  await go('buildalong'); for (let i = 0; i < 10; i++) await p.check(`[data-ba="${i}"]`);
  await go('scenarios');
  for (let s = 1; s <= 3; s++) {
    await p.click(`#scTabs button:nth-child(${s})`);
    for (let k = 0; k < 4; k++) {
      const best = await p.evaluate(() => {
        const qb = document.querySelector('#scBody .q b'); if (!qb) return -1;
        const st = window.__SCEN.flatMap(x => x.steps).find(st => st.q === qb.textContent);
        let bi = 0; st.o.forEach((o, i) => { if (o[1] > st.o[bi][1]) bi = i; }); return bi;
      });
      if (best < 0) break;
      await (await p.$$('#scBody .q label'))[best].click();
    }
  }
  await go('speedrun'); await p.click('#srStart'); await p.waitForTimeout(61500);
  await go('checker'); await p.click('[data-sample="settings"]');
  await go('promptlab'); await p.click('[data-pl="2"]');
  await go('analyzer'); await p.click('#azDemo');
  await go('errdoc'); await p.click('[data-eds="0"]');
  await go('quizgen');
  for (let i = 0; i < 10; i++) { await p.evaluate(() => { const c = window.__qgCur; document.querySelector('#qgCard input[value="' + c.a + '"]').click(); }); await p.click('#qgNext'); }

  // 3. final exam with the right answers
  await go('exam'); await p.click('#examStart');
  await p.evaluate(() => {
    const all = Object.values(window.__Q).flat();
    document.querySelectorAll('#examBox .q').forEach(q => {
      const t = q.querySelector('b').textContent.replace(/^\d+\.\s/, '');
      const x = all.find(z => z[0] === t); q.querySelectorAll('input')[x[2]].click();
    });
  });
  await p.click('#examSubmit'); await p.waitForTimeout(300);
  ok(await p.$('#certBox .cert') !== null, 'certificate shown');
  const left = await p.evaluate(ids => { const d = JSON.parse(localStorage.getItem('cca-state')).done; return ids.filter(i => !d[i]); }, ids);
  ok(left.length === 0, 'all chapters done (' + (ids.length - left.length) + '/' + ids.length + ')' + (left.length ? ' missing: ' + left.join(',') : ''));
  ok((await p.$eval('#pLabel', e => e.textContent)).startsWith('100%'), 'progress label shows 100%');

  // 4. every simulator command answers
  await go('sim');
  const cmds = await p.evaluate(() => window.__simCommands);
  for (const c of cmds) { await p.fill('#simIn', c); await p.press('#simIn', 'Enter'); }
  const unknown = await p.$eval('#simOut', e => e.innerText.split('\n').filter(l => /Unknown command/.test(l)));
  ok(unknown.length === 0, 'all ' + cmds.length + ' slash commands answer' + (unknown.length ? ': ' + unknown.join(' | ') : ''));
  for (const c of ['claude --worktree feat', 'claude --effort high', 'claude auth status', 'claude --bg "x"', 'claude setup-token']) { await p.fill('#simIn', c); await p.press('#simIn', 'Enter'); }
  const tail = await p.$eval('#simOut', e => e.innerText.split('\n').slice(-6).join(' | '));
  ok(!/Sure\. Let me look/.test(tail), 'CLI flags and subcommands answer: ' + tail.slice(0, 160));
  await p.fill('#simIn', '/sta'); await p.press('#simIn', 'Tab');
  ok((await p.inputValue('#simIn')).length > 4, 'tab completion (' + await p.inputValue('#simIn') + ')');
  await p.fill('#simIn', ''); await p.press('#simIn', 'ArrowUp');
  ok((await p.inputValue('#simIn')) !== '', 'history with up arrow (' + await p.inputValue('#simIn') + ')');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
