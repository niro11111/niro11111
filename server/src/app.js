// Fastify app: API (accounts, progress sync, certificates, admin), static web app, security headers.
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import crypto from "node:crypto";
import { hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256, randomId, escapeHtml, inlineScriptHashes } from "./security.js";
import { createEmitter } from "./events.js";
import { createAi, AiRequest, aiErrorResponse } from "./ai.js";

const COOKIE = "cca_sid";
const DAY = 86400000;
const MAX_PROGRESS = 900 * 1024;

const Email = z.string().trim().toLowerCase().email().max(254);
const Password = z.string().min(10, "הסיסמה צריכה לפחות 10 תווים").max(200);
const Name = z.string().trim().max(80);
const schemas = {
  register: z.object({ email: Email, password: Password, name: Name.optional().default("") }).strict(),
  login: z.object({ email: Email, password: z.string().min(1).max(200) }).strict(),
  password: z.object({ current: z.string().min(1).max(200), next: Password }).strict(),
  profile: z.object({ name: Name }).strict(),
  remove: z.object({ password: z.string().min(1).max(200) }).strict(),
  progress: z.object({ at: z.number().int().nonnegative(), dev: z.string().min(1).max(40), data: z.string().max(MAX_PROGRESS), baseAt: z.number().int().nonnegative().optional() }).strict(),
  cert: z.object({ name: Name.min(1), score: z.number().int().min(0).max(100) }).strict()
};

