// Personal knowledge graph: entities (people, organizations, places, projects, events) and
// relationships extracted from memories, notes, documents, tasks and calendar events, each
// with provenance (the record it came from). Importance is PageRank; questions like
// "who is Dana?" or "how is Dana related to Acme?" are answered from the graph, with sources.
// Financial and health memories are not used (data domains stay separate).
import { now } from '../lib/store.js';

const STOP_EN = new Set(['I', 'The', 'A', 'An', 'My', 'We', 'Our', 'He', 'She', 'They', 'It', 'This', 'That', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'JARVIS', 'Jarvis', 'Remember', 'Note', 'Call', 'Buy', 'Pay', 'Meeting', 'Today', 'Tomorrow']);
const REL_HE = { 'אשתי': 'wife', 'בעלי': 'husband', 'אחי': 'brother', 'אחותי': 'sister', 'הבן שלי': 'son', 'הבת שלי': 'daughter', 'אמא שלי': 'mother', 'אבא שלי': 'father', 'החבר שלי': 'friend', 'החברה שלי': 'friend', 'הבוס שלי': 'boss', 'המנהל שלי': 'manager', 'המנהלת שלי': 'manager', 'השכן שלי': 'neighbor', 'הרופא שלי': 'doctor', 'הרופאה שלי': 'doctor', 'סבתא שלי': 'grandmother', 'סבא שלי': 'grandfather' };
const REL_EN = ['wife', 'husband', 'son', 'daughter', 'brother', 'sister', 'mother', 'mom', 'father', 'dad', 'friend', 'boss', 'manager', 'doctor', 'neighbor', 'partner', 'colleague', 'grandmother', 'grandfather', 'accountant', 'lawyer'];
const HE_WORD = '[\\u05D0-\\u05EA][\\u05D0-\\u05EA"\']+';
const key = (type, name) => `${type}:${String(name).trim().toLowerCase().replace(/\s+/g, ' ')}`;

