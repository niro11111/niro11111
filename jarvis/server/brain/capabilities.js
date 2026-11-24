// Universal Capability Registry: every tool described as a capability (id, domain, schemas,
// permissions, dependencies, adapter, verification, version, availability, health), searchable
// by meaning, plus a controlled extension mechanism for new HTTP capabilities.
//
// A new capability passes six checks (schema, authentication, permission review, security,
// compatibility, execution test), then waits for the owner's approval. Unknown or unapproved
// capabilities never execute.
import { embed, cosine } from '../memory/embed.js';
import { RISK } from '../security/policy.js';
import { assertPublicUrl } from '../tools/research.js';
import { validate, agentById } from '../agents/registry.js';

const DEPENDS = [
  [/^(llm\.|ai\.|research\.web|vision\.|agents\.)/, 'ai-model'],
  [/^computer\./, 'desktop-bridge'],
  [/^health\./, 'health-consent'],
  [/^home\./, 'smart-home'],
  [/^research\.fetch|ext\./, 'network'],
];

function jsonSchema(input = {}) {
  const properties = {}; const required = [];
  for (const [k, r] of Object.entries(input)) { properties[k] = { type: r.type === 'any' ? 'string' : r.type, ...(r.enum ? { enum: r.enum } : {}) }; if (r.required) required.push(k); }
  return { type: 'object', properties, required };
}

export class Capabilities {
  constructor(s) { this.s = s; this.vecs = new Map(); }

  health(id) {
    const ex = this.s.store.all('tool_executions', (x) => x.tool === id).slice(-50);
    const fails = this.s.store.all('failures', (x) => x.tool === id).slice(-50);
    const total = ex.length + fails.length;
    return { executions: ex.length, failures: fails.length, successPct: total ? Math.round((ex.length * 100) / total) : null, status: !total ? 'unknown' : fails.length / total > 0.5 ? 'degraded' : 'healthy' };
  }

  available(deps) {
    const ai = this.s.ai.available().ai;
    return deps.every((d) => (d === 'ai-model' ? ai : d === 'desktop-bridge' ? !!this.s.bridge.connected() : d === 'health-consent' ? this.s.health.enabled() : true));
  }

  describe(t) {
    const deps = DEPENDS.filter(([re]) => re.test(t.name)).map(([, d]) => d);
    return {
      id: t.name, description: t.desc, domain: t.name.split('.')[0], version: t.version ?? '1.0.0',
      inputSchema: jsonSchema(t.input), outputSchema: { type: 'object', properties: { summary: { type: 'string' }, data: {}, output: { type: 'object' } }, required: ['summary'] },
      permissions: { risk: typeof t.risk === 'function' ? 'dynamic (depends on target)' : t.risk, alwaysConfirm: !!t.alwaysConfirm },
      dependencies: deps, adapter: t.adapter ?? (t.name.startsWith('computer.') ? 'desktop-bridge' : 'internal'),
      verification: t.verify ? 'state re-read after execution' : 'none (read-only or external)',
      availability: this.available(deps) ? 'available' : 'unavailable', health: this.health(t.name), source: t.extension ? 'extension' : 'built-in',
      agents: this.s.agentsFor?.(t.name) ?? [],
    };
  }

  list() { return Object.values(this.s.tools).map((t) => this.describe(t)); }

  /** Semantic search over capabilities: how could JARVIS accomplish this? */
  search(query, k = 8) {
    const q = embed(query);
    return this.list().map((c) => {
      if (!this.vecs.has(c.id)) this.vecs.set(c.id, embed(`${c.id.replace(/[._]/g, ' ')} ${c.description}`));
      return { ...c, score: +cosine(q, this.vecs.get(c.id)).toFixed(3) };
    }).sort((a, b) => b.score - a.score).slice(0, k);
  }

