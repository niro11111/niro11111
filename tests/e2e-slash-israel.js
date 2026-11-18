// Slash-commands lab + Israel chapter: argument expansion follows the documented rules, every pack file has
// valid YAML frontmatter, the install script really creates the files, the RTL fixer keeps LTR rendering and
// mirrors in RTL, and il-format.js (exported from the page) gives correct Israeli results in Node.
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const {execFileSync, spawnSync} = require('child_process');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(500);
  ok(await p.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('cca-state') || '{}').awarded) || {}).length === 0 && !document.querySelector('.toast.on, .toast.show')), 'no XP is awarded just for opening the app');
  const go = async id => { await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(150); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));

  const toc = await p.$$eval('#toc li', li => li.map(x => x.classList.contains('grp') ? '#' + x.textContent.trim() : (x.querySelector('button') || {}).dataset.go));
  const at = toc.indexOf('#חבילות ו-GitHub');
  ok(JSON.stringify(toc.slice(at + 1, at + 7)) === JSON.stringify(['ecosystem', 'installkit', 'ghrepos', 'snippets', 'slashlab', 'israel']), 'section has 6 chapters: ' + toc.slice(at + 1, at + 7).join(','));

  // ---- expansion rules (code.claude.com/docs/en/skills) ----
  await go('slashlab');
  const X = (body, raw, names) => p.evaluate(([b, r, n]) => window.__sl.expand(b, r, n).text, [body, raw, names || []]);
  ok(await X('Migrate the $0 component from $1 to $2.', 'SearchBar JavaScript TypeScript') === 'Migrate the SearchBar component from JavaScript to TypeScript.', '$N is 0-based');
  ok(await X('A $ARGUMENTS[1] B', 'x y') === 'A y B', '$ARGUMENTS[N]');
  ok(await X('$0|$1', '"hello world" second') === 'hello world|second', 'quotes group words');
  ok(await X('All: $ARGUMENTS', 'a "b c"') === 'All: a "b c"', '$ARGUMENTS is the string as typed');
  ok(await X('Fix #$issue on $branch.', '12', ['issue', 'branch']) === 'Fix #12 on .', 'named args; a missing named arg is empty');
  ok(await X('Do $3 now', 'a') === 'Do $3 now\n\nARGUMENTS: a', 'index with no argument stays literal, and ARGUMENTS: is appended');
  ok(await X('Plain body', 'extra words') === 'Plain body\n\nARGUMENTS: extra words', 'no placeholder → ARGUMENTS: line');
  ok(await X('Costs \\$1.00 and $0', 'x') === 'Costs $1.00 and x', '\\$1 escape is a literal');
  ok(await X('Summarize $0', '"$ARGUMENTS from yesterday"') === 'Summarize $ARGUMENTS from yesterday', 'argument text is not re-expanded');
  ok(await X('- B: !`git branch --show-current`\nKEY=!`cmd`', '') === '- B: [output of `git branch --show-current`]\nKEY=!`cmd`', '! runs only at line start / after whitespace');
  ok(/\[output of:\nnode --version\n\]/.test(await X('```!\nnode --version\n```', '')), '```! block');

  // ---- builder ----
  const sim = await p.$eval('#slSim pre', e => e.textContent);
  ok(/Fix GitHub issue #482\./.test(sim) && /Create branch fix\/login timeout/.test(sim) && /\[output of `git status --short`\]/.test(sim), 'simulator shows the expanded default command');
  const out = await p.$eval('#slOut pre', e => e.textContent);
  const fm = path.join(dir, 'fm.md'); fs.writeFileSync(fm, out);
  const y = spawnSync('python3', ['-c', 'import sys,yaml;t=open(sys.argv[1]).read();print(yaml.safe_load(t.split("---")[1])["argument-hint"])', fm], {encoding: 'utf8'});
  ok(y.status === 0 && y.stdout.trim() === '[issue-number] [branch]', 'builder frontmatter parses; argument-hint stays a string');
  const lint = async (name, body) => { await p.fill('#slName', name); if(body) await p.fill('#slBody', body); return p.$eval('#slLint', e => e.textContent); };
  ok(/עברית/.test(await lint('תיקון')), 'Hebrew command name is flagged');
  ok(/מובנית/.test(await lint('compact')), 'reserved built-in name is flagged');
  ok(/מתחילה מאפס/.test(await lint('x', 'Use $1 here $issue $branch')), '$1 without $0 is flagged');
  ok(/רק אני מפעיל/.test(await (async () => { await p.uncheck('#slManual'); return lint('deploy-prod'); })()), 'deploy without disable-model-invocation is flagged');
  await p.selectOption('#slKind', 'skill');
  ok(await p.$eval('#slOut', e => e.dataset.file) === '.claude/skills/deploy-prod/SKILL.md' && /^---\nname: deploy-prod/.test(await p.$eval('#slOut pre', e => e.textContent)), 'skill layout adds name and SKILL.md path');
  await p.selectOption('#slTpl', 'explain-file');
  ok(/Explain src\/auth\/session\.ts for a beginner reader/.test(await p.$eval('#slSim pre', e => e.textContent)), 'template loads and simulates');

  // ---- pack: YAML + install script really runs ----
  const pk = await p.evaluate(() => window.__sl.PK.map(x => ({n: x.n, f: window.__sl.pkFile(x)})));
  ok(pk.length === 16, '16 community commands');
  const badY = pk.filter(x => { const f = path.join(dir, x.n + '.md'); fs.writeFileSync(f, x.f); return spawnSync('python3', ['-c', 'import sys,yaml;t=open(sys.argv[1]).read();assert t.startswith("---\\n");d=yaml.safe_load(t.split("---")[1]);assert isinstance(d["description"],str);[isinstance(d.get(k,""),str) or sys.exit(1) for k in ("argument-hint","allowed-tools","model","effort")]', f]).status !== 0; }).map(x => x.n);
  ok(badY.length === 0, 'every pack file has valid frontmatter ' + badY.join(','));
  const cmdNames = await p.evaluate(() => window.__sl.PK.map(x => x.n));
  const cmdpack = await p.evaluate(() => typeof PACK !== 'undefined' ? PACK.map(x => x[1]) : []);
  ok(cmdNames.every(n => !cmdpack.includes(n)), 'no overlap with the expert pack');
  const sh = await p.$eval('#slScript pre', e => e.textContent);
  const proj = fs.mkdtempSync(path.join(dir, 'proj-')); fs.writeFileSync(path.join(proj, 'i.sh'), sh);
  execFileSync('bash', ['-n', path.join(proj, 'i.sh')]);
  const r1 = spawnSync('bash', ['i.sh'], {cwd: proj, encoding: 'utf8'});
  const same = pk.every(x => fs.readFileSync(path.join(proj, '.claude/commands', x.n + '.md'), 'utf8') === x.f);
  const r2 = spawnSync('bash', ['i.sh'], {cwd: proj, encoding: 'utf8'});
  ok(r1.status === 0 && same && (r1.stdout.match(/^added/gm) || []).length === 16, 'install script creates all 16 files byte-for-byte');
  ok(r2.status === 0 && (r2.stdout.match(/^skip/gm) || []).length === 16, 'second run skips existing files');
  await p.click('#slNone'); ok(!/put \.claude/.test(await p.$eval('#slScript pre', e => e.textContent)), 'clear empties the script');
  await p.click('#slAll'); await p.fill('#slQ', 'עברית'); ok(await p.$$eval('#slPack details', x => x.length) === 3, 'search finds the 3 Hebrew commands');
  await p.click('#slPack input[data-pk="he-explain"]');
  ok(/15 מתוך 16/.test(await p.textContent('#slCount')) && !(await p.$eval('#slPack details', d => d.open)), 'checkbox in summary toggles selection, not the details');
  await p.fill('#slQ', '');
  const [d1] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#slDlAll')]);
  ok(d1 && d1.suggestedFilename() === 'install-community-commands.sh', 'pack script downloads');

  // ---- Israel ----
  await go('israel');
  const rt = await p.evaluate(() => window.__il.rtlAudit('.a{margin-left:16px;padding-right:8px;text-align:left;border-left:3px solid red;border-top-left-radius:8px;float:right;margin:0 12px 0 4px}\n.b{position:absolute;left:0}\n<div class="ml-4 pr-2 text-left rounded-tl-lg border-l-2 left-0 md:-mr-1">', 'ltr'));
  ok(!/(margin|padding|border)-(left|right)|[{;]left:|text-align:left|float:right|\bml-4|\bpr-2|text-left|rounded-tl|border-l-|\bleft-0|-mr-1/.test(rt.out), 'no physical properties left: ' + rt.issues.length + ' fixes');
  ok(/margin-inline-start:16px/.test(rt.out) && /border-start-start-radius/.test(rt.out) && /float:inline-end/.test(rt.out) && /margin-block: 0 0; margin-inline: 4px 12px/.test(rt.out) && /md:-me-1/.test(rt.out) && /rounded-ss-lg/.test(rt.out), 'logical replacements are right');
  const rtR = await p.evaluate(() => window.__il.rtlAudit('margin-left: 4px', 'rtl').out);
  ok(rtR === 'margin-inline-end: 4px', 'code written for RTL maps left → end');
  // rendering: fixed CSS looks the same in LTR and mirrors in RTL
  const geo = await p.evaluate(() => {
    const css = '.t{margin-left:16px;padding-right:8px;border-left:3px solid red;text-align:left}';
    const fixed = window.__il.rtlAudit(css, 'ltr').out.replace('.t', '.f');
    const st = document.createElement('style'); st.textContent = css + fixed; document.head.appendChild(st);
    const mk = (dir, cls) => { const w = document.createElement('div'); w.dir = dir; w.innerHTML = '<div class="' + cls + '">x</div>'; document.body.appendChild(w); const c = getComputedStyle(w.firstChild); const r = [c.marginLeft, c.marginRight, c.paddingLeft, c.paddingRight, c.borderLeftWidth, c.borderRightWidth, c.textAlign]; w.remove(); return r; };
    return {ltrOrig: mk('ltr', 't'), ltrFix: mk('ltr', 'f'), rtlFix: mk('rtl', 'f')};
  });
  ok(JSON.stringify(geo.ltrOrig.slice(0, 6)) === JSON.stringify(geo.ltrFix.slice(0, 6)) && geo.rtlFix[1] === '16px' && geo.rtlFix[2] === '8px' && geo.rtlFix[5] === '3px' && geo.rtlFix[6] === 'start', 'fixed CSS renders the same in LTR and mirrors in RTL ' + JSON.stringify(geo.rtlFix));
  await p.fill('#rtlIn', '.x{margin-left:2px}');
  ok(/margin-inline-start/.test(await p.$eval('#rtlOut pre', e => e.textContent)), 'checker updates live');

  const v = await p.evaluate(() => { const I = window.__il; return {
    id: [I.isValidIsraeliId('123456782'), I.isValidIsraeliId('000000018'), I.isValidIsraeliId('18'), I.isValidIsraeliId('123456789'), I.isValidIsraeliId('000000000'), I.isValidIsraeliId('12a456782')],
    ph: ['054-123 4567', '+972 54 1234567', '+972 (0)54-1234567', '02-6234567', '0771234567', '12345'].map(x => (I.normalizeILPhone(x) || {}).e164 || null),
    vat: I.withVat(1000), back: I.netFromGross(1180), odd: I.withVat(19.99),
    heb: I.hebrewDate(new Date(2026, 8, 21, 12)), d: I.formatDateIL(new Date(2026, 8, 21, 12)), ils: I.formatILS(1180)}; });
  ok(JSON.stringify(v.id) === JSON.stringify([true, true, false, false, false, false]), 'ID check digit ' + JSON.stringify(v.id));
  ok(JSON.stringify(v.ph) === JSON.stringify(['+972541234567', '+972541234567', '+972541234567', '+97226234567', '+972771234567', null]), 'phones → E.164 ' + JSON.stringify(v.ph));
  ok(v.vat.vat === 180 && v.vat.gross === 1180 && v.back.net === 1000 && v.odd.vat === 3.6 && v.odd.gross === 23.59, 'VAT 18% rounded to agorot');
  ok(/תשרי/.test(v.heb) && v.d === '21.09.2026' && /1,180\.00/.test(v.ils) && /₪/.test(v.ils), 'he-IL formats: ' + v.heb + ' · ' + v.d);
  await p.fill('#ilId', '123456789'); ok(/לא תקינה/.test(await p.textContent('#ilOut')), 'live form shows an invalid ID');
  await p.fill('#ilDate', '2026-09-25'); ok(/שישי/.test(await p.textContent('#ilOut')), 'Friday is not a business day');
  // the downloadable module is the same code and works in Node
  const src = await p.$eval('#ilSrc pre', e => e.textContent);
  const mod = path.join(dir, 'il-format.mjs'); fs.writeFileSync(mod, src);
  const nodeRun = spawnSync('node', ['--input-type=module', '-e', 'import * as I from ' + JSON.stringify(mod) + '; console.log(JSON.stringify([I.VAT_RATE, I.isValidIsraeliId("123456782"), I.normalizeILPhone("0541234567").e164, I.withVat(100).gross, I.hebrewDate(new Date(2026,8,21,12)).includes("תשרי")]))'], {encoding: 'utf8'});
  ok(nodeRun.stdout.trim() === '[0.18,true,"+972541234567",118,true]', 'il-format.js runs in Node ' + nodeRun.stdout.trim() + nodeRun.stderr.slice(0, 200));
  ok(await p.$$eval('#ilPkgs .trick', x => x.length) >= 9 && await p.$$eval('#ilHebrew .trick', x => x.length) === 8, 'packages and Hebrew tips');
  ok(/"language": "hebrew"/.test(await p.$eval('#ilSettings pre', e => e.textContent)), 'settings.json sets language');
  const [d2] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#ilDl')]);
  ok(d2 && d2.suggestedFilename() === 'il-format.js', 'il-format.js downloads');

  // ---- install kit: more tools ----
  await go('installkit');
  for (const t of ['rg', 'fzf', 'bat', 'fd', 'shellcheck', 'python']) await p.check('#ikTools input[value="' + t + '"]');
  for (const osv of ['mac', 'linux', 'wsl']) {
    await p.selectOption('#ikOs', osv);
    const s = await p.$eval('#ikScript pre', e => e.textContent); const f = path.join(dir, 'k-' + osv + '.sh'); fs.writeFileSync(f, s);
    ok(spawnSync('bash', ['-n', f]).status === 0 && /ripgrep/.test(s) && /shellcheck/.test(s), osv + ': script with 13 tools passes bash -n');
  }
  await p.selectOption('#ikOs', 'linux');
  ok(/ln -sf \/usr\/bin\/batcat/.test(await p.$eval('#ikScript pre', e => e.textContent)), 'linux: bat/fd get their usual names');
  await p.selectOption('#ikOs', 'win');
  ok(/BurntSushi\.ripgrep\.MSVC/.test(await p.$eval('#ikScript pre', e => e.textContent)), 'windows: WinGet ids for the new tools');

  for (const id of ['slashlab', 'israel']) {
    await go(id);
    await p.evaluate(id => { const qz = document.querySelector('#' + id + ' .quiz'); const Q = window.__Q[id]; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); }, id);
  }
  ok(await p.evaluate(() => ['slashlab', 'israel'].every(id => JSON.parse(localStorage.getItem('cca-state')).done[id])), 'both chapters complete');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
