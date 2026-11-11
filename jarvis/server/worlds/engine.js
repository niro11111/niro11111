// JARVIS Digital World Engine: idea → specification → architecture → mission (agents) → code
// → build → tests → verification → artifact → local deployment → monitoring.
//
// Honesty rules enforced here:
//   * Every feature carries ONE status from STATUSES, set only from real results.
//   * A stage that cannot run in this environment is BLOCKED with the exact reason - never "done".
//   * Success messages come from execution results (exit codes, HTTP checks), never from intent.
//   * No fake credentials, users, metrics or deployments: integrations without credentials are BLOCKED.
import { now } from '../lib/store.js';
import { understand, architect } from './spec.js';
import { generateProject } from './generator.js';
import { sign, digest } from '../learn/sign.js';

export const STATUSES = ['PLANNED', 'IMPLEMENTED', 'CONFIGURED', 'CONNECTED', 'TESTED', 'VERIFIED', 'BLOCKED', 'FAILED'];
export const STAGES = ['understand', 'architect', 'plan', 'build', 'integrate', 'test', 'deploy', 'operate', 'improve'];
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const NO_RUNNER = 'Builds, tests and deployments run real processes and need the JARVIS server (npm start). This browser build can design and generate the project but cannot execute it.';

export class Worlds {
  constructor(s) { this.s = s; this.pipelines = new Map(); }
  get runner() { return this.s.worldRunner ?? null; }

  // ---------------- records ----------------
  list() { return this.s.store.all('worlds', (w) => !w.archived).slice().reverse().map((w) => this.summary(w)); }
  summary(w) { const counts = {}; for (const f of w.features ?? []) counts[f.status] = (counts[f.status] ?? 0) + 1; return { id: w.id, title: w.title, type: w.type, status: w.status, version: w.version, createdAt: w.createdAt, updatedAt: w.updatedAt, stages: w.stages, featureCounts: counts, preview: this.runner?.preview(w.id) ?? null, killed: !!w.killed }; }
  get(id) { const w = this.s.store.get('worlds', id); if (!w || w.archived) throw err('no such digital world', 404); return w; }
  audit(w, action, detail = {}, actor = 'jarvis') { this.s.store.insert('world_audit', { worldId: w.id, action, actor, detail, at: now() }); this.s.audit.log(actor, `world.${action}`, { worldId: w.id, ...detail }); }
  stage(w, name, status, detail = '', evidence = null) { w.stages = { ...(w.stages ?? {}), [name]: { status, detail, evidence, at: now() } }; }
  save(w) { return this.s.store.update('worlds', w.id, { ...w, updatedAt: now() }); }
  setFeature(w, key, patch) { const list = w.features ?? []; const f = list.find((x) => x.key === key); if (f) Object.assign(f, patch, { at: now() }); else list.push({ key, ...patch, at: now() }); w.features = list; }

  // ---------------- Stage 1-2: understand + architect ----------------
  /** Like create(), but asks the AI designer when no template fits (or when ai=true) and a model is available. */
  async createSmart({ text, lang, ai = false } = {}, actor = 'user') {
    const { designWorld, aiAvailable } = await import('../ai/assist.js');
    let base = null; try { base = understand(text, { lang }); } catch { /* too short: let the designer try */ }
    if ((ai || !base || base.status === 'needs-input' || base.type === 'custom') && aiAvailable(this.s)) {
      const r = await designWorld(this.s, text, { lang });
      if (r.spec) { const w = this.create({ text, lang, spec: r.spec }, actor); this.audit(w, 'ai.designed', { model: r.spec.aiModel }, actor); return w; }
    }
    return this.create({ text, lang }, actor);
  }

