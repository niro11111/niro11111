import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 chars, no look-alikes

export function makeCode(len = 7) {
  return Array.from(randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function isValidUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function buildApp(db: Database) {
  const app = Fastify();
  const insert = db.prepare("INSERT INTO links (code, url) VALUES (?, ?)");
  const find = db.prepare("SELECT url FROM links WHERE code = ?");
  const hit = db.prepare("UPDATE links SET clicks = clicks + 1 WHERE code = ?");
  const stats = db.prepare("SELECT code, url, clicks, created_at FROM links WHERE code = ?");

  app.post<{ Body: { url?: string } }>("/api/links", async (req, reply) => {
    const url = req.body?.url ?? "";
    if (!isValidUrl(url)) {
      return reply.code(400).send({ code: "invalid_url", message: "url must be http(s)" });
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        insert.run(code, url);
        return reply.code(201).send({ code, short: `/${code}` });
      } catch (e) {
        if ((e as { code?: string }).code !== "SQLITE_CONSTRAINT_PRIMARYKEY") throw e;
      }
    }
    return reply.code(503).send({ code: "busy", message: "try again" });
  });

  app.get<{ Params: { code: string } }>("/api/links/:code", async (req, reply) => {
    const row = stats.get(req.params.code);
    return row ?? reply.code(404).send({ code: "not_found", message: "no such link" });
  });

  app.get<{ Params: { code: string } }>("/:code", async (req, reply) => {
    const row = find.get(req.params.code) as { url: string } | undefined;
    if (!row) return reply.code(404).send({ code: "not_found", message: "no such link" });
    hit.run(req.params.code);
    return reply.redirect(row.url, 302);
  });

  return app;
}
