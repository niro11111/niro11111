// Family Wealth OS integration service. Read + analyse only.
// Enforces household isolation: every call is scoped to the caller's householdId.
// Money-moving operations are not implemented here on purpose; they are blocked by
// the guard below and can only be prepared as a proposal the user executes at their provider.
import * as C from './calc.js';

export const FORBIDDEN_FINANCIAL_ACTIONS = ['transfer', 'invest', 'change_pension', 'cancel_product', 'purchase', 'modify_bank_settings'];

export class WealthService {
  constructor(store, audit) { this.store = store; this.audit = audit; }

  scoped(col, householdId) {
    if (!householdId) throw Object.assign(new Error('household scope required'), { status: 403 });
    return this.store.all(col, (r) => r.householdId === householdId);
  }
  read(col, ctx) {
    this.audit.log(ctx.actor, `wealth.read.${col}`, { householdId: ctx.householdId });
    return this.scoped(col, ctx.householdId);
  }

  currentMonth(ctx) { return ctx.month ?? C.monthKey(new Date().toISOString()); }

  overview(ctx) {
    const txs = this.read('transactions', ctx);
    const key = this.currentMonth(ctx);
    const nw = C.netWorth(this.scoped('assets', ctx.householdId), this.scoped('liabilities', ctx.householdId));
    return { month: key, facts: { netWorth: nw, month: C.monthSummary(txs, key) },
      goals: this.goals(ctx), upcomingBills: this.upcomingBills(ctx) };
  }

  accounts(ctx) { return this.read('accounts', ctx); }
  transactions(ctx, { month } = {}) {
    const t = this.read('transactions', ctx);
    return month ? t.filter((x) => C.monthKey(x.date) === month) : t;
  }
  budgets(ctx) {
    return C.budgetStatus(this.read('budgets', ctx), this.scoped('transactions', ctx.householdId), this.currentMonth(ctx));
  }
  goals(ctx) {
    const f = C.forecast(this.scoped('transactions', ctx.householdId), this.currentMonth(ctx));
    return this.scoped('goals', ctx.householdId).map((g) => C.goalProgress(g, g.monthlyContribution ?? Math.max(0, f.avgNet)));
  }
  assets(ctx) { return this.read('assets', ctx); }
  liabilities(ctx) { return this.read('liabilities', ctx); }

  upcomingBills(ctx, days = 14) {
    const t0 = Date.parse(ctx.today ?? new Date().toISOString().slice(0, 10));
    return this.scoped('bills', ctx.householdId)
      .filter((b) => !b.paid && Date.parse(b.dueDate) - t0 <= days * 864e5)
      .map((b) => ({ ...b, overdue: Date.parse(b.dueDate) < t0 }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /** Structured analysis: facts, calculations, forecasts and recommendations kept separate. */
  analysis(ctx) {
    const txs = this.read('transactions', ctx);
    const key = this.currentMonth(ctx);
    const cmp = C.compareMonths(txs, key);
    const rec = C.recurring(txs);
    const anom = C.anomalies(txs);
    const budgets = this.budgets(ctx);
    const fc = C.forecast(txs, key);
    const over = budgets.filter((b) => b.over);
    const topIncrease = cmp.categories.filter((c) => c.change > 0).slice(0, 3);

    const recommendations = [];
    for (const b of over) recommendations.push({ kind: 'budget', text: `Category "${b.category}" is over budget by ${C.fmt(-b.remaining)}.`, textHe: `הקטגוריה "${b.category}" חרגה מהתקציב ב-${C.fmt(-b.remaining)}.`, basis: 'budgetStatus' });
    for (const c of topIncrease) recommendations.push({ kind: 'spending', text: `"${c.category}" rose by ${C.fmt(c.change)} vs last month - worth reviewing.`, textHe: `"${c.category}" עלתה ב-${C.fmt(c.change)} לעומת החודש הקודם - כדאי לבדוק.`, basis: 'compareMonths' });
    const subs = rec.filter((r) => ['subscriptions', 'מנויים'].includes(r.category));
    if (subs.length) recommendations.push({ kind: 'savings', text: `${subs.length} recurring subscriptions total ${C.fmt(C.sum(subs, (s) => s.monthly))}/month. Review which are still used.`, textHe: `${subs.length} מנויים חוזרים בסך ${C.fmt(C.sum(subs, (s) => s.monthly))} בחודש. כדאי לבדוק באילו עדיין משתמשים.`, basis: 'recurring' });
    for (const a of anom.possibleDuplicates) recommendations.push({ kind: 'anomaly', text: `Possible duplicate charge: "${a.description}" ${C.fmt(a.amount)}.`, textHe: `חיוב כפול אפשרי: "${a.description}" ${C.fmt(a.amount)}.`, basis: 'anomalies' });

    const potential = C.sum(subs, (s) => s.monthly) + C.sum(over, (b) => -b.remaining);
    return {
      month: key,
      facts: { currentMonth: cmp.current, previousMonth: cmp.previous },
      calculations: { expenseChange: cmp.expenseChange, categoryChanges: cmp.categories, budgets, recurring: rec, anomalies: anom, potentialMonthlySaving: potential },
      forecasts: fc,
      recommendations,
      // Where every number comes from, so facts are never confused with estimates.
      dataQuality: {
        transactionsBySource: txs.reduce((m, x) => { const k = x.demo ? 'demo' : x.source ?? 'imported'; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
        labels: { facts: 'recorded transactions (imported or user-entered)', calculations: 'deterministic arithmetic on facts', forecasts: 'prediction based on an assumption', recommendations: 'suggestion, not advice' },
        assumptions: [fc.assumption],
      },
      disclaimer: 'Analysis only. JARVIS is not a licensed financial adviser and does not move money.',
    };
  }

  report(ctx) {
    const a = this.analysis(ctx);
    const cur = a.facts.currentMonth;
    const lines = [
      `Financial report ${a.month}`,
      `Income: ${C.fmt(cur.income)} | Expenses: ${C.fmt(cur.expenses)} | Net: ${C.fmt(cur.net)}`,
      `Change in expenses vs previous month: ${C.fmt(a.calculations.expenseChange)}`,
      `Potential monthly saving identified: ${C.fmt(a.calculations.potentialMonthlySaving)}`,
      ...a.recommendations.map((r) => `- ${r.text}`),
      a.disclaimer,
    ];
    return { ...a, text: lines.join('\n') };
  }

  /** Income/expenses/net for the last n months (oldest first), for charts. */
  series(ctx, n = 6) {
    const txs = this.read('transactions', ctx);
    const out = []; let k = this.currentMonth(ctx);
    for (let i = 0; i < n; i++) { out.unshift(C.monthSummary(txs, k)); k = C.prevMonth(k); }
    return out.map(({ month, income, expenses, net }) => ({ month, income, expenses, net }));
  }

  simulate(ctx, cuts) { return C.simulateCuts(this.read('transactions', ctx), this.currentMonth(ctx), cuts); }

  /** Any money-moving request ends here: never executed, only documented as a proposal. */
  guardAction(ctx, action) {
    this.audit.log(ctx.actor, 'wealth.blocked_action', { action, householdId: ctx.householdId }, 'blocked');
    return { executed: false, action, reason: 'JARVIS does not execute financial transactions. Review the proposal and perform it with your bank or provider after your own confirmation.' };
  }
}
