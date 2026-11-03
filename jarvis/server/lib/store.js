// Small durable JSON store. Each collection is an array of records with an `id`.
// Writes are atomic (write temp file, then rename) so a crash never leaves half a file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const newId = (prefix = 'id') => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const now = () => new Date().toISOString();

export class Store {
  /** @param {string|null} file path to persist to, or null for in-memory only */
  constructor(file = null) {
    this.file = file;
    this.data = {};
    if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  col(name) { return (this.data[name] ??= []); }
  all(name, pred = () => true) { return this.col(name).filter(pred); }
  get(name, id) { return this.col(name).find((r) => r.id === id) ?? null; }
  insert(name, rec) {
    const r = { id: rec.id ?? newId(name.slice(0, 4)), createdAt: now(), ...rec };
    this.col(name).push(r);
    this.save();
    return r;
  }
  update(name, id, patch) {
    const r = this.get(name, id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: now() });
    this.save();
    return r;
  }
  remove(name, id) {
    const c = this.col(name);
    const i = c.findIndex((r) => r.id === id);
    if (i < 0) return false;
    c.splice(i, 1);
    this.save();
    return true;
  }
  getMeta(key, dflt = null) { return this.data._meta?.[key] ?? dflt; }
  setMeta(key, value) { (this.data._meta ??= {})[key] = value; this.save(); }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
