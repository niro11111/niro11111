// ML layer, dedicated SQLite database and knowledge graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, ask } from './helpers.js';
import { createServer } from '../server/index.js';
import { MLP, classificationReport, calibration } from '../server/ml/nn.js';
import { featurize, normalizeText } from '../server/ml/features.js';
import { NaiveBayes, holt, madAnomalies, clusterTexts } from '../server/ml/algorithms.js';
import { extractFacts, pagerank } from '../server/knowledge/graph.js';
import { Store } from '../server/lib/store.js';
import { createApp } from '../server/app.js';
import { ModelRouter } from '../server/core/router.js';
import { DemoHomeAdapter } from '../server/home/smarthome.js';

test('neural network: backprop learns XOR; deterministic with a seed; serializes', () => {
  const xor = [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]].map(([a, b, y]) => ({ x: [a, b], y }));
  const data = Array.from({ length: 40 }, () => xor).flat();
  const m = new MLP([2, 8, 2], { seed: 3 });
  m.fit(data, { epochs: 200, lr: 0.02, dropout: 0, valSplit: 0, patience: 200 });
  for (const e of xor) assert.equal(m.predict(e.x).indexOf(Math.max(...m.predict(e.x))), e.y);
  const copy = MLP.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.ok(Math.abs(copy.predict([1, 0])[1] - m.predict([1, 0])[1]) < 1e-3);
  const a = new MLP([2, 4, 2], { seed: 9 }); const b = new MLP([2, 4, 2], { seed: 9 });
  assert.deepEqual(Array.from(a.W[0]), Array.from(b.W[0]));
  const rep = classificationReport([0, 1, 1, 0], [0, 1, 0, 0], ['a', 'b']);
  assert.equal(rep.accuracy, 0.75); assert.deepEqual(rep.confusion, [[2, 0], [1, 1]]);
  assert.ok(calibration([0.9, 0.8, 0.6], [true, true, false]).ece >= 0);
});

test('features: Hebrew normalization (final letters, niqqud, prefixes), hashing, L2 norm', () => {
  assert.equal(normalizeText('שָׁלוֹם ג׳ארוויס'), normalizeText('שלומ ג׳ארוויס'));
  const f = featurize('מה המשימות שלי', 1024);
  assert.ok(f.idx.length > 5 && f.idx.every((i) => i < 1024));
  assert.ok(Math.abs(Math.sqrt(f.val.reduce((a, v) => a + v * v, 0)) - 1) < 1e-6);
});

test('intent network: trains on device, held-out metrics, routes paraphrases, refuses open questions', async () => {
  const s = await app();
  const m = await s.ml.trainIntent('user');
  assert.equal(m.status, 'challenger'); assert.equal(m.algorithm, 'neural network (MLP)');
  assert.ok(m.metrics.testAccuracy > 0.5 && m.metrics.macroF1 > 0.4, JSON.stringify(m.metrics));
  assert.ok(m.metrics.confusion.length === m.labels.length && m.history.length > 3);
  assert.ok(s.ml.intact(s.ml.get(m.id)));
  assert.ok(!JSON.stringify(m.weights).includes('bills')); // no raw vocabulary in the weights
  const p = s.ml.predict('what bills do I have to pay this week', { modelId: m.id });
  assert.equal(p.top[0].label, 'wealth.bills'); assert.equal(p.decision.route, true);
  const q = s.ml.predict('who was napoleon', { modelId: m.id });
  assert.equal(q.decision.route, false);
  // tampering with stored weights is detected
  const rec = s.store.get('ml_models', m.id); rec.weights.b[0][0] += 1; s.ml.cache.clear();
  assert.equal(s.ml.intact(rec), false);
  assert.throws(() => s.ml.predict('x', { modelId: m.id }), /integrity/);
});

test('neural routing goes through the self-improvement pipeline: sandbox → approval → deploy → rollback', async () => {
  const s = await app();
  const phrase = 'what bills do I have to pay this week';
  assert.equal((await ask(s, phrase, { conversationId: 'a' })).state, 'FAILED');
  const m = await s.ml.trainIntent('user');
  // not active until deployed
  assert.equal((await ask(s, phrase, { conversationId: 'b' })).state, 'FAILED');
  const sg = s.learn.suggestions({ all: true }).find((x) => x.kind === 'ml');
  assert.ok(sg, 'suggests testing the new model');
  const prop = s.learn.proposeMlRouting(m.id);
  assert.throws(() => s.learn.createProposal({ target: 'ml.routing', candidate: { enabled: true, modelId: m.id, threshold: 0.2, margin: 0.5 } }), /threshold/);
  const exp = await s.learn.experiment(prop.id);
  assert.equal(exp.verdict, 'pass', JSON.stringify(exp.reasons));
  assert.ok(exp.report.improvements.some((x) => x.startsWith('replay:')));
  assert.deepEqual(exp.report.regressions, []);
  s.learn.approveAndDeploy(prop.id, 'user');
  const t = await ask(s, phrase, { conversationId: 'c' });
  assert.equal(t.state, 'COMPLETED'); assert.deepEqual(t.plan.tools, ['wealth.bills']);
  assert.equal(t.ml.route, true); assert.ok(t.ml.prob >= 0.85);
  const open = await ask(s, 'who was napoleon', { conversationId: 'd' });
  assert.deepEqual(open.plan?.tools ?? ['llm.answer'], ['llm.answer']);
  s.learn.rollback({ target: 'ml.routing' }, 'user');
  assert.equal((await ask(s, phrase, { conversationId: 'e' })).state, 'FAILED');
});

