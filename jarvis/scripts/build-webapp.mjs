// Builds the standalone JARVIS web app: the whole system (core, agents, memory, finance,
// automations, scheduler) bundled to run in the browser with no server.
//   node scripts/build-webapp.mjs  ->  dist/webapp/   (host anywhere: GitHub Pages, Netlify, a USB stick)
//                                  ->  dist/artifact/ (the same app, packaged for claude.ai)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/webapp');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'js'), { recursive: true });

const shims = { 'node:crypto': 'crypto', 'node:events': 'events', 'node:fs': 'fs', 'node:path': 'path', 'node:os': 'os', 'node:vm': 'vm' };
const shimPlugin = {
  name: 'node-shims',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => {
      const f = shims[a.path];
      if (!f) return { errors: [{ text: `${a.path} is not available in the browser build (imported by ${a.importer})` }] };
      return { path: path.join(root, 'web/runtime/shims', `${f}.js`) };
    });
  },
};

const result = await build({
  entryPoints: [path.join(root, 'web/runtime/main.js')],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: false,
  outfile: path.join(out, 'js/runtime.js'),
  plugins: [shimPlugin],
  banner: { js: 'globalThis.process ??= { env: {}, argv: [], memoryUsage: () => ({ rss: globalThis.performance?.memory?.usedJSHeapSize ?? 0 }) };' },
  logLevel: 'warning', metafile: true,
});
const bytes = Object.values(result.metafile.outputs).reduce((a, o) => a + o.bytes, 0);

for (const f of fs.readdirSync(path.join(root, 'web/js'))) fs.copyFileSync(path.join(root, 'web/js', f), path.join(out, 'js', f));
for (const f of ['styles.css', 'icon.svg', 'manifest.webmanifest']) fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8')
  .replace('<script type="module" src="js/app.js"></script>', '<script type="module" src="js/runtime.js"></script>')
  .replace('<section id="view" tabindex="-1"></section>', '<section id="view" tabindex="-1"><p id="bootMsg" class="muted" style="padding:40px;text-align:center">טוען את JARVIS…</p></section>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '404.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// claude.ai package: the platform supplies the document skeleton, so the page is head content + body.
const art = path.join(root, 'dist/artifact');
fs.rmSync(art, { recursive: true, force: true });
fs.cpSync(out, art, { recursive: true });
for (const f of ['404.html', '.nojekyll', 'manifest.webmanifest']) fs.rmSync(path.join(art, f), { force: true });
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
fs.writeFileSync(path.join(art, 'index.html'), `<title>JARVIS Personal OS</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&family=Orbitron:wght@500;700;800&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="icon.svg">
${body}
`);
console.log(`dist/webapp built (runtime ${(bytes / 1024).toFixed(0)} KB) · dist/artifact packaged`);

// ---------- single self-contained HTML file (opens from disk, no server) ----------
// Watchdog (classic script, runs even if the module cannot): if JARVIS has not started after
// 12 s, show why and what to do instead of an endless "loading".
const WATCHDOG = `<script>
(function(){var errs=[];addEventListener('error',function(e){errs.push(e.message||String(e.error||e));});addEventListener('unhandledrejection',function(e){errs.push(String(e.reason&&e.reason.message||e.reason));});
setTimeout(function(){if(window.JARVIS_BOOTED)return;var m=document.getElementById('bootMsg');if(!m)return;var why=window.JARVIS_BOOT_ERROR?window.JARVIS_BOOT_ERROR.message:(errs[0]||'the page scripts did not run');
m.innerHTML='<b>JARVIS לא הצליח לעלות כאן.</b><br>נראה שהקובץ נפתח בתצוגה מקדימה או בדפדפן שחוסם סקריפטים. שמרו את הקובץ במחשב ופתחו אותו בלחיצה כפולה ב-Chrome או Edge (גרסה עדכנית).<br><br><b>JARVIS could not start here.</b> Save the file and open it with a double-click in a current Chrome or Edge.<br><small style="opacity:.7">'+String(why).replace(/[<>&]/g,'')+'</small>';},12000);})();
</script>`;
{
  const r = await build({
    entryPoints: [path.join(root, 'web/runtime/standalone.js')],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false,
    plugins: [shimPlugin],
    banner: { js: 'globalThis.process ??= { env: {}, argv: [], memoryUsage: () => ({ rss: globalThis.performance?.memory?.usedJSHeapSize ?? 0 }) };' },
    logLevel: 'warning',
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const css = fs.readFileSync(path.join(root, 'web/styles.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
  const icon = `data:image/svg+xml;base64,${Buffer.from(fs.readFileSync(path.join(root, 'web/icon.svg'))).toString('base64')}`;
  const single = html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<link rel="manifest" href="manifest.webmanifest">', '')
    .replace('<link rel="icon" href="icon.svg">', `<link rel="icon" href="${icon}">`)
    .replace('<script type="module" src="js/runtime.js"></script>', () => `${WATCHDOG}\n<script type="module">\n${js}\n</script>`)
    .replace('<body>', `<body>\n<noscript><div style="padding:40px;font:16px system-ui;color:#ffd58a;background:#03060d;text-align:center" dir="rtl">JARVIS צריך JavaScript. פתחו את הקובץ בדפדפן (Chrome / Edge / Firefox / Safari) ולא בתצוגה מקדימה.<br>JARVIS needs JavaScript: open this file in a web browser, not in a preview.</div></noscript>`);
  // Check only the page markup (the bundle itself legitimately contains HTML templates for generated apps).
  if (/src="js\/|href="styles\.css"/.test(single.replace(js, ''))) throw new Error('single-file build still references external files');
  fs.writeFileSync(path.join(root, 'dist/jarvis.html'), single);
  fs.copyFileSync(path.join(root, 'dist/jarvis.html'), path.join(out, 'jarvis.html'));
  console.log(`dist/jarvis.html built (${(single.length / 1024 / 1024).toFixed(2)} MB, self-contained)`);
}
