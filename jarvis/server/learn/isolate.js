// Isolated execution for code generated in the Development Lab.
//  * Browser: a dedicated Web Worker with network, storage and import APIs removed, killed on timeout.
//  * Node: a fresh vm context with no require/process, string code generation disabled, timeout.
// Input and output cross the boundary only as JSON. This is defense in depth on top of the
// static analysis in devlab.js (which rejects code touching globals, the network, eval, etc.);
// a production deployment should additionally run the lab in a container (see docs/LEARNING.md).

const WORKER_SRC = `
for (const k of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches','BroadcastChannel','navigator','Worker','SharedWorker']) { try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch {} }
onmessage = (e) => {
  try {
    const run = (new Function('"use strict";' + e.data.code + '\\n;return typeof run === "function" ? run : null;'))();
    if (!run) throw new Error('the code must define function run(input)');
    const t0 = performance.now();
    const out = run(JSON.parse(e.data.input));
    postMessage({ ok: true, out: JSON.stringify(out === undefined ? null : out), ms: performance.now() - t0 });
  } catch (err) { postMessage({ ok: false, error: String(err && err.message || err) }); }
};`;

function inWorker(code, input, timeoutMs) {
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))); }
    catch (e) { return resolve({ ok: false, error: `isolated execution is not available here: ${e.message}`, unavailable: true }); }
    const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, error: `timed out after ${timeoutMs} ms`, timeout: true }); }, timeoutMs);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data.ok ? { ok: true, out: JSON.parse(e.data.out), ms: e.data.ms } : e.data); };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); resolve({ ok: false, error: e.message || 'worker error' }); e.preventDefault?.(); };
    w.postMessage({ code, input: JSON.stringify(input ?? null) });
  });
}

async function inVm(code, input, timeoutMs) {
  const vm = await import('node:vm');
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, name: 'jarvis-devlab' });
  try {
    const t0 = Date.now();
    const src = `"use strict";${code}\n;(() => { if (typeof run !== 'function') throw new Error('the code must define function run(input)'); const r = run(JSON.parse(${JSON.stringify(JSON.stringify(input ?? null))})); return JSON.stringify(r === undefined ? null : r); })()`;
    const out = new vm.Script(src, { filename: 'devlab.js' }).runInContext(ctx, { timeout: timeoutMs, breakOnSigint: true });
    return { ok: true, out: JSON.parse(out), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), timeout: /timed out/i.test(String(e?.message)) };
  }
}

export async function runIsolated(code, input, { timeoutMs = 1000 } = {}) {
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') return inWorker(code, input, timeoutMs);
  return inVm(code, input, timeoutMs);
}
export const isolationKind = () => (typeof window !== 'undefined' ? 'web-worker (no network, no storage, killed on timeout)' : 'node vm context (no require/process, no eval, timeout)');
