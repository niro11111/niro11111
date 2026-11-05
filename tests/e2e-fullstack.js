// Full stack: the real server (temp database) serving the built site, two browsers as two devices,
// accounts, sync between devices, shared-computer privacy, certificate verification, CSP with no violations.
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const {spawn} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-fs-'));
  const PORT = 18000 + Math.floor(Math.random() * 2000), BASE = 'http://127.0.0.1:' + PORT;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/src/server.js')], {env: {...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATABASE_PATH: path.join(dir, 'a.db'), SITE_DIR: path.join(ROOT, 'site'), LOG_LEVEL: 'warn', NODE_ENV: 'development', ADMIN_EMAILS: 'boss@example.com'}, stdio: ['ignore', 'pipe', 'pipe']});
  let srvLog = ''; srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/readyz')).ok) break; } catch (e) {} await sleep(100); }
  const b = await chromium.launch();
  const errs = [], csp = [];
  const device = async () => {
    const c = await b.newContext({viewport: {width: 1300, height: 900}, acceptDownloads: true}); const p = await c.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 160)); });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.goto(BASE + '/'); await p.waitForSelector('#acctBtn', {timeout: 5000}).catch(() => {});
    return p;
  };
  try {
    const r = await fetch(BASE + '/');
    ok(r.ok && /script-src 'self' 'sha256-/.test(r.headers.get('content-security-policy')), 'server serves the app with a hash-based CSP');
    const A = await device();
    ok(await A.isVisible('#acctBtn'), 'app detects its server and shows the account button');
    ok(/התחברו/.test(await A.$eval('#syncStatus', e => e.textContent)), 'not logged in: local only');
    // progress before signing up moves into the new account
    await A.evaluate(() => { location.hash = 'install'; }); await A.waitForTimeout(150);
    await A.evaluate(() => { const qz = document.querySelector('.mod.on .quiz'); const Q = window.__Q[qz.dataset.q]; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); });
    await A.click('#acctBtn');
    await A.click('#acTabs [data-m="register"]');
    await A.fill('#acName', 'דנה'); await A.fill('#acEmail', 'dana@example.com'); await A.fill('#acPass', 'short');
    await A.click('#acSubmit'); await A.waitForTimeout(300);
    ok(/10 תווים/.test(await A.$eval('#acErr', e => e.textContent)), 'weak password is refused with a clear message');
    await A.fill('#acPass', 'correct horse battery'); await A.click('#acSubmit'); await A.waitForTimeout(1200);
    ok(/dana@example\.com/.test(await A.$eval('#syncStatus', e => e.textContent)), 'registered and syncing: ' + await A.$eval('#syncStatus', e => e.textContent));
    await A.keyboard.press('Escape');
    // a second device sees it
    const B = await device();
    await B.click('#acctBtn'); await B.fill('#acEmail', 'dana@example.com'); await B.fill('#acPass', 'wrong password!'); await B.click('#acSubmit'); await B.waitForTimeout(500);
    ok(/שגויים/.test(await B.$eval('#acErr', e => e.textContent)), 'wrong password message');
    await B.fill('#acPass', 'correct horse battery'); await B.click('#acSubmit'); await B.waitForTimeout(1200);
    ok(await B.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.install), 'device B got device A\'s progress');
    // B makes progress, A pulls it when it comes back to the tab
    await B.keyboard.press('Escape');
    await B.evaluate(() => { location.hash = 'ui'; }); await B.waitForTimeout(150);
    await B.evaluate(() => { const qz = document.querySelector('.mod.on .quiz'); const Q = window.__Q[qz.dataset.q]; qz.querySelectorAll('.q').forEach(q => q.querySelectorAll('input')[Q[+q.dataset.i][2]].click()); });
    await B.waitForTimeout(2500);
    await A.evaluate(() => { Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); }); await A.waitForTimeout(1200);
    ok(await A.evaluate(() => !!JSON.parse(localStorage.getItem('cca-state')).done.ui), 'device A pulled device B\'s new progress');
    // both devices change something at the same moment: nothing is lost (409 + merge)
    await A.evaluate(() => { const s = JSON.parse(localStorage.getItem('cca-state')); s.awarded['sameA'] = 3; localStorage.setItem('cca-state', JSON.stringify(s)); });
    await B.evaluate(() => { const s = JSON.parse(localStorage.getItem('cca-state')); s.awarded['sameB'] = 4; localStorage.setItem('cca-state', JSON.stringify(s)); });
    await A.evaluate(() => document.querySelector('#acctBtn').click()); await A.click('#acSyncNow'); await A.waitForTimeout(400);
    await B.evaluate(() => document.querySelector('#acctBtn').click()); await B.click('#acSyncNow'); await B.waitForTimeout(600);
    const server = await (await fetch(BASE + '/api/progress', {headers: {cookie: (await B.context().cookies()).map(c => c.name + '=' + c.value).join('; ')}})).json();
    const aw = JSON.parse(JSON.parse(server.data).state ? server.data : '{}').state.awarded;
    ok(aw.sameA === 3 && aw.sameB === 4, 'simultaneous changes on two devices are both kept');
    // certificate: finish the exam on A, issue and verify
    await A.keyboard.press('Escape');
    await A.evaluate(() => { const s = JSON.parse(localStorage.getItem('cca-state')); s.done.exam = 1; localStorage.setItem('cca-state', JSON.stringify(s)); });
    await A.evaluate(() => { location.hash = 'exam'; }); await A.waitForTimeout(150);
    await A.evaluate(() => { showCertForTest(); }).catch(async () => {
      await A.click('#examStart');
      await A.evaluate(() => { const all = Object.values(window.__Q).flat(); document.querySelectorAll('#examBox .q').forEach(q => { const t = q.querySelector('b').textContent.replace(/^\d+\.\s/, ''); const x = all.find(z => z[0] === t); q.querySelectorAll('input')[x[2]].click(); }); });
      await A.click('#examSubmit');
    });
    await A.waitForSelector('#certIssue', {timeout: 3000}).catch(() => {});
    await A.click('#certIssue'); await A.waitForTimeout(1200);
    const link = await A.$eval('#certLink a', a => a.getAttribute('href')).catch(() => '');
    ok(/^\/verify\/[A-Za-z0-9]{12}$/.test(link), 'certificate issued with a verification link ' + link);
    const V = await A.context().newPage(); await V.goto(BASE + link);
    ok(/תעודה מאומתת/.test(await V.textContent('body')) && /דנה/.test(await V.textContent('body')), 'public verification page confirms the certificate');
    await V.close();
    // export my data
    await A.click('#acctBtn');
    const [dl] = await Promise.all([A.waitForEvent('download', {timeout: 4000}).catch(() => null), A.click('#acExport')]);
    ok(dl && /my-data\.json$/.test(dl.suggestedFilename()), 'export of all personal data downloads');
    // shared computer: log out, another person signs up in the same browser and gets a clean start
    await A.click('#acOut'); await A.waitForTimeout(800);
    ok(await A.evaluate(() => { const s = JSON.parse(localStorage.getItem('cca-state') || '{"done":{}}'); return !s.done.install; }), 'logout clears this browser\'s copy (it is safe in the account)');
    if (await A.isHidden('#acct')) await A.click('#acctBtn');
    await A.click('#acTabs [data-m="register"]');
    await A.fill('#acName', 'יוסי'); await A.fill('#acEmail', 'yossi@example.com'); await A.fill('#acPass', 'another good password'); await A.click('#acSubmit'); await A.waitForTimeout(1200);
    ok(await A.evaluate(() => { const s = JSON.parse(localStorage.getItem('cca-state') || '{"done":{}}'); return !s.done.install && !s.done.exam; }), 'a second account on the same browser does not inherit the first one\'s progress');
    // delete account
    await A.evaluate(() => document.querySelector('#acDel').closest('details').open = true); await A.fill('#acDelPw', 'another good password');
    await A.click('#acDel button[type=submit]'); await A.waitForTimeout(600);
    ok(await A.isVisible('#acForm'), 'account deleted, back to the sign-in form');
    const login = await fetch(BASE + '/api/auth/login', {method: 'POST', headers: {'content-type': 'application/json', 'x-cca': '1'}, body: JSON.stringify({email: 'yossi@example.com', password: 'another good password'})});
    ok(login.status === 401, 'deleted account can no longer sign in');
    // the static site and claude.ai are unaffected: no server → no account button (checked by every other suite on file://)
    ok(csp.length === 0, 'no CSP violations ' + JSON.stringify(csp.slice(0, 3)));
    ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  } finally {
    await b.close(); srv.kill('SIGTERM');
    await new Promise(r => srv.on('exit', r));
    ok(!/"level":50/.test(srvLog), 'server logged no errors');
  }
})();
