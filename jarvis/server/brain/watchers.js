// Watchers: autonomous monitors the user describes in words ("alert me if dining goes over 500").
// A rule is compiled once (deterministic parser, or the model as a fallback, both validated
// against a fixed metric catalog); the scheduler then evaluates it with exact numbers, no model.
// A watcher fires on the false->true edge, with a cooldown, so it never floods notifications.
import { monthKey, monthSummary } from '../wealth/calc.js';

const CAT = { מסעדות: 'dining', מסעדה: 'dining', 'אוכל בחוץ': 'dining', בילויים: 'dining', סופר: 'groceries', מכולת: 'groceries', אוכל: 'groceries', דלק: 'transport', תחבורה: 'transport', רכב: 'transport',
  מנויים: 'subscriptions', קניות: 'shopping', ביגוד: 'shopping', חשמל: 'utilities', מים: 'utilities', חשבונות: 'utilities', דיור: 'housing', שכירות: 'housing', בריאות: 'health',
  restaurants: 'dining', restaurant: 'dining', eating: 'dining', groceries: 'groceries', grocery: 'groceries', fuel: 'transport', gas: 'transport', transport: 'transport', subscriptions: 'subscriptions', shopping: 'shopping', utilities: 'utilities', housing: 'housing', health: 'health', dining: 'dining' };
const categoryOf = (word) => { const w = String(word ?? '').toLowerCase().trim().replace(/^(?:ה|על ה|על )/, ''); return CAT[w] ?? Object.entries(CAT).find(([k]) => w.includes(k))?.[1] ?? null; };

/** Every metric returns a number. Money metrics are in shekels (major units). */
export const METRICS = {
  spend_month: { desc: 'Total spending this month (ILS)', params: [], fn: (s, p, ctx) => monthSummary(s.wealth.scoped('transactions', ctx.householdId), monthKey(new Date().toISOString())).expenses / 100 },
  spend_category_month: { desc: 'Spending this month in one category (ILS)', params: ['category'], fn: (s, p, ctx) => (monthSummary(s.wealth.scoped('transactions', ctx.householdId), monthKey(new Date().toISOString())).byCategory[p.category] ?? 0) / 100 },
  budget_used_pct: { desc: 'Percent of a category budget used this month', params: ['category'], fn: (s, p, ctx) => s.wealth.budgets({ ...ctx, actor: 'watcher' }).find((b) => b.category === p.category)?.usedPct ?? 0 },
  bills_overdue: { desc: 'Number of overdue unpaid bills', params: [], fn: (s, p, ctx) => s.wealth.upcomingBills({ ...ctx, actor: 'watcher' }, 0).filter((b) => b.overdue).length },
  bills_due_soon: { desc: 'Unpaid bills due within N days (default 3)', params: ['days'], fn: (s, p, ctx) => s.wealth.upcomingBills({ ...ctx, actor: 'watcher' }, Number(p.days ?? 3)).length },
  tasks_overdue: { desc: 'Number of open tasks past their due date', params: [], fn: (s) => s.productivity.listTasks().filter((t) => t.due && Date.parse(t.due) < Date.now()).length },
  tasks_open: { desc: 'Number of open tasks', params: [], fn: (s) => s.productivity.listTasks().length },
  habit_streak: { desc: 'Current streak (days) of a habit', params: ['name'], fn: (s, p) => s.productivity.habits().find((h) => h.name.toLowerCase() === String(p.name).toLowerCase())?.streak ?? 0 },
  goal_pct: { desc: 'Percent of a savings goal reached', params: ['goal'], fn: (s, p, ctx) => s.wealth.goals({ ...ctx, actor: 'watcher' }).find((g) => g.name.toLowerCase().includes(String(p.goal).toLowerCase()))?.pct ?? 0 },
  devices_offline: { desc: 'Number of offline smart-home devices', params: [], fn: async (s) => (await s.home.devices()).filter((d) => !d.online).length },
  unread_notifications: { desc: 'Unread notifications', params: [], fn: (s) => s.notifications.list({ unread: true }).length },
  temperature: { desc: 'Current outdoor temperature (°C) from the weather service', params: [], fn: async (s) => { const w = await s.weather.current(); if (!w.available) throw new Error('weather unavailable'); return w.temperature; } },
};
const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };

