// Autonomous error analysis: classifies every failure signal (failed task, negative feedback,
// abandoned clarification) into one of 13 failure classes, groups recurring signals into
// patterns, and forms a root-cause HYPOTHESIS only when the evidence supports one. With too
// little evidence it says so instead of guessing.

export const FAILURE_CLASSES = {
  intent_misinterpretation: { en: 'Incorrect intent interpretation', he: 'פירוש שגוי של הכוונה', component: 'intent-parser' },
  missing_context: { en: 'Missing context', he: 'חסר הקשר', component: 'context-engine' },
  memory_retrieval: { en: 'Incorrect memory retrieval', he: 'שליפת זיכרון שגויה', component: 'memory' },
  model_selection: { en: 'Poor model selection or model unavailable', he: 'בחירת מודל לא מתאימה או מודל לא זמין', component: 'model-router' },
  agent_coordination: { en: 'Agent coordination failure', he: 'כשל בתיאום סוכנים', component: 'agent-orchestrator' },
  invalid_parameters: { en: 'Invalid tool parameters', he: 'פרמטרים לא תקינים לכלי', component: 'tool-execution' },
  permission_denied: { en: 'Permission denial', he: 'חסימת הרשאה', component: 'policy' },
  external_api: { en: 'External API or device failure', he: 'כשל של שירות או מכשיר חיצוני', component: 'external' },
  timeout: { en: 'Timeout', he: 'חריגת זמן', component: 'tool-execution' },
  data_inconsistency: { en: 'Data inconsistency', he: 'חוסר עקביות בנתונים', component: 'data' },
  calculation_error: { en: 'Incorrect calculation', he: 'חישוב שגוי', component: 'computation' },
  verification_failure: { en: 'Verification failure', he: 'כשל אימות', component: 'verification' },
  expectation_mismatch: { en: 'User expectation mismatch', he: 'פער מול ציפיות המשתמש', component: 'response' },
};
export const UNCLASSIFIED = { en: 'Unclassified (insufficient evidence)', he: 'לא מסווג (אין מספיק ראיות)', component: 'unknown' };
export const classLabel = (cls) => FAILURE_CLASSES[cls] ?? UNCLASSIFIED;

// Ordered: the first matching rule wins. Each rule names the evidence it relied on.
const MESSAGE_RULES = [
  [/verification failed/i, 'verification_failure', 'error says verification failed'],
  [/timed out|timeout|ETIMEDOUT/i, 'timeout', 'error mentions a timeout'],
  [/rate.?limit|\b429\b|too many requests/i, 'external_api', 'provider rate limit (external API)'],
  [/language model|AI model|needs an AI|ANTHROPIC_API_KEY|no_llm|מודל שפה|מודל AI/i, 'model_selection', 'error says no suitable language model was available'],
  [/step limit|dependency|prerequisite|blocked by task|delegat/i, 'agent_coordination', 'error points to agent steps or task dependencies'],
  [/not permitted|denied|blocked|risk limit|advisory|not allowed|policy|נחסם|אין הרשאה/i, 'permission_denied', 'error mentions a permission or policy block'],
  [/not a pure|division by zero|NaN|arithmetic|calculation/i, 'calculation_error', 'error comes from a calculation'],
  [/is required|must be|invalid input|invalid|unknown (?:unit|kind|metric|operator)|unknown tool|חסר/i, 'invalid_parameters', 'error says a tool parameter is missing or invalid'],
  [/not found|no matching|no unpaid|no such|לא נמצא|אין .* בשם|duplicate|mismatch/i, 'data_inconsistency', 'referenced record was not found or does not match'],
  [/offline|not connected|unavailable|ECONN|fetch failed|\b50[234]\b|HTTP \d{3}|לא מחובר/i, 'external_api', 'error says a device or service is unavailable'],
];

