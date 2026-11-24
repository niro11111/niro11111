// Entry for the single-file build (dist/jarvis.html): runtime + UI in one inline script,
// so the file opens directly from disk (file://) with no server and no other files.
globalThis.__JARVIS_APP__ = () => import('../js/app.js');
globalThis.JARVIS_SINGLE_FILE = true;
await import('./main.js');
