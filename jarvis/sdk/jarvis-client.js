// JARVIS client SDK (plain JS: web, React Native/Expo, Node). Handles auth, the sync change
// feed, an offline operation queue with idempotent opIds and exponential-backoff retries.
// Storage is injectable (AsyncStorage on mobile, localStorage on web, a Map in tests).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export class MemoryStorage {
  constructor() { this.m = new Map(); }
  async getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async setItem(k, v) { this.m.set(k, v); }
  async removeItem(k) { this.m.delete(k); }
}

export class JarvisClient {
  /**
   * @param {{baseUrl:string, token:string, storage?:any, fetch?:Function, maxRetries?:number}} o
   */
  constructor({ baseUrl, token, storage = new MemoryStorage(), fetch: f = globalThis.fetch, maxRetries = 5 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token; this.storage = storage; this.fetch = f; this.maxRetries = maxRetries;
    this.listeners = new Set();
  }

  async request(path, { method = 'GET', body } = {}) {
    const r = await this.fetch(`${this.baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(data?.error ?? `HTTP ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  // ---------- convenience calls ----------
  command(text, channel = 'text') { return this.request('/api/command', { method: 'POST', body: { text, channel } }); }
  glance(lang = 'he') { return this.request(`/api/watch/glance?lang=${lang}`); }
  approvals() { return this.request('/api/approvals'); }
  decide(id, decision) { return this.request(`/api/approvals/${id}`, { method: 'POST', body: { decision } }); }
  uploadHealth(days) { return this.request('/api/wellness/ingest', { method: 'POST', body: { days } }); }

  // ---------- offline queue ----------
  async queue() { return JSON.parse((await this.storage.getItem('jarvis.queue')) ?? '[]'); }
  async saveQueue(q) { await this.storage.setItem('jarvis.queue', JSON.stringify(q)); }

  /** Queue an operation (works offline). Returns the opId. */
  async enqueue(type, payload) {
    const op = { opId: uid(), type, payload, clientTime: new Date().toISOString() };
    const q = await this.queue(); q.push(op); await this.saveQueue(q);
    return op.opId;
  }

  /** Push queued ops. Retries network/5xx errors with backoff; drops ops the server rejected. */
  async flush() {
    let q = await this.queue();
    if (!q.length) return { sent: 0, results: [] };
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.request('/api/sync/push', { method: 'POST', body: { ops: q.slice(0, 100) } });
        // every op the server answered (applied, duplicate, conflict, error) has been recorded there
        const done = new Set(res.results.map((x) => x.opId));
        q = (await this.queue()).filter((o) => !done.has(o.opId));
        await this.saveQueue(q);
        this.emit({ type: 'flushed', results: res.results });
        return { sent: res.results.length, results: res.results };
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) throw e; // auth/validation: don't retry
        if (attempt >= this.maxRetries) throw e;
        await sleep(Math.min(30000, 250 * 2 ** attempt));
      }
    }
  }

  // ---------- change feed ----------
  async pull() {
    const since = Number((await this.storage.getItem('jarvis.seq')) ?? 0);
    const res = await this.request(`/api/sync?since=${since}`);
    const state = JSON.parse((await this.storage.getItem('jarvis.state')) ?? '{}');
    for (const c of res.changes) {
      const col = (state[c.col] ??= {});
      if (c.op === 'delete') delete col[c.id]; else col[c.id] = c.rec;
    }
    await this.storage.setItem('jarvis.state', JSON.stringify(state));
    await this.storage.setItem('jarvis.seq', String(res.seq));
    if (res.changes.length) this.emit({ type: 'changes', changes: res.changes });
    return { seq: res.seq, applied: res.changes.length };
  }

  /** Local replica of a collection (as of the last pull). */
  async local(col) { return Object.values(JSON.parse((await this.storage.getItem('jarvis.state')) ?? '{}')[col] ?? {}); }

  async sync() { const pushed = await this.flush(); const pulled = await this.pull(); return { pushed, pulled }; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const f of this.listeners) f(e); }
}
