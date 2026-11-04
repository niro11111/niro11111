// JARVIS AI engines: the generative layer on top of the model router.
//   generate  - documents, tables (CSV), emails, plans, code, JSON and calendar files (.ics)
//   buildApp  - single-file mini apps (HTML) that run sandboxed, with no access to JARVIS data
//   council   - several expert perspectives on one question, then a synthesis
//   planRun   - goal -> plan of tool steps -> execution through the permission policy
//   agents    - user-defined agents (instructions + an allow-list of JARVIS tools)
// Every engine is provider-agnostic (router.complete) and every action a model proposes goes
// through Core.runFromModel, so the approval and policy rules always apply.
import { now } from '../lib/store.js';
import { decisionMatrix } from '../wealth/calc.js';

export const GEN_KINDS = {
  document: { ext: 'md', mime: 'text/markdown', he: 'מסמך', instruction: 'Write a complete, well-structured document in Markdown (headings, lists where useful). No preamble.' },
  email: { ext: 'md', mime: 'text/markdown', he: 'מייל', instruction: 'Write the email: a subject line as "Subject: ..." then the body. Polite, concise, ready to send. No preamble.' },
  table: { ext: 'csv', mime: 'text/csv', he: 'טבלה', instruction: 'Return ONLY CSV text (comma separated, first row is the header, quote fields containing commas). No code fences, no explanation.' },
  plan: { ext: 'md', mime: 'text/markdown', he: 'תוכנית', instruction: 'Write an actionable plan in Markdown: goal, numbered steps with owners/dates where relevant, risks, and a checklist.' },
  code: { ext: 'txt', mime: 'text/plain', he: 'קוד', instruction: 'Return only the code in one block, with brief comments inside the code. No explanation outside it.' },
  json: { ext: 'json', mime: 'application/json', he: 'JSON', instruction: 'Return ONLY valid JSON. No code fences, no explanation.' },
  calendar: { ext: 'ics', mime: 'text/calendar', he: 'קובץ יומן', instruction: 'Return ONLY a JSON array of events: [{"title": string, "start": ISO-8601 local date-time, "end": ISO-8601 or null, "location": string or null, "description": string or null}]. Use real dates relative to today.' },
};

export const EXPERTS = {
  he: [
    { name: 'אסטרטג', brief: 'חשיבה לטווח ארוך, סדרי עדיפויות ומטרות' },
    { name: 'מומחה כספים', brief: 'עלויות, סיכונים כספיים ותזרים. לא נותן ייעוץ השקעות מורשה' },
    { name: 'ספקן', brief: 'מחפש חורים, הנחות לא מבוססות ומה יכול להשתבש' },
  ],
  en: [
    { name: 'Strategist', brief: 'long-term thinking, priorities and goals' },
    { name: 'Finance expert', brief: 'costs, financial risk and cash flow; not licensed investment advice' },
    { name: 'Skeptic', brief: 'finds gaps, unfounded assumptions and what could go wrong' },
  ],
};

const stripFences = (t) => String(t).trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim();

