#!/usr/bin/env node
// One command to run JARVIS on your computer, optionally at a real public https address.
//   node scripts/start.mjs            → server on http://127.0.0.1:7777 and opens the browser (signed in)
//   node scripts/start.mjs --public   → also a free Cloudflare quick tunnel: https://<random>.trycloudflare.com
//   node scripts/start.mjs --lan      → reachable from phones on the same Wi-Fi (http://<your-ip>:7777)
//   node scripts/start.mjs --no-open  → do not open the browser
// The double-click launchers (start-jarvis.bat / start-jarvis.command / start-jarvis.sh) call this.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PORT = Number(process.env.PORT ?? 7777);
const say = (he, en) => console.log(`${he}\n  ${en}`);

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) { say(`✕ נדרש Node.js 22 ומעלה (מותקן ${process.versions.node}). הורידו מ-https://nodejs.org`, `Node.js 22+ is required (found ${process.versions.node}). Get it from https://nodejs.org`); process.exit(1); }

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  say('⏳ התקנה ראשונה של רכיבים (פעם אחת)…', 'First-time install of dependencies…');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { say('✕ ההתקנה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.', 'Install failed. Check the internet connection and retry.'); process.exit(1); }
}

const lanIp = () => Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const env = { ...process.env, PORT: String(PORT), NODE_NO_WARNINGS: '1', JARVIS_HOST: args.has('--lan') ? '0.0.0.0' : (process.env.JARVIS_HOST ?? '127.0.0.1') };
const server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
let token = '';
server.stdout.on('data', (d) => {
  const s = String(d); process.stdout.write(s);
  const m = s.match(/Access token[^:]*:\s*(\S+)/); if (m) { token = m[1]; ready(); }
});
server.on('exit', (code) => { if (code) say(`✕ השרת נעצר (קוד ${code}). אם הפורט ${PORT} תפוס, הריצו עם PORT=7778.`, `The server stopped (code ${code}). If port ${PORT} is busy, run with PORT=7778.`); process.exit(code ?? 0); });
const stop = () => { try { tunnel?.kill(); } catch {} server.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

let tunnel = null; let opened = false;
async function ready() {
  // wait until /api/health answers
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const local = `http://127.0.0.1:${PORT}`;
  console.log('\n────────────────────────────────────────');
  say(`✓ ג׳ארוויס פועל: ${local}`, `JARVIS is running: ${local}`);
  if (args.has('--lan') && lanIp()) say(`📱 מהטלפון באותה רשת: http://${lanIp()}:${PORT} (המיקרופון בטלפון דורש https: השתמשו ב---public)`, `From a phone on the same Wi-Fi: http://${lanIp()}:${PORT} (the phone microphone needs https: use --public)`);
  say(`🔑 טוקן גישה (לטלפון, לקובץ ה-HTML ולכל מכשיר): ${token}`, `Access token (phone, HTML file, any device): ${token}`);
  if (!args.has('--no-open') && !opened) { opened = true; openBrowser(`${local}/#token=${encodeURIComponent(token)}`); }
  if (args.has('--public')) startTunnel();
  console.log('────────────────────────────────────────\n');
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* no desktop */ }
}

function startTunnel() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (which.status !== 0) {
    say('ℹ כדי לקבל כתובת https ציבורית חינם, התקינו את cloudflared:', 'For a free public https address, install cloudflared:');
    console.log('   Windows: winget install --id Cloudflare.cloudflared\n   macOS:   brew install cloudflared\n   Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n   …and run again with --public');
    return;
  }
  say('⏳ פותח מנהרה ציבורית (Cloudflare)…', 'Opening a public tunnel (Cloudflare)…');
  tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const look = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnel.url) {
      tunnel.url = m[0];
      console.log('\n════════════════════════════════════════');
      say(`🌐 כתובת אמיתית: ${m[0]}`, `Real public address: ${m[0]}`);
      say('פתחו אותה בכל מכשיר (גם בטלפון, עם מיקרופון), והתחברו עם טוקן הגישה. הכתובת מתחלפת בכל הפעלה; לכתובת קבועה ראו docs/DEPLOY.he.md.', 'Open it on any device (phone too, microphone works on https) and sign in with the token. It changes each run; for a fixed address see docs/DEPLOY.he.md.');
      console.log('════════════════════════════════════════\n');
    }
  };
  tunnel.stdout.on('data', look); tunnel.stderr.on('data', look);
  tunnel.on('exit', (c) => { if (c) say('✕ המנהרה נסגרה. ג׳ארוויס ממשיך לעבוד מקומית.', 'The tunnel closed. JARVIS keeps running locally.'); });
}
