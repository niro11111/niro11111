// Browser persistence for the JARVIS store. Collections are saved in chunks (<= ~180 KB each)
// to the claude.ai per-user database (private to the viewer) or to localStorage.
// Derived data (memory vectors) is dropped and rebuilt; logs are capped.
const CAP = { audit: 400, tasks_exec: 120, notifications: 200, workflow_runs: 60, sync_ops: 300, voice_transcripts: 200, _changes: 300 };
const CHUNK = 180_000;

function prepare(data, col) {
  if (col === '_meta') return [data._meta ?? {}];
  let arr = data[col] ?? [];
  if (CAP[col] && arr.length > CAP[col]) { arr.splice(0, arr.length - CAP[col]); }
  if (col === 'memories') arr = arr.map(({ vector, tf, ...r }) => r);
  if (col === 'tasks_exec') arr = arr.map((t) => (t.plan ? { ...t, plan: { ...t.plan, steps: t.plan.steps.map(({ data: _d, ...s }) => s) } } : t));
  return arr;
}

function chunks(items) {
  const out = []; let cur = []; let size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length;
    if (cur.length && size + n > CHUNK) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += n;
  }
  out.push(cur);
  return out;
}

export class LocalBackend {
  constructor(prefix = 'jarvis.v1') { this.p = prefix; this.kind = 'browser'; }
  async load() {
    const man = JSON.parse(localStorage.getItem(`${this.p}.manifest`) ?? 'null');
    if (!man) return null;
    const data = {};
    for (const [col, n] of Object.entries(man.cols)) {
      const items = [];
      for (let i = 0; i < n; i++) items.push(...JSON.parse(localStorage.getItem(`${this.p}.${col}.${i}`) ?? '[]'));
      data[col] = col === '_meta' ? items[0] ?? {} : items;
    }
    return data;
  }
  async saveCol(col, parts, man) {
    const prev = man.cols[col] ?? 0;
    parts.forEach((p, i) => localStorage.setItem(`${this.p}.${col}.${i}`, JSON.stringify(p)));
    for (let i = parts.length; i < prev; i++) localStorage.removeItem(`${this.p}.${col}.${i}`);
    man.cols[col] = parts.length;
  }
  async saveManifest(man) { localStorage.setItem(`${this.p}.manifest`, JSON.stringify(man)); }
  async manifest() { return JSON.parse(localStorage.getItem(`${this.p}.manifest`) ?? 'null') ?? { cols: {} }; }
  async wipe() { for (const k of Object.keys(localStorage)) if (k.startsWith(this.p)) localStorage.removeItem(k); }
}

export class DbBackend {
  constructor(db, uid) { this.db = db; this.base = `data/users/${uid}`; this.kind = 'claude'; }
  doc(name) { return this.db.doc(`${this.base}/${name}`); }
  async manifest() { const s = await this.doc('manifest').get(); return s.exists ? { cols: { ...(s.data().cols ?? {}) } } : { cols: {} }; }
  async load() {
    const man = await this.manifest();
    if (!Object.keys(man.cols).length) return null;
    const data = {};
    for (const [col, n] of Object.entries(man.cols)) {
      const items = [];
      for (let i = 0; i < n; i++) { const s = await this.doc(`c${col}.${i}`).get(); if (s.exists) items.push(...(s.data().items ?? [])); }
      data[col] = col === '_meta' ? items[0] ?? {} : items;
    }
    return data;
  }
  async saveCol(col, parts, man) {
    const prev = man.cols[col] ?? 0;
    for (let i = 0; i < parts.length; i++) await this.doc(`c${col}.${i}`).set({ items: parts[i] });
    for (let i = parts.length; i < prev; i++) await this.doc(`c${col}.${i}`).delete();
    man.cols[col] = parts.length;
  }
  async saveManifest(man) { await this.doc('manifest').set({ cols: man.cols, savedAt: new Date().toISOString() }); }
  async wipe() { const man = await this.manifest(); for (const [col, n] of Object.entries(man.cols)) for (let i = 0; i < n; i++) await this.doc(`c${col}.${i}`).delete(); await this.doc('manifest').delete(); }
}

/** Debounced, sequential saver: one write at a time, only changed collections. */
export class Persister {
  constructor(store, backend, onStatus = () => {}) {
    this.store = store; this.backend = backend; this.onStatus = onStatus; this.timer = null; this.chain = Promise.resolve(); this.man = null;
    store.onSave = () => this.schedule();
    const flushNow = () => { if (this.timer) { clearTimeout(this.timer); this.timer = null; this.flush(); } };
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
    addEventListener('pagehide', flushNow);
  }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1200); }
  /** Saves every collection (first run). */
  saveAll() { for (const k of Object.keys(this.store.data)) this.store.dirty.add(k); return this.flush(); }
  flush() {
    const dirty = [...this.store.dirty]; this.store.dirty.clear();
    if (!dirty.length) return this.chain;
    this.chain = this.chain.then(async () => {
      this.onStatus('saving');
      try {
        this.man ??= await this.backend.manifest();
        for (const col of dirty) await this.backend.saveCol(col, chunks(prepare(this.store.data, col)), this.man);
        await this.backend.saveManifest(this.man);
        this.onStatus('saved');
      } catch (e) {
        for (const c of dirty) this.store.dirty.add(c); // keep for the next attempt
        this.onStatus('error', e?.code === 'quota_exceeded' || e?.name === 'QuotaExceededError' ? 'storage is full' : (e?.message ?? String(e)));
      }
    });
    return this.chain;
  }
}
