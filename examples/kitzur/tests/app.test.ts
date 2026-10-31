import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/db.js";
import { buildApp, isValidUrl } from "../src/app.js";

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp(openDb(":memory:"));
});

describe("links", () => {
  it("creates a link, redirects and counts the click", async () => {
    const res = await app.inject({ method: "POST", url: "/api/links", payload: { url: "https://example.com" } });
    expect(res.statusCode).toBe(201);
    const { code } = res.json();

    const go = await app.inject({ url: `/${code}` });
    expect(go.statusCode).toBe(302);
    expect(go.headers.location).toBe("https://example.com");

    const st = await app.inject({ url: `/api/links/${code}` });
    expect(st.json().clicks).toBe(1);
  });

  it("rejects non-http urls", async () => {
    const res = await app.inject({ method: "POST", url: "/api/links", payload: { url: "javascript:alert(1)" } });
    expect(res.statusCode).toBe(400);
    expect(isValidUrl("ftp://x.y")).toBe(false);
  });

  it("returns 404 for unknown codes", async () => {
    expect((await app.inject({ url: "/nope123" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/links/nope123" })).statusCode).toBe(404);
  });
});