  create({ text, lang, spec: given = null } = {}, actor = 'user') {
    const spec = given ?? understand(text, { lang });
    const w = this.s.store.insert('worlds', {
      title: spec.title ?? String(text).slice(0, 60), slug: spec.slug ?? 'world', type: spec.type ?? 'custom', request: String(text).slice(0, 2000), owner: actor,
      status: spec.status === 'needs-input' ? 'needs-input' : 'specified', version: 1, spec, architecture: null, features: [], stages: {},
      budget: { maxPipelineRunsPerDay: 20, maxTestMinutes: 2 }, usage: { pipelineRuns: 0, buildMs: 0, testMs: 0, modelCalls: 0 }, createdAt: now(),
    });
    this.stage(w, 'understand', spec.status === 'needs-input' ? 'BLOCKED' : 'VERIFIED', spec.status === 'needs-input' ? spec.question : `${spec.entities.length} entities, ${spec.requirements.length} requirements, ${spec.assumptions.length} assumptions`);
    for (const st of STAGES.slice(1)) if (!w.stages[st]) this.stage(w, st, 'PLANNED');
    this.save(w);
    this.s.store.insert('world_versions', { worldId: w.id, version: 1, spec, reason: 'created', at: now() });
    this.audit(w, 'created', { type: w.type, status: w.status }, actor);
    return this.get(w.id);
  }
  /** Answer to the clarification question: the request is re-understood with the answer. */
  clarify(id, answer, actor = 'user') {
    const w = this.get(id);
    const spec = understand(`${w.request}. ${answer}`, { lang: w.spec.lang });
    if (spec.status === 'needs-input') throw err(spec.question, 422);
    Object.assign(w, { spec, title: spec.title, slug: spec.slug, type: spec.type, status: 'specified', request: `${w.request}. ${answer}` });
    this.stage(w, 'understand', 'VERIFIED', `${spec.entities.length} entities after clarification`);
    this.save(w); this.audit(w, 'clarified', {}, actor);
    return this.get(id);
  }
  updateSpec(id, patch, actor = 'user') {
    const w = this.get(id);
    const spec = structuredClone(w.spec);
    if (patch.title) { spec.title = String(patch.title).slice(0, 80); w.title = spec.title; }
    if (patch.entities) {
      if (!Array.isArray(patch.entities) || !patch.entities.length || patch.entities.length > 20) throw err('entities must be a non-empty list (max 20)');
      for (const e of patch.entities) { if (!e.name || !Array.isArray(e.fields) || !e.fields.length) throw err('each entity needs a name and fields'); for (const f of e.fields) if (!f.name || !['string', 'text', 'email', 'phone', 'number', 'money', 'date', 'datetime', 'boolean', 'enum'].includes(f.type ?? 'string')) throw err(`bad field ${f.name}`); }
      spec.entities = patch.entities.map((e) => ({ name: e.name, label: e.label ?? e.name, labelHe: e.labelHe ?? null, public: !!e.public, fields: e.fields.map((f) => ({ name: f.name, label: f.label ?? f.name, type: f.type ?? 'string', required: !!f.required, ...(f.options ? { options: f.options.map(String) } : {}) })) }));
    }
    w.version += 1; w.spec = spec; w.architecture = null; w.features = []; w.status = 'specified';
    for (const st of STAGES.slice(1)) this.stage(w, st, 'PLANNED', `spec changed (v${w.version})`);
    this.save(w);
    this.s.store.insert('world_versions', { worldId: w.id, version: w.version, spec, reason: patch.reason ?? 'specification updated', at: now() });
    this.audit(w, 'spec.updated', { version: w.version }, actor);
    return this.get(id);
  }
  architect(id) {
    const w = this.get(id);
    if (w.status === 'needs-input') throw err('answer the clarification question first', 409);
    w.architecture = architect(w.spec);
    this.stage(w, 'architect', 'VERIFIED', `${w.architecture.api.length} endpoints, ${w.architecture.database.length} tables`);
    this.save(w); this.audit(w, 'architected');
    return w.architecture;
  }

