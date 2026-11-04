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
    const pref = need.task && this.prefs?.[need.task];
    if (pref && this.tiers[pref] && need.privacy !== 'local_only') { tier = pref; reason = `user preference for ${need.task}`; }
    else if (need.privacy === 'local_only') { tier = 'local'; reason = 'privacy: local only'; }
    else if (need.complexity === 'high' || need.webSearch) { tier = 'deep'; reason = need.webSearch ? 'research needs web search + reasoning' : 'high complexity'; }
    else if (need.latency === 'realtime' && need.complexity !== 'medium') { tier = 'fast'; reason = 'realtime voice latency'; }
    else if (need.complexity === 'low') { tier = 'fast'; reason = 'low complexity, lowest cost'; }
    let choice = { tier, ...this.tiers[tier] };
    if (this.providers[choice.provider] && !this.healthy(choice.provider)) {
      const alt = this.chain(tier).find((tt) => tt !== tier && this.providers[this.tiers[tt].provider] && this.healthy(this.tiers[tt].provider));
      if (alt) { reason += ` (${choice.provider} unhealthy - using ${alt})`; choice = { tier: alt, ...this.tiers[alt] }; }
    }
    if (!this.providers[choice.provider]) {
      choice = { tier: 'local', ...this.tiers.local, degraded: true };
      reason += ' (no provider configured - using local)';
    }
    if (need.vision && !this.providers[choice.provider].capabilities().vision) reason += ' (vision unavailable)';
    return { ...choice, reason };
  }

  // ---------- gateway resilience: health, fallback chain, rate limits ----------
  /** Order of tiers to try after a failure: next cheaper/faster first, the local engine never (it cannot answer open questions). */
  chain(tier) { return ({ deep: ['deep', 'balanced', 'fast'], balanced: ['balanced', 'fast', 'deep'], fast: ['fast', 'balanced'], local: ['local'] })[tier] ?? [tier]; }
  healthy(provider) { const h = this.health?.[provider]; return !h || !h.downUntil || h.downUntil < Date.now(); }
  markResult(provider, ok, err = '') {
    this.health ??= {};
    const h = (this.health[provider] ??= { failures: 0, successes: 0, downUntil: 0, lastError: null });
    if (ok) { h.successes++; h.failures = 0; h.downUntil = 0; return; }
    h.failures++; h.lastError = String(err).slice(0, 200);
    if (h.failures >= 3) h.downUntil = Date.now() + 2 * 60e3; // circuit breaker: rest a failing provider for 2 minutes
  }
  setPreferences(prefs) {
    const allowed = Object.fromEntries(Object.entries(prefs ?? {}).filter(([k, v]) => /^[a-z_]{2,30}$/.test(k) && this.tiers[v]));
    this.prefs = allowed;
    return allowed;
  }

  async complete(need, req) {
    const first = this.route(need);
    const tried = [];
    const tiers = first.tier === 'local' || first.degraded ? [first.tier] : this.chain(first.tier).filter((tt) => this.providers[this.tiers[tt]?.provider]);
    let lastErr;
    for (const tier of tiers) {
      const r = tier === first.tier ? first : { tier, ...this.tiers[tier], reason: `fallback after ${tried.join(', ')}` };
      const p = this.providers[r.provider];
      if (need.vision && !p.capabilities().vision) return { text: '', noVision: true, offline: true, route: r };
      if (tier !== first.tier && !this.healthy(r.provider) && tried.length) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        const t0 = Date.now(); let out; let error = null;
        try {
          out = await p.complete({ ...req, model: r.model, effort: r.effort, webSearch: need.webSearch && p.capabilities().webSearch });
          this.markResult(r.provider, true);
          return { ...out, route: { ...r, fallbackFrom: tried.length ? tried : undefined } };
        } catch (e) {
          error = e.message; lastErr = e;
          this.markResult(r.provider, false, e.message);
          // A rate limit gets one short pause and a retry on the same model; anything else moves down the chain.
          if (/rate.?limit|429|busy|usage limit/i.test(e.message) && attempt === 0) { await new Promise((res) => setTimeout(res, this.retryDelayMs ?? 1500)); continue; }
          break;
        } finally {
          // Metadata only: no prompt or answer content is recorded.
          this.onCall?.({ provider: r.provider, model: r.model, tier: r.tier, latencyMs: Date.now() - t0, inputTokens: out?.usage?.input_tokens ?? 0,
            outputTokens: out?.usage?.output_tokens ?? 0, ok: !error && !out?.offline, offline: !!out?.offline, error });
        }
      }
      tried.push(`${r.provider}/${r.model}`);
      // Errors that a different model cannot fix (refusals, bad input, consent) are not retried down the chain.
      if (lastErr && /not allowed|declined|invalid_request|not_granted|refused|sign in/i.test(lastErr.message)) break;
    }
    throw lastErr ?? new Error('no model available');
  }

  gateway() {
    return { tiers: this.tiers, preferences: this.prefs ?? {}, health: this.health ?? {}, providers: this.status() };
  }

  status() {
    return Object.entries(this.providers).map(([k, p]) => ({ provider: k, capabilities: p.capabilities() }));
  }
}
