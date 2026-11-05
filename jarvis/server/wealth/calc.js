// Deterministic financial calculations. All money is integer minor units (agorot / cents);
// no floating point arithmetic touches balances, and no LLM ever does the math.
export const toMinor = (n) => Math.round(Number(n) * 100);
export const fromMinor = (m) => m / 100;
export const fmt = (m, cur = 'ILS') => new Intl.NumberFormat('en-IL', { style: 'currency', currency: cur }).format(m / 100);

export const monthKey = (iso) => String(iso).slice(0, 7);

export function prevMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function sum(list, f = (x) => x) { return list.reduce((a, x) => a + f(x), 0); }

/** Expenses are negative amounts; income positive. */
export function monthSummary(txs, key) {
  const inMonth = txs.filter((t) => monthKey(t.date) === key);
  const income = sum(inMonth.filter((t) => t.amount > 0), (t) => t.amount);
  const expenses = -sum(inMonth.filter((t) => t.amount < 0), (t) => t.amount);
  const byCategory = {};
  for (const t of inMonth.filter((x) => x.amount < 0)) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) - t.amount;
  }
  return { month: key, income, expenses, net: income - expenses, byCategory, count: inMonth.length };
}

export function compareMonths(txs, key) {
  const cur = monthSummary(txs, key);
  const prev = monthSummary(txs, prevMonth(key));
  const cats = new Set([...Object.keys(cur.byCategory), ...Object.keys(prev.byCategory)]);
  const categories = [...cats].map((c) => {
    const a = cur.byCategory[c] ?? 0; const b = prev.byCategory[c] ?? 0;
    return { category: c, current: a, previous: b, change: a - b,
      changePct: b ? Math.round(((a - b) * 1000) / b) / 10 : null };
  }).sort((x, y) => y.change - x.change);
  return { current: cur, previous: prev, expenseChange: cur.expenses - prev.expenses, categories };
}

export function budgetStatus(budgets, txs, key) {
  const s = monthSummary(txs, key);
  return budgets.map((b) => {
    const spent = s.byCategory[b.category] ?? 0;
    return { category: b.category, limit: b.limit, spent, remaining: b.limit - spent,
      usedPct: b.limit ? Math.round((spent * 1000) / b.limit) / 10 : null, over: spent > b.limit };
  });
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Flags an expense larger than 2.5x the category median (needs >= 4 history points). */
export function anomalies(txs, { factor = 2.5 } = {}) {
  const byCat = {};
  for (const t of txs.filter((x) => x.amount < 0)) (byCat[t.category] ??= []).push(t);
  const out = [];
  for (const [cat, list] of Object.entries(byCat)) {
    if (list.length < 4) continue;
    const med = median(list.map((t) => -t.amount));
    for (const t of list) {
      if (-t.amount > med * factor) out.push({ transactionId: t.id, category: cat, amount: -t.amount, median: Math.round(med), date: t.date, description: t.description });
    }
  }
  // possible duplicates: same amount + description within 2 days
  const exp = txs.filter((x) => x.amount < 0).sort((a, b) => a.date.localeCompare(b.date));
  const dups = [];
  for (let i = 1; i < exp.length; i++) {
    const a = exp[i - 1]; const b = exp[i];
    if (a.amount === b.amount && a.description === b.description
      && Math.abs(Date.parse(b.date) - Date.parse(a.date)) <= 2 * 864e5) dups.push({ a: a.id, b: b.id, amount: -a.amount, description: a.description });
  }
  return { unusual: out, possibleDuplicates: dups };
}

/** Recurring charges with the same description in >= 2 distinct months. */
export function recurring(txs) {
  const m = {};
  for (const t of txs.filter((x) => x.amount < 0)) (m[t.description] ??= []).push(t);
  return Object.entries(m)
    .filter(([, l]) => new Set(l.map((t) => monthKey(t.date))).size >= 2)
    .map(([description, l]) => ({ description, category: l[0].category,
      monthly: Math.round(-sum(l, (t) => t.amount) / new Set(l.map((t) => monthKey(t.date))).size), occurrences: l.length }));
}

export function netWorth(assets, liabilities) {
  const a = sum(assets, (x) => x.value); const l = sum(liabilities, (x) => x.balance);
  return { assets: a, liabilities: l, netWorth: a - l };
}

/** Average monthly net over the last `months` full months, projected forward. */
export function forecast(txs, key, months = 3, horizon = 6) {
  const hist = [];
  let k = prevMonth(key);
  for (let i = 0; i < months; i++) { hist.push(monthSummary(txs, k)); k = prevMonth(k); }
  const avgNet = Math.round(sum(hist, (h) => h.net) / months);
  const avgIncome = Math.round(sum(hist, (h) => h.income) / months);
  const avgExpenses = Math.round(sum(hist, (h) => h.expenses) / months);
  return { basedOnMonths: hist.map((h) => h.month), avgIncome, avgExpenses, avgNet,
    projection: Array.from({ length: horizon }, (_, i) => ({ monthOffset: i + 1, cumulativeNet: avgNet * (i + 1) })),
    assumption: 'Linear projection of the recent average. Not a guarantee.' };
}

export function goalProgress(goal, monthlyContribution) {
  const remaining = Math.max(0, goal.target - goal.saved);
  const pct = goal.target ? Math.round((goal.saved * 1000) / goal.target) / 10 : 0;
  const monthsToGoal = remaining === 0 ? 0 : monthlyContribution > 0 ? Math.ceil(remaining / monthlyContribution) : null;
  let onTrack = null;
  if (goal.deadline && monthsToGoal !== null) {
    const monthsLeft = Math.max(0, Math.ceil((Date.parse(goal.deadline) - Date.now()) / (30.44 * 864e5)));
    onTrack = monthsToGoal <= monthsLeft;
  }
  return { goalId: goal.id, name: goal.name, target: goal.target, saved: goal.saved, remaining, pct, monthlyContribution, monthsToGoal, onTrack };
}

/** Scenario: what if we cut categories by given percentages? */
export function simulateCuts(txs, key, cuts) {
  const s = monthSummary(txs, key);
  const lines = Object.entries(cuts).map(([cat, pct]) => {
    const base = s.byCategory[cat] ?? 0;
    return { category: cat, base, cutPct: pct, monthlySaving: Math.round((base * pct) / 100) };
  });
  const monthly = sum(lines, (l) => l.monthlySaving);
  return { month: key, lines, monthlySaving: monthly, yearlySaving: monthly * 12 };
}

/** Seeded PRNG (mulberry32) so simulations are reproducible and testable. */
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };

