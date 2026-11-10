// JARVIS HTTP server + static web client. node:http around the transport-independent API router.
// Binds to 127.0.0.1 by default. All /api routes (except /api/health) need the bearer token.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, startScheduler } from './app.js';
import { resolveToken } from './security/auth.js';
import { bus } from './lib/events.js';
import { createApi } from './api/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../web');

export function createServer(s, token, opts = {}) {
  const api = createApi(s, token, opts);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    if (url.pathname === '/api/stream') {
      if (!api.authenticate(`Bearer ${url.searchParams.get('token')}`)) return send(res, 401, { error: 'unauthorized' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const on = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      bus.on('event', on);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => { bus.off('event', on); clearInterval(ka); });
      return;
    }
    // Digital World artifact download (binary): authenticated like every API call.
    const art = url.pathname.match(/^\/api\/worlds\/([a-z]+_[a-f0-9]+)\/artifact$/);
    if (art && req.method === 'GET') {
      if (!api.authenticate(req.headers.authorization ?? `Bearer ${url.searchParams.get('token')}`)) return send(res, 401, { error: 'unauthorized' });
      const w = s.store.get('worlds', art[1]); const a = w && s.store.all('world_artifacts', (x) => x.worldId === w.id).at(-1);
      const file = a && s.worldRunner?.artifactPath({ ...w, version: a.version }, a);
      if (!file) return send(res, 404, { error: 'no artifact: build the project first' });
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${a.file}"`, 'X-Artifact-SHA256': a.sha256 });
      return fs.createReadStream(file).pipe(res);
    }
    let raw = '';
    try {
      for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) return send(res, 413, { error: 'payload too large' }); }
    } catch { return send(res, 400, { error: 'bad request' }); }
    const out = await api.handle({ method: req.method, url: req.url, authorization: req.headers.authorization, body: raw });
    send(res, out.status, out.body);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(p, res) {
  const file = path.resolve(WEB, `.${p === '/' ? '/index.html' : decodeURIComponent(p)}`);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataFile = process.env.JARVIS_DATA ?? path.resolve(here, '../data/jarvis.json');
  let s;
  if ((process.env.JARVIS_DB_ENGINE ?? 'sqlite') === 'sqlite') {
    // Dedicated database for JARVIS: one SQLite file (imports an existing JSON store once).
    const { openDatabase } = await import('./db/sqlite.js');
    const { Store } = await import('./lib/store.js');
    const dbFile = process.env.JARVIS_DB ?? path.resolve(here, '../data/jarvis.db');
    const { backend, data, imported } = openDatabase(dbFile, { legacyJson: dataFile });
    const store = new Store(null, { data, onSave: (dirty) => backend.schedule(dirty) });
    backend.attach(store);
    s = await createApp({ store });
    s.db = backend;
    backend.flush(new Set(Object.keys(store.data)));
    const close = () => { try { backend.close(); } catch {} process.exit(0); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
    console.log(`Database: SQLite ${path.basename(dbFile)} (schema v${backend.status().schemaVersion})${imported ? `, imported ${imported} rows from ${path.basename(dataFile)}` : ''}`);
  } else s = await createApp({ file: dataFile });
  // Digital World Engine runner: real builds/tests/previews in child processes, one directory per world.
  const { WorldRunner } = await import('./worlds/runner.js');
  s.worldRunner = new WorldRunner({ root: process.env.JARVIS_WORLDS_DIR ?? path.resolve(here, '../data/worlds') });
  process.on('exit', () => s.worldRunner.stopAll());
  const token = resolveToken(s.store);
  startScheduler(s);
  const host = process.env.JARVIS_HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 7777);
  createServer(s, token).listen(port, host, () => {
    console.log(`J.A.R.V.I.S online at http://${host}:${port}`);
    console.log(`AI providers: ${s.router.status().map((p) => p.provider).join(', ')} | smart home: ${s.home.kind}`);
    console.log(`Access token (paste into the web app once): ${token}`);
  });
}
