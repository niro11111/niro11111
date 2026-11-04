// JARVIS Autonomous Learning & Self-Improvement Engine.
//
// Pipeline (acceptance criteria 1-12):
//   signals (failed tasks, negative feedback, abandoned clarifications)
//   → classification into 13 failure classes → recurring patterns
//   → root-cause hypothesis WITH evidence (or "insufficient evidence")
//   → improvement proposal (one concrete, versionable change)
//   → experiment in an isolated sandbox: baseline vs candidate, full regression suite + replays
//   → comparison report, regressions block the proposal
//   → approval (MODE 2 default) → deployment as a new version (previous version preserved)
//   → post-deployment monitoring → one-click rollback → full learning audit trail.
//
// Hard boundaries (enforced in code, not by convention):
//   * Protected areas (security policy, permissions, autonomy, agent risk ceilings, financial
//     rules, budgets, retention/privacy, capabilities, the learning mode) cannot be targeted.
//   * The engine never changes its own mode or authorization: only the user can (setMode).
//   * Learned intent phrases may only map to READ-only capabilities and carry no arguments.
//   * Experiments run only in sandbox brains with no network, no model and no user data.
//   * No recursive self-modification: proposals change configuration values, never code,
//     never the engine itself; one change per proposal.
import { now } from '../lib/store.js';
import { riskOf } from '../tools/index.js';
import { Versions, targetAdapter, PROTECTED } from './versions.js';
import { clusterSignals, FAILURE_CLASSES, FEEDBACK_CATEGORIES, normalize } from './classify.js';
import { COVERAGE } from '../brain/coverage.js';
import { DevLab } from './devlab.js';
import { digest } from './sign.js';
import * as insight from './insight.js';

export const MODES = {
  1: { id: 1, name: 'Observe', nameHe: 'צפייה', desc: 'Monitor performance and identify opportunities. No proposals are created.', descHe: 'ניטור ביצועים וזיהוי הזדמנויות. לא נוצרות הצעות.' },
  2: { id: 2, name: 'Recommend', nameHe: 'המלצה', desc: 'Create proposed improvements and explain their expected benefit. Tests run when you start them. (default for system modifications)', descHe: 'יצירת הצעות לשיפור עם הסבר על התועלת. בדיקות רצות כשאת/ה מפעיל/ה אותן. (ברירת מחדל לשינויי מערכת)' },
  3: { id: 3, name: 'Experiment', nameHe: 'ניסוי', desc: 'As mode 2, and proposals are tested automatically in the isolated sandbox. Deployment still needs your approval.', descHe: 'כמו מצב 2, וההצעות נבדקות אוטומטית בסביבה המבודדת. פריסה עדיין דורשת את אישורך.' },
  4: { id: 4, name: 'Approved deployment', nameHe: 'פריסה מאושרת', desc: 'As mode 3. Changes are deployed after your approval and successful validation; only change types you explicitly authorized as low-risk and reversible may deploy automatically after passing every test.', descHe: 'כמו מצב 3. שינויים נפרסים אחרי אישורך ובדיקה מוצלחת; רק סוגי שינוי שאישרת מראש כנמוכי סיכון והפיכים יכולים להיפרס אוטומטית אחרי שעברו כל בדיקה.' },
};
/** Change types that may ever be auto-applied (only if the owner lists them and only in mode 4). */
export const AUTO_ELIGIBLE = ['personality', 'intent_alias', 'preferences'];

export const PROFILE_CATEGORIES = {
  communication: { en: 'Communication style', he: 'סגנון תקשורת' },
  language: { en: 'Language', he: 'שפה' },
  schedule: { en: 'Schedule and routines', he: 'לוח זמנים ושגרה' },
  interests: { en: 'Interests and preferences', he: 'תחומי עניין והעדפות' },
  home: { en: 'Home', he: 'בית' },
  task_organization: { en: 'Task organization', he: 'ארגון משימות' },
  notifications: { en: 'Notifications', he: 'התראות' },
  applications: { en: 'Preferred applications', he: 'אפליקציות מועדפות' },
  devices: { en: 'Device preferences', he: 'העדפות מכשירים' },
  projects: { en: 'Project priorities', he: 'עדיפויות פרויקטים' },
  finance_categorization: { en: 'Expense categorization', he: 'סיווג הוצאות' },
};

const DAY = 86400e3;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const pct = (a, b) => (b ? Math.round((a * 100) / b) : null);
const p95 = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const dayOf = (iso) => String(iso ?? '').slice(0, 10);