  // ---------------- Stage 3: plan (mission with agents) ----------------
  plan(id, actor = 'user') {
    const w = this.get(id);
    if (w.status === 'needs-input') throw err('answer the clarification question first', 409);
    const T = (tid, title, tool, dependsOn = []) => ({ id: tid, title, agent: 'builder', tool, args: { worldId: w.id }, dependsOn });
    const m = this.s.missions.create({
      objective: `Build "${w.title}" (v${w.version})`, goal: w.request,
      successCriteria: 'The project builds, its own test suite passes, and the running app passes HTTP verification.',
      constraints: ['no fake credentials', 'no deployment without authorization', 'stop at the first failed stage'],
      tasks: [T('architect', 'Design the architecture', 'world.architect'), T('generate', 'Generate the source code', 'world.generate', ['architect']), T('build', 'Build and package', 'world.build', ['generate']), T('test', 'Run the test suite', 'world.test', ['build']), T('verify', 'Verify the running app', 'world.verify', ['test'])],
    }, { actor, householdId: this.s.householdId, lang: w.spec.lang });
    w.missionId = m.id;
    this.stage(w, 'plan', 'VERIFIED', `mission ${m.id}: 5 tasks assigned to the Builder agent`, { missionId: m.id });
    this.save(w); this.audit(w, 'planned', { missionId: m.id }, actor);
    return m;
  }
  /** Full pipeline through the mission engine (each task is a tool run through CORE: policy, agent ceiling, evidence). */
  async runPipeline(id, actor = 'user') {
    const w = this.get(id);
    if (w.killed) throw err('this world is stopped by its kill switch; re-enable it first', 409);
    const today = new Date().toISOString().slice(0, 10);
    const runsToday = this.s.store.all('world_audit', (a) => a.worldId === id && a.action === 'pipeline.started' && a.at.startsWith(today)).length;
    if (runsToday >= w.budget.maxPipelineRunsPerDay) throw err(`daily budget reached (${w.budget.maxPipelineRunsPerDay} pipeline runs)`, 429);
    if (this.pipelines.has(id)) return this.pipelines.get(id);
    const job = (async () => {
      const m = this.plan(id, actor);
      this.audit(w, 'pipeline.started', { missionId: m.id }, actor);
      const done = await this.s.missions.run(m.id);
      const fresh = this.get(id);
      fresh.usage.pipelineRuns += 1;
      fresh.status = done.status === 'completed' && fresh.stages.test?.status === 'VERIFIED' && fresh.stages.deploy?.status !== 'FAILED' ? 'verified' : fresh.stages.build?.status === 'BLOCKED' ? 'generated' : 'failed';
      this.save(fresh); this.audit(fresh, 'pipeline.finished', { missionId: m.id, mission: done.status, status: fresh.status });
      return { world: this.get(id), mission: done };
    })().finally(() => this.pipelines.delete(id));
    this.pipelines.set(id, job);
    return job;
  }
  startPipeline(id, actor = 'user') { this.runPipeline(id, actor).catch((e) => { try { const w = this.get(id); this.audit(w, 'pipeline.error', { error: e.message }); } catch {} }); return { started: true, worldId: id }; }

