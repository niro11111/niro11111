// Configuration from environment variables, validated once at startup.
// A bad value stops the server with a clear message instead of failing later.
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bool = z.enum(["true", "false", "1", "0"]).transform(v => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().default(path.join(here, "..", "data", "academy.db")),
  SITE_DIR: z.string().default(path.join(here, "..", "..", "site")),
  PUBLIC_URL: z.string().url().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default(false),   // zod 4: a default skips the transform, so it must already be a boolean
  ADMIN_EMAILS: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  BACKUP_DIR: z.string().optional(),
  BACKUP_EVERY_HOURS: z.coerce.number().min(0).default(0)
});

export function loadConfig(env = process.env) {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; ");
    throw new Error("Invalid configuration: " + msg);
  }
  const c = r.data;
  return {
    ...c,
    isProd: c.NODE_ENV === "production",
    cookieSecure: c.COOKIE_SECURE ?? c.NODE_ENV === "production",
    admins: new Set(c.ADMIN_EMAILS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean))
  };
}