  // ---------- extension mechanism ----------
  /**
   * @param {{id, description, domain?, risk, inputSchema: object (tiny schema), adapter: {type:'http', url, method?}, test: {input}}} def
   */
  async register(def, { fetchImpl = globalThis.fetch } = {}) {
    const checks = [];
    const check = (name, fn) => { try { const note = fn(); checks.push({ name, ok: true, note: note ?? '' }); return true; } catch (e) { checks.push({ name, ok: false, note: e.message }); return false; } };
    check('schema', () => {
      if (!/^ext\.[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(def?.id ?? '')) throw new Error('id must look like ext.<name> (lowercase, digits, _)');
      if (!def.description || String(def.description).length < 10) throw new Error('description of at least 10 characters required');
      if (!def.inputSchema || typeof def.inputSchema !== 'object') throw new Error('inputSchema object required');
      for (const [k, r] of Object.entries(def.inputSchema)) if (!['string', 'number', 'boolean', 'object'].includes(r?.type)) throw new Error(`field ${k} needs a type`);
    });
    check('authentication', () => {
      if (def.adapter?.type !== 'http') throw new Error('only the http adapter is supported for extensions');
      const u = assertPublicUrl(def.adapter.url);
      if (u.protocol !== 'https:') throw new Error('extensions must use https');
      if (/token|key|secret|password/i.test(u.search)) throw new Error('do not put credentials in the URL');
      return u.host;
    });
    check('permission review', () => {
      if (!Object.values(RISK).includes(def.risk)) throw new Error(`risk must be one of ${Object.values(RISK).join(', ')}`);
      if (['read', 'write'].includes(def.risk)) throw new Error('an external HTTP capability is at least "external" risk');
      return `risk ${def.risk}${['sensitive', 'financial'].includes(def.risk) ? ' (always asks for approval)' : ''}`;
    });
    check('security', () => {
      if (this.s.tools[def.id]) throw new Error('a capability with this id already exists');
      if (/<script|javascript:|ignore (all )?previous/i.test(def.description)) throw new Error('description contains unsafe content');
      if (!['GET', 'POST', undefined].includes(def.adapter?.method)) throw new Error('method must be GET or POST');
    });
    check('compatibility', () => {
      const errors = validate(def.inputSchema, def.test?.input ?? {});
      if (errors.length) throw new Error(`test input does not match the schema: ${errors.join(', ')}`);
    });
    let testResult = null;
    if (checks.every((c) => c.ok)) {
      try { testResult = await this.callHttp(def.adapter, def.test?.input ?? {}, fetchImpl); checks.push({ name: 'execution test', ok: true, note: `HTTP ${testResult.status}` }); }
      catch (e) { checks.push({ name: 'execution test', ok: false, note: e.message }); }
    } else checks.push({ name: 'execution test', ok: false, note: 'skipped: earlier checks failed' });
    const passed = checks.every((c) => c.ok);
    const rec = this.s.store.insert('capability_registrations', {
      capId: def?.id ?? null, def: { id: def?.id, description: def?.description, domain: def?.domain ?? 'ext', risk: def?.risk, inputSchema: def?.inputSchema, adapter: def?.adapter, version: def?.version ?? '1.0.0' },
      checks, status: passed ? 'pending_review' : 'rejected', at: new Date().toISOString(),
    });
    this.s.audit.log('user', 'capability.register', { id: def?.id, status: rec.status }, passed ? 'ok' : 'rejected');
    return rec;
  }

  async callHttp(adapter, input, fetchImpl = globalThis.fetch) {
    const url = new URL(adapter.url);
    const method = adapter.method ?? 'POST';
    if (method === 'GET') for (const [k, v] of Object.entries(input)) url.searchParams.set(k, String(v));
    const r = await fetchImpl(url.href, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = (await r.text()).slice(0, 20000);
    return { status: r.status, body: text };
  }

  /** The owner approves a registration that passed every check: only then does it become a tool. */
  approve(regId, { fetchImpl = globalThis.fetch } = {}) {
    const reg = this.s.store.get('capability_registrations', regId);
    if (!reg || reg.status !== 'pending_review') throw Object.assign(new Error('only a registration that passed every check can be approved'), { status: 409 });
    this.install(reg.def, fetchImpl);
    this.s.store.update('capability_registrations', regId, { status: 'active', approvedAt: new Date().toISOString() });
    this.s.audit.log('user', 'capability.approve', { id: reg.def.id });
    return this.describe(this.s.tools[reg.def.id]);
  }

  install(def, fetchImpl = globalThis.fetch) {
    const self = this;
    this.s.tools[def.id] = {
      name: def.id, desc: def.description, input: def.inputSchema, risk: def.risk, version: def.version, adapter: 'http', extension: true,
      async run(args) {
        const r = await self.callHttp(def.adapter, args, fetchImpl);
        return { data: { status: r.status }, summary: `[${def.id}] ${r.body.slice(0, 1500)}` };
      },
    };
    this.vecs.delete(def.id);
    // Only the coordinating Executive agent may use an approved extension (an explicit grant, made by the owner's approval).
    const ex = agentById('executive'); if (!ex.tools.includes(def.id)) ex.tools.push(def.id);
  }

  /** Reinstall approved extensions after a restart. */
  restore() { for (const reg of this.s.store.all('capability_registrations', (x) => x.status === 'active')) if (!this.s.tools[reg.def.id]) this.install(reg.def); }

  disable(id) {
    const reg = this.s.store.all('capability_registrations', (x) => x.capId === id && x.status === 'active')[0];
    if (!reg) throw Object.assign(new Error('no active extension with this id'), { status: 404 });
    delete this.s.tools[id];
    const ex = agentById('executive'); ex.tools = ex.tools.filter((x) => x !== id);
    this.s.store.update('capability_registrations', reg.id, { status: 'disabled' });
    this.s.audit.log('user', 'capability.disable', { id });
    return true;
  }
}