test('champion/challenger: only the owner promotes, never a worse model', async () => {
  const s = await app();
  const a = await s.ml.trainIntent('user');
  assert.throws(() => s.ml.promote(a.id, 'learning-engine'), /only the owner/);
  s.ml.promote(a.id, 'user');
  assert.equal(s.ml.champion('intent-router').id, a.id);
  const worse = s.ml.register({ name: 'intent-router', algorithm: 'x', labels: [], weights: { sizes: [1, 1], W: [[0]], b: [[0]] }, metrics: { macroF1: 0.01, testAccuracy: 0.01 } });
  assert.throws(() => s.ml.promote(worse.id, 'user'), /worse than the champion/);
});

test('Naive Bayes categorizer: suggestions only, with thresholds; Holt forecast; MAD anomalies', async () => {
  const nb = new NaiveBayes().fit([{ tokens: ['pizza'], label: 'food' }, { tokens: ['pizza', 'hut'], label: 'food' }, { tokens: ['fuel'], label: 'car' }]);
  assert.equal(nb.predict(['pizza'])[0].label, 'food');
  const s = await app();
  const ins = (description, category, amount = -4500, date = '2026-10-10') => s.store.insert('transactions', { householdId: s.householdId, date, description, category, amount, source: 'manual' });
  for (let i = 0; i < 4; i++) ins(`Paz fuel station ${i}`, 'transport', -25000);
  const o = ins('Paz fuel station north', 'other', -26000);
  const m = s.ml.trainCategorizer('user');
  assert.ok(m.metrics.looAccuracy > 0.5);
  const sg = s.ml.categorySuggestions().suggestions.find((x) => x.transactionId === o.id);
  assert.equal(sg.category, 'transport'); assert.ok(sg.prob >= 0.8);
  assert.equal(s.store.get('transactions', o.id).category, 'other'); // untouched until approved
  assert.throws(() => s.ml.applyCategory(o.id, 'learning-engine'), /only the owner/);
  s.ml.applyCategory(o.id, 'user');
  assert.equal(s.store.get('transactions', o.id).category, 'transport');
  assert.equal(s.store.get('transactions', o.id).amount, -26000);

  const h = holt([100, 110, 120, 130, 140, 150], { horizon: 2 });
  assert.equal(h.status, 'ok'); assert.ok(Math.abs(h.forecast[0].value - 160) <= 5); assert.ok(h.forecast[1].high >= h.forecast[1].value);
  assert.equal(holt([1, 2]).status, 'insufficient-data');
  const f = s.ml.forecast();
  assert.ok(f.total.status === 'ok' || f.total.status === 'insufficient-data');
  const an = madAnomalies([10, 11, 9, 10, 12, 10, 95].map((v) => ({ value: v })));
  assert.equal(an.anomalies[0].item.value, 95);
  assert.ok(Array.isArray(s.ml.anomalies().anomalies));
});

test('k-means++ clustering groups similar requests (k by silhouette)', () => {
  const texts = ['book a flight to paris', 'flight tickets to london', 'cheap flights to rome', 'translate this to french', 'translate to spanish please', 'translate the email to german'];
  const r = clusterTexts(texts, { maxK: 4 });
  assert.ok(r.k >= 2);
  const flights = r.clusters.find((c) => c.members.includes('book a flight to paris'));
  assert.ok(flights.members.includes('cheap flights to rome') && !flights.members.includes('translate to spanish please'));
});

