// Edge cases and abuse: races, Unicode, odd inputs, big payloads, header tricks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { loadConfig } from "../src/config.js";

let app, db;
const H = { "x-cca": "1", "content-type": "application/json" };
const cookieOf = r => { const c = r.headers["set-cookie"]; return (Array.isArray(c) ? c[0] : c || "").split(";")[0]; };
const req = (m, u, b, c, h = {}) => app.inject({ method: m, url: u, headers: { ...H, ...(c ? { cookie: c } : {}), ...h }, payload: b === undefined ? undefined : typeof b === "string" ? b : JSON.stringify(b) });
beforeEach(async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "cca-edge-"));
  fs.writeFileSync(path.join(site, "index.html"), "<!DOCTYPE html><title>t</title>");
  db = openDb(":memory:");
  app = await buildApp({ config: loadConfig({ NODE_ENV: "test", SITE_DIR: site, LOG_LEVEL: "silent" }), db, logger: false, ai: null });
});
afterEach(async () => { await app.close(); db.close(); });

describe("races", () => {
  it("two registrations with the same email at once: one 201, one 409, never 500", async () => {
    const body = { email: "race@example.com", password: "correct horse battery" };
    const rs = await Promise.all([req("POST", "/api/auth/register", body), req("POST", "/api/auth/register", body), req("POST", "/api/auth/register", { ...body, email: "RACE@example.com" })]);
    const codes = rs.map(r => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(1);
  });
  it("concurrent certificate requests create exactly one certificate", async () => {
    const c = cookieOf(await req("POST", "/api/auth/register", { email: "a@example.com", password: "correct horse battery" }));
    await req("PUT", "/api/progress", { at: 1, dev: "d", data: JSON.stringify({ state: { done: { exam: 1 } } }) }, c);
    const rs = await Promise.all([1, 2, 3].map(() => req("POST", "/api/certificates", { name: "Dana", score: 90 }, c)));
    expect(rs.every(r => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM certificates").get().n).toBe(1);
  });
});

describe("odd input", () => {
  it("Unicode names and emails, and NFKC-equivalent passwords", async () => {
    const r = await req("POST", "/api/auth/register", { email: "dana@example.com", password: "ｐａｓｓｗｏｒｄ１２３４", name: "דנה 🚀 O'Brien" });
    expect(r.statusCode).toBe(201); expect(r.json().user.name).toBe("דנה 🚀 O'Brien");
    expect((await req("POST", "/api/auth/login", { email: "dana@example.com", password: "password1234" })).statusCode).toBe(200);   // full-width digits normalize
  });
  it("rejects wrong types, nulls, arrays and prototype tricks without 500", async () => {
    // raw JSON strings, as an attacker would send them (a JS object literal can't hold a real "__proto__" key)
    for (const raw of ["null", "[]", '"text"', "42", '{"email":1,"password":2}', '{"email":"a@example.com","password":null}', '{"__proto__":{"admin":true},"email":"x@example.com","password":"correct horse battery"}', '{"constructor":{"prototype":{"x":1}},"email":"y@example.com","password":"correct horse battery"}']) {
      const b = raw;
      const r = await req("POST", "/api/auth/register", raw);
      expect(r.statusCode, JSON.stringify(b)).toBeGreaterThanOrEqual(400); expect(r.statusCode, JSON.stringify(b)).toBeLessThan(500);
    }
    expect({}.admin).toBeUndefined();
  });
  it("wrong content type and empty body give 4xx, not 500", async () => {
    const c = cookieOf(await req("POST", "/api/auth/register", { email: "a@example.com", password: "correct horse battery" }));
    for (const [ct, body] of [["text/plain", "hi"], ["application/json", ""], ["application/x-www-form-urlencoded", "a=1"], ["application/json", "{\"at\":1e400}"]]) {
      const r = await app.inject({ method: "PUT", url: "/api/progress", headers: { "x-cca": "1", "content-type": ct, cookie: c }, payload: body });
      expect(r.statusCode, ct + " " + body).toBeGreaterThanOrEqual(400); expect(r.statusCode).toBeLessThan(500);
    }
  });
  it("body over the limit is 413", async () => {
    const r = await req("POST", "/api/auth/login", JSON.stringify({ email: "a@example.com", password: "x".repeat(2 * 1024 * 1024) }));
    expect(r.statusCode).toBe(413);
  });
  it("progress data that is valid JSON but huge numbers or deep nesting is handled", async () => {
    const c = cookieOf(await req("POST", "/api/auth/register", { email: "a@example.com", password: "correct horse battery" }));
    let deep = "{}"; for (let i = 0; i < 2000; i++) deep = '{"a":' + deep + "}";
    const r = await req("PUT", "/api/progress", { at: 1, dev: "d", data: deep }, c);
    expect(r.statusCode).toBeLessThan(500);
    expect((await req("PUT", "/api/progress", { at: Number.MAX_SAFE_INTEGER + 2, dev: "d", data: "{}" }, c)).statusCode).toBe(400);
  });
});

describe("headers and URLs", () => {
  it("odd Origin values are refused, not crashed on", async () => {
    for (const origin of ["null", "garbage", "http://", "file://", "http://evil.example"]) {
      const r = await req("POST", "/api/auth/logout", {}, "", { origin, host: "academy.example" });
      expect(r.statusCode, origin).toBe(403);
    }
  });
  it("several cookies and a duplicated session cookie are handled", async () => {
    const c = cookieOf(await req("POST", "/api/auth/register", { email: "a@example.com", password: "correct horse battery" }));
    const r = await req("GET", "/api/me", undefined, "other=1; " + c + "; cca_sid=forged");
    expect(r.statusCode).toBe(200);
  });
  it("certificate ids with odd characters are 404, and the verify page escapes everything", async () => {
    for (const id of ["%3Cscript%3E", "..%2F..%2Fetc", "a".repeat(500), "x'%20OR%201=1--"]) {
      expect((await app.inject({ method: "GET", url: "/api/certificates/" + id })).statusCode, id).toBe(404);
      const v = await app.inject({ method: "GET", url: "/verify/" + id });
      expect(v.statusCode).toBe(404); expect(v.body).not.toContain("<script>");
    }
  });
  it("HEAD and OPTIONS on API routes don't crash", async () => {
    expect((await app.inject({ method: "HEAD", url: "/api/me" })).statusCode).toBeLessThan(500);
    expect((await app.inject({ method: "OPTIONS", url: "/api/progress" })).statusCode).toBeLessThan(500);
  });
});
