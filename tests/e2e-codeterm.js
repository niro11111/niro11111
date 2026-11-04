// Code terminal: demo project findings, every command, real ZIP upload (examples/kitzur), file upload, AI with tools (mock).
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const {execFileSync} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const U = 'file://' + ROOT + '/index.html';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  await p.goto(U); await p.waitForTimeout(500);
  await p.evaluate(() => { location.hash = 'codeterm'; }); await p.waitForTimeout(200);
  const run = async c => { await p.fill('#ctCmd', c); await p.press('#ctCmd', 'Enter'); await p.waitForTimeout(60); return p.$eval('#ctOut', e => e.lastElementChild ? e.lastElementChild.textContent : ''); };

  ok(/אין פרויקט/.test(await run('scan')), 'scan without a project explains what to do');
  await run('demo');
  const out = await run('scan');
  ok(/ציון בריאות/.test(out), 'scan prints a health score');
  const ids = await p.evaluate(() => window.__ct.state.report.findings.map(f => f.id));
  const expect = ['secret', 'sqlcat', 'innerhtml', 'cors', 'emptycatch', 'consolelog', 'todo', 'imgalt', 'divclick', 'notests', 'noreadme', 'nogitignore', 'noenvex', 'noci', 'nolock', 'docklatest', 'dockroot', 'deprecated', 'missingdep', 'noclaude', 'notestscript'];
  const miss = expect.filter(x => !ids.includes(x));
  ok(miss.length === 0, 'demo: all ' + expect.length + ' planted issues found ' + miss.join(','));
  const r = await p.evaluate(() => { const r = window.__ct.state.report; return {health: r.health, crit: r.counts.crit, routes: r.routes.length, models: r.models.map(m => m[0]), envs: r.envs, feats: r.features.filter(f => !f.present).map(f => f.id), sqlLine: r.findings.find(f => f.id === 'sqlcat').l}; });
  ok(r.health < 40 && r.crit >= 2, 'demo health is low (' + r.health + ') with ' + r.crit + ' critical');
  ok(r.routes === 4 && r.models.includes('todos'), 'spec: 4 routes and the todos table');
  ok(['DATABASE_URL', 'PORT', 'PRICE_ID', 'STRIPE_KEY'].every(e => r.envs.includes(e)), 'spec: env vars ' + r.envs.join(','));
  ok(['authz', 'validation', 'ratelimit', 'payments-webhook', 'health'].every(f => r.feats.includes(f)), 'features to add: ' + r.feats.join(','));
  ok(r.sqlLine === 13, 'SQL injection points to the right line (' + r.sqlLine + ')');
  ok(await p.isVisible('#ctReport') && await p.$$eval('#ctFind .ctF', x => x.length) === ids.length, 'report panel lists every finding');
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.codeterm), 'chapter completes on first scan');

  const cmds = {ls: /src\//, 'ls src': /server\.js/, tree: /schema\.sql/, 'cat server.js 10 14': /SELECT \* FROM todos/, 'grep stripe': /server\.js:\d+/, 'grep /DELETE\\s+FROM/': /server\.js/, stats: /JavaScript/, 'review src/server.js': /SQL/, suggest: /מה להוסיף/, features: /להוסיף/, routes: /\/api\/todos/, models: /todos/, env: /DATABASE_URL/, prompts: /parameterized/, help: /scan/, nope: /לא מוכרת/, 'claude --help': /סימולטור/, claudemd: /CLAUDE\.md/};
  for (const [c, re] of Object.entries(cmds)) ok(re.test(await run(c)), 'command: ' + c);
  await run('spec');
  const spec = await p.$eval('#ctSpec pre', e => e.textContent);
  ok(/# אפיון: todo-api/.test(spec) && /\/api\/checkout/.test(spec) && /Stripe/.test(spec) && /פערים מול מוצר שלם/.test(spec) && /שאלות פתוחות/.test(spec), 'SPEC.md has routes, integrations, gaps and open questions');
  const plan = await p.$eval('#ctPlan pre', e => e.textContent);
  ok(/שלב 0: בטיחות מיידית/.test(plan) && (plan.match(/- \[ \]/g) || []).length >= 15, 'PLAN.md has phases and tasks');
  ok((await p.$eval('#ctMem pre', e => e.textContent)).length > 100, 'CLAUDE.md generated');
  const [d] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), run('export')]);
  ok(d && d.suggestedFilename() === 'REVIEW.md', 'export downloads REVIEW.md');
  const [d2] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#ctDlSpec')]);
  ok(d2 && d2.suggestedFilename() === 'SPEC.md', 'SPEC.md downloads');
  // tab completion and history
  await p.fill('#ctCmd', 'sca'); await p.press('#ctCmd', 'Tab');
  ok((await p.inputValue('#ctCmd')).trim() === 'scan', 'tab completes commands');
  await p.fill('#ctCmd', 'cat db/sch'); await p.press('#ctCmd', 'Tab');
  ok(await p.inputValue('#ctCmd') === 'cat db/schema.sql', 'tab completes file names');
  await p.fill('#ctCmd', ''); await p.press('#ctCmd', 'ArrowUp');
  ok((await p.inputValue('#ctCmd')).length > 0, 'history with up arrow');

  // real ZIP of examples/kitzur (deflate), with node_modules filtered out
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctz-')), zip = path.join(tmp, 'kitzur.zip');
  execFileSync('python3', ['-c', 'import sys,zipfile,os\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nfor r,ds,fs in os.walk(sys.argv[2]):\n  for f in fs:\n    full=os.path.join(r,f); z.write(full, os.path.join("kitzur", os.path.relpath(full, sys.argv[2])))\nz.close()', zip, path.join(ROOT, 'examples/kitzur')]);
  await p.setInputFiles('#ctZip', zip); await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({n: Object.keys(window.__ct.state.files).length, names: Object.keys(window.__ct.state.files), name: window.__ct.state.name}));
  ok(st.name === 'kitzur' && st.n >= 5 && !st.names.some(n => /node_modules|\.git\//.test(n)) && st.names.includes('package.json'), 'ZIP upload: ' + st.n + ' files, top folder stripped, dependencies skipped');
  await run('scan');
  const k = await p.evaluate(() => { const r = window.__ct.state.report; return {health: r.health, crit: r.counts.crit, tests: r.tests, routes: r.routes.length, fw: r.az.frameworks}; });
  ok(k.crit === 0 && k.tests >= 1 && k.routes >= 2 && k.health > 50, 'real project kitzur: health ' + k.health + ', 0 critical, ' + k.tests + ' test files, ' + k.routes + ' routes, ' + k.fw.join(','));

  // plain file upload
  const f1 = path.join(tmp, 'app.py');
  fs.writeFileSync(f1, 'import os\nfrom fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/items/{id}")\ndef item(id: int):\n    q = f"SELECT * FROM items WHERE id = {id}"\n    try:\n        return db.execute(q)\n    except:\n        pass\n\nKEY = os.environ["API_KEY"]\n');
  await p.setInputFiles('#ctFiles', [f1]); await p.waitForTimeout(300);
  await run('scan');
  const py = await p.evaluate(() => window.__ct.state.report.findings.map(f => f.id));
  ok(py.includes('sqlcat') && py.includes('emptycatch') && py.includes('noenvex'), 'Python upload: f-string SQL, bare except and env vars detected');
  ok(await p.evaluate(() => window.__ct.state.report.routes.some(r => r[1] === '/items/{id}')), 'FastAPI route detected');

  // AI with tools through a mock
  await run('demo');
  await p.evaluate(() => {
    const fake = async (prompt, opts) => {
      const list = await opts.tools.find(t => t.name === 'list_files').execute({});
      const file = await opts.tools.find(t => t.name === 'read_file').execute({path: 'src/server.js', start: 12, end: 14});
      const hits = await opts.tools.find(t => t.name === 'search').execute({text: 'stripe'});
      return {text: '## ריוויו\n' + list.split('\n').length + ' files\n```\n' + file + '\n```\n' + hits.split('\n').length + ' hits'};
    };
    window.tutorSample = fake;
  });
  await run('ai review'); await p.waitForTimeout(300);
  const ai = await p.$eval('#ctOut', e => e.lastElementChild.textContent);
  ok(/ריוויו/.test(ai) && /6 files/.test(ai) && /SELECT \* FROM todos/.test(ai) && /hits/.test(ai), 'ai: Claude reads files through the page tools');
  await p.evaluate(() => { window.tutorSample = async (prompt, opts) => { if (opts.tools) throw {code: 'tools_unavailable'}; return {text: /=== src\/server\.js ===/.test(prompt) ? 'fallback with files' : 'no files'}; }; });
  await run('ai review src/server.js'); await p.waitForTimeout(300);
  ok(/fallback with files/.test(await p.$eval('#ctOut', e => e.lastElementChild.textContent)), 'ai: falls back to sending files when tools are unavailable');
  await p.evaluate(() => { window.tutorSample = null; });
  ok(/לא זמין/.test(await run('ai hello')), 'ai without the tutor explains itself');
  await run('clear');
  ok(await p.$$eval('#ctOut > div', x => x.length) === 0, 'clear');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
