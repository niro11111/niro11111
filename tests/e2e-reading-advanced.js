// Reading comfort (settings persist, reading time, "in this chapter", progress, back to top, read aloud),
// the 11 advanced catalog packages, and the advanced code-library files, which really run here with a stand-in
// `claude` on PATH: parallel worktrees, structured fan-out, session-context and no-edit-on-main hooks.
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const {execFileSync, spawnSync} = require('child_process');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport: {width: 1300, height: 900}});
  // record speech instead of speaking
  await ctx.addInitScript(() => {
    window.__said = []; window.__cancel = 0;
    window.SpeechSynthesisUtterance = function(t){ this.text = t; };
    Object.defineProperty(window, 'speechSynthesis', {value: {speak: u => window.__said.push(u), cancel: () => window.__cancel++, getVoices: () => [{lang: 'he-IL', name: 'Hebrew'}]}});
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(500);
  const go = async id => { await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(200); };

  // ---- per-chapter aids ----
  const aids = await p.evaluate(() => { const ms = [...document.querySelectorAll('.mod')]; return {n: ms.length, rt: ms.filter(m => m.querySelector('.rdBar [data-rt]')).length, nav: ms.filter(m => m.querySelector('nav.onpage')).length, navOk: [...document.querySelectorAll('nav.onpage [data-jump]')].every(b => document.getElementById(b.dataset.jump))}; });
  ok(aids.rt === aids.n, 'every chapter shows reading time (' + aids.rt + '/' + aids.n + ')');
  ok(aids.nav >= 20 && aids.navOk, aids.nav + ' long chapters get "in this chapter", every link has a target');
  await go('israel');
  await p.click('#israel nav.onpage summary');
  await p.click('#israel nav.onpage li:nth-child(3) [data-jump]');
  await p.waitForTimeout(1600);
  const jumped = await p.evaluate(() => { const h = document.activeElement; return h && h.tagName === 'H2' && Math.abs(h.getBoundingClientRect().top) < 60 ? h.textContent : null; });
  ok(!!jumped, 'jump link scrolls to the section and focuses it: ' + jumped);
  ok(await p.$eval('.rdProg i', e => parseFloat(e.style.width) > 0), 'reading progress bar moves');
  await p.evaluate(() => scrollTo(0, 3000)); await p.waitForTimeout(150);
  ok(!(await p.$eval('#rdTop', e => e.hidden)), 'back-to-top appears after scrolling');
  await p.click('#rdTop'); await p.waitForTimeout(1600);
  ok(await p.evaluate(() => scrollY < 5 && document.activeElement.tagName === 'H1'), 'back-to-top returns and focuses the title');

  // ---- read aloud ----
  await p.click('#israel [data-say]');
  const said = await p.evaluate(() => ({n: window.__said.length, lang: window.__said[0] && window.__said[0].lang, first: window.__said[0] && window.__said[0].text, btn: document.querySelector('#israel [data-say]').textContent, code: window.__said.some(u => /language.*hebrew/.test(u.text))}));
  ok(said.n > 10 && said.lang === 'he-IL' && /מיוחד לישראל/.test(said.first) && /עצירה/.test(said.btn) && !said.code, 'read aloud: ' + said.n + ' Hebrew paragraphs, title first, code blocks skipped');
  const c0 = await p.evaluate(() => window.__cancel);
  await go('slashlab');
  ok(await p.evaluate(c0 => window.__cancel > c0 && /הקראה/.test(document.querySelector('#israel [data-say]').textContent), c0), 'changing chapter stops reading');

  await go('israel'); await p.click('#israel [data-say]');
  const c1 = await p.evaluate(() => window.__cancel);
  await p.click('#nextBtn'); await p.waitForTimeout(150);
  ok(await p.evaluate(c1 => window.__cancel > c1 && /הקראה/.test(document.querySelector('#israel [data-say]').textContent), c1), 'the Next button also stops reading (not only the address bar)');
  // ---- settings ----
  await p.click('#lookBtn');
  ok(await p.$$eval('[data-rd]', x => x.length) === 8, '8 reading options in the dialog');
  await p.check('[data-rd="wrap"]'); await p.check('[data-rd="wide"]');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.mod.on .code pre')).whiteSpace === 'pre-wrap' && parseFloat(getComputedStyle(document.body).lineHeight) / parseFloat(getComputedStyle(document.body).fontSize) > 1.9), 'code wrap and wide spacing apply');
  await p.click('#rdEasy');
  const easy = await p.evaluate(() => ({cls: document.documentElement.className, fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()}));
  ok(/rd-plain/.test(easy.cls) && /rd-narrow/.test(easy.cls) && /rd-links/.test(easy.cls) && easy.fs === '1.1', '"easy reading" turns on the readable set and 110% text');
  await p.click('#rdReset'); await p.fill('#lookScale', '125'); await p.dispatchEvent('#lookScale', 'input');
  await p.check('[data-rd="wide"]'); await p.click('#rdReset');
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() === '1.25'), 'reset keeps the text size chosen with the slider');
  await p.click('#rdEasy');
  await p.check('[data-rd="focus"]'); await p.click('#lookX');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.rail')).display === 'none' && getComputedStyle(document.getElementById('rdShow')).display !== 'none'), 'focus mode hides the chapter list and shows ☰');
  await p.reload(); await p.waitForTimeout(500);
  ok(await p.evaluate(() => /rd-focus/.test(document.documentElement.className) && /rd-plain/.test(document.documentElement.className)), 'settings survive a reload');
  await p.click('#rdShow');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.rail')).display !== 'none'), '☰ brings the chapter list back');
  await p.click('#lookBtn'); await p.click('#rdReset'); await p.click('#lookX');
  ok(await p.evaluate(() => !/rd-/.test(document.documentElement.className)), 'reset clears every reading option');

  // ---- term tips ----
  await go('hooks');
  const tt = await p.evaluate(() => { const g = [...document.querySelectorAll('.mod.on .gterm')]; return {n: g.length, bad: g.filter(b => b.parentElement.closest('a,button,label,summary,code,pre,h1,h2,h3,.code,.quiz')).length, uniq: new Set(g.map(b => b.dataset.term)).size === g.length}; });
  ok(tt.n >= 2 && tt.bad === 0 && tt.uniq, 'terms are tagged once per chapter, never inside links, code or headings (' + tt.n + ' here)');
  await p.evaluate(() => document.querySelector('.mod.on .gterm').scrollIntoView({block: 'center'}));
  await p.focus('.mod.on .gterm'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  const tipTxt = await p.evaluate(() => { const t = document.getElementById('termTip'); const b = document.querySelector('.mod.on .gterm'); return !t.hidden && b.getAttribute('aria-expanded') === 'true' && b.getAttribute('aria-describedby') === 'termTip' ? t.textContent : null; });
  ok(tipTxt && /למילון/.test(tipTxt), 'keyboard opens the explanation: ' + (tipTxt || '').slice(0, 50));
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => document.getElementById('termTip').hidden && document.activeElement.classList.contains('gterm')), 'Esc closes it and keeps focus on the term');
  await p.click('.mod.on .gterm'); await p.click('#termTip [data-go="glossary"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => location.hash === '#glossary' && document.getElementById('termTip').hidden), 'link goes to the glossary');
  let total = 0; for (const id of ['intro', 'mcp', 'agents', 'skills', 'israel']) { await go(id); total += await p.$$eval('.mod.on .gterm', x => x.length); }
  ok(total >= 10, total + ' terms explained across 5 chapters');
  await p.click('#lookBtn'); await p.check('[data-rd="noterms"]'); await p.click('#lookX'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => document.querySelectorAll('.gterm').length === 0), 'turning explanations off removes every term button');
  await p.click('#lookBtn'); await p.uncheck('[data-rd="noterms"]'); await p.click('#lookX'); await p.waitForTimeout(50);
  ok(await p.$$eval('.mod.on .gterm', x => x.length) > 0, 'turning them back on restores them');

  // ---- advanced catalog ----
  await go('ecosystem');
  const eco = await p.evaluate(() => { const ids = ['taskmaster','superclaude','ruflo','serena','containeruse','pal','secreview','ccsessions','claudecontext','claudemem','tddguard']; const E = window.__ECO; return {found: ids.filter(i => E.some(e => e.id === i)).length, dup: E.length - new Set(E.map(e => e.id)).size, cards: document.querySelectorAll('#ecList .ecCard').length, total: E.length}; });
  ok(eco.found === 11 && eco.dup === 0 && eco.cards === eco.total, '11 advanced packages, no duplicate ids, ' + eco.total + ' cards shown');

  // ---- advanced code library: run the scripts for real ----
  const sn = await p.evaluate(() => window.__SNIPPETS.filter(s => s.c === 'מתקדם במיוחד').map(s => ({f: s.f, l: s.l, code: s.code})));
  ok(sn.length === 8, '8 advanced library files');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-'));
  const get = f => sn.find(s => s.f === f).code;
  sn.filter(s => s.l === 'json').forEach(s => { try { JSON.parse(s.code); } catch (e) { ok(false, s.f + ' JSON'); } });
  const bad = sn.filter(s => s.l === 'bash').filter(s => { const f = path.join(dir, path.basename(s.f)); fs.writeFileSync(f, s.code); return spawnSync('bash', ['-n', f]).status !== 0; });
  ok(bad.length === 0, 'all bash files pass bash -n');
  const mk = JSON.parse(get('my-marketplace/.claude-plugin/marketplace.json'));
  ok(mk.name && mk.owner && mk.owner.name && mk.plugins.every(x => x.name && x.source.startsWith('./')), 'marketplace.json has name, owner and plugins with relative sources');
  ok(/^---\nname: Hebrew teacher\ndescription: .+\nkeep-coding-instructions: true\n---\n/.test(get('~/.claude/output-styles/hebrew-teacher.md')), 'output style frontmatter');
  // stand-in claude: writes a file (parallel) or prints structured JSON (fan-out)
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), '#!/usr/bin/env bash\nprompt="$2"\nif [[ " $* " == *" --json-schema "* ]]; then f=$(sed -E "s/^Review ([^ ]+) for.*/\\1/" <<<"$prompt"); r=low; [[ $f == *auth* ]] && r=high; printf \'{"result":"ok","structured_output":{"file":"%s","risk":"%s","issues":["x in %s"]}}\' "$f" "$r" "$f"; else echo "$prompt" > AI_DID_THIS.txt; echo ok; fi\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const env = {...process.env, PATH: bin + ':' + process.env.PATH, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'};
  const repo = path.join(dir, 'proj'); fs.mkdirSync(path.join(repo, 'src/api'), {recursive: true}); fs.mkdirSync(path.join(repo, 'scripts'));
  ['src/auth.ts', 'src/api/user.ts', 'src/util.ts'].forEach(f => fs.writeFileSync(path.join(repo, f), '// ' + f + '\n'));
  fs.writeFileSync(path.join(repo, 'scripts/parallel.sh'), get('scripts/parallel.sh')); fs.writeFileSync(path.join(repo, 'scripts/fanout.sh'), get('scripts/fanout.sh'));
  execFileSync('bash', ['-c', 'git init -q -b main && git add -A && git commit -qm init'], {cwd: repo, env});
  const par = spawnSync('bash', ['scripts/parallel.sh'], {cwd: repo, env, encoding: 'utf8', timeout: 60000});
  const branches = execFileSync('git', ['branch', '--list', 'ai/*'], {cwd: repo, encoding: 'utf8'}).trim().split('\n').length;
  const wt = ['fix-login', 'docs-api', 'perf-list'].every(n => fs.existsSync(path.join(dir, 'proj-' + n, 'AI_DID_THIS.txt')));
  ok(par.status === 0 && (par.stdout.match(/^done/gm) || []).length === 3 && branches === 3 && wt, 'parallel.sh: 3 worktrees, 3 ai/* branches, each task ran in its own folder');
  const fan = spawnSync('bash', ['scripts/fanout.sh', 'src/**/*.ts'], {cwd: repo, env, encoding: 'utf8', timeout: 60000});
  const rep = fs.existsSync(path.join(repo, 'fanout-report.json')) ? JSON.parse(fs.readFileSync(path.join(repo, 'fanout-report.json'), 'utf8')) : [];
  ok(fan.status === 0 && rep.length === 3 && rep[0].file === 'src/auth.ts' && rep[0].risk === 'high' && /HIGH +src\/auth\.ts/.test(fan.stdout), 'fanout.sh: 3 structured results, high risk sorted first ' + (fan.stderr || '').slice(0, 200));
  const sc = path.join(dir, 'sc.sh'); fs.writeFileSync(sc, get('.claude/hooks/session-context.sh'));
  const ctxOut = spawnSync('bash', [sc], {env: {...env, CLAUDE_PROJECT_DIR: repo}, encoding: 'utf8'});
  ok(ctxOut.status === 0 && /Branch: main/.test(ctxOut.stdout) && /Last commits:\n {2}\w+ init/.test(ctxOut.stdout), 'session-context hook prints branch and commits');
  const ne = path.join(dir, 'ne.sh'); fs.writeFileSync(ne, get('.claude/hooks/no-edit-on-main.sh'));
  const onMain = spawnSync('bash', [ne], {env: {...env, CLAUDE_PROJECT_DIR: repo}, encoding: 'utf8'});
  execFileSync('git', ['switch', '-qc', 'feature'], {cwd: repo});
  const onFeat = spawnSync('bash', [ne], {env: {...env, CLAUDE_PROJECT_DIR: repo}, encoding: 'utf8'});
  ok(onMain.status === 2 && /Blocked/.test(onMain.stderr) && onFeat.status === 0, 'no-edit-on-main blocks on main (exit 2) and allows a branch');
  await go('snippets');
  ok(await p.evaluate(() => [...document.querySelectorAll('#snCats button')].some(b => b.textContent === 'מתקדם במיוחד')), 'library has the "מתקדם במיוחד" tab');

  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
  ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cca-state') || '{}').awarded || {}).length === 0), 'still no XP just for opening the app');
  const mp = await b.newPage({viewport: {width: 390, height: 800}}); await mp.route(/^https:/, r => r.abort());
  await mp.goto(U + '#israel'); await mp.waitForTimeout(600);
  ok(await mp.evaluate(() => scrollY === 0 && document.querySelector('.mod.on .eyebrow').getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom - 1), 'phone: opening a #chapter link shows the chapter top, not hidden under the bar');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