// Hebrew → English hints so capability search can match Hebrew phrasing.
const HINTS = [
  [/כסף|כספ|חשבון|הוצא|תקציב|מאזן|הון|עושר/, 'money finance wealth overview spending'],
  [/משימ|מטל/, 'tasks list'], [/יומן|לו"?ז|פגיש|אירוע/, 'calendar agenda briefing'], [/קניות|לקנות/, 'shopping list'],
  [/מכשיר|בית|אור|מנעול/, 'home devices'], [/בריאות|שינה|צעדים/, 'health'], [/תדריך|בוקר|סיכום/, 'briefing summary day'],
  [/חשבונות|לשלם/, 'bills upcoming'], [/יעד|חיסכון/, 'goals savings'], [/הרגל/, 'habit status'], [/פתק|הערות/, 'notes list'],
];

export class LearningEngine {
  constructor(s) { this.s = s; this.versions = new Versions(s); this.devlab = new DevLab(s); }
  security(type, detail = {}) { const e = this.s.store.insert('learning_security', { type, detail, at: now() }); this.s.audit.log('learning-engine', `learning.security.${type}`, detail, 'denied'); return e; }

  // ---------------- mode & audit ----------------
  mode() { return this.s.store.getMeta('learningMode', 2); }
  modes() { return { current: this.mode(), modes: Object.values(MODES), protected: PROTECTED, autoApply: this.autoApply(), autoEligible: AUTO_ELIGIBLE }; }
  setMode(level, actor) {
    // Only the owner can change how much autonomy the learning engine has. The engine itself
    // has no code path that calls this, so it can never widen its own boundaries.
    if (actor !== 'user') { this.security('unauthorized.mode_change', { actor, requested: level }); throw err('only the owner can change the learning mode', 403); }
    const l = Number(level);
    if (!MODES[l]) throw err('mode must be 1-4');
    const prev = this.mode();
    this.s.store.setMeta('learningMode', l);
    this.log('mode.changed', { from: prev, to: l }, actor);
    return this.modes();
  }
  log(action, detail = {}, actor = 'learning-engine') {
    const rec = this.s.store.insert('learning_audit', { action, actor, detail, at: now() });
    this.s.audit.log(actor, `learning.${action}`, detail);
    return rec;
  }
  event(type, data = {}) { return this.s.store.insert('learning_events', { type, ...data, at: now() }); }
  audit(n = 200) { return this.s.store.all('learning_audit').slice(-n).reverse(); }

  // ---------------- performance monitoring ----------------
  performance({ days = 14, channel, agent, tool, from, to } = {}) {
    const end = to ? Date.parse(to) + DAY : Date.now();
    const start = from ? Date.parse(from) : end - Number(days) * DAY;
    const inRange = (iso) => { const t = Date.parse(iso); return t >= start && t < end; };
    const tasks = this.s.store.all('tasks_exec', (t) => inRange(t.createdAt)
      && (!channel || t.channel === channel) && (!agent || t.plan?.agents?.includes(agent)) && (!tool || t.plan?.tools?.includes(tool)));
    const fb = this.s.store.all('feedback', (f) => inRange(f.at ?? f.createdAt) && (!agent || f.agents?.includes(agent)) && (!tool || f.tools?.includes(tool)));
    const calls = (this.s.metrics?.calls ?? []).filter((c) => c.at >= start && c.at < end);
    const days_ = new Map();
    for (let d = start; d < end; d += DAY) days_.set(dayOf(new Date(d).toISOString()), { day: dayOf(new Date(d).toISOString()), tasks: 0, completed: 0, failed: 0, clarifications: 0, ms: [], verifiedSteps: 0, steps: 0, up: 0, down: 0, modelCalls: 0, modelErrors: 0, costUsd: 0 });
    const bucket = (iso) => days_.get(dayOf(iso));
    for (const t of tasks) {
      const b = bucket(t.createdAt); if (!b) continue;
      b.tasks++; if (t.state === 'COMPLETED') b.completed++; if (t.state === 'FAILED') b.failed++;
      if (t.history?.some((h) => h.to === 'AWAITING_INPUT')) b.clarifications++;
      if (t.durationMs != null) b.ms.push(t.durationMs);
      for (const st of t.plan?.steps ?? []) if (st.status === 'done') { b.steps++; if (st.verified !== false) b.verifiedSteps++; }
    }
    for (const f of fb) { const b = bucket(f.at ?? f.createdAt); if (b) f.rating > 0 ? b.up++ : b.down++; }
    for (const c of calls) { const b = bucket(new Date(c.at).toISOString()); if (b) { b.modelCalls++; if (!c.ok) b.modelErrors++; b.costUsd += c.costUsd ?? 0; } }
    const series = [...days_.values()].map(({ ms, ...b }) => ({ ...b, successPct: pct(b.completed, b.completed + b.failed), avgMs: ms.length ? Math.round(ms.reduce((a, x) => a + x, 0) / ms.length) : null, p95Ms: p95(ms), verifiedPct: pct(b.verifiedSteps, b.steps), satisfactionPct: pct(b.up, b.up + b.down), costUsd: +b.costUsd.toFixed(4) }));
    const fin = tasks.filter((t) => ['COMPLETED', 'FAILED'].includes(t.state));
    const allMs = tasks.map((t) => t.durationMs).filter((x) => x != null);
    const group = (keyFn) => { const m = {}; for (const t of tasks) for (const k of [].concat(keyFn(t) ?? [])) { const x = (m[k] ??= { key: k, tasks: 0, completed: 0, failed: 0 }); x.tasks++; if (t.state === 'COMPLETED') x.completed++; if (t.state === 'FAILED') x.failed++; } return Object.values(m).map((x) => ({ ...x, successPct: pct(x.completed, x.completed + x.failed) })).sort((a, b) => b.tasks - a.tasks); };
    return {
      filters: { from: new Date(start).toISOString().slice(0, 10), to: new Date(end - 1).toISOString().slice(0, 10), channel: channel ?? null, agent: agent ?? null, tool: tool ?? null },
      totals: {
        tasks: tasks.length, successPct: pct(fin.filter((t) => t.state === 'COMPLETED').length, fin.length), avgMs: allMs.length ? Math.round(allMs.reduce((a, x) => a + x, 0) / allMs.length) : null, p95Ms: p95(allMs),
        clarificationPct: pct(tasks.filter((t) => t.history?.some((h) => h.to === 'AWAITING_INPUT')).length, tasks.length),
        satisfactionPct: pct(fb.filter((f) => f.rating > 0).length, fb.length), feedback: fb.length,
        modelCalls: calls.length, modelErrorPct: pct(calls.filter((c) => !c.ok).length, calls.length), costUsd: +calls.reduce((a, c) => a + (c.costUsd ?? 0), 0).toFixed(4),
      },
      series, byChannel: group((t) => t.channel ?? 'text'), byAgent: group((t) => t.plan?.agents ?? []), byTool: group((t) => t.plan?.tools ?? []),
      history: this.s.store.all('perf_snapshots').slice(-90),
    };
  }
  /** Daily snapshot so history survives in-memory metric resets. */
  snapshot() {
    const day = dayOf(now());
    const existing = this.s.store.all('perf_snapshots', (x) => x.day === day)[0];
    const { totals } = this.performance({ days: 1 });
    return existing ? this.s.store.update('perf_snapshots', existing.id, { ...totals }) : this.s.store.insert('perf_snapshots', { day, ...totals });
  }

  // ---------------- error analysis ----------------
  signals({ windowDays = 14 } = {}) {
    const since = Date.now() - windowDays * DAY;
    const recent = (iso) => Date.parse(iso) >= since;
    const out = [];
    for (const f of this.s.store.all('failures', (x) => recent(x.at))) {
      const t = f.taskId ? this.s.store.get('tasks_exec', f.taskId) : null;
      if (t?.actor && t.actor !== 'user' && !String(t.actor).startsWith('device:')) continue; // automations/eval are not user experience
      out.push({ source: 'failure', id: f.id, taskId: f.taskId, at: f.at, message: t?.objective ?? '', error: f.message, kind: f.kind, tool: f.tool ?? t?.plan?.tools?.[0] ?? null, agent: t?.plan?.agents?.[0] ?? null, entityId: t?.plan?.steps?.find((st) => st.args?.entityId)?.args.entityId ?? null, channel: t?.channel });
    }
    for (const f of this.s.store.all('feedback', (x) => x.rating < 0 && recent(x.at ?? x.createdAt))) {
      const t = this.s.store.get('tasks_exec', f.taskId);
      out.push({ source: 'feedback', id: f.id, taskId: f.taskId, at: f.at ?? f.createdAt, message: t?.objective ?? '', note: f.note, category: f.category, tool: f.tools?.[0] ?? null, agent: f.agents?.[0] ?? null });
    }
    for (const m of this.s.store.all('missions', (x) => recent(x.createdAt))) {
      for (const t of (m.tasks ?? []).filter((x) => ['failed', 'blocked'].includes(x.status))) out.push({ source: 'mission', id: `${m.id}:${t.id}`, taskId: m.id, at: t.finishedAt ?? m.createdAt, message: m.objective, error: (t.issues ?? []).join('; ') || String(t.result ?? t.status), tool: t.tool ?? null, agent: t.agent ?? null });
    }
    for (const a of this.s.store.all('approvals', (x) => x.status === 'rejected' && recent(x.createdAt))) {
      const t = this.s.store.get('tasks_exec', a.taskId);
      if (t && t.actor === 'user') out.push({ source: 'approval_rejected', id: a.id, taskId: a.taskId, at: a.decidedAt ?? a.createdAt, message: t.objective, tool: t.plan?.tools?.[0] ?? null, agent: t.plan?.agents?.[0] ?? null, error: 'user rejected the proposed action' });
    }
    for (const t of this.s.store.all('tasks_exec', (x) => x.state === 'CANCELLED' && recent(x.createdAt) && x.history?.some((h) => /superseded/.test(h.note ?? '')))) {
      out.push({ source: 'abandoned', id: t.id, taskId: t.id, at: t.createdAt, message: t.objective, tool: t.history.find((h) => /^missing /.test(h.note ?? ''))?.note.slice(8).split('.')[0] ?? null });
    }
    return out;
  }

  /** Execution logs, tool outputs and verification evidence behind one signal (for the evidence view). */
  logs(taskId) {
    const t = taskId && this.s.store.get('tasks_exec', taskId);
    return {
      task: t ? { id: t.id, objective: t.objective, state: t.state, channel: t.channel, history: t.history, analysis: t.analysis ? { kind: t.analysis.kind, strategy: t.analysis.strategy, confidence: t.analysis.confidence } : null, steps: (t.plan?.steps ?? []).map((x) => ({ n: x.n, tool: x.tool, agent: x.agent, status: x.status, verified: x.verified, summary: String(x.summary ?? '').slice(0, 300), error: x.error ?? null })) } : null,
      executions: this.s.store.all('tool_executions', (x) => x.taskId === taskId).map((x) => ({ tool: x.tool, agent: x.agent, risk: x.risk, decision: x.decision, verified: x.verified, summary: x.summary, at: x.at })),
      failures: this.s.store.all('failures', (x) => x.taskId === taskId),
    };
  }

  /** Best READ-only, available capability for a free-text request (null if nothing fits well). */
  bestReadTool(message) {
    const hint = HINTS.filter(([re]) => re.test(message)).map(([, h]) => h).join(' ');
    const hits = this.s.capabilities.search(`${message} ${hint}`, 10)
      .filter((c) => c.permissions?.risk === 'read' && c.availability === 'available' && !/^(llm|ai|chat|agents|research|vision|computer)\./.test(c.id) && this.s.tools[c.id] && !Object.keys(this.s.tools[c.id].input ?? {}).some((k) => this.s.tools[c.id].input[k]?.required));
    return hits[0] && hits[0].score >= 0.25 ? { tool: hits[0].id, score: hits[0].score, description: hits[0].description } : null;
  }

  /** Root-cause hypothesis. Never claims a cause the evidence does not support. */
  hypothesis(p, { min = 3 } = {}) {
    if (!p.recurring) return { status: 'insufficient-evidence', cause: null, note: `Only ${p.occurrences} occurrence(s) in the window; at least ${min} are needed before naming a likely cause.`, noteHe: `רק ${p.occurrences} מקרים בחלון הזמן; צריך לפחות ${min} כדי להצביע על סיבה סבירה.`, action: null };
    const n = p.occurrences;
    const sol = (type, risk, en, he, extra = {}) => ({ type, risk, reversible: risk !== 'high', requiresApproval: true, en, he, ...extra });
    const G = (text, textHe, extra = {}) => ({ type: 'guidance', text, textHe, ...extra });
    if (p.cls === 'model_selection' || (p.cls === 'intent_misinterpretation' && p.tool === 'llm.answer')) {
      const picks = p.messages.map((m) => this.bestReadTool(m)).filter(Boolean);
      const counts = {}; for (const x of picks) counts[x.tool] = (counts[x.tool] ?? 0) + 1;
      const [tool, hits] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
      const noModel = !this.s.router.providers.anthropic;
      if (tool && hits >= Math.max(2, Math.ceil(n * 0.6))) {
        return { status: 'likely', cause: `These requests have no deterministic intent rule, so they fall through to the AI model path${noModel ? ', which is not available here' : ''}. ${hits} of ${n} match the existing read-only capability "${tool}".`, causeHe: `לבקשות האלה אין כלל זיהוי קבוע, ולכן הן עוברות למודל ה-AI${noModel ? ', שלא זמין כאן' : ''}. ${hits} מתוך ${n} מתאימות ליכולת הקיימת לקריאה בלבד "${tool}".`, evidenceFor: [`${hits}/${n} requests match ${tool}`, `all ${n} were routed to llm.answer`],
          solutions: [sol('intent_alias', 'low', `Teach these phrases to open ${tool} (read-only, reversible)`, `ללמד את הביטויים לפתוח את ${tool} (קריאה בלבד, הפיך)`), sol('guidance', 'none', 'Configure an AI model', 'להגדיר מודל AI', { requiresApproval: false }), sol('new_intent_rule', 'medium', 'Developer adds a parser rule (code change, needs review)', 'מפתח מוסיף כלל לפענוח (שינוי קוד, דורש סקירה)')],
          action: { type: 'intent_alias', tool } };
      }
      if (noModel) return { status: 'likely', cause: 'No AI model is configured, and these are open questions that need one.', causeHe: 'לא מוגדר מודל AI, ואלה שאלות פתוחות שדורשות מודל.', evidenceFor: ['no model provider configured', `${n} requests needed a model`], solutions: [sol('guidance', 'none', 'Configure an AI model', 'להגדיר מודל AI', { requiresApproval: false })], action: G('Open JARVIS in claude.ai or add an API key in Settings.', 'פתחו את JARVIS ב-claude.ai או הוסיפו מפתח API בהגדרות.') };
      return { status: 'insufficient-evidence', cause: null, note: 'The requests do not point to one capability; more examples are needed.', noteHe: 'הבקשות לא מצביעות על יכולת אחת; צריך עוד דוגמאות.', action: null };
    }
    const notes = p.evidence.map((e) => e.error.toLowerCase());
    const share = (re) => notes.filter((x) => re.test(x)).length;
    switch (p.cls) {
      case 'expectation_mismatch': {
        const long = share(/too_long|long|ארוך|verbose/); const short = share(/too_short|short|קצר|מפורט/);
        const wrong = share(/wrong|incorrect|לא נכון|שגוי|טעות|המצאת|made up|accuracy/);
        if ((long >= 2 || short >= 2) && !this.categoryEnabled('communication')) return { status: 'insufficient-evidence', cause: null, note: 'Communication learning is disabled in your profile.', noteHe: 'למידת סגנון תקשורת כבויה בפרופיל שלך.', action: null };
        if (long >= 2 && long > short) return { status: 'likely', cause: `Answers are too long for you (${long} signals, ${short} opposite).`, causeHe: `התשובות ארוכות מדי בשבילך (${long} סימנים, ${short} הפוכים).`, evidenceFor: [`${long} feedback signals about length`], solutions: [sol('personality', 'low', 'Default to short answers (reversible)', 'ברירת מחדל לתשובות קצרות (הפיך)')], action: { type: 'personality', patch: { verbosity: 'short' } } };
        if (short >= 2 && short > long) return { status: 'likely', cause: `Answers are too short for you (${short} signals, ${long} opposite).`, causeHe: `התשובות קצרות מדי בשבילך (${short} סימנים, ${long} הפוכים).`, evidenceFor: [`${short} feedback signals about length`], solutions: [sol('personality', 'low', 'Default to detailed answers (reversible)', 'ברירת מחדל לתשובות מפורטות (הפיך)')], action: { type: 'personality', patch: { verbosity: 'detailed' } } };
        if (wrong >= Math.max(2, Math.ceil(n * 0.6))) return { status: 'likely', cause: `${wrong} answers were reported as wrong. The feedback does not say which part, so the true cause is not confirmed; a stricter grounding instruction is a reasonable, reversible mitigation.`, causeHe: `${wrong} תשובות דווחו כשגויות. המשוב לא מציין איזה חלק, ולכן הסיבה האמיתית לא אושרה; הנחיית עיגון מחמירה היא צעד סביר והפיך.`, evidenceFor: [`${wrong}/${n} feedback signals: wrong`], solutions: [sol('prompt_overlay', 'medium', 'Add a grounding instruction to the prompt overlay', 'הוספת הנחיית עיגון לפרומפט'), sol('routing', 'medium', 'Route these requests to a deeper model (needs model benchmarks first)', 'לנתב לבקשות מודל עמוק יותר (דורש מדדי מודלים קודם)')], action: { type: 'prompt_overlay', text: 'When answering about the user\'s own data, rely only on the records provided and name the record you used. If the records do not contain the answer, say you are not sure instead of estimating.' } };
        return { status: 'insufficient-evidence', cause: null, note: 'Negative feedback without a consistent reason.', noteHe: 'משוב שלילי בלי סיבה עקבית.', action: null };
      }
      case 'calculation_error': return { status: 'likely', cause: `${n} results involving numbers were reported wrong. JARVIS computes money, dates and units deterministically; if the numbers came from the model, the request missed the calculator path.`, causeHe: `${n} תוצאות עם מספרים דווחו כשגויות. JARVIS מחשב כסף, תאריכים ויחידות באופן דטרמיניסטי; אם המספרים הגיעו מהמודל, הבקשה פספסה את מסלול המחשבון.`, evidenceFor: [`${n} calculation complaints`, `tools: ${p.tool ?? 'unknown'}`], solutions: [sol('prompt_overlay', 'medium', 'Instruct the model to use calc tools for every number', 'להנחות את המודל להשתמש במחשבון לכל מספר')], action: { type: 'prompt_overlay', text: 'Never compute numbers in your head: use the calc, date and convert tools for every calculation and show the formula.' } };
      case 'external_api': return { status: 'likely', cause: `${p.target ?? p.tool} was unavailable in ${n} attempts.`, causeHe: `${p.target ?? p.tool} לא היה זמין ב-${n} ניסיונות.`, evidenceFor: [`${n} offline/HTTP errors for the same target`], solutions: [sol('guidance', 'none', 'Check the device or service', 'לבדוק את המכשיר או השירות', { requiresApproval: false })], action: G('Check the device or service power and connection.', 'בדקו חשמל וחיבור של המכשיר או השירות.') };
      case 'permission_denied': return { status: 'likely', cause: `Your permission settings blocked ${p.tool ?? 'an action'} ${n} times.`, causeHe: `הגדרות ההרשאות חסמו את ${p.tool ?? 'הפעולה'} ${n} פעמים.`, evidenceFor: [`${n} policy blocks`], solutions: [sol('guidance', 'none', 'Review permissions yourself (protected area)', 'לבדוק הרשאות בעצמך (אזור מוגן)', { requiresApproval: false })], action: G('Permissions are protected: the learning engine will not change them. Review them yourself in Privacy if this is intended.', 'הרשאות מוגנות: מנוע הלמידה לא ישנה אותן. אם זה רצוי, בדקו אותן בעצמכם בפרטיות.', { protected: true }) };
      case 'missing_context': return { status: 'likely', cause: `Clarification questions for ${p.tool ?? 'requests'} were abandoned ${n} times.`, causeHe: `שאלות הבהרה עבור ${p.tool ?? 'בקשות'} ננטשו ${n} פעמים.`, evidenceFor: [`${n} abandoned clarifications`], solutions: [sol('guidance', 'none', 'Include the missing detail up front', 'לכלול את הפרט החסר מראש', { requiresApproval: false })], action: G('Include the missing detail in the first request (for example the time for a reminder).', 'כדאי לכלול את הפרט החסר כבר בבקשה (למשל שעה לתזכורת).') };
      case 'data_inconsistency': return { status: 'likely', cause: `Names used in requests did not match records for ${p.tool} (${n} times).`, causeHe: `השמות בבקשות לא תאמו לרשומות עבור ${p.tool} (${n} פעמים).`, evidenceFor: [`${n} not-found/mismatch errors`], solutions: [sol('guidance', 'none', 'Fix record names or add the record', 'לתקן שמות רשומות או להוסיף רשומה', { requiresApproval: false })], action: G('Check the record names or add the missing record.', 'בדקו את שמות הרשומות או הוסיפו את הרשומה החסרה.') };
      case 'agent_coordination': return { status: 'likely', cause: `${n} multi-step or mission tasks were blocked by dependencies or step limits.`, causeHe: `${n} משימות מרובות שלבים נחסמו בגלל תלויות או מגבלת צעדים.`, evidenceFor: [`${n} coordination errors`], solutions: [sol('guidance', 'none', 'Split the goal into smaller missions', 'לפצל את המטרה למשימות קטנות יותר', { requiresApproval: false })], action: G('Split large goals into smaller missions; step limits are a safety boundary and are not raised automatically.', 'פצלו מטרות גדולות למשימות קטנות; מגבלות צעדים הן גבול בטיחות ולא מועלות אוטומטית.') };
      default: {
        const same = new Set(p.evidence.map((e) => e.error)).size === 1;
        return same ? { status: 'likely', cause: `The same error repeats ${n} times: "${p.evidence[0].error}".`, causeHe: `אותה שגיאה חוזרת ${n} פעמים: "${p.evidence[0].error}".`, evidenceFor: ['identical error messages'], solutions: [sol('developer_fix', 'medium', 'Developer fix through the Development Lab', 'תיקון של מפתח דרך מעבדת הפיתוח')], action: G('Recorded for a developer fix.', 'נרשם לתיקון על ידי מפתח.') }
          : { status: 'insufficient-evidence', cause: null, note: 'Errors differ; no single cause is supported by the evidence.', noteHe: 'השגיאות שונות; הראיות לא תומכות בסיבה אחת.', action: null };
      }
    }
  }

  /** Detect patterns, store them, and (mode ≥ 2) create proposals. */
  analyze({ windowDays = 14, min = 3 } = {}) {
    const found = clusterSignals(this.signals({ windowDays }), { min });
    const out = [];
    for (const p of found) {
      const hyp = this.hypothesis(p, { min });
      const prev = this.s.store.all('failure_patterns', (x) => x.signature === p.signature)[0];
      const data = { ...p, messages: p.messages.slice(-20), hypothesis: hyp, analyzedAt: now() };
      let rec;
      if (prev) {
        const reopened = prev.status === 'resolved' && p.recurring && Date.parse(p.lastAt) > Date.parse(prev.resolvedAt ?? 0);
        rec = this.s.store.update('failure_patterns', prev.id, { ...data, status: reopened ? 'recurring-after-fix' : prev.status });
        if (reopened) this.log('pattern.recurred_after_fix', { patternId: prev.id, signature: p.signature });
      } else {
        rec = this.s.store.insert('failure_patterns', { ...data, status: 'open' });
        if (p.recurring) { this.event('pattern.detected', { patternId: rec.id, cls: p.cls, occurrences: p.occurrences }); this.log('pattern.detected', { patternId: rec.id, cls: p.cls, occurrences: p.occurrences, cause: hyp.status }); }
      }
      if (this.mode() >= 2 && hyp.status === 'likely' && hyp.action && ['intent_alias', 'personality', 'prompt_overlay'].includes(hyp.action.type) && ['open', 'recurring-after-fix'].includes(rec.status)) {
        try { this.proposeFromPattern(rec); } catch (e) { this.log('proposal.skipped', { patternId: rec.id, reason: e.message }); }
      }
      out.push(this.s.store.get('failure_patterns', rec.id));
    }
    return out;
  }
  patterns() { return this.s.store.all('failure_patterns').slice().sort((a, b) => b.occurrences - a.occurrences); }
  dismissPattern(id, actor) { const p = this.s.store.update('failure_patterns', id, { status: 'dismissed' }); if (!p) throw err('no such pattern', 404); this.log('pattern.dismissed', { patternId: id }, actor); return p; }

  // ---------------- proposals ----------------
  openProposal(signature) { return this.s.store.all('improvement_proposals', (x) => x.signature === signature && !['rejected', 'rolled_back', 'deployed', 'failed-test'].includes(x.status))[0] ?? null; }

  proposeFromPattern(pattern) {
    const existing = this.openProposal(pattern.signature);
    if (existing) return existing;
    const a = pattern.hypothesis.action;
    let target; let candidate; let change; let changeHe; let risk = 'low';
    if (a.type === 'intent_alias') {
      target = 'intent.aliases';
      const cur = this.versions.active(target)?.value ?? this.s.store.getMeta('learnedAliases', []);
      const phrases = [...new Set(pattern.messages.filter((m) => this.bestReadTool(m)?.tool === a.tool).map(normalize))].filter((x) => x.length >= 2 && x.length <= 80).slice(0, 10);
      const fresh = phrases.filter((ph) => !cur.some((x) => x.phrase === ph));
      if (!fresh.length) throw err('all phrases are already learned');
      candidate = [...cur, ...fresh.map((phrase) => ({ phrase, tool: a.tool, args: {}, learnedFrom: pattern.id }))];
      change = `Teach ${fresh.length} phrase(s) to open "${a.tool}" directly: ${fresh.map((x) => `"${x}"`).join(', ')}`;
      changeHe = `ללמד ${fresh.length} ביטויים לפתוח ישירות את "${a.tool}": ${fresh.map((x) => `"${x}"`).join(', ')}`;
    } else if (a.type === 'personality') {
      target = 'personality';
      candidate = { ...targetAdapter(target).get(this.s), ...a.patch };
      change = `Change answer style: ${Object.entries(a.patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`;
      changeHe = `שינוי סגנון התשובות: ${Object.entries(a.patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`;
    } else if (a.type === 'prompt_overlay') {
      target = 'prompt.system_overlay';
      const cur = this.s.store.getMeta('promptOverlay', '');
      if (cur.includes(a.text)) throw err('instruction already present');
      candidate = [cur, a.text].filter(Boolean).join('\n').slice(0, 600);
      change = 'Add a grounding instruction to the system prompt overlay'; changeHe = 'הוספת הנחיית עיגון לתוספת של פרומפט המערכת';
      risk = 'medium';
    } else throw err(`no automatic proposal for ${a.type}`);
    return this.createProposal({ target, candidate, change, changeHe, risk, signature: pattern.signature, patternId: pattern.id, type: a.type, rationale: pattern.hypothesis.cause, rationaleHe: pattern.hypothesis.causeHe, evidence: pattern.evidence, replays: a.type === 'intent_alias' ? [...new Set(pattern.messages)].slice(-5) : [], createdBy: 'learning-engine' });
  }

  createProposal({ target, candidate, change, changeHe, rationale, rationaleHe, evidence = [], replays = [], risk = 'low', signature = null, patternId = null, type = 'manual', createdBy = 'user' }) {
    let adapter;
    try { adapter = targetAdapter(target); } catch (e) { if (e.protected) this.security('change.blocked.protected', { target, by: createdBy }); throw e; } // protected targets are refused before anything is stored
    const errs = adapter.validate(this.s, candidate);
    if (errs.length) { if (errs.some((x) => /forbidden|read-only|arguments/.test(x))) this.security('change.blocked.unsafe', { target, reasons: errs, by: createdBy }); throw err(`invalid proposal: ${errs.join('; ')}`); }
    const p = this.s.store.insert('improvement_proposals', {
      type, target, targetLabel: adapter.label, systemChange: adapter.system, candidate, current: structuredClone(adapter.get(this.s) ?? null),
      change: change ?? `Change ${target}`, changeHe: changeHe ?? change ?? `שינוי ${target}`, rationale: rationale ?? '', rationaleHe: rationaleHe ?? rationale ?? '', evidence, replays, risk, signature, patternId,
      status: 'proposed', requiresApproval: true, experimentId: null, createdBy, at: now(),
    });
    if (patternId) this.s.store.update('failure_patterns', patternId, { proposalId: p.id });
    this.event('proposal.created', { proposalId: p.id, target });
    this.log('proposal.created', { proposalId: p.id, target, type, change: p.change }, createdBy);
    return p;
  }
  proposals(status) { return this.s.store.all('improvement_proposals', (x) => !status || x.status === status).slice().reverse(); }
  proposal(id) { const p = this.s.store.get('improvement_proposals', id); if (!p) throw err('no such proposal', 404); return p; }

  async experiment(id, actor = 'learning-engine') {
    const p = this.proposal(id);
    if (['deployed', 'rejected', 'rolled_back'].includes(p.status)) throw err(`proposal is ${p.status}`);
    this.s.store.update('improvement_proposals', id, { status: 'testing' });
    const { runExperiment } = await import('./experiments.js');
    let result;
    try { result = await runExperiment(this.s, { target: p.target, candidate: p.candidate, replays: p.replays, requireImprovement: p.type === 'intent_alias' }); }
    catch (e) { result = { target: p.target, verdict: 'error', reasons: [e.message] }; }
    const exp = this.s.store.insert('experiments', { proposalId: id, ...result, at: now() });
    const status = result.verdict === 'pass' ? 'tested' : 'failed-test';
    this.s.store.update('improvement_proposals', id, { status, experimentId: exp.id, verdict: result.verdict });
    this.event('experiment.completed', { experimentId: exp.id, proposalId: id, verdict: result.verdict });
    this.log('experiment.completed', { experimentId: exp.id, proposalId: id, verdict: result.verdict, regressions: result.report?.regressions ?? [], improvements: result.report?.improvements ?? [] }, actor);
    if (status === 'tested') { const auto = await this.maybeAutoDeploy(this.proposal(id)); if (!auto) this.requestApproval(id); }
    return exp;
  }
  experiments() { return this.s.store.all('experiments').slice().reverse().map(({ report, ...e }) => ({ ...e, regressions: report?.regressions ?? [], improvements: report?.improvements ?? [] })); }
  experimentReport(id) { const e = this.s.store.get('experiments', id); if (!e) throw err('no such experiment', 404); return e; }

  async maybeAutoDeploy(p) {
    if (p.status !== 'tested') return null;
    // Only in mode 4, and only for change types the owner explicitly listed as auto-applicable
    // (low-risk, reversible). Everything else waits for an explicit approval.
    const m = this.mode();
    if (m < 4 || !this.autoApply().includes(p.type) || !AUTO_ELIGIBLE.includes(p.type)) return null;
    return this.deploy(p.id, `learning-engine (mode ${m}, auto-apply authorized by owner)`, { auto: true });
  }
  autoApply() { return this.s.store.getMeta('learningAutoApply', []); }
  setAutoApply(types, actor) {
    if (actor !== 'user') { this.security('unauthorized.auto_apply', { actor }); throw err('only the owner can authorize automatic changes', 403); }
    const list = [...new Set((types ?? []).filter((x) => AUTO_ELIGIBLE.includes(x)))];
    this.s.store.setMeta('learningAutoApply', list);
    this.log('auto_apply.changed', { types: list }, actor);
    return { autoApply: list, eligible: AUTO_ELIGIBLE };
  }

  // ---------------- deployment approval workflow ----------------
  /** A tested proposal gets an approval request bound to the exact candidate (hash) and expiry. */
  requestApproval(id, actor = 'learning-engine') {
    const p = this.proposal(id);
    if (p.status !== 'tested') throw err(p.status === 'failed-test' ? 'this proposal failed its tests and cannot be deployed' : 'run the experiment before requesting approval');
    const pending = this.s.store.all('deployment_approvals', (x) => x.proposalId === id && x.status === 'pending')[0];
    if (pending) return pending;
    const exp = this.s.store.get('experiments', p.experimentId);
    const a = this.s.store.insert('deployment_approvals', { proposalId: id, target: p.target, change: p.change, candidateHash: digest(p.candidate), experimentId: p.experimentId, verdict: exp?.verdict, regressions: exp?.report?.regressions ?? [], status: 'pending', requestedBy: actor, requestedAt: now(), expiresAt: new Date(Date.now() + 7 * DAY).toISOString() });
    this.log('approval.requested', { approvalId: a.id, proposalId: id }, actor);
    return a;
  }
  approvals(status) { return this.s.store.all('deployment_approvals', (x) => !status || x.status === status).slice().reverse(); }

  /** Owner approval. Deployment is a separate, explicit step (deploy). */
  approve(id, actor) {
    if (actor !== 'user') { this.security('unauthorized.approve', { actor, proposalId: id }); throw err('only the owner can approve a deployment', 403); }
    const p = this.proposal(id);
    if (p.status !== 'tested') throw err(p.status === 'failed-test' ? 'this proposal failed its tests and cannot be deployed' : 'run the experiment before approving');
    const a = this.requestApproval(id, actor);
    this.s.store.update('deployment_approvals', a.id, { status: 'approved', approvedBy: actor, approvedAt: now() });
    this.s.store.update('improvement_proposals', id, { status: 'approved', approvedBy: actor, approvedAt: now(), approvalId: a.id });
    this.log('proposal.approved', { proposalId: id, approvalId: a.id }, actor);
    return { proposal: this.proposal(id), approval: this.s.store.get('deployment_approvals', a.id) };
  }
  reject(id, actor, reason = '') {
    const p = this.proposal(id);
    if (['deployed', 'rolled_back'].includes(p.status)) throw err(`proposal is ${p.status}; roll it back instead`);
    this.s.store.update('improvement_proposals', id, { status: 'rejected', rejectedBy: actor, reason: String(reason).slice(0, 300) });
    for (const a of this.s.store.all('deployment_approvals', (x) => x.proposalId === id && x.status === 'pending')) this.s.store.update('deployment_approvals', a.id, { status: 'rejected', rejectedBy: actor });
    if (p.patternId) this.s.store.update('failure_patterns', p.patternId, { status: 'dismissed' });
    this.log('proposal.rejected', { proposalId: id, reason }, actor);
    return this.proposal(id);
  }

  /** Deploy only an authorized change: owner-approved (hash-bound, unexpired) or auto-applicable by the owner's rules. */
  deploy(id, by, { auto = false } = {}) {
    const p = this.proposal(id);
    const exp = p.experimentId && this.s.store.get('experiments', p.experimentId);
    const approval = p.approvalId && this.s.store.get('deployment_approvals', p.approvalId);
    if (!auto) {
      if (by !== 'user') { this.security('unauthorized.deploy', { actor: by, proposalId: id }); throw err('only the owner can deploy', 403); }
      if (p.status !== 'approved' || approval?.status !== 'approved') { this.security('deploy.blocked.unapproved', { proposalId: id }); throw err('not authorized: a tested proposal needs approval before deployment', 403); }
      if (approval.candidateHash !== digest(p.candidate)) { this.security('deploy.blocked.changed_after_approval', { proposalId: id }); throw err('the change was modified after approval; approve it again', 409); }
      if (Date.parse(approval.expiresAt) < Date.now()) throw err('the approval expired; approve it again', 409);
    } else if (p.status !== 'tested') throw err('not authorized', 403);
    if (!exp || exp.verdict !== 'pass') { this.security('deploy.blocked.no_validation', { proposalId: id }); throw err('deployment needs a passing experiment', 403); }
    const { from, to } = this.versions.commit(p.target, p.candidate, { by, reason: p.change, proposalId: id, experimentId: exp.id, approval: approval ? { id: approval.id, by: approval.approvedBy, at: approval.approvedAt } : { auto: true }, evaluation: { verdict: exp.verdict, baseline: exp.baseline, candidate: exp.candidate, regressions: exp.report?.regressions ?? [] } });
    const d = this.s.store.insert('deployments', { proposalId: id, target: p.target, fromVersion: from.version, toVersion: to.version, by, auto, approvalId: approval?.id ?? null, at: now(), status: 'active', signature: p.signature });
    if (approval) this.s.store.update('deployment_approvals', approval.id, { status: 'deployed', deploymentId: d.id });
    this.s.store.update('improvement_proposals', id, { status: 'deployed', deploymentId: d.id, deployedAt: d.at });
    if (p.patternId) this.s.store.update('failure_patterns', p.patternId, { status: 'resolved', resolvedAt: d.at });
    this.event('deployment', { deploymentId: d.id, proposalId: id, target: p.target });
    this.log('deployed', { deploymentId: d.id, proposalId: id, target: p.target, fromVersion: from.version, toVersion: to.version, auto }, by);
    if (auto) this.s.notifications?.send({ title: `JARVIS learned: ${p.change}`, body: 'Applied automatically under the rules you authorized. You can roll it back in Self-Improvement.', priority: 'normal', event: 'learning.auto_deploy' });
    return { deployment: d, version: to };
  }
  /** Convenience for the owner: approve then deploy in one action. */
  approveAndDeploy(id, actor) { this.approve(id, actor); return this.deploy(id, actor); }
  deployments() {
    return this.s.store.all('deployments').slice().reverse().map((d) => {
      // Post-deployment monitoring: does the problem still occur after the change?
      const after = d.signature ? clusterSignals(this.signals({ windowDays: 30 }).filter((x) => Date.parse(x.at) > Date.parse(d.at))).find((x) => x.signature === d.signature)?.occurrences ?? 0 : null;
      return { ...d, occurrencesSinceDeploy: after };
    });
  }
  rollback({ deploymentId, target, toVersion, reason = 'rollback' } = {}, actor = 'user') {
    if (actor !== 'user') { this.security('unauthorized.rollback', { actor }); throw err('only the owner can roll back', 403); }
    let t = target;
    let d = null;
    if (deploymentId) { d = this.s.store.get('deployments', deploymentId); if (!d) throw err('no such deployment', 404); t = d.target; }
    if (!t) throw err('deploymentId or target required');
    let r;
    try { r = this.versions.rollback(t, d && toVersion == null ? d.fromVersion : toVersion, { by: actor, reason }); } catch (e) { if (e.tampered) this.security('version.tampered', { target: t }); throw e; }
    if (d) {
      this.s.store.update('deployments', d.id, { status: 'rolled_back', rolledBackAt: now() });
      this.s.store.update('improvement_proposals', d.proposalId, { status: 'rolled_back' });
    }
    this.s.store.insert('rollback_records', { deploymentId: d?.id ?? null, target: t, fromVersion: r.from.version, restoredVersion: r.restored, newVersion: r.to.version, by: actor, reason, at: now() });
    this.event('rollback', { target: t, restored: r.restored });
    this.log('rolled_back', { target: t, deploymentId: d?.id ?? null, restoredVersion: r.restored, newVersion: r.to.version }, actor);
    return r;
  }

  // ---------------- learned intents (used by CORE) ----------------
  aliasFor(message) {
    const n = normalize(message);
    const a = this.s.store.getMeta('learnedAliases', []).find((x) => x.phrase === n);
    if (!a || !this.s.tools[a.tool] || riskOf(this.s.tools[a.tool], {}) !== 'read') return null;
    return [{ agent: this.s.agentsFor(a.tool)[0] ?? 'assistant', tool: a.tool, args: {}, learned: true }];
  }

  // ---------------- feedback & personalization profile ----------------
  categoryEnabled(cat) { return !(this.s.store.getMeta('profileDisabled', []).includes(cat)); }
  setCategoryEnabled(cat, enabled, actor) {
    if (!PROFILE_CATEGORIES[cat]) throw err('unknown category');
    const set = new Set(this.s.store.getMeta('profileDisabled', []));
    enabled ? set.delete(cat) : set.add(cat);
    this.s.store.setMeta('profileDisabled', [...set]);
    this.log('profile.category', { category: cat, enabled }, actor);
    return this.profile();
  }

  /** Structured feedback → preference proposals once signals are consistent (never from one example). */
  onFeedback(fb) {
    this.event('feedback', { feedbackId: fb.id, rating: fb.rating, category: fb.category ?? null, channel: fb.channel ?? null, source: fb.source ?? 'rating' });
    if (fb.rating > 0) return null;
    const finance = (fb.tools ?? []).some((t) => /^wealth\./.test(t));
    // A correction about a financial answer applies to that answer only: it is never generalized.
    if (finance && fb.correction && !['too_long', 'too_short', 'format'].includes(fb.category)) {
      this.event('feedback.scoped', { feedbackId: fb.id, scope: `task:${fb.taskId}`, generalize: false });
      return null;
    }
    const recent = this.s.store.all('feedback', (f) => f.rating < 0 && Date.now() - Date.parse(f.at ?? f.createdAt) < 30 * DAY);
    const isFin = (f) => (f.tools ?? []).some((t) => /^wealth\./.test(t));
    const pool = finance ? recent.filter(isFin) : recent.filter((f) => !isFin(f));
    const cnt = (c) => pool.filter((f) => f.category === c).length;
    const fmt = /table|טבלה/i.test(fb.note) ? 'table' : /bullet|list|רשימה|נקודות/i.test(fb.note) ? 'bullets' : /prose|פסקה|טקסט רציף/i.test(fb.note) ? 'prose' : null;
    const rules = finance
      ? [['too_long', 'too_short', 'communication', 'finance_report_style', 'concise', 'Family Wealth OS reports'], ['too_short', 'too_long', 'communication', 'finance_report_style', 'detailed', 'Family Wealth OS reports']]
      : [['too_long', 'too_short', 'communication', 'verbosity', 'short', 'all channels'], ['too_short', 'too_long', 'communication', 'verbosity', 'detailed', 'all channels'], ['language', null, 'language', 'language', fb.lang === 'en' ? 'he' : 'en', 'all channels'], ['format', null, 'communication', 'format', fmt, 'answers']];
    for (const [c, opposite, category, key, value, scope] of rules) {
      if (fb.category !== c || !value) continue;
      const n = c === 'format' ? pool.filter((f) => f.category === 'format' && new RegExp(value === 'table' ? 'table|טבלה' : value === 'bullets' ? 'bullet|list|רשימה|נקודות' : 'prose|פסקה', 'i').test(f.note)).length : cnt(c);
      const o = opposite ? cnt(opposite) : 0;
      if (n < 2 || o >= n) return null; // one example, or conflicting signals: do not learn
      if (!this.categoryEnabled(category)) return null;
      const exists = this.s.store.all('profile_items', (x) => x.key === key && x.value === value && ['proposed', 'active'].includes(x.status))[0];
      if (exists) return exists;
      const item = this.s.store.insert('profile_items', { category, key, value, source: 'feedback', confidence: +(n / (n + o + 1)).toFixed(2), observedAt: now(), scope, expiresAt: new Date(Date.now() + 180 * DAY).toISOString(), status: 'proposed', evidence: pool.filter((f) => f.category === c).slice(-5).map((f) => ({ feedbackId: f.id, taskId: f.taskId, note: f.note })) });
      this.log('profile.proposed', { itemId: item.id, key, value, signals: n, scope }, 'learning-engine');
      return item;
    }
    return null;
  }

  /** Repeated, non-sensitive behavior patterns become PROPOSED profile items (never active without approval). */
  refreshObserved() {
    const made = [];
    for (const o of insight.observedPatterns(this.s)) {
      if (!this.categoryEnabled(o.category)) continue;
      if (this.s.store.all('profile_items', (x) => x.key === o.key && x.value === o.value).length) continue;
      made.push(this.s.store.insert('profile_items', { category: o.category, key: o.key, value: o.value, source: 'observed behavior', confidence: o.confidence, observedAt: now(), scope: 'general', expiresAt: new Date(Date.now() + 90 * DAY).toISOString(), status: 'proposed', evidence: [{ note: o.evidence }] }));
    }
    if (made.length) this.log('profile.observed', { items: made.map((x) => x.key) });
    return made;
  }

  profile() {
    const disabled = new Set(this.s.store.getMeta('profileDisabled', []));
    const items = this.s.store.all('profile_items', (x) => x.status !== 'rejected');
    // Health, financial and family memories are never used for unrelated personalization.
    const mem = this.s.memory.list().filter((m) => m.type === 'preference' && !['financial', 'health', 'family'].includes(m.domain)).map((m) => ({ id: m.id, category: /שעה|בוקר|ערב|morning|evening|schedule|routine/i.test(m.content) ? 'schedule' : /אור|בית|home|light|temperature/i.test(m.content) ? 'home' : /התראה|notification|notify/i.test(m.content) ? 'notifications' : 'interests', key: 'preference', value: m.content, source: m.provenance === 'user_statement' ? 'you said' : 'inferred (awaiting review)', confidence: m.confidence ?? null, observedAt: m.createdAt, scope: m.domain ?? 'general', expiresAt: m.expiresAt ?? null, status: m.provenance === 'inferred' ? 'proposed' : 'active', memory: true }));
    const p = this.s.personality.get();
    const pv = this.s.store.getMeta('privacy', {});
    const live = [
      { id: 'personality.verbosity', category: 'communication', key: 'verbosity', value: p.verbosity, source: 'settings', status: 'active', live: true },
      { id: 'personality.style', category: 'communication', key: 'style', value: p.style, source: 'settings', status: 'active', live: true },
      { id: 'personality.format', category: 'communication', key: 'format', value: p.format ?? 'auto', source: 'settings', status: 'active', live: true },
      { id: 'personality.language', category: 'language', key: 'language', value: p.language, source: 'settings', status: 'active', live: true },
      ...(pv.quietHours ? [{ id: 'privacy.quietHours', category: 'notifications', key: 'quiet_hours', value: JSON.stringify(pv.quietHours), source: 'settings', status: 'active', live: true }] : []),
      ...this.s.store.getMeta('scopedPreferences', []).map((x, i) => ({ id: `scoped.${i}`, category: 'communication', key: 'scoped', value: x.instruction, scope: x.scope, source: 'your approval', status: 'active', live: true })),
    ];
    const fin = this.s.store.all('learning_events', (e) => e.type === 'fwos.categorized').slice(-20).map((e) => ({ id: e.id, category: 'finance_categorization', key: e.merchant, value: e.categoryName, source: 'your approval', status: 'active', observedAt: e.at }));
    const all = [...live, ...items, ...mem, ...fin];
    return { categories: Object.entries(PROFILE_CATEGORIES).map(([id, label]) => ({ id, label, enabled: !disabled.has(id), items: all.filter((x) => x.category === id) })), sensitive: 'Health, financial and family data are not used for personalization.' };
  }
  approveProfileItem(id, actor) {
    const it = this.s.store.get('profile_items', id);
    if (!it || it.status !== 'proposed') throw err('no such proposed item', 404);
    this.applyProfileValue(it, it.value, actor);
    this.s.store.update('profile_items', id, { status: 'active', approvedAt: now() });
    this.log('profile.approved', { itemId: id, key: it.key, value: it.value }, actor);
    return this.profile();
  }
  /** Approved profile values that shape behavior go through versioned targets (so they can be rolled back). */
  applyProfileValue(it, value, actor) {
    if (['verbosity', 'language', 'style', 'format'].includes(it.key)) return this.versions.commit('personality', { ...targetAdapter('personality').get(this.s), [it.key]: value }, { by: actor, reason: `profile: ${it.key} → ${value}` });
    if (it.key === 'finance_report_style') {
      const cur = this.s.store.getMeta('scopedPreferences', []).filter((x) => x.scope !== it.scope);
      return this.versions.commit('preferences.scoped', [...cur, { scope: it.scope, instruction: value === 'concise' ? 'keep summaries concise: key numbers first, at most 5 lines' : 'give detailed summaries with the breakdown' }], { by: actor, reason: `scoped preference for ${it.scope}` });
    }
    return null; // informational preference (routines, apps, devices): recorded, no behavior change
  }
  correctProfileItem(id, value, actor) {
    const it = this.s.store.get('profile_items', id);
    if (!it) throw err('no such item', 404);
    this.s.store.update('profile_items', id, { value, source: 'corrected by you', confidence: 1 });
    if (it.status === 'active') this.applyProfileValue(it, value, actor);
    this.log('profile.corrected', { itemId: id, key: it.key }, actor);
    return this.profile();
  }
  deleteProfileItem(id, actor) {
    if (!this.s.store.get('profile_items', id)) throw err('no such item', 404);
    this.s.store.update('profile_items', id, { status: 'rejected' });
    this.log('profile.deleted', { itemId: id }, actor);
    return this.profile();
  }
  exportProfile() {
    return { exportedAt: now(), format: 'jarvis-profile-v1', mode: this.mode(), ...this.profile(), versions: this.versions.history('personality') };
  }

  // ---------------- models & agents ----------------
  modelBenchmarks({ persist = false, min = 5 } = {}) {
    const calls = this.s.metrics?.calls ?? [];
    const by = {};
    for (const c of calls) {
      const k = `${c.task ?? 'general'}|${c.model}`;
      const x = (by[k] ??= { task: c.task ?? 'general', model: c.model, tier: c.tier, calls: 0, errors: 0, lat: [], costUsd: 0 });
      x.calls++; if (!c.ok) x.errors++; x.lat.push(c.latencyMs); x.costUsd += c.costUsd ?? 0;
    }
    const rows = Object.values(by).map(({ lat, ...x }) => ({ ...x, errorPct: pct(x.errors, x.calls), avgMs: Math.round(lat.reduce((a, v) => a + v, 0) / lat.length), p95Ms: p95(lat), costPerCallUsd: +(x.costUsd / x.calls).toFixed(5), enoughData: x.calls >= min }));
    const tasks = [...new Set(rows.map((r) => r.task))];
    const recommendations = tasks.map((task) => {
      const rs = rows.filter((r) => r.task === task && r.enoughData);
      if (rs.length < 2) return { task, status: 'insufficient-data', note: `Needs at least ${min} calls on two models to compare.`, noteHe: `צריך לפחות ${min} קריאות בשני מודלים כדי להשוות.` };
      const best = [...rs].sort((a, b) => (a.errorPct - b.errorPct) || (a.costPerCallUsd - b.costPerCallUsd) || (a.avgMs - b.avgMs))[0];
      return { task, status: 'recommendation', tier: best.tier, model: best.model, basis: `lowest error rate (${best.errorPct}%), then cost and latency, over ${best.calls} calls` };
    });
    const out = { at: now(), rows, recommendations, prefs: this.s.store.getMeta('modelPrefs', {}), note: 'Live metrics only (metadata, no content). Accuracy needs labelled answers; satisfaction comes from your feedback.' };
    if (persist) this.s.store.insert('model_benchmarks', out);
    return out;
  }
  agentEvaluations() {
    const tasks = this.s.store.all('tasks_exec');
    const fb = this.s.store.all('feedback');
    const denials = this.s.audit.list(2000).filter((a) => a.action === 'permission.denied');
    const ids = [...new Set(tasks.flatMap((t) => t.plan?.agents ?? []))];
    return ids.map((id) => {
      const mine = tasks.filter((t) => t.plan?.agents?.includes(id));
      const done = mine.filter((t) => t.state === 'COMPLETED').length; const failed = mine.filter((t) => t.state === 'FAILED').length;
      const steps = mine.flatMap((t) => (t.plan?.steps ?? []).filter((st) => st.agent === id && st.status === 'done'));
      const f = fb.filter((x) => x.agents?.includes(id));
      const ms = mine.map((t) => t.durationMs).filter((x) => x != null);
      const successPct = pct(done, done + failed); const satisfactionPct = pct(f.filter((x) => x.rating > 0).length, f.length);
      const enough = done + failed >= 3;
      const score = enough ? Math.round((successPct ?? 0) * 0.6 + (satisfactionPct ?? successPct ?? 0) * 0.3 + (pct(steps.filter((st) => st.verified !== false).length, steps.length) ?? 100) * 0.1) : null;
      return { agent: id, tasks: mine.length, completed: done, failed, successPct, verifiedPct: pct(steps.filter((st) => st.verified !== false).length, steps.length), avgMs: ms.length ? Math.round(ms.reduce((a, x) => a + x, 0) / ms.length) : null, satisfactionPct, feedback: f.length, deniedAttempts: denials.filter((d) => d.detail?.agent === id).length, score, rating: !enough ? 'insufficient-data' : score >= 80 ? 'good' : score >= 60 ? 'watch' : 'needs-attention' };
    }).sort((a, b) => b.tasks - a.tasks);
  }

  // ---------------- capability R&D ----------------
  research() {
    const unmatched = this.s.store.all('tasks_exec', (t) => t.state === 'FAILED' && t.plan?.tools?.length === 1 && t.plan.tools[0] === 'llm.answer' && t.actor === 'user').slice(-200);
    const groups = {};
    for (const t of unmatched) {
      const best = this.bestReadTool(t.objective);
      const key = best ? `existing:${best.tool}` : `gap:${normalize(t.objective).split(' ').slice(0, 2).join(' ')}`;
      const g = (groups[key] ??= { id: key, kind: best ? 'existing-capability' : 'capability-gap', tool: best?.tool ?? null, requests: [] });
      g.requests.push(t.objective);
    }
    const items = Object.values(groups).filter((g) => g.requests.length >= 2 || g.kind === 'existing-capability').map((g) => ({
      ...g, count: g.requests.length, requests: g.requests.slice(-5),
      feasibility: g.kind === 'existing-capability' ? 'Teach a phrase (intent alias) through a tested proposal.' : 'Needs a new capability: a developer registers it through the extension review (6 checks + owner approval). JARVIS never installs code on its own.',
      feasibilityHe: g.kind === 'existing-capability' ? 'ללמד ביטוי (כינוי כוונה) דרך הצעה שנבדקה.' : 'דורש יכולת חדשה: מפתח רושם אותה דרך בדיקת ההרחבות (6 בדיקות + אישור הבעלים). JARVIS לעולם לא מתקין קוד בעצמו.',
    })).sort((a, b) => b.count - a.count);
    const roadmap = COVERAGE.filter(([, , st]) => ['planned', 'blocked', 'partial'].includes(st)).map(([section, capability, status, evidence]) => ({ section, capability, status, evidence }));
    return { items, roadmap, policy: 'Research only: no plugin is installed, no downloaded code runs, no permission is granted automatically.' };
  }

  // ---------------- knowledge freshness ----------------
  freshness() {
    const checks = [];
    const age = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);
    const tx = this.s.store.all('transactions', (t) => t.householdId === this.s.householdId);
    const lastTx = tx.map((t) => t.date).sort().at(-1);
    checks.push({ id: 'finance.sync', area: 'Family Wealth OS data', status: !lastTx ? 'missing' : age(lastTx) > 35 ? 'stale' : 'fresh', detail: lastTx ? `latest transaction ${lastTx} (${age(lastTx)} days)` : 'no transactions', action: 'Import a fresh bank export or connect FWOS.', actionHe: 'ייבאו קובץ בנק עדכני או חברו את FWOS.' });
    const demo = tx.filter((t) => t.demo).length;
    if (demo) checks.push({ id: 'finance.demo', area: 'Demo data', status: 'stale', detail: `${demo} demo transactions are still mixed with your data`, action: 'Clear demo data in Wealth when you have real data.', actionHe: 'נקו נתוני הדגמה במסך העושר כשיש נתונים אמיתיים.' });
    const mems = this.s.memory.list();
    const old = mems.filter((m) => ['fact', 'preference', 'person'].includes(m.type) && age(m.updatedAt ?? m.createdAt) > 365);
    checks.push({ id: 'memory.old', area: 'Memories older than a year', status: old.length ? 'stale' : 'fresh', count: old.length, detail: `${old.length} memories not confirmed for over a year`, refs: old.slice(0, 10).map((m) => m.id), action: 'Confirm or correct them in Knowledge.', actionHe: 'אשרו או תקנו אותם בידע.' });
    const expiring = mems.filter((m) => m.expiresAt && Date.parse(m.expiresAt) - Date.now() < 14 * DAY);
    checks.push({ id: 'memory.expiring', area: 'Memories about to expire', status: expiring.length ? 'expiring' : 'fresh', count: expiring.length, detail: `${expiring.length} expire within 14 days`, refs: expiring.slice(0, 10).map((m) => m.id), action: 'Extend the ones that are still true.', actionHe: 'הארכו את אלה שעדיין נכונים.' });
    const docs = this.s.store.all('documents').filter((d) => age(d.updatedAt ?? d.createdAt) > 180);
    checks.push({ id: 'documents.old', area: 'Documents older than 6 months', status: docs.length ? 'stale' : 'fresh', count: docs.length, detail: `${docs.length} documents`, refs: docs.slice(0, 10).map((d) => d.id), action: 'Re-upload current versions if they changed.', actionHe: 'העלו גרסאות עדכניות אם השתנו.' });
    const lastEval = this.s.store.all('evaluations').at(-1);
    checks.push({ id: 'brain.evaluation', area: 'Brain regression suite', status: !lastEval ? 'missing' : age(lastEval.at) > 7 ? 'stale' : 'fresh', detail: lastEval ? `last run ${dayOf(lastEval.at)}: ${lastEval.passed}/${lastEval.cases}` : 'never run', action: 'Run the evaluation in Brain Center.', actionHe: 'הריצו את ההערכה במרכז המוח.' });
    const degraded = this.s.capabilities.list().filter((c) => c.health?.status === 'degraded');
    checks.push({ id: 'capabilities.health', area: 'Capability health', status: degraded.length ? 'stale' : 'fresh', count: degraded.length, detail: degraded.length ? degraded.map((c) => c.id).slice(0, 6).join(', ') : 'all healthy', action: 'Check the failing capabilities.', actionHe: 'בדקו את היכולות שנכשלות.' });
    checks.push({ id: 'models.knowledge', area: 'AI model knowledge', status: 'info', detail: 'Model knowledge has a training cutoff; current facts come from research with retrieval dates.', action: 'Use "research" for anything time-sensitive.', actionHe: 'השתמשו ב"מחקר" לכל דבר תלוי זמן.' });
    const q = insight.knowledgeQuality(this.s);
    checks.push({ id: 'knowledge.duplicates', area: 'Duplicate knowledge', status: q.duplicates.length ? 'stale' : 'fresh', count: q.duplicates.length, detail: `${q.duplicates.length} near-duplicate memories`, refs: q.duplicates.slice(0, 10).map((d) => `${d.a}~${d.b}`), action: 'Merge or delete the duplicates in Knowledge.', actionHe: 'מזגו או מחקו כפילויות בידע.' });
    checks.push({ id: 'knowledge.conflicts', area: 'Conflicting records', status: q.conflicts.length ? 'stale' : 'fresh', count: q.conflicts.length, detail: q.conflicts.length ? q.conflicts.slice(0, 2).map((c) => `"${c.aText}" vs "${c.bText}"`).join(' · ') : 'none found', action: 'Decide which statement is correct; JARVIS never picks one silently.', actionHe: 'החליטו איזו טענה נכונה; JARVIS לא בוחר בשקט.' });
    checks.push({ id: 'documents.incomplete', area: 'Incomplete documents', status: q.incomplete.length ? 'stale' : 'fresh', count: q.incomplete.length, detail: `${q.incomplete.length} documents with no readable text`, action: 'Re-upload them in a text format.', actionHe: 'העלו אותם שוב בפורמט טקסט.' });
    checks.push({ id: 'knowledge.links', area: 'Source links', status: q.links.length ? 'info' : 'fresh', count: q.links.length, detail: q.links.length ? `${q.links.length} links (checked only when you ask)` : 'no external links', action: 'Run a link check.', actionHe: 'הריצו בדיקת קישורים.' });
    const out = { at: now(), checks, stale: checks.filter((c) => ['stale', 'missing', 'expiring'].includes(c.status)).length };
    return out;
  }

  // ---------------- Family Wealth OS learning: categorization suggestions only ----------------
  fwosCategorization() {
    const tx = this.s.store.all('transactions', (t) => t.householdId === this.s.householdId && t.amount < 0);
    const merchantOf = (d) => normalize(d).split(' ').slice(0, 2).join(' ');
    const by = {};
    for (const t of tx) { const m = merchantOf(t.description ?? ''); if (m) (by[m] ??= []).push(t); }
    const out = []; const skipped = [];
    for (const [merchant, list] of Object.entries(by)) {
      const other = list.filter((t) => !t.category || t.category === 'other');
      if (!other.length) continue;
      const labelled = list.filter((t) => t.category && t.category !== 'other');
      const cats = [...new Set(labelled.map((t) => t.category))];
      if (!labelled.length) continue;
      if (labelled.length < 2) { skipped.push({ merchant, reason: 'single example: not enough to learn a rule' }); continue; }
      if (cats.length > 1) { skipped.push({ merchant, reason: `ambiguous: seen as ${cats.join(', ')}` }); continue; }
      out.push({ id: `fwos:${merchant}`, merchant, category: cats[0], examples: labelled.slice(-5).map((t) => ({ id: t.id, description: t.description, date: t.date })), applyTo: other.map((t) => t.id), confidence: +(labelled.length / (labelled.length + 1)).toFixed(2), note: 'Suggestion only: categories change only for the listed transactions, after your approval. No budget, rule or amount changes.' });
    }
    return { suggestions: out, skipped };
  }
  applyCategorization(id, actor) {
    if (actor !== 'user') throw err('only the owner can recategorize', 403);
    const sg = this.fwosCategorization().suggestions.find((x) => x.id === id);
    if (!sg) throw err('no such suggestion', 404);
    for (const tid of sg.applyTo) this.s.store.update('transactions', tid, { category: sg.category, categorizedBy: 'user-approved suggestion' });
    this.event('fwos.categorized', { merchant: sg.merchant, categoryName: sg.category, count: sg.applyTo.length });
    this.log('fwos.categorized', { merchant: sg.merchant, category: sg.category, transactions: sg.applyTo.length }, actor);
    return { updated: sg.applyTo.length, category: sg.category };
  }

  // ---------------- proactive improvement suggestions ----------------
  // ---------------- model intelligence ----------------
  /** Runs the benchmark suites on every configured tier (synthetic prompts only) and stores the results. */
  async evaluateModels({ tiers = ['fast', 'balanced', 'deep'], categories } = {}) {
    const { benchmarkTier, recommendRouting } = await import('./benchmarks.js');
    const results = [];
    for (const t of tiers) results.push(await benchmarkTier(this.s.router, t, { categories, metricsSink: (c) => this.s.metrics?.modelCall(c) }));
    const recommendations = recommendRouting(results);
    const rec = this.s.store.insert('model_benchmarks', { kind: 'suite', at: now(), results: results.map(({ rows, ...r }) => ({ ...r, cases: rows?.length ?? 0 })), recommendations, note: 'Synthetic prompts with automatic graders; no user data was sent.' });
    this.log('models.evaluated', { benchmarkId: rec.id, measured: results.filter((r) => r.status === 'measured').map((r) => r.tier) });
    return rec;
  }
  /** Turns a measured routing recommendation into a normal, testable, approval-gated proposal. */
  proposeRouting(benchmarkId, actor = 'learning-engine') {
    const b = benchmarkId ? this.s.store.get('model_benchmarks', benchmarkId) : this.s.store.all('model_benchmarks', (x) => x.kind === 'suite').at(-1);
    if (!b) throw err('run a model evaluation first', 404);
    const recs = (b.recommendations ?? []).filter((r) => r.status === 'recommendation');
    if (!recs.length) throw err('the benchmark has no measured recommendation (needs two measured tiers)', 409);
    const cur = this.s.store.getMeta('modelPrefs', {});
    const candidate = { ...cur, ...Object.fromEntries(recs.map((r) => [r.category, r.tier])) };
    if (JSON.stringify(candidate) === JSON.stringify(cur)) throw err('routing already matches the measurements', 409);
    return this.createProposal({ target: 'routing.preferences', candidate, type: 'routing', risk: 'medium', change: `Route by measured accuracy: ${recs.map((r) => `${r.category} → ${r.tier}`).join(', ')}`, changeHe: `ניתוב לפי דיוק שנמדד: ${recs.map((r) => `${r.category} → ${r.tier}`).join(', ')}`, rationale: recs.map((r) => `${r.category}: ${r.basis}`).join(' · '), evidence: [{ source: 'benchmark', ref: b.id, at: b.at }], createdBy: actor });
  }
  modelIntelligence() {
    const live = this.modelBenchmarks();
    const suites = this.s.store.all('model_benchmarks', (x) => x.kind === 'suite').slice(-5).reverse();
    const gw = this.s.router.gateway?.() ?? {};
    return { live, suites, tiers: gw.tiers ?? this.s.router.tiers, health: gw.health ?? {}, preferences: this.s.store.getMeta('modelPrefs', {}), policy: 'Routing changes only through a tested, approved proposal. A newer or more expensive model is never assumed better.' };
  }
  agentIntelligence() {
    const evals = this.agentEvaluations();
    const dup = insight.unnecessaryWork(this.s);
    for (const e of evals) if (dup[e.agent] >= 3) e.unnecessaryWork = `${dup[e.agent]} repeated identical tool calls`;
    return { evaluations: evals, ...insight.agentIntelligence(this.s, evals), missions: insight.evaluateMissions(this.s).slice(0, 20), prompts: insight.promptReport(this.s) };
  }
  snapshotAgents() { const out = this.agentEvaluations(); const rec = this.s.store.insert('agent_evaluations', { at: now(), agents: out }); this.log('agents.evaluated', { id: rec.id, agents: out.length }); return rec; }

  // ---------------- knowledge quality ----------------
  knowledge() { return { freshness: this.freshness(), quality: insight.knowledgeQuality(this.s) }; }
  async checkKnowledgeLinks(actor) {
    if (actor !== 'user') throw err('only the owner can run network checks', 403);
    const q = insight.knowledgeQuality(this.s);
    const res = await insight.checkLinks(q.links, this.s.fetch ?? globalThis.fetch);
    this.s.store.insert('freshness_checks', { kind: 'links', at: now(), results: res });
    this.log('knowledge.links_checked', { checked: res.length, broken: res.filter((x) => x.broken).length }, actor);
    return res;
  }

  // ---------------- regression testing ----------------
  /** Runs the full suite on the CURRENT production configuration in a sandbox and compares it with the previous run. */
  async regression(actor = 'user') {
    const { runRegression } = await import('./experiments.js');
    const prev = this.s.store.all('regression_runs').at(-1) ?? null;
    const run = await runRegression(this.s, prev);
    const rec = this.s.store.insert('regression_runs', { ...run, by: actor, at: now() });
    this.log('regression.completed', { runId: rec.id, passRate: run.passRate, regressions: run.comparison?.regressions ?? [] }, actor);
    return rec;
  }

  // ---------------- proactive improvement suggestions ----------------
  suggestions({ all = false, limit = 7 } = {}) {
    const state = this.s.store.getMeta('suggestionState', {});
    const list = [];
    const add = (x) => list.push({ approvalRequired: true, risk: 'low', benefit: '', benefitHe: '', ...x });
    for (const p of this.proposals().filter((x) => x.status === 'tested')) add({ id: `proposal:${p.id}`, kind: 'proposal', ref: p.id, title: p.change, titleHe: p.changeHe, detected: p.rationale, detectedHe: p.rationaleHe, why: 'A recurring problem has a tested fix waiting.', whyHe: 'לבעיה חוזרת יש תיקון שנבדק וממתין.', benefit: 'Passed the full regression suite in the sandbox with no regressions.', benefitHe: 'עבר את כל בדיקות הרגרסיה בסביבה המבודדת ללא נסיגות.', risk: p.risk, priority: 'high', action: 'approve to deploy' });
    for (const d of this.deployments().filter((x) => x.status === 'active' && (x.occurrencesSinceDeploy ?? 0) >= 3)) add({ id: `rollback:${d.id}`, kind: 'rollback', ref: d.id, title: `Roll back ${d.target} v${d.toVersion}`, titleHe: `לשחזר את ${d.target} v${d.toVersion}`, detected: `the problem occurred ${d.occurrencesSinceDeploy} times after deployment`, detectedHe: `הבעיה חזרה ${d.occurrencesSinceDeploy} פעמים אחרי הפריסה`, why: 'The change did not fix the problem.', whyHe: 'השינוי לא פתר את הבעיה.', benefit: `restores v${d.fromVersion}`, benefitHe: `מחזיר את v${d.fromVersion}`, priority: 'high' });
    for (const p of this.patterns().filter((x) => x.recurring && ['open', 'recurring-after-fix'].includes(x.status) && x.hypothesis?.action?.type === 'guidance')) add({ id: `pattern:${p.signature}`, kind: 'guidance', ref: p.id, title: p.hypothesis.action.text, titleHe: p.hypothesis.action.textHe, detected: `${p.label.en} ×${p.occurrences}`, detectedHe: `${p.label.he} ×${p.occurrences}`, why: p.hypothesis.cause, whyHe: p.hypothesis.causeHe, benefit: 'fewer failed requests', benefitHe: 'פחות בקשות שנכשלות', risk: 'none', approvalRequired: false, priority: p.occurrences >= 6 ? 'high' : 'normal' });
    for (const o of insight.automationOpportunities(this.s)) if (!this.s.store.all('workflows', (w) => w.learnedFrom === o.id).length) add({ id: o.id, kind: 'automation', ref: o.id, title: `Create an automation: ${o.tool} every day at ${String(o.hour).padStart(2, '0')}:00`, titleHe: `ליצור אוטומציה: ${o.tool} כל יום ב-${String(o.hour).padStart(2, '0')}:00`, detected: `you ran ${o.tool} manually ${o.count} times on ${o.days} days around ${o.hour}:00`, detectedHe: `הפעלת את ${o.tool} ידנית ${o.count} פעמים ב-${o.days} ימים בסביבות ${o.hour}:00`, why: 'A repeated manual routine.', whyHe: 'שגרה ידנית שחוזרת.', benefit: 'saves the daily request', benefitHe: 'חוסך את הבקשה היומית', priority: 'normal', workflow: o.workflow });
    for (const c of this.freshness().checks.filter((x) => ['stale', 'missing', 'expiring'].includes(x.status))) add({ id: `fresh:${c.id}`, kind: 'freshness', ref: c.id, title: c.action, titleHe: c.actionHe, detected: `${c.area}: ${c.detail}`, detectedHe: `${c.area}: ${c.detail}`, why: 'Answers are only as good as current data.', whyHe: 'תשובות טובות רק כמו הנתונים העדכניים.', risk: 'none', approvalRequired: c.id === 'brain.evaluation', priority: 'low' });
    const ai = this.agentIntelligence();
    for (const f of ai.findings) add({ id: `agent:${f.agent}:${f.kind}`, kind: 'agent', ref: f.agent, title: `${f.agent}: ${f.recommendation}`, titleHe: `${f.agent}: ${f.recommendation}`, detected: f.detail, detectedHe: f.detail, why: `agent ${f.kind.replace(/-/g, ' ')}`, whyHe: `סוכן: ${f.kind}`, risk: f.protected ? 'protected' : 'low', priority: 'normal' });
    for (const it of this.s.store.all('profile_items', (x) => x.status === 'proposed')) add({ id: `profile:${it.id}`, kind: 'profile', ref: it.id, title: `Set ${it.key} to "${it.value}"`, titleHe: `לקבוע ${it.key} ל-"${it.value}"`, detected: `${it.evidence?.length ?? 0} consistent signals (confidence ${it.confidence}, scope ${it.scope})`, detectedHe: `${it.evidence?.length ?? 0} סימנים עקביים (ביטחון ${it.confidence}, היקף ${it.scope})`, why: 'A repeated preference.', whyHe: 'העדפה שחוזרת.', benefit: 'answers match how you like them', benefitHe: 'תשובות שמתאימות לך', priority: 'normal', action: 'approve to apply' });
    if (this.categoryEnabled('finance_categorization')) for (const f of this.fwosCategorization().suggestions) add({ id: f.id, kind: 'fwos', ref: f.id, title: `Categorize ${f.applyTo.length} "${f.merchant}" expense(s) as ${f.category}`, titleHe: `לסווג ${f.applyTo.length} הוצאות "${f.merchant}" כ-${f.category}`, detected: `${f.examples.length} earlier consistent examples`, detectedHe: `${f.examples.length} דוגמאות עקביות קודמות`, why: 'Uncategorized expenses distort budgets and reports.', whyHe: 'הוצאות לא מסווגות מעוותות תקציבים ודוחות.', benefit: 'more accurate reports; amounts and rules unchanged', benefitHe: 'דוחות מדויקים יותר; סכומים וכללים לא משתנים', priority: 'low', action: 'approve to apply' });
    for (const f of insight.financeValidation(this.s).findings) add({ id: `fin:${f.kind}:${(f.refs ?? []).join(',').slice(0, 40)}`, kind: 'finance-validation', ref: f.kind, title: f.recommendation, titleHe: f.recommendation, detected: f.detail, detectedHe: f.detail, why: 'Data quality in Family Wealth OS.', whyHe: 'איכות נתונים ב-Family Wealth OS.', risk: 'none', approvalRequired: false, priority: 'low' });
    for (const x of insight.securityMonitor(this.s, this).suspicious) add({ id: `sec:${x.kind}:${x.detail.slice(0, 30)}`, kind: 'security', ref: x.kind, title: x.kind === 'config-drift' ? 'Review a configuration change made outside versioning' : `Review: ${x.kind.replace(/-/g, ' ')}`, titleHe: x.kind === 'config-drift' ? 'לבדוק שינוי תצורה שנעשה מחוץ לניהול הגרסאות' : `לבדוק: ${x.kind}`, detected: x.detail, detectedHe: x.detail, why: 'Potential security or integrity issue.', whyHe: 'בעיית אבטחה או שלמות אפשרית.', risk: 'none', approvalRequired: false, priority: x.kind === 'tampered-version' ? 'high' : 'normal' });
    const rank = { high: 0, normal: 1, low: 2 };
    const withState = list.map((x) => ({ ...x, status: state[x.id]?.status ?? 'open', until: state[x.id]?.until ?? null })).sort((a, b) => rank[a.priority] - rank[b.priority]);
    const open = withState.filter((x) => x.status === 'open' || (x.status === 'postponed' && Date.parse(x.until) <= Date.now()));
    // Avoid excessive recommendations: show the most important few; the rest stay available on request.
    return all ? withState : open.slice(0, limit);
  }
  async suggestionAction(id, action, actor, { until } = {}) {
    const sg = this.suggestions({ all: true }).find((x) => x.id === id);
    if (!sg) throw err('no such suggestion', 404);
    const state = { ...this.s.store.getMeta('suggestionState', {}) };
    let result = null;
    if (action === 'dismiss') state[id] = { status: 'dismissed', at: now() };
    else if (action === 'postpone') state[id] = { status: 'postponed', until: until ?? new Date(Date.now() + 7 * DAY).toISOString() };
    else if (action === 'approve') {
      if (actor !== 'user') throw err('only the owner can approve suggestions', 403);
      if (sg.kind === 'proposal') result = this.approveAndDeploy(sg.ref, actor);
      else if (sg.kind === 'rollback') result = this.rollback({ deploymentId: sg.ref, reason: 'did not fix the problem' }, actor);
      else if (sg.kind === 'profile') result = this.approveProfileItem(sg.ref, actor);
      else if (sg.kind === 'fwos') result = this.applyCategorization(sg.ref, actor);
      else if (sg.kind === 'automation') { result = this.s.automations.create({ ...sg.workflow, learnedFrom: sg.id }); this.log('automation.created', { workflowId: result.id, from: sg.id }, actor); }
      else if (sg.ref === 'brain.evaluation') result = await (await import('../brain/evaluation.js')).runEvaluation(this.s.store);
      state[id] = { status: 'approved', at: now() };
    } else throw err('action must be dismiss, postpone or approve');
    this.s.store.setMeta('suggestionState', state);
    this.log(`suggestion.${action}`, { id }, actor);
    return { suggestion: { ...sg, ...state[id] }, result };
  }

  // ---------------- history, retention, cycle, dashboard ----------------
  history(n = 200) {
    return [...this.s.store.all('learning_events').slice(-n), ...this.s.store.all('learning_audit').slice(-n).map((a) => ({ type: a.action, actor: a.actor, ...a.detail, at: a.at }))].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);
  }
  /** Retention: raw learning events after 180 days, experiment case rows after 90 (summaries and the audit are kept). */
  purge(at = Date.now()) {
    let n = 0;
    for (const e of this.s.store.all('learning_events', (x) => at - Date.parse(x.at) > 180 * DAY)) { this.s.store.remove('learning_events', e.id); n++; }
    for (const e of this.s.store.all('experiments', (x) => at - Date.parse(x.at) > 90 * DAY && x.report?.rows)) { this.s.store.update('experiments', e.id, { report: { ...e.report, rows: undefined, rowsPurged: true } }); n++; }
    for (const e of this.s.store.all('profile_items', (x) => x.expiresAt && Date.parse(x.expiresAt) < at && x.status !== 'rejected')) { this.s.store.update('profile_items', e.id, { status: 'expired' }); n++; }
    return n;
  }
  /** One bounded improvement cycle: snapshot, analyze, observe patterns, test at most `maxExperiments` proposals (mode 3+). */
  async cycle({ maxExperiments = 1 } = {}) {
    this.snapshot();
    const patterns = this.analyze();
    if (this.mode() >= 2) this.refreshObserved();
    let tested = 0;
    if (this.mode() >= 3) for (const p of this.proposals('proposed').slice(0, maxExperiments)) { await this.experiment(p.id); tested++; }
    this.purge();
    return { patterns: patterns.filter((p) => p.recurring).length, tested, mode: this.mode() };
  }

  scorecards(perf) {
    const T = perf.totals;
    const ex = this.s.store.all('experiments');
    return [
      { id: 'reliability', label: 'Reliability', labelHe: 'אמינות', value: T.successPct },
      { id: 'satisfaction', label: 'Satisfaction', labelHe: 'שביעות רצון', value: T.satisfactionPct },
      { id: 'verification', label: 'Verified steps', labelHe: 'צעדים מאומתים', value: perf.series.reduce((a, d) => a + (d.verifiedSteps ?? 0), 0) && Math.round((perf.series.reduce((a, d) => a + d.verifiedSteps, 0) * 100) / Math.max(1, perf.series.reduce((a, d) => a + d.steps, 0))) },
      { id: 'experiments', label: 'Experiments passing', labelHe: 'ניסויים שעברו', value: ex.length ? Math.round((ex.filter((e) => e.verdict === 'pass').length * 100) / ex.length) : null },
      { id: 'security', label: 'Security incidents (7d)', labelHe: 'אירועי אבטחה (7 ימים)', value: this.s.store.all('learning_security', (e) => Date.now() - Date.parse(e.at) < 7 * DAY).length, suffix: '' },
    ];
  }

  dashboard() {
    const perf = this.performance({ days: 14 });
    return {
      mode: this.modes(), totals: perf.totals, series: perf.series, scorecards: this.scorecards(perf),
      patterns: this.patterns().slice(0, 20), classes: FAILURE_CLASSES, feedbackCategories: FEEDBACK_CATEGORIES,
      proposals: this.proposals().slice(0, 30), experiments: this.experiments().slice(0, 15), deployments: this.deployments().slice(0, 15),
      approvals: this.approvals().slice(0, 15), rollbacks: this.s.store.all('rollback_records').slice(-15).reverse(),
      suggestions: this.suggestions(), versions: this.versions.targets(), audit: this.audit(30),
      activity: this.history(15), lab: this.devlab.status(),
    };
  }
}
