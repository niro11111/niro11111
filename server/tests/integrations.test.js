// Webhooks to Make (signature, retries, events), the integration API, and the AI gateway against a mock Claude API.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { createEmitter, sign } from "../src/events.js";

const H = { "x-cca": "1", "content-type": "application/json" };
const cookieOf = res => { const c = res.headers["set-cookie"]; return (Array.isArray(c) ? c[0] : c || "").split(";")[0]; };
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => r(s)); });
const site = fs.mkdtempSync(path.join(os.tmpdir(), "cca-site-"));
fs.writeFileSync(path.join(site, "index.html"), "<!DOCTYPE html><title>t</title>");

// ---------- a local receiver standing in for a Make custom webhook ----------
let hook, received = [], failFirst = 0;
beforeAll(async () => {
  hook = await listen((req, res) => {
    let body = ""; req.on("data", d => body += d); req.on("end", () => {
      if (failFirst > 0) { failFirst--; res.writeHead(503); return res.end("busy"); }
      received.push({ headers: req.headers, body }); res.writeHead(200); res.end("Accepted");
    });
  });
});
afterAll(() => hook.close());
const hookUrl = () => "http://127.0.0.1:" + hook.address().port + "/hook";

describe("webhook emitter", () => {
  beforeEach(() => { received = []; failFirst = 0; });
  it("signs events with HMAC over timestamp.body", async () => {
    const e = createEmitter({ url: hookUrl(), secret: "s".repeat(32) });
    await e.emit("user.registered", { user_id: 1 });
    const r = received[0], ev = JSON.parse(r.body);
    expect(ev).toMatchObject({ type: "user.registered", data: { user_id: 1 } });
    expect(ev.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers["x-cca-signature"]).toBe(sign("s".repeat(32), r.headers["x-cca-timestamp"], r.body));
  });
  it("retries server errors with backoff and gives up on 4xx", async () => {
    failFirst = 2;
    const e = createEmitter({ url: hookUrl(), baseDelayMs: 5 });
    expect(await e.emit("x", {})).toBe(true);
    expect(received).toHaveLength(1);
    const bad = await listen((req, res) => { res.writeHead(410); res.end(); });
    let calls = 0; const counting = (u, o) => { calls++; return fetch(u, o); };
    const e2 = createEmitter({ url: "http://127.0.0.1:" + bad.address().port, baseDelayMs: 5, fetchImpl: counting });
    expect(await e2.emit("x", {})).toBe(false); expect(calls).toBe(1);
    bad.close();
  });
  it("never throws when the receiver is down", async () => {
    const e = createEmitter({ url: "http://127.0.0.1:1/none", baseDelayMs: 1, timeoutMs: 200 });
    expect(await e.emit("x", {})).toBe(false);
  });
});

