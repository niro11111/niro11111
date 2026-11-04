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

export const MODES = {
  1: { id: 1, name: 'Observe', nameHe: 'צפייה בלבד', desc: 'Collect metrics, detect patterns and report. No proposals are created.', descHe: 'איסוף מדדים, זיהוי דפוסים ודיווח. לא נוצרות הצעות.' },
  2: { id: 2, name: 'Propose & test', nameHe: 'הצעה ובדיקה', desc: 'Create proposals and test them in the sandbox automatically. Every deployment needs your approval. (default)', descHe: 'יצירת הצעות ובדיקתן אוטומטית בסביבה מבודדת. כל פריסה דורשת את אישורך. (ברירת מחדל)' },
  3: { id: 3, name: 'Auto-apply personalization', nameHe: 'החלה אוטומטית של התאמה אישית', desc: 'As mode 2, and style/length preferences that pass testing are applied automatically (you are notified and can roll back). System changes still need approval.', descHe: 'כמו מצב 2, והעדפות סגנון ואורך שעברו בדיקה מוחלות אוטומטית (עם התראה ואפשרות שחזור). שינויי מערכת עדיין דורשים אישור.' },
  4: { id: 4, name: 'Supervised autonomy', nameHe: 'אוטונומיה בפיקוח', desc: 'As mode 3, and learned phrases for read-only capabilities that pass testing with zero regressions are applied automatically. Prompts, routing and workflows still need approval. Protected areas never change.', descHe: 'כמו מצב 3, וביטויים נלמדים ליכולות קריאה בלבד שעברו בדיקה ללא רגרסיות מוחלים אוטומטית. פרומפטים, ניתוב ותהליכים עדיין דורשים אישור. אזורים מוגנים לעולם לא משתנים.' },
};

