// Intent Understanding Engine. Turns a request + its parsed steps into a structured analysis:
// kind (question/task/mission/command/conversation), language (he/en/mixed), entities, dates,
// amounts, urgency, risk, missing information, complexity, reasoning strategy and a
// confidence ESTIMATE (heuristic; never treated as truth).
import { parseWhen } from '../productivity/timeparse.js';
import { parseDate } from '../tools/utility.js';
import { riskOf } from '../tools/index.js';
import { validate } from '../agents/registry.js';

const RISK_RANK = { read: 0, write: 1, external: 2, sensitive: 3, financial: 4 };
export const riskRank = (r) => RISK_RANK[r] ?? 0;

export const SMALLTALK = /^(?:hi|hello|hey|thanks|thank you|thx|good (?:morning|evening|night)|how are you|שלום|היי|הי|אהלן|תודה(?: רבה)?|בוקר טוב|ערב טוב|לילה טוב|מה שלומך|מה נשמע|מה קורה)[\s!.?,]*(?:jarvis|ג'?ארוויס)?[\s!.?]*$/i;

const STRATEGY = [
  [/^(calc\.|date\.|convert\.)/, 'computation'],
  [/^wealth\.(goal_odds|simulate)/, 'scenario-modeling'],
  [/^wealth\./, 'deterministic-analysis'],
  [/^ai\.decide$/, 'comparative-analysis'],
  [/^ai\.council$/, 'multi-agent-collaboration'],
  [/^(ai\.plan_run|mission\.)/, 'analytical-decomposition'],
  [/^research\./, 'tool-assisted-investigation'],
  [/^(memory\.search|documents\.search|notes\.list)$/, 'retrieval'],
  [/^ai\.(generate|build_app)$/, 'generation'],
  [/^chat\./, 'direct'],
];

/** Questions to ask when a required field is missing (the smallest useful clarification). */
export const CLARIFY = {
  'tasks.create.title': { he: 'מה המשימה?', en: 'What is the task?' },
  'reminders.create.text': { he: 'על מה להזכיר לך?', en: 'What should I remind you about?' },
  'reminders.create.at': { he: 'מתי להזכיר?', en: 'When should I remind you?' },
  'notes.add.text': { he: 'מה לרשום בפתק?', en: 'What should the note say?' },
  'shopping.add.item': { he: 'מה להוסיף לרשימת הקניות?', en: 'What should I add to the shopping list?' },
  'calendar.create.title': { he: 'מה שם האירוע?', en: "What's the event called?" },
  'calendar.create.start': { he: 'מתי האירוע?', en: 'When is the event?' },
  'timer.start.minutes': { he: 'לכמה דקות?', en: 'For how many minutes?' },
  'habit.log.name': { he: 'איזה הרגל לסמן?', en: 'Which habit should I log?' },
  'ai.generate.prompt': { he: 'מה ליצור?', en: 'What should I create?' },
  'ai.build_app.prompt': { he: 'איזו אפליקציה לבנות?', en: 'What app should I build?' },
  'mission.run.goal': { he: 'מה המטרה?', en: 'What is the goal?' },
};
export const clarifyQuestion = (tool, field, lang) => CLARIFY[`${tool}.${field}`]?.[lang] ?? (lang === 'he' ? `חסר פרט: ${field}. מה הערך?` : `I need one more detail: ${field}. What should it be?`);

/** Converts a clarification answer into a value for the missing field. */
export function fillValue(field, schemaRule, answer) {
  const a = String(answer).trim();
  if (field === 'at' || field === 'start') return parseWhen(a) ?? (parseDate(a) ? parseDate(a).toISOString() : null);
  if (schemaRule?.type === 'number') { const n = Number(a.match(/\d+(?:\.\d+)?/)?.[0]); return Number.isFinite(n) ? n : null; }
  return a || null;
}

export function detectLanguage(text) {
  const he = /[֐-׿]/.test(text); const en = /[a-z]{3,}/i.test(text.replace(/jarvis/ig, ''));
  return he && en ? 'mixed' : he ? 'he' : 'en';
}

export function analyzeRequest(message, steps, tools, { usedModel = false } = {}) {
  const text = String(message);
  const lang = detectLanguage(text);
  const entities = [];
  const amount = text.match(/(\d+(?:[.,]\d+)?)\s*(?:₪|ש"ח|שח|שקלים|שקל|nis|ils|shekels?)/i);
  if (amount) entities.push({ type: 'money', value: Number(amount[1].replace(',', '.')), currency: 'ILS' });
  const when = parseWhen(text); if (when) entities.push({ type: 'datetime', value: when });
  const date = text.match(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/); if (date) entities.push({ type: 'date', value: date[0] });
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/); if (pct) entities.push({ type: 'percent', value: Number(pct[1]) });
  for (const st of steps) {
    if (st.args?.entityId) entities.push({ type: 'device', value: st.args.entityId });
    if (st.args?.category) entities.push({ type: 'category', value: st.args.category });
    if (st.args?.handle) entities.push({ type: 'agent', value: st.args.handle });
  }
  const urgency = /דחוף|מיד|עכשיו|בהקדם|urgent|asap|immediately|right now/i.test(text) ? 'high' : /היום|today|tonight|הערב/i.test(text) ? 'medium' : 'normal';
  const missing = [];
  let risk = 'read';
  for (const st of steps) {
    const tool = tools[st.tool];
    if (!tool) continue;
    for (const e of validate(tool.input, st.args)) {
      const f = e.match(/^(\w+) is required/);
      // A device named by area/name/pronoun is resolved later by CORE: not missing information.
      if (f && st.tool === 'home.control' && f[1] === 'entityId' && (st.args?.query || st.args?.useLast || st.args?.domain)) continue;
      if (f) missing.push({ tool: st.tool, field: f[1] });
    }
    const r = riskOf(tool, st.args ?? {});
    if (riskRank(r) > riskRank(risk)) risk = r;
  }
  const toolNames = steps.map((s) => s.tool);
  const kind = steps.some((s) => s.tool === 'chat.smalltalk') ? 'conversation'
    : toolNames.some((n) => /^(ai\.plan_run|mission\.run)$/.test(n)) || steps.length > 2 ? 'mission'
    : toolNames.every((n) => n === 'llm.answer' || /^(memory\.search|documents\.search|wealth\.(analysis|overview|bills|goals|report|goal_odds)|briefing\.|calc\.|date\.|convert\.|notes\.list|tasks\.list|habit\.status|brain\.watch_list|home\.devices|shopping\.list)/.test(n)) ? 'question'
    : risk === 'read' || risk === 'write' ? 'task' : 'command';
  const deep = steps.some((s) => s.args?.deep);
  const strategy = deep ? 'iterative-verification'
    : STRATEGY.find(([re]) => toolNames.some((n) => re.test(n)))?.[1]
    ?? (toolNames.includes('llm.answer') ? 'retrieval-augmented answer' : steps.length > 1 ? 'tool-assisted (multi-step)' : 'tool-assisted');
  const complexity = steps.length > 2 || deep || text.length > 280 ? 'high' : steps.length === 2 || text.length > 100 ? 'medium' : 'low';
  // Heuristic confidence: deterministic parses are reliable, model fallbacks less so, missing data lowest.
  const confidence = missing.length ? 0.35 : toolNames.every((n) => n === 'llm.answer') ? (usedModel ? 0.6 : 0.5) : 0.9;
  return { kind, lang, modality: 'text', entities, urgency, risk, missing, complexity, strategy, confidence, confidenceNote: 'heuristic estimate, not a guarantee', tools: toolNames };
}
