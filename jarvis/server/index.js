// JARVIS HTTP API + static web client. No framework: node:http with a tiny router.
// Binds to 127.0.0.1 by default. All /api routes (except /api/health) need the bearer token.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, startScheduler } from './app.js';
import { resolveToken, checkToken } from './security/auth.js';
import { bus } from './lib/events.js';
import { AGENTS } from './agents/registry.js';
import { MEMORY_TYPES, PROVENANCE } from './memory/memory.js';
import { scan } from './proactive/engine.js';
import { FORBIDDEN_FINANCIAL_ACTIONS } from './wealth/service.js';
import { applyOps, CAPABILITIES } from './devices/devices.js';
import { systemMap } from './system/engines.js';
import { workflowFromText } from './automation/nl.js';
import { AUTONOMY } from './security/policy.js';
import { detectLang } from './lib/i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../web');

export function createServer(s, token, opts = {}) {
  const routes = [];
  const r = (method, pattern, fn, scope = '*') => routes.push({ method, scope, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
  const ctx = (req) => ({ actor: req.actor, householdId: req.householdId, month: req.query.get('month') ?? undefined });
  const rate = new Map();

  r('GET', '/api/health', () => ({ ok: true, name: 'J.A.R.V.I.S', version: '0.1.0' }));
  r('GET', '/api/status', () => ({
    providers: s.router.status(), route: { voice: s.router.route({ latency: 'realtime' }), deep: s.router.route({ complexity: 'high' }) },
    home: s.home.kind, bridge: { connected: !!s.bridge.connected(), info: s.bridge.info },
    pendingApprovals: s.store.all('approvals', (a) => a.status === 'pending').length,
    demoData: s.store.all('transactions', (t) => t.demo).length > 0,
  }));

  // --- JARVIS CORE ---
  r('POST', '/api/command', (req) => s.core.handle(String(req.body.text ?? '').slice(0, 20000), { conversationId: req.body.conversationId ?? (req.device ? `dev:${req.device.id}` : undefined), channel: req.body.channel ?? 'text', householdId: req.householdId, deviceId: req.device?.id ?? null }), 'command');
  r('GET', '/api/tasks/exec', () => s.store.all('tasks_exec').slice(-50).reverse().map(({ plan, ...t }) => ({ ...t, steps: plan?.steps.map((x) => ({ n: x.n, tool: x.tool, agent: x.agent, status: x.status, verified: x.verified })) })));
  r('GET', '/api/tasks/exec/:id', (req, p) => s.store.get('tasks_exec', p.id));
  r('POST', '/api/tasks/exec/:id/cancel', (req, p) => s.core.cancel(p.id));
  r('GET', '/api/approvals', () => s.store.all('approvals', (a) => a.status === 'pending'), 'approvals');
  r('POST', '/api/approvals/:id', (req, p) => s.core.decide(p.id, req.body.decision === 'approve' ? 'approve' : 'reject', req.actor), 'approvals');
  r('GET', '/api/agents', () => AGENTS.map((a) => {
    const mine = s.store.all('tasks_exec', (t) => t.plan?.agents.includes(a.id));
    return { ...a, activeTasks: mine.filter((t) => ['EXECUTING', 'AWAITING_APPROVAL', 'VERIFYING'].includes(t.state)).length,
      completed: mine.filter((t) => t.state === 'COMPLETED').length, failed: mine.filter((t) => t.state === 'FAILED').length,
      lastRun: mine.at(-1) ? { at: mine.at(-1).createdAt, state: mine.at(-1).state, objective: mine.at(-1).objective } : null };
  }));
  r('GET', '/api/autonomy', () => ({ level: s.policy.autonomy(), levels: AUTONOMY }));
  r('PUT', '/api/autonomy', (req) => { const l = s.policy.setAutonomy(req.body.level); s.audit.log(req.actor, 'policy.autonomy', { level: l }); return { level: l, levels: AUTONOMY }; });
  r('GET', '/api/settings/personality', () => s.personality.get());
  r('PUT', '/api/settings/personality', (req) => { const p = s.personality.set(req.body); s.audit.log(req.actor, 'settings.personality', { fields: Object.keys(req.body) }); return p; });

  // --- system map, metrics, developer console ---
  r('GET', '/api/system/map', () => systemMap(s));
  r('GET', '/api/system/metrics', () => s.metrics.system());
  r('GET', '/api/console', () => ({ ...s.metrics.console(), providers: s.router.status(), autonomy: s.policy.autonomy(),
    automationRuns: s.automations.runs().slice(0, 20).map(({ vars, ...x }) => x),
    devices: s.devices.list().map((d) => ({ id: d.id, name: d.name, kind: d.kind, revoked: d.revoked, lastSeenAt: d.lastSeenAt })),
    securityEvents: s.audit.list(500).filter((a) => a.outcome !== 'ok' || /^(approval|policy|device|privacy|permission)/.test(a.action)).slice(0, 40).map(({ detail, ...a }) => ({ ...a, detail: { tool: detail?.tool, id: detail?.id ?? detail?.approvalId } })),
    bridge: { connected: !!s.bridge.connected(), info: s.bridge.info } }));

  // --- devices & sync ---
  r('GET', '/api/devices', () => s.devices.list());
  r('GET', '/api/devices/capabilities', () => CAPABILITIES);
  r('POST', '/api/devices', (req) => s.devices.register(req.body));
  r('DELETE', '/api/devices/:id', (req, p) => ({ revoked: s.devices.revoke(p.id) }));
  r('GET', '/api/sync', (req) => s.devices.pull(req.device, req.query.get('since')), 'sync');
  r('POST', '/api/sync/push', (req) => applyOps(s, req.device ?? { id: 'master', kind: 'web' }, req.body.ops), 'sync');

  // --- watch (minimal payloads) ---
  r('GET', '/api/watch/glance', async (req) => {
    const lang = req.query.get('lang') === 'en' ? 'en' : 'he';
    const next = s.productivity.listEvents({ from: new Date().toISOString() })[0];
    const ap = s.store.all('approvals', (a) => a.status === 'pending');
    const pv = s.privacy.get();
    return { lang, status: ap.length ? 'approval' : 'idle', time: new Date().toISOString(),
      nextEvent: next ? { title: next.title, start: next.start } : null,
      tasks: s.productivity.listTasks().slice(0, 3).map((t) => ({ id: t.id, title: t.title })),
      approvals: ap.slice(0, 3).map((a) => ({ id: a.id, summary: a.summary, risk: a.risk })),
      unread: s.notifications.list({ unread: true }).length,
      bills: pv.financialAlertsOnWatch ? s.wealth.upcomingBills({ actor: 'watch', householdId: req.householdId }, 3).map((b) => ({ name: b.name, overdue: b.overdue })) : [],
      weather: await s.weather.current().then((w) => (w.available ? { t: w.temperature, text: lang === 'he' ? w.textHe : w.text } : null)) };
  }, 'watch');
  r('POST', '/api/watch/action', async (req) => {
    const b = req.body; const dev = req.device ?? { id: 'master', kind: 'watchos' };
    const op = (type, payload) => applyOps(s, dev, [{ opId: b.opId ?? `w_${Date.now()}_${Math.random()}`, type, payload, clientTime: b.clientTime }]).then((x) => x.results[0]);
    switch (b.action) {
      case 'add_reminder': return op('reminder.create', { text: b.text, at: b.at ?? new Date(Date.now() + 36e5).toISOString() });
      case 'add_task': return op('task.create', { title: b.text });
      case 'complete_task': return op('task.complete', { id: b.id });
      case 'shopping_add': return op('shopping.add', { item: b.text });
      case 'timer': { const m = Number(b.minutes); if (!(m > 0 && m <= 1440)) throw Object.assign(new Error('minutes 1-1440'), { status: 400 });
        return op('reminder.create', { text: b.text || `Timer ${m} min`, at: new Date(Date.now() + m * 6e4).toISOString() }); }
      case 'voice_note': return { status: 'applied', id: s.store.insert('voice_notes', { text: String(b.text).slice(0, 4000), device: dev.id }).id };
      case 'ask': return op('command', { text: b.text });
      case 'run_automation': { const wf = s.store.get('workflows', b.id); if (!wf?.enabled) throw Object.assign(new Error('workflow not found or disabled'), { status: 404 }); const run = await s.automations.run(wf.id, { from: 'watch' }); return { status: run.status, runId: run.id }; }
      case 'find_phone': {
        const phones = s.store.all('devices', (d) => ['ios', 'android'].includes(d.kind) && !d.revoked);
        if (!phones.length) return { status: 'unavailable', reason: 'no phone with the JARVIS app is registered' };
        await s.notifications.send({ title: 'Find my phone', body: `requested from ${dev.name ?? 'watch'}`, priority: 'critical', event: 'find_phone' });
        return { status: 'sent', note: 'The phone app plays an alert when it receives this critical notification.' };
      }
      default: throw Object.assign(new Error('unknown action'), { status: 400 });
    }
  }, 'watch');

  // --- health & wellness (consent-gated) ---
  r('POST', '/api/wellness/ingest', (req) => s.health.ingest(req.body.days, req.device?.kind ?? 'manual'), 'health');
  r('GET', '/api/wellness/summary', () => s.health.summary(), 'health');
  r('DELETE', '/api/wellness', () => ({ deleted: s.health.deleteAll() }));

  // --- privacy center ---
  r('GET', '/api/privacy', () => ({ settings: s.privacy.get(), inventory: s.privacy.inventory(), agents: AGENTS.map((a) => ({ id: a.id, name: a.name, dataScopes: a.dataScopes })) }));
  r('PUT', '/api/privacy', (req) => s.privacy.set(req.body));
  r('GET', '/api/privacy/export', () => s.privacy.exportAll());
  r('DELETE', '/api/privacy/voice', () => ({ deleted: s.privacy.deleteVoice() }));
  r('DELETE', '/api/privacy/domain/:domain', (req, p) => ({ deleted: s.memory.deleteDomain(p.domain) }));
  r('GET', '/api/voice/transcripts', () => s.store.all('voice_transcripts').slice(-100).reverse());

  // --- context ---
  r('GET', '/api/context/weather', () => s.weather.current());
  r('PUT', '/api/context/location', (req) => s.weather.setLocation(req.body));
  r('POST', '/api/presence', (req) => {
    const ev = { arrived_home: 'presence.arrived_home', left_home: 'presence.left_home' }[req.body.state];
    if (!ev) throw Object.assign(new Error('state must be arrived_home|left_home'), { status: 400 });
    return s.automations.emit(ev, { at: new Date().toISOString(), device: req.device?.id ?? null });
  }, 'command');

  // --- multimodal input ---
  r('POST', '/api/input', async (req) => {
    const b = req.body;
    switch (b.kind) {
      case 'text': return s.core.handle(String(b.text ?? ''), { householdId: req.householdId, conversationId: b.conversationId, deviceId: req.device?.id ?? null });
      case 'image': {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(b.mediaType ?? '')) throw Object.assign(new Error('mediaType must be image/png|jpeg|webp|gif'), { status: 415 });
        if ((b.data ?? '').length > 7e6) throw Object.assign(new Error('image too large (5 MB max)'), { status: 413 });
        const lang = detectLang(b.prompt ?? '') === 'he' || s.personality.get().language === 'he' ? 'he' : 'en';
        try {
          const out = await s.tools['vision.describe'].run({ image: b.data, mediaType: b.mediaType, prompt: b.prompt }, { actor: req.actor, lang, channel: 'text' });
          s.audit.log(req.actor, 'tool.vision.describe', { bytes: b.data.length });
          return { kind: 'image', state: 'COMPLETED', response: out.summary };
        } catch (e) { return { kind: 'image', state: 'FAILED', response: e.message }; }
      }
      case 'document': return { kind: 'document', document: (({ memoryIds, ...d }) => d)(s.documents.add({ name: b.name, text: b.text, workspace: b.workspace })) };
      case 'audio': return { kind: 'audio', state: 'FAILED', response: 'Server-side speech recognition is not configured. Use the browser/phone microphone, which transcribes on the device.' };
      default: throw Object.assign(new Error('kind must be text|image|document|audio'), { status: 400 });
    }
  });

  // --- shopping ---
  r('GET', '/api/shopping', () => s.store.all('shopping'));
  r('POST', '/api/shopping', (req) => s.store.insert('shopping', { item: String(req.body.item ?? '').slice(0, 200), done: false }));
  r('POST', '/api/shopping/:id/toggle', (req, p) => { const x = s.store.get('shopping', p.id); return x ? s.store.update('shopping', x.id, { done: !x.done }) : null; });
  r('DELETE', '/api/shopping/:id', (req, p) => ({ deleted: s.store.remove('shopping', p.id) }));
  r('GET', '/api/models/route', (req) => s.router.route(Object.fromEntries(req.query)));

  // --- memory ---
  r('GET', '/api/memory', (req) => s.memory.list({ type: req.query.get('type') ?? undefined, workspace: req.query.get('workspace') ?? undefined }));
  r('GET', '/api/memory/meta', () => ({ types: MEMORY_TYPES, provenance: PROVENANCE }));
  r('GET', '/api/memory/search', (req) => s.memory.search(req.query.get('q') ?? '', { k: 10 }));
  r('GET', '/api/memory/export', () => s.memory.export());
  r('GET', '/api/memory/review', () => s.memory.pendingReview());
  r('POST', '/api/memory', (req) => s.memory.add({ ...req.body, source: 'user' }));
  r('PATCH', '/api/memory/:id', (req, p) => s.memory.correct(p.id, req.body));
  r('DELETE', '/api/memory/:id', (req, p) => ({ deleted: s.memory.delete(p.id) }));

  // --- documents ---
  r('GET', '/api/documents', () => s.documents.list().map(({ memoryIds, ...d }) => d));
  r('POST', '/api/documents', (req) => { const { memoryIds, ...d } = s.documents.add(req.body); return d; });
  r('GET', '/api/documents/search', (req) => s.documents.search(req.query.get('q') ?? ''));
  r('DELETE', '/api/documents/:id', (req, p) => ({ deleted: s.documents.delete(p.id) }));

  // --- Family Wealth OS ---
  r('GET', '/api/wealth/overview', (req) => s.wealth.overview(ctx(req)));
  r('GET', '/api/wealth/accounts', (req) => s.wealth.accounts(ctx(req)));
  r('GET', '/api/wealth/transactions', (req) => s.wealth.transactions(ctx(req), { month: req.query.get('month') ?? undefined }));
  r('GET', '/api/wealth/budgets', (req) => s.wealth.budgets(ctx(req)));
  r('GET', '/api/wealth/goals', (req) => s.wealth.goals(ctx(req)));
  r('GET', '/api/wealth/assets', (req) => s.wealth.assets(ctx(req)));
  r('GET', '/api/wealth/liabilities', (req) => s.wealth.liabilities(ctx(req)));
  r('GET', '/api/wealth/bills', (req) => s.wealth.upcomingBills(ctx(req)));
  r('GET', '/api/wealth/series', (req) => s.wealth.series(ctx(req), Math.min(24, Number(req.query.get('months') ?? 6))));
  r('GET', '/api/wealth/insights', (req) => s.wealth.analysis(ctx(req)).recommendations);
  r('GET', '/api/wealth/reports', (req) => s.wealth.report(ctx(req)));
  r('POST', '/api/wealth/analysis', (req) => s.wealth.analysis({ ...ctx(req), month: req.body.month }));
  r('POST', '/api/wealth/recommendations', (req) => {
    const a = s.wealth.analysis({ ...ctx(req), month: req.body.month });
    return { recommendations: a.recommendations, simulation: req.body.cuts ? s.wealth.simulate(ctx(req), req.body.cuts) : null, disclaimer: a.disclaimer };
  });
  r('POST', '/api/wealth/actions', (req) => {
    if (!FORBIDDEN_FINANCIAL_ACTIONS.includes(req.body.action)) throw Object.assign(new Error('unknown action'), { status: 400 });
    return s.wealth.guardAction(ctx(req), req.body.action);
  });
  r('POST', '/api/wealth/import', (req) => {
    // Import transactions from Family Wealth OS (or a CSV converted client-side).
    const list = Array.isArray(req.body.transactions) ? req.body.transactions : [];
    const added = [];
    for (const t of list) {
      if (!t.date || !t.description || !Number.isInteger(t.amount)) throw Object.assign(new Error('each transaction needs date, description and integer amount (minor units)'), { status: 400 });
      added.push(s.store.insert('transactions', { householdId: req.householdId, date: t.date, description: String(t.description), category: t.category ?? 'uncategorized', amount: t.amount }));
    }
    s.audit.log('user', 'wealth.import', { count: added.length });
    for (const t of added) s.automations.emit('wealth.transaction_imported', { transaction: t }).catch(() => {});
    return { imported: added.length };
  });

  // --- productivity ---
  r('GET', '/api/tasks', () => s.productivity.listTasks({ open: false }));
  r('POST', '/api/tasks', (req) => s.productivity.createTask(req.body));
  r('POST', '/api/tasks/:id/complete', (req, p) => s.productivity.completeTask(p.id));
  r('DELETE', '/api/tasks/:id', (req, p) => ({ deleted: s.store.remove('tasks', p.id) }));
  r('GET', '/api/events', (req) => s.productivity.listEvents({ from: req.query.get('from') ?? undefined, to: req.query.get('to') ?? undefined }));
  r('POST', '/api/events', (req) => s.productivity.createEvent(req.body));
  r('GET', '/api/reminders', () => s.store.all('reminders', (x) => !x.fired));
  r('GET', '/api/briefing/daily', async (req) => (await s.tools['briefing.daily'].run({}, ctx(req))).data);
  r('GET', '/api/briefing/weekly', async (req) => (await s.tools['briefing.weekly'].run({}, ctx(req))).data);
  r('GET', '/api/proactive', async (req) => scan({ ...s, ctx: ctx(req), prefs: s.store.getMeta('proactive', {}) }));
  r('GET', '/api/briefing/daily/:lang', async (req, p) => (await s.tools['briefing.daily'].run({}, { ...ctx(req), lang: p.lang === 'he' ? 'he' : 'en' })).data);

  // --- smart home ---
  r('GET', '/api/home/devices', () => s.home.devices());
  r('POST', '/api/home/command', (req) => s.core.handle(String(req.body.text), { householdId: req.householdId, conversationId: 'home' }));

  // --- automations ---
  r('GET', '/api/automations', () => s.automations.list());
  r('POST', '/api/automations', (req) => s.automations.create(req.body));
  r('POST', '/api/automations/from-text', (req) => {
    const wf = workflowFromText(String(req.body.text ?? ''), s.tools, s.policy);
    if (req.body.preview) return wf;
    return s.automations.create(wf);
  });
  r('PATCH', '/api/automations/:id', (req, p) => s.automations.update(p.id, req.body));
  r('DELETE', '/api/automations/:id', (req, p) => ({ deleted: s.automations.delete(p.id) }));
  r('POST', '/api/automations/:id/run', (req, p) => s.automations.run(p.id, req.body ?? {}));
  r('GET', '/api/automations/runs', (req) => s.automations.runs(req.query.get('workflowId') ?? undefined));
  r('POST', '/api/automations/runs/:id/approve', (req, p) => s.automations.approve(p.id, req.body.decision ?? 'approve'));
  r('POST', '/api/automations/runs/:id/cancel', (req, p) => s.automations.cancel(p.id));
  r('GET', '/api/tools', () => Object.values(s.tools).map((t) => ({ name: t.name, desc: t.desc, risk: typeof t.risk === 'function' ? 'dynamic' : t.risk })));

  // --- notifications ---
  r('GET', '/api/notifications', (req) => s.notifications.list({ unread: req.query.get('unread') === '1' }));
  r('POST', '/api/notifications/:id/read', (req, p) => s.notifications.markRead(p.id));
  r('GET', '/api/notifications/prefs', () => s.notifications.prefs());
  r('PUT', '/api/notifications/prefs', (req) => s.notifications.setPrefs(req.body));

  // --- security ---
  r('GET', '/api/security/audit', () => s.audit.list(300));
  r('GET', '/api/security/policy', () => s.policy.settings());
  r('PUT', '/api/security/policy', (req) => { s.policy.set(req.body.risk, req.body.mode); s.audit.log(req.actor, 'policy.change', { risk: req.body.risk, mode: req.body.mode }); return s.policy.settings(); });

  // --- integrations ---
  r('GET', '/api/integrations', () => [
    { id: 'anthropic', name: 'Claude (Anthropic)', category: 'AI providers', auth: 'API key (env)', status: s.router.providers.anthropic ? 'connected' : 'not_configured', permissions: ['text', 'vision', 'web search'] },
    { id: 'local', name: 'Local engine', category: 'AI providers', auth: 'none', status: 'connected', permissions: ['commands', 'memory'] },
    { id: 'home_assistant', name: 'Home Assistant', category: 'Smart home', auth: 'Long-lived token (env HA_URL/HA_TOKEN)', status: s.home.kind === 'home_assistant' ? 'connected' : 'demo', permissions: ['devices', 'services'] },
    { id: 'family_wealth_os', name: 'Family Wealth OS', category: 'Financial platforms', auth: 'Shared identity, household scope', status: s.store.all('transactions', (t) => !t.demo).length ? 'connected' : 'demo', permissions: ['read accounts', 'read transactions', 'analysis'] },
    { id: 'desktop_bridge', name: 'Desktop bridge', category: 'Computer control', auth: 'Bearer token + local allow-list', status: s.bridge.connected() ? 'connected' : 'disconnected', permissions: s.bridge.info?.capabilities ?? [], lastSeen: s.bridge.lastSeen ? new Date(s.bridge.lastSeen).toISOString() : null },
    { id: 'calendar', name: 'Google / Microsoft calendar', category: 'Calendar', auth: 'OAuth 2.0', status: 'available', permissions: [] },
    { id: 'email', name: 'Email (SMTP / Gmail)', category: 'Email', auth: 'OAuth 2.0', status: 'available', permissions: [] },
  ]);

  // --- desktop bridge protocol ---
  r('POST', '/api/bridge/poll', (req) => { s.bridge.heartbeat(req.body.info); return { commands: s.bridge.take() }; }, 'bridge');
  r('POST', '/api/bridge/result/:id', (req, p) => ({ accepted: s.bridge.result(p.id, req.body) }), 'bridge');

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

    // Credentials: the owner token (full access) or a per-device token (scoped, revocable).
    const auth = (header) => {
      if (checkToken(token, header)) return { actor: 'user', device: null };
      const d = s.devices.authenticate(String(header ?? '').replace(/^Bearer\s+/i, ''));
      return d ? { actor: `device:${d.kind}:${d.id}`, device: d } : null;
    };
    if (url.pathname === '/api/stream') {
      const who = auth(`Bearer ${url.searchParams.get('token')}`);
      if (!who) return send(res, 401, { error: 'unauthorized' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const on = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      bus.on('event', on);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => { bus.off('event', on); clearInterval(ka); });
      return;
    }
    const t0 = Date.now();
    const done = (status, body) => { s.metrics.request(url.pathname, status, Date.now() - t0); send(res, status, body); };
    let who = { actor: 'anonymous', device: null };
    if (url.pathname !== '/api/health') {
      who = auth(req.headers.authorization);
      if (!who) return done(401, { error: 'unauthorized' });
      // Rate limit per credential: 300 requests per rolling minute.
      const key = who.device?.id ?? 'owner'; const nowMs = Date.now();
      const hits = (rate.get(key) ?? []).filter((x) => nowMs - x < 60e3); hits.push(nowMs); rate.set(key, hits);
      if (hits.length > (opts.rateLimit ?? 300)) return done(429, { error: 'rate limit exceeded' });
    }
    const route = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!route) return done(404, { error: 'not found' });
    if (who.device && !s.devices.allowed(who.device, route.scope)) return done(403, { error: `device scope does not allow this endpoint (${route.scope})` });
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) throw Object.assign(new Error('payload too large'), { status: 413 }); }
      req.body = raw ? JSON.parse(raw) : {};
      req.query = url.searchParams;
      req.householdId = s.householdId; // single-household install; multi-tenant deployments resolve this from the session
      req.actor = who.actor; req.device = who.device;
      const out = await route.fn(req, url.pathname.match(route.re).groups ?? {});
      done(200, out ?? null);
    } catch (e) {
      done(e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message });
    }
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(p, res) {
  const file = path.resolve(WEB, `.${p === '/' ? '/index.html' : decodeURIComponent(p)}`);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataFile = process.env.JARVIS_DATA ?? path.resolve(here, '../data/jarvis.json');
  const s = await createApp({ file: dataFile });
  const token = resolveToken(s.store);
  startScheduler(s);
  const host = process.env.JARVIS_HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 7777);
  createServer(s, token).listen(port, host, () => {
    console.log(`J.A.R.V.I.S online at http://${host}:${port}`);
    console.log(`AI providers: ${s.router.status().map((p) => p.provider).join(', ')} | smart home: ${s.home.kind}`);
    console.log(`Access token (paste into the web app once): ${token}`);
  });
}