test('knowledge graph: extraction (he/en), PageRank, about with sources, relationship paths, routing only for known entities', async () => {
  const f = extractFacts('my wife Dana works at Acme. Dana lives in Haifa.');
  assert.ok(f.relations.some((r) => r.rel === 'wife' && r.to === 'person:dana'));
  assert.ok(f.relations.some((r) => r.rel === 'works_at' && r.to === 'org:acme'));
  assert.ok(extractFacts('אחי יואב עובד באינטל').relations.some((r) => r.rel === 'brother'));
  const pr = pagerank(['a', 'b', 'c'], [{ from: 'a', to: 'b', weight: 1 }, { from: 'c', to: 'b', weight: 1 }]);
  assert.ok(pr.get('b') > pr.get('a'));
  const s = await app();
  await ask(s, 'remember that my wife Dana works at Acme');
  await ask(s, 'remember that Dana lives in Haifa');
  s.memory.add({ content: 'my accountant Ron works at Acme', type: 'person', provenance: 'user_statement', domain: 'financial' });
  const st = s.kg.rebuild();
  assert.ok(st.nodes >= 3 && st.edges >= 3);
  assert.equal(s.kg.find('Ron'), null); // financial-domain memory not used
  const who = await ask(s, 'who is Dana?');
  assert.deepEqual(who.plan.tools, ['knowledge.graph']); assert.match(who.response, /wife.*Dana|works_at/s); assert.match(who.response, /memo_/);
  const rel = await ask(s, 'how is Dana related to Haifa?');
  assert.match(rel.response, /lives_in/);
  assert.equal(s.kg.path('You', 'Acme').found, true);
  const other = await ask(s, 'who is Napoleon?');
  assert.notDeepEqual(other.plan?.tools, ['knowledge.graph']);
});

test('code-assisted computation runs isolated and blocks unsafe code', async () => {
  const s = await app();
  const ok = await ask(s, 'run code: [5,3,9].reduce((a,b)=>a+b,0) / 3');
  assert.equal(ok.state, 'COMPLETED'); assert.match(ok.response, /= 5.66/);
  const bad = await ask(s, 'run code: require("fs").readdirSync("/")');
  assert.equal(bad.state, 'FAILED'); assert.match(bad.response, /static analysis/); assert.equal(bad.failure.kind, 'policy');
  const hang = await ask(s, 'חשב בקוד: function run(){ let x=0; for(let i=0;i<1e12;i++) x+=i; return x }');
  assert.equal(hang.state, 'FAILED'); assert.match(hang.response, /timed out/);
});

test('dedicated SQLite database: row-level persistence, restart, views, read-only SQL console, backup, integrity', async () => {
  const { openDatabase } = await import('../server/db/sqlite.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-db-'));
  const file = path.join(dir, 'j.db');
  const legacy = path.join(dir, 'old.json');
  fs.writeFileSync(legacy, JSON.stringify({ notes: [{ id: 'note_legacy', text: 'from json', createdAt: '2026-01-01T00:00:00Z' }], _meta: { personality: { verbosity: 'short' } } }));
  const mk = async () => { const { backend, data, imported } = openDatabase(file, { legacyJson: legacy }); const store = new Store(null, { data, onSave: (d) => backend.schedule(d) }); backend.attach(store); const s = await createApp({ store, router: new ModelRouter(), home: new DemoHomeAdapter() }); s.db = backend; return { s, backend, imported }; };
  const a = await mk();
  assert.equal(a.imported, 2); // one record + one meta key
  await ask(a.s, 'add task persisted in sqlite');
  a.backend.flush(new Set(Object.keys(a.s.store.data)));
  const q = a.backend.query("SELECT title FROM v_tasks WHERE title LIKE '%sqlite%'");
  assert.deepEqual(q.rows, [{ title: 'persisted in sqlite' }]);
  assert.throws(() => a.backend.query('DELETE FROM records'), /only a single SELECT/);
  assert.throws(() => a.backend.query('SELECT 1; DROP TABLE records'), /single SELECT/);
  const st = a.backend.status();
  assert.equal(st.engine, 'SQLite'); assert.equal(st.journal, 'wal'); assert.ok(st.views.includes('v_transactions') && st.rows > 10);
  assert.equal(a.backend.integrity().result, 'ok');
  const bk = a.backend.backup(); assert.ok(bk.sizeBytes > 0);
  const before = a.backend.rowsWritten;
  a.s.store.update('tasks', a.s.productivity.listTasks().find((t) => t.title === 'persisted in sqlite').id, { priority: 'high' });
  assert.equal(a.backend.flush(new Set(['tasks'])), 1); // only the changed row is written
  assert.equal(a.backend.rowsWritten, before + 1);
  a.backend.close();
  const b = await mk();
  assert.equal(b.imported, 0);
  assert.equal(b.s.productivity.listTasks().find((t) => t.title === 'persisted in sqlite').priority, 'high');
  assert.equal(b.s.store.get('notes', 'note_legacy').text, 'from json');
  assert.equal(b.s.personality.get().verbosity, 'short');
  const srv = createServer(b.s, 'owner');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, o = {}) => { const res = await fetch(base + p, { ...o, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) }); return { status: res.status, body: await res.json() }; };
  try {
    assert.equal((await call('/api/db/status')).body.engine, 'SQLite');
    assert.equal((await call('/api/db/query', { method: 'POST', body: { sql: 'SELECT COUNT(*) n FROM v_transactions' } })).body.rows[0].n > 0, true);
    assert.equal((await call('/api/db/query', { method: 'POST', body: { sql: 'UPDATE records SET data = 1' } })).status, 400);
    assert.equal((await call('/api/ml/status')).status, 200);
    assert.equal((await call('/api/knowledge/graph')).status, 200);
  } finally { srv.close(); b.backend.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
