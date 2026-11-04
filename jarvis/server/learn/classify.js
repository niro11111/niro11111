// Autonomous error analysis: classifies every failure signal (failed task, negative feedback,
// abandoned clarification) into one of 13 failure classes, groups recurring signals into
// patterns, and forms a root-cause HYPOTHESIS only when the evidence supports one. With too
// little evidence it says so instead of guessing.

export const FAILURE_CLASSES = {
  intent_misunderstood: { en: 'Request misunderstood', he: 'הבקשה לא הובנה' },
  missing_information: { en: 'Missing information', he: 'חסר מידע' },
  wrong_tool: { en: 'Wrong tool or action selected', he: 'נבחר כלי או פעולה לא נכונים' },
  tool_error: { en: 'Tool execution error', he: 'שגיאה בהפעלת כלי' },
  external_unavailable: { en: 'External service or device unavailable', he: 'שירות או מכשיר חיצוני לא זמין' },
  permission_denied: { en: 'Blocked by permissions', he: 'נחסם בהרשאות' },
  model_unavailable: { en: 'AI model unavailable', he: 'מודל AI לא זמין' },
  incorrect_answer: { en: 'Incorrect or unsupported answer', he: 'תשובה שגויה או לא מבוססת' },
  timeout: { en: 'Timeout', he: 'חריגת זמן' },
  rate_limited: { en: 'Rate limited', he: 'הגבלת קצב' },
  data_not_found: { en: 'Data not found', he: 'נתונים לא נמצאו' },
  verification_failed: { en: 'Verification failed', he: 'האימות נכשל' },
  user_dissatisfied: { en: 'User dissatisfied with style or length', he: 'המשתמש לא מרוצה מהסגנון או מהאורך' },
};

// Ordered: the first matching rule wins. Each rule names the evidence it relied on.
const MESSAGE_RULES = [
  [/verification failed/i, 'verification_failed', 'error says verification failed'],
  [/timed out|timeout|ETIMEDOUT/i, 'timeout', 'error mentions a timeout'],
  [/rate.?limit|\b429\b|too many requests/i, 'rate_limited', 'error mentions rate limiting'],
  [/language model|AI model|needs an AI|ANTHROPIC_API_KEY|no_llm|מודל שפה|מודל AI/i, 'model_unavailable', 'error says no language model is available'],
  [/not permitted|denied|blocked|risk limit|advisory|not allowed|policy|נחסם|אין הרשאה/i, 'permission_denied', 'error mentions a permission or policy block'],
  [/is required|missing|must be|invalid input|חסר/i, 'missing_information', 'error says required input is missing or invalid'],
  [/not found|no matching|no unpaid|no such|לא נמצא|אין .* בשם/i, 'data_not_found', 'error says the item was not found'],
  [/offline|not connected|unavailable|ECONN|fetch failed|\b50[234]\b|לא מחובר/i, 'external_unavailable', 'error says a device or service is offline'],
  [/unknown tool|unknown agent|not a pure|unknown (?:unit|kind|metric)/i, 'wrong_tool', 'error says the selected tool or input type does not fit'],
];