  // ---------------- Stage 4: code ----------------
  files(id, version) { const w = this.get(id); const v = version ?? w.version; return this.s.store.all('world_files', (f) => f.worldId === id && f.version === v); }
  generate(id) {
    const w = this.get(id);
    if (!w.architecture) this.architect(id);
    const { files, schema } = generateProject(w.spec, { version: w.version });
    for (const old of this.files(id)) this.s.store.remove('world_files', old.id);
    for (const [p, content] of Object.entries(files)) this.s.store.insert('world_files', { worldId: id, version: w.version, path: p, content, bytes: content.length, sha256: digest(content) });
    const fresh = this.get(id);
    fresh.schema = schema;
    fresh.features = [];
    for (const e of schema.entities) this.setFeature(fresh, `api:${e.name}`, { name: `REST API + UI for ${e.label}`, status: 'IMPLEMENTED', evidence: `server.js + schema.json (/api/${e.name})` });
    this.setFeature(fresh, 'validation', { name: 'Server-side validation', status: 'IMPLEMENTED', evidence: 'server.js validate()' });
    this.setFeature(fresh, 'auth', { name: 'Admin token authorization', status: 'IMPLEMENTED', evidence: 'APP_TOKEN bearer check' });
    this.setFeature(fresh, 'ui', { name: 'Responsive web UI', status: 'IMPLEMENTED', evidence: 'public/' });
    this.setFeature(fresh, 'tests', { name: 'Automated API test suite', status: 'IMPLEMENTED', evidence: 'tests/api.test.js' });
    this.setFeature(fresh, 'docker', { name: 'Container image definition', status: 'IMPLEMENTED', evidence: 'Dockerfile (not built: see Deployment)' });
    for (const i of fresh.spec.integrations ?? []) this.setFeature(fresh, `integration:${i}`, { name: `Integration: ${i}`, status: 'BLOCKED', evidence: 'needs credentials and an adapter configuration; no fake credentials are used' });
    fresh.status = 'generated';
    this.stage(fresh, 'build', 'IMPLEMENTED', `${Object.keys(files).length} files generated (v${w.version})`);
    this.save(fresh); this.audit(fresh, 'generated', { files: Object.keys(files).length, version: w.version });
    return { files: Object.keys(files).length, bytes: Object.values(files).reduce((a, c) => a + c.length, 0) };
  }

