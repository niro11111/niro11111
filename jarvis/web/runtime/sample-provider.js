// Claude through the claude.ai artifact runtime (`sample` capability): runs on the viewer's own
// Claude account, so no API key is needed. Page tools let Claude act through JARVIS, and every
// tool call still goes through JARVIS's permission policy (see Core.runFromModel).
const b64ToBlob = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
const MESSAGES = {
  not_granted: 'Claude is not allowed for this page. Allow it from the page permissions, then try again.',
  sampling_disabled: 'Claude is not available for this account.',
  rate_limited: 'Claude is busy or the usage limit was reached. Try again in a little while.',
  session_expired: 'Sign in to claude.ai again.',
  refused: 'Claude declined this request.',
};

export class SampleProvider {
  constructor(sample, limits) { this.name = 'claude'; this.sample = sample; this.limits = limits ?? {}; }
  capabilities() { return { text: true, vision: !!this.limits.images, webSearch: false, tools: !!this.limits.tools, local: false }; }

  async complete({ system, messages = [], model = 'default', tools }) {
    const images = [];
    const turns = messages.map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      for (const b of m.content) if (b.type === 'image' && b.source?.data) images.push(b64ToBlob(b.source.data, b.source.media_type));
      return { role: m.role, content: text || '(image)' };
    }).filter((t) => t.content);
    const input = [{ role: 'user', content: `${system}\n\n(Instructions above. The conversation follows.)` }, ...turns];
    if (input[input.length - 1].role !== 'user') input.push({ role: 'user', content: 'Continue.' });
    const max = this.limits.tools?.maxCount ?? 0;
    const opts = { modelTier: ['quick', 'default', 'complex'].includes(model) ? model : 'default' };
    if (tools?.length && max) opts.tools = tools.slice(0, max);
    else opts.cache = false;
    if (images.length && this.limits.images) opts.images = images.slice(0, this.limits.images.maxCount);
    try {
      const r = await this.sample(input, opts);
      return { text: r.text, model: `claude·${r.modelTierApplied}`, truncated: r.truncated };
    } catch (e) {
      throw new Error(MESSAGES[e?.code] ?? `Claude: ${e?.message ?? e?.code ?? 'error'}`);
    }
  }
}

export const SAMPLE_TIERS = {
  fast: { provider: 'claude', model: 'quick', effort: 'low' },
  balanced: { provider: 'claude', model: 'default', effort: 'medium' },
  deep: { provider: 'claude', model: 'complex', effort: 'high' },
  local: { provider: 'local', model: 'local', effort: 'low' },
};
