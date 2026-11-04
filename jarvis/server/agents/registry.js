// The agent roster (18 agents). Each agent has: a scope, an explicit tool allow-list,
// the data domains it may read, a step limit, input/output schemas and delegation rules.
// Agents never call each other directly: the Executive agent delegates through JARVIS CORE,
// and every step still passes the central permission policy.
const IO = {
  input: { objective: { type: 'string', required: true }, context: { type: 'object' } },
  output: { summary: { type: 'string', required: true }, data: { type: 'any' }, verified: { type: 'boolean', required: true } },
};

// Contract defaults: 30 s timeout, at most one retry and only for read-only steps, and a risk
// ceiling the agent can never act above (policy approvals still apply below it).
const A = (id, name, nameHe, scope, tools, extra = {}) => ({ id, name, nameHe, scope, tools, maxSteps: 6, dataScopes: ['general'], delegatesTo: [],
  timeoutMs: 30000, retry: { max: 1, onlyRisk: ['read'] }, riskLimit: 'external', ...IO, ...extra });

export const AGENTS = [
  A('executive', 'Executive Intelligence', 'מודיעין מנהלי', 'Coordinates JARVIS, breaks goals into steps and delegates to specialists', ['llm.answer', 'tasks.create', 'tasks.list', 'ai.council', 'ai.plan_run', 'mission.run', 'ai.decide', 'agents.create', 'agents.invoke', 'brain.watch_create', 'brain.watch_list'],
    { maxSteps: 12, timeoutMs: 180000, riskLimit: 'financial', delegatesTo: ['assistant', 'research', 'browser', 'finance', 'household', 'smarthome', 'communication', 'coding', 'knowledge', 'creative', 'automation'] }),
  A('assistant', 'Personal Assistant', 'עוזר אישי', 'Calendar, reminders, tasks, shopping, daily planning and small talk',
    ['chat.smalltalk', 'briefing.daily', 'briefing.weekly', 'tasks.create', 'tasks.list', 'tasks.complete', 'calendar.create', 'calendar.list', 'reminders.create', 'shopping.add', 'shopping.list', 'calc.evaluate', 'date.until', 'convert.units', 'timer.start', 'notes.add', 'notes.list'], { dataScopes: ['general', 'family', 'work'] }),
  A('research', 'Research', 'מחקר', 'Researches, compares and summarizes information with sources', ['research.web', 'memory.search', 'llm.answer'], { maxSteps: 4, timeoutMs: 180000 }),
  A('computer', 'Computer', 'מחשב', 'Authorized desktop actions through the local desktop bridge', ['computer.open_app', 'computer.open_url', 'computer.list_dir', 'computer.read_file', 'computer.screenshot'], { maxSteps: 8, dataScopes: ['general', 'work'], riskLimit: 'sensitive' }),
  A('browser', 'Browser', 'דפדפן', 'Reads web pages as untrusted content and extracts information', ['research.fetch', 'computer.open_url'], { maxSteps: 4 }),
  A('finance', 'Finance', 'פיננסים', 'Family Wealth OS analysis. Read-only; money movement is never executed',
    ['wealth.overview', 'wealth.analysis', 'wealth.report', 'wealth.bills', 'wealth.goals', 'wealth.simulate', 'wealth.transfer', 'wealth.record', 'wealth.goal_contribute', 'wealth.bill_paid', 'wealth.goal_odds', 'calc.evaluate'], { dataScopes: ['general', 'financial'], riskLimit: 'financial' }),
  A('household', 'Household', 'משק בית', 'Family logistics: bills, maintenance tasks, shopping', ['wealth.bills', 'wealth.bill_paid', 'tasks.create', 'reminders.create', 'shopping.add', 'shopping.list', 'timer.start'], { dataScopes: ['general', 'family'] }),
  A('smarthome', 'Smart Home', 'בית חכם', 'Connected devices, scenes and home status', ['home.devices', 'home.control', 'home.scene'], { maxSteps: 10, riskLimit: 'sensitive' }),
  A('communication', 'Communication', 'תקשורת', 'Drafts and summarizes messages; never sends on its own', ['llm.answer', 'notify.send'], { maxSteps: 4, timeoutMs: 180000 }),
  A('coding', 'Coding', 'פיתוח', 'Code generation, review and debugging', ['llm.answer', 'ai.generate', 'ai.build_app'], { maxSteps: 4, timeoutMs: 180000, dataScopes: ['general', 'work'] }),
  A('knowledge', 'Knowledge', 'ידע', 'Personal knowledge base and memory retrieval', ['memory.remember', 'memory.search', 'documents.search', 'notes.add', 'notes.list', 'llm.answer'], { maxSteps: 4, timeoutMs: 180000, dataScopes: ['general', 'family', 'work'] }),
  A('vision', 'Vision', 'ראייה', 'Image and screenshot understanding', ['vision.describe', 'computer.screenshot'], { maxSteps: 3, timeoutMs: 120000, riskLimit: 'sensitive' }),
  A('audio', 'Audio', 'שמע', 'Speech, voice notes and transcripts', ['voice.note', 'llm.answer'], { maxSteps: 3 }),
  A('health', 'Health & Wellness', 'בריאות ורווחה', 'Optional activity and sleep trends, habit streaks. No diagnosis', ['health.summary', 'habit.log', 'habit.status'], { maxSteps: 2, dataScopes: ['health'] }),
  A('security', 'Security', 'אבטחה', 'Audit review, permission and anomaly monitoring', ['security.review'], { maxSteps: 3 }),
  A('learning', 'Learning', 'למידה', 'Learns user-approved preferences and workflows', ['memory.remember', 'memory.search'], { maxSteps: 3 }),
  A('automation', 'Automation', 'אוטומציה', 'Creates, schedules and runs approved workflows', ['automation.run', 'notify.send'], { maxSteps: 10 }),
  A('creative', 'Creative', 'יצירה', 'Writing, documents, files, apps and ideas', ['llm.answer', 'tasks.create', 'ai.generate', 'ai.build_app'], { maxSteps: 6, timeoutMs: 180000, dataScopes: ['general', 'work'] }),
];

export const agentById = (id) => AGENTS.find((a) => a.id === id) ?? null;

/** Validates a value against the tiny schema format used by agents and tools. */
export function validate(schema = {}, value = {}) {
  const errors = [];
  for (const [k, rule] of Object.entries(schema)) {
    const v = value?.[k];
    if (v === undefined || v === null || v === '') { if (rule.required) errors.push(`${k} is required`); continue; }
    if (rule.type === 'any') continue;
    const type = Array.isArray(v) ? 'array' : typeof v;
    if (type !== rule.type) errors.push(`${k} must be ${rule.type}`);
    else if (rule.enum && !rule.enum.includes(v)) errors.push(`${k} must be one of ${rule.enum.join('|')}`);
    else if (rule.type === 'string' && rule.max && v.length > rule.max) errors.push(`${k} is too long`);
  }
  return errors;
}
