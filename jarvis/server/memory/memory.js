// JARVIS MEMORY: typed, provenance-aware long-term memory with hybrid retrieval
// (semantic vectors + keyword BM25), duplicate detection, confidence, expiry,
// domain-scoped (permission-based) retrieval, and a global on/off switch.
import { embed, cosine, tokens } from './embed.js';
import { now } from '../lib/store.js';

export const MEMORY_TYPES = ['profile', 'preference', 'person', 'project', 'goal', 'task', 'workflow', 'knowledge',
  'conversation_summary', 'fact', 'device_context', 'family_context', 'decision', 'wealth_context'];

// Provenance: how much we can trust a memory. Never silently upgraded.
export const PROVENANCE = ['verified', 'user_statement', 'inferred', 'ai_suggestion', 'outdated'];
const CONFIDENCE = { verified: 1, user_statement: 0.85, inferred: 0.55, ai_suggestion: 0.4, outdated: 0.1 };

// Data domains. Retrieval only returns domains the calling agent is allowed to read.
export const DOMAINS = ['general', 'family', 'work', 'financial', 'health'];
const WORKSPACE_DOMAIN = { personal: 'general', documents: 'general', research: 'general', projects: 'work', business: 'work', family: 'family', financial: 'financial', health: 'health' };
export const domainOf = (m) => m.domain ?? WORKSPACE_DOMAIN[m.workspace] ?? (m.type === 'wealth_context' ? 'financial' : m.type === 'family_context' ? 'family' : 'general');

const DEFAULT_TTL_DAYS = { conversation_summary: 30, device_context: 7 };

export class Memory {
  constructor(store, audit) { this.store = store; this.audit = audit; }

  enabled() { return this.store.getMeta('privacy', {}).memoryEnabled !== false; }

