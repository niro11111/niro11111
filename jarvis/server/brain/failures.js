// Failure analysis: classify an error, decide whether a retry is safe, suggest authorized
// alternatives, and record it. Retries are never automatic for consequential operations.
const RULES = [
  { re: /timed out|timeout|ETIMEDOUT|ECONNRESET|network|fetch failed|upstream|unavailable|busy|503|502|overloaded/i, kind: 'transient', fix: 'Temporary problem. It is safe to try a read again shortly.', fixHe: 'תקלה זמנית. אפשר לנסות שוב בעוד רגע.' },
  { re: /rate.?limit|429|too many/i, kind: 'transient', fix: 'Rate limited. Wait a minute before retrying.', fixHe: 'הגבלת קצב. כדאי לחכות דקה ולנסות שוב.' },
  { re: /offline|unavailable device|not connected|bridge is not connected/i, kind: 'external', fix: 'A device or service is offline. Check its power or connection, or use another device.', fixHe: 'מכשיר או שירות לא מחובר. בדקו חשמל או חיבור, או השתמשו במכשיר אחר.' },
  { re: /language model|AI model|needs an AI|ANTHROPIC_API_KEY|no_llm/i, kind: 'missing_capability', fix: 'Needs an AI model: open JARVIS in claude.ai or add an API key in Settings.', fixHe: 'דורש מודל AI: פתחו את JARVIS ב-claude.ai או הוסיפו מפתח בהגדרות.' },
  { re: /not permitted|denied|policy|advisory|exceeds the agent's risk limit|not allowed/i, kind: 'policy', fix: 'Blocked by your permission settings. Change the autonomy level or policy if you want this to run.', fixHe: 'נחסם לפי הגדרות ההרשאות שלך. אפשר לשנות את רמת האוטונומיה או את המדיניות.' },
  { re: /required|must be|invalid|not a pure|unknown (?:unit|kind|metric|operator)|could not read/i, kind: 'input', fix: 'Some details are missing or invalid. Rephrase with the missing details.', fixHe: 'חסרים פרטים או שהם לא תקינים. נסחו שוב עם הפרטים החסרים.' },
  { re: /not found|no (?:matching|unpaid|savings|such)|no agent|unknown tool/i, kind: 'permanent', fix: 'The item was not found. Check the name.', fixHe: 'הפריט לא נמצא. בדקו את השם.' },
  { re: /expired|changed after approval/i, kind: 'policy', fix: 'The approval is no longer valid. Ask again to get a fresh approval.', fixHe: 'האישור כבר לא בתוקף. בקשו שוב כדי לקבל אישור חדש.' },
];

export function analyzeFailure(error, { risk = 'read', tool = null } = {}) {
  const msg = String(error?.message ?? error ?? '');
  const rule = RULES.find((r) => r.re.test(msg)) ?? { kind: 'permanent', fix: 'Unexpected error. It was recorded for review.', fixHe: 'שגיאה לא צפויה. היא נרשמה לבדיקה.' };
  // A retry is only safe for transient failures of operations that cannot cause a side effect twice.
  const retrySafe = rule.kind === 'transient' && risk === 'read';
  return { kind: rule.kind, retrySafe, message: msg.slice(0, 300), recommendation: rule.fix, recommendationHe: rule.fixHe, tool };
}

export function recordFailure(store, analysis, extra = {}) {
  return store.insert('failures', { ...analysis, ...extra, at: new Date().toISOString() });
}

export function failureStats(store) {
  const list = store.all('failures').slice(-300);
  const byKind = {}; const byTool = {};
  for (const f of list) { byKind[f.kind] = (byKind[f.kind] ?? 0) + 1; if (f.tool) byTool[f.tool] = (byTool[f.tool] ?? 0) + 1; }
  return { total: list.length, byKind, byTool, recent: list.slice(-15).reverse() };
}
