// The complete guide and the professional prompt generator: every stage, stack, target and preset.
const {chromium} = require('playwright');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}, acceptDownloads: true});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  await p.goto(U); await p.waitForTimeout(500);
  await p.evaluate(() => { location.hash = 'appguide'; }); await p.waitForTimeout(200);
  ok(await p.$$eval('#agStages details', d => d.length) === 16, '16 stages rendered');
  for (const st of ['next', 'fastapi', 'expo', 'node']) {
    await p.selectOption('#agStack', st); await p.waitForTimeout(80);
    const left = await p.$eval('#agStages', e => (e.textContent.match(/\{[a-zA-Z]+\}/g) || []));
    ok(left.length === 0, 'stack ' + st + ': no unfilled placeholders ' + left.slice(0, 3).join(','));
    const json = await p.$$eval('#agStages .code[data-lang="json"] pre', x => x.map(e => { try { JSON.parse(e.textContent); return 1; } catch (er) { return 0; } }));
    ok(json.length > 0 && json.every(Boolean), 'stack ' + st + ': ' + json.length + ' JSON files parse');
  }
  await p.click('#agOpenAll');
  const boxes = await p.$$('#agStages input[data-agc]');
  for (const c of boxes) await c.check();
  ok((await p.$eval('#agStat', e => e.textContent)).startsWith('16/16'), 'all stages complete: ' + await p.$eval('#agStat', e => e.textContent));
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).awarded['ag-all']), 'completion award given');
  ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cca-ag')).checks).length) === boxes.length, 'progress saved');
  await p.reload(); await p.waitForTimeout(400);
  ok((await p.$eval('#agStat', e => e.textContent)).startsWith('16/16'), 'progress survives reload');
  const [dl] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#agExport')]);
  ok(dl && dl.suggestedFilename() === 'GUIDE.md', 'GUIDE.md downloads');

  // prompt generator
  await p.evaluate(() => { location.hash = 'promptgen'; }); await p.waitForTimeout(200);
  const presets = await p.$$eval('#pgPreset option', o => o.length - 1);
  for (let i = 0; i < presets; i++) {
    await p.selectOption('#pgPreset', String(i)); await p.waitForTimeout(60);
    const r = await p.evaluate(() => ({t: document.querySelector('#pgTarget').value, out: document.querySelector('#pgOut pre').textContent, score: +document.querySelector('#pgScoreNum').textContent, file: document.querySelector('#pgOut').dataset.file}));
    let valid = r.out.length > 80 && !/undefined|\[object/.test(r.out);
    if (['agent', 'skill', 'command'].includes(r.t)) valid = valid && /^---\n(?:[^\n]*\n)*?description: [^\n]+\n(?:[^\n]*\n)*?---\n/.test(r.out);
    if (r.t === 'headless') { const m = r.out.match(/--json-schema '([^']+)'/); try { JSON.parse(m[1]); } catch (e) { valid = false; } valid = valid && /structured_output/.test(r.out); }
    if (r.t === 'command') valid = valid && /\$ARGUMENTS/.test(r.out);
    ok(valid && r.score >= 60, 'preset ' + i + ' (' + r.t + ' → ' + r.file + ') valid, score ' + r.score);
  }
  const targets = await p.$$eval('#pgTarget option', o => o.map(x => x.value));
  for (const t of targets) {
    await p.selectOption('#pgTarget', t); await p.click('#pgClear'); await p.waitForTimeout(40);
    const low = +await p.$eval('#pgScoreNum', e => e.textContent);
    await p.selectOption('#pgPreset', String(await p.evaluate(t => window.__pg.presets.findIndex(x => x.target === t), t)));
    const hi = +await p.$eval('#pgScoreNum', e => e.textContent);
    ok(hi > low, 'target ' + t + ': empty scores ' + low + ', preset scores ' + hi);
  }
  await p.click('#pgSave'); await p.selectOption('#pgPreset', '3'); await p.click('#pgSave');
  ok(await p.$$eval('#pgLib li', l => l.length) === 2, 'library saves 2 prompts');
  await p.click('[data-pgl="1"]');
  ok(await p.$eval('#pgTarget', e => e.value) === 'memory', 'library loads a saved prompt');
  await p.click('[data-pgd="0"]');
  ok(await p.$$eval('#pgLib li', l => l.length) === 1, 'library deletes');
  const [d2] = await Promise.all([p.waitForEvent('download', {timeout: 3000}).catch(() => null), p.click('#pgDl')]);
  ok(d2 && d2.suggestedFilename() === 'CLAUDE.md', 'prompt file downloads (' + (d2 && d2.suggestedFilename()) + ')');
  await p.click('#pgToLab'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => location.hash === '#promptlab' && document.querySelector('#plIn').value.length > 50), 'sent to prompt lab');
  const secrets = await p.evaluate(() => document.querySelector('#secCount') && document.querySelector('#secCount').textContent);
  ok(/\/48/.test(secrets), 'secrets total: ' + secrets);
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