  // ---------------- Stage 4b/6: build, test, verify (real execution) ----------------
  blocked(w, stage, reason = NO_RUNNER) { this.stage(w, stage, 'BLOCKED', reason); this.save(w); this.audit(w, `${stage}.blocked`, { reason }); return { ok: false, blocked: true, reason }; }
  async build(id) {
    const w = this.get(id);
    const files = this.files(id);
    if (!files.length) throw err('generate the code first', 409);
    if (!this.runner) return this.blocked(w, 'build');
    const r = await this.runner.build(w, files);
    const fresh = this.get(id);
    fresh.usage.buildMs += r.ms;
    const rec = this.s.store.insert('world_builds', { worldId: id, version: w.version, ok: r.ok, steps: r.steps, ms: r.ms, at: now() });
    if (r.ok) {
      const art = this.s.store.insert('world_artifacts', { worldId: id, version: w.version, buildId: rec.id, ...r.artifact, signature: sign(this.s.store, { worldId: id, sha256: r.artifact.sha256 }), at: now() });
      this.stage(fresh, 'build', 'VERIFIED', `built and packaged ${art.file} (${r.steps.length} checks passed)`, { buildId: rec.id, artifactId: art.id, sha256: art.sha256 });
    } else {
      this.stage(fresh, 'build', 'FAILED', r.steps.filter((x) => !x.ok).map((x) => `${x.name}: ${x.detail}`).join('; ').slice(0, 500), { buildId: rec.id });
      this.incident(fresh, 'build', 'high', 'build failed', r.steps.filter((x) => !x.ok).map((x) => x.name).join(', '), 'Inspect the failing check; regenerate after fixing the specification.');
    }
    this.save(fresh); this.audit(fresh, r.ok ? 'build.passed' : 'build.failed', { buildId: rec.id });
    return { ok: r.ok, buildId: rec.id, steps: r.steps };
  }
  async test(id) {
    const w = this.get(id);
    if (!this.runner) return this.blocked(w, 'test');
    if (w.stages.build?.status !== 'VERIFIED') throw err('the build must pass before testing', 409);
    const r = await this.runner.test(w);
    const fresh = this.get(id);
    fresh.usage.testMs += r.durationMs ?? 0;
    const rec = this.s.store.insert('world_test_runs', { worldId: id, version: w.version, ...r, at: now() });
    for (const e of fresh.schema?.entities ?? []) {
      const mine = r.cases.filter((c) => c.name.endsWith(`: ${e.name}`));
      if (mine.length) this.setFeature(fresh, `api:${e.name}`, { status: mine.every((c) => c.pass) ? 'TESTED' : 'FAILED', evidence: `${mine.filter((c) => c.pass).length}/${mine.length} tests (run ${rec.id})` });
    }
    const caseOk = (re) => { const c = r.cases.filter((x) => re.test(x.name)); return c.length ? c.every((x) => x.pass) : null; };
    const map = { validation: /validation rejects/, auth: /authorization/, ui: /static UI/, tests: /./ };
    for (const [k, re] of Object.entries(map)) { const ok = caseOk(re); if (ok !== null) this.setFeature(fresh, k, { status: ok ? 'TESTED' : 'FAILED', evidence: `run ${rec.id}` }); }
    this.stage(fresh, 'test', r.ok ? 'VERIFIED' : 'FAILED', `${r.passed}/${r.total} tests passed${r.timedOut ? ' (timed out)' : ''}`, { testRunId: rec.id });
    if (!r.ok) this.incident(fresh, 'test', 'high', `${r.failed} test(s) failed`, r.cases.filter((c) => !c.pass).map((c) => c.name).join(', '), 'Open the test output; fix the specification or report a generator bug.');
    this.save(fresh); this.audit(fresh, r.ok ? 'test.passed' : 'test.failed', { testRunId: rec.id, passed: r.passed, total: r.total });
    return { ok: r.ok, testRunId: rec.id, passed: r.passed, failed: r.failed, total: r.total };
  }
  async verify(id) {
    const w = this.get(id);
    if (!this.runner) return this.blocked(w, 'test', NO_RUNNER);
    if (w.stages.test?.status !== 'VERIFIED') throw err('tests must pass before verification', 409);
    const r = await this.runner.verify(w, w.schema);
    const fresh = this.get(id);
    const rec = this.s.store.insert('world_verifications', { worldId: id, version: w.version, ...r, at: now() });
    if (r.ok) for (const f of fresh.features) if (f.status === 'TESTED') Object.assign(f, { status: 'VERIFIED', evidence: `${f.evidence} · live HTTP verification ${rec.id}` });
    this.stage(fresh, 'deploy', r.ok ? 'PLANNED' : 'FAILED', r.ok ? 'verified build ready; deploy to local preview when you want it running' : 'verification failed', { verificationId: rec.id });
    if (!r.ok) this.incident(fresh, 'verify', 'high', 'live verification failed', r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; '), 'Check the app logs and the failing HTTP check.');
    fresh.status = r.ok ? 'verified' : 'failed';
    this.save(fresh); this.audit(fresh, r.ok ? 'verify.passed' : 'verify.failed', { verificationId: rec.id });
    return { ok: r.ok, verificationId: rec.id, checks: r.checks };
  }

  // ---------------- Stage 7-8: deploy + operate ----------------
  token(w) { const t = this.s.store.getMeta('worldTokens', {}); if (!t[w.id]) { t[w.id] = `${digest(`${w.id}:${now()}:${Math.random()}`).slice(0, 32)}`; this.s.store.setMeta('worldTokens', t); } return t[w.id]; }
  async deploy(id, { target = 'local-preview' } = {}, actor = 'user') {
    const w = this.get(id);
    if (actor !== 'user') throw err('only the owner can deploy', 403);
    if (w.killed) throw err('this world is stopped by its kill switch', 409);
    if (target === 'docker') { const d = this.runner?.docker() ?? { available: false, detail: NO_RUNNER }; const rec = this.s.store.insert('world_deployments', { worldId: id, version: w.version, target, status: 'BLOCKED', detail: d.available ? 'Docker is available; container deployment requires an approved deployment policy (not configured).' : d.detail, by: actor, at: now() }); this.audit(w, 'deploy.blocked', { target }, actor); return rec; }
    if (target !== 'local-preview') { const rec = this.s.store.insert('world_deployments', { worldId: id, version: w.version, target, status: 'BLOCKED', detail: 'No hosting provider is configured. Add provider credentials in the Integration Center first.', by: actor, at: now() }); this.audit(w, 'deploy.blocked', { target }, actor); return rec; }
    if (!this.runner) { const rec = this.s.store.insert('world_deployments', { worldId: id, version: w.version, target, status: 'BLOCKED', detail: NO_RUNNER, by: actor, at: now() }); return rec; }
    if (w.status !== 'verified') throw err('only a verified build can be deployed', 409);
    let p;
    try { p = await this.runner.startPreview(w, { token: this.token(w) }); }
    catch (e) { const rec = this.s.store.insert('world_deployments', { worldId: id, version: w.version, target, status: 'FAILED', detail: e.message, by: actor, at: now() }); this.incident(w, 'deploy', 'high', 'deployment failed', e.message, 'Check the logs and rebuild.'); return rec; }
    const h = await this.runner.health(id, this.token(w));
    const rec = this.s.store.insert('world_deployments', { worldId: id, version: w.version, target, status: h.ok ? 'VERIFIED' : 'FAILED', url: p.url, port: p.port, health: h, by: actor, at: now() });
    this.s.store.insert('world_health_checks', { worldId: id, ...h, at: now(), source: 'deployment' });
    const fresh = this.get(id);
    this.stage(fresh, 'deploy', h.ok ? 'VERIFIED' : 'FAILED', h.ok ? `running at ${p.url} (health ${h.latencyMs} ms)` : `started but health check failed: ${h.detail ?? h.httpStatus}`, { deploymentId: rec.id });
    this.stage(fresh, 'operate', h.ok ? 'CONNECTED' : 'FAILED', h.ok ? 'monitoring: health checks on demand and every scheduler tick' : 'down');
    this.save(fresh); this.audit(fresh, h.ok ? 'deploy.verified' : 'deploy.failed', { deploymentId: rec.id, target, url: p.url }, actor);
    return rec;
  }
  stop(id, actor = 'user') { const w = this.get(id); const stopped = this.runner?.stopPreview(id) ?? false; this.stage(w, 'operate', 'PLANNED', 'stopped'); this.save(w); this.audit(w, 'stopped', {}, actor); return { stopped }; }
  async healthCheck(id) {
    const w = this.get(id);
    if (!this.runner) return { ok: false, status: 'BLOCKED', detail: NO_RUNNER };
    const h = await this.runner.health(id, this.token(w));
    const rec = this.s.store.insert('world_health_checks', { worldId: id, ...h, at: now() });
    if (!h.ok && this.runner.preview(id)) this.incident(w, 'operate', 'high', 'health check failed', h.detail ?? `HTTP ${h.httpStatus}`, 'Restart the preview from the Deployment Center; check the logs.');
    return rec;
  }
  async monitorAll() { const out = []; for (const w of this.s.store.all('worlds', (x) => !x.archived && this.runner?.preview(x.id))) out.push(await this.healthCheck(w.id)); return out; }
  incident(w, stage, severity, title, diagnosis, remediation) { return this.s.store.insert('world_incidents', { worldId: w.id, stage, severity, title, diagnosis: String(diagnosis).slice(0, 800), remediation, status: 'open', at: now() }); }
  /** Kill switch: stop processes, cancel the mission, block further runs until re-enabled. */
  kill(id, actor = 'user', enable = false) {
    const w = this.get(id);
    if (enable) { w.killed = false; this.save(w); this.audit(w, 'kill_switch.released', {}, actor); return { killed: false }; }
    this.runner?.stopPreview(id);
    if (w.missionId) try { this.s.missions.cancel(w.missionId); } catch {}
    w.killed = true; this.stage(w, 'operate', 'BLOCKED', 'kill switch engaged'); this.save(w); this.audit(w, 'kill_switch.engaged', {}, actor);
    return { killed: true };
  }
  archive(id, actor = 'user') { const w = this.get(id); this.runner?.stopPreview(id); w.archived = true; this.save(w); this.audit(w, 'archived', {}, actor); return { archived: true }; }

  // ---------------- integrations (real checks only) ----------------
  async integrations({ verify = false } = {}) {
    const fetchImpl = this.s.fetch ?? globalThis.fetch;
    const out = [];
    const anthropic = !!this.s.router.providers.anthropic;
    out.push({ id: 'anthropic', name: 'Anthropic Claude (AI models)', status: anthropic ? 'CONFIGURED' : 'BLOCKED', detail: anthropic ? 'provider configured; verified on first model call' : 'set ANTHROPIC_API_KEY on the server or open JARVIS in claude.ai' });
    const gh = typeof process !== 'undefined' ? process.env?.GITHUB_TOKEN : null;
    let ghStatus = gh ? 'CONFIGURED' : 'BLOCKED'; let ghDetail = gh ? 'token configured (verify to check)' : 'set GITHUB_TOKEN on the server to export projects to repositories';
    if (gh && verify) { try { const r = await fetchImpl('https://api.github.com/user', { headers: { Authorization: `Bearer ${gh}`, 'User-Agent': 'jarvis' }, signal: AbortSignal.timeout(8000) }); ghStatus = r.ok ? 'CONNECTED' : 'FAILED'; ghDetail = r.ok ? 'GitHub API accepted the token' : `GitHub API answered ${r.status}`; } catch (e) { ghStatus = 'FAILED'; ghDetail = e.message; } }
    out.push({ id: 'github', name: 'GitHub', status: ghStatus, detail: ghDetail });
    const d = this.runner?.docker() ?? { available: false, detail: NO_RUNNER };
    out.push({ id: 'docker', name: 'Docker (container deployment)', status: d.available ? 'CONNECTED' : 'BLOCKED', detail: d.available ? d.version : d.detail });
    out.push({ id: 'local-runtime', name: 'Local runtime (builds, tests, previews)', status: this.runner ? 'CONNECTED' : 'BLOCKED', detail: this.runner ? `Node ${typeof process !== 'undefined' ? process.version : ''} child processes` : NO_RUNNER });
    out.push({ id: 'home-assistant', name: 'Home Assistant', status: this.s.home.kind === 'homeassistant' || this.s.home.kind === 'home-assistant' ? 'CONFIGURED' : 'BLOCKED', detail: this.s.home.kind === 'demo' ? 'demo home in use; set HA_URL and HA_TOKEN' : this.s.home.kind });
    for (const p of ['stripe', 'google-workspace', 'microsoft-365', 'cloud-hosting', 'email-delivery']) out.push({ id: p, name: p.replace(/-/g, ' '), status: 'BLOCKED', detail: 'adapter not configured: needs official API credentials (OAuth or API key) entered by the owner on the server; JARVIS never uses fake credentials' });
    return out;
  }

  // ---------------- dashboard ----------------
  dashboard(id) {
    const w = this.get(id);
    const by = (c) => this.s.store.all(c, (x) => x.worldId === id).slice(-10).reverse();
    return {
      world: w, files: this.files(id).map(({ content, ...f }) => f),
      builds: by('world_builds'), artifacts: by('world_artifacts'), testRuns: by('world_test_runs').map(({ output, ...t }) => t), verifications: by('world_verifications'),
      deployments: by('world_deployments'), health: by('world_health_checks'), incidents: by('world_incidents'), audit: by('world_audit'), versions: by('world_versions').map(({ spec, ...v }) => v),
      mission: w.missionId ? this.s.missions.get(w.missionId) : null, preview: this.runner?.preview(id) ?? null, logs: this.runner?.logs(id, 60) ?? [],
      runtime: this.runner ? this.runner.kind() : 'browser (no runner)', statuses: STATUSES,
    };
  }
  overview() {
    const worlds = this.list();
    const all = (c) => this.s.store.all(c);
    return { worlds, totals: { worlds: worlds.length, verified: worlds.filter((w) => w.status === 'verified').length, running: worlds.filter((w) => w.preview?.running).length, openIncidents: all('world_incidents').filter((i) => i.status === 'open').length, builds: all('world_builds').length, testRuns: all('world_test_runs').length }, runtime: this.runner ? this.runner.kind() : 'browser (no runner)' };
  }
}
