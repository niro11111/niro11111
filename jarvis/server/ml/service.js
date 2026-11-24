// JARVIS ML layer: model registry + training + inference, integrated with the brain.
//
// Models (all trained on this device, from this household's data only):
//   intent-router     MLP neural network: free phrasing → read-only capability (or open question)
//   tx-categorizer    Multinomial Naive Bayes: transaction description → expense category
//   spend-forecast    Holt's linear exponential smoothing per category, 95% intervals
//   spend-anomalies   robust modified z-score (MAD) per category
//   request-clusters  k-means++ over hashed text vectors (capability gaps)
//
// Registry rules: every trained model is a signed "challenger" version with metrics on a
// held-out set. Making the neural router active in production is NOT done here: it is a
// versioned target (ml.routing) that goes through the self-improvement pipeline - sandbox
// regression suite, comparison report, owner approval, rollback.
import { now } from '../lib/store.js';
import { sign, verify, digest } from '../learn/sign.js';
import { MLP } from './nn.js';
import { buildDataset, trainIntentModel, decideRoute, predictIntent, ROUTABLE } from './intent-model.js';
import { NaiveBayes, looAccuracy, txTokens, holt, madAnomalies, clusterTexts } from './algorithms.js';
import { riskOf } from '../tools/index.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const monthKey = (d) => String(d).slice(0, 7);

export class MLService {
  constructor(s) { this.s = s; this.cache = new Map(); }

  // ---------------- registry ----------------
  models(name) { return this.s.store.all('ml_models', (m) => !name || m.name === name).slice().reverse().map(({ weights, support, nb, ...m }) => ({ ...m, intact: this.intact({ weights, support, nb, ...m }) })); }
  get(id) { const m = this.s.store.get('ml_models', id); if (!m) throw err('no such model', 404); return m; }
  champion(name) { return this.s.store.all('ml_models', (m) => m.name === name && m.status === 'champion').at(-1) ?? null; }
  intact(m) { return verify(this.s.store, { name: m.name, version: m.version, weights: m.weights ?? m.nb ?? null }, m.signature); }
  register(rec) {
    const version = this.s.store.all('ml_models', (m) => m.name === rec.name).length + 1;
    const payload = rec.weights ?? rec.nb ?? null;
    const m = this.s.store.insert('ml_models', { ...rec, version, status: 'challenger', signature: sign(this.s.store, { name: rec.name, version, weights: payload }), weightsDigest: digest(payload), trainedAt: now() });
    this.s.learn?.log('ml.trained', { modelId: m.id, name: m.name, version, metrics: { testAccuracy: m.metrics?.testAccuracy ?? m.metrics?.looAccuracy ?? null } });
    return m;
  }
  /** Champion/challenger: a challenger becomes champion only if it is at least as good on held-out data. */
  promote(id, actor) {
    if (actor !== 'user') throw err('only the owner can promote a model', 403);
    const m = this.get(id);
    if (!this.intact(m)) throw err('model failed its integrity check', 409);
    const cur = this.champion(m.name);
    const score = (x) => x?.metrics?.macroF1 ?? x?.metrics?.looAccuracy ?? 0;
    if (cur && cur.id !== id && score(m) + 1e-9 < score(cur)) throw err(`challenger (${score(m)}) is worse than the champion (${score(cur)}) on held-out data`, 409);
    if (cur && cur.id !== id) this.s.store.update('ml_models', cur.id, { status: 'retired', retiredAt: now() });
    this.s.store.update('ml_models', id, { status: 'champion', promotedAt: now(), promotedBy: actor });
    this.cache.delete(id);
    this.s.learn?.log('ml.promoted', { modelId: id, name: m.name, version: m.version, replaced: cur?.version ?? null }, actor);
    return this.models(m.name)[0];
  }