export function extractFacts(text) {
  const t = String(text ?? '');
  const ents = []; const rels = [];
  const ent = (type, name) => { const n = String(name).trim().replace(/[.,;:!?]+$/, ''); if (n.length < 2) return null; const e = { type, name: n, key: key(type, n) }; if (!ents.some((x) => x.key === e.key)) ents.push(e); return e; };
  for (const [he, rel] of Object.entries(REL_HE)) for (const m of t.matchAll(new RegExp(`${he}\\s+(${HE_WORD})`, 'g'))) { const p = ent('person', m[1]); if (p) rels.push({ from: 'person:me', rel, to: p.key }); }
  for (const m of t.matchAll(new RegExp(`\\bmy (${REL_EN.join('|')}),? ([A-Z][a-z]+(?: [A-Z][a-z]+)?)`, 'g'))) { const p = ent('person', m[2]); if (p) rels.push({ from: 'person:me', rel: m[1].replace(/^mom$/, 'mother').replace(/^dad$/, 'father'), to: p.key }); }
  for (const m of t.matchAll(new RegExp(`\\b([A-Z][a-z]+) is my (${REL_EN.join('|')})\\b`, 'g'))) { const p = ent('person', m[1]); if (p) rels.push({ from: 'person:me', rel: m[2], to: p.key }); }
  for (const m of t.matchAll(/\b([A-Z][a-z]+) (?:works at|works for|is at) ([A-Z][\w&]*(?: [A-Z][\w&]*)*)/g)) { const p = ent('person', m[1]); const o = ent('org', m[2]); if (p && o) rels.push({ from: p.key, rel: 'works_at', to: o.key }); }
  for (const m of t.matchAll(new RegExp(`(${HE_WORD}) (?:עובד|עובדת) (?:ב-?|אצל )(${HE_WORD}(?: ${HE_WORD})?)`, 'g'))) { const p = ent('person', m[1]); const o = ent('org', m[2].replace(/^ב-?/, '')); if (p && o) rels.push({ from: p.key, rel: 'works_at', to: o.key }); }
  for (const m of t.matchAll(/\b([A-Z][a-z]+) lives in ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/g)) { const p = ent('person', m[1]); const c = ent('place', m[2]); if (p && c) rels.push({ from: p.key, rel: 'lives_in', to: c.key }); }
  for (const m of t.matchAll(new RegExp(`(${HE_WORD}) (?:גר|גרה) ב-?(${HE_WORD})`, 'g'))) { const p = ent('person', m[1]); const c = ent('place', m[2]); if (p && c) rels.push({ from: p.key, rel: 'lives_in', to: c.key }); }
  for (const m of t.matchAll(new RegExp(`יום ההולדת של (${HE_WORD})|\\b([A-Z][a-z]+)'s birthday`, 'g'))) { const p = ent('person', m[1] ?? m[2]); if (p) { const d = t.slice(m.index).match(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/); if (d) { const ev = ent('date', d[0]); rels.push({ from: p.key, rel: 'birthday', to: ev.key }); } } }
  for (const m of t.matchAll(/\b(?:project|פרויקט) ([A-Zא-ת][\wא-ת-]+)/g)) ent('project', m[1]);
  // English proper nouns not caught above (capitalized words inside a sentence).
  for (const m of t.matchAll(/(?<=[a-z,] )([A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?)/g)) if (!STOP_EN.has(m[1]) && !ents.some((e) => e.name === m[1])) ent('person-or-org', m[1]);
  return { entities: ents, relations: rels };
}

export class KnowledgeGraph {
  constructor(s) { this.s = s; }
  sources() {
    const out = [];
    for (const m of this.s.memory.list().filter((x) => !['financial', 'health'].includes(x.domain))) out.push({ col: 'memories', id: m.id, text: m.content, at: m.updatedAt ?? m.createdAt });
    for (const n of this.s.store.all('notes')) out.push({ col: 'notes', id: n.id, text: n.text ?? n.content ?? '', at: n.createdAt });
    for (const d of this.s.store.all('documents')) out.push({ col: 'documents', id: d.id, text: String(d.text ?? d.content ?? '').slice(0, 8000), at: d.createdAt });
    for (const t of this.s.store.all('tasks')) out.push({ col: 'tasks', id: t.id, text: t.title, at: t.createdAt, project: t.project });
    for (const e of this.s.store.all('events')) out.push({ col: 'events', id: e.id, text: `${e.title ?? ''} ${e.location ?? ''}`, at: e.start ?? e.createdAt, event: e });
    return out;
  }

  /** Rebuilds the graph from all sources (idempotent). */
  rebuild() {
    const nodes = new Map(); const edges = new Map();
    const node = (k, type, label, src) => { const n = nodes.get(k) ?? { id: k, type, label, mentions: 0, sources: [], firstSeen: src?.at ?? null, lastSeen: src?.at ?? null }; n.mentions++; if (src && n.sources.length < 20 && !n.sources.some((x) => x.id === src.id)) n.sources.push({ collection: src.col, id: src.id }); if (src?.at && (!n.lastSeen || src.at > n.lastSeen)) n.lastSeen = src.at; nodes.set(k, n); return n; };
    const edge = (from, rel, to, src, w = 1) => { if (from === to) return; const k = `${from}|${rel}|${to}`; const e = edges.get(k) ?? { id: k, from, rel, to, weight: 0, sources: [] }; e.weight += w; if (src && e.sources.length < 10 && !e.sources.some((x) => x.id === src.id)) e.sources.push({ collection: src.col, id: src.id }); edges.set(k, e); };
    node('person:me', 'person', 'You', null);
    for (const src of this.sources()) {
      const { entities, relations } = extractFacts(src.text);
      for (const e of entities) node(e.key, e.type, e.name, src);
      for (const r of relations) { if (!nodes.has(r.from)) node(r.from, r.from.split(':')[0], r.from.split(':')[1], src); edge(r.from, r.rel, r.to, src, 2); }
      if (src.project) { const p = node(key('project', src.project), 'project', src.project, src); for (const e of entities) edge(e.key, 'part_of', p.id, src); }
      const ks = entities.map((e) => e.key);
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) edge(ks[i] < ks[j] ? ks[i] : ks[j], 'mentioned_with', ks[i] < ks[j] ? ks[j] : ks[i], src, 0.5);
    }
    const pr = pagerank([...nodes.keys()], [...edges.values()]);
    for (const n of nodes.values()) n.rank = +(pr.get(n.id) ?? 0).toFixed(4);
    for (const c of ['kg_nodes', 'kg_edges']) for (const r of this.s.store.all(c)) this.s.store.remove(c, r.id);
    for (const n of nodes.values()) this.s.store.insert('kg_nodes', n);
    for (const e of edges.values()) this.s.store.insert('kg_edges', e);
    this.s.store.setMeta('kgBuiltAt', now());
    return this.stats();
  }
  stats() { const n = this.s.store.all('kg_nodes'); const e = this.s.store.all('kg_edges'); const types = {}; for (const x of n) types[x.type] = (types[x.type] ?? 0) + 1; return { nodes: n.length, edges: e.length, types, builtAt: this.s.store.getMeta('kgBuiltAt', null) }; }
  graph({ limit = 150 } = {}) {
    const nodes = this.s.store.all('kg_nodes').sort((a, b) => b.rank - a.rank).slice(0, limit);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: this.s.store.all('kg_edges', (e) => ids.has(e.from) && ids.has(e.to)), stats: this.stats() };
  }
  find(name) {
    const q = String(name ?? '').trim().toLowerCase().replace(/[?.!]+$/, '');
    if (!q) return null;
    const all = this.s.store.all('kg_nodes');
    return all.find((n) => n.label.toLowerCase() === q) ?? all.find((n) => n.label.toLowerCase().startsWith(q)) ?? null;
  }
  about(name) {
    const n = this.find(name);
    if (!n) return null;
    const edges = this.s.store.all('kg_edges', (e) => e.from === n.id || e.to === n.id).sort((a, b) => b.weight - a.weight);
    const label = (id) => this.s.store.all('kg_nodes', (x) => x.id === id)[0]?.label ?? id.split(':')[1];
    return { node: n, facts: edges.map((e) => ({ subject: label(e.from), rel: e.rel, object: label(e.to), weight: e.weight, sources: e.sources })) };
  }
  /** Shortest relationship path (BFS, undirected, strongest edges first). */
  path(a, b, { maxDepth = 4 } = {}) {
    const na = this.find(a); const nb = this.find(b);
    if (!na || !nb) return { found: false, missing: [!na && a, !nb && b].filter(Boolean) };
    const adj = new Map();
    for (const e of this.s.store.all('kg_edges').sort((x, y) => y.weight - x.weight)) { (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)).push({ to: e.to, e }); (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)).push({ to: e.from, e }); }
    const prev = new Map([[na.id, null]]); let frontier = [na.id];
    for (let d = 0; d < maxDepth && frontier.length && !prev.has(nb.id); d++) {
      const next = [];
      for (const id of frontier) for (const { to, e } of adj.get(id) ?? []) if (!prev.has(to)) { prev.set(to, { id, e }); next.push(to); }
      frontier = next;
    }
    if (!prev.has(nb.id)) return { found: false, from: na.label, to: nb.label };
    const steps = []; let cur = nb.id;
    while (prev.get(cur)) { const { id, e } = prev.get(cur); steps.unshift({ from: id, rel: e.rel, to: cur, sources: e.sources }); cur = id; }
    const label = (id) => this.s.store.all('kg_nodes', (x) => x.id === id)[0]?.label ?? id;
    return { found: true, from: na.label, to: nb.label, steps: steps.map((x) => ({ ...x, fromLabel: label(x.from), toLabel: label(x.to) })) };
  }
  /** Used by CORE where the parser had no rule: "who is X" / "how is X related to Y" when X is in the graph. */
  routeFor(message) {
    const t = String(message).trim();
    let m = t.match(/^(?:how is|how are) (.+?) (?:related|connected) to (.+?)\??$/i) ?? t.match(/^מה הקשר בין (.+?) (?:ל-?|לבין )(.+?)\??$/);
    if (m && this.find(m[1]) && this.find(m[2])) return [{ agent: 'knowledge', tool: 'knowledge.graph', args: { a: m[1], b: m[2] } }];
    m = t.match(/^(?:who is|tell me about|what do you know about) (.+?)\??$/i) ?? t.match(/^(?:מי זה|מי זאת|מי זו|ספר לי על|מה אתה יודע על) (.+?)\??$/);
    if (m && this.find(m[1])) return [{ agent: 'knowledge', tool: 'knowledge.graph', args: { query: m[1] } }];
    return null;
  }
}

export function pagerank(ids, edges, { d = 0.85, iters = 40 } = {}) {
  const n = ids.length || 1; const out = new Map(ids.map((i) => [i, 0])); const inn = new Map(ids.map((i) => [i, []]));
  for (const e of edges) { out.set(e.from, (out.get(e.from) ?? 0) + e.weight); out.set(e.to, (out.get(e.to) ?? 0) + e.weight); inn.get(e.to)?.push({ from: e.from, w: e.weight }); inn.get(e.from)?.push({ from: e.to, w: e.weight }); }
  let pr = new Map(ids.map((i) => [i, 1 / n]));
  for (let it = 0; it < iters; it++) {
    const next = new Map();
    for (const i of ids) { let sum = 0; for (const { from, w } of inn.get(i) ?? []) sum += (pr.get(from) * w) / (out.get(from) || 1); next.set(i, (1 - d) / n + d * sum); }
    pr = next;
  }
  return pr;
}
