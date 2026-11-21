// Development Lab: isolated workspaces ("experimental branches") where JARVIS prototypes new
// capabilities. A branch holds a capability specification and generated (or pasted) code that
// defines `function run(input)` - a pure computation: no network, no files, no globals.
//
// Pipeline: create branch → static analysis → dependency scan → secret scan → signed artifact
//   → build verification → unit tests + security tests + performance in isolation
//   → "ready for review" → owner approval → installed as a read-only capability.
// Every artifact is signed; the signature is re-checked before each execution, so code that
// changed after review never runs. Nothing here can grant permissions: lab capabilities are
// always risk "read", used only by the Executive agent, and can be disabled at any time.
import { now } from '../lib/store.js';
import { runIsolated, isolationKind } from './isolate.js';
import { sign, verify, digest } from './sign.js';
import { agentById } from '../agents/registry.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });

// Static analysis: anything that reaches outside a pure computation is rejected.
const FORBIDDEN = [
  [/\b(?:require|import|importScripts)\b/, 'module loading'],
  [/\b(?:process|globalThis|window|self|document|global|navigator|location)\b/, 'host globals'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'network access'],
  [/\b(?:eval|Function|setTimeout|setInterval|queueMicrotask|Atomics|SharedArrayBuffer|WebAssembly)\b/, 'dynamic code or timers'],
  [/\b(?:constructor|prototype|__proto__|__defineGetter__|Reflect|Proxy|Symbol\.)/, 'prototype manipulation'],
  [/\b(?:localStorage|sessionStorage|indexedDB|caches|cookie)\b/, 'storage access'],
  [/\bthis\b/, 'use of this'],
  [/\bwhile\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\)/, 'unbounded loop'],
];
const SECRETS = [/sk-[a-z0-9-]{16,}/i, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{6,}/i, /ghp_[A-Za-z0-9]{20,}/];

