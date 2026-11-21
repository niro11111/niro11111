// JARVIS dedicated database: SQLite (built into Node 22, no external server, one file).
//
// Schema (migrations below):
//   records(collection, id, data JSON, created_at, updated_at)  - every entity, keyed (collection, id)
//   meta(key, value JSON)                                         - settings and engine state
//   schema_migrations(version, applied_at)
//   + one SQL VIEW per main entity with typed columns (v_transactions, v_tasks, v_memories, ...)
//
// The in-memory Store stays the working set (fast, synchronous, same code in the browser).
// This backend loads it at start, and persists changes row by row: each flush compares rows
// of the changed collections with what was last written and upserts/deletes only the
// difference, inside one transaction (WAL mode: crash-safe, readers never block).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  [1, `CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), created_at TEXT, updated_at TEXT, PRIMARY KEY (collection, id)) WITHOUT ROWID;
       CREATE INDEX IF NOT EXISTS idx_records_created ON records(collection, created_at);
       CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`],
  [2, `CREATE VIEW IF NOT EXISTS v_transactions AS SELECT id, json_extract(data,'$.householdId') household_id, json_extract(data,'$.date') date, json_extract(data,'$.description') description, json_extract(data,'$.category') category, json_extract(data,'$.amount') / 100.0 amount, json_extract(data,'$.source') source FROM records WHERE collection='transactions';
       CREATE VIEW IF NOT EXISTS v_tasks AS SELECT id, json_extract(data,'$.title') title, json_extract(data,'$.priority') priority, json_extract(data,'$.due') due, json_extract(data,'$.done') done, created_at FROM records WHERE collection='tasks';
       CREATE VIEW IF NOT EXISTS v_memories AS SELECT id, json_extract(data,'$.type') type, json_extract(data,'$.content') content, json_extract(data,'$.provenance') provenance, json_extract(data,'$.domain') domain, created_at FROM records WHERE collection='memories';
       CREATE VIEW IF NOT EXISTS v_requests AS SELECT id, json_extract(data,'$.objective') objective, json_extract(data,'$.state') state, json_extract(data,'$.channel') channel, json_extract(data,'$.durationMs') duration_ms, json_extract(data,'$.plan.kind') kind, created_at FROM records WHERE collection='tasks_exec';
       CREATE VIEW IF NOT EXISTS v_tool_executions AS SELECT id, json_extract(data,'$.taskId') task_id, json_extract(data,'$.tool') tool, json_extract(data,'$.agent') agent, json_extract(data,'$.risk') risk, json_extract(data,'$.decision') decision, json_extract(data,'$.verified') verified, json_extract(data,'$.at') at FROM records WHERE collection='tool_executions';
       CREATE VIEW IF NOT EXISTS v_audit AS SELECT id, json_extract(data,'$.actor') actor, json_extract(data,'$.action') action, json_extract(data,'$.outcome') outcome, created_at FROM records WHERE collection='audit';
       CREATE VIEW IF NOT EXISTS v_proposals AS SELECT id, json_extract(data,'$.target') target, json_extract(data,'$.status') status, json_extract(data,'$.change') change, json_extract(data,'$.risk') risk, created_at FROM records WHERE collection='improvement_proposals';
       CREATE VIEW IF NOT EXISTS v_versions AS SELECT id, json_extract(data,'$.target') target, json_extract(data,'$.version') version, json_extract(data,'$.status') status, json_extract(data,'$.createdBy') created_by, json_extract(data,'$.reason') reason, created_at FROM records WHERE collection='config_versions';
       CREATE VIEW IF NOT EXISTS v_ml_models AS SELECT id, json_extract(data,'$.name') name, json_extract(data,'$.version') version, json_extract(data,'$.algorithm') algorithm, json_extract(data,'$.status') status, json_extract(data,'$.metrics.valAccuracy') val_accuracy, created_at FROM records WHERE collection='ml_models';
       CREATE VIEW IF NOT EXISTS v_kg_edges AS SELECT id, json_extract(data,'$.from') src, json_extract(data,'$.rel') rel, json_extract(data,'$.to') dst, json_extract(data,'$.weight') weight FROM records WHERE collection='kg_edges';`],
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1)[0];

export class SqliteBackend {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    const done = new Set(this.db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
    for (const [v, sql] of MIGRATIONS) if (!done.has(v)) { this.db.exec('BEGIN'); try { this.db.exec(sql); this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(v, new Date().toISOString()); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
    this.written = new Map(); // collection -> Map(id -> json) last persisted
    this.timer = null; this.store = null; this.flushes = 0; this.rowsWritten = 0;
    this.q = {
      upsert: this.db.prepare('INSERT INTO records (collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
      del: this.db.prepare('DELETE FROM records WHERE collection = ? AND id = ?'),
      meta: this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      metaDel: this.db.prepare('DELETE FROM meta WHERE key = ?'),
    };
  }

  /** Reads the whole database into the Store's data shape. */
  load() {
    const data = {};
    for (const r of this.db.prepare('SELECT collection, id, data FROM records ORDER BY collection, created_at, id').all()) {
      (data[r.collection] ??= []).push(JSON.parse(r.data));
      if (!this.written.has(r.collection)) this.written.set(r.collection, new Map());
      this.written.get(r.collection).set(r.id, r.data);
    }
    const meta = {};
    for (const r of this.db.prepare('SELECT key, value FROM meta').all()) meta[r.key] = JSON.parse(r.value);
    this.writtenMeta = new Map(Object.entries(meta).map(([k, v]) => [k, JSON.stringify(v)]));
    if (Object.keys(meta).length) data._meta = meta;
    return data;
  }

  isEmpty() { return this.db.prepare('SELECT COUNT(*) n FROM records').get().n === 0 && this.db.prepare('SELECT COUNT(*) n FROM meta').get().n === 0; }

  /** One-time import of an existing JSON store file (kept as a backup, never deleted). */
  importJson(jsonFile) {
    if (!fs.existsSync(jsonFile) || !this.isEmpty()) return 0;
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    this.attach({ data });
    const n = this.flush(new Set(Object.keys(data)));
    fs.copyFileSync(jsonFile, `${jsonFile}.imported-${Date.now()}.bak`);
    return n;
  }

  attach(store) { this.store = store; }
  /** Store.onSave hook: coalesce bursts of writes into one transaction. */
  schedule(dirty) {
    this.pending ??= new Set();
    for (const c of dirty) this.pending.add(c);
    dirty.clear?.();
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 40);
    this.timer.unref?.();
  }

  flush(cols = this.pending) {
    if (!this.store || !cols?.size) return 0;
    const set = new Set(cols); this.pending = new Set();
    let n = 0;
    this.db.exec('BEGIN');
    try {
      for (const col of set) {
        if (col === '_meta') { n += this.flushMeta(); continue; }
        const rows = this.store.data[col];
        if (!Array.isArray(rows)) continue;
        const prev = this.written.get(col) ?? new Map();
        const next = new Map();
        for (const r of rows) {
          if (!r?.id) continue;
          const json = JSON.stringify(r);
          next.set(r.id, json);
          if (prev.get(r.id) !== json) { this.q.upsert.run(col, r.id, json, r.createdAt ?? null, r.updatedAt ?? r.createdAt ?? null); n++; }
        }
        for (const id of prev.keys()) if (!next.has(id)) { this.q.del.run(col, id); n++; }
        this.written.set(col, next);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); for (const c of set) this.pending.add(c); throw e; }
    this.flushes++; this.rowsWritten += n;
    return n;
  }
  flushMeta() {
    const meta = this.store.data._meta ?? {};
    this.writtenMeta ??= new Map();
    let n = 0;
    for (const [k, v] of Object.entries(meta)) { const j = JSON.stringify(v); if (this.writtenMeta.get(k) !== j) { this.q.meta.run(k, j); this.writtenMeta.set(k, j); n++; } }
    for (const k of [...this.writtenMeta.keys()]) if (!(k in meta)) { this.q.metaDel.run(k); this.writtenMeta.delete(k); n++; }
    return n;
  }

  status() {
    const tables = this.db.prepare('SELECT collection, COUNT(*) rows, MAX(updated_at) last_update FROM records GROUP BY collection ORDER BY rows DESC').all().map((r) => ({ ...r }));
    const views = this.db.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all().map((r) => r.name);
    const size = fs.existsSync(this.file) ? fs.statSync(this.file).size + (fs.existsSync(`${this.file}-wal`) ? fs.statSync(`${this.file}-wal`).size : 0) : 0;
    return { engine: 'SQLite', version: this.db.prepare('SELECT sqlite_version() v').get().v, file: path.basename(this.file), schemaVersion: SCHEMA_VERSION, journal: this.db.prepare('PRAGMA journal_mode').get().journal_mode, sizeBytes: size, collections: tables.length, rows: tables.reduce((a, t) => a + t.rows, 0), tables, views, flushes: this.flushes, rowsWritten: this.rowsWritten };
  }
  integrity() { return { result: this.db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: this.db.prepare('PRAGMA foreign_key_check').all().length, at: new Date().toISOString() }; }
  backup(dir = path.join(path.dirname(path.resolve(this.file)), 'backups')) {
    this.flush(new Set([...Object.keys(this.store?.data ?? {})]));
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `jarvis-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    this.db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    return { file: path.basename(out), sizeBytes: fs.statSync(out).size };
  }

  /** Read-only SQL for the owner: a single SELECT/WITH on a separate read-only connection, capped rows. */
  query(sql, { limit = 500 } = {}) {
    const q = String(sql ?? '').trim().replace(/;\s*$/, '');
    if (!/^(select|with)\b/i.test(q) || q.includes(';')) throw Object.assign(new Error('only a single SELECT (or WITH ... SELECT) statement is allowed'), { status: 400 });
    if (/\b(pragma|attach|detach|vacuum|load_extension|insert|update|delete|drop|alter|create|replace)\b/i.test(q.replace(/'[^']*'/g, ''))) throw Object.assign(new Error('statement not allowed in the read-only console'), { status: 400 });
    this.flush(new Set(Object.keys(this.store?.data ?? {})));
    this.ro ??= new DatabaseSync(this.file, { readOnly: true });
    const t0 = Date.now();
    const rows = this.ro.prepare(`SELECT * FROM (${q}) LIMIT ${Math.min(5000, Math.max(1, Number(limit) || 500))}`).all().map((r) => ({ ...r }));
    return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, count: rows.length, ms: Date.now() - t0 };
  }
  close() { this.flush(new Set(Object.keys(this.store?.data ?? {}))); this.ro?.close(); this.db.close(); }
}

/** Opens (or creates) the database, imports a legacy JSON store once, and returns {data, backend}. */
export function openDatabase(file, { legacyJson = null } = {}) {
  const backend = new SqliteBackend(file);
  const imported = legacyJson ? backend.importJson(legacyJson) : 0;
  return { backend, data: backend.load(), imported };
}
