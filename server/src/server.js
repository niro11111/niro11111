// Entry point: config, database, HTTP server, scheduled backups, graceful shutdown.
import { loadConfig } from "./config.js";
import { openDb, backup, pruneBackups } from "./db.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
const app = await buildApp({ config, db });

let timer = null;
if (config.BACKUP_DIR && config.BACKUP_EVERY_HOURS > 0) {
  const run = () => backup(db, config.BACKUP_DIR).then(f => {
    const removed = pruneBackups(config.BACKUP_DIR, config.BACKUP_KEEP);
    app.log.info({ file: f, removed: removed.length }, "backup done");
  }, err => app.log.error({ err }, "backup failed"));
  timer = setInterval(run, config.BACKUP_EVERY_HOURS * 3600000);
  timer.unref();
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 10000); force.unref();
  try { if (timer) clearInterval(timer); await app.close(); db.close(); process.exit(0); }
  catch (err) { app.log.error({ err }, "shutdown failed"); process.exit(1); }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", err => app.log.error({ err }, "unhandled rejection"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
