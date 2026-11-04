// Error decoder, endless quiz (including AI-generated questions through a mock), and the GitHub ecosystem catalog.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  const go = async id => { await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(150); };
  await p.goto(U); await p.waitForTimeout(500);

  // error decoder
  await go('errdoc');
  const samples = await p.$$('#edSamples [data-eds]');
  for (let i = 0; i < samples.length; i++) {
    await p.click(`[data-eds="${i}"]`);
    const n = await p.$$eval('#edOut .edCard', x => x.length);
    ok(n >= 1, 'sample error ' + i + ' decoded (' + n + ' matches)');
  }
  const real = {
    'zsh: command not found: claude': 'claude: command not found',
    'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}': '529 / עומס',
    'Error: listen EADDRINUSE: address already in use :::3000': 'הפורט תפוס',
    'src/a.ts(3,7): error TS2322: Type string is not assignable': 'שגיאות TypeScript',
    'Error: self-signed certificate in certificate chain': 'תעודת SSL של proxy ארגוני',
    'Claude requested permissions to use Bash, but you have not granted it yet': 'הכלי לא אושר במצב -p'
  };
  for (const [t, title] of Object.entries(real)) {
    await p.fill('#edIn', t); await p.click('#edRun');
    const titles = await p.$$eval('#edOut .edCard h3', x => x.map(e => e.textContent));
    ok(titles.includes(title), 'decodes "' + t.slice(0, 40) + '" → ' + titles.join(', '));
  }
  await p.fill('#edIn', 'everything is fine'); await p.click('#edRun');
  ok(await p.$$eval('#edOut .edCard', x => x.length) === 0 && /לא מצאתי/.test(await p.$eval('#edOut', e => e.textContent)), 'unknown text gives a helpful no-match message');
  const cats = await p.$$('#edCats button'); let total = 0;
  for (const c of cats) { await c.click(); total += await p.$$eval('#edAll .edCard', x => x.length); }
  ok(total === await p.evaluate(() => window.__ERRS.length), 'every error is reachable by category (' + total + ')');
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.errdoc), 'error decoder chapter completes');

  // endless quiz
  await go('quizgen');
  const answer = async good => p.evaluate(good => { const c = window.__qgCur; const v = good ? c.a : (c.a + 1) % c.o.length; document.querySelector('#qgCard input[value="' + v + '"]').click(); }, good);
  for (let i = 0; i < 10; i++) { await answer(true); await p.click('#qgNext'); }
  ok(await p.$eval('#qgStreak', e => e.textContent) === '10', 'streak of 10');
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.quizgen), 'endless quiz chapter completes');
  await answer(false);
  ok(await p.$eval('#qgStreak', e => e.textContent) === '0' && await p.$eval('#qgBest', e => e.textContent) === '10', 'wrong answer resets streak, best kept');
  ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cca-mistakes') || '{}')).length) === 1, 'wrong answer goes to the mistake bank');
  await p.selectOption('#qgSrc', 'mistakes');
  await answer(true);
  ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cca-mistakes') || '{}')).length) === 0, 'fixing it in mistakes mode clears it');
  await p.click('#qgNext');
  ok(/אין טעויות/.test(await p.$eval('#qgCard', e => e.textContent)), 'empty mistakes mode explains itself');
  const lvls = await p.$$eval('#qgSrc option', o => o.map(x => x.value).filter(v => v.startsWith('lvl:')));
  for (const l of lvls) { await p.selectOption('#qgSrc', l); const lv = await p.evaluate(() => document.getElementById(window.__qgCur.id).dataset.level); if (lv !== l.slice(4)) ok(false, 'level filter ' + l); }
  ok(lvls.length >= 8, lvls.length + ' level filters give questions from their own level');
  // AI mode through a mock of the sample capability
  await p.evaluate(() => {
    const fake = async () => ({text: 'ok'}); fake.json = async () => [{q: 'Mock question?', o: ['a', 'b', 'c', 'd'], a: 2, why: 'because'}, {q: 'bad'}];
    window.tutorSample = fake; window.__qgShowAi();
  });
  await p.selectOption('#qgSrc', 'ai');
  ok(await p.isVisible('#qgGen'), 'AI mode shows the generate button');
  await p.click('#qgGen'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.__qgCur && window.__qgCur.q === 'Mock question?'), 'AI questions are validated and shown (bad item dropped)');
  await answer(true);
  ok(/because/.test(await p.$eval('#qgCard .why', e => e.textContent)), 'AI question explains the answer');
  await p.evaluate(() => { window.tutorSample.json = async () => { throw {code: 'rate_limited'}; }; });
  await p.click('#qgGen'); await p.waitForTimeout(200);
  ok(/מגבלת השימוש/.test(await p.$eval('#qgCard', e => e.textContent)), 'AI rate limit is handled');

  // ecosystem
  await go('ecosystem');
  const n = await p.$$eval('#ecList .ecCard', x => x.length);
  ok(n === await p.evaluate(() => window.__ECO.length), 'catalog shows all ' + n + ' extensions');
  const bad = await p.evaluate(() => window.__ECO.filter(e => !/^[\w.-]+\/[\w.-]+$/.test(e.r) || !e.cmd.length).map(e => e.id));
  ok(bad.length === 0, 'every entry has a repo and a command ' + bad.join(','));
  await p.fill('#ecQ', 'playwright');
  ok(await p.$$eval('#ecList .ecCard', x => x.length) === 1, 'search finds Playwright');
  await p.fill('#ecQ', '');
  const kits = await p.$$eval('#ecKit option', o => o.length - 1);
  for (let k = 0; k < kits; k++) await p.selectOption('#ecKit', String(k));
  const script = await p.$eval('#ecScript pre', e => e.textContent);
  const mcp = await p.$eval('#ecMcp pre', e => e.textContent);
  let parsed = null; try { parsed = JSON.parse(mcp); } catch (e) {}
  ok(parsed && Object.keys(parsed.mcpServers).length >= 5, '.mcp.json is valid with ' + (parsed ? Object.keys(parsed.mcpServers).length : 0) + ' servers');
  ok(/claude mcp add playwright/.test(script) && /anthropics\/skills/.test(script), 'install script includes the chosen commands');
  ok(!/\$\{[A-Z_]+\}/.test(script) && /\$\{GITHUB_PAT\}/.test(mcp), 'secrets stay as ${VAR} in .mcp.json');
  const [d1] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#ecDl')]);
  ok(d1 && d1.suggestedFilename() === 'install-extensions.sh', 'install script downloads');
  await p.click('#ecNone');
  ok(await p.$$eval('#ecList input:checked', x => x.length) === 0, 'clear selection');
  for (const c of await p.$$('#ecCats button')) await c.click();
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