  add({ content, type = 'knowledge', provenance = 'user_statement', workspace = 'personal', domain, tags = [],
    expiresAt = null, source = 'user', confidence }) {
    if (!this.enabled()) throw Object.assign(new Error('memory is disabled in the Privacy Center'), { status: 409, code: 'memory_off' });
    if (!content || !String(content).trim()) throw new Error('content required');
    if (!MEMORY_TYPES.includes(type)) throw new Error(`invalid type ${type}`);
    if (!PROVENANCE.includes(provenance)) throw new Error(`invalid provenance ${provenance}`);
    // An AI can only propose; it may never write a "verified" fact on its own.
    if (source !== 'user' && provenance === 'verified') provenance = 'ai_suggestion';
    const text = String(content).trim();
    const vector = embed(text);
    // Duplicate detection: same type and near-identical meaning -> reinforce, don't duplicate.
    const dup = this.store.all('memories', (m) => m.type === type && this.active(m) && cosine(vector, m.vector) > 0.93)[0];
    if (dup) {
      this.store.update('memories', dup.id, { lastConfirmedAt: now(), confirmations: (dup.confirmations ?? 1) + 1 });
      return { ...strip(dup), duplicate: true };
    }
    if (!expiresAt && DEFAULT_TTL_DAYS[type]) expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS[type] * 864e5).toISOString();
    const rec = this.store.insert('memories', {
      content: text, type, provenance, workspace, domain: domain ?? WORKSPACE_DOMAIN[workspace] ?? 'general', tags, expiresAt, source,
      confidence: confidence ?? CONFIDENCE[provenance], vector, tf: termFreq(text), reviewed: source === 'user', confirmations: 1,
    });
    this.audit.log(source, 'memory.add', { id: rec.id, type, provenance, domain: rec.domain });
    return strip(rec);
  }

  active(rec, at = Date.now()) { return !rec.disabled && (!rec.expiresAt || Date.parse(rec.expiresAt) > at); }

  list({ type, workspace, includeExpired = false } = {}) {
    return this.store.all('memories', (m) => (!type || m.type === type)
      && (!workspace || m.workspace === workspace)
      && (includeExpired || !m.expiresAt || Date.parse(m.expiresAt) > Date.now())).map(strip);
  }

  /**
   * Hybrid retrieval. score = 0.65 * cosine + 0.35 * normalised BM25, weighted by confidence.
   * @param {{domains?: string[]}} opts domains the caller may read (default: general only)
   */
  search(query, { k = 5, type, workspace, minScore = 0.12, includeOutdated = false, domains = ['general', 'family', 'work'] } = {}) {
    if (!this.enabled() || !String(query ?? '').trim()) return [];
    const q = embed(query);
    const qt = [...new Set(tokens(query).flatMap(variants))];
    const pool = this.store.all('memories', (m) => this.active(m)
      && (!type || m.type === type) && (!workspace || m.workspace === workspace)
      && domains.includes(domainOf(m))
      && (includeOutdated || m.provenance !== 'outdated'));
    const N = pool.length || 1;
    const avgLen = pool.reduce((a, m) => a + (m.tf?.__len ?? 1), 0) / N;
    const df = Object.fromEntries(qt.map((t) => [t, pool.filter((m) => m.tf?.[t]).length]));
    const scored = pool.map((m) => {
      const tf = m.tf ?? termFreq(m.content);
      let bm = 0;
      for (const t of qt) {
        const f = tf[t] ?? 0; if (!f) continue;
        const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
        bm += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (tf.__len / avgLen))));
      }
      const kw = bm / (bm + 2); // squash to 0..1
      const sem = cosine(q, m.vector);
      const score = (0.65 * sem + 0.35 * kw) * (0.75 + 0.25 * (m.confidence ?? 0.8));
      return { ...strip(m), score: +score.toFixed(4), semantic: +sem.toFixed(3), keyword: +kw.toFixed(3) };
    });
    return scored.filter((m) => m.score >= minScore).sort((a, b) => b.score - a.score).slice(0, k);
  }

  correct(id, patch, actor = 'user') {
    const m = this.store.get('memories', id);
    if (!m) return null;
    const allowed = {};
    for (const k of ['content', 'type', 'provenance', 'workspace', 'domain', 'tags', 'expiresAt', 'disabled']) {
      if (k in patch) allowed[k] = patch[k];
    }
    if (allowed.provenance && !PROVENANCE.includes(allowed.provenance)) throw new Error('invalid provenance');
    if (actor !== 'user' && allowed.provenance === 'verified') throw new Error('only the user can verify a memory');
    if (allowed.provenance) allowed.confidence = CONFIDENCE[allowed.provenance];
    if (allowed.content) { allowed.vector = embed(allowed.content); allowed.tf = termFreq(allowed.content); }
    const r = this.store.update('memories', id, { ...allowed, reviewed: actor === 'user' });
    this.audit.log(actor, 'memory.correct', { id, fields: Object.keys(allowed) });
    return strip(r);
  }

  delete(id, actor = 'user') {
    const ok = this.store.remove('memories', id);
    if (ok) this.audit.log(actor, 'memory.delete', { id });
    return ok;
  }

  deleteDomain(domain, actor = 'user') {
    const list = this.store.all('memories', (m) => domainOf(m) === domain);
    for (const m of list) this.store.remove('memories', m.id);
    this.audit.log(actor, 'memory.delete_domain', { domain, count: list.length });
    return list.length;
  }

  purgeExpired() {
    const expired = this.store.all('memories', (m) => m.expiresAt && Date.parse(m.expiresAt) <= Date.now());
    for (const m of expired) this.store.remove('memories', m.id);
    return expired.length;
  }

  export() { return { exportedAt: now(), memories: this.store.all('memories').map(strip) }; }

  pendingReview() { return this.store.all('memories', (m) => !m.reviewed).map(strip); }
}

// Hebrew prefix letters (ו ה ב ל מ ש כ) are stripped so "החשמל" matches "חשמל".
function variants(t) { return /^[הובלמשכ][א-ת]{2,}$/.test(t) ? [t, t.slice(1)] : [t]; }
function termFreq(text) {
  const toks = tokens(text).flatMap(variants);
  const tf = { __len: toks.length || 1 };
  for (const t of toks) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}
function strip({ vector, tf, ...rest }) { return rest; }
