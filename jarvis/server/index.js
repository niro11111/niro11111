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

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../web');

export function createServer(s, token) {
  const routes = [];
  const r = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
  const ctx = (req) => ({ actor: 'user', householdId: req.householdId, month: req.query.get('month') ?? undefined });

  r('GET', '/api/health', () => ({ ok: true, name: 'J.A.R.V.I.S', version: '0.1.0' }));
  r('GET', '/api/status', () => ({
    providers: s.router.status(), route: { voice: s.router.route({ latency: 'realtime' }), deep: s.router.route({ complexity: 'high' }) },
    home: s.home.kind, bridge: { connected: !!s.bridge.connected(), info: s.bridge.info },
    pendingApprovals: s.store.all('approvals', (a) => a.status === 'pending').length,
    demoData: s.store.all('transactions', (t) => t.demo).length > 0,
  }));

  // --- JARVIS CORE ---
  r('POST', '/api/command', (req) => s.core.handle(String(req.body.text ?? ''), { conversationId: req.body.conversationId, channel: req.body.channel ?? 'text', householdId: req.householdId }));
  r('GET', '/api/tasks/exec', () => s.store.all('tasks_exec').slice(-50).reverse().map(({ plan, ...t }) => ({ ...t, steps: plan?.steps.map((x) => ({ n: x.n, tool: x.tool, agent: x.agent, status: x.status, verified: x.verified })) })));
  r('GET', '/api/tasks/exec/:id', (req, p) => s.store.get('tasks_exec', p.id));
  r('POST', '/api/tasks/exec/:id/cancel', (req, p) => s.core.cancel(p.id));
  r('GET', '/api/approvals', () => s.store.all('approvals', (a) => a.status === 'pending'));
  r('POST', '/api/approvals/:id', (req, p) => s.core.decide(p.id, req.body.decision === 'approve' ? 'approve' : 'reject'));
  r('GET', '/api/agents', () => AGENTS.map((a) => ({ ...a, activeTasks: s.store.all('tasks_exec', (t) => ['EXECUTING', 'AWAITING_APPROVAL', 'VERIFYING'].includes(t.state) && t.plan?.agents.includes(a.id)).length })));
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

  // --- smart home ---
  r('GET', '/api/home/devices', () => s.home.devices());
  r('POST', '/api/home/command', (req) => s.core.handle(String(req.body.text), { householdId: req.householdId, conversationId: 'home' }));

  // --- automations ---
  r('GET', '/api/automations', () => s.automations.list());
  r('POST', '/api/automations', (req) => s.automations.create(req.body));
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
  r('PUT', '/api/security/policy', (req) => { s.policy.set(req.body.risk, req.body.mode); return s.policy.settings(); });

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
  r('POST', '/api/bridge/poll', (req) => { s.bridge.heartbeat(req.body.info); return { commands: s.bridge.take() }; });
  r('POST', '/api/bridge/result/:id', (req, p) => ({ accepted: s.bridge.result(p.id, req.body) }));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

    if (url.pathname === '/api/stream') {
      if (!checkToken(token, `Bearer ${url.searchParams.get('token')}`)) return send(res, 401, { error: 'unauthorized' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const on = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      bus.on('event', on);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => { bus.off('event', on); clearInterval(ka); });
      return;
    }
    if (url.pathname !== '/api/health' && !checkToken(token, req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });

    const route = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!route) return send(res, 404, { error: 'not found' });
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) throw Object.assign(new Error('payload too large'), { status: 413 }); }
      req.body = raw ? JSON.parse(raw) : {};
      req.query = url.searchParams;
      req.householdId = s.householdId; // single-household install; multi-tenant deployments resolve this from the session
      const out = await route.fn(req, url.pathname.match(route.re).groups ?? {});
      send(res, 200, out ?? null);
    } catch (e) {
      send(res, e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message });
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
