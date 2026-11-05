// Bearer-token auth for the local API. Token comes from JARVIS_TOKEN or is generated once
// and stored in the data directory. Constant-time comparison.
import crypto from 'node:crypto';

export function resolveToken(store) {
  if (process.env.JARVIS_TOKEN) return process.env.JARVIS_TOKEN;
  let t = store.getMeta('apiToken');
  if (!t) { t = crypto.randomBytes(24).toString('hex'); store.setMeta('apiToken', t); }
  return t;
}

export function checkToken(expected, header) {
  const got = (header || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
