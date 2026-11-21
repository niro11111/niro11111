// Digital World Engine: vertical slice, honest statuses, failures, permissions, isolation.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { app, ask } from './helpers.js';
import { createServer } from '../server/index.js';
import { WorldRunner } from '../server/worlds/runner.js';
import { understand, architect } from '../server/worlds/spec.js';
import { generateProject } from '../server/worlds/generator.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-worlds-'));
const runners = [];
async function withRunner() { const s = await app(); s.worldRunner = new WorldRunner({ root: path.join(ROOT, String(runners.length)) }); runners.push(s.worldRunner); return s; }
after(() => { for (const r of runners) r.stopAll(); fs.rmSync(ROOT, { recursive: true, force: true }); });

test('understand: templates, explicit entities (he/en), names, and a question instead of guessing', () => {
  const crm = understand('Build me a CRM system for my company called Acme Solar');
  assert.equal(crm.type, 'crm'); assert.equal(crm.title, 'Acme Solar');
  assert.ok(crm.assumptions.some((a) => /template/.test(a)));
  const custom = understand('build a system with customers (name, phone, email) and orders (customer, total, date)');
  assert.deepEqual(custom.entities.map((e) => e.name), ['customers', 'orders']);
  assert.deepEqual(custom.entities[0].fields.map((f) => f.type), ['string', 'phone', 'email']);
  assert.equal(custom.entities[1].fields.find((f) => f.name === 'total').type, 'money');
  const he = understand('תבנה לי מערכת תורים לעסק בשם מספרת דנה');
  assert.equal(he.type, 'booking'); assert.equal(he.title, 'מספרת דנה'); assert.equal(he.lang, 'he');
  const vague = understand('build something');
  assert.equal(vague.status, 'needs-input'); assert.ok(vague.question);
  const stripe = understand('build an online store that takes payments with Stripe');
  assert.deepEqual(stripe.integrations, ['stripe']); assert.ok(stripe.openQuestions[0].includes('no fake credentials'));
  const a = architect(crm);
  assert.ok(a.api.length >= 17 && a.database.length === 3 && a.security.length >= 5 && a.testing.length === 3);
});

test('generator is deterministic and keeps secrets out of the code', () => {
  const spec = understand('Create an online store named Green Leaf');
  const a = generateProject(spec); const b = generateProject(spec);
  assert.deepEqual(a.files, b.files);
  for (const p of ['package.json', 'schema.json', 'server.js', 'public/index.html', 'public/app.js', 'public/styles.css', 'tests/api.test.js', 'Dockerfile', '.env.example', 'README.md']) assert.ok(a.files[p], p);
  assert.ok(!/APP_TOKEN\s*=\s*\S{6,}/.test(a.files['.env.example']));
  assert.ok(!/innerHTML/.test(a.files['public/app.js']));
});

