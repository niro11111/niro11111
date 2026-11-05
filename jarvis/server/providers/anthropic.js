// Anthropic (Claude) provider adapter. Loaded only when credentials are configured.
import Anthropic from '@anthropic-ai/sdk';

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5']);

export class AnthropicProvider {
  /** @param {{apiKey?:string, browser?:boolean, client?:object}} o  browser: the user's own key, used from their own browser */
  constructor({ apiKey, browser = false, client = null } = {}) {
    this.name = 'anthropic';
    this.client = client ?? new Anthropic(apiKey ? { apiKey, ...(browser ? { dangerouslyAllowBrowser: true } : {}) } : {});
  }
  capabilities() { return { text: true, vision: true, webSearch: true, tools: true, local: false }; }

  async send(params, model) {
    return FALLBACK_MODELS.has(model)
      ? this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : this.client.messages.create(params);
  }

  /**
   * @param {{system:string, messages:Array, model:string, effort?:string, maxTokens?:number, webSearch?:boolean}} req
   */
  /**
   * @param {{tools?: Array<{name, description, inputSchema, execute}>}} req  page tools: JARVIS tools whose
   *   execute() already enforces the permission policy. A manual agentic loop runs them.
   */
  async complete({ system, messages, model, effort = 'medium', maxTokens = 16000, webSearch = false, tools }) {
    const apiTools = [
      ...(webSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] : []),
      ...(tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema ?? { type: 'object', properties: {} } })),
    ];
    const byName = Object.fromEntries((tools ?? []).map((t) => [t.name, t]));
    const convo = [...messages];
    let res; let rounds = 0; const usage = { input_tokens: 0, output_tokens: 0 };
    for (;;) {
      res = await this.send({ model, max_tokens: maxTokens, system, messages: convo, output_config: { effort }, ...(apiTools.length ? { tools: apiTools } : {}) }, model);
      usage.input_tokens += res.usage?.input_tokens ?? 0; usage.output_tokens += res.usage?.output_tokens ?? 0;
      if (res.stop_reason === 'pause_turn' && ++rounds <= 8) { convo.push({ role: 'assistant', content: res.content }); continue; }
      if (res.stop_reason !== 'tool_use' || !tools?.length || ++rounds > 6) break;
      convo.push({ role: 'assistant', content: res.content }); // keep the whole content (thinking blocks included)
      const results = [];
      for (const b of res.content.filter((x) => x.type === 'tool_use')) {
        const tool = byName[b.name];
        try {
          if (!tool) throw new Error(`unknown tool ${b.name}`);
          const out = await tool.execute(b.input ?? {}, {});
          results.push({ type: 'tool_result', tool_use_id: b.id, content: typeof out === 'string' ? out : JSON.stringify(out).slice(0, 30000) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: b.id, content: `Error: ${e.message}`, is_error: true });
        }
      }
      convo.push({ role: 'user', content: results }); // all results of one turn in ONE user message
    }
    res.usage = usage;
    if (res.stop_reason === 'refusal') {
      return { text: 'I can\'t help with that request.', model: res.model, refused: true };
    }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const citations = res.content.flatMap((b) => (b.type === 'text' && b.citations ? b.citations : []))
      .map((c) => ({ url: c.url, title: c.title })).filter((c) => c.url);
    return { text, model: res.model, usage: res.usage, citations, truncated: res.stop_reason === 'max_tokens' };
  }
}