describe("events from the app and the integration API", () => {
  let app, db;
  beforeEach(async () => {
    received = []; failFirst = 0;
    db = openDb(":memory:");
    const config = loadConfig({ NODE_ENV: "test", SITE_DIR: site, LOG_LEVEL: "silent", WEBHOOK_URL: hookUrl(), WEBHOOK_SECRET: "x".repeat(20), INTEGRATION_TOKEN: "t".repeat(30), PUBLIC_URL: "https://academy.example.com" });
    app = await buildApp({ config, db, logger: false, ai: null });
  });
  afterEach(async () => { await app.close(); db.close(); });
  const req = (m, u, b, c, h = {}) => app.inject({ method: m, url: u, headers: { ...H, ...(c ? { cookie: c } : {}), ...h }, payload: b === undefined ? undefined : JSON.stringify(b) });

  it("emits registration, milestone, certificate and deletion events (no email by default)", async () => {
    const c = cookieOf(await req("POST", "/api/auth/register", { email: "a@example.com", password: "correct horse battery", name: "Dana" }));
    const done = n => JSON.stringify({ state: { done: Object.fromEntries([...Array(n)].map((_, i) => ["c" + i, 1]).concat([["exam", 1]])) } });
    await req("PUT", "/api/progress", { at: 1, dev: "d", data: done(5) }, c);
    await req("PUT", "/api/progress", { at: 2, dev: "d", data: done(12) }, c);
    await req("PUT", "/api/progress", { at: 3, dev: "d", data: done(14) }, c);   // no new milestone
    await req("POST", "/api/certificates", { name: "Dana", score: 93 }, c);
    await req("POST", "/api/certificates", { name: "Dana K", score: 95 }, c);   // update: no second event
    await req("DELETE", "/api/me", { password: "correct horse battery" }, c);
    await app.close();   // flushes pending deliveries
    const types = received.map(r => JSON.parse(r.body).type);
    expect(types).toEqual(["user.registered", "progress.milestone", "certificate.issued", "user.deleted"]);
    const reg = JSON.parse(received[0].body).data;
    expect(reg).toEqual({ user_id: 1, name: "Dana" });
    expect(JSON.parse(received[1].body).data).toMatchObject({ milestone: 10, chapters: 13 });
    expect(JSON.parse(received[2].body).data.verify_url).toMatch(/^https:\/\/academy\.example\.com\/verify\/[A-Za-z0-9]{12}$/);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test", SITE_DIR: site, LOG_LEVEL: "silent" }), db, logger: false, ai: null });
  });
  it("integration API needs the bearer token and returns stats and certificates", async () => {
    const c = cookieOf(await req("POST", "/api/auth/register", { email: "a@example.com", password: "correct horse battery" }));
    await req("PUT", "/api/progress", { at: 1, dev: "d", data: JSON.stringify({ state: { done: { exam: 1 } } }) }, c);
    await req("POST", "/api/certificates", { name: "Dana", score: 90 }, c);
    expect((await app.inject({ method: "GET", url: "/api/integrations/stats" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/integrations/stats", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/api/integrations/stats", headers: { authorization: "Bearer " + "t".repeat(30) } });
    expect(ok.json()).toMatchObject({ users: 1, certificates: 1 });
    const certs = (await app.inject({ method: "GET", url: "/api/integrations/certificates?since=2000-01-01", headers: { authorization: "Bearer " + "t".repeat(30) } })).json();
    expect(certs.certificates[0]).toMatchObject({ name: "Dana", score: 90 });
    expect(JSON.stringify(certs)).not.toMatch(/email|user_id/);
    expect((await app.inject({ method: "GET", url: "/api/integrations/certificates?since=garbage", headers: { authorization: "Bearer " + "t".repeat(30) } })).statusCode).toBe(400);
  });
});

// ---------- a mock Claude API that speaks the real SSE event format ----------
let mock, mockCalls = [], mockMode = "text";
const sse = (res, events) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of events) res.write("event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n"); res.end(); };
const msgStart = { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "test-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 42, output_tokens: 0 } } };
beforeAll(async () => {
  mock = await listen((req, res) => {
    let body = ""; req.on("data", d => body += d); req.on("end", () => {
      const j = JSON.parse(body || "{}"); mockCalls.push({ headers: req.headers, body: j });
      if (mockMode === "rate") { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } })); }
      if (mockMode === "auth") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } })); }
      const last = j.messages[j.messages.length - 1];
      const wantsTool = mockMode === "tool" && !(Array.isArray(last.content) && last.content.some(b => b.type === "tool_result"));
      if (wantsTool) return sse(res, [msgStart,
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"src/a.js"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 9 } },
        { type: "message_stop" }]);
      sse(res, [msgStart,
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "שלום " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "עולם" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } },
        { type: "message_stop" }]);
    });
  });
});
afterAll(() => mock.close());