export const PROFILE_CATEGORIES = {
  communication: { en: 'Communication style', he: 'סגנון תקשורת' },
  language: { en: 'Language', he: 'שפה' },
  schedule: { en: 'Schedule and routines', he: 'לוח זמנים ושגרה' },
  interests: { en: 'Interests and preferences', he: 'תחומי עניין והעדפות' },
  home: { en: 'Home', he: 'בית' },
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
  constructor(s) { this.s = s; this.versions = new Versions(s); }

  // ---------------- mode & audit ----------------
  mode() { return this.s.store.getMeta('learningMode', 2); }
  modes() { return { current: this.mode(), modes: Object.values(MODES), protected: PROTECTED }; }
  setMode(level, actor) {
    // Only the owner can change how much autonomy the learning engine has. The engine itself
    // has no code path that calls this, so it can never widen its own boundaries.
    if (actor !== 'user') throw err('only the owner can change the learning mode', 403);
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
    for (const t of this.s.store.all('tasks_exec', (x) => x.state === 'CANCELLED' && recent(x.createdAt) && x.history?.some((h) => /superseded/.test(h.note ?? '')))) {
      out.push({ source: 'abandoned', id: t.id, taskId: t.id, at: t.createdAt, message: t.objective, tool: t.history.find((h) => /^missing /.test(h.note ?? ''))?.note.slice(8).split('.')[0] ?? null });
    }
    return out;
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
    if (p.cls === 'model_unavailable' || (p.cls === 'intent_misunderstood' && p.tool === 'llm.answer')) {
      const picks = p.messages.map((m) => this.bestReadTool(m)).filter(Boolean);
      const counts = {}; for (const x of picks) counts[x.tool] = (counts[x.tool] ?? 0) + 1;
      const [tool, hits] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
      if (tool && hits >= Math.max(2, Math.ceil(n * 0.6))) {
        return { status: 'likely', cause: `These requests have no deterministic intent rule, so they fall through to the AI model path${this.s.router.providers.anthropic ? '' : ', which is not available here'}. ${hits} of ${n} match the existing read-only capability "${tool}".`, causeHe: `לבקשות האלה אין כלל זיהוי קבוע, ולכן הן עוברות למודל ה-AI${this.s.router.providers.anthropic ? '' : ', שלא זמין כאן'}. ${hits} מתוך ${n} מתאימות ליכולת הקיימת לקריאה בלבד "${tool}".`, evidenceFor: [`${hits}/${n} requests match ${tool}`, `all ${n} were routed to llm.answer`], action: { type: 'intent_alias', tool } };
      }
      if (p.cls === 'model_unavailable' && !this.s.router.providers.anthropic) return { status: 'likely', cause: 'No AI model is configured, and these are open questions that need one.', causeHe: 'לא מוגדר מודל AI, ואלה שאלות פתוחות שדורשות מודל.', evidenceFor: ['no model provider configured', `${n} requests needed a model`], action: { type: 'guidance', text: 'Open JARVIS in claude.ai or add an API key in Settings.', textHe: 'פתחו את JARVIS ב-claude.ai או הוסיפו מפתח API בהגדרות.' } };
      return { status: 'insufficient-evidence', cause: null, note: 'The requests do not point to one capability; more examples are needed.', noteHe: 'הבקשות לא מצביעות על יכולת אחת; צריך עוד דוגמאות.', action: null };
    }
    const notes = p.evidence.map((e) => e.error.toLowerCase());
    const share = (re) => notes.filter((x) => re.test(x)).length;
    switch (p.cls) {
      case 'user_dissatisfied': {
        if (!this.categoryEnabled('communication')) return { status: 'insufficient-evidence', cause: null, note: 'Communication learning is disabled in your profile.', noteHe: 'למידת סגנון תקשורת כבויה בפרופיל שלך.', action: null };
        const long = share(/too_long|long|ארוך|verbose/); const short = share(/too_short|short|קצר|מפורט/);
        if (long >= 2 && long > short) return { status: 'likely', cause: `Answers are too long for you (${long} signals, ${short} opposite).`, causeHe: `התשובות ארוכות מדי בשבילך (${long} סימנים, ${short} הפוכים).`, evidenceFor: [`${long} feedback signals about length`], action: { type: 'personality', patch: { verbosity: 'short' } } };
        if (short >= 2 && short > long) return { status: 'likely', cause: `Answers are too short for you (${short} signals, ${long} opposite).`, causeHe: `התשובות קצרות מדי בשבילך (${short} סימנים, ${long} הפוכים).`, evidenceFor: [`${short} feedback signals about length`], action: { type: 'personality', patch: { verbosity: 'detailed' } } };
        return { status: 'insufficient-evidence', cause: null, note: 'Negative feedback without a consistent reason.', noteHe: 'משוב שלילי בלי סיבה עקבית.', action: null };
      }
      case 'incorrect_answer':
        return { status: 'likely', cause: `${n} answers were reported as wrong. A stricter grounding instruction is a reasonable, reversible mitigation; the true cause needs the answer content to confirm.`, causeHe: `${n} תשובות דווחו כשגויות. הנחיית עיגון מחמירה היא צעד סביר והפיך; כדי לאשר את הסיבה האמיתית צריך את תוכן התשובות.`, evidenceFor: [`${n} feedback signals: incorrect`], action: { type: 'prompt_overlay', text: 'When answering about the user\'s own data, rely only on the records provided and name the record you used. If the records do not contain the answer, say you are not sure instead of estimating.' } };
      case 'external_unavailable': return { status: 'likely', cause: `${p.target ?? p.tool} was unavailable in ${n} attempts.`, causeHe: `${p.target ?? p.tool} לא היה זמין ב-${n} ניסיונות.`, evidenceFor: [`${n} offline errors for the same target`], action: { type: 'guidance', text: 'Check the device or service power and connection.', textHe: 'בדקו חשמל וחיבור של המכשיר או השירות.' } };
      case 'permission_denied': return { status: 'likely', cause: `Your permission settings blocked ${p.tool ?? 'an action'} ${n} times.`, causeHe: `הגדרות ההרשאות חסמו את ${p.tool ?? 'הפעולה'} ${n} פעמים.`, evidenceFor: [`${n} policy blocks`], action: { type: 'guidance', protected: true, text: 'Permissions are protected: the learning engine will not change them. Review them yourself in Privacy if this is intended.', textHe: 'הרשאות מוגנות: מנוע הלמידה לא ישנה אותן. אם זה רצוי, בדקו אותן בעצמכם בפרטיות.' } };
      case 'missing_information': return { status: 'likely', cause: `Clarification questions for ${p.tool ?? 'requests'} were abandoned ${n} times.`, causeHe: `שאלות הבהרה עבור ${p.tool ?? 'בקשות'} ננטשו ${n} פעמים.`, evidenceFor: [`${n} abandoned clarifications`], action: { type: 'guidance', text: 'Include the missing detail in the first request (for example the time for a reminder).', textHe: 'כדאי לכלול את הפרט החסר כבר בבקשה (למשל שעה לתזכורת).' } };
      case 'data_not_found': return { status: 'likely', cause: `Names used in requests did not match records for ${p.tool} (${n} times).`, causeHe: `השמות בבקשות לא תאמו לרשומות עבור ${p.tool} (${n} פעמים).`, evidenceFor: [`${n} not-found errors`], action: { type: 'guidance', text: 'Check the record names or add the missing record.', textHe: 'בדקו את שמות הרשומות או הוסיפו את הרשומה החסרה.' } };
      default: {
        const same = new Set(p.evidence.map((e) => e.error)).size === 1;
        return same ? { status: 'likely', cause: `The same error repeats ${n} times: "${p.evidence[0].error}".`, causeHe: `אותה שגיאה חוזרת ${n} פעמים: "${p.evidence[0].error}".`, evidenceFor: ['identical error messages'], action: { type: 'guidance', text: 'Recorded for a developer fix.', textHe: 'נרשם לתיקון על ידי מפתח.' } }
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
    const adapter = targetAdapter(target); // protected targets are refused here, before anything is stored
    const errs = adapter.validate(this.s, candidate);
    if (errs.length) throw err(`invalid proposal: ${errs.join('; ')}`);
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
    await this.maybeAutoDeploy(this.proposal(id));
    return exp;
  }
  experiments() { return this.s.store.all('experiments').slice().reverse().map(({ report, ...e }) => ({ ...e, regressions: report?.regressions ?? [], improvements: report?.improvements ?? [] })); }
  experimentReport(id) { const e = this.s.store.get('experiments', id); if (!e) throw err('no such experiment', 404); return e; }

  async maybeAutoDeploy(p) {
    if (p.status !== 'tested') return null;
    const m = this.mode();
    const auto = (m >= 3 && p.type === 'personality') || (m >= 4 && p.type === 'intent_alias');
    if (!auto) return null;
    return this.deploy(p.id, `learning-engine (mode ${m})`, { auto: true });
  }

  approve(id, actor) {
    if (actor !== 'user') throw err('only the owner can approve a deployment', 403);
    const p = this.proposal(id);
    if (p.status !== 'tested') throw err(p.status === 'failed-test' ? 'this proposal failed its tests and cannot be deployed' : 'run the experiment before approving');
    this.s.store.update('improvement_proposals', id, { status: 'approved', approvedBy: actor, approvedAt: now() });
    this.log('proposal.approved', { proposalId: id }, actor);
    return this.deploy(id, actor);
  }
  reject(id, actor, reason = '') {
    const p = this.proposal(id);
    if (['deployed', 'rolled_back'].includes(p.status)) throw err(`proposal is ${p.status}; roll it back instead`);
    this.s.store.update('improvement_proposals', id, { status: 'rejected', rejectedBy: actor, reason: String(reason).slice(0, 300) });
    if (p.patternId) this.s.store.update('failure_patterns', p.patternId, { status: 'dismissed' });
    this.log('proposal.rejected', { proposalId: id, reason }, actor);
    return this.proposal(id);
  }

  /** Deploy only an authorized, tested proposal: approved by the owner, or allowed by the owner's chosen mode. */
  deploy(id, by, { auto = false } = {}) {
    const p = this.proposal(id);
    const authorized = p.status === 'approved' || (auto && p.status === 'tested');
    if (!authorized) throw err('not authorized: a tested proposal needs approval before deployment', 403);
    const exp = p.experimentId && this.s.store.get('experiments', p.experimentId);
    if (!exp || exp.verdict !== 'pass') throw err('deployment needs a passing experiment', 403);
    const { from, to } = this.versions.commit(p.target, p.candidate, { by, reason: p.change, proposalId: id, experimentId: exp.id });
    const d = this.s.store.insert('deployments', { proposalId: id, target: p.target, fromVersion: from.version, toVersion: to.version, by, auto, at: now(), status: 'active', signature: p.signature });
    this.s.store.update('improvement_proposals', id, { status: 'deployed', deploymentId: d.id, deployedAt: d.at });
    if (p.patternId) this.s.store.update('failure_patterns', p.patternId, { status: 'resolved', resolvedAt: d.at });
    this.event('deployment', { deploymentId: d.id, proposalId: id, target: p.target });
    this.log('deployed', { deploymentId: d.id, proposalId: id, target: p.target, fromVersion: from.version, toVersion: to.version, auto }, by);
    if (auto) this.s.notifications?.send({ title: `JARVIS learned: ${p.change}`, body: 'Applied automatically under your learning mode. You can roll it back in Self-Improvement.', priority: 'normal', event: 'learning.auto_deploy' });
    return { deployment: d, version: to };
  }
  deployments() {
    return this.s.store.all('deployments').slice().reverse().map((d) => {
      // Post-deployment monitoring: does the problem still occur after the change?
      const after = d.signature ? clusterSignals(this.signals({ windowDays: 30 }).filter((x) => Date.parse(x.at) > Date.parse(d.at))).find((x) => x.signature === d.signature)?.occurrences ?? 0 : null;
      return { ...d, occurrencesSinceDeploy: after };
    });
  }
  rollback({ deploymentId, target, toVersion } = {}, actor = 'user') {
    if (actor !== 'user') throw err('only the owner can roll back', 403);
    let t = target;
    let d = null;
    if (deploymentId) { d = this.s.store.get('deployments', deploymentId); if (!d) throw err('no such deployment', 404); t = d.target; }
    if (!t) throw err('deploymentId or target required');
    const r = this.versions.rollback(t, d && toVersion == null ? d.fromVersion : toVersion, { by: actor });
    if (d) {
      this.s.store.update('deployments', d.id, { status: 'rolled_back', rolledBackAt: now() });
      this.s.store.update('improvement_proposals', d.proposalId, { status: 'rolled_back' });
    }
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
    this.event('feedback', { feedbackId: fb.id, rating: fb.rating, category: fb.category ?? null });
    if (fb.rating > 0 || !this.categoryEnabled('communication')) return null;
    const recent = this.s.store.all('feedback', (f) => f.rating < 0 && Date.now() - Date.parse(f.at ?? f.createdAt) < 30 * DAY);
    const cnt = (c) => recent.filter((f) => f.category === c).length;
    const rules = [['too_long', 'too_short', 'communication', 'verbosity', 'short'], ['too_short', 'too_long', 'communication', 'verbosity', 'detailed'], ['language', null, 'language', 'language', fb.lang === 'en' ? 'he' : 'en']];
    for (const [c, opposite, category, key, value] of rules) {
      if (fb.category !== c) continue;
      const n = cnt(c); const o = opposite ? cnt(opposite) : 0;
      if (n < 2 || o >= n) return null; // one example, or conflicting signals: do not learn
      if (!this.categoryEnabled(category)) return null;
      const exists = this.s.store.all('profile_items', (x) => x.key === key && x.value === value && ['proposed', 'active'].includes(x.status))[0];
      if (exists) return exists;
      const item = this.s.store.insert('profile_items', { category, key, value, source: 'feedback', confidence: +(n / (n + o + 1)).toFixed(2), observedAt: now(), scope: 'all channels', expiresAt: new Date(Date.now() + 180 * DAY).toISOString(), status: 'proposed', evidence: recent.filter((f) => f.category === c).slice(-5).map((f) => ({ feedbackId: f.id, taskId: f.taskId, note: f.note })) });
      this.log('profile.proposed', { itemId: item.id, key, value, signals: n }, 'learning-engine');
      return item;
    }
    return null;
  }

  profile() {
    const disabled = new Set(this.s.store.getMeta('profileDisabled', []));
    const items = this.s.store.all('profile_items', (x) => x.status !== 'rejected');
    const mem = this.s.memory.list().filter((m) => m.type === 'preference').map((m) => ({ id: m.id, category: /שעה|בוקר|ערב|morning|evening|schedule|routine/i.test(m.content) ? 'schedule' : /אור|בית|home|light|temperature/i.test(m.content) ? 'home' : 'interests', key: 'preference', value: m.content, source: m.provenance === 'user_statement' ? 'you said' : 'inferred (awaiting review)', confidence: m.confidence ?? null, observedAt: m.createdAt, scope: m.domain ?? 'general', expiresAt: m.expiresAt ?? null, status: m.provenance === 'inferred' ? 'proposed' : 'active', memory: true }));
    const p = this.s.personality.get();
    const live = [{ id: 'personality.verbosity', category: 'communication', key: 'verbosity', value: p.verbosity, source: 'settings', status: 'active', live: true }, { id: 'personality.style', category: 'communication', key: 'style', value: p.style, source: 'settings', status: 'active', live: true }, { id: 'personality.language', category: 'language', key: 'language', value: p.language, source: 'settings', status: 'active', live: true }];
    const fin = this.s.store.all('learning_events', (e) => e.type === 'fwos.categorized').slice(-20).map((e) => ({ id: e.id, category: 'finance_categorization', key: e.merchant, value: e.categoryName, source: 'your approval', status: 'active', observedAt: e.at }));
    const all = [...live, ...items, ...mem, ...fin];
    return { categories: Object.entries(PROFILE_CATEGORIES).map(([id, label]) => ({ id, label, enabled: !disabled.has(id), items: all.filter((x) => x.category === id) })) };
  }
  approveProfileItem(id, actor) {
    const it = this.s.store.get('profile_items', id);
    if (!it || it.status !== 'proposed') throw err('no such proposed item', 404);
    if (['verbosity', 'language', 'style'].includes(it.key)) this.versions.commit('personality', { ...targetAdapter('personality').get(this.s), [it.key]: it.value }, { by: actor, reason: `profile: ${it.key} → ${it.value}` });
    this.s.store.update('profile_items', id, { status: 'active', approvedAt: now() });
    this.log('profile.approved', { itemId: id, key: it.key, value: it.value }, actor);
    return this.profile();
  }
  correctProfileItem(id, value, actor) {
    const it = this.s.store.get('profile_items', id);
    if (!it) throw err('no such item', 404);
    this.s.store.update('profile_items', id, { value, source: 'corrected by you', confidence: 1 });
    if (it.status === 'active' && ['verbosity', 'language', 'style'].includes(it.key)) this.versions.commit('personality', { ...targetAdapter('personality').get(this.s), [it.key]: value }, { by: actor, reason: `profile corrected: ${it.key} → ${value}` });
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
    return { at: now(), checks, stale: checks.filter((c) => ['stale', 'missing', 'expiring'].includes(c.status)).length };
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
  suggestions({ all = false } = {}) {
    const state = this.s.store.getMeta('suggestionState', {});
    const list = [];
    for (const p of this.proposals().filter((x) => x.status === 'tested')) list.push({ id: `proposal:${p.id}`, kind: 'proposal', ref: p.id, title: p.change, titleHe: p.changeHe, why: p.rationale, whyHe: p.rationaleHe, priority: 'high', action: 'approve to deploy' });
    for (const p of this.patterns().filter((x) => x.recurring && ['open', 'recurring-after-fix'].includes(x.status) && x.hypothesis?.action?.type === 'guidance')) list.push({ id: `pattern:${p.signature}`, kind: 'guidance', ref: p.id, title: p.hypothesis.action.text, titleHe: p.hypothesis.action.textHe, why: p.hypothesis.cause, whyHe: p.hypothesis.causeHe, priority: p.occurrences >= 6 ? 'high' : 'normal' });
    for (const c of this.freshness().checks.filter((x) => ['stale', 'missing', 'expiring'].includes(x.status))) list.push({ id: `fresh:${c.id}`, kind: 'freshness', ref: c.id, title: c.action, titleHe: c.actionHe, why: `${c.area}: ${c.detail}`, whyHe: `${c.area}: ${c.detail}`, priority: 'normal' });
    for (const a of this.agentEvaluations().filter((x) => x.rating === 'needs-attention')) list.push({ id: `agent:${a.agent}`, kind: 'agent', ref: a.agent, title: `Review the ${a.agent} agent (score ${a.score})`, titleHe: `לבדוק את הסוכן ${a.agent} (ציון ${a.score})`, why: `${a.failed} of ${a.completed + a.failed} tasks failed`, whyHe: `${a.failed} מתוך ${a.completed + a.failed} משימות נכשלו`, priority: 'normal' });
    for (const it of this.s.store.all('profile_items', (x) => x.status === 'proposed')) list.push({ id: `profile:${it.id}`, kind: 'profile', ref: it.id, title: `Set ${it.key} to "${it.value}"`, titleHe: `לקבוע ${it.key} ל-"${it.value}"`, why: `${it.evidence?.length ?? 0} consistent feedback signals (confidence ${it.confidence})`, whyHe: `${it.evidence?.length ?? 0} סימני משוב עקביים (ביטחון ${it.confidence})`, priority: 'normal', action: 'approve to apply' });
    if (this.categoryEnabled('finance_categorization')) for (const f of this.fwosCategorization().suggestions) list.push({ id: f.id, kind: 'fwos', ref: f.id, title: `Categorize ${f.applyTo.length} "${f.merchant}" expense(s) as ${f.category}`, titleHe: `לסווג ${f.applyTo.length} הוצאות "${f.merchant}" כ-${f.category}`, why: `${f.examples.length} earlier consistent examples`, whyHe: `${f.examples.length} דוגמאות עקביות קודמות`, priority: 'low', action: 'approve to apply' });
    const withState = list.map((x) => ({ ...x, status: state[x.id]?.status ?? 'open', until: state[x.id]?.until ?? null }));
    return all ? withState : withState.filter((x) => x.status === 'open' || (x.status === 'postponed' && Date.parse(x.until) <= Date.now()));
  }
  async suggestionAction(id, action, actor, { until } = {}) {
    const sg = this.suggestions({ all: true }).find((x) => x.id === id);
    if (!sg) throw err('no such suggestion', 404);
    const state = { ...this.s.store.getMeta('suggestionState', {}) };
    let result = null;
    if (action === 'dismiss') state[id] = { status: 'dismissed', at: now() };
    else if (action === 'postpone') state[id] = { status: 'postponed', until: until ?? new Date(Date.now() + 7 * DAY).toISOString() };
    else if (action === 'approve') {
      if (sg.kind === 'proposal') result = this.approve(sg.ref, actor);
      else if (sg.kind === 'profile') result = this.approveProfileItem(sg.ref, actor);
      else if (sg.kind === 'fwos') result = this.applyCategorization(sg.ref, actor);
      else if (sg.ref === 'brain.evaluation') result = await (await import('../brain/evaluation.js')).runEvaluation(this.s.store);
      state[id] = { status: 'approved', at: now() };
    } else throw err('action must be dismiss, postpone or approve');
    this.s.store.setMeta('suggestionState', state);
    this.log(`suggestion.${action}`, { id }, actor);
    return { suggestion: { ...sg, ...state[id] }, result };
  }

  // ---------------- scheduler cycle & dashboard ----------------
  /** One bounded improvement cycle: snapshot, analyze, test at most `maxExperiments` proposals. */
  async cycle({ maxExperiments = 1 } = {}) {
    this.snapshot();
    const patterns = this.analyze();
    let tested = 0;
    if (this.mode() >= 2) for (const p of this.proposals('proposed').slice(0, maxExperiments)) { await this.experiment(p.id); tested++; }
    return { patterns: patterns.filter((p) => p.recurring).length, tested, mode: this.mode() };
  }

  dashboard() {
    const perf = this.performance({ days: 14 });
    return {
      mode: this.modes(), totals: perf.totals, series: perf.series,
      patterns: this.patterns().slice(0, 20), classes: FAILURE_CLASSES, feedbackCategories: FEEDBACK_CATEGORIES,
      proposals: this.proposals().slice(0, 30), experiments: this.experiments().slice(0, 15), deployments: this.deployments().slice(0, 15),
      suggestions: this.suggestions(), versions: this.versions.targets(), audit: this.audit(30),
    };
  }
}
