// Local embedding: hashed bag of words + character trigrams, L2-normalised.
// Works for Hebrew and English with no network. A provider embedding (e.g. pgvector + an
// embeddings API) can replace this through the same embed(text) -> number[] interface.
const DIM = 512;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % DIM;
}

export function tokens(text) {
  return String(text).toLowerCase().normalize('NFKC')
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud
    .split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
}

export function embed(text) {
  const v = new Float64Array(DIM);
  for (const t of tokens(text)) {
    v[hash(t)] += 2;
    // strip common Hebrew prefixes (ה, ו, ב, ל, מ, ש, כ) so "החשבון" matches "חשבון"
    if (/^[הובלמשכ][א-ת]{2,}$/.test(t)) v[hash(t.slice(1))] += 1.5;
    const p = `#${t}#`;
    for (let i = 0; i < p.length - 2; i++) v[hash(p.slice(i, i + 3))] += 0.5;
  }
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

export function cosine(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