const FEEDBACK_RULES = [
  [/misunderst|not what i asked|didn'?t understand|wrong (?:tool|action|device|app)|לא הבנת|לא מה שביקשתי|לא לזה התכוונתי|פעולה לא נכונה|מכשיר לא נכון/i, 'intent_misinterpretation', 'feedback says the request was misunderstood'],
  [/forgot|remember|זוכר|זיכרון|שכחת/i, 'memory_retrieval', 'feedback says something remembered was wrong or missing'],
  [/context|i (?:already )?(?:said|told)|אמרתי כבר|ההקשר/i, 'missing_context', 'feedback says context was ignored'],
  [/calculat|math|sum|total|number|חישוב|חשבון|סכום|מספר/i, 'calculation_error', 'feedback says a number or calculation was wrong'],
  [/slow|took too long|איטי|לקח הרבה זמן/i, 'timeout', 'feedback says it was too slow'],
  [/wrong|incorrect|false|made up|hallucinat|not true|לא נכון|שגוי|טעות|המצאת|לא מדויק/i, 'expectation_mismatch', 'feedback says the answer was wrong (no detail which part)'],
  [/long|short|verbose|tone|english|hebrew|format|table|bullets|ארוך|קצר|טון|אנגלית|עברית|מפורט|טבלה|פורמט/i, 'expectation_mismatch', 'feedback is about style, length, format or language'],
];

export const FEEDBACK_CATEGORIES = ['accuracy', 'wrong_numbers', 'forgot', 'missing_context', 'misunderstood', 'wrong_action', 'too_long', 'too_short', 'format', 'language', 'tone', 'too_slow', 'other'];
const CATEGORY_CLASS = { accuracy: 'expectation_mismatch', wrong_numbers: 'calculation_error', forgot: 'memory_retrieval', missing_context: 'missing_context', misunderstood: 'intent_misinterpretation', wrong_action: 'intent_misinterpretation', too_long: 'expectation_mismatch', too_short: 'expectation_mismatch', format: 'expectation_mismatch', language: 'expectation_mismatch', tone: 'expectation_mismatch', too_slow: 'timeout' };

/** @returns {{cls: string, basis: string, certainty: 'rule'|'weak'}} */
export function classifySignal(sig) {
  if (sig.source === 'feedback') {
    if (sig.category && CATEGORY_CLASS[sig.category]) return { cls: CATEGORY_CLASS[sig.category], basis: `user chose the feedback category "${sig.category}"`, certainty: 'rule' };
    const r = FEEDBACK_RULES.find(([re]) => re.test(sig.note ?? ''));
    return r ? { cls: r[1], basis: r[2], certainty: 'rule' } : { cls: 'expectation_mismatch', basis: 'negative rating without an explanation', certainty: 'weak' };
  }
  if (sig.source === 'abandoned') return { cls: 'missing_context', basis: 'a clarification question was asked and the user moved on', certainty: 'weak' };
  if (sig.source === 'approval_rejected') return { cls: 'intent_misinterpretation', basis: 'the user rejected the action JARVIS proposed', certainty: 'weak' };
  if (sig.source === 'mission') return { cls: sig.error && MESSAGE_RULES.find(([re]) => re.test(sig.error))?.[1] || 'agent_coordination', basis: 'a mission task failed or was blocked', certainty: sig.error ? 'rule' : 'weak' };
  const r = MESSAGE_RULES.find(([re]) => re.test(sig.error ?? ''));
  if (r) return { cls: r[1], basis: r[2], certainty: 'rule' };
  if (sig.kind === 'policy') return { cls: 'permission_denied', basis: 'failure analysis kind is policy', certainty: 'rule' };
  if (sig.kind === 'external') return { cls: 'external_api', basis: 'failure analysis kind is external', certainty: 'rule' };
  return { cls: 'unclassified', basis: sig.tool ? `unexplained error from ${sig.tool}` : 'unexplained error', certainty: 'weak' };
}

export const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Signature that groups "the same problem": class + tool (+ device/agent where relevant). */
export function signatureOf(sig, cls) {
  const target = sig.entityId ?? sig.agent ?? '';
  return [cls, sig.tool ?? '-', cls === 'external_api' ? target : ''].join('|');
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
      signature: g.signature, cls: g.cls, label: classLabel(g.cls), component: classLabel(g.cls).component, tool: g.tool, target: g.target, occurrences: n,
      recurring: n >= min, confidence, confidenceNote: 'estimate from the amount and firmness of the evidence',
      firstAt: g.signals.map((x) => x.at).sort()[0], lastAt: g.signals.map((x) => x.at).sort().at(-1),
      classificationBasis: [...g.bases],
      evidence: g.signals.slice(-8).map((x) => ({ source: x.source, ref: x.taskId ?? x.id, at: x.at, message: String(x.message ?? '').slice(0, 120), error: String(x.error ?? x.note ?? '').slice(0, 160), basis: x.basis })),
      messages: g.signals.map((x) => x.message).filter(Boolean),
    };
  }).sort((a, b) => b.occurrences - a.occurrences);
}
