// Workspace chapter (theme, keybindings, status line, comfort settings, terminal, shortcuts) and the expanded catalog.
const {chromium} = require('playwright');
const path = require('path');
const {execFileSync} = require('child_process');
const fs = require('fs'), os = require('os');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  await p.goto(U); await p.waitForTimeout(500);
  await p.evaluate(() => { location.hash = 'workspace'; }); await p.waitForTimeout(200);
  const json = async id => { try { return JSON.parse(await p.$eval(id + ' pre', e => e.textContent)); } catch (e) { return null; } };

  // theme
  for (const name of await p.$$eval('#wtPreset option', o => o.slice(1).map(x => x.textContent))) {
    await p.selectOption('#wtPreset', {label: name});
    const t = await json('#wtOut');
    ok(t && t.name && t.base && Object.keys(t.overrides).length >= 8 && Object.values(t.overrides).every(v => /^#[0-9a-f]{6}$/i.test(v)), 'theme preset ' + name + ' → ' + (t && t.base) + ', ' + (t ? Object.keys(t.overrides).length : 0) + ' colors');
  }
  ok(/^~\/\.claude\/themes\/[a-z0-9-]+\.json$/.test(await p.$eval('#wtOut', e => e.dataset.file)), 'theme file path ' + await p.$eval('#wtOut', e => e.dataset.file));

  // keybindings
  const kbIn = (i, v) => p.fill(`[data-kb="${i}"]`, v);
  await kbIn(0, 'ctrl+e');
  let k = await json('#kbOut');
  ok(k && k.bindings[0].context === 'Chat' && k.bindings[0].bindings['ctrl+e'] === 'chat:externalEditor', 'new key binds the action');
  ok(/readline/.test(await p.$eval('#kbIssues', e => e.textContent)), 'warns that ctrl+e is a readline key');
  await kbIn(1, 'ctrl+c');
  ok(/שמור/.test(await p.$eval('#kbIssues', e => e.textContent)), 'reserved ctrl+c is rejected');
  await kbIn(1, 'ctrl+k ctrl+s');
  k = await json('#kbOut');
  ok(k.bindings[0].bindings['ctrl+k ctrl+s'] === 'chat:stash', 'chords work');
  await kbIn(2, 'hyper+q');
  ok(/תחביר/.test(await p.$eval('#kbIssues', e => e.textContent)), 'bad modifier is reported');
  await kbIn(2, 'option+m');
  k = await json('#kbOut');
  ok(k.bindings[0].bindings['alt+m'] === 'chat:modelPicker', 'option is normalized to alt');
  await kbIn(3, 'ctrl+e');
  ok(/פעמיים/.test(await p.$eval('#kbIssues', e => e.textContent)), 'duplicate key in the same context is reported');
  await kbIn(3, '');
  await p.check('[data-kboff="1"]');
  k = await json('#kbOut');
  ok(k.bindings[0].bindings['ctrl+s'] === null, 'unbinding writes null');
  await p.click('#kbReset');
  for (const pr of await p.$$eval('#kbPreset option', o => o.slice(1).map(x => x.textContent))) await p.selectOption('#kbPreset', {label: pr});
  k = await json('#kbOut');
  ok(k && k.$schema && k.bindings.length >= 2 && JSON.stringify(k).includes('command:compact'), 'presets combine into a valid file (' + k.bindings.map(x => x.context).join(',') + ')');
  ok(!/✗/.test(await p.$eval('#kbIssues', e => e.textContent)), 'presets have no errors');
  const [d] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#kbDl')]);
  ok(d && d.suggestedFilename() === 'keybindings.json', 'keybindings.json downloads');

  // status line: the generated script really runs
  await p.$$eval('#slbFields input', x => x.forEach(i => { if (!i.checked) i.click(); }));
  const sh = await p.$eval('#slbOut pre', e => e.textContent);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-')); const f = path.join(dir, 's.sh'); fs.writeFileSync(f, sh, {mode: 0o755});
  const sample = JSON.stringify({model: {display_name: 'Opus'}, workspace: {current_dir: dir}, context_window: {used_percentage: 91.2}, cost: {total_cost_usd: 1.5, total_duration_ms: 600000, total_lines_added: 10, total_lines_removed: 2}, rate_limits: {five_hour: {used_percentage: 12}}, effort: {level: 'high'}, output_style: {name: 'Learning'}, vim: {mode: 'INSERT'}, pr: {number: 7}, worktree: {name: 'wt'}});
  let out = ''; try { out = execFileSync('bash', [f], {input: sample}).toString(); } catch (e) { out = 'ERR ' + e.message; }
  ok(/Opus/.test(out) && /91%/.test(out) && /\x1b\[31m/.test(out) && /PR #7/.test(out) && /💲1\.50/.test(out) && /10m/.test(out), 'status line script runs: ' + out.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 120));
  let out2 = ''; try { out2 = execFileSync('bash', [f], {input: JSON.stringify({model: {display_name: 'Haiku'}, workspace: {current_dir: dir}})}).toString(); } catch (e) { out2 = 'ERR ' + e.message; }
  ok(/Haiku/.test(out2) && !/null|ERR/.test(out2), 'status line copes with missing fields: ' + out2.replace(/\x1b\[[0-9;]*m/g, ''));
  await p.fill('#slbPad', '2'); await p.fill('#slbRef', '5');
  const st = await json('#slbSet');
  ok(st.statusLine.padding === 2 && st.statusLine.refreshInterval === 5, 'status line settings include padding and refresh');

  // comfort settings
  await p.selectOption('#cfStyle', 'Explanatory'); await p.selectOption('#cfEditor', 'vim'); await p.check('#cfJj'); await p.check('#cfBang'); await p.check('#cfFull');
  await p.selectOption('#cfAttr', 'off'); await p.fill('#cfAnn', 'hello\nworld');
  const cf = await json('#cfOut');
  ok(cf && cf.language === 'hebrew' && cf.outputStyle === 'Explanatory' && cf.editorMode === 'vim' && cf.vimInsertModeRemaps.jj === '<Esc>' && cf.respondToBashCommands === false && cf.attribution === false && cf.env.CLAUDE_CODE_NO_FLICKER === '1' && cf.companyAnnouncements.length === 2 && cf.preferredNotifChannel === 'terminal_bell', 'comfort settings JSON');
  ok(await p.$$eval('#cfWhy li', x => x.length) === Object.keys(cf).length, 'every setting is explained');
  await p.selectOption('#cfAttr', 'custom');
  ok(await p.isVisible('#cfAttrText') && (await json('#cfOut')).attribution.commit.length > 3, 'custom attribution');

  // terminals and shortcuts
  for (const t of await p.$$('#tmTabs button')) { await t.click(); ok((await p.$eval('#tmBody', e => e.textContent.length)) > 80, 'terminal guide: ' + await t.textContent()); }
  await p.fill('#scQ', 'מודל');
  ok(await p.$$eval('#scRows tr', x => x.length) >= 1, 'shortcut search');
  let right = 0;
  for (let i = 0; i < 8; i++) { await p.evaluate(() => document.querySelectorAll('#scDrill input')[window.__scCur.answer].click()); right++; await p.click('#scNext'); }
  ok(/8\/8/.test(await p.$eval('#scScore', e => e.textContent)), 'shortcut trainer scores');

  // catalog
  await p.evaluate(() => { location.hash = 'ecosystem'; }); await p.waitForTimeout(200);
  const n = await p.$$eval('#ecList .ecCard', x => x.length);
  ok(n >= 38, n + ' extensions in the catalog');
  const deep = await p.$$eval('#ecList .ecDeep', x => x.map(d => d.textContent));
  ok(deep.length === n && deep.every(t => /איך בודקים/.test(t) && /איך מסירים/.test(t) && t.length > 150), 'every extension has a deep explanation, check and removal');
  const ids = await p.evaluate(() => window.__ECO.map(e => e.id));
  ok(new Set(ids).size === ids.length, 'catalog ids are unique');
  const kits = await p.evaluate(() => window.__ECO_KITS.flatMap(k => k[1]).filter(id => !window.__ECO.some(e => e.id === id)));
  ok(kits.length === 0, 'every kit item exists ' + kits.join(','));
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
