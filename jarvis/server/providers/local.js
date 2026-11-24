// Offline provider. It does not pretend to be an LLM: it answers from tool results and
// memory only, and says plainly when a request needs a language model to be configured.
export class LocalProvider {
  constructor() { this.name = 'local'; }
  capabilities() { return { text: true, vision: false, webSearch: false, local: true }; }
  async complete({ messages, context }) {
    const c = messages[messages.length - 1]?.content ?? '';
    const last = typeof c === 'string' ? c : c.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    const mem = context?.memories ?? [];
    if (mem.length) {
      return { text: `From your memory:\n${mem.map((m) => `- ${m.content} (${m.provenance})`).join('\n')}`, model: 'local' };
    }
    return { model: 'local', offline: true,
      text: `I understood "${String(last).slice(0, 120)}" as an open question. Open-ended answers need a language model ` +
        '(set ANTHROPIC_API_KEY). Built-in commands work offline: briefing, tasks, reminders, finances, smart home, memory.' };
  }
}
