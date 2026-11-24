// Text features for Hebrew and English: normalization, word unigrams + bigrams and character
// trigrams, hashed into a fixed number of dimensions (the hashing trick) with sub-linear TF and
// L2 normalization. Hashing means the model never stores a vocabulary of raw words.

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export function normalizeText(t) {
  return String(t ?? '').toLowerCase()
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud and cantillation
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/^(?:hey\s+)?jarvis[,:]?\s*|^ג'?ארוויס[,:]?\s*/i, '')
    .replace(/\d+(?:[.,]\d+)?/g, ' 0 ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
// Common Hebrew one-letter prefixes (ו, ה, ב, ל, מ, ש, כ) are split off as an extra token.
const PREFIX = /^([והבלמשכ])(\p{L}{3,})$/u;
export function tokens(t) {
  const out = [];
  for (const w of normalizeText(t).split(' ').filter(Boolean)) { out.push(w); const m = w.match(PREFIX); if (m) out.push(m[2]); }
  return out;
}

function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

/** Feature groups and their weights: words, word bigrams, character trigrams (robust to Hebrew morphology and typos). */
export const FEATURE_WEIGHTS = { w: 1, b: 0.8, c: 0.5 };

export function featurize(text, dim = 2048, weights = FEATURE_WEIGHTS) {
  const ws = tokens(text);
  const counts = new Map(); // hash -> { n: occurrences, w: group weight }
  const add = (f, w) => { const h = fnv1a(f) % dim; const e = counts.get(h) ?? { n: 0, w: 0 }; e.n++; e.w = Math.max(e.w, w); counts.set(h, e); };
  for (const w of ws) add(`w:${w}`, weights.w);
  for (let i = 0; i < ws.length - 1; i++) add(`b:${ws[i]}_${ws[i + 1]}`, weights.b);
  const s = ` ${normalizeText(text)} `;
  if (weights.c) for (let i = 0; i < s.length - 2; i++) add(`c:${s.slice(i, i + 3)}`, weights.c);
  const idx = [...counts.keys()].sort((a, b) => a - b);
  const val = idx.map((i) => { const e = counts.get(i); return e.w * (1 + Math.log(e.n)); }); // weighted sub-linear TF
  const norm = Math.sqrt(val.reduce((a, v) => a + v * v, 0)) || 1;
  return { idx, val: val.map((v) => v / norm), dim };
}

/** Dense vector (for clustering / similarity). */
export function denseOf(text, dim = 512) { const f = featurize(text, dim); const v = new Float32Array(dim); f.idx.forEach((i, k) => { v[i] = f.val[k]; }); return v; }
export const cosine = (a, b) => { let d = 0; let na = 0; let nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; };