/**
 * Monte Carlo: probability of reaching a savings goal by its deadline, given a monthly
 * contribution that varies (normal, sd = volatility * mean, never negative).
 * Money in minor units. Deterministic for a given seed.
 */
export function goalProbability({ target, saved, deadline }, { monthly, volatility = 0.3, runs = 2000, seed = 7, now = Date.now(), horizonMonths = 120 }) {
  const remaining = Math.max(0, target - saved);
  const monthsLeft = deadline ? Math.max(0, Math.floor((Date.parse(deadline) - now) / (30.44 * 864e5))) : null;
  if (remaining === 0) return { probability: 1, monthsLeft, medianMonths: 0, p10Months: 0, p90Months: 0, runs: 0 };
  if (!(monthly > 0)) return { probability: 0, monthsLeft, medianMonths: null, p10Months: null, p90Months: null, runs: 0 };
  const r = rng(seed); const hits = [];
  let reached = 0;
  for (let i = 0; i < runs; i++) {
    let acc = 0; let m = 0;
    while (acc < remaining && m < horizonMonths) { m++; acc += Math.max(0, monthly * (1 + volatility * gauss(r))); }
    hits.push(acc >= remaining ? m : Infinity);
    if (acc >= remaining && (monthsLeft === null || m <= monthsLeft)) reached++;
  }
  hits.sort((x, y) => x - y);
  const q = (p) => { const v = hits[Math.floor(p * (hits.length - 1))]; return Number.isFinite(v) ? v : null; };
  return { probability: Math.round((reached / runs) * 1000) / 1000, monthsLeft, medianMonths: q(0.5), p10Months: q(0.1), p90Months: q(0.9), runs };
}

/** Weighted decision matrix: deterministic ranking + which criteria could flip the winner. */
export function decisionMatrix({ options, criteria, scores }) {
  const crit = criteria.filter((c) => c?.name).map((c) => ({ name: String(c.name), weight: Math.max(0, Math.min(5, Number(c.weight) || 0)) }));
  const opts = options.map(String);
  const total = (weights) => opts.map((o) => {
    let num = 0; let den = 0;
    weights.forEach((c) => { const sc = Math.max(0, Math.min(10, Number(scores?.[o]?.[c.name]) || 0)); num += c.weight * sc; den += c.weight * 10; });
    return { option: o, score: den ? Math.round((num / den) * 1000) / 10 : 0 };
  }).sort((a, b) => b.score - a.score);
  const ranking = total(crit);
  const winner = ranking[0]?.option;
  const sensitive = crit.filter((c, i) => {
    const off = total(crit.map((x, j) => (j === i ? { ...x, weight: 0 } : x)))[0]?.option;
    const dbl = total(crit.map((x, j) => (j === i ? { ...x, weight: Math.min(10, x.weight * 2) } : x)))[0]?.option;
    return off !== winner || dbl !== winner;
  }).map((c) => c.name);
  const margin = ranking.length > 1 ? Math.round((ranking[0].score - ranking[1].score) * 10) / 10 : null;
  return { ranking, winner, margin, sensitiveTo: sensitive, robust: sensitive.length === 0 && (margin ?? 100) >= 5, criteria: crit };
}
