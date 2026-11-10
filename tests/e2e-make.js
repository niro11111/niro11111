// Make.com chapter: every tab, every generator, and the generated hook script run for real against a local
// receiver standing in for a Make custom webhook (with the same stdin JSON Claude Code sends to hooks).
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const {execFileSync, spawnSync} = require('child_process');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.goto(U); await p.waitForTimeout(400);
  await p.evaluate(() => { location.hash = 'make'; }); await p.waitForTimeout(200);
  const pre = id => p.$eval(id + ' pre', e => e.textContent);
  const json = async id => { try { return JSON.parse(await pre(id)); } catch (e) { return null; } };

  ok(await p.$$eval('#mkConcepts .trick', x => x.length) === 10, '10 core concepts');
  for (const t of await p.$$('#mkWays button')) { await t.click(); ok((await p.$eval('#mkWay', e => e.textContent.length)) > 200, 'way: ' + await t.textContent()); }
  ok(/claude mcp add --transport http make https:\/\/mcp\.make\.com\/claude/.test(await p.$eval('#mkWays', () => document.body.textContent)), 'official Claude Code command is shown');
  for (const t of await p.$$('#mkRecipes button')) { await t.click(); ok((await p.$$eval('#mkRecipe li', x => x.length)) >= 4, 'recipe: ' + await t.textContent()); }

  // generator 1: hook
  const sh = await pre('#mhScript');
  const settings = await json('#mhSettings');
  ok(settings && settings.hooks.Stop && settings.hooks.Notification && !settings.hooks.SubagentStop, 'hook settings JSON for the chosen events');
  ok((await json('#mhLocal')).env.MAKE_WEBHOOK_URL, 'webhook URL goes to settings.local.json');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-')), f = path.join(dir, 'notify-make.sh'); fs.writeFileSync(f, sh, {mode: 0o755});
  let syntax = true; try { execFileSync('bash', ['-n', f]); } catch (e) { syntax = false; }
  ok(syntax, 'hook script passes bash -n');
  const got = [];
  const srv = http.createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { got.push({ct: req.headers['content-type'], body: d}); res.end('Accepted'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const input = JSON.stringify({session_id: 'abc123', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', cwd: dir});
  const run1 = spawnSync('bash', [f], {input, cwd: dir, env: {...process.env, MAKE_WEBHOOK_URL: 'http://127.0.0.1:' + srv.address().port + '/hook'}, timeout: 15000});
  await new Promise(r => setTimeout(r, 200));
  const ev = got[0] && JSON.parse(got[0].body);
  ok(run1.status === 0 && ev && ev.event === 'Notification' && ev.session === 'abc123' && /permission/.test(ev.message) && ev.project === path.basename(dir) && /^\d{4}-/.test(ev.at), 'hook script really posts the event: ' + (got[0] ? got[0].body.slice(0, 120) : 'nothing'));
  srv.close();
  const run2 = spawnSync('bash', [f], {input, cwd: dir, env: {...process.env, MAKE_WEBHOOK_URL: 'http://127.0.0.1:1/down'}, timeout: 20000});
  ok(run2.status === 0, 'Make down: the hook still exits 0 and never blocks Claude');
  const run3 = spawnSync('bash', [f], {input, cwd: dir, env: {...process.env, MAKE_WEBHOOK_URL: ''}, timeout: 5000});
  ok(run3.status === 0, 'no webhook configured: the hook does nothing');
  await p.$eval('#mhEvents input[value="SubagentStop"]', e => e.click());
  ok((await json('#mhSettings')).hooks.SubagentStop, 'adding an event updates the settings');

  // generator 2: MCP
  await p.click('[data-tabs="mkgen"] button:nth-child(2)');
  ok(/claude mcp add --transport http --scope local make https:\/\/mcp\.make\.com\/claude/.test(await pre('#mmOut')), 'MCP: OAuth command');
  await p.selectOption('#mmClient', 'cckey'); await p.selectOption('#mmZone', 'eu2.make.com');
  ok(/https:\/\/eu2\.make\.com\/mcp\/v2/.test(await pre('#mmOut')) && /Authorization: Bearer/.test(await pre('#mmOut')), 'MCP: API key in header, per zone');
  await p.selectOption('#mmClient', 'ai');
  ok(/Connectors/.test(await pre('#mmOut')), 'MCP: claude.ai steps');

  // generator 3: run scenario
  await p.click('[data-tabs="mkgen"] button:nth-child(3)');
  ok(/https:\/\/eu1\.make\.com\/api\/v2\/scenarios\/123456\/run/.test(await pre('#mrCurl')) && /Authorization: Token/.test(await pre('#mrCurl')), 'run: curl with zone, id and Token auth');
  const body = (await pre('#mrCurl')).match(/-d '(.*)'$/s)[1];
  ok(JSON.parse(body).responsive === true && JSON.parse(body).data.plan === 'pro', 'run: body is valid JSON with inputs');
  await p.fill('#mrData', 'not json'); ok(/JSON/.test(await p.$eval('#mrErr', e => e.textContent)), 'run: invalid inputs are reported');
  await p.fill('#mrData', '{"name": "O\'Brien"}');
  const quoted = (await pre('#mrCurl'));
  fs.writeFileSync(path.join(dir, 'q.sh'), 'printf "%s" ' + quoted.match(/-d ('.*')$/s)[1]);
  ok(JSON.parse(execFileSync('bash', [path.join(dir, 'q.sh')]).toString()).data.name === "O'Brien", 'run: single quotes are escaped safely for the shell');
  await p.fill('#mrId', 'abc'); ok(/מספר/.test(await p.$eval('#mrErr', e => e.textContent)), 'run: non-numeric id is reported');
  ok(/argument-hint/.test(await pre('#mrCmd')) && /\$0/.test(await pre('#mrCmd')), 'run: Claude Code command uses $0/$1 arguments');

  // generator 4: academy server
  await p.click('[data-tabs="mkgen"] button:nth-child(4)');
  const env1 = await pre('#msEnv');
  ok(/WEBHOOK_SECRET=[0-9a-f]{48}/.test(env1) && /INTEGRATION_TOKEN=[0-9a-f]{48}/.test(env1) && /WEBHOOK_INCLUDE_PII=false/.test(env1), 'server: strong random secrets, PII off by default');
  await p.click('#msGen'); ok((await pre('#msEnv')) !== env1, 'server: new secrets on demand');
  ok((await json('#msEvent')).type === 'certificate.issued', 'server: sample event is valid JSON');
  // the quiz completes the chapter
  await p.evaluate(() => { const qz = document.querySelector('#make .quiz'); const Q = window.__Q.make; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); });
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.make), 'quiz completes the chapter');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
