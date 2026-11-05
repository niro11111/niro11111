// One-off backup: node scripts/backup.js [dir]. Safe while the server runs (SQLite online backup).
import { loadConfig } from "../src/config.js";
import { openDb, backup } from "../src/db.js";

const config = loadConfig();
const dir = process.argv[2] || config.BACKUP_DIR || "./backups";
const db = openDb(config.DATABASE_PATH);
const file = await backup(db, dir);
db.close();
console.log("backup written:", file);
