// Model routing. Picks a provider + model per request from complexity, latency, cost,
// vision and privacy needs. Providers are adapters; nothing in the core names a vendor.
import { LocalProvider } from '../providers/local.js';

export const DEFAULT_TIERS = {
  fast: { provider: 'anthropic', model: process.env.JARVIS_MODEL_FAST ?? 'claude-haiku-5-5', effort: 'low' },
  balanced: { provider: 'anthropic', model: process.env.JARVIS_MODEL_BALANCED ?? 'claude-sonnet-5-5', effort: 'medium' },
  deep: { provider: 'anthropic', model: process.env.JARVIS_MODEL_DEEP ?? 'claude-opus-5-5', effort: 'high' },
  local: { provider: 'local', model: 'local', effort: 'low' },
};

export class ModelRouter {
  constructor({ providers = {}, tiers = DEFAULT_TIERS } = {}) {
    this.providers = { local: new LocalProvider(), ...providers };
    this.tiers = tiers;
  }
  static async fromEnv() {
    const providers = {};
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      const { AnthropicProvider } = await import('../providers/anthropic.js');
      providers.anthropic = new AnthropicProvider();
    }
    return new ModelRouter({ providers });
  }

  /** @param {{complexity?:'low'|'medium'|'high', latency?:'realtime'|'normal'|'batch', vision?:boolean, privacy?:'normal'|'sensitive'|'local_only', webSearch?:boolean}} need */
  route(need = {}) {
    let tier = 'balanced';
    let reason = 'default';
    if (need.privacy === 'local_only') { tier = 'local'; reason = 'privacy: local only'; }
    else if (need.complexity === 'high' || need.webSearch) { tier = 'deep'; reason = need.webSearch ? 'research needs web search + reasoning' : 'high complexity'; }
    else if (need.latency === 'realtime' && need.complexity !== 'medium') { tier = 'fast'; reason = 'realtime voice latency'; }
    else if (need.complexity === 'low') { tier = 'fast'; reason = 'low complexity, lowest cost'; }
    let choice = { tier, ...this.tiers[tier] };
    if (!this.providers[choice.provider]) {
      choice = { tier: 'local', ...this.tiers.local, degraded: true };
      reason += ' (no provider configured - using local)';
    }
    if (need.vision && !this.providers[choice.provider].capabilities().vision) reason += ' (vision unavailable)';
    return { ...choice, reason };
  }

  async complete(need, req) {
    const r = this.route(need);
    const p = this.providers[r.provider];
    if (need.vision && !p.capabilities().vision) return { text: '', noVision: true, offline: true, route: r };
    const t0 = Date.now();
    let out; let error = null;
    try {
      out = await p.complete({ ...req, model: r.model, effort: r.effort, webSearch: need.webSearch && p.capabilities().webSearch });
      return { ...out, route: r };
    } catch (e) { error = e.message; throw e; } finally {
      // Metadata only: no prompt or answer content is recorded.
      this.onCall?.({ provider: r.provider, model: r.model, tier: r.tier, latencyMs: Date.now() - t0, inputTokens: out?.usage?.input_tokens ?? 0,
        outputTokens: out?.usage?.output_tokens ?? 0, ok: !error && !out?.offline, offline: !!out?.offline, error });
    }
  }

  status() {
    return Object.entries(this.providers).map(([k, p]) => ({ provider: k, capabilities: p.capabilities() }));
  }
}