describe("AI gateway", () => {
  let app, db, cookie;
  const make = async extra => {
    db = openDb(":memory:");
    const config = loadConfig({ NODE_ENV: "test", SITE_DIR: site, LOG_LEVEL: "silent", ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:" + mock.address().port, AI_MODEL: "test-model", AI_MAX_TOKENS: "1000", AI_DAILY_REQUESTS: "3", ...extra });
    app = await buildApp({ config, db, logger: false });
    cookie = cookieOf(await app.inject({ method: "POST", url: "/api/auth/register", headers: H, payload: JSON.stringify({ email: "a@example.com", password: "correct horse battery" }) }));
  };
  const ai = (body, c = cookie) => app.inject({ method: "POST", url: "/api/ai", headers: { ...H, cookie: c }, payload: JSON.stringify(body) });
  const events = res => res.body.split("\n\n").filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, "")));
  beforeEach(() => { mockCalls = []; mockMode = "text"; });
  afterEach(async () => { await app.close(); db.close(); });

  it("streams text and ends with the final message; usage is recorded", async () => {
    await make();
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json().server.ai).toBe(true);
    const r = await ai({ messages: [{ role: "user", content: "hi" }], max_tokens: 99999 });
    expect(r.statusCode).toBe(400);   // over the hard maximum
    const ok = await ai({ messages: [{ role: "user", content: "hi" }], max_tokens: 5000 });
    expect(ok.headers["content-type"]).toMatch(/text\/event-stream/);
    const evs = events(ok);
    expect(evs.filter(e => e.type === "content_block_delta").map(e => e.delta.text).join("")).toBe("שלום עולם");
    const final = evs.find(e => e.type === "final").message;
    expect(final.content[0].text).toBe("שלום עולם"); expect(final.stop_reason).toBe("end_turn");
    const call = mockCalls[0];
    expect(call.headers["x-api-key"] || String(call.headers.authorization).replace(/^Bearer /, "")).toBe("test-key");
    expect(call.body).toMatchObject({ model: "test-model", max_tokens: 1000, stream: true });   // capped at AI_MAX_TOKENS
    expect(call.body.fallbacks).toBeUndefined();   // only for models that support it
    const usage = (await app.inject({ method: "GET", url: "/api/ai/usage", headers: { cookie } })).json();
    expect(usage).toMatchObject({ requests: 1, input_tokens: 42, output_tokens: 7, limit: 3 })   // the rejected request is not counted;
  });
  it("relays tool_use so the page can run its tools, then continues with tool results", async () => {
    await make(); mockMode = "tool";
    const tools = [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }];
    const first = events(await ai({ messages: [{ role: "user", content: "review" }], tools })).find(e => e.type === "final").message;
    expect(first.stop_reason).toBe("tool_use"); expect(first.content[0]).toMatchObject({ type: "tool_use", name: "read_file", input: { path: "src/a.js" } });
    const second = events(await ai({ messages: [{ role: "user", content: "review" }, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "const a = 1" }] }], tools })).find(e => e.type === "final").message;
    expect(second.content[0].text).toBe("שלום עולם");
    expect(mockCalls[1].body.tools[0].name).toBe("read_file");
  });
  it("enforces the daily quota, login, and validation", async () => {
    await make();
    for (let i = 0; i < 3; i++) expect((await ai({ messages: [{ role: "user", content: "x" }] })).statusCode).toBe(200);
    const q = await ai({ messages: [{ role: "user", content: "x" }] });
    expect(q.statusCode).toBe(429); expect(q.json().error).toBe("quota");
    expect((await ai({ messages: [{ role: "user", content: "x" }] }, "")).statusCode).toBe(401);
    expect((await ai({ messages: [{ role: "system", content: "x" }] })).statusCode).toBe(400);
    expect((await ai({ messages: [] })).statusCode).toBe(400);
  });
  it("maps upstream errors to clear responses and never leaks the key", async () => {
    await make({ AI_DAILY_REQUESTS: "0" });   // 0 = unlimited
    mockMode = "rate"; const r = await ai({ messages: [{ role: "user", content: "x" }] });
    expect(r.statusCode).toBe(429); expect(r.json().error).toBe("rate_limited");
    mockMode = "auth"; const a = await ai({ messages: [{ role: "user", content: "x" }] });
    expect(a.statusCode).toBe(502); expect(a.body).not.toContain("test-key");
  });
  it("uses server-side refusal fallbacks for models that support them", async () => {
    await make({ AI_MODEL: "claude-opus-5-5" });
    await ai({ messages: [{ role: "user", content: "x" }] });
    expect(mockCalls[0].body.fallbacks).toBe("default");
    expect(String(mockCalls[0].headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
  });
  it("is off without a key: /api/ai is 404 and the app hides AI", async () => {
    db = openDb(":memory:");
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test", SITE_DIR: site, LOG_LEVEL: "silent" }), db, logger: false });
    expect((await app.inject({ method: "GET", url: "/api/me" })).json().server.ai).toBe(false);
  });
});
