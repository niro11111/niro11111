// SQLite database: WAL mode, foreign keys, numbered migrations tracked in user_version.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = [
  // 1: accounts, sessions, progress, certificates, audit events
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL DEFAULT '',
     pass_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_login_at INTEGER
   );
   CREATE TABLE sessions (
     id_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     user_agent TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE INDEX sessions_expiry ON sessions(expires_at);
   CREATE TABLE progress (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     at INTEGER NOT NULL,
     dev TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE certificates (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
     chapters INTEGER NOT NULL DEFAULT 0,
     issued_at INTEGER NOT NULL
   );
   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     type TEXT NOT NULL,
     ip TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL
   );
   CREATE INDEX events_user_type ON events(user_id, type, at);`,
  // 2: AI usage per user per day (quota and cost visibility)
  `CREATE TABLE ai_usage (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     requests INTEGER NOT NULL DEFAULT 0,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );`
];

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

export function migrate(db) {
  const v = db.pragma("user_version", { simple: true });
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma("user_version = " + (i + 1)); })();
  }
  return db.pragma("user_version", { simple: true });
}

// consistent online backup; safe while the server is running
export async function backup(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "academy-" + new Date().toISOString().replace(/[:.]/g, "-") + ".db");
  await db.backup(file);
  return file;
}
