// Real external integrations. Every connector talks to the real service's public API; nothing is
// simulated. A connector's status comes only from what actually happened:
//   not_configured - credentials or settings are missing
//   configured     - settings saved, never tested (or the service has no test call)
//   connected      - the last real test call succeeded (with the time and what it returned)
//   failed         - the last real call failed (with the service's own error)
// Secrets (tokens) are stored server-side, are never returned by the API (only a masked hint)
// and environment variables override stored values (TELEGRAM_BOT_TOKEN, MAKE_API_TOKEN, AIRTABLE_TOKEN).
import { randomBytes } from 'node:crypto';

const SECRET_KEYS = { telegram: ['botToken'], make: ['apiToken'], airtable: ['token'] };
const ENV = { 'telegram.botToken': 'TELEGRAM_BOT_TOKEN', 'make.apiToken': 'MAKE_API_TOKEN', 'airtable.token': 'AIRTABLE_TOKEN' };
const env = (k) => (typeof process !== 'undefined' ? process.env?.[ENV[k]] : undefined);
const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
const WIKI_UA = 'JARVIS-personal-assistant/1.0 (self-hosted; Wikimedia API client)';
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const DEFAULT_FEEDS = [
  { name: 'ynet', url: 'https://www.ynet.co.il/Integration/StoryRss2.xml' },
  { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
];

export const CONNECTORS = {
  make: { name: 'Make', category: 'Automation', fields: ['zone', 'teamId', 'apiToken', 'webhooks'], docs: 'Make → Profile → API access → Add token (scopes: scenarios:read, scenarios:run). Webhooks: a scenario that starts with "Custom webhook".' },
  telegram: { name: 'Telegram', category: 'Messaging', fields: ['botToken', 'chatId', 'forwardNotifications'], docs: 'Telegram → @BotFather → /newbot → copy the token. Then send /start to your bot and press "Find my chat".' },
  airtable: { name: 'Airtable', category: 'Data', fields: ['token', 'baseId', 'table'], docs: 'airtable.com/create/tokens → scopes data.records:read, data.records:write, schema.bases:read → access to your base.' },
  fx: { name: 'Exchange rates (Frankfurter / ECB)', category: 'Knowledge', fields: [], keyless: true, docs: 'No key needed. Daily reference rates of the European Central Bank.' },
  wikipedia: { name: 'Wikipedia', category: 'Knowledge', fields: [], keyless: true, docs: 'No key needed. Hebrew and English Wikipedia.' },
  news: { name: 'News (RSS)', category: 'Knowledge', fields: ['feeds'], keyless: true, docs: 'No key needed. Any RSS feed; ynet and BBC are preset.' },
  weather: { name: 'Weather (Open-Meteo)', category: 'Knowledge', fields: [], keyless: true, docs: 'No key needed. Location is set in Preferences.' },
  inbound: { name: 'Incoming webhook (to JARVIS)', category: 'Automation', fields: [], docs: 'Lets Make or any service POST to JARVIS: notify, add a task or a note. Needs the JARVIS server reachable from the internet (for example through a tunnel).' },
};

const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
/** Minimal RSS/Atom item parser (titles, links, dates). */
export function parseFeed(xml, limit = 8) {
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi; let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const b = m[0];
    const title = decode(b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    const link = decode(b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]) || b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
    const date = decode(b.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i)?.[2]);
    if (title) items.push({ title, link, date });
  }
  return items;
}

export class Integrations {
  constructor(s) { this.s = s; this.fetch = (...a) => (s.fetch ?? globalThis.fetch)(...a); }

  // ---------- configuration ----------
  raw(id) { return this.s.store.getMeta(`integration:${id}`, {}); }
  secret(id, key) { return env(`${id}.${key}`) || this.raw(id)[key] || ''; }
  cfg(id) { const c = { ...this.raw(id) }; for (const k of SECRET_KEYS[id] ?? []) c[k] = this.secret(id, k); return c; }
  state(id) { return this.s.store.getMeta(`integration_state:${id}`, null); }
  record(id, ok, detail) { const st = { ok, at: new Date().toISOString(), detail: String(detail ?? '').slice(0, 300) }; this.s.store.setMeta(`integration_state:${id}`, st); return st; }