  // ---------------- neural intent router ----------------
  async trainIntent(actor = 'user', opts = {}) {
    const { parse } = await import('../core/intent.js');
    const ds = buildDataset(this.s, parse);
    const t = trainIntentModel(ds, opts);
    return this.register({ name: 'intent-router', algorithm: 'neural network (MLP)', labels: t.labels, weights: t.net.toJSON(), support: t.support, metrics: t.metrics, history: t.history, config: t.config, dataset: { size: ds.examples.length, sources: ds.sources, digest: digest(ds.examples.map((e) => [e.text, e.label])) }, trainedBy: actor });
  }
  loaded(id) {
    if (!this.cache.has(id)) { const m = this.get(id); if (!this.intact(m)) throw err('model failed its integrity check', 409); this.cache.set(id, { ...m, net: MLP.fromJSON(m.weights) }); }
    return this.cache.get(id);
  }
  predict(text, { modelId } = {}) {
    const id = modelId ?? this.champion('intent-router')?.id ?? this.s.store.all('ml_models', (m) => m.name === 'intent-router').at(-1)?.id;
    if (!id) throw err('train the intent model first', 409);
    const m = this.loaded(id);
    const cfg = this.s.store.getMeta('mlRouting', {});
    return { modelId: id, version: m.version, top: predictIntent(m, text, 5), decision: decideRoute(m, text, { threshold: cfg.threshold ?? 0.85, margin: cfg.margin ?? 0.5 }) };
  }
  /** Used by CORE only where the deterministic parser had no rule, and only if ml.routing is enabled. */
  route(message) {
    const cfg = this.s.store.getMeta('mlRouting', {});
    if (!cfg.enabled || !cfg.modelId) return null;
    let m; try { m = this.loaded(cfg.modelId); } catch { return null; }
    const d = decideRoute(m, message, { threshold: cfg.threshold ?? 0.85, margin: cfg.margin ?? 0.5 });
    const tool = this.s.tools[d.label];
    if (!d.route || !tool || riskOf(tool, {}) !== 'read' || !ROUTABLE.includes(d.label)) return { steps: null, decision: d };
    return { steps: [{ agent: this.s.agentsFor(d.label)[0] ?? 'assistant', tool: d.label, args: {} }], decision: d, modelId: cfg.modelId, version: m.version };
  }

  // ---------------- transaction categorizer (suggestions only) ----------------
  trainCategorizer(actor = 'user') {
    const tx = this.s.store.all('transactions', (t) => t.householdId === this.s.householdId && t.amount < 0 && t.category && t.category !== 'other');
    const docs = tx.map((t) => ({ tokens: txTokens(t), label: t.category }));
    if (docs.length < 6) throw err('needs at least 6 categorized expenses', 409);
    const nb = new NaiveBayes().fit(docs);
    const perClass = Object.fromEntries(nb.labels.map((l) => [l, docs.filter((d) => d.label === l).length]));
    return this.register({ name: 'tx-categorizer', algorithm: 'multinomial naive Bayes', labels: nb.labels, nb: { prior: nb.prior, counts: nb.counts, totals: nb.totals, n: nb.n }, metrics: { looAccuracy: looAccuracy(docs), examples: docs.length, perClass }, config: { features: 'description tokens + amount magnitude bucket', smoothing: 'Laplace α=1' }, dataset: { size: docs.length, domain: 'financial (stays on this device)' }, trainedBy: actor });
  }
  categorizer() {
    const m = this.champion('tx-categorizer') ?? this.s.store.all('ml_models', (x) => x.name === 'tx-categorizer').at(-1);
    if (!m) return null;
    const nb = new NaiveBayes(); Object.assign(nb, m.nb, { labels: m.labels, vocab: new Set(Object.values(m.nb.counts).flatMap((c) => Object.keys(c))) });
    return { model: m, nb };
  }
  /** Suggestions for uncategorized expenses. Never applied automatically; ≥3 examples per class, p ≥ 0.8, ≥1 matching word. */
  categorySuggestions() {
    const c = this.categorizer();
    if (!c) return { status: 'no-model', suggestions: [] };
    const other = this.s.store.all('transactions', (t) => t.householdId === this.s.householdId && t.amount < 0 && (!t.category || t.category === 'other'));
    const out = [];
    for (const t of other) {
      const toks = txTokens(t); const [best] = c.nb.predict(toks);
      const examples = c.model.metrics.perClass[best.label] ?? 0;
      const sup = c.nb.support(toks.filter((x) => !x.startsWith('amt:')), best.label);
      if (best.prob >= 0.8 && examples >= 3 && sup >= 1) out.push({ id: `ml:${t.id}`, transactionId: t.id, description: t.description, amount: t.amount, category: best.label, prob: best.prob, examples, matchingWords: sup, modelVersion: c.model.version });
    }
    return { status: 'ok', modelVersion: c.model.version, looAccuracy: c.model.metrics.looAccuracy, suggestions: out, note: 'Suggestions only: categories change only after your approval; amounts, budgets and rules never change.' };
  }
  applyCategory(transactionId, actor) {
    if (actor !== 'user') throw err('only the owner can recategorize', 403);
    const sg = this.categorySuggestions().suggestions.find((x) => x.transactionId === transactionId);
    if (!sg) throw err('no such suggestion', 404);
    this.s.store.update('transactions', transactionId, { category: sg.category, categorizedBy: `ml suggestion v${sg.modelVersion}, approved` });
    this.s.learn?.log('ml.category_applied', { transactionId, category: sg.category, prob: sg.prob }, actor);
    return sg;
  }

