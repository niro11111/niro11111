// Classic machine-learning algorithms used by JARVIS (all deterministic and local):
//  * Multinomial Naive Bayes with Laplace smoothing - transaction categorization.
//  * Holt's linear exponential smoothing with grid-searched (alpha, beta) and residual-based
//    prediction intervals - monthly spending forecasts per category.
//  * Robust anomaly detection: modified z-score with the median absolute deviation (MAD).
//  * k-means++ with silhouette-based choice of k - grouping similar requests.
import { tokens, cosine } from './features.js';
import { rng } from './nn.js';

// ---------------- Naive Bayes ----------------
export class NaiveBayes {
  constructor({ alpha = 1 } = {}) { this.alpha = alpha; }
  fit(docs) { // docs: [{ tokens: string[], label }]
    this.labels = [...new Set(docs.map((d) => d.label))].sort();
    this.prior = {}; this.counts = {}; this.totals = {}; this.vocab = new Set();
    for (const l of this.labels) { this.prior[l] = 0; this.counts[l] = {}; this.totals[l] = 0; }
    for (const d of docs) { this.prior[d.label]++; for (const t of d.tokens) { this.vocab.add(t); this.counts[d.label][t] = (this.counts[d.label][t] ?? 0) + 1; this.totals[d.label]++; } }
    this.n = docs.length;
    return this;
  }
  predict(toks) {
    const V = this.vocab.size || 1;
    const logp = this.labels.map((l) => {
      let lp = Math.log(this.prior[l] / this.n);
      for (const t of toks) if (this.vocab.has(t)) lp += Math.log(((this.counts[l][t] ?? 0) + this.alpha) / (this.totals[l] + this.alpha * V));
      return lp;
    });
    const mx = Math.max(...logp); const ex = logp.map((x) => Math.exp(x - mx)); const z = ex.reduce((a, x) => a + x, 0);
    return this.labels.map((l, i) => ({ label: l, prob: +(ex[i] / z).toFixed(4) })).sort((a, b) => b.prob - a.prob);
  }
  /** Evidence: how many training examples contained a token of this input, for the predicted class. */
  support(toks, label) { return toks.filter((t) => (this.counts[label]?.[t] ?? 0) > 0).length; }
}

/** Leave-one-out accuracy of a Naive Bayes model (small datasets). */
export function looAccuracy(docs) {
  if (docs.length < 3) return null;
  let ok = 0;
  for (let i = 0; i < docs.length; i++) { const nb = new NaiveBayes().fit(docs.filter((_, j) => j !== i)); if (nb.predict(docs[i].tokens)[0]?.label === docs[i].label) ok++; }
  return +(ok / docs.length).toFixed(4);
}
export const txTokens = (t) => [...tokens(t.description ?? ''), `amt:${Math.round(Math.log10(Math.max(1, Math.abs(t.amount ?? 0) / 100)) * 2)}`];

// ---------------- Holt's linear trend ----------------
export function holt(series, { horizon = 3, alphas = [0.2, 0.4, 0.6, 0.8], betas = [0.05, 0.15, 0.3, 0.5] } = {}) {
  const y = series.map(Number);
  if (y.length < 3) return { status: 'insufficient-data', note: 'needs at least 3 months', forecast: [] };
  let best = null;
  for (const a of alphas) for (const b of betas) {
    let l = y[0]; let t = y[1] - y[0]; let sse = 0; const fitted = [y[0]]; const res = [];
    for (let i = 1; i < y.length; i++) { const f = l + t; fitted.push(f); res.push(y[i] - f); sse += (y[i] - f) ** 2; const ln = a * y[i] + (1 - a) * (l + t); t = b * (ln - l) + (1 - b) * t; l = ln; }
    if (!best || sse < best.sse) best = { a, b, l, t, sse, fitted, res };
  }
  const sd = Math.sqrt(best.sse / Math.max(1, y.length - 2));
  const forecast = Array.from({ length: horizon }, (_, h) => { const f = best.l + (h + 1) * best.t; const w = 1.96 * sd * Math.sqrt(h + 1); return { step: h + 1, value: Math.round(f), low: Math.round(f - w), high: Math.round(f + w) }; });
  const mape = y.slice(1).reduce((acc, v, i) => acc + (v ? Math.abs(best.res[i] / v) : 0), 0) / (y.length - 1);
  return { status: 'ok', alpha: best.a, beta: best.b, level: Math.round(best.l), trend: Math.round(best.t), residualSd: Math.round(sd), mape: +mape.toFixed(3), fitted: best.fitted.map(Math.round), forecast, method: "Holt's linear exponential smoothing; 95% intervals from residuals" };
}

