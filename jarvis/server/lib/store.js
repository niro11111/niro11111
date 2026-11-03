// Small durable JSON store. Each collection is an array of records with an `id`.
// Writes are atomic (write temp file, then rename) so a crash never leaves half a file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const newId = (prefix = 'id') => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const now = () => new Date().toISOString();

// Collections that are synchronised to devices. Every change gets a monotonically
// increasing sequence number so a device can ask for "everything since seq N".
export const SYNCED = new Set(['tasks', 'reminders', 'events', 'notifications', 'approvals', 'workflows', 'shopping', 'memories', 'settings']);
const MAX_CHANGES = 5000;

export class Store {
  /** @param {string|null} file path to persist to, or null for in-memory only */
  /**
   * @param {string|null} file JSON file (Node). null = in memory.
   * @param {{data?:object, onSave?:(dirty:Set<string>)=>void}} opts browser persistence hooks
   */
  constructor(file = null, opts = {}) {
    this.file = file;
    this.data = opts.data ?? {};
    this.onSave = opts.onSave ?? null;
    this.dirty = new Set();
    if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  track(col, op, rec) {
    this.dirty.add(col);
    if (!SYNCED.has(col)) return;
    this.dirty.add('_changes');
    const meta = (this.data._meta ??= {});
    meta.seq = (meta.seq ?? 0) + 1;
    const ch = (this.data._changes ??= []);
    const { vector, ...clean } = rec ?? {};
    ch.push({ seq: meta.seq, col, op, id: rec?.id, at: now(), rec: op === 'delete' ? null : clean });
    if (ch.length > MAX_CHANGES) ch.splice(0, ch.length - MAX_CHANGES);
  }
  seq() { return this.data._meta?.seq ?? 0; }
  changesSince(seq) { return (this.data._changes ?? []).filter((c) => c.seq > seq); }
  col(name) { return (this.data[name] ??= []); }
  all(name, pred = () => true) { return this.col(name).filter(pred); }
  get(name, id) { return this.col(name).find((r) => r.id === id) ?? null; }
  insert(name, rec) {
    const r = { id: rec.id ?? newId(name.slice(0, 4)), createdAt: now(), ...rec };
    this.col(name).push(r);
    this.track(name, 'upsert', r);
    this.save();
    return r;
  }
  update(name, id, patch) {
    const r = this.get(name, id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: now() });
    this.track(name, 'upsert', r);
    this.save();
    return r;
  }
  remove(name, id) {
    const c = this.col(name);
    const i = c.findIndex((r) => r.id === id);
    if (i < 0) return false;
    const [gone] = c.splice(i, 1);
    this.track(name, 'delete', gone);
    this.save();
    return true;
  }
  getMeta(key, dflt = null) { return this.data._meta?.[key] ?? dflt; }
  setMeta(key, value) { (this.data._meta ??= {})[key] = value; this.dirty.add('_meta'); this.save(); }
  save() {
    if (this.onSave) { this.onSave(this.dirty); return; }
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
