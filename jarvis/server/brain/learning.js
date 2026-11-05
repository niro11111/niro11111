// Learning engine. Two channels, both reviewable by the user, neither able to create a
// "verified" fact on its own:
//  1. Explicit preference statements ("I prefer...", "אני לא אוהב...") are captured as
//     INFERRED memories waiting in a review queue.
//  2. Feedback (thumbs up/down + optional note) on answers is recorded; repeated signals
//     produce adaptation suggestions (e.g. shorter answers) the user can apply in one click.
import { now } from '../lib/store.js';
import { FEEDBACK_CATEGORIES } from '../learn/classify.js';

const PATTERNS = [
  /\b(?:i (?:really )?(?:prefer|like|love|hate|dislike|don't like|do not like|always|never|usually)|my favou?rite)\b[^.!?\n]{3,120}/i,
  /(?:אני (?:מאוד )?(?:מעדיף|מעדיפה|אוהב|אוהבת|שונא|שונאת|לא אוהב|לא אוהבת|תמיד|אף פעם לא|בדרך כלל)|ה(?:\S+) האהוב(?:ה)? עליי)[^.!?\n]{2,120}/,
];

const CATEGORY_HINTS = [[/ארוך|long|verbose|יותר מדי מילים/i, 'too_long'], [/קצר מדי|too short|more detail|פירוט|מפורט/i, 'too_short'], [/english|hebrew|אנגלית|עברית|שפה/i, 'language'], [/לא הבנת|misunderst|not what i asked|לא מה שביקשתי/i, 'misunderstood'], [/wrong|incorrect|לא נכון|שגוי|טעות/i, 'accuracy'], [/slow|איטי/i, 'too_slow'], [/tone|טון|גס|רשמי/i, 'tone']];
export const inferCategory = (note) => CATEGORY_HINTS.find(([re]) => re.test(String(note ?? '')))?.[1] ?? null;

export class Learning {
  constructor(s) { this.s = s; }
  enabled() { return this.s.store.getMeta('privacy', {}).learningEnabled !== false && this.s.memory.enabled(); }

  /** Called for every user message; returns the queued suggestion, if any. */
  observe(message) {
    if (!this.enabled()) return null;
    for (const re of PATTERNS) {
      const m = String(message).match(re);
      if (!m) continue;
      const content = m[0].trim().replace(/\s+/g, ' ');
      try {
        const rec = this.s.memory.add({ content, type: 'preference', provenance: 'inferred', source: 'jarvis' });
        if (!rec.duplicate) this.s.audit.log('jarvis', 'learning.suggest', { id: rec.id });
        return rec;
      } catch { return null; }
    }
    return null;
  }

  queue() { return this.s.memory.pendingReview(); }
  approve(id) { return this.s.memory.correct(id, { provenance: 'user_statement' }, 'user'); }
  reject(id) { return this.s.memory.delete(id, 'user'); }

  feedback({ taskId, rating, note = '', category = null, correction = '', source = 'rating' }) {
    if (![1, -1].includes(Number(rating))) throw Object.assign(new Error('rating must be 1 or -1'), { status: 400 });
    if (category && !FEEDBACK_CATEGORIES.includes(category)) throw Object.assign(new Error(`category must be one of ${FEEDBACK_CATEGORIES.join(', ')}`), { status: 400 });
    const task = this.s.store.get('tasks_exec', taskId);
    // No category chosen: infer one from an explicit note (never from silence).
    const inferred = !category && Number(rating) < 0 ? inferCategory(note) : null;
    category = category ?? inferred;
    const rec = this.s.store.insert('feedback', { taskId, rating: Number(rating), note: String(note).slice(0, 500), category, categoryInferred: !!inferred, source, correction: String(correction ?? '').slice(0, 500), lang: task?.lang ?? null, channel: task?.channel ?? null, tools: task?.plan?.tools ?? [], agents: task?.plan?.agents ?? [], at: now() });
    this.s.audit.log('user', 'learning.feedback', { taskId, rating: rec.rating, category });
    const proposal = this.s.learn?.onFeedback(rec);
    if (proposal) rec.profileProposal = { id: proposal.id, key: proposal.key, value: proposal.value };
    return rec;
  }

  stats() {
    const fb = this.s.store.all('feedback').slice(-300);
    const byAgent = {};
    for (const f of fb) for (const a of f.agents) { const x = (byAgent[a] ??= { agent: a, up: 0, down: 0 }); f.rating > 0 ? x.up++ : x.down++; }
    const up = fb.filter((f) => f.rating > 0).length;
    return { total: fb.length, satisfactionPct: fb.length ? Math.round((up * 100) / fb.length) : null, byAgent: Object.values(byAgent), suggestions: this.suggestions(fb) };
  }

  /** Deterministic adaptation suggestions from recent negative feedback notes. */
  suggestions(fb = this.s.store.all('feedback').slice(-50)) {
    const neg = fb.filter((f) => f.rating < 0).map((f) => f.note.toLowerCase());
    const count = (re) => neg.filter((n) => re.test(n)).length;
    const out = [];
    const p = this.s.personality.get();
    if (count(/long|ארוך|יותר מדי|קצר יותר|shorter/) >= 2 && p.verbosity !== 'short') out.push({ id: 'shorter', text: 'Answers feel too long: switch to short answers', textHe: 'התשובות ארוכות מדי: לעבור לתשובות קצרות', patch: { verbosity: 'short' } });
    if (count(/short|קצר מדי|more detail|פירוט|מפורט/) >= 2 && p.verbosity !== 'detailed') out.push({ id: 'longer', text: 'Answers feel too short: switch to detailed answers', textHe: 'התשובות קצרות מדי: לעבור לתשובות מפורטות', patch: { verbosity: 'detailed' } });
    if (count(/english|אנגלית/) >= 2 && p.language !== 'he') out.push({ id: 'hebrew', text: 'Always answer in Hebrew', textHe: 'לענות תמיד בעברית', patch: { language: 'he' } });
    return out;
  }

  applySuggestion(id) {
    const sg = this.suggestions().find((x) => x.id === id);
    if (!sg) throw Object.assign(new Error('no such suggestion'), { status: 404 });
    this.s.audit.log('user', 'learning.apply', { id });
    return this.s.personality.set(sg.patch);
  }
}
