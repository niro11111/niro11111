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
  BACKUP_EVERY_HOURS: z.coerce.number().min(0).default(0),
  // AI gateway (optional): the tutor and AI features on your own server
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().regex(/^[a-z0-9.-]+$/, "a model id such as the ones on the Anthropic models page").optional(),
  AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).max(64000).default(8000),
  AI_DAILY_REQUESTS: z.coerce.number().int().min(0).max(100000).default(100),
  AI_FALLBACKS: z.enum(["auto", "on", "off"]).default("auto"),
  // automation (optional): signed events to Make / Zapier / n8n, and a read-only integration API
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(16, "use at least 16 random characters").optional(),
  WEBHOOK_INCLUDE_PII: bool.default(false),
  INTEGRATION_TOKEN: z.string().min(24, "use at least 24 random characters").optional()
});

export function loadConfig(env = process.env) {
  // an empty value (e.g. "PUBLIC_URL=" copied from .env.example) means "not set", not an invalid value
  const r = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
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
