// Anthropic (Claude) provider adapter. Loaded only when credentials are configured.
import Anthropic from '@anthropic-ai/sdk';

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5']);

export class AnthropicProvider {
  /** @param {{apiKey?:string, browser?:boolean}} o  browser: the user's own key, used from their own browser */
  constructor({ apiKey, browser = false } = {}) {
    this.name = 'anthropic';
    this.client = new Anthropic(apiKey ? { apiKey, ...(browser ? { dangerouslyAllowBrowser: true } : {}) } : {});
  }
  capabilities() { return { text: true, vision: true, webSearch: true, local: false }; }

  /**
   * @param {{system:string, messages:Array, model:string, effort?:string, maxTokens?:number, webSearch?:boolean}} req
   */
  async complete({ system, messages, model, effort = 'medium', maxTokens = 16000, webSearch = false }) {
    const params = {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort },
      ...(webSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] } : {}),
    };
    let res;
    if (FALLBACK_MODELS.has(model)) {
      // Server-side fallback when a safety classifier declines on this model.
      res = await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } else {
      res = await this.client.messages.create(params);
    }
    if (res.stop_reason === 'refusal') {
      return { text: 'I can\'t help with that request.', model: res.model, refused: true };
    }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const citations = res.content.flatMap((b) => (b.type === 'text' && b.citations ? b.citations : []))
      .map((c) => ({ url: c.url, title: c.title })).filter((c) => c.url);
    return { text, model: res.model, usage: res.usage, citations, truncated: res.stop_reason === 'max_tokens' };
  }
}
