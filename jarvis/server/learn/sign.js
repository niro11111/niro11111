// Integrity signatures for versioned configuration and Development Lab artifacts.
// Nested keyed SHA-256 (HMAC-style: H(k ‖ H(k ‖ m))) with a per-install key. It detects
// changes made to stored versions or artifacts outside the learning engine (tampering,
// corruption, a hand-edited store); it is not a defense against someone who holds the key.
import { createHash, randomUUID } from 'node:crypto';

const h = (x) => createHash('sha256').update(x).digest('hex');
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function key(store) {
  let k = store.getMeta('learnSigningKey', null);
  if (!k) { k = `${randomUUID()}${randomUUID()}`; store.setMeta('learnSigningKey', k); }
  return k;
}
export const digest = (value) => h(canonical(value ?? null));
export function sign(store, value) { const k = key(store); return h(`${k}:${h(`${k}:${canonical(value ?? null)}`)}`); }
export function verify(store, value, signature) { return !!signature && sign(store, value) === signature; }
