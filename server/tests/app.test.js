// API tests through fastify.inject: accounts, security, sync, certificates, privacy, static app.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { openDb, migrate, backup } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { hashPassword, verifyPassword, inlineScriptHashes } from "../src/security.js";

let app, db, site;
const H = { "x-cca": "1", "content-type": "application/json" };
const cookieOf = res => { const c = res.headers["set-cookie"]; const s = Array.isArray(c) ? c[0] : c; return s ? s.split(";")[0] : ""; };
const req = (method, url, body, cookie, headers = {}) => app.inject({ method, url, headers: { ...H, ...(cookie ? { cookie } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
const register = async (email = "a@example.com", password = "correct horse battery", name = "Dana") => {
  const r = await req("POST", "/api/auth/register", { email, password, name });
  return { res: r, cookie: cookieOf(r) };
};

beforeEach(async () => {
  site = fs.mkdtempSync(path.join(os.tmpdir(), "cca-site-"));
  fs.writeFileSync(path.join(site, "index.html"), "<!DOCTYPE html><html><head><title>t</title></head><body><script>console.log(1)</script></body></html>");
  fs.writeFileSync(path.join(site, "404.html"), "<!DOCTYPE html><title>404</title>");
  fs.writeFileSync(path.join(site, "sw.js"), "self.x=1");
  db = openDb(":memory:");
  const config = loadConfig({ NODE_ENV: "test", SITE_DIR: site, ADMIN_EMAILS: "admin@example.com", LOG_LEVEL: "silent" });
  app = await buildApp({ config, db, logger: false });
});
afterEach(async () => { await app.close(); db.close(); });

describe("config and crypto", () => {
  it("rejects bad configuration with a clear message", () => {
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/PORT/);
    expect(loadConfig({}).TRUST_PROXY).toBe(false);
    expect(loadConfig({ TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ NODE_ENV: "production" }).cookieSecure).toBe(true);
  });
  it("hashes passwords with a salt and verifies them", async () => {
    const a = await hashPassword("secret password 1"), b = await hashPassword("secret password 1");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$/);
    expect(await verifyPassword("secret password 1", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("migrations are idempotent", () => {
    expect(migrate(db)).toBe(1);
    expect(migrate(db)).toBe(1);
  });
  it("computes CSP hashes for inline scripts only", () => {
    expect(inlineScriptHashes('<script>a</script><script src="x.js"></script>')).toHaveLength(1);
  });
});

describe("accounts", () => {
  it("registers, sets a secure session cookie and returns the user", async () => {
    const { res, cookie } = await register();
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: "a@example.com", name: "Dana" });
    const set = String(res.headers["set-cookie"]);
    expect(set).toMatch(/HttpOnly/i); expect(set).toMatch(/SameSite=Lax/i);
    expect(db.prepare("SELECT pass_hash FROM users").get().pass_hash).not.toContain("correct horse");
    expect(db.prepare("SELECT id_hash FROM sessions").get().id_hash).not.toBe(cookie.split("=")[1]);   // only a hash of the token is stored
    const me = await req("GET", "/api/me", undefined, cookie);
    expect(me.json().user.email).toBe("a@example.com");
    expect(me.headers["x-cca-server"]).toBe("1");
  });
  it("validates input and refuses duplicates (case-insensitive)", async () => {
    expect((await req("POST", "/api/auth/register", { email: "nope", password: "correct horse battery" })).statusCode).toBe(400);
    const short = await req("POST", "/api/auth/register", { email: "b@example.com", password: "short" });
    expect(short.statusCode).toBe(400); expect(short.json().field).toBe("password");
    expect((await req("POST", "/api/auth/register", { email: "b@example.com", password: "correct horse battery", admin: true })).statusCode).toBe(400);   // unknown fields rejected
    await register("c@example.com");
    expect((await req("POST", "/api/auth/register", { email: "C@Example.com", password: "correct horse battery" })).statusCode).toBe(409);
  });
  it("logs in, refuses wrong passwords with one generic message, logs out", async () => {
    await register();
    const bad = await req("POST", "/api/auth/login", { email: "a@example.com", password: "wrong password" });
    const none = await req("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong password" });
    expect(bad.statusCode).toBe(401); expect(none.statusCode).toBe(401);
    expect(bad.json().message).toBe(none.json().message);   // no account enumeration
    const ok = await req("POST", "/api/auth/login", { email: "A@example.com", password: "correct horse battery" });
    expect(ok.statusCode).toBe(200);
    const c = cookieOf(ok);
    expect((await req("POST", "/api/auth/logout", {}, c)).statusCode).toBe(200);
    expect((await req("GET", "/api/me", undefined, c)).json().user).toBeNull();
  });
  it("locks an account after 10 failed logins", async () => {
    await register();
    db.prepare("INSERT INTO events (user_id, type, ip, at) SELECT 1, 'login_failed', '', ? FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10)").run(Date.now());
    const r = await req("POST", "/api/auth/login", { email: "a@example.com", password: "correct horse battery" });
    expect(r.statusCode).toBe(429); expect(r.json().error).toBe("locked");
  });
  it("rate-limits the login endpoint", async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await req("POST", "/api/auth/login", { email: "x" + i + "@example.com", password: "whatever pass" });
    expect(last.statusCode).toBe(429);
  });
  it("changing the password logs out other devices", async () => {
    const { cookie } = await register();
    const other = cookieOf(await req("POST", "/api/auth/login", { email: "a@example.com", password: "correct horse battery" }));
    expect((await req("POST", "/api/auth/password", { current: "wrong", next: "a brand new password" }, cookie)).statusCode).toBe(401);
    expect((await req("POST", "/api/auth/password", { current: "correct horse battery", next: "a brand new password" }, cookie)).statusCode).toBe(200);
    expect((await req("GET", "/api/me", undefined, other)).json().user).toBeNull();
    expect((await req("GET", "/api/me", undefined, cookie)).json().user).not.toBeNull();
    expect((await req("POST", "/api/auth/login", { email: "a@example.com", password: "a brand new password" })).statusCode).toBe(200);
  });
  it("updates the profile name", async () => {
    const { cookie } = await register();
    expect((await req("PATCH", "/api/me", { name: "נועה" }, cookie)).json().user.name).toBe("נועה");
  });
});

describe("security", () => {
  it("blocks state changes without the CSRF header or from another origin", async () => {
    const { cookie } = await register();
    const noHeader = await app.inject({ method: "PUT", url: "/api/progress", headers: { cookie, "content-type": "application/json" }, payload: JSON.stringify({ at: 1, dev: "d", data: "{}" }) });
    expect(noHeader.statusCode).toBe(403);
    const evil = await req("PUT", "/api/progress", { at: 1, dev: "d", data: "{}" }, cookie, { origin: "https://evil.example", host: "academy.example" });
    expect(evil.statusCode).toBe(403);
    const same = await req("PUT", "/api/progress", { at: 1, dev: "d", data: "{}" }, cookie, { origin: "http://academy.example", host: "academy.example" });
    expect(same.statusCode).toBe(200);
  });
  it("requires login for private endpoints", async () => {
    for (const [m, u] of [["GET", "/api/progress"], ["PUT", "/api/progress"], ["GET", "/api/me/export"], ["DELETE", "/api/me"], ["POST", "/api/certificates"], ["GET", "/api/admin/stats"]]) {
      expect((await req(m, u, m === "GET" ? undefined : {})).statusCode, m + " " + u).toBe(401);
    }
  });
  it("ignores forged or oversized session cookies", async () => {
    expect((await req("GET", "/api/me", undefined, "cca_sid=forged")).json().user).toBeNull();
    expect((await req("GET", "/api/me", undefined, "cca_sid=" + "x".repeat(500))).json().user).toBeNull();
  });
  it("sends strict security headers with a hash-based CSP", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    const csp = r.headers["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'sha256-/); expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toMatch(/frame-ancestors 'none'/); expect(csp).toMatch(/object-src 'none'/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
  it("never leaks internals in errors and rejects bad JSON", async () => {
    const { cookie } = await register();
    const r = await app.inject({ method: "PUT", url: "/api/progress", headers: { ...H, cookie }, payload: "{not json" });
    expect(r.statusCode).toBe(400); expect(r.body).not.toMatch(/at .*\.js/);
    expect((await req("PUT", "/api/progress", { at: 1, dev: "d", data: "[1,2]" }, cookie)).statusCode).toBe(400);
    expect((await req("PUT", "/api/progress", { at: 1, dev: "d", data: "x".repeat(950 * 1024) }, cookie)).statusCode).toBe(400);
  });
});

describe("progress sync", () => {
  const doc = (at, dev, xp) => ({ at, dev, data: JSON.stringify({ state: { xp, done: {} } }) });
  it("stores and returns the progress document", async () => {
    const { cookie } = await register();
    expect((await req("GET", "/api/progress", undefined, cookie)).json()).toEqual({ exists: false });
    expect((await req("PUT", "/api/progress", doc(100, "laptop", 50), cookie)).statusCode).toBe(200);
    const g = (await req("GET", "/api/progress", undefined, cookie)).json();
    expect(g).toMatchObject({ exists: true, at: 100, dev: "laptop" }); expect(JSON.parse(g.data).state.xp).toBe(50);
  });
  it("returns 409 with the newer copy when another device saved in between", async () => {
    const { cookie } = await register();
    await req("PUT", "/api/progress", doc(200, "phone", 80), cookie);
    const c = await req("PUT", "/api/progress", { ...doc(150, "laptop", 60), baseAt: 100 }, cookie);
    expect(c.statusCode).toBe(409); expect(c.json().current.dev).toBe("phone");
    expect((await req("PUT", "/api/progress", { ...doc(300, "laptop", 90), baseAt: 200 }, cookie)).statusCode).toBe(200);
    expect((await req("PUT", "/api/progress", { ...doc(400, "laptop", 95), baseAt: 100 }, cookie)).statusCode).toBe(200);   // same device: no conflict
  });
  it("keeps users' data apart", async () => {
    const a = (await register("a@example.com")).cookie, b = (await register("b@example.com")).cookie;
    await req("PUT", "/api/progress", doc(1, "d", 999), a);
    expect((await req("GET", "/api/progress", undefined, b)).json()).toEqual({ exists: false });
  });
});

describe("certificates", () => {
  it("is refused before the exam, issued after it, and verifiable publicly", async () => {
    const { cookie } = await register();
    expect((await req("POST", "/api/certificates", { name: "Dana", score: 90 }, cookie)).statusCode).toBe(403);
    await req("PUT", "/api/progress", { at: 1, dev: "d", data: JSON.stringify({ state: { done: { intro: 1, exam: 1 } } }) }, cookie);
    const r = await req("POST", "/api/certificates", { name: "Dana <script>", score: 90 }, cookie);
    expect(r.statusCode).toBe(201);
    const { certificate, url } = r.json();
    expect(certificate.chapters).toBe(2);
    expect((await req("POST", "/api/certificates", { name: "Dana K", score: 95 }, cookie)).statusCode).toBe(200);   // re-issue updates, same id
    const pub = await app.inject({ method: "GET", url: "/api/certificates/" + certificate.id });
    expect(pub.json().certificate).toMatchObject({ id: certificate.id, name: "Dana K", score: 95 });
    expect(pub.json().certificate.user_id).toBeUndefined();
    await req("PUT", "/api/progress", { at: 2, dev: "d", data: JSON.stringify({ state: { done: { exam: 1 } } }) }, cookie);
    await req("POST", "/api/certificates", { name: "<img src=x onerror=alert(1)>", score: 95 }, cookie);
    const page = await app.inject({ method: "GET", url });
    expect(page.statusCode).toBe(200); expect(page.body).toContain("תעודה מאומתת"); expect(page.body).not.toContain("<img src=x"); expect(page.body).toContain("&lt;img");
    expect((await app.inject({ method: "GET", url: "/verify/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/certificates/../../etc" })).statusCode).toBe(404);
  });
});

describe("privacy and admin", () => {
  it("exports all personal data and deletes the account with every row", async () => {
    const { cookie } = await register();
    await req("PUT", "/api/progress", { at: 1, dev: "d", data: JSON.stringify({ state: { done: { exam: 1 } } }) }, cookie);
    await req("POST", "/api/certificates", { name: "Dana", score: 90 }, cookie);
    const ex = await req("GET", "/api/me/export", undefined, cookie);
    expect(ex.headers["content-disposition"]).toMatch(/attachment/);
    expect(ex.json()).toMatchObject({ user: { email: "a@example.com" }, progress: { data: { state: { done: { exam: 1 } } } }, certificate: { name: "Dana" } });
    expect(JSON.stringify(ex.json())).not.toMatch(/pass_hash|id_hash/);
    expect((await req("DELETE", "/api/me", { password: "wrong" }, cookie)).statusCode).toBe(401);
    expect((await req("DELETE", "/api/me", { password: "correct horse battery" }, cookie)).statusCode).toBe(200);
    for (const t of ["users", "sessions", "progress", "certificates", "events"]) expect(db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n, t).toBe(0);
  });
  it("lists sessions and logs out other devices", async () => {
    const { cookie } = await register();
    const other = cookieOf(await req("POST", "/api/auth/login", { email: "a@example.com", password: "correct horse battery" }));
    expect((await req("GET", "/api/me/sessions", undefined, cookie)).json().sessions).toHaveLength(2);
    expect((await req("POST", "/api/me/logout-others", {}, cookie)).json().closed).toBe(1);
    expect((await req("GET", "/api/me", undefined, other)).json().user).toBeNull();
  });
  it("admin stats only for admins", async () => {
    const u = (await register("u@example.com")).cookie, a = (await register("admin@example.com")).cookie;
    expect((await req("GET", "/api/admin/stats", undefined, u)).statusCode).toBe(403);
    expect((await req("GET", "/api/admin/stats", undefined, a)).json()).toMatchObject({ users: 2 });
  });
});

describe("web app and operations", () => {
  it("serves the app with the right cache headers and a 404 page", async () => {
    const i = await app.inject({ method: "GET", url: "/" });
    expect(i.statusCode).toBe(200); expect(i.headers["cache-control"]).toBe("no-cache");
    expect((await app.inject({ method: "GET", url: "/sw.js" })).headers["cache-control"]).toBe("no-cache");
    const nf = await app.inject({ method: "GET", url: "/nothing-here" });
    expect(nf.statusCode).toBe(404); expect(nf.body).toContain("404");
    expect((await app.inject({ method: "GET", url: "/api/nothing" })).json().error).toBe("not_found");
  });
  it("blocks path traversal", async () => {
    expect((await app.inject({ method: "GET", url: "/../../../etc/passwd" })).body).not.toMatch(/root:/);
    expect((await app.inject({ method: "GET", url: "/%2e%2e/%2e%2e/etc/passwd" })).body).not.toMatch(/root:/);
  });
  it("health and readiness", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/readyz" })).json()).toMatchObject({ ok: true, db: "up", site: true });
  });
  it("backs up a live database", async () => {
    const file = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cca-db-")), "a.db"));
    file.prepare("INSERT INTO users (email, pass_hash, created_at) VALUES ('z@example.com', 'x', 1)").run();
    const out = await backup(file, fs.mkdtempSync(path.join(os.tmpdir(), "cca-bk-")));
    const copy = openDb(out);
    expect(copy.prepare("SELECT email FROM users").get().email).toBe("z@example.com");
    copy.close(); file.close();
  });
  it("compresses large responses", async () => {
    fs.writeFileSync(path.join(site, "big.js"), "x".repeat(50000));
    const r = await app.inject({ method: "GET", url: "/big.js", headers: { "accept-encoding": "gzip" } });
    expect(r.headers["content-encoding"]).toBe("gzip");
  });
});
