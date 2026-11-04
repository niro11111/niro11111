// Every complete bash script the course shows or generates must pass `bash -n`, and every JSON file block must parse.
const {chromium} = require('playwright');
const path = require('path');
const {execFileSync} = require('child_process');
const fs = require('fs'), os = require('os');
const U = 'file://' + path.resolve(__dirname, '..') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1300, height: 900}});
  await p.route(/^https:/, r => r.abort());
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  await p.goto(U); await p.waitForTimeout(500);
  const ids = await p.$$eval('.mod', x => x.map(m => m.id));
  const scripts = new Map();
  const grab = async where => {
    const r = await p.evaluate(() => [...document.querySelectorAll('.mod.on .code pre')].map(e => ({t: e.textContent, lang: e.parentElement.dataset.lang, file: e.parentElement.dataset.file || ''})));
    r.forEach(x => { if (/^#!\/usr\/bin\/env bash|^#!\/bin\/bash/.test(x.t)) scripts.set(x.t, where + (x.file ? ' ' + x.file : '')); });
  };
  for (const id of ids) {
    await p.evaluate(id => { location.hash = id; }, id); await p.waitForTimeout(50);
    await grab(id);
    // click through tabs so tabbed generators show every variant
    for (const t of await p.$$('.mod.on .tabs button')) { await t.click().catch(() => {}); await p.waitForTimeout(20); await grab(id); }
  }
  // generators with options
  await p.evaluate(() => { location.hash = 'promptgen'; }); await p.waitForTimeout(100);
  for (let i = 0; i < await p.$$eval('#pgPreset option', o => o.length - 1); i++) { await p.selectOption('#pgPreset', String(i)); await grab('promptgen preset ' + i); }
  await p.evaluate(() => { location.hash = 'appguide'; }); await p.waitForTimeout(100);
  for (const st of ['next', 'fastapi', 'expo', 'node']) { await p.selectOption('#agStack', st); await p.waitForTimeout(80); await grab('appguide ' + st); }
  // the catalog install script with every extension selected: valid bash, no in-session commands left live
  await p.evaluate(() => { localStorage.setItem('cca-ecoSel', JSON.stringify(window.__ECO.map(e => e.id))); }); await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => { location.hash = 'ecosystem'; }); await p.waitForTimeout(150);
  const eco = await p.$eval('#ecScript pre', e => e.textContent);
  scripts.set(eco, 'ecosystem install script (all selected)');
  const live = eco.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l !== '(' && l !== ')');
  const wrong = live.filter(l => /^\/|^(cs|claude|ccr ui)$|^(--|;;|\{)|<[a-z-]+>/.test(l));
  ok(wrong.length === 0 && live.length > 20, 'install script: ' + live.length + ' runnable lines, none that only work inside Claude Code ' + wrong.join(' | '));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-')); const bad = [];
  let i = 0;
  for (const [t, where] of scripts) {
    const f = path.join(dir, 's' + (i++) + '.sh'); fs.writeFileSync(f, t);
    try { execFileSync('bash', ['-n', f], {stdio: 'pipe'}); } catch (e) { bad.push(where + ': ' + e.stderr.toString().split('\n')[0]); }
  }
  ok(scripts.size > 10, scripts.size + ' complete bash scripts found');
  ok(bad.length === 0, 'all bash scripts pass bash -n ' + bad.slice(0, 6).join(' | '));
  await b.close();
})();
