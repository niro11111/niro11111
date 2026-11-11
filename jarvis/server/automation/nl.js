// Natural-language -> workflow. "When I arrive home: turn on the lights downstairs, read my
// calendar, show urgent tasks, do not unlock doors" becomes trigger + tool steps.
// Sensitive or financial steps are never placed in an automation without an approval gate,
// and lines that forbid an action ("don't unlock") are recorded as guardrails.
import { parse } from '../core/intent.js';
import { riskOf } from '../tools/index.js';

const TRIGGERS = [
  [/(arrive|get) home|מגיע הביתה|כשאני מגיע לבית|כשאגיע הביתה/i, { type: 'event', event: 'presence.arrived_home' }],
  [/leave home|יוצא מהבית|כשאצא מהבית/i, { type: 'event', event: 'presence.left_home' }],
  [/transaction (is )?imported|עסקה חדשה|כשמיובאת עסקה/i, { type: 'event', event: 'wealth.transaction_imported' }],
  [/every (\d+) minutes|כל (\d+) דקות/i, (m) => ({ type: 'schedule', everyMinutes: Number(m[1] ?? m[2]) })],
  [/every hour|כל שעה/i, { type: 'schedule', everyMinutes: 60 }],
  [/every (morning|day)|כל בוקר|כל יום/i, { type: 'schedule', everyMinutes: 1440 }],
];
const FORBID = /(do not|don't|never|אל ת|לא ל|בלי ל)/i;

export function workflowFromText(text, tools, policy) {
  const [head, ...rest] = text.split(/[:\n]/);
  let trigger = { type: 'manual' };
  for (const [re, tr] of TRIGGERS) { const m = head.match(re) ?? text.match(re); if (m) { trigger = typeof tr === 'function' ? tr(m) : tr; break; } }
  const lines = (rest.length ? rest.join('\n') : text).split(/\n|;|,(?![^()]*\))|\s+-\s+|•/).map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter(Boolean);
  const steps = []; const guardrails = []; const skipped = [];
  for (const line of lines) {
    if (FORBID.test(line)) { guardrails.push(line); continue; }
    for (const p of parse(line)) {
      if (p.tool === 'llm.answer') { skipped.push({ line, reason: 'not understood as an action' }); continue; }
      const tool = tools[p.tool];
      const args = p.tool === 'home.control' && !p.args.entityId ? null : p.args;
      if (!args) { steps.push({ type: 'agent', prompt: line, label: line }); continue; }
      const risk = riskOf(tool, args);
      if (['sensitive', 'financial'].includes(risk)) steps.push({ type: 'approval', summary: line });
      steps.push({ type: 'tool', tool: p.tool, args, label: line, continueOnError: risk === 'read' });
    }
  }
  if (!steps.length) throw Object.assign(new Error('no actionable steps found'), { status: 400 });
  const name = head.trim().slice(0, 60) || 'Workflow';
  return { name, trigger, steps, guardrails, skipped, source: text, enabled: true };
}
