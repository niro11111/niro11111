// More real connectors, installed into the Integrations hub:
//   hebcal  - Shabbat times, Jewish holidays, Hebrew date (hebcal.com, no key)
//   crypto  - cryptocurrency prices (CoinGecko public API, no key)
//   ntfy    - push notifications to your phone through the free ntfy app (ntfy.sh or your own server)
//   ical    - your real calendar (Google / Outlook / Apple "secret iCal address"), synced into JARVIS
//   github  - your open issues, notifications, and creating an issue (personal access token)

export const MORE_CONNECTORS = {
  hebcal: { name: 'Shabbat & holidays (Hebcal)', category: 'Knowledge', fields: [], keyless: true, docs: 'No key needed. Uses the location from Preferences (the same as the weather).' },
  crypto: { name: 'Crypto prices (CoinGecko)', category: 'Knowledge', fields: [], keyless: true, docs: 'No key needed. Public CoinGecko prices in ILS and USD with the 24-hour change.' },
  ntfy: { name: 'Phone push (ntfy)', category: 'Messaging', fields: ['server', 'topic', 'accessToken', 'forwardNotifications'], docs: 'Install the free "ntfy" app (Android/iPhone), subscribe to a hard-to-guess topic name, and enter the same topic here. ntfy.sh topics are public to anyone who knows the name: use a long random one, or your own ntfy server with an access token.' },
  ical: { name: 'Calendar (iCal feed)', category: 'Productivity', fields: ['url'], docs: 'Google Calendar → Settings → your calendar → "Secret address in iCal format". Outlook: Settings → Calendar → Shared calendars → Publish → ICS. JARVIS reads it (read-only) and syncs the next 60 days every 30 minutes.' },
  github: { name: 'GitHub', category: 'Development', fields: ['token', 'repo'], docs: 'github.com/settings/personal-access-tokens → fine-grained token with Issues: read/write (and Notifications for the count). Default repository as owner/name.' },
};
export const MORE_SECRETS = { ntfy: ['accessToken'], ical: ['url'], github: ['token'] };
export const MORE_ENV = { 'github.token': 'GITHUB_TOKEN', 'ntfy.accessToken': 'NTFY_TOKEN' };

const COINS = [[/ביטקוין|bitcoin|btc/i, 'bitcoin'], [/את'?ריום|אית'?ריום|ethereum|eth\b/i, 'ethereum'], [/סולאנה|solana|sol\b/i, 'solana'], [/דוג'?קוין|dogecoin|doge/i, 'dogecoin'], [/ריפל|xrp|ripple/i, 'ripple'], [/קרדנו|cardano|ada\b/i, 'cardano'], [/טת'?ר|tether|usdt/i, 'tether'], [/bnb|בינאנס/i, 'binancecoin']];
export const coinsIn = (text) => [...new Set(COINS.filter(([re]) => re.test(text ?? '')).map(([, id]) => id))];