// ---------------- robust anomalies ----------------
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function madAnomalies(items, { value = (x) => x.value, threshold = 3.5, minGroup = 5 } = {}) {
  const vals = items.map(value);
  if (vals.length < minGroup) return { status: 'insufficient-data', anomalies: [] };
  const med = median(vals); const mad = median(vals.map((v) => Math.abs(v - med))) || 1e-9;
  const anomalies = items.map((it, i) => ({ item: it, score: +(0.6745 * (vals[i] - med) / mad).toFixed(2) })).filter((x) => Math.abs(x.score) >= threshold).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return { status: 'ok', median: med, mad, threshold, anomalies, method: 'modified z-score (median absolute deviation)' };
}

// ---------------- k-means++ ----------------
export function kmeans(vectors, k, { seed = 5, iters = 30 } = {}) {
  const r = rng(seed); const n = vectors.length; const dim = vectors[0]?.length ?? 0;
  const dist = (a, b) => 1 - cosine(a, b);
  const centers = [vectors[Math.floor(r() * n)]];
  while (centers.length < k) { const d = vectors.map((v) => Math.min(...centers.map((c) => dist(v, c))) ** 2); const sum = d.reduce((a, x) => a + x, 0) || 1; let pick = r() * sum; let i = 0; for (; i < n - 1; i++) { pick -= d[i]; if (pick <= 0) break; } centers.push(vectors[i]); }
  let assign = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    const next = vectors.map((v) => { let bi = 0; let bd = Infinity; centers.forEach((c, ci) => { const dd = dist(v, c); if (dd < bd) { bd = dd; bi = ci; } }); return bi; });
    const same = next.every((x, i) => x === assign[i]); assign = next;
    for (let c = 0; c < k; c++) { const members = vectors.filter((_, i) => assign[i] === c); if (!members.length) continue; const m = new Float32Array(dim); for (const v of members) for (let j = 0; j < dim; j++) m[j] += v[j] / members.length; centers[c] = m; }
    if (same && it) break;
  }
  return { assign, centers };
}
export function silhouette(vectors, assign) {
  const dist = (a, b) => 1 - cosine(a, b);
  const ks = [...new Set(assign)]; if (ks.length < 2) return 0;
  let total = 0;
  vectors.forEach((v, i) => {
    const own = vectors.filter((_, j) => j !== i && assign[j] === assign[i]);
    const a = own.length ? own.reduce((s, w) => s + dist(v, w), 0) / own.length : 0;
    const b = Math.min(...ks.filter((c) => c !== assign[i]).map((c) => { const o = vectors.filter((_, j) => assign[j] === c); return o.reduce((s, w) => s + dist(v, w), 0) / o.length; }));
    total += own.length ? (b - a) / Math.max(a, b) : 0;
  });
  return +(total / vectors.length).toFixed(4);
}
/** Clusters texts, choosing k in [2, maxK] by the best silhouette. */
const CSTOP = new Set(['to', 'the', 'a', 'an', 'this', 'that', 'please', 'for', 'of', 'in', 'on', 'my', 'me', 'is', 'and', 'את', 'של', 'על', 'עם', 'לי', 'זה', 'בבקשה', 'מה', 'איך']);
/** Topic vector: content words + 5-letter stems (flight/flights, תרגם/תתרגם share features). */
function topicVector(text, dim = 512) {
  const v = new Float32Array(dim);
  for (const w of tokens(text).filter((x) => x.length > 2 && !CSTOP.has(x))) for (const [f, wt] of [[`w:${w}`, 1], [`s:${w.slice(0, 5)}`, 2]]) { let h = 0x811c9dc5; for (let i = 0; i < f.length; i++) { h ^= f.charCodeAt(i); h = Math.imul(h, 0x01000193); } v[(h >>> 0) % dim] += wt; }
  return v;
}
export function clusterTexts(texts, { maxK = 6, seed = 5 } = {}) {
  if (texts.length < 4) return { k: texts.length ? 1 : 0, clusters: texts.length ? [{ members: texts, label: topTerms(texts) }] : [], silhouette: null };
  const vecs = texts.map((t) => topicVector(t));
  let best = null;
  // Parsimony: a larger k must beat the best silhouette by a clear margin.
  for (let k = 2; k <= Math.min(maxK, texts.length - 1); k++) { const km = kmeans(vecs, k, { seed }); const sc = silhouette(vecs, km.assign); if (!best || sc > best.sc + 0.05) best = { k, sc, km }; }
  const clusters = Array.from({ length: best.k }, (_, c) => texts.filter((_, i) => best.km.assign[i] === c)).filter((m) => m.length).map((members) => ({ members, label: topTerms(members), size: members.length })).sort((a, b) => b.size - a.size);
  return { k: best.k, silhouette: best.sc, clusters, method: 'k-means++ on hashed text vectors, k by silhouette' };
}
function topTerms(texts, n = 3) {
  const c = {}; for (const t of texts) for (const w of new Set(tokens(t))) if (w.length > 2) c[w] = (c[w] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w).join(' · ');
}
