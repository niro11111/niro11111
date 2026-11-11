// Digital World Engine - real execution on the JARVIS server (Node only; the browser build has no runner,
// so these stages are reported as BLOCKED there). Every stage runs real processes:
//   build   : write the workspace, `node --check` every source file, validate JSON/HTML, package a
//             .tar.gz artifact with SHA-256 per file
//   test    : `node --test` in the workspace (child process, minimal environment, timeout, output cap)
//   verify  : start the built app on a free port and check it over HTTP (health, UI, auth, create/list)
//   preview : run the app as a managed local process with logs and health checks (local deployment)
// Isolation: one directory per world and version; child processes get only PATH/NODE_ENV/HOME/TMPDIR
// and their own data dir (no JARVIS secrets); hard timeouts; output capped; bound to 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const OUT_CAP = 200_000;
const ID = /^[a-z]+_[a-f0-9]{8,32}$/;

function tar(entries) { // minimal POSIX ustar writer
  const blocks = [];
  for (const { name, data } of entries) {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 99), 0, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export function sampleValue(f, i = 0) {
  return { email: `user${i}@example.com`, phone: `+972-50-555-00${10 + i}`, number: 3 + i, money: 19.9 + i, date: `2026-01-1${i % 9}`, datetime: '2026-01-15T09:30:00.000Z', boolean: true, enum: f.options?.[0], text: `Sample ${f.name} text ${i}` }[f.type] ?? `Sample ${f.name} ${i}`;
}

export class WorldRunner {
  constructor({ root }) { this.root = path.resolve(root); this.procs = new Map(); fs.mkdirSync(this.root, { recursive: true }); }
  kind() { return 'node-server'; }
  dir(world) {
    if (!ID.test(world.id)) throw new Error('invalid world id');
    return path.join(this.root, world.id, `v${world.version}`);
  }
  /** Writes the files into the world's own directory (relative paths only, no traversal). */
  materialize(world, files) {
    const ws = this.dir(world);
    fs.rmSync(path.join(ws, 'src'), { recursive: true, force: true });
    for (const f of files) {
      if (path.isAbsolute(f.path) || f.path.split(/[\\/]/).includes('..')) throw new Error(`unsafe path ${f.path}`);
      const p = path.join(ws, 'src', f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.content);
    }
    return path.join(ws, 'src');
  }
  run(args, { cwd, timeoutMs = 120_000, env = {} } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now(); let out = ''; let err = ''; let timedOut = false;
      const child = spawn(process.execPath, args, { cwd, env: { PATH: process.env.PATH, NODE_ENV: 'test', HOME: cwd, TMPDIR: os.tmpdir(), NODE_NO_WARNINGS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      const cap = (s, d) => (s.length < OUT_CAP ? s + d : s);
      child.stdout.on('data', (d) => { out = cap(out, d.toString()); });
      child.stderr.on('data', (d) => { err = cap(err, d.toString()); });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: out, stderr: err, ms: Date.now() - t0, timedOut }); });
      child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout: out, stderr: String(e.message), ms: Date.now() - t0, timedOut }); });
    });
  }

  async build(world, files) {
    const t0 = Date.now(); const steps = [];
    let src;
    try { src = this.materialize(world, files); steps.push({ name: 'write workspace', ok: true, detail: `${files.length} files` }); }
    catch (e) { return { ok: false, steps: [{ name: 'write workspace', ok: false, detail: e.message }], ms: Date.now() - t0 }; }
    for (const f of files.filter((x) => /\.(m?js)$/.test(x.path))) {
      const r = await this.run(['--check', f.path], { cwd: src, timeoutMs: 20_000 });
      steps.push({ name: `syntax ${f.path}`, ok: r.code === 0, detail: r.code === 0 ? 'node --check ok' : (r.stderr || r.stdout).slice(0, 600) });
    }
    for (const f of files.filter((x) => x.path.endsWith('.json'))) { try { JSON.parse(f.content); steps.push({ name: `json ${f.path}`, ok: true }); } catch (e) { steps.push({ name: `json ${f.path}`, ok: false, detail: e.message }); } }
    const html = files.find((f) => f.path === 'public/index.html');
    steps.push({ name: 'html entry', ok: !!html && /<script type="module" src="app\.js">/.test(html.content) && /<title>/.test(html.content), detail: html ? 'index.html loads app.js' : 'missing public/index.html' });
    const ok = steps.every((s) => s.ok);
    let artifact = null;
    if (ok) {
      const prefix = `${world.slug || 'app'}-v${world.version}`;
      const buf = zlib.gzipSync(tar(files.map((f) => ({ name: `${prefix}/${f.path}`, data: Buffer.from(f.content) }))));
      const file = path.join(this.dir(world), `${prefix}.tar.gz`);
      fs.writeFileSync(file, buf);
      artifact = { file: path.basename(file), bytes: buf.length, sha256: sha256(buf), files: files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content), sha256: sha256(f.content) })) };
      steps.push({ name: 'package artifact', ok: true, detail: `${artifact.file} · ${(buf.length / 1024).toFixed(1)} KB` });
    }
    return { ok, steps, artifact, ms: Date.now() - t0 };
  }
  artifactPath(world, artifact) { const p = path.join(this.dir(world), artifact.file); return fs.existsSync(p) ? p : null; }

  async test(world) {
    const src = path.join(this.dir(world), 'src');
    if (!fs.existsSync(src)) return { ok: false, error: 'build the project first' };
    const r = await this.run(['--test', '--test-reporter=tap'], { cwd: src, timeoutMs: 120_000 });
    const num = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? 0);
    const cases = [...r.stdout.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map((m) => ({ name: m[2].trim(), pass: m[1] === 'ok' }));
    const total = num('tests'); const passed = num('pass'); const failed = num('fail');
    return { ok: r.code === 0 && failed === 0 && total > 0, total, passed, failed, cases, durationMs: r.ms, timedOut: r.timedOut, exitCode: r.code, output: (r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : '')).slice(-20_000) };
  }

  /** Starts the built app as a child process; resolves with {child, port} once it prints LISTENING. */
  spawnApp(world, { dataDir, token, logs }) {
    const src = path.join(this.dir(world), 'src');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['server.js'], { cwd: src, env: { PATH: process.env.PATH, HOME: src, NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, APP_TOKEN: token, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the app did not start within 10 s')); }, 10_000);
      const onLine = (stream) => (d) => { for (const line of d.toString().split('\n').filter(Boolean)) { logs?.push({ at: new Date().toISOString(), stream, line: line.slice(0, 500) }); if (logs && logs.length > 300) logs.shift(); const m = line.match(/LISTENING (\d+)/); if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); } } };
      child.stdout.on('data', onLine('out')); child.stderr.on('data', onLine('err'));
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the app exited with code ${code}`)); });
    });
  }

  async verify(world, schema) {
    const checks = []; const token = crypto.randomBytes(16).toString('hex');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-verify-'));
    let app;
    const check = async (name, fn) => { const t0 = Date.now(); try { const detail = await fn(); checks.push({ name, ok: true, detail, ms: Date.now() - t0 }); } catch (e) { checks.push({ name, ok: false, detail: e.message, ms: Date.now() - t0 }); } };
    try {
      app = await this.spawnApp(world, { dataDir, token, logs: [] });
      const base = `http://127.0.0.1:${app.port}`;
      const call = async (method, p, body, auth = true) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; };
      await check('process starts and listens', async () => `port ${app.port}`);
      await check('GET /api/health → 200 ok', async () => { const r = await call('GET', '/api/health', null, false); if (r.status !== 200 || !r.json?.ok) throw new Error(`status ${r.status}`); return `v${r.json.version}`; });
      await check('GET / serves the UI', async () => { const r = await call('GET', '/', null, false); if (r.status !== 200 || !r.text.includes('<title>')) throw new Error(`status ${r.status}`); return 'text/html'; });
      const e = schema.entities[0];
      const rec = Object.fromEntries(e.fields.map((f) => [f.name, sampleValue(f)]));
      await check(`admin API requires the token (/api/${e.name})`, async () => { const r = await call('GET', `/api/${e.name}`, null, false); if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`); return '401 without token'; });
      let id;
      await check(`POST /api/${e.name} creates a record`, async () => { const r = await call('POST', `/api/${e.name}`, rec); if (r.status !== 201) throw new Error(`status ${r.status}: ${r.text.slice(0, 200)}`); id = r.json.id; return id; });
      await check(`GET /api/${e.name} returns it (persisted)`, async () => { const r = await call('GET', `/api/${e.name}`); if (!r.json?.items?.some((x) => x.id === id)) throw new Error('record not found'); const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')); if (!disk[e.name]?.some((x) => x.id === id)) throw new Error('not on disk'); return 'in API and on disk'; });
      await check('invalid input is rejected (400)', async () => { const r = await call('POST', `/api/${e.name}`, { notAField: 1 }); if (r.status !== 400) throw new Error(`status ${r.status}`); return '400'; });
    } catch (e) { checks.push({ name: 'process starts and listens', ok: false, detail: e.message }); }
    finally { app?.child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); }
    return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
  }

  // ---------- local deployment (managed preview process) ----------
  async startPreview(world, { token }) {
    this.stopPreview(world.id);
    const logs = [];
    const dataDir = path.join(this.dir(world), 'data-preview');
    fs.mkdirSync(dataDir, { recursive: true });
    const app = await this.spawnApp(world, { dataDir, token, logs });
    const rec = { child: app.child, port: app.port, startedAt: new Date().toISOString(), version: world.version, logs, exited: null };
    app.child.on('exit', (code) => { rec.exited = { code, at: new Date().toISOString() }; });
    this.procs.set(world.id, rec);
    return { port: app.port, url: `http://127.0.0.1:${app.port}/`, startedAt: rec.startedAt };
  }
  stopPreview(worldId) { const p = this.procs.get(worldId); if (!p) return false; try { p.child.kill('SIGTERM'); } catch {} this.procs.delete(worldId); return true; }
  stopAll() { for (const id of [...this.procs.keys()]) this.stopPreview(id); }
  preview(worldId) { const p = this.procs.get(worldId); return p ? { running: !p.exited, port: p.port, url: `http://127.0.0.1:${p.port}/`, startedAt: p.startedAt, version: p.version, exited: p.exited } : null; }
  logs(worldId, n = 100) { return (this.procs.get(worldId)?.logs ?? []).slice(-n); }
  async health(worldId, token) {
    const p = this.procs.get(worldId);
    if (!p || p.exited) return { ok: false, status: 'down', detail: p?.exited ? `exited with code ${p.exited.code}` : 'not running' };
    const t0 = Date.now();
    try {
      const h = await fetch(`http://127.0.0.1:${p.port}/api/health`, { signal: AbortSignal.timeout(4000) });
      const m = await fetch(`http://127.0.0.1:${p.port}/api/metrics`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
      return { ok: h.ok, status: h.ok ? 'up' : 'degraded', latencyMs: Date.now() - t0, httpStatus: h.status, metrics: m.ok ? await m.json() : null };
    } catch (e) { return { ok: false, status: 'down', latencyMs: Date.now() - t0, detail: e.message }; }
  }
  docker() { const r = spawnSync('docker', ['--version'], { encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? { available: true, version: r.stdout.trim() } : { available: false, detail: 'docker is not installed or not on PATH on the JARVIS host' }; }
}