/** Tolerant JSON extraction from a model reply. */
export function parseJson(text) {
  const t = stripFences(text);
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.search(/[[{]/); const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new Error('the model did not return valid JSON');
}

const icsEsc = (s) => String(s ?? '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Deterministic iCalendar builder (the model only proposes the events). */
export function buildIcs(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JARVIS//AI//EN', 'CALSCALE:GREGORIAN'];
  events.forEach((e, i) => {
    if (!e?.title || Number.isNaN(Date.parse(e.start))) return;
    const end = e.end && !Number.isNaN(Date.parse(e.end)) ? e.end : new Date(Date.parse(e.start) + 36e5).toISOString();
    lines.push('BEGIN:VEVENT', `UID:jarvis-${Date.now()}-${i}@jarvis`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEsc(e.title)}`, ...(e.location ? [`LOCATION:${icsEsc(e.location)}`] : []), ...(e.description ? [`DESCRIPTION:${icsEsc(e.description)}`] : []), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Very small safety screen for generated apps: they run sandboxed anyway (no same-origin). */
function sanitizeApp(html) {
  let h = stripFences(html);
  if (!/<html|<body|<div|<script|<canvas/i.test(h)) throw new Error('the model did not return an HTML app');
  // No remote code or tracking: strip external script/link tags; apps must be self-contained.
  h = h.replace(/<script[^>]+src=["']?https?:[^>]*>\s*<\/script>/gi, '').replace(/<link[^>]+href=["']?https?:[^>]*>/gi, '');
  return h;
}

export class AIEngines {
  constructor(s) { this.s = s; }

  available() {
    const r = this.s.router.route({ complexity: 'medium' });
    const p = this.s.router.providers[r.provider];
    return { ai: !p.capabilities().local, provider: r.provider, tools: !!p.capabilities().tools, vision: !!p.capabilities().vision };
  }

  list() {
    const a = this.available();
    const on = a.ai ? 'online' : 'needs AI';
    return [
      { id: 'reasoning', name: 'Reasoning (quick / balanced / deep)', nameHe: 'חשיבה (מהיר / מאוזן / עמוק)', status: on, detail: 'routes each request by complexity, latency and privacy' },
      { id: 'tools', name: 'Agentic tool use', nameHe: 'שימוש בכלים', status: a.tools ? 'online' : a.ai ? 'limited' : 'needs AI', detail: 'the model acts through JARVIS tools under the permission policy' },
      { id: 'generator', name: 'Generator', nameHe: 'מחולל קבצים', status: on, detail: 'documents, tables, emails, plans, code, JSON, calendar files' },
      { id: 'apps', name: 'App builder', nameHe: 'בונה אפליקציות', status: on, detail: 'single-file mini apps that run sandboxed' },
      { id: 'council', name: 'Expert council', nameHe: 'מועצת מומחים', status: on, detail: 'three perspectives and a synthesis' },
      { id: 'planner', name: 'Plan & execute', nameHe: 'תכנון וביצוע', status: on, detail: 'goal to steps, executed with approvals' },
      { id: 'agents', name: 'Custom agents', nameHe: 'סוכנים מותאמים', status: on, detail: `${this.s.store.all('custom_agents').length} defined` },
      { id: 'vision', name: 'Vision', nameHe: 'ראייה', status: a.vision ? 'online' : 'needs AI', detail: 'understands attached images' },
      { id: 'rag', name: 'Personal context (RAG)', nameHe: 'הקשר אישי (RAG)', status: 'online', detail: 'answers cite your notes, memory, documents, tasks and calendar' },
      { id: 'deep', name: 'Deep thinking', nameHe: 'חשיבה עמוקה', status: on, detail: 'draft → self-critique → revised answer' },
      { id: 'decide', name: 'Decision engine', nameHe: 'מנוע החלטות', status: on, detail: 'weighted criteria, exact ranking, robustness check' },
      { id: 'watchers', name: 'Watchers', nameHe: 'צופים אוטונומיים', status: 'online', detail: 'monitor metrics and alert, no model per check' },
      { id: 'simulation', name: 'Monte Carlo', nameHe: 'סימולציית מונטה קרלו', status: 'online', detail: 'odds of reaching savings goals' },
      { id: 'deterministic', name: 'Deterministic engines', nameHe: 'מנועים דטרמיניסטיים', status: 'online', detail: 'finance math, calculator, dates, units, memory search: no model needed' },
    ];
  }

  async ask(need, system, user, extra = {}) {
    const out = await this.s.router.complete(need, { system, messages: [{ role: 'user', content: user }], ...extra });
    if (out.offline) throw new Error('this engine needs an AI model (open JARVIS in claude.ai, or add an API key in Settings)');
    return out;
  }

  sysPrompt(lang) {
    return `${this.s.personality.systemPrompt({ lang })}\nToday is ${new Date().toISOString().slice(0, 10)}. Write in ${lang === 'he' ? 'Hebrew' : 'English'} unless the request says otherwise.`;
  }

  async generate({ kind = 'document', prompt, lang = 'en', title }) {
    const k = GEN_KINDS[kind];
    if (!k) throw Object.assign(new Error(`kind must be one of ${Object.keys(GEN_KINDS).join(', ')}`), { status: 400 });
    if (!String(prompt ?? '').trim()) throw Object.assign(new Error('prompt required'), { status: 400 });
    const out = await this.ask({ complexity: 'medium' }, `${this.sysPrompt(lang)}\n${k.instruction}`, String(prompt));
    let content = stripFences(out.text);
    let events = null;
    if (kind === 'json') content = JSON.stringify(parseJson(out.text), null, 2);
    if (kind === 'calendar') { events = parseJson(out.text); if (!Array.isArray(events)) events = events.events ?? []; content = buildIcs(events); }
    if (kind === 'table' && !content.includes(',')) throw new Error('the model did not return CSV');
    const name = (title || String(prompt).split(/\s+/).slice(0, 6).join(' ')).replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || kind;
    const rec = this.s.store.insert('generated', { kind, title: name, filename: `${name}.${k.ext}`, mime: k.mime, content, prompt: String(prompt).slice(0, 2000), events, model: out.route.model });
    // Text outputs are indexed in the knowledge base so JARVIS can search them later.
    if (['document', 'email', 'plan', 'table'].includes(kind)) {
      try { this.s.documents.add({ name: `${name}.${kind === 'table' ? 'csv' : 'md'}`, text: content, workspace: 'documents' }); } catch { /* indexing is best-effort */ }
    }
    this.s.audit.log('ai', 'ai.generate', { id: rec.id, kind });
    return rec;
  }

  async buildApp({ prompt, lang = 'en' }) {
    if (!String(prompt ?? '').trim()) throw Object.assign(new Error('prompt required'), { status: 400 });
    const sys = `${this.sysPrompt(lang)}
You build small self-contained web apps. Return ONLY one complete HTML document: inline <style> and <script>, no external URLs, no network requests, no localStorage requirement (it may be unavailable), works offline.
Mobile-friendly, dark theme (#03060d background, cyan #2ee6ff accents), dir="${lang === 'he' ? 'rtl' : 'ltr'}", readable fonts, accessible labels.`;
    const out = await this.ask({ complexity: 'high' }, sys, String(prompt));
    const html = sanitizeApp(out.text);
    const title = (html.match(/<title>([^<]{1,80})<\/title>/i)?.[1] ?? String(prompt).split(/\s+/).slice(0, 5).join(' ')).trim();
    const rec = this.s.store.insert('apps', { title, html, prompt: String(prompt).slice(0, 2000), model: out.route.model });
    this.s.audit.log('ai', 'ai.build_app', { id: rec.id, bytes: html.length });
    return rec;
  }

  async council({ question, lang = 'en', experts }) {
    if (!String(question ?? '').trim()) throw Object.assign(new Error('question required'), { status: 400 });
    const panel = (experts?.length ? experts : EXPERTS[lang === 'he' ? 'he' : 'en']).slice(0, 4);
    const base = this.sysPrompt(lang);
    const opinions = [];
    for (const e of panel) { // sequential: the viewer's Claude runs a couple of calls at a time
      const out = await this.ask({ complexity: 'medium' }, `${base}\nYou are the "${e.name}" on an advisory council (${e.brief}). Give your view in at most 6 short bullet points. Be specific.`, String(question));
      opinions.push({ expert: e.name, text: out.text });
    }
    const synth = await this.ask({ complexity: 'high' }, `${base}\nYou chair the council. Combine the opinions into: a recommendation, the key trade-offs, and 3 concrete next steps. Say where the experts disagree.`,
      `Question: ${question}\n\n${opinions.map((o) => `## ${o.expert}\n${o.text}`).join('\n\n')}`);
    const rec = this.s.store.insert('councils', { question: String(question), opinions, synthesis: synth.text });
    return rec;
  }

  toolCatalog() {
    const skip = /^(ai\.|agents\.|llm\.|research\.|vision\.|computer\.|automation\.run|voice\.)/;
    return Object.values(this.s.tools).filter((t) => !skip.test(t.name)).map((t) => ({ name: t.name, desc: t.desc, args: Object.fromEntries(Object.entries(t.input ?? {}).map(([k, r]) => [k, `${r.type}${r.required ? ' (required)' : ''}${r.enum ? ` one of ${r.enum.join('|')}` : ''}`])) }));
  }

  async planRun({ goal, lang = 'en', execute = true, ctx = {} }) {
    if (!String(goal ?? '').trim()) throw Object.assign(new Error('goal required'), { status: 400 });
    const catalog = this.toolCatalog();
    const sys = `${this.sysPrompt(lang)}
You turn a goal into a short plan of concrete steps that JARVIS can run with its tools.
Tools (name: description; args):
${catalog.map((c) => `- ${c.name}: ${c.desc}; ${JSON.stringify(c.args)}`).join('\n')}
For home.control you need an entityId: plan a home.devices step first only if the goal needs devices.
Return ONLY JSON: {"summary": string, "steps": [{"title": string, "tool": string|null, "args": object}]} with at most 8 steps. Use "tool": null for advice-only steps.`;
    const out = await this.ask({ complexity: 'high' }, sys, String(goal));
    const plan = parseJson(out.text);
    const steps = (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 8).map((st) => ({ title: String(st.title ?? st.tool ?? 'step'), tool: st.tool && this.s.tools[st.tool] ? st.tool : null, args: st.args && typeof st.args === 'object' ? st.args : {}, status: 'planned' }));
    if (execute) {
      const c = { actor: ctx.actor ?? 'user', householdId: ctx.householdId ?? this.s.householdId, channel: 'text', lang };
      for (const st of steps) {
        if (!st.tool) { st.status = 'advice'; continue; }
        try {
          const r = await this.s.core.runFromModel(st.tool, st.args, c);
          st.status = r.executed ? 'done' : r.awaitingApproval ? 'awaiting_approval' : 'not_run';
          st.result = r.summary ?? r.note ?? '';
          if (r.approvalId) st.approvalId = r.approvalId;
        } catch (e) { st.status = 'failed'; st.result = e.message; }
      }
    }
    return this.s.store.insert('plans', { goal: String(goal), summary: String(plan.summary ?? ''), steps, executed: execute });
  }

  /** Decision engine: the model proposes options, criteria and scores; the ranking is computed exactly. */
  async decide({ question, lang = 'en' }) {
    if (!String(question ?? '').trim()) throw Object.assign(new Error('question required'), { status: 400 });
    const out = await this.ask({ complexity: 'high' }, `${this.sysPrompt(lang)}
Help decide. Identify 2-5 options (use the user's options if given) and 3-6 criteria that matter for THIS user, each with weight 1-5, and score every option on every criterion 1-10 with honest reasoning.
Return ONLY JSON: {"options": string[], "criteria": [{"name": string, "weight": number}], "scores": {"<option>": {"<criterion>": number}}, "notes": {"<option>": string}}`, String(question));
    const j = parseJson(out.text);
    if (!Array.isArray(j.options) || j.options.length < 2 || !Array.isArray(j.criteria)) throw new Error('the model did not return a usable decision matrix');
    const result = decisionMatrix(j);
    return this.s.store.insert('decisions', { question: String(question), options: j.options, scores: j.scores, notes: j.notes ?? {}, ...result });
  }

  /** Deep thinking: draft -> self-critique -> revised answer. Three model calls. */
  async deepThink({ prompt, lang = 'en', context = '' }) {
    const base = `${this.sysPrompt(lang)}${context ? `\n${context}` : ''}`;
    const draft = await this.ask({ complexity: 'high' }, `${base}\nThink carefully and answer thoroughly.`, String(prompt));
    const critique = await this.ask({ complexity: 'high' }, `${this.sysPrompt(lang)}\nYou are a rigorous reviewer. List concrete errors, unsupported claims, missing considerations and unclear parts in the draft. Be brief. If it is solid, say so.`, `Question:\n${prompt}\n\nDraft answer:\n${draft.text}`);
    const final = await this.ask({ complexity: 'high' }, `${base}\nRewrite the answer, fixing every valid point of the review. Output only the improved answer.`, `Question:\n${prompt}\n\nDraft:\n${draft.text}\n\nReview:\n${critique.text}`);
    return { text: final.text, draft: draft.text, critique: critique.text, model: final.route.model };
  }

  // ---------- custom agents ----------
  async designAgent({ description, lang = 'en' }) {
    const catalog = this.toolCatalog();
    const out = await this.ask({ complexity: 'medium' }, `${this.sysPrompt(lang)}
Design a JARVIS specialist agent from the user's description. Allowed tools (choose the minimum needed): ${catalog.map((c) => c.name).join(', ')}.
Return ONLY JSON: {"name": string, "handle": short lowercase latin or hebrew word without spaces, "description": string, "instructions": string (how it behaves, in the user's language), "tools": string[]}`, String(description));
    const d = parseJson(out.text);
    return this.createAgent({ ...d, source: description });
  }

  createAgent({ name, handle, description = '', instructions = '', tools = [], source = '' }) {
    const h = String(handle || name || '').trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, 24);
    if (!h) throw Object.assign(new Error('agent needs a name'), { status: 400 });
    if (this.s.store.all('custom_agents', (a) => a.handle === h).length) throw Object.assign(new Error(`@${h} already exists`), { status: 409 });
    const allowed = new Set(this.toolCatalog().map((c) => c.name));
    const rec = this.s.store.insert('custom_agents', { name: String(name || h).slice(0, 40), handle: h, description: String(description).slice(0, 300),
      instructions: String(instructions).slice(0, 4000), tools: [...new Set(tools)].filter((x) => allowed.has(x)), source: String(source).slice(0, 1000) });
    this.s.audit.log('user', 'agents.create', { handle: h, tools: rec.tools });
    return rec;
  }

  async invokeAgent(handle, message, ctx) {
    const a = this.s.store.all('custom_agents', (x) => x.handle === String(handle).toLowerCase())[0];
    if (!a) throw Object.assign(new Error(`no agent @${handle}`), { status: 404 });
    const route = this.s.router.route({ complexity: 'medium' });
    const canTools = this.s.router.providers[route.provider]?.capabilities().tools;
    const allowed = new Set(a.tools.map((n) => n.replace(/\./g, '_')));
    const tools = canTools ? this.s.core.modelTools(ctx).filter((t) => allowed.has(t.name)) : undefined;
    const out = await this.ask({ complexity: 'medium' }, `${this.sysPrompt(ctx.lang ?? 'en')}\nYou are "${a.name}" (@${a.handle}), a specialist agent inside JARVIS. ${a.instructions}\n${tools?.length ? 'Use your tools for the user\'s data. A result with executed:false has NOT happened.' : ''}`, String(message), { tools });
    a.lastUsedAt = now();
    return { agent: a.handle, text: out.text, model: out.route.model };
  }
}
