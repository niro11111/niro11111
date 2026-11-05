// Password hashing (scrypt), session tokens and small crypto helpers. Node's crypto only, no native add-ons.
import crypto from "node:crypto";

const N = 1 << 15, r = 8, p = 1, KEYLEN = 64;
const maxmem = (n, rr) => 128 * n * rr * 2;
// async scrypt runs on the libuv thread pool, so a login never blocks other requests
const scrypt = (pw, salt, len, opts) => new Promise((res, rej) => crypto.scrypt(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: maxmem(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, n, rr, pp, salt, key] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(key, "base64");
    const got = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: +n, r: +rr, p: +pp, maxmem: maxmem(+n, +rr) });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

// checked against when the email doesn't exist, so a login takes the same time either way
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString("hex"));

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
export function randomId(len = 12) {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
}

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// sha256 hashes of every inline <script> in the page, for a strict Content-Security-Policy
export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    out.push("'sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64") + "'");
  }
  return out;
}