test('VERTICAL SLICE: chat request → spec → mission → Builder agent → code → real build → real tests → live verification → artifact → dashboard', async () => {
  const s = await withRunner();
  const t = await ask(s, 'Build me a CRM system for my company called Acme Solar');
  assert.equal(t.state, 'COMPLETED'); assert.deepEqual(t.plan.tools, ['world.create']);
  const id = s.store.all('worlds')[0].id;
  const { world, mission } = await s.worlds.pipelines.get(id);
  assert.equal(mission.status, 'completed');
  assert.deepEqual(mission.tasks.map((x) => x.status), ['done', 'done', 'done', 'done', 'done']);
  assert.ok(mission.tasks.every((x) => x.agent === 'builder'));
  assert.equal(world.status, 'verified');
  for (const st of ['understand', 'architect', 'plan', 'build', 'test']) assert.equal(world.stages[st].status, 'VERIFIED', st);
  assert.equal(world.stages.deploy.status, 'PLANNED'); // never claimed without a deployment
  assert.ok(world.features.filter((f) => f.key.startsWith('api:')).every((f) => f.status === 'VERIFIED'));
  assert.equal(world.features.find((f) => f.key === 'docker').status, 'IMPLEMENTED'); // not built → not claimed
  const d = s.worlds.dashboard(id);
  assert.equal(d.testRuns[0].failed, 0); assert.ok(d.testRuns[0].passed >= 14);
  assert.ok(d.verifications[0].checks.every((c) => c.ok));
  assert.match(d.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  // the artifact is a real gzip'd tar that contains the sources
  const file = s.worldRunner.artifactPath(world, d.artifacts[0]);
  const tarBuf = zlib.gunzipSync(fs.readFileSync(file));
  assert.ok(tarBuf.toString('latin1').includes('server.js') && tarBuf.toString('latin1').includes('ustar'));
  // evidence: every mission step recorded a verified tool execution
  assert.equal(s.store.all('tool_executions', (x) => x.missionId === mission.id && x.verified === true).length, 5);

  // local deployment, live monitoring, kill switch
  const dep = await s.worlds.deploy(id, { target: 'local-preview' }, 'user');
  assert.equal(dep.status, 'VERIFIED'); assert.equal(dep.health.ok, true);
  const ui = await fetch(dep.url); assert.equal(ui.status, 200);
  const h = await s.worlds.healthCheck(id); assert.equal(h.status, 'up');
  assert.equal((await s.worlds.deploy(id, { target: 'cloud' }, 'user')).status, 'BLOCKED');
  assert.equal(s.worlds.kill(id, 'user').killed, true);
  assert.equal(s.worldRunner.preview(id), null);
  await assert.rejects(() => s.worlds.runPipeline(id), /kill switch/);
  const down = await s.worlds.healthCheck(id); assert.equal(down.status, 'down');
});

test('failures are reported, never hidden: broken code fails the build; a failing test fails the stage with an incident', async () => {
  const s = await withRunner();
  const w = s.worlds.create({ text: 'build an inventory system' });
  s.worlds.architect(w.id); s.worlds.generate(w.id);
  const srv = s.worlds.files(w.id).find((f) => f.path === 'server.js');
  s.store.update('world_files', srv.id, { content: srv.content.replace('export function validate', 'export function validate((') });
  const b = await s.worlds.build(w.id);
  assert.equal(b.ok, false); assert.equal(s.worlds.get(w.id).stages.build.status, 'FAILED');
  assert.ok(s.store.all('world_incidents', (i) => i.worldId === w.id && i.stage === 'build').length);
  await assert.rejects(() => s.worlds.test(w.id), /build must pass/);

  const w2 = s.worlds.create({ text: 'build an inventory system' });
  s.worlds.generate(w2.id);
  const tf = s.worlds.files(w2.id).find((f) => f.path === 'tests/api.test.js');
  s.store.update('world_files', tf.id, { content: `${tf.content}\ntest('deliberately failing', () => { assert.equal(1, 2); });\n` });
  assert.equal((await s.worlds.build(w2.id)).ok, true);
  const t = await s.worlds.test(w2.id);
  assert.equal(t.ok, false); assert.equal(t.failed, 1);
  const fresh = s.worlds.get(w2.id);
  assert.equal(fresh.stages.test.status, 'FAILED');
  assert.ok(fresh.features.some((f) => f.status === 'FAILED'));
  await assert.rejects(() => s.worlds.verify(w2.id), /tests must pass/);
  await assert.rejects(() => s.worlds.deploy(w2.id, {}, 'user'), /only a verified build/);
});

test('without a runner (browser build) execution stages are BLOCKED with the reason, never faked', async () => {
  const s = await app(); // no worldRunner
  const w = s.worlds.create({ text: 'Create an online store named Green Leaf' });
  const { world, mission } = await s.worlds.runPipeline(w.id);
  assert.notEqual(mission.status, 'completed');
  assert.equal(world.stages.build.status, 'BLOCKED'); assert.match(world.stages.build.detail, /npm start/);
  assert.equal(world.status, 'generated');
  assert.ok(s.worlds.files(w.id).length >= 10); // code generation still works
  assert.ok(!world.features.some((f) => ['TESTED', 'VERIFIED'].includes(f.status)));
  assert.equal((await s.worlds.deploy(w.id, {}, 'user')).status, 'BLOCKED');
  const integ = await s.worlds.integrations();
  assert.equal(integ.find((i) => i.id === 'local-runtime').status, 'BLOCKED');
  assert.ok(integ.filter((i) => ['stripe', 'cloud-hosting'].includes(i.id)).every((i) => i.status === 'BLOCKED'));
});

test('clarification, spec versions, budget, owner-only deployment, path isolation', async () => {
  const s = await withRunner();
  const w = s.worlds.create({ text: 'build something' });
  assert.equal(w.status, 'needs-input');
  assert.throws(() => s.worlds.plan(w.id), /clarification/);
  const c = s.worlds.clarify(w.id, 'a booking system for a barber shop');
  assert.equal(c.type, 'booking');
  const v2 = s.worlds.updateSpec(w.id, { entities: [{ name: 'clients', fields: [{ name: 'name', type: 'string', required: true }, { name: 'phone', type: 'phone' }] }] });
  assert.equal(v2.version, 2);
  assert.equal(s.store.all('world_versions', (x) => x.worldId === w.id).length, 2);
  assert.throws(() => s.worlds.updateSpec(w.id, { entities: [{ name: 'x', fields: [{ name: 'a', type: 'script' }] }] }), /bad field/);
  await assert.rejects(() => s.worlds.deploy(w.id, {}, 'learning-engine'), /only the owner/);
  assert.throws(() => s.worldRunner.materialize({ id: w.id, version: 1 }, [{ path: '../../escape.js', content: 'x' }]), /unsafe path/);
  assert.throws(() => s.worldRunner.dir({ id: '../../etc', version: 1 }), /invalid world id/);
  const fresh = s.worlds.get(w.id); fresh.budget.maxPipelineRunsPerDay = 0; s.worlds.save(fresh);
  await assert.rejects(() => s.worlds.runPipeline(w.id), /budget/);
});

test('API: owner-only writes, dashboard, file access, artifact download, devices refused', async () => {
  const s = await withRunner();
  const srv = createServer(s, 'owner');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, o = {}, tok = 'owner') => { const res = await fetch(base + p, { ...o, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) }); return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer(), headers: res.headers }; };
  try {
    const created = await call('/api/worlds', { method: 'POST', body: { text: 'build an inventory system', run: false } });
    assert.equal(created.status, 200);
    const id = created.body.id;
    const run = await call(`/api/worlds/${id}/run`, { method: 'POST', body: { wait: true } });
    assert.equal(run.body.world.status, 'verified');
    const dash = await call(`/api/worlds/${id}`);
    assert.ok(dash.body.files.length >= 10 && dash.body.testRuns.length === 1 && dash.body.mission.status === 'completed');
    assert.ok(!('content' in dash.body.files[0]));
    const file = await call(`/api/worlds/${id}/file?path=schema.json`);
    assert.equal(JSON.parse(file.body.content).entities.length, 3);
    const art = await call(`/api/worlds/${id}/artifact`);
    assert.equal(art.status, 200); assert.match(art.headers.get('x-artifact-sha256'), /^[a-f0-9]{64}$/);
    assert.ok(zlib.gunzipSync(Buffer.from(art.body)).length > 1000);
    assert.equal((await call(`/api/worlds/${id}/artifact`, {}, 'wrong')).status, 401);
    const { token } = s.devices.register({ name: 'watch', kind: 'watchos' });
    assert.equal((await call('/api/worlds', { method: 'POST', body: { text: 'build a crm' } }, token)).status, 403);
    assert.ok((await call('/api/worlds/integrations')).body.some((i) => i.id === 'local-runtime' && i.status === 'CONNECTED'));
    assert.equal((await call(`/api/worlds/${id}/kill`, { method: 'POST', body: {} })).body.killed, true);
  } finally { srv.close(); }
});
