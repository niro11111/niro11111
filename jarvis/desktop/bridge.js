#!/usr/bin/env node
// JARVIS desktop bridge: the only component allowed to touch this computer.
// It long-polls the JARVIS server, runs commands inside a LOCAL allow-list, and posts results.
// The server cannot widen these permissions; only the person running this process can.
//
//   JARVIS_URL=http://127.0.0.1:7777 JARVIS_TOKEN=... \
//   JARVIS_ALLOWED_DIRS=~/Documents,~/Projects JARVIS_ALLOWED_APPS=calculator,code \
//   node desktop/bridge.js
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.JARVIS_URL ?? 'http://127.0.0.1:7777';
const TOKEN = process.env.JARVIS_TOKEN;
if (!TOKEN) { console.error('Set JARVIS_TOKEN'); process.exit(1); }
const home = os.homedir();
const expand = (p) => path.resolve(p.replace(/^~(?=$|\/|\\)/, home));
const ALLOWED_DIRS = (process.env.JARVIS_ALLOWED_DIRS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(expand);
const ALLOWED_APPS = (process.env.JARVIS_ALLOWED_APPS ?? 'calculator,notepad,textedit,code').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const P = process.platform;

const APP_MAP = {
  calculator: { darwin: ['open', ['-a', 'Calculator']], win32: ['calc.exe', []], linux: ['gnome-calculator', []] },
  notepad: { win32: ['notepad.exe', []], darwin: ['open', ['-a', 'TextEdit']], linux: ['gedit', []] },
  textedit: { darwin: ['open', ['-a', 'TextEdit']], win32: ['notepad.exe', []], linux: ['gedit', []] },
  code: { darwin: ['open', ['-a', 'Visual Studio Code']], win32: ['code.cmd', []], linux: ['code', []] },
};

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 15000, windowsHide: true }, (e, out) => (e ? rej(e) : res(out))));

async function inAllowedDir(p) {
  const real = await fs.realpath(expand(p)); // resolves symlinks so ../ and links can't escape
  if (!ALLOWED_DIRS.some((d) => real === d || real.startsWith(d + path.sep))) throw new Error(`path not in allowed folders (${ALLOWED_DIRS.join(', ') || 'none configured'})`);
  return real;
}

const HANDLERS = {
  async open_app({ name }) {
    const key = String(name).toLowerCase().replace(/^the\s+/, '').trim();
    if (!ALLOWED_APPS.includes(key)) throw new Error(`app "${name}" is not in JARVIS_ALLOWED_APPS`);
    const spec = APP_MAP[key]?.[P];
    if (!spec) throw new Error(`no launcher for ${key} on ${P}`);
    await run(...spec);
    return { summary: `Opened ${key}.` };
  },
  async open_url({ url }) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http(s) URLs');
    if (P === 'darwin') await run('open', [u.href]);
    else if (P === 'win32') await run('rundll32', ['url.dll,FileProtocolHandler', u.href]);
    else await run('xdg-open', [u.href]);
    return { summary: `Opened ${u.href}` };
  },
  async list_dir({ path: p }) {
    const real = await inAllowedDir(p ?? ALLOWED_DIRS[0]);
    const entries = await fs.readdir(real, { withFileTypes: true });
    return { summary: entries.slice(0, 100).map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') || '(empty)', path: real };
  },
  async read_file({ path: p }) {
    const real = await inAllowedDir(p);
    const st = await fs.stat(real);
    if (st.size > 512 * 1024) throw new Error('file larger than 512 KB');
    return { summary: (await fs.readFile(real, 'utf8')).slice(0, 20000), path: real };
  },
  async screenshot() {
    const out = path.join(os.tmpdir(), `jarvis-shot-${Date.now()}.png`);
    if (P === 'darwin') await run('screencapture', ['-x', out]);
    else if (P === 'linux') await run('import', ['-window', 'root', out]);
    else throw new Error('screenshot not implemented on this platform yet');
    return { summary: `Screenshot saved to ${out}`, path: out };
  },
};

async function call(p, body) {
  const r = await fetch(`${URL_}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
}

const info = { platform: P, hostname: os.hostname(), capabilities: Object.keys(HANDLERS), allowedDirs: ALLOWED_DIRS, allowedApps: ALLOWED_APPS };
console.log(`JARVIS desktop bridge -> ${URL_}\nallowed dirs: ${ALLOWED_DIRS.join(', ') || '(none)'}\nallowed apps: ${ALLOWED_APPS.join(', ')}`);

for (;;) {
  try {
    const { commands } = await call('/api/bridge/poll', { info });
    for (const c of commands) {
      console.log(`[cmd] ${c.command} ${JSON.stringify(c.args)}`);
      try {
        const h = HANDLERS[c.command];
        if (!h) throw new Error(`unsupported command ${c.command}`);
        await call(`/api/bridge/result/${c.id}`, { ok: true, result: await h(c.args ?? {}) });
      } catch (e) { await call(`/api/bridge/result/${c.id}`, { ok: false, error: e.message }); }
    }
  } catch (e) { console.error('[bridge]', e.message); await new Promise((r) => setTimeout(r, 3000)); }
  await new Promise((r) => setTimeout(r, 1000));
}