export function validateRule(r) {
  if (!METRICS[r?.metric]) throw Object.assign(new Error(`unknown metric ${r?.metric}`), { status: 400 });
  if (!OPS[r.op]) throw Object.assign(new Error(`unknown operator ${r.op}`), { status: 400 });
  if (!Number.isFinite(Number(r.value))) throw Object.assign(new Error('value must be a number'), { status: 400 });
  for (const p of METRICS[r.metric].params) if (p !== 'days' && (r.params?.[p] === undefined || r.params?.[p] === '')) throw Object.assign(new Error(`${r.metric} needs ${p}`), { status: 400 });
  return { metric: r.metric, params: r.params ?? {}, op: r.op, value: Number(r.value) };
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
/** Deterministic parser for the common phrasings (Hebrew and English). Returns a rule or null. */
export function parseRule(text) {
  const t = String(text).trim();
  let m;
  if ((m = t.match(new RegExp(String.raw`(?:הוצאות|ההוצאות|הוצאה)\s+(?:על\s+|ב)?(\S+(?:\s+\S+)?)\s+(?:עוברות|עוברת|עולות על|מעל|יותר מ-?)\s*` + NUM)))) {
    const c = categoryOf(m[1]); if (c) return { metric: 'spend_category_month', params: { category: c }, op: '>', value: Number(m[2].replace(',', '.')) };
  }
  if ((m = t.match(new RegExp(String.raw`(\w+)\s+(?:spending|expenses)\s+(?:goes |go |is |are )?(?:over|above|exceeds?|more than)\s*₪?` + NUM, 'i'))) || (m = t.match(new RegExp(String.raw`(?:spending|spend|expenses)\s+on\s+(\w+)\s+(?:goes |go |is |are )?(?:over|above|exceeds?|more than)\s*₪?` + NUM, 'i')))) {
    const c = categoryOf(m[1]); if (c) return { metric: 'spend_category_month', params: { category: c }, op: '>', value: Number(m[2].replace(',', '.')) };
  }
  if ((m = t.match(new RegExp(String.raw`(?:סך )?(?:ההוצאות|הוצאות)(?: החודש)?\s+(?:עוברות|עולות על|מעל)\s*` + NUM))) || (m = t.match(new RegExp(String.raw`(?:total |monthly )?(?:spending|expenses)\s+(?:goes |go |is )?(?:over|above|exceeds?)\s*₪?` + NUM, 'i')))) {
    return { metric: 'spend_month', params: {}, op: '>', value: Number(m[1].replace(',', '.')) };
  }
  if (/(?:חשבון|חשבונות)\s+(?:ב)?איחור|overdue bills?|bill is overdue/i.test(t)) return { metric: 'bills_overdue', params: {}, op: '>', value: 0 };
  if (/משימות?\s+(?:ב)?איחור|overdue tasks?|tasks? (?:are|is) overdue/i.test(t)) return { metric: 'tasks_overdue', params: {}, op: '>', value: 0 };
  if (/מכשיר\S*\s+(?:לא מחובר|מנותק|נופל)|device\S* (?:goes |is |are )?offline/i.test(t)) return { metric: 'devices_offline', params: {}, op: '>', value: 0 };
  if ((m = t.match(/(?:הרצף של|רצף)\s+(\S+(?:\s+\S+)?)\s+(?:נשבר|נקטע)|(?:my\s+)?(\w+)\s+streak\s+(?:breaks|is broken|ends)/i))) return { metric: 'habit_streak', params: { name: (m[1] ?? m[2]).trim() }, op: '==', value: 0 };
  if ((m = t.match(new RegExp(String.raw`(?:הטמפרטורה|טמפרטורה|חום)\s+(?:עולה על|מעל|עוברת)\s*` + NUM))) || (m = t.match(new RegExp(String.raw`temperature\s+(?:goes |is )?(?:over|above)\s*` + NUM, 'i')))) return { metric: 'temperature', params: {}, op: '>', value: Number(m[1]) };
  if ((m = t.match(new RegExp(String.raw`(?:הטמפרטורה|טמפרטורה)\s+(?:יורדת מתחת ל-?|מתחת ל-?)\s*` + NUM))) || (m = t.match(new RegExp(String.raw`temperature\s+(?:drops |goes |is )?(?:below|under)\s*` + NUM, 'i')))) return { metric: 'temperature', params: {}, op: '<', value: Number(m[1]) };
  return null;
}

export class Watchers {
  constructor(s) { this.s = s; }
  list() { return this.s.store.all('watchers'); }

  async fromText(text, lang = 'en') {
    let rule = parseRule(text);
    let compiledBy = 'parser';
    if (!rule) {
      // Fallback: the model maps the request onto the metric catalog; the result is validated.
      const out = await this.s.router.complete({ complexity: 'low' }, {
        system: `Map the user's monitoring request to ONE rule over these metrics (exact names):\n${Object.entries(METRICS).map(([k, v]) => `- ${k}: ${v.desc}; params: ${JSON.stringify(v.params)}`).join('\n')}\nCategories: dining, groceries, transport, utilities, housing, subscriptions, shopping, health.\nReturn ONLY JSON {"metric": string, "params": object, "op": ">"|">="|"<"|"<="|"=="|"!=", "value": number}, or {"error": "unsupported"}.`,
        messages: [{ role: 'user', content: String(text) }],
      });
      if (out.offline) throw Object.assign(new Error(lang === 'he' ? 'לא הצלחתי להבין את הכלל. נסו למשל: "תתריע אם ההוצאות על מסעדות עוברות 500"' : 'I could not understand the rule. Try e.g. "alert me if dining spending goes over 500"'), { status: 400 });
      const { parseJson } = await import('../ai/engines.js');
      const j = parseJson(out.text);
      if (j.error) throw Object.assign(new Error('this kind of monitoring is not supported yet'), { status: 400 });
      rule = j; compiledBy = 'model';
    }
    return this.create({ ...validateRule(rule), label: String(text).slice(0, 200), compiledBy });
  }

  create({ metric, params, op, value, label, cooldownHours = 12, compiledBy = 'manual' }) {
    const r = validateRule({ metric, params, op, value });
    const w = this.s.store.insert('watchers', { ...r, label: label || `${metric} ${op} ${value}`, enabled: true, cooldownHours, compiledBy, state: false, lastValue: null, lastCheckedAt: null, lastTriggeredAt: null, triggers: 0 });
    this.s.audit.log('user', 'watcher.create', { id: w.id, metric, op, value });
    return w;
  }

  async evaluate(w, ctx = { householdId: this.s.householdId }) {
    const value = await METRICS[w.metric].fn(this.s, w.params, ctx);
    return { value, state: OPS[w.op](value, w.value) };
  }

  /** Scheduler tick: evaluate every enabled watcher, notify on a false->true edge (respecting cooldown). */
  async tick(at = Date.now()) {
    const fired = [];
    for (const w of this.list().filter((x) => x.enabled)) {
      try {
        const { value, state } = await this.evaluate(w);
        const cool = !w.lastTriggeredAt || at - Date.parse(w.lastTriggeredAt) > w.cooldownHours * 36e5;
        const patch = { lastValue: value, lastCheckedAt: new Date(at).toISOString(), state, error: null };
        if (state && !w.state && cool) {
          Object.assign(patch, { lastTriggeredAt: new Date(at).toISOString(), triggers: (w.triggers ?? 0) + 1 });
          await this.s.notifications.send({ title: `⚡ ${w.label}`, body: `${METRICS[w.metric].desc}: ${value}`, priority: 'high', event: `watcher:${w.id}` });
          fired.push(w.id);
        }
        this.s.store.update('watchers', w.id, patch);
      } catch (e) { this.s.store.update('watchers', w.id, { error: e.message, lastCheckedAt: new Date(at).toISOString() }); }
    }
    return fired;
  }
}
