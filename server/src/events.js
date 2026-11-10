// Outgoing events (webhooks) for automation platforms such as Make, Zapier or n8n.
// Each event is a JSON POST with an HMAC signature, sent in the background with retries:
// a slow or failing receiver never delays or breaks a user's request.
import crypto from "node:crypto";

export const EVENT_TYPES = ["user.registered", "user.deleted", "progress.milestone", "certificate.issued"];

export function sign(secret, timestamp, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
}

export function createEmitter({ url, secret = "", log, fetchImpl = globalThis.fetch, retries = 3, timeoutMs = 5000, baseDelayMs = 500 }) {
  const pending = new Set();
  if (!url) return { enabled: false, emit() {}, flush: async () => {} };

  async function deliver(type, body) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const ts = String(Math.floor(Date.now() / 1000));
      const headers = { "content-type": "application/json", "user-agent": "claude-code-academy-webhooks/1", "x-cca-event": type, "x-cca-timestamp": ts };
      if (secret) headers["x-cca-signature"] = sign(secret, ts, body);
      try {
        const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) return true;
        // a 4xx other than 408/429 means the receiver rejects this event: retrying won't help
        if (res.status < 500 && res.status !== 408 && res.status !== 429) { log?.warn({ type, status: res.status }, "webhook rejected"); return false; }
        log?.warn({ type, status: res.status, attempt }, "webhook failed, will retry");
      } catch (err) {
        log?.warn({ type, attempt, err: err.message }, "webhook delivery error, will retry");
      }
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
    log?.error({ type }, "webhook gave up after retries");
    return false;
  }

  return {
    enabled: true,
    emit(type, data) {
      const body = JSON.stringify({ id: crypto.randomUUID(), type, created_at: new Date().toISOString(), data });
      const p = deliver(type, body).finally(() => pending.delete(p));
      pending.add(p);
      return p;
    },
    // used on shutdown and in tests: wait for in-flight deliveries
    flush: () => Promise.allSettled([...pending])
  };
}
