// The agent roster. Each agent has an isolated responsibility, an explicit tool allow-list
// and an execution limit. Agents never call each other: JARVIS CORE routes between them.
export const AGENTS = [
  { id: 'executive', name: 'Executive Assistant', desc: 'Daily planning, reminders, scheduling', maxSteps: 6,
    tools: ['briefing.daily', 'briefing.weekly', 'tasks.create', 'tasks.list', 'tasks.complete', 'calendar.create', 'calendar.list', 'reminders.create'] },
  { id: 'research', name: 'Research', desc: 'Web research, source evaluation, summaries', maxSteps: 4,
    tools: ['research.web', 'research.fetch', 'memory.search'] },
  { id: 'computer', name: 'Computer Control', desc: 'Authorized desktop actions through the desktop bridge', maxSteps: 8,
    tools: ['computer.open_app', 'computer.open_url', 'computer.list_dir', 'computer.read_file', 'computer.screenshot'] },
  { id: 'finance', name: 'Financial Intelligence', desc: 'Family Wealth OS analysis (read-only)', maxSteps: 5,
    tools: ['wealth.overview', 'wealth.analysis', 'wealth.report', 'wealth.bills', 'wealth.goals', 'wealth.simulate', 'wealth.transfer'] },
  { id: 'home', name: 'Home Management', desc: 'Household, bills, smart home', maxSteps: 6,
    tools: ['home.devices', 'home.control', 'home.scene', 'tasks.create', 'reminders.create', 'wealth.bills'] },
  { id: 'coding', name: 'Coding', desc: 'Code generation, review, debugging', maxSteps: 4, tools: ['llm.answer'] },
  { id: 'communication', name: 'Communication', desc: 'Drafts and summaries; never sends without approval', maxSteps: 4, tools: ['llm.answer', 'notify.send'] },
  { id: 'knowledge', name: 'Knowledge', desc: 'Personal knowledge base and memory', maxSteps: 4, tools: ['memory.remember', 'memory.search', 'llm.answer'] },
  { id: 'security', name: 'Security', desc: 'Audit review, permission monitoring', maxSteps: 3, tools: ['security.review'] },
  { id: 'planning', name: 'Planning', desc: 'Project breakdown, prioritization', maxSteps: 6, tools: ['tasks.create', 'tasks.list', 'llm.answer'] },
  { id: 'vision', name: 'Vision', desc: 'Screenshot and image understanding', maxSteps: 3, tools: ['computer.screenshot', 'llm.answer'] },
  { id: 'automation', name: 'Automation', desc: 'Workflows, triggers, schedules', maxSteps: 10, tools: ['automation.run', 'notify.send'] },
];

export const agentById = (id) => AGENTS.find((a) => a.id === id) ?? null;