const FEEDBACK_RULES = [
  [/misunderst|not what i asked|didn'?t understand|לא הבנת|לא מה שביקשתי|לא לזה התכוונתי/i, 'intent_misunderstood', 'feedback says the request was misunderstood'],
  [/wrong (?:tool|action|device|app)|פעולה לא נכונה|מכשיר לא נכון|הפעלת את ה?לא/i, 'wrong_tool', 'feedback says the wrong action was taken'],
  [/wrong|incorrect|false|made up|hallucinat|not true|לא נכון|שגוי|טעות|המצאת|לא מדויק/i, 'incorrect_answer', 'feedback says the answer was wrong'],
  [/slow|took too long|איטי|לקח הרבה זמן/i, 'timeout', 'feedback says it was too slow'],
  [/long|short|verbose|tone|english|hebrew|ארוך|קצר|טון|אנגלית|עברית|מפורט/i, 'user_dissatisfied', 'feedback is about style, length or language'],
];

export const FEEDBACK_CATEGORIES = ['accuracy', 'misunderstood', 'wrong_action', 'too_long', 'too_short', 'language', 'tone', 'too_slow', 'other'];
const CATEGORY_CLASS = { accuracy: 'incorrect_answer', misunderstood: 'intent_misunderstood', wrong_action: 'wrong_tool', too_long: 'user_dissatisfied', too_short: 'user_dissatisfied', language: 'user_dissatisfied', tone: 'user_dissatisfied', too_slow: 'timeout' };

/** @returns {{cls: string, basis: string, certainty: 'rule'|'weak'}} */
export function classifySignal(sig) {
  if (sig.source === 'feedback') {
    if (sig.category && CATEGORY_CLASS[sig.category]) return { cls: CATEGORY_CLASS[sig.category], basis: `user chose the feedback category "${sig.category}"`, certainty: 'rule' };
    const r = FEEDBACK_RULES.find(([re]) => re.test(sig.note ?? ''));
    return r ? { cls: r[1], basis: r[2], certainty: 'rule' } : { cls: 'user_dissatisfied', basis: 'negative rating without an explanation', certainty: 'weak' };
  }
  if (sig.source === 'abandoned') return { cls: 'missing_information', basis: 'a clarification question was asked and the user moved on', certainty: 'weak' };
  const r = MESSAGE_RULES.find(([re]) => re.test(sig.error ?? ''));
  if (r) return { cls: r[1], basis: r[2], certainty: 'rule' };
  if (sig.kind === 'policy') return { cls: 'permission_denied', basis: 'failure analysis kind is policy', certainty: 'rule' };
  if (sig.kind === 'external') return { cls: 'external_unavailable', basis: 'failure analysis kind is external', certainty: 'rule' };
  return { cls: 'tool_error', basis: sig.tool ? `unexplained error from ${sig.tool}` : 'unexplained error', certainty: 'weak' };
}

export const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Signature that groups "the same problem": class + tool (+ device/agent where relevant). */
export function signatureOf(sig, cls) {
  const target = sig.entityId ?? sig.agent ?? '';
  return [cls, sig.tool ?? '-', cls === 'external_unavailable' ? target : ''].join('|');
}

/**
 * Groups classified signals into patterns. A pattern is "recurring" from `min` occurrences.
 * Confidence = share of signals in the group classified by a firm rule (not weak heuristics),
 * scaled by how much evidence there is; it is an estimate and labelled as such.
 */
export function clusterSignals(signals, { min = 3 } = {}) {
  const groups = new Map();
  for (const sig of signals) {
    const c = classifySignal(sig);
    const key = signatureOf(sig, c.cls);
    const g = groups.get(key) ?? { signature: key, cls: c.cls, tool: sig.tool ?? null, target: sig.entityId ?? sig.agent ?? null, signals: [], bases: new Set(), firm: 0 };
    g.signals.push({ ...sig, basis: c.basis, certainty: c.certainty });
    g.bases.add(c.basis);
    if (c.certainty === 'rule') g.firm++;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const n = g.signals.length;
    const confidence = +(Math.min(1, n / (min * 2)) * (g.firm / n)).toFixed(2);
    return {
      signature: g.signature, cls: g.cls, label: FAILURE_CLASSES[g.cls], tool: g.tool, target: g.target, occurrences: n,
      recurring: n >= min, confidence, confidenceNote: 'estimate from the amount and firmness of the evidence',
      firstAt: g.signals.map((x) => x.at).sort()[0], lastAt: g.signals.map((x) => x.at).sort().at(-1),
      classificationBasis: [...g.bases],
      evidence: g.signals.slice(-8).map((x) => ({ source: x.source, ref: x.taskId ?? x.id, at: x.at, message: String(x.message ?? '').slice(0, 120), error: String(x.error ?? x.note ?? '').slice(0, 160), basis: x.basis })),
      messages: g.signals.map((x) => x.message).filter(Boolean),
    };
  }).sort((a, b) => b.occurrences - a.occurrences);
}