  // ---------------- forecasting & anomalies ----------------
  monthlySeries(months = 12) {
    const tx = this.s.store.all('transactions', (t) => t.householdId === this.s.householdId && t.amount < 0);
    const keys = [...new Set(tx.map((t) => monthKey(t.date)))].sort().slice(-months);
    const cats = [...new Set(tx.map((t) => t.category ?? 'other'))];
    const total = keys.map((k) => -tx.filter((t) => monthKey(t.date) === k).reduce((a, t) => a + t.amount, 0));
    const byCat = Object.fromEntries(cats.map((c) => [c, keys.map((k) => -tx.filter((t) => monthKey(t.date) === k && (t.category ?? 'other') === c).reduce((a, t) => a + t.amount, 0))]));
    return { months: keys, total, byCat };
  }
  forecast({ horizon = 3 } = {}) {
    const { months, total, byCat } = this.monthlySeries();
    // The current month is incomplete: forecast from complete months only.
    const cur = new Date().toISOString().slice(0, 7);
    const cut = months.at(-1) === cur ? -1 : undefined;
    const t = holt(total.slice(0, cut), { horizon });
    const categories = Object.entries(byCat).map(([c, s]) => ({ category: c, ...holt(s.slice(0, cut), { horizon }) })).filter((x) => x.status === 'ok').sort((a, b) => (b.forecast[0]?.value ?? 0) - (a.forecast[0]?.value ?? 0));
    return { months: months.slice(0, cut), history: total.slice(0, cut), total: t, categories, units: 'agorot (minor units)', note: 'Statistical forecast for planning; not financial advice. Figures stay deterministic.' };
  }
  anomalies() {
    const tx = this.s.store.all('transactions', (t) => t.householdId === this.s.householdId && t.amount < 0);
    const byCat = {}; for (const t of tx) (byCat[t.category ?? 'other'] ??= []).push(t);
    const out = [];
    for (const [cat, list] of Object.entries(byCat)) {
      const r = madAnomalies(list, { value: (t) => -t.amount });
      for (const a of r.anomalies.filter((x) => x.score > 0)) out.push({ category: cat, transactionId: a.item.id, description: a.item.description, date: a.item.date, amount: a.item.amount, score: a.score, median: -r.median });
    }
    return { anomalies: out.sort((a, b) => b.score - a.score).slice(0, 20), method: 'modified z-score ≥ 3.5 within each category (MAD)' };
  }

  // ---------------- request clustering ----------------
  requestClusters() {
    const texts = this.s.store.all('tasks_exec', (t) => t.actor === 'user' && t.state === 'FAILED' && t.plan?.tools?.length === 1 && t.plan.tools[0] === 'llm.answer').slice(-200).map((t) => t.objective);
    return clusterTexts([...new Set(texts)]);
  }

  /** Retrain the router when enough new labelled history exists (bounded; used by the learning cycle). */
  async maybeRetrain() {
    const last = this.s.store.all('ml_models', (m) => m.name === 'intent-router').at(-1);
    const newer = this.s.store.all('tasks_exec', (t) => t.state === 'COMPLETED' && (!last || t.createdAt > last.trainedAt)).length;
    if (last && newer < 25) return null;
    return this.trainIntent('learning-engine');
  }

  status() {
    const cfg = this.s.store.getMeta('mlRouting', {});
    return { routing: { enabled: !!cfg.enabled, modelId: cfg.modelId ?? null, threshold: cfg.threshold ?? 0.85, margin: cfg.margin ?? 0.5 }, models: this.models().slice(0, 20), routed: this.s.store.all('tasks_exec', (t) => t.ml?.route).length };
  }
}