export async function buildApp({ config, db, logger, emitter, ai }) {
  const app = Fastify({
    logger: logger ?? { level: config.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'] },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024
  });

  // ---------- data access (prepared once) ----------
  const q = {
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userById: db.prepare("SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)"),
    setLogin: db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?"),
    setPass: db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?"),
    setName: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
    passHash: db.prepare("SELECT pass_hash FROM users WHERE id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)"),
    session: db.prepare("SELECT s.id_hash, s.user_id, s.expires_at, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?"),
    extendSession: db.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id_hash = ?"),
    deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?"),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    sessionsOf: db.prepare("SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC"),
    progress: db.prepare("SELECT at, dev, data, updated_at FROM progress WHERE user_id = ?"),
    upsertProgress: db.prepare("INSERT INTO progress (user_id, at, dev, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at, dev = excluded.dev, data = excluded.data, updated_at = excluded.updated_at"),
    certOf: db.prepare("SELECT id, name, score, chapters, issued_at FROM certificates WHERE user_id = ?"),
    certById: db.prepare("SELECT id, name, score, chapters, issued_at FROM certificates WHERE id = ?"),
    insertCert: db.prepare("INSERT INTO certificates (id, user_id, name, score, chapters, issued_at) VALUES (?, ?, ?, ?, ?, ?)"),
    updateCert: db.prepare("UPDATE certificates SET name = ?, score = ?, chapters = ? WHERE user_id = ?"),
    event: db.prepare("INSERT INTO events (user_id, type, ip, at) VALUES (?, ?, ?, ?)"),
    failedRecent: db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND type = 'login_failed' AND at > ?"),
    eventsOf: db.prepare("SELECT type, at FROM events WHERE user_id = ? ORDER BY at DESC LIMIT 200"),
    stats: db.prepare(`SELECT (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE last_login_at > ?) AS active7d,
      (SELECT COUNT(*) FROM progress) AS withProgress,
      (SELECT COUNT(*) FROM certificates) AS certificates,
      (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS activeSessions`)
  };
  const log = (userId, type, req) => q.event.run(userId, type, req.ip || "", Date.now());
  const events = emitter ?? createEmitter({ url: config.WEBHOOK_URL, secret: config.WEBHOOK_SECRET, log: app.log });
  const gateway = ai === undefined ? createAi(config) : ai;
  const publicUrl = path => (config.PUBLIC_URL ? config.PUBLIC_URL.replace(/\/$/, "") : "") + path;
  q.aiUsage = db.prepare("SELECT requests, input_tokens, output_tokens FROM ai_usage WHERE user_id = ? AND day = ?");
  q.aiCount = db.prepare("INSERT INTO ai_usage (user_id, day, requests) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1");
  q.aiTokens = db.prepare("UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE user_id = ? AND day = ?");
  q.recentCerts = db.prepare("SELECT c.id, c.name, c.score, c.chapters, c.issued_at FROM certificates c WHERE c.issued_at > ? ORDER BY c.issued_at DESC LIMIT ?");
  const doneCount = data => { try { return Object.keys((JSON.parse(data).state || {}).done || {}).length; } catch { return 0; } };

  // ---------- plugins ----------
  const indexFile = path.join(config.SITE_DIR, "index.html");
  const hasSite = fs.existsSync(indexFile);
  const scriptHashes = hasSite ? inlineScriptHashes(fs.readFileSync(indexFile, "utf8")) : [];
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...scriptHashes],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", errorResponseBuilder: (req, ctx) => ({ statusCode: 429, error: "rate_limited", message: "יותר מדי בקשות. נסו שוב בעוד " + Math.ceil(ctx.ttl / 1000) + " שניות." }) });

  // ---------- CSRF: state changes need our custom header, a JSON body and (when sent) our own Origin ----------
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-cca-server", "1");
    if (!req.url.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers["x-cca"] !== "1") return reply.code(403).send({ error: "csrf", message: "בקשה נחסמה (חסרה כותרת אבטחה)." });
    const origin = req.headers.origin;
    if (origin) {
      let host = "";
      try { host = new URL(origin).host; } catch { /* bad origin */ }
      const allowed = new Set([req.headers.host, config.PUBLIC_URL ? new URL(config.PUBLIC_URL).host : null].filter(Boolean));
      if (!allowed.has(host)) return reply.code(403).send({ error: "csrf", message: "בקשה ממקור לא מורשה." });
    }
  });

  // ---------- session ----------
  const cookieOpts = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge: config.SESSION_DAYS * 86400 });
  const setSession = (reply, userId, req) => {
    const token = newToken(), now = Date.now(), exp = now + config.SESSION_DAYS * DAY;
    q.insertSession.run(sha256(token), userId, now, exp, String(req.headers["user-agent"] || "").slice(0, 200));
    reply.setCookie(COOKIE, token, cookieOpts());
    return sha256(token);
  };
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (!token || token.length > 100) return;
    const s = q.session.get(sha256(token), Date.now());
    if (!s) return;
    req.user = { id: s.user_id, email: s.email, name: s.name, sid: s.id_hash };
    // sliding expiry: renew when less than half the lifetime is left, in the database AND in the browser
    // (renewing only the database row would still log people out when the original cookie expires)
    if (s.expires_at - Date.now() < (config.SESSION_DAYS * DAY) / 2) {
      q.extendSession.run(Date.now() + config.SESSION_DAYS * DAY, s.id_hash);
      reply.setCookie(COOKIE, token, cookieOpts());
    }
  });
  const auth = async (req, reply) => { if (!req.user) return reply.code(401).send({ error: "unauthorized", message: "צריך להתחבר." }); };
  const parse = (schema, body, reply) => {
    const r = schema.safeParse(body ?? {});
    if (!r.success) { reply.code(400).send({ error: "invalid", message: r.error.issues[0].message, field: r.error.issues[0].path.join(".") }); return null; }
    return r.data;
  };
  const publicUser = u => ({ id: u.id, email: u.email, name: u.name });
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  // ---------- health ----------
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get("/readyz", { config: { rateLimit: false } }, async (req, reply) => {
    try { db.prepare("SELECT 1").get(); return { ok: true, db: "up", site: hasSite }; } catch { return reply.code(503).send({ ok: false, db: "down" }); }
  });

  // ---------- accounts ----------
  app.post("/api/auth/register", authLimit, async (req, reply) => {
    const b = parse(schemas.register, req.body, reply); if (!b) return;
    if (q.userByEmail.get(b.email)) return reply.code(409).send({ error: "exists", message: "כבר יש חשבון עם האימייל הזה. נסו להתחבר." });
    const hash = await hashPassword(b.password);
    let info;
    try { info = q.insertUser.run(b.email, b.name, hash, Date.now()); }
    catch (err) {
      // two sign-ups with the same email at once both pass the check above (hashing awaits); the UNIQUE index decides
      if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") return reply.code(409).send({ error: "exists", message: "כבר יש חשבון עם האימייל הזה. נסו להתחבר." });
      throw err;
    }
    const id = Number(info.lastInsertRowid);
    setSession(reply, id, req); q.setLogin.run(Date.now(), id); log(id, "register", req);
    events.emit("user.registered", { user_id: id, name: b.name, ...(config.WEBHOOK_INCLUDE_PII ? { email: b.email } : {}) });
    return reply.code(201).send({ user: publicUser({ id, email: b.email, name: b.name }) });
  });

  app.post("/api/auth/login", authLimit, async (req, reply) => {
    const b = parse(schemas.login, req.body, reply); if (!b) return;
    const u = q.userByEmail.get(b.email);
    if (u && q.failedRecent.get(u.id, Date.now() - 15 * 60000).n >= 10) {
      return reply.code(429).send({ error: "locked", message: "יותר מדי ניסיונות כושלים לחשבון הזה. נסו שוב בעוד 15 דקות." });
    }
    const ok = await verifyPassword(b.password, u ? u.pass_hash : DUMMY_HASH);
    if (!u || !ok) { if (u) log(u.id, "login_failed", req); return reply.code(401).send({ error: "bad_credentials", message: "אימייל או סיסמה שגויים." }); }
    setSession(reply, u.id, req); q.setLogin.run(Date.now(), u.id); log(u.id, "login", req);
    return { user: publicUser(u) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.user) { q.deleteSession.run(req.user.sid); log(req.user.id, "logout", req); }
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async req => ({ user: req.user ? publicUser(req.user) : null, server: { version: 2, ai: !!gateway } }));

  app.patch("/api/me", { preHandler: auth }, async (req, reply) => {
    const b = parse(schemas.profile, req.body, reply); if (!b) return;
    q.setName.run(b.name, req.user.id);
    return { user: publicUser({ ...req.user, name: b.name }) };
  });

  app.post("/api/auth/password", { preHandler: auth, ...authLimit }, async (req, reply) => {
    const b = parse(schemas.password, req.body, reply); if (!b) return;
    if (!(await verifyPassword(b.current, q.passHash.get(req.user.id).pass_hash))) return reply.code(401).send({ error: "bad_credentials", message: "הסיסמה הנוכחית שגויה." });
    q.setPass.run(await hashPassword(b.next), req.user.id);
    q.deleteOtherSessions.run(req.user.id, req.user.sid);   // a changed password logs out every other device
    log(req.user.id, "password_changed", req);
    return { ok: true };
  });

  app.get("/api/me/sessions", { preHandler: auth }, async req => ({ sessions: q.sessionsOf.all(req.user.id) }));

  app.post("/api/me/logout-others", { preHandler: auth }, async req => {
    const n = q.deleteOtherSessions.run(req.user.id, req.user.sid).changes;
    log(req.user.id, "logout_others", req);
    return { ok: true, closed: n };
  });

  // personal data: full export and permanent deletion
  app.get("/api/me/export", { preHandler: auth }, async (req, reply) => {
    const p = q.progress.get(req.user.id);
    reply.header("content-disposition", 'attachment; filename="claude-code-academy-my-data.json"');
    return { exportedAt: new Date().toISOString(), user: q.userById.get(req.user.id), progress: p ? { ...p, data: JSON.parse(p.data) } : null, certificate: q.certOf.get(req.user.id) || null, sessions: q.sessionsOf.all(req.user.id), events: q.eventsOf.all(req.user.id) };
  });

  app.delete("/api/me", { preHandler: auth, ...authLimit }, async (req, reply) => {
    const b = parse(schemas.remove, req.body, reply); if (!b) return;
    if (!(await verifyPassword(b.password, q.passHash.get(req.user.id).pass_hash))) return reply.code(401).send({ error: "bad_credentials", message: "הסיסמה שגויה." });
    q.deleteUser.run(req.user.id);   // sessions, progress, certificate, AI usage and events cascade
    events.emit("user.deleted", { user_id: req.user.id });
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  // ---------- progress sync (same document shape the app uses with claude.ai storage) ----------
  app.get("/api/progress", { preHandler: auth }, async req => {
    const p = q.progress.get(req.user.id);
    return p ? { exists: true, at: p.at, dev: p.dev, data: p.data } : { exists: false };
  });

  app.put("/api/progress", { preHandler: auth }, async (req, reply) => {
    const b = parse(schemas.progress, req.body, reply); if (!b) return;
    let parsed;
    try { parsed = JSON.parse(b.data); } catch { return reply.code(400).send({ error: "invalid", message: "data must be JSON" }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply.code(400).send({ error: "invalid", message: "data must be a JSON object" });
    const cur = q.progress.get(req.user.id);
    // optimistic concurrency: if another device saved after what this one last saw, send the newer copy back to merge
    if (cur && b.baseAt !== undefined && cur.at > b.baseAt && cur.dev !== b.dev) {
      return reply.code(409).send({ error: "conflict", current: { at: cur.at, dev: cur.dev, data: cur.data } });
    }
    q.upsertProgress.run(req.user.id, b.at, b.dev, b.data, Date.now());
    // milestones for automations (e.g. a Make scenario that sends a congratulation email)
    const before = cur ? doneCount(cur.data) : 0, after = doneCount(b.data);
    const crossed = [10, 25, 50].filter(m => before < m && after >= m);
    if (crossed.length) events.emit("progress.milestone", { user_id: req.user.id, chapters: after, milestone: crossed[crossed.length - 1] });
    return { ok: true, at: b.at };
  });

  // ---------- certificates: issued only when the stored progress shows a passed exam ----------
  app.post("/api/certificates", { preHandler: auth }, async (req, reply) => {
    const b = parse(schemas.cert, req.body, reply); if (!b) return;
    const p = q.progress.get(req.user.id);
    let st = {};
    try { st = JSON.parse(p ? p.data : "{}").state || {}; } catch { /* ignore */ }
    if (!st.done || !st.done.exam) return reply.code(403).send({ error: "not_eligible", message: "התעודה ניתנת אחרי מעבר מבחן הגמר, כשההתקדמות מסונכרנת לשרת." });
    const chapters = Object.keys(st.done).length;
    const existing = q.certOf.get(req.user.id);
    if (existing) q.updateCert.run(b.name, b.score, chapters, req.user.id);
    else q.insertCert.run(randomId(12), req.user.id, b.name, b.score, chapters, Date.now());
    if (!existing) { const c0 = q.certOf.get(req.user.id); events.emit("certificate.issued", { user_id: req.user.id, certificate_id: c0.id, name: c0.name, score: c0.score, chapters: c0.chapters, verify_url: publicUrl("/verify/" + c0.id) }); }
    const c = q.certOf.get(req.user.id);
    log(req.user.id, "certificate", req);
    return reply.code(existing ? 200 : 201).send({ certificate: c, url: "/verify/" + c.id });
  });

  app.get("/api/certificates/:id", async (req, reply) => {
    const id = String(req.params.id);
    const c = /^[A-Za-z0-9]{8,24}$/.test(id) && q.certById.get(id);
    if (!c) return reply.code(404).send({ error: "not_found", message: "לא נמצאה תעודה כזו." });
    return { certificate: c };
  });

  app.get("/verify/:id", async (req, reply) => {
    const id = String(req.params.id);
    const c = /^[A-Za-z0-9]{8,24}$/.test(id) && q.certById.get(id);
    const date = c ? new Date(c.issued_at).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" }) : "";
    reply.type("text/html; charset=utf-8").code(c ? 200 : 404);
    return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>אימות תעודה · אקדמיית Claude Code</title><meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;background:#f6f4ef;color:#1c1b19;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:2px solid #1c1b19;border-radius:6px;padding:32px 24px;max-width:480px;width:100%;text-align:center}h1{font-size:1.4rem;margin:.2em 0}.ok{color:#16794a;font-weight:800}.bad{color:#b4231f;font-weight:800}.nm{font-size:1.8rem;font-weight:800;margin:.3em 0}a{color:#0d7568}@media(prefers-color-scheme:dark){body{background:#15171a;color:#eee}main{background:#1f2226;border-color:#eee}.ok{color:#4fd28e}.bad{color:#ff7b7b}a{color:#3cc8b0}}</style></head><body><main>${c
      ? `<p class="ok">✓ תעודה מאומתת</p><h1>אקדמיית Claude Code · תעודת סיום</h1><div class="nm">${escapeHtml(c.name)}</div><p>ציון במבחן הגמר: <b>${c.score}</b> · פרקים שהושלמו: <b>${c.chapters}</b></p><p>הונפקה ב-${escapeHtml(date)}</p><p><small>מזהה: ${escapeHtml(c.id)}</small></p>`
      : `<p class="bad">✗ לא נמצאה תעודה עם המזהה הזה</p><h1>אקדמיית Claude Code</h1>`}<p><a href="/">לאקדמיה</a></p></main></body></html>`;
  });

  // ---------- AI gateway ----------
  app.post("/api/ai", { preHandler: auth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!gateway) return reply.code(404).send({ error: "ai_disabled", message: "ה-AI לא מופעל בשרת הזה." });
    const r = AiRequest.safeParse(req.body ?? {});
    if (!r.success) return reply.code(400).send({ error: "invalid", message: r.error.issues[0].message, field: r.error.issues[0].path.join(".") });
    const day = new Date().toISOString().slice(0, 10);
    const used = q.aiUsage.get(req.user.id, day);
    if (config.AI_DAILY_REQUESTS && used && used.requests >= config.AI_DAILY_REQUESTS) {
      return reply.code(429).send({ error: "quota", message: "הגעתם למכסת ה-AI היומית (" + config.AI_DAILY_REQUESTS + " בקשות). היא מתאפסת בחצות UTC." });
    }
    q.aiCount.run(req.user.id, day);
    reply.hijack();
    const raw = reply.raw, ctl = new AbortController();
    let started = false, done = false;
    req.raw.on("close", () => { if (!done) ctl.abort(); });
    const start = () => { if (started) return; started = true; raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "x-content-type-options": "nosniff", "x-cca-server": "1" }); };
    const send = obj => raw.write("data: " + JSON.stringify(obj) + "\n\n");
    try {
      const s = gateway.stream(r.data, ctl.signal);
      for await (const ev of s) { start(); send(ev); }
      const final = await s.finalMessage();
      start(); send({ type: "final", message: final });
      q.aiTokens.run(final.usage?.input_tokens || 0, final.usage?.output_tokens || 0, req.user.id, day);
    } catch (err) {
      if (ctl.signal.aborted) { done = true; return raw.end(); }
      const [status, code, message] = aiErrorResponse(err);
      req.log.warn({ code, status: err.status }, "ai request failed");
      if (!started) { raw.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-cca-server": "1" }); raw.end(JSON.stringify({ error: code, message })); done = true; return; }
      send({ type: "error", error: code, message });
    }
    done = true; raw.end();
  });

  app.get("/api/ai/usage", { preHandler: auth }, async req => {
    const u = q.aiUsage.get(req.user.id, new Date().toISOString().slice(0, 10)) || { requests: 0, input_tokens: 0, output_tokens: 0 };
    return { enabled: !!gateway, limit: config.AI_DAILY_REQUESTS, ...u };
  });

  // ---------- integrations: read-only API for Make / Zapier / n8n (Bearer token) ----------
  const integration = async (req, reply) => {
    const token = config.INTEGRATION_TOKEN;
    if (!token) return reply.code(404).send({ error: "not_found", message: "לא נמצא." });
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(sha256(got)), b2 = Buffer.from(sha256(token));
    if (!got || !crypto.timingSafeEqual(a, b2)) return reply.code(401).send({ error: "unauthorized", message: "טוקן אינטגרציה שגוי." });
  };
  app.get("/api/integrations/stats", { preHandler: integration }, async () => ({ ...q.stats.get(Date.now() - 7 * DAY, Date.now()), at: new Date().toISOString() }));
  app.get("/api/integrations/certificates", { preHandler: integration }, async (req, reply) => {
    const since = Date.parse(String(req.query.since || "1970-01-01"));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    if (Number.isNaN(since)) return reply.code(400).send({ error: "invalid", message: "since must be an ISO date" });
    return { certificates: q.recentCerts.all(since, limit).map(c => ({ ...c, issued_at: new Date(c.issued_at).toISOString(), verify_url: publicUrl("/verify/" + c.id) })) };
  });

  // ---------- admin ----------
  app.get("/api/admin/stats", { preHandler: auth }, async (req, reply) => {
    if (!config.admins.has(req.user.email.toLowerCase())) return reply.code(403).send({ error: "forbidden", message: "אין הרשאה." });
    return q.stats.get(Date.now() - 7 * DAY, Date.now());
  });

  // ---------- the web app ----------
  if (hasSite) {
    await app.register(fastifyStatic, {
      root: config.SITE_DIR, index: ["index.html"], wildcard: true,
      setHeaders(res, file) {
        // @fastify/static 10 passes the reply; older versions pass the raw response
        const set = (k, v) => (typeof res.setHeader === "function" ? res.setHeader(k, v) : res.header(k, v));
        set("cache-control", /(index|404)\.html$|sw\.js$|manifest\.webmanifest$/.test(file) ? "no-cache" : "public, max-age=604800");
      }
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || !hasSite) return reply.code(404).send({ error: "not_found", message: "לא נמצא." });
    return reply.code(404).type("text/html; charset=utf-8").sendFile(fs.existsSync(path.join(config.SITE_DIR, "404.html")) ? "404.html" : "index.html");
  });
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode === 429) return reply.code(429).send(err.error ? err : { error: "rate_limited", message: err.message });
    if (err.validation || err.statusCode === 400 || err.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || err.code === "FST_ERR_CTP_EMPTY_JSON_BODY") return reply.code(err.statusCode || 400).send({ error: "invalid", message: "בקשה לא תקינה." });
    if (err.statusCode === 413) return reply.code(413).send({ error: "too_large", message: "הבקשה גדולה מדי." });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal", message: "שגיאה בשרת. נסו שוב." });   // never leak stack traces
  });

  // housekeeping: drop expired sessions now and every hour
  q.purgeSessions.run(Date.now());
  const t = setInterval(() => q.purgeSessions.run(Date.now()), 3600000); t.unref();
  app.addHook("onClose", async () => { clearInterval(t); await events.flush(); });
  return app;
}