// ---------- iCalendar (RFC 5545) ----------
const unfold = (s) => String(s).replace(/\r?\n[ \t]/g, '');
const icsText = (v) => String(v ?? '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
/** Parses an iCal date-time. Floating and TZID times are read as local time of the server. */
export function icsDate(v, params = '') {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || /VALUE=DATE(?!-)/.test(params)) return { date: new Date(+y, +mo - 1, +d), allDay: true };
  return { date: z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))) : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
}
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** Events in [from, to): simple recurrence (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, weekly BYDAY, EXDATE). */
export function parseICS(text, { from = new Date(), to = new Date(Date.now() + 60 * 864e5), max = 400 } = {}) {
  const out = [];
  for (const block of unfold(text).split(/BEGIN:VEVENT/).slice(1)) {
    const body = block.split(/END:VEVENT/)[0];
    const prop = (name) => { const m = body.match(new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, 'mi')); return m ? { params: m[1], value: m[2].trim() } : null; };
    const st = prop('DTSTART'); if (!st) continue;
    const start = icsDate(st.value, st.params); if (!start) continue;
    const en = prop('DTEND'); const end = en ? icsDate(en.value, en.params)?.date : null;
    const dur = end ? end - start.date : start.allDay ? 864e5 : 36e5;
    if (/^STATUS:CANCELLED/mi.test(body)) continue;
    const base = { uid: prop('UID')?.value ?? `${st.value}-${prop('SUMMARY')?.value}`, title: icsText(prop('SUMMARY')?.value) || '(no title)', location: icsText(prop('LOCATION')?.value) || null, allDay: start.allDay };
    const ex = new Set([...body.matchAll(/^EXDATE[^:]*:(.*)$/gmi)].flatMap((m) => m[1].split(',')).map((x) => icsDate(x.trim())?.date?.getTime()).filter(Boolean));
    const push = (d) => { if (d >= from && d < to && !ex.has(d.getTime())) out.push({ ...base, uid: `${base.uid}@${d.toISOString()}`, start: d.toISOString(), end: new Date(d.getTime() + dur).toISOString() }); };
    const rr = prop('RRULE')?.value;
    if (!rr) { push(start.date); continue; }
    const r = Object.fromEntries(rr.split(';').map((kv) => kv.split('=')));
    const interval = Math.max(1, Number(r.INTERVAL ?? 1)); const count = r.COUNT ? Number(r.COUNT) : Infinity;
    const until = r.UNTIL ? icsDate(r.UNTIL)?.date ?? to : to;
    const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => DAYS[x.slice(-2)]).filter((x) => x !== undefined) : null;
    let n = 0; let cur = new Date(start.date);
    for (let guard = 0; guard < 3000 && cur <= until && cur < to && n < count; guard++) {
      if (r.FREQ === 'WEEKLY' && byday?.length) {
        const weekStart = new Date(cur); weekStart.setDate(cur.getDate() - cur.getDay());
        for (const wd of byday.sort()) { const d = new Date(weekStart); d.setDate(weekStart.getDate() + wd); d.setHours(start.date.getHours(), start.date.getMinutes(), start.date.getSeconds()); if (d >= start.date && d <= until && n < count) { n++; push(d); } }
        cur.setDate(cur.getDate() + 7 * interval);
      } else {
        n++; push(new Date(cur));
        if (r.FREQ === 'DAILY') cur.setDate(cur.getDate() + interval);
        else if (r.FREQ === 'WEEKLY') cur.setDate(cur.getDate() + 7 * interval);
        else if (r.FREQ === 'MONTHLY') cur.setMonth(cur.getMonth() + interval);
        else if (r.FREQ === 'YEARLY') cur.setFullYear(cur.getFullYear() + interval);
        else break;
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, max);
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Time zone of the saved location (not of the machine JARVIS runs on: a cloud server is often UTC). */
const tz = (loc = {}) => {
  if (loc.tz) return loc.tz;
  if (loc.lat > 29 && loc.lat < 33.6 && loc.lon > 34 && loc.lon < 36) return 'Asia/Jerusalem';
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'; } catch { return 'Asia/Jerusalem'; }
};

export const moreMethods = {
  // ---------- Hebcal ----------
  async shabbat({ lang = 'he' } = {}) {
    const loc = this.s.weather.location();
    const r = await this.http(`https://www.hebcal.com/shabbat?cfg=json&latitude=${loc.lat}&longitude=${loc.lon}&tzid=${encodeURIComponent(tz(loc))}&M=on&lg=${lang === 'he' ? 'he' : 's'}`);
    const items = (r.items ?? []).map((i) => ({ category: i.category, title: i.title, date: i.date, hebrew: i.hebrew ?? null, memo: i.memo ?? null }));
    const candles = items.find((i) => i.category === 'candles'); const havdalah = items.find((i) => i.category === 'havdalah'); const parasha = items.find((i) => i.category === 'parashat');
    if (!candles && !havdalah) throw Object.assign(new Error('Hebcal returned no Shabbat times for this location'), { status: 502 });
    this.record('hebcal', true, `${loc.name}: ${candles?.title ?? ''} ${havdalah?.title ?? ''}`.trim());
    return { location: loc.name, candles, havdalah, parasha, items, source: 'hebcal.com' };
  },
  async holidays({ days = 120, lang = 'he' } = {}) {
    const from = new Date(); const to = new Date(Date.now() + days * 864e5);
    const r = await this.http(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=off&ss=off&mf=off&c=off&start=${ymd(from)}&end=${ymd(to)}&lg=${lang === 'he' ? 'he' : 's'}`);
    const items = (r.items ?? []).filter((i) => i.category === 'holiday').map((i) => ({ title: i.title, date: i.date, hebrew: i.hebrew ?? null, subcat: i.subcat ?? null }));
    this.record('hebcal', true, `${items.length} holidays in ${days} days`);
    return { items, source: 'hebcal.com' };
  },
  async hebrewDate({ date = new Date() } = {}) {
    const d = date instanceof Date ? date : new Date(date);
    const r = await this.http(`https://www.hebcal.com/converter?cfg=json&date=${ymd(d)}&g2h=1&strict=1`);
    this.record('hebcal', true, r.hebrew);
    return { gregorian: ymd(d), hebrew: r.hebrew, hy: r.hy, hm: r.hm, hd: r.hd, events: r.events ?? [], source: 'hebcal.com' };
  },

  // ---------- CoinGecko ----------
  async cryptoPrice({ coins = ['bitcoin'] } = {}) {
    const ids = (coins.length ? coins : ['bitcoin']).slice(0, 8);
    const r = await this.http(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=ils,usd&include_24hr_change=true&include_last_updated_at=true`);
    const prices = ids.filter((id) => r[id]).map((id) => ({ id, ils: r[id].ils, usd: r[id].usd, change24h: r[id].usd_24h_change != null ? Math.round(r[id].usd_24h_change * 100) / 100 : null, updated: r[id].last_updated_at ? new Date(r[id].last_updated_at * 1000).toISOString() : null }));
    if (!prices.length) throw Object.assign(new Error(`no price for ${ids.join(', ')}`), { status: 404 });
    this.record('crypto', true, prices.map((p) => `${p.id} $${p.usd}`).join(', '));
    return { prices, source: 'coingecko.com' };
  },

  // ---------- ntfy ----------
  ntfyBase() { const c = this.cfg('ntfy'); return (c.server || 'https://ntfy.sh').replace(/\/+$/, ''); },
  async ntfySend({ text, title = 'JARVIS', priority = 'default', tags = [] }) {
    const c = this.cfg('ntfy');
    if (!c.topic) throw Object.assign(new Error('ntfy topic is not set (Integrations → Phone push)'), { status: 409 });
    const body = String(text ?? '').trim().slice(0, 3500); if (!body) throw Object.assign(new Error('nothing to send'), { status: 400 });
    return this.tracked('ntfy', async () => {
      // JSON publishing (to the server root) carries Hebrew titles safely, unlike HTTP headers.
      const r = await this.http(`${this.ntfyBase()}/`, { method: 'POST', headers: c.accessToken ? { authorization: `Bearer ${c.accessToken}` } : {}, body: { topic: c.topic, title: String(title).slice(0, 120), message: body, priority: { low: 2, default: 3, normal: 3, high: 4, critical: 5 }[priority] ?? 3, tags } });
      if (!r?.id) throw Object.assign(new Error('ntfy did not confirm the message'), { status: 502 });
      return { id: r.id, topic: c.topic, detail: `delivered to topic "${c.topic}" (message ${r.id})` };
    });
  },
  ntfySender() {
    return async ({ title, body, priority }) => {
      const c = this.cfg('ntfy');
      if (!c.forwardNotifications || !c.topic) throw new Error('not_configured');
      await this.ntfySend({ title, text: body || title, priority });
    };
  },

  // ---------- iCal ----------
  async icalSync() {
    const url = this.secret('ical', 'url');
    if (!url) throw Object.assign(new Error('calendar address is not set (Integrations → Calendar)'), { status: 409 });
    return this.tracked('ical', async () => {
      const text = await this.http(url.replace(/^webcal:/i, 'https:'), { as: 'text', timeout: 15000 });
      if (!/BEGIN:VCALENDAR/i.test(String(text))) throw Object.assign(new Error('this address did not return an iCal calendar (BEGIN:VCALENDAR missing)'), { status: 502 });
      const events = parseICS(String(text));
      const store = this.s.store;
      const old = store.all('events', (e) => e.source === 'ical');
      const keep = new Set(events.map((e) => e.uid));
      let added = 0; let updated = 0; let removed = 0;
      for (const e of old) if (!keep.has(e.uid) && e.start >= new Date().toISOString()) { store.remove('events', e.id); removed++; }
      for (const e of events) {
        const cur = old.find((x) => x.uid === e.uid);
        if (cur) { if (cur.title !== e.title || cur.start !== e.start || cur.end !== e.end) { store.update('events', cur.id, { title: e.title, start: e.start, end: e.end, location: e.location }); updated++; } }
        else { store.insert('events', { title: e.title, start: e.start, end: e.end, location: e.location, allDay: e.allDay, source: 'ical', uid: e.uid }); added++; }
      }
      this.s.store.setMeta('ical_last_sync', new Date().toISOString());
      return { events: events.length, added, updated, removed, detail: `${events.length} events in the next 60 days (${added} new, ${updated} changed, ${removed} removed)` };
    });
  },

  // ---------- GitHub ----------
  gh(path, opts = {}) {
    const tok = this.secret('github', 'token'); if (!tok) throw Object.assign(new Error('GitHub token is not set (Integrations → GitHub)'), { status: 409 });
    return this.http(`https://api.github.com${path}`, { ...opts, headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(typeof window === 'undefined' ? { 'user-agent': 'JARVIS-personal-assistant' } : {}) } });
  },
  async githubIssues() {
    return this.tracked('github', async () => {
      const r = await this.gh('/issues?filter=all&state=open&per_page=30&sort=updated');
      const items = r.filter((i) => !i.pull_request).map((i) => ({ repo: i.repository?.full_name ?? '', number: i.number, title: i.title, url: i.html_url, updated: i.updated_at }));
      return { issues: items, detail: `${items.length} open issue(s)` };
    });
  },
  async githubCreateIssue({ repo, title, body = '' }) {
    const target = (repo || this.cfg('github').repo || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(target)) throw Object.assign(new Error('which repository? (owner/name, or set a default in Integrations → GitHub)'), { status: 400 });
    const t = String(title ?? '').trim().slice(0, 250); if (!t) throw Object.assign(new Error('the issue needs a title'), { status: 400 });
    return this.tracked('github', async () => {
      const r = await this.gh(`/repos/${target}/issues`, { method: 'POST', body: { title: t, body: `${body}\n\n_Created by JARVIS_`.trim() } });
      return { repo: target, number: r.number, url: r.html_url, detail: `issue #${r.number} created in ${target}` };
    });
  },
  async githubVerifyIssue(repo, number) { const r = await this.gh(`/repos/${repo}/issues/${number}`); return r?.number === number; },
};
