// "חבילות ו-GitHub" section: its own group; install kit per OS (bash -n, and the check script really runs);
// famous repos; every code-library file is valid (JSON parses, bash passes -n, YAML has no tabs and parses as key/values).
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
  const go = async id => { await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(150); };
  const pre = id => p.$eval(id + ' pre', e => e.textContent);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'));
  const bashOk = (txt, name) => { const f = path.join(dir, name); fs.writeFileSync(f, txt); try { execFileSync('bash', ['-n', f], {stdio: 'pipe'}); return true; } catch (e) { return false; } };

  const toc = await p.$$eval('#toc li', li => li.map(x => x.classList.contains('grp') ? '#' + x.textContent.trim() : (x.querySelector('button') || {}).dataset.go));
  const at = toc.indexOf('#חבילות ו-GitHub');
  ok(at > 0 && JSON.stringify(toc.slice(at + 1, at + 5)) === JSON.stringify(['ecosystem', 'installkit', 'ghrepos', 'snippets']), 'own group with 4 chapters: ' + toc.slice(at + 1, at + 5).join(','));
  ok(toc[at - 7] === '#Make.com' || toc.indexOf('#Make.com') < at, 'comes after the Make section');

  // install kit
  await go('installkit');
  for (const osv of ['mac', 'linux', 'wsl']) {
    await p.selectOption('#ikOs', osv);
    const sh = await pre('#ikScript');
    ok(bashOk(sh, 'setup-' + osv + '.sh') && /claude\.ai\/install\.sh/.test(sh) && /git config --global user\.name/.test(sh), osv + ': setup script passes bash -n and installs Claude Code');
  }
  await p.selectOption('#ikOs', 'linux');
  ok(/apt-get install -y gh/.test(await pre('#ikScript')) && /apt-get install -y jq/.test(await pre('#ikScript')), 'linux: default tools (gh, jq, node) included');
  await p.check('#ikTools input[value="docker"]');
  ok(/usermod -aG docker/.test(await pre('#ikScript')), 'linux: docker adds the docker group step');
  await p.selectOption('#ikOs', 'win');
  const ps = await pre('#ikScript');
  ok(/irm https:\/\/claude\.ai\/install\.ps1 \| iex/.test(ps) && /winget install --id Git\.Git -e/.test(ps) && !/^#!\/usr\/bin\/env bash/.test(ps), 'windows: PowerShell script with the official installer and WinGet');
  await p.selectOption('#ikOs', 'linux');
  const doc = await pre('#ikDoctor');
  ok(bashOk(doc, 'check.sh'), 'check script passes bash -n');
  const f = path.join(dir, 'check-run.sh'); fs.writeFileSync(f, doc);
  const run = spawnSync('bash', [f], {encoding: 'utf8', env: {...process.env, HOME: dir}, timeout: 20000});
  const out = (run.stdout || '').replace(/\x1b\[[0-9;]*m/g, '');
  ok(/✓ Git: git version/.test(out) && /(✓|✗) Claude Code/.test(out) && /(✓|✗) ~\/\.local\/bin/.test(out) && [0, 1].includes(run.status), 'check script really runs and reports each tool: ' + out.split('\n').slice(0, 3).join(' | '));
  ok(/✗ git has no user\.email[\s\S]*git config --global user\.email/.test(out), 'check script suggests the fix for what is missing');
  await p.uncheck('#ikGit'); ok(await p.isHidden('#ikNameL') && !/user\.name/.test(await pre('#ikScript')), 'git identity can be left out');
  ok(await p.$$eval('#ikOps .trick', x => x.length) === 7 && /rm -rf ~\/\.local\/share\/claude/.test(await p.$eval('#ikOps', e => e.textContent)), 'update, uninstall and requirements cards');
  const [d1] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#ikDl')]);
  ok(d1 && d1.suggestedFilename() === 'setup-claude.sh', 'setup script downloads');

  // repos
  await go('ghrepos');
  const n = await p.$$eval('#grList .trick', x => x.length);
  ok(n >= 20, n + ' repos');
  ok(await p.evaluate(() => [...document.querySelectorAll('#grList .trick')].every(c => /git clone --depth 1 https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git && cd [\w.-]+ && claude/.test(c.textContent))), 'every repo has a working clone-and-explore command');
  await p.fill('#grQ', 'mcp'); ok(await p.$$eval('#grList .trick', x => x.length) >= 4, 'search');
  await p.fill('#grQ', '');
  for (const c of await p.$$('#grCats button')) { await c.click(); }
  ok(/בארכיון/.test(await p.evaluate(() => window.__REPOS.find(r => r[0] === 'anthropics/courses')[3])), 'archived repo is marked');

  // code library
  await go('snippets');
  const sn = await p.evaluate(() => window.__sn.map(s => ({f: s.f, l: s.l, code: s.code})));
  const bad = [];
  sn.forEach((s, i) => {
    if (s.l === 'json') { try { JSON.parse(s.code); } catch (e) { bad.push(s.f + ' (json)'); } }
    if (s.l === 'bash' && !bashOk(s.code, 'sn' + i + '.sh')) bad.push(s.f + ' (bash)');
    if (s.l === 'yaml' && (/\t/.test(s.code) || !/^name: /m.test(s.code) || !/^on:/m.test(s.code) || !/^jobs:/m.test(s.code))) bad.push(s.f + ' (yaml)');
  });
  ok(sn.length >= 20 && bad.length === 0, sn.length + ' files, all valid ' + bad.join(','));
  // hooks really block and allow
  const guard = sn.find(s => s.f === '.claude/hooks/guard.sh').code; const g = path.join(dir, 'guard.sh'); fs.writeFileSync(g, guard);
  const blk = spawnSync('bash', [g], {input: JSON.stringify({tool_input: {command: 'rm -rf / --no-preserve-root'}}), encoding: 'utf8'});
  const pass = spawnSync('bash', [g], {input: JSON.stringify({tool_input: {command: 'npm test'}}), encoding: 'utf8'});
  ok(blk.status === 2 && /Blocked/.test(blk.stderr) && pass.status === 0, 'guard.sh blocks rm -rf / (exit 2) and lets npm test through');
  const prot = sn.find(s => s.f === '.claude/hooks/protect-secrets.sh').code; const ps2 = path.join(dir, 'prot.sh'); fs.writeFileSync(ps2, prot);
  ok(spawnSync('bash', [ps2], {input: JSON.stringify({tool_input: {file_path: '/app/.env'}})}).status === 2 && spawnSync('bash', [ps2], {input: JSON.stringify({tool_input: {file_path: '/app/src/a.ts'}})}).status === 0, 'protect-secrets.sh blocks .env and allows code');
  await p.fill('#snQ', 'hook'); ok(await p.$$eval('#snList details', x => x.length) >= 4, 'search the library');
  await p.fill('#snQ', '');
  await p.click('#snList details summary');
  const [d2] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('[data-snd="0"]')]);
  ok(d2 && /\.json$/.test(d2.suggestedFilename()), 'a file downloads (' + (d2 && d2.suggestedFilename()) + ')');
  for (const id of ['ecosystem', 'installkit', 'ghrepos', 'snippets']) {
    await go(id);
    await p.evaluate(id => { const qz = document.querySelector('#' + id + ' .quiz'); const Q = window.__Q[id]; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); }, id);
  }
  ok(await p.evaluate(() => ['ecosystem', 'installkit', 'ghrepos', 'snippets'].every(id => JSON.parse(localStorage.getItem('cca-state')).done[id])), 'whole section completes');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