  configured(id) {
    const c = this.cfg(id);
    switch (id) {
      case 'make': return !!(c.apiToken || c.webhooks?.length);
      case 'telegram': return !!(c.botToken && c.chatId);
      case 'airtable': return !!(c.token && c.baseId);
      case 'inbound': return !!c.token;
      default: return true;
    }
  }
  status(id) {
    const st = this.state(id);
    if (!this.configured(id)) return CONNECTORS[id].keyless ? (st ? (st.ok ? 'connected' : 'failed') : 'configured') : 'not_configured';
    return st ? (st.ok ? 'connected' : 'failed') : 'configured';
  }
  publicCfg(id) {
    const c = this.raw(id); const out = { ...c };
    for (const k of SECRET_KEYS[id] ?? []) { out[k] = undefined; out[`${k}Set`] = !!this.secret(id, k); out[`${k}Hint`] = mask(this.secret(id, k)); out[`${k}FromEnv`] = !!env(`${id}.${k}`); }
    if (id === 'inbound') { out.token = undefined; out.path = c.token ? `/api/hooks/in/${c.token}` : null; }
    if (id === 'news') out.feeds = c.feeds?.length ? c.feeds : DEFAULT_FEEDS;
    return out;
  }
  list() {
    return Object.entries(CONNECTORS).map(([id, d]) => ({ id, ...d, status: this.status(id), last: this.state(id), config: this.publicCfg(id) }));
  }
  configure(id, body = {}, actor = 'user') {
    const d = CONNECTORS[id]; if (!d) throw err(`unknown integration ${id}`, 404);
    const cur = this.raw(id); const next = { ...cur };
    for (const f of d.fields) {
      if (!(f in body)) continue;
      const v = body[f];
      if ((SECRET_KEYS[id] ?? []).includes(f)) { if (v === '' || v === null) delete next[f]; else if (typeof v === 'string' && !v.startsWith('••••')) next[f] = v.trim(); continue; }
      next[f] = v;
    }
    if (id === 'make') {
      if (next.zone && !/^[a-z]{2}\d$/.test(next.zone)) throw err('zone looks like eu1, eu2, us1 or us2');
      next.webhooks = (next.webhooks ?? []).filter((w) => w?.url).map((w) => ({ name: String(w.name || 'webhook').trim().slice(0, 40), url: this.safeUrl(w.url) }));
    }
    if (id === 'telegram') { if (next.botToken && !/^\d{5,}:[\w-]{20,}$/.test(next.botToken)) throw err('this does not look like a Telegram bot token (123456:ABC…)'); next.forwardNotifications = !!next.forwardNotifications; }
    if (id === 'airtable' && next.baseId && !/^app\w{10,}$/.test(next.baseId)) throw err('the base id starts with "app" (from the base URL)');
    if (id === 'news') next.feeds = (Array.isArray(next.feeds) ? next.feeds : []).filter((f) => f?.url).slice(0, 10).map((f) => ({ name: String(f.name || 'feed').slice(0, 30), url: this.safeUrl(f.url) }));
    this.s.store.setMeta(`integration:${id}`, next);
    this.s.store.setMeta(`integration_state:${id}`, null);
    if (id === 'telegram' && 'forwardNotifications' in body) { // the Telegram notification channel follows the switch
      const ch = this.s.notifications.prefs().channels.filter((c) => c !== 'telegram');
      this.s.notifications.setPrefs({ channels: next.forwardNotifications ? [...ch, 'telegram'] : ch });
    }
    this.s.audit.log(actor, 'integration.configure', { id, fields: Object.keys(body).filter((k) => d.fields.includes(k)) });
    return this.list().find((x) => x.id === id);
  }
  disconnect(id, actor = 'user') {
    if (!CONNECTORS[id]) throw err(`unknown integration ${id}`, 404);
    this.s.store.setMeta(`integration:${id}`, {}); this.s.store.setMeta(`integration_state:${id}`, null);
    this.s.audit.log(actor, 'integration.disconnect', { id });
    return { id, status: this.status(id) };
  }
  safeUrl(u) {
    let url; try { url = new URL(String(u).trim()); } catch { throw err(`invalid URL: ${u}`); }
    if (url.protocol !== 'https:') throw err('only https:// URLs are allowed');
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)|^\[|\.local$|\.internal$/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) throw err('private network addresses are not allowed');
    return url.toString();
  }

  // ---------- HTTP ----------
  async http(url, { method = 'GET', headers = {}, body, timeout = 10000, as = 'json' } = {}) {
    let r;
    try {
      r = await this.fetch(url, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      throw err(e.name === 'TimeoutError' ? 'the service did not answer in time' : `cannot reach ${new URL(url).hostname} (${e.message}). In claude.ai or a page opened from disk, outside calls may be blocked: run the JARVIS server.`, 502);
    }
    const text = await r.text();
    let data = text; if (as === 'json') { try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ } }
    if (!r.ok) {
      const msg = data?.description ?? data?.error?.message ?? data?.message ?? data?.detail ?? (typeof data?.error === 'string' ? data.error : null) ?? String(text).slice(0, 160);
      throw err(`${new URL(url).hostname} ${r.status}: ${msg}`, r.status === 401 || r.status === 403 ? 401 : 502);
    }
    return data;
  }
  async tracked(id, fn) {
    try { const out = await fn(); this.record(id, true, out?.detail ?? 'ok'); return out; }
    catch (e) { this.record(id, false, e.message); throw e; }
  }

  // ---------- tests: one real, harmless call per service ----------
  async test(id) {
    switch (id) {
      case 'make': {
        const c = this.cfg('make');
        if (!c.apiToken) { if (c.webhooks?.length) return { ok: true, status: 'configured', detail: 'Webhooks are saved. Calling one runs your scenario, so it is not called as a test. Use "Send test" next to a webhook.' }; throw err('add an API token or a webhook first'); }
        return this.tracked('make', async () => { const me = await this.makeApi('/users/me'); const u = me?.authUser ?? me?.user ?? me; return { ok: true, detail: `signed in as ${u?.name ?? u?.email ?? 'Make user'}` }; });
      }
      case 'telegram': {
        const c = this.cfg('telegram'); if (!c.botToken) throw err('add the bot token first');
        return this.tracked('telegram', async () => { const me = await this.tg('getMe'); return { ok: true, detail: `bot @${me.username}${c.chatId ? `, chat ${c.chatId}` : ' (no chat yet: send /start to the bot and press "Find my chat")'}` }; });
      }
      case 'airtable': {
        const c = this.cfg('airtable'); if (!c.token) throw err('add the Airtable token first');
        return this.tracked('airtable', async () => {
          const r = await this.http('https://api.airtable.com/v0/meta/bases', { headers: { authorization: `Bearer ${c.token}` } });
          const bases = (r.bases ?? []).map((b) => ({ id: b.id, name: b.name }));
          return { ok: true, bases, detail: `${bases.length} base(s): ${bases.map((b) => b.name).join(', ').slice(0, 200)}` };
        });
      }
      case 'fx': return this.tracked('fx', async () => { const r = await this.fxRate({ from: 'USD', to: 'ILS' }); return { ok: true, detail: `1 USD = ${r.rate} ILS (${r.date})` }; });
      case 'wikipedia': return this.tracked('wikipedia', async () => { const r = await this.wiki({ query: 'ירושלים', lang: 'he' }); return { ok: true, detail: `"${r.title}" found` }; });
      case 'news': return this.tracked('news', async () => { const r = await this.headlines({ limit: 3 }); return { ok: true, detail: `${r.items.length} headlines from ${r.sources.filter((x) => x.ok).map((x) => x.name).join(', ')}` }; });
      case 'weather': return this.tracked('weather', async () => { const w = await this.s.weather.current(); if (!w.available) throw err(w.reason, 502); return { ok: true, detail: `${w.location}: ${w.temperature}°` }; });
      case 'inbound': return { ok: this.configured('inbound'), status: this.status('inbound'), detail: this.configured('inbound') ? 'POST JSON to the URL shown to try it.' : 'create the incoming URL first' };
      default: throw err(`unknown integration ${id}`, 404);
    }
  }

  // ---------- Make ----------
  makeBase() { const c = this.cfg('make'); return `https://${c.zone || 'eu1'}.make.com/api/v2`; }
  makeApi(path, opts = {}) {
    const c = this.cfg('make'); if (!c.apiToken) throw err('Make API token is not set (Integrations → Make)', 409);
    return this.http(this.makeBase() + path, { ...opts, headers: { authorization: `Token ${c.apiToken}` }, timeout: opts.timeout ?? 40000 });
  }
  async makeScenarios() {
    const c = this.cfg('make'); if (!c.teamId) throw err('set the Make team id (Integrations → Make)', 409);
    return this.tracked('make', async () => {
      const r = await this.makeApi(`/scenarios?teamId=${encodeURIComponent(c.teamId)}&pg[limit]=50`);
      const list = (r.scenarios ?? []).map((x) => ({ id: x.id, name: x.name, active: !!x.isActive, scheduling: x.scheduling?.type ?? null, lastEdit: x.lastEdit }));
      return { scenarios: list, detail: `${list.length} scenario(s)` };
    });
  }
  async makeRun({ scenario, data } = {}) {
    let id = Number(scenario);
    if (!Number.isFinite(id) || id <= 0) {
      const { scenarios } = await this.makeScenarios();
      const q = String(scenario ?? '').toLowerCase().trim();
      const hit = scenarios.find((x) => x.name.toLowerCase() === q) ?? scenarios.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()));
      if (!hit) throw err(`no Make scenario matches "${scenario}". Available: ${scenarios.map((x) => x.name).join(', ') || 'none'}`, 404);
      id = hit.id;
    }
    return this.tracked('make', async () => {
      const r = await this.makeApi(`/scenarios/${id}/run`, { method: 'POST', body: { responsive: true, ...(data ? { data } : {}) }, timeout: 45000 });
      return { scenarioId: id, executionId: r.executionId ?? null, status: r.status ?? null, outputs: r.outputs ?? null, detail: `scenario ${id} ran (execution ${r.executionId ?? '?'}, status ${r.status ?? 'queued'})` };
    });
  }
  async makeWebhook({ name, payload = {} } = {}) {
    const hooks = this.cfg('make').webhooks ?? [];
    if (!hooks.length) throw err('no Make webhooks are saved (Integrations → Make)', 409);
    const q = String(name ?? '').toLowerCase().trim();
    const h = hooks.find((w) => w.name.toLowerCase() === q) ?? hooks.find((w) => q && (w.name.toLowerCase().includes(q) || q.includes(w.name.toLowerCase()))) ?? (hooks.length === 1 ? hooks[0] : null);
    if (!h) throw err(`which webhook? Saved: ${hooks.map((w) => w.name).join(', ')}`, 404);
    return this.tracked('make', async () => {
      const r = await this.http(h.url, { method: 'POST', body: { source: 'jarvis', sentAt: new Date().toISOString(), ...payload }, as: 'text', timeout: 20000 });
      return { webhook: h.name, response: String(r ?? '').slice(0, 500), detail: `webhook "${h.name}" accepted (${String(r ?? '').slice(0, 40) || 'ok'})` };
    });
  }

  // ---------- Telegram ----------
  async tg(method, body) {
    const tok = this.secret('telegram', 'botToken'); if (!tok) throw err('Telegram bot token is not set (Integrations → Telegram)', 409);
    const r = await this.http(`https://api.telegram.org/bot${tok}/${method}`, { method: body ? 'POST' : 'GET', body });
    if (!r?.ok) throw err(`Telegram: ${r?.description ?? 'error'}`, 502);
    return r.result;
  }
  async telegramFindChat() {
    const ups = await this.tg('getUpdates', { limit: 20, allowed_updates: ['message'] });
    const chats = [...new Map(ups.filter((u) => u.message?.chat).map((u) => [u.message.chat.id, u.message.chat])).values()];
    if (!chats.length) throw err('no messages yet: open your bot in Telegram, press Start (or send any message), then try again', 404);
    const chat = chats[chats.length - 1];
    this.configure('telegram', { chatId: String(chat.id) });
    return { chatId: String(chat.id), name: chat.first_name ?? chat.title ?? chat.username ?? '' };
  }
  async telegramSend({ text }) {
    const c = this.cfg('telegram'); if (!c.chatId) throw err('Telegram chat is not set: send /start to your bot and press "Find my chat"', 409);
    const body = String(text ?? '').trim().slice(0, 4000); if (!body) throw err('nothing to send');
    return this.tracked('telegram', async () => { const m = await this.tg('sendMessage', { chat_id: c.chatId, text: body }); return { messageId: m.message_id, chatId: c.chatId, detail: `message ${m.message_id} delivered` }; });
  }
  /** Notification channel: forwards JARVIS notifications to Telegram when enabled. */
  notificationSender() {
    return async ({ title, body, priority }) => {
      const c = this.cfg('telegram');
      if (!c.forwardNotifications || !c.botToken || !c.chatId) throw err('not_configured');
      await this.telegramSend({ text: `${priority === 'high' || priority === 'critical' ? '❗ ' : ''}${title}${body ? `\n${body}` : ''}` });
    };
  }

  // ---------- Airtable ----------
  airtableCfg() { const c = this.cfg('airtable'); if (!c.token || !c.baseId) throw err('Airtable is not set up (Integrations → Airtable)', 409); if (!c.table) throw err('choose the Airtable table (Integrations → Airtable)', 409); return c; }
  async airtableTables() {
    const c = this.cfg('airtable'); if (!c.token || !c.baseId) throw err('add the token and base first', 409);
    const r = await this.http(`https://api.airtable.com/v0/meta/bases/${c.baseId}/tables`, { headers: { authorization: `Bearer ${c.token}` } });
    return (r.tables ?? []).map((tb) => ({ id: tb.id, name: tb.name, primary: tb.fields?.find((f) => f.id === tb.primaryFieldId)?.name ?? tb.fields?.[0]?.name, fields: (tb.fields ?? []).map((f) => ({ name: f.name, type: f.type })) }));
  }
  async airtableList({ limit = 20 } = {}) {
    const c = this.airtableCfg();
    return this.tracked('airtable', async () => {
      const r = await this.http(`https://api.airtable.com/v0/${c.baseId}/${encodeURIComponent(c.table)}?maxRecords=${Math.min(100, limit)}`, { headers: { authorization: `Bearer ${c.token}` } });
      const records = (r.records ?? []).map((x) => ({ id: x.id, fields: x.fields, created: x.createdTime }));
      return { records, detail: `${records.length} record(s)` };
    });
  }
  async airtableCreate({ text, fields } = {}) {
    const c = this.airtableCfg();
    let f = fields;
    if (!f) {
      const tables = await this.airtableTables();
      const tb = tables.find((x) => x.id === c.table || x.name === c.table);
      f = { [tb?.primary ?? 'Name']: String(text ?? '').slice(0, 500) };
    }
    return this.tracked('airtable', async () => {
      const r = await this.http(`https://api.airtable.com/v0/${c.baseId}/${encodeURIComponent(c.table)}`, { method: 'POST', headers: { authorization: `Bearer ${c.token}` }, body: { records: [{ fields: f }], typecast: true } });
      const rec = r.records?.[0];
      return { id: rec?.id, fields: rec?.fields, detail: `record ${rec?.id} created` };
    });
  }
  async airtableVerify(id) {
    const c = this.airtableCfg();
    const r = await this.http(`https://api.airtable.com/v0/${c.baseId}/${encodeURIComponent(c.table)}/${id}`, { headers: { authorization: `Bearer ${c.token}` } });
    return r?.id === id;
  }

  // ---------- keyless knowledge ----------
  async fxRate({ from = 'USD', to = 'ILS', amount = 1 } = {}) {
    const F = String(from).toUpperCase(); const T = String(to).toUpperCase();
    if (!/^[A-Z]{3}$/.test(F) || !/^[A-Z]{3}$/.test(T)) throw err('currencies are 3-letter codes, e.g. USD, EUR, ILS');
    if (F === T) return { from: F, to: T, rate: 1, amount, value: amount, date: new Date().toISOString().slice(0, 10), source: 'identity' };
    const r = await this.http(`https://api.frankfurter.dev/v1/latest?from=${F}&to=${T}`);
    const rate = r?.rates?.[T]; if (!rate) throw err(`no rate for ${F}→${T}`, 404);
    this.record('fx', true, `1 ${F} = ${rate} ${T}`);
    return { from: F, to: T, rate, amount: Number(amount), value: Math.round(Number(amount) * rate * 100) / 100, date: r.date, source: 'frankfurter.dev (European Central Bank)' };
  }
  async wiki({ query, lang } = {}) {
    const q = String(query ?? '').trim(); if (!q) throw err('what should I look up?');
    const l = lang ?? (/[֐-׿]/.test(q) ? 'he' : 'en');
    const base = `https://${l}.wikipedia.org`;
    const headers = { 'api-user-agent': WIKI_UA, ...(typeof window === 'undefined' ? { 'user-agent': WIKI_UA } : {}) }; // Wikimedia API policy
    const s = await this.http(`${base}/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json&origin=*`, { headers });
    const title = s?.[1]?.[0]; if (!title) throw err(l === 'he' ? `לא נמצא ערך בוויקיפדיה עבור "${q}"` : `no Wikipedia article for "${q}"`, 404);
    const p = await this.http(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers });
    this.record('wikipedia', true, `"${p.title}"`);
    return { title: p.title, extract: p.extract, url: p.content_urls?.desktop?.page ?? `${base}/wiki/${encodeURIComponent(title)}`, lang: l, source: `${l}.wikipedia.org` };
  }
  async headlines({ limit = 6, source } = {}) {
    let feeds = this.publicCfg('news').feeds;
    if (source) { const f = feeds.filter((x) => x.name.toLowerCase().includes(String(source).toLowerCase())); if (f.length) feeds = f; }
    const per = Math.max(2, Math.ceil(limit / feeds.length));
    const results = await Promise.all(feeds.map(async (f) => {
      try { const xml = await this.http(f.url, { as: 'text', timeout: 8000 }); return { name: f.name, ok: true, items: parseFeed(String(xml), per).map((i) => ({ ...i, source: f.name })) }; }
      catch (e) { return { name: f.name, ok: false, error: e.message, items: [] }; }
    }));
    const items = results.flatMap((r) => r.items).slice(0, limit);
    if (!items.length) { const e = results.map((r) => `${r.name}: ${r.error}`).join('; '); this.record('news', false, e); throw err(`no headlines (${e})`, 502); }
    this.record('news', true, `${items.length} headlines`);
    return { items, sources: results.map(({ name, ok, error }) => ({ name, ok, error })) };
  }

  // ---------- incoming webhook ----------
  inboundCreate(actor = 'user') {
    const token = randomBytes(18).toString('hex');
    this.s.store.setMeta('integration:inbound', { token, created: new Date().toISOString() });
    this.s.audit.log(actor, 'integration.inbound.create', {});
    return this.publicCfg('inbound');
  }
  inboundCheck(token) { const t = this.raw('inbound').token; return !!t && typeof token === 'string' && token.length === t.length && token === t; }
  /** What an incoming call may do: notify, add a task, add a note. Never commands, money or devices. */
  async inboundHandle(body = {}) {
    const action = String(body.action ?? 'notify');
    const text = String(body.text ?? body.message ?? body.title ?? '').trim().slice(0, 2000);
    if (!text) throw err('text is required');
    this.s.audit.log('webhook', `integration.inbound.${action}`, { chars: text.length });
    this.record('inbound', true, `${action}: ${text.slice(0, 60)}`);
    if (action === 'notify') return { ok: true, notification: (await this.s.notifications.send({ title: text.slice(0, 120), body: String(body.body ?? '').slice(0, 1000), priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal', event: 'webhook' }))?.id ?? null };
    if (action === 'task') return { ok: true, task: this.s.productivity.createTask({ title: text }).id };
    if (action === 'note') return { ok: true, note: this.s.productivity.addNote({ text, tags: ['webhook'] })?.id ?? null };
    throw err('action must be notify, task or note');
  }
}