export function staticAnalysis(code) {
  const findings = [];
  const src = String(code ?? '');
  if (src.length > 20000) findings.push({ severity: 'high', rule: 'size', note: 'code longer than 20,000 characters' });
  if (!/function\s+run\s*\(/.test(src)) findings.push({ severity: 'high', rule: 'entry point', note: 'must define function run(input)' });
  const stripped = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
  for (const [re, rule] of FORBIDDEN) { const m = stripped.match(re); if (m) findings.push({ severity: 'high', rule, note: `uses "${m[0]}"` }); }
  return { passed: !findings.some((f) => f.severity === 'high'), findings };
}
export function dependencyScan(code) {
  const deps = [...String(code).matchAll(/(?:from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g)].map((m) => m[1] ?? m[2]);
  return { passed: deps.length === 0, dependencies: deps, policy: 'lab capabilities may not use dependencies' };
}
export function secretScan(code) {
  const hits = SECRETS.filter((re) => re.test(String(code))).map((re) => re.source.slice(0, 24));
  return { passed: hits.length === 0, findings: hits };
}

export class DevLab {
  constructor(s) { this.s = s; }
  list() { return this.s.store.all('development_branches').slice().reverse().map(({ code, ...b }) => ({ ...b, codeBytes: code?.length ?? 0 })); }
  get(id) { const b = this.s.store.get('development_branches', id); if (!b) throw err('no such branch', 404); return b; }

  /** Create an isolated workspace for a capability prototype. Code can come from the model (generate) or be supplied. */
  create({ title, description = '', spec = {}, code = '', tests = [], source = 'manual', researchId = null }, actor = 'user') {
    if (!title) throw err('title required');
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'capability';
    const capId = `lab.${slug.replace(/-/g, '_')}`;
    const b = this.s.store.insert('development_branches', {
      name: `exp/${slug}-${Date.now().toString(36)}`, title: String(title).slice(0, 80), description: String(description).slice(0, 500), capId,
      spec: { purpose: spec.purpose ?? description, inputSchema: spec.inputSchema ?? { value: { type: 'any' } }, complexity: spec.complexity ?? 'low', security: 'pure computation: no network, files, globals or dependencies; risk read', officialApis: spec.officialApis ?? [] },
      code: String(code), tests: Array.isArray(tests) ? tests.slice(0, 30) : [], source, researchId, status: code ? 'draft' : 'needs-code', createdBy: actor, at: now(),
      baseVersion: this.s.store.all('config_versions').length, isolation: isolationKind(),
    });
    this.s.learn?.log('devlab.branch_created', { branchId: b.id, name: b.name, source }, actor);
    return b;
  }

  /** Ask the model to write the code (needs a model; the lab never downloads code). */
  async generate(id, actor = 'user') {
    const b = this.get(id);
    const prompt = `Write a single pure JavaScript function named run(input) for this capability.\nPurpose: ${b.spec.purpose}\nInput schema: ${JSON.stringify(b.spec.inputSchema)}\nRules: no imports, no network, no globals, no eval, no timers, no "this"; deterministic; return JSON-serializable data. Output only the code.`;
    const r = await this.s.router.complete({ complexity: 'medium', task: 'coding' }, { system: 'You write small, safe, pure JavaScript functions. Output code only.', messages: [{ role: 'user', content: prompt }] });
    if (r.offline || !r.text) throw err('code generation needs an AI model; you can paste code instead', 503);
    const code = String(r.text).replace(/^```(?:js|javascript)?\s*|```\s*$/gm, '').trim();
    this.s.store.update('development_branches', id, { code, source: 'generated', status: 'draft', generatedAt: now() });
    this.s.learn?.log('devlab.code_generated', { branchId: id, bytes: code.length }, actor);
    return this.get(id);
  }

  update(id, { code, tests }, actor = 'user') {
    const b = this.get(id);
    if (b.status === 'installed') throw err('installed capabilities are immutable; create a new branch');
    const patch = { status: 'draft', scan: null, testsResult: null, artifact: null };
    if (code !== undefined) patch.code = String(code);
    if (tests !== undefined) patch.tests = tests.slice(0, 30);
    this.s.store.update('development_branches', id, patch);
    this.s.learn?.log('devlab.branch_updated', { branchId: id }, actor);
    return this.get(id);
  }

  /** Full verification pipeline. */
  async verify(id, actor = 'user') {
    const b = this.get(id);
    if (!b.code) throw err('the branch has no code yet');
    const analysis = staticAnalysis(b.code); const deps = dependencyScan(b.code); const secrets = secretScan(b.code);
    const scan = this.s.store.insert('security_scans', { branchId: id, at: now(), staticAnalysis: analysis, dependencies: deps, secrets, passed: analysis.passed && deps.passed && secrets.passed });
    const result = { scanId: scan.id, build: null, unit: [], security: [], performance: null };
    if (!scan.passed) {
      this.s.store.update('development_branches', id, { status: 'blocked', scan: { id: scan.id, passed: false }, testsResult: result });
      this.s.learn?.security('devlab.blocked', { branchId: id, findings: [...analysis.findings.map((f) => f.rule), ...deps.dependencies, ...secrets.findings] });
      this.s.learn?.log('devlab.verified', { branchId: id, status: 'blocked' }, actor);
      return this.get(id);
    }
    const artifact = { digest: digest(b.code), signature: sign(this.s.store, { capId: b.capId, code: b.code }), signedAt: now() };
    // Build verification: the code loads and exposes run().
    const build = await runIsolated(b.code, null, { timeoutMs: 1000 });
    result.build = { ok: build.ok || !/must define function run|SyntaxError|Unexpected/.test(build.error ?? ''), note: build.ok ? 'loads and runs' : build.error };
    for (const t of b.tests) {
      const r = await runIsolated(b.code, t.input, { timeoutMs: 1000 });
      const pass = r.ok && JSON.stringify(r.out) === JSON.stringify(t.expect);
      result.unit.push({ input: t.input, expect: t.expect, got: r.ok ? r.out : null, error: r.ok ? null : r.error, pass, ms: r.ms ?? null });
    }
    // Security tests: hostile inputs must not crash the host, hang, or produce non-JSON output.
    for (const hostile of [{ __proto__: { polluted: true } }, 'x'.repeat(10000), null, [1, [2, [3]]]]) {
      const r = await runIsolated(b.code, hostile, { timeoutMs: 1000 });
      result.security.push({ case: typeof hostile === 'string' ? 'long string' : JSON.stringify(hostile)?.slice(0, 30) ?? 'null', ok: r.ok || !r.timeout, timeout: !!r.timeout });
    }
    const perf = result.unit.map((u) => u.ms).filter((x) => x != null);
    result.performance = { avgMs: perf.length ? +(perf.reduce((a, x) => a + x, 0) / perf.length).toFixed(2) : null, limitMs: 1000 };
    const unavailable = build.unavailable;
    const passed = !unavailable && result.build.ok && result.unit.length > 0 && result.unit.every((u) => u.pass) && result.security.every((x) => x.ok);
    const status = unavailable ? 'tests-blocked' : passed ? 'ready-for-review' : 'tests-failed';
    this.s.store.update('development_branches', id, { status, scan: { id: scan.id, passed: true }, testsResult: result, artifact, verifiedAt: now() });
    this.s.learn?.log('devlab.verified', { branchId: id, status, unit: `${result.unit.filter((u) => u.pass).length}/${result.unit.length}` }, actor);
    return this.get(id);
  }

  /** Owner-approved promotion: the signed artifact becomes a read-only capability. */
  async install(id, actor) {
    if (actor !== 'user') throw err('only the owner can install a capability', 403);
    const b = this.get(id);
    if (b.status !== 'ready-for-review') throw err('only a verified branch (ready for review) can be installed', 409);
    if (!verify(this.s.store, { capId: b.capId, code: b.code }, b.artifact?.signature)) { this.s.learn?.security('devlab.tampered', { branchId: id }); throw err('artifact signature mismatch: the code changed after verification', 409); }
    if (this.s.tools[b.capId]) throw err('a capability with this id already exists', 409);
    this.mount(b);
    this.s.store.update('development_branches', id, { status: 'installed', installedBy: actor, installedAt: now() });
    this.s.store.insert('deployments', { kind: 'capability', branchId: id, target: `capability:${b.capId}`, by: actor, at: now(), status: 'active', fromVersion: 0, toVersion: 1 });
    this.s.learn?.log('devlab.installed', { branchId: id, capId: b.capId }, actor);
    return this.s.capabilities.describe(this.s.tools[b.capId]);
  }

  mount(b) {
    const store = this.s.store; const learn = this.s.learn;
    this.s.tools[b.capId] = {
      name: b.capId, desc: b.description || b.title, input: b.spec.inputSchema, risk: 'read', version: '1.0.0', adapter: 'sandboxed-code', extension: true,
      async run(args) {
        // Integrity is re-checked on every run: modified code never executes.
        if (!verify(store, { capId: b.capId, code: b.code }, b.artifact?.signature)) { learn?.security('devlab.tampered', { branchId: b.id }); throw new Error('capability artifact failed its integrity check'); }
        const r = await runIsolated(b.code, args, { timeoutMs: 1000 });
        if (!r.ok) throw new Error(`lab capability failed: ${r.error}`);
        return { data: r.out, summary: `[${b.capId}] ${JSON.stringify(r.out).slice(0, 1500)}` };
      },
    };
    this.s.capabilities.vecs?.delete(b.capId);
    const ex = agentById('executive'); if (!ex.tools.includes(b.capId)) ex.tools.push(b.capId);
  }
  restore() { for (const b of this.s.store.all('development_branches', (x) => x.status === 'installed')) if (!this.s.tools[b.capId]) this.mount(b); }

  uninstall(id, actor) {
    if (actor !== 'user') throw err('only the owner can remove a capability', 403);
    const b = this.get(id);
    if (b.status !== 'installed') throw err('not installed', 409);
    delete this.s.tools[b.capId];
    const ex = agentById('executive'); ex.tools = ex.tools.filter((x) => x !== b.capId);
    this.s.store.update('development_branches', id, { status: 'uninstalled' });
    for (const d of this.s.store.all('deployments', (x) => x.branchId === id && x.status === 'active')) this.s.store.update('deployments', d.id, { status: 'rolled_back', rolledBackAt: now() });
    this.s.store.insert('rollback_records', { kind: 'capability', branchId: id, target: `capability:${b.capId}`, by: actor, at: now(), reason: 'uninstalled' });
    this.s.learn?.log('devlab.uninstalled', { branchId: id, capId: b.capId }, actor);
    return true;
  }

  status() { return { isolation: isolationKind(), branches: this.s.store.all('development_branches').length, installed: this.s.store.all('development_branches', (x) => x.status === 'installed').length, blockedScans: this.s.store.all('security_scans', (x) => !x.passed).length, network: 'blocked', productionAccess: 'none (pure functions; JSON in, JSON out)' }; }
}
