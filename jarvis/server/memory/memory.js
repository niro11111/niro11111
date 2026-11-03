// JARVIS MEMORY: typed, provenance-aware long-term memory with semantic search.
import { embed, cosine } from './embed.js';
import { now } from '../lib/store.js';

export const MEMORY_TYPES = ['preference', 'profile', 'project', 'goal', 'decision', 'task',
  'conversation_summary', 'workflow', 'knowledge', 'wealth_context'];

// Provenance: how much we can trust a memory. Never silently upgraded.
export const PROVENANCE = ['verified', 'user_statement', 'inferred', 'ai_suggestion', 'outdated'];

export class Memory {
  constructor(store, audit) { this.store = store; this.audit = audit; }

  add({ content, type = 'knowledge', provenance = 'user_statement', workspace = 'personal',
    tags = [], expiresAt = null, source = 'user' }) {
    if (!content || !String(content).trim()) throw new Error('content required');
    if (!MEMORY_TYPES.includes(type)) throw new Error(`invalid type ${type}`);
    if (!PROVENANCE.includes(provenance)) throw new Error(`invalid provenance ${provenance}`);
    // An AI can only propose; it may never write a "verified" fact on its own.
    if (source !== 'user' && provenance === 'verified') provenance = 'ai_suggestion';
    const rec = this.store.insert('memories', {
      content: String(content).trim(), type, provenance, workspace, tags, expiresAt, source,
      vector: embed(content), reviewed: source === 'user',
    });
    this.audit.log(source, 'memory.add', { id: rec.id, type, provenance });
    return strip(rec);
  }

  active(rec, at = Date.now()) { return !rec.expiresAt || Date.parse(rec.expiresAt) > at; }

  list({ type, workspace, includeExpired = false } = {}) {
    return this.store.all('memories', (m) => (!type || m.type === type)
      && (!workspace || m.workspace === workspace)
      && (includeExpired || this.active(m))).map(strip);
  }

  search(query, { k = 5, type, workspace, minScore = 0.12, includeOutdated = false } = {}) {
    const q = embed(query);
    return this.store.all('memories', (m) => this.active(m)
      && (!type || m.type === type) && (!workspace || m.workspace === workspace)
      && (includeOutdated || m.provenance !== 'outdated'))
      .map((m) => ({ ...strip(m), score: +cosine(q, m.vector).toFixed(4) }))
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score).slice(0, k);
  }

  correct(id, patch, actor = 'user') {
    const m = this.store.get('memories', id);
    if (!m) return null;
    const allowed = {};
    for (const k of ['content', 'type', 'provenance', 'workspace', 'tags', 'expiresAt']) {
      if (k in patch) allowed[k] = patch[k];
    }
    if (allowed.provenance && !PROVENANCE.includes(allowed.provenance)) throw new Error('invalid provenance');
    if (actor !== 'user' && allowed.provenance === 'verified') throw new Error('only the user can verify a memory');
    if (allowed.content) allowed.vector = embed(allowed.content);
    const r = this.store.update('memories', id, { ...allowed, reviewed: actor === 'user' });
    this.audit.log(actor, 'memory.correct', { id, fields: Object.keys(allowed) });
    return strip(r);
  }

  delete(id, actor = 'user') {
    const ok = this.store.remove('memories', id);
    if (ok) this.audit.log(actor, 'memory.delete', { id });
    return ok;
  }

  purgeExpired() {
    const expired = this.store.all('memories', (m) => !this.active(m));
    for (const m of expired) this.store.remove('memories', m.id);
    return expired.length;
  }

  export() {
    return { exportedAt: now(), memories: this.store.all('memories').map(strip) };
  }

  pendingReview() { return this.store.all('memories', (m) => !m.reviewed).map(strip); }
}

function strip({ vector, ...rest }) { return rest; }
