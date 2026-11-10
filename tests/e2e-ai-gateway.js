// AI on the academy's own server: the real server with a mock Claude API (same SSE format),
// a real browser, the tutor, AI quiz questions (sample.json) and the code terminal's tool loop.
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const {spawn} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// mock Claude API: answers depend on what was asked
const calls = [];
const sse = (res, events) => { res.writeHead(200, {'content-type': 'text/event-stream'}); for (const e of events) res.write('event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n'); res.end(); };
const start = {type: 'message_start', message: {id: 'msg_1', type: 'message', role: 'assistant', model: 'test-model', content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: 10, output_tokens: 0}}};
const textMsg = t => [start, {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}}, ...t.match(/.{1,12}/gs).map(x => ({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: x}})), {type: 'content_block_stop', index: 0}, {type: 'message_delta', delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 5}}, {type: 'message_stop'}];
const toolMsg = (name, input) => [start, {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}}, {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'קורא קבצים. '}}, {type: 'content_block_stop', index: 0}, {type: 'content_block_start', index: 1, content_block: {type: 'tool_use', id: 'toolu_' + name, name, input: {}}}, {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: JSON.stringify(input)}}, {type: 'content_block_stop', index: 1}, {type: 'message_delta', delta: {stop_reason: 'tool_use', stop_sequence: null}, usage: {output_tokens: 9}}, {type: 'message_stop'}];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b); calls.push(j);
    const last = j.messages[j.messages.length - 1];
    const lastText = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    if (j.tools && j.tools.length) {
      const results = Array.isArray(last.content) ? last.content.filter(x => x.type === 'tool_result') : [];
      if (!results.length) return sse(res, toolMsg('read_file', {path: 'src/server.js', start: 12, end: 14}));
      return sse(res, textMsg('## ריוויו\nקראתי ' + results[0].content.split('\n').length + ' שורות. בשורה 13 יש SQL injection.'));
    }
    if (/JSON/.test(lastText)) return sse(res, textMsg('```json\n[{"q":"מה עושה /compact?","o":["מוחק","מסכם את השיחה","מתקין","יוצא"],"a":1,"why":"מסכם כדי לפנות הקשר"}]\n```'));
    sse(res, textMsg('תשובה מהמורה: Hooks הם סקריפטים שרצים אוטומטית.'));
  });
});

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-ai-'));
  const PORT = 20000 + Math.floor(Math.random() * 2000), BASE = 'http://127.0.0.1:' + PORT;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/src/server.js')], {env: {...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATABASE_PATH: path.join(dir, 'a.db'), SITE_DIR: path.join(ROOT, 'site'), LOG_LEVEL: 'warn', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + mock.address().port, AI_MODEL: 'test-model', AI_DAILY_REQUESTS: '50'}, stdio: ['ignore', 'pipe', 'pipe']});
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/readyz')).ok) break; } catch (e) {} await sleep(100); }
  const b = await chromium.launch();
  const errs = [];
  try {
    const p = await (await b.newContext({viewport: {width: 1300, height: 900}})).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.goto(BASE + '/'); await p.waitForSelector('#acctBtn');
    ok(await p.isHidden('#tutorFab'), 'signed out: the tutor stays hidden');
    await p.click('#acctBtn'); await p.click('#acTabs [data-m="register"]');
    await p.fill('#acEmail', 'ai@example.com'); await p.fill('#acPass', 'correct horse battery'); await p.click('#acSubmit');
    await p.waitForSelector('#tutorFab:not([hidden])', {timeout: 5000}).catch(() => {});
    ok(await p.isVisible('#tutorFab'), 'signed in: the tutor appears (AI through the server)');
    await p.waitForTimeout(500);
    ok(/המורה ה-AI: \d+\/50/.test(await p.$eval('#acAi', e => e.textContent).catch(() => '')), 'account dialog shows today\'s AI usage');
    await p.keyboard.press('Escape');
    // tutor chat, streamed
    await p.click('#tutorFab'); await p.fill('#tutorQ', 'מה זה Hooks?'); await p.click('#tutorSend');
    await p.waitForFunction(() => /Hooks הם סקריפטים/.test(document.querySelector('#tutorLog').textContent), null, {timeout: 5000}).catch(() => {});
    ok(/Hooks הם סקריפטים/.test(await p.$eval('#tutorLog', e => e.textContent)), 'tutor answers through the gateway');
    await p.click('#tutorClose');
    // AI quiz questions (sample.json)
    await p.evaluate(() => { location.hash = 'quizgen'; }); await p.waitForTimeout(200);
    await p.selectOption('#qgSrc', 'ai'); await p.click('#qgGen');
    await p.waitForFunction(() => /compact/.test(document.querySelector('#qgCard').textContent), null, {timeout: 5000}).catch(() => {});
    ok(/מה עושה \/compact/.test(await p.$eval('#qgCard', e => e.textContent)), 'AI quiz questions come back as parsed JSON');
    // code terminal: Claude reads the uploaded files through the page's tools
    await p.evaluate(() => { location.hash = 'codeterm'; }); await p.waitForTimeout(200);
    await p.fill('#ctCmd', 'demo'); await p.press('#ctCmd', 'Enter');
    await p.fill('#ctCmd', 'ai review'); await p.press('#ctCmd', 'Enter');
    await p.waitForFunction(() => /SQL injection/.test(document.querySelector('#ctOut').textContent), null, {timeout: 8000}).catch(() => {});
    const out = await p.$eval('#ctOut', e => e.lastElementChild.textContent);
    ok(/קראתי 3 שורות/.test(out) && /SQL injection/.test(out), 'ai review: tool_use → page reads the file → Claude answers');
    const toolRound = calls.find(c => c.tools && c.messages.some(m => Array.isArray(m.content) && m.content.some(x => x.type === 'tool_result')));
    ok(toolRound && toolRound.messages.find(m => m.role === 'assistant').content.some(x => x.type === 'tool_use'), 'assistant content blocks are sent back unchanged with the tool results');
    ok(/SELECT \* FROM todos/.test(JSON.stringify(toolRound)), 'the tool result carries the real file content');
    // sign out: AI goes away again
    await p.click('#acctBtn'); await p.click('#acOut'); await p.waitForTimeout(600);
    ok(await p.isHidden('#tutorFab'), 'signed out: the tutor is hidden again');
    ok(calls.every(c => c.model === 'test-model' && c.max_tokens <= 8000), 'every call uses the configured model and token cap');
    ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  } finally {
    await b.close(); srv.kill('SIGTERM'); mock.close();
    await new Promise(r => srv.on('exit', r));
    ok(!/"level":50/.test(log), 'server logged no errors');
  }
})();
