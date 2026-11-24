// Tools backed by real external services (server/integrations/hub.js). Each returns what the
// service actually answered; verify() re-reads the real state where the service allows it.
import { RISK } from '../security/policy.js';

const he = (ctx) => ctx.lang === 'he';

export function integrationTools(s, def) {
  const I = () => s.integrations;

  def('weather.now', { risk: RISK.READ, desc: 'Current weather (Open-Meteo)', input: {}, run: async (a, ctx) => {
    const w = await s.weather.current();
    if (!w.available) throw new Error(he(ctx) ? `שירות מזג האוויר לא זמין (${w.reason})` : `weather service unavailable (${w.reason})`);
    return { data: w, summary: he(ctx) ? `ב${w.location} עכשיו ${w.temperature}°, ${w.textHe}. היום ${w.min}°–${w.max}°, לחות ${w.humidity}%, רוח ${w.wind} קמ"ש. (מקור: ${w.source})` : `${w.location}: ${w.temperature}°, ${w.text}. Today ${w.min}°–${w.max}°, humidity ${w.humidity}%, wind ${w.wind} km/h. (source: ${w.source})` };
  } });

  def('fx.rate', { risk: RISK.READ, desc: 'Live currency exchange rate (European Central Bank via frankfurter.dev)', input: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, amount: { type: 'number' } }, run: async (a, ctx) => {
    const r = await I().fxRate(a);
    return { data: r, summary: he(ctx) ? `${r.amount} ${r.from} = ${r.value} ${r.to} (שער ${r.rate}, ${r.date}, מקור: ${r.source})` : `${r.amount} ${r.from} = ${r.value} ${r.to} (rate ${r.rate}, ${r.date}, source: ${r.source})` };
  } });

  def('wiki.lookup', { risk: RISK.READ, desc: 'Look up a topic on Wikipedia (Hebrew or English)', input: { query: { type: 'string', required: true } }, run: async (a, ctx) => {
    const r = await I().wiki({ query: a.query, lang: a.lang });
    return { data: r, summary: `${r.title}: ${r.extract}\n${he(ctx) ? 'מקור' : 'Source'}: ${r.url}` };
  } });

  def('news.headlines', { risk: RISK.READ, desc: 'Latest news headlines from RSS feeds', input: { source: { type: 'string' } }, run: async (a, ctx) => {
    const r = await I().headlines({ limit: 6, source: a.source });
    const failed = r.sources.filter((x) => !x.ok).map((x) => x.name);
    return { data: r, summary: `${r.items.map((i, n) => `${n + 1}. ${i.title} (${i.source})`).join('\n')}${failed.length ? `\n${he(ctx) ? 'לא זמין' : 'Unavailable'}: ${failed.join(', ')}` : ''}` };
  } });

  def('telegram.send', { risk: RISK.EXTERNAL, desc: "Send a Telegram message to the owner's own chat", input: { text: { type: 'string', required: true } }, run: async (a, ctx) => {
    const r = await I().telegramSend({ text: a.text });
    return { data: r, summary: he(ctx) ? `נשלח לטלגרם שלך (הודעה ${r.messageId}).` : `Sent to your Telegram (message ${r.messageId}).` };
  }, verify: (r) => Number.isInteger(r.data?.messageId) });

  def('make.scenarios', { risk: RISK.READ, desc: 'List Make scenarios', input: {}, run: async (a, ctx) => {
    const r = await I().makeScenarios();
    return { data: r.scenarios, summary: r.scenarios.length ? r.scenarios.map((x) => `• ${x.name} (#${x.id}) ${x.active ? (he(ctx) ? 'פעיל' : 'active') : (he(ctx) ? 'כבוי' : 'off')}`).join('\n') : (he(ctx) ? 'אין תרחישים בצוות הזה.' : 'No scenarios in this team.') };
  } });

  def('make.run', { risk: RISK.EXTERNAL, desc: 'Run a Make scenario by name or id', input: { scenario: { type: 'string', required: true } }, run: async (a, ctx) => {
    const r = await I().makeRun({ scenario: a.scenario, data: a.data });
    return { data: r, summary: he(ctx) ? `התרחיש ${r.scenarioId} רץ ב-Make (הרצה ${r.executionId ?? '?'}, סטטוס: ${r.status ?? 'בתור'}).` : `Make scenario ${r.scenarioId} ran (execution ${r.executionId ?? '?'}, status: ${r.status ?? 'queued'}).` };
  }, verify: (r) => !!r.data?.executionId });

  def('make.trigger', { risk: RISK.EXTERNAL, desc: 'Send data to a saved Make webhook', input: { name: { type: 'string' }, text: { type: 'string' } }, run: async (a, ctx) => {
    const r = await I().makeWebhook({ name: a.name, payload: { text: a.text ?? '', lang: ctx.lang } });
    return { data: r, summary: he(ctx) ? `ה-webhook "${r.webhook}" ב-Make קיבל את הבקשה${r.response ? ` (${r.response.slice(0, 60)})` : ''}.` : `Make webhook "${r.webhook}" accepted the request${r.response ? ` (${r.response.slice(0, 60)})` : ''}.` };
  } });

  // ---------- Shabbat, holidays, Hebrew date (Hebcal) ----------
  // Hebcal returns local times of the location ("2026-11-27T16:18:00+02:00"): show them as given,
  // never converted to the time zone of the machine JARVIS runs on.
  const hm = (iso) => String(iso).slice(11, 16);
  const dday = (iso, ctx) => { const [y, mo, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString(he(ctx) ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' }); };
  def('hebcal.shabbat', { risk: RISK.READ, desc: 'Shabbat candle-lighting and havdalah times for the saved location', input: {}, run: async (a, ctx) => {
    const r = await I().shabbat({ lang: ctx.lang });
    const parts = [r.candles && `${he(ctx) ? 'כניסת שבת' : 'Candle lighting'}: ${dday(r.candles.date, ctx)} ${hm(r.candles.date)}`, r.havdalah && `${he(ctx) ? 'צאת שבת' : 'Havdalah'}: ${dday(r.havdalah.date, ctx)} ${hm(r.havdalah.date)}`, r.parasha && `${he(ctx) ? 'פרשת השבוע' : 'Parasha'}: ${r.parasha.hebrew ?? r.parasha.title}`].filter(Boolean);
    return { data: r, summary: `${r.location} · ${parts.join(' · ')} (${he(ctx) ? 'מקור' : 'source'}: hebcal.com)` };
  } });
  def('hebcal.holidays', { risk: RISK.READ, desc: 'Upcoming Jewish and Israeli holidays', input: {}, run: async (a, ctx) => {
    const r = await I().holidays({ lang: ctx.lang });
    // One line per holiday: the eight nights of Hanukkah (and similar series) become one line with the dates.
    const groups = [];
    for (const i of r.items) {
      const name = String(i.hebrew && he(ctx) ? i.hebrew : i.title).split(/[:：]/)[0].replace(/\s+[א-ת]׳?\s*(?:נר|נרות)$|\s+\d+\s+candles?$|\s+(?:I{1,3}|IV|V|VI{0,3})$/i, '').trim();
      const g = groups.find((x) => x.name === name); if (g) g.last = i.date; else groups.push({ name, first: i.date, last: i.date });
    }
    return { data: r.items, summary: groups.length ? groups.slice(0, 8).map((g) => `• ${g.name} — ${dday(g.first, ctx)}${g.last !== g.first ? ` ${he(ctx) ? 'עד' : 'to'} ${dday(g.last, ctx)}` : ''}`).join('\n') : (he(ctx) ? 'אין חגים ב-4 החודשים הקרובים.' : 'No holidays in the next 4 months.') };
  } });
  def('hebcal.date', { risk: RISK.READ, desc: "Today's Hebrew date", input: {}, run: async (a, ctx) => {
    const r = await I().hebrewDate({});
    return { data: r, summary: `${he(ctx) ? 'היום' : 'Today is'} ${r.hebrew}${r.events.length ? ` · ${r.events.join(', ')}` : ''}` };
  } });

  // ---------- crypto ----------
  def('crypto.price', { risk: RISK.READ, desc: 'Live cryptocurrency prices (CoinGecko)', input: { coins: { type: 'array' } }, run: async (a, ctx) => {
    const r = await I().cryptoPrice({ coins: a.coins ?? ['bitcoin'] });
    const n = (x) => Number(x).toLocaleString('en', { maximumFractionDigits: x < 10 ? 4 : 0 });
    return { data: r.prices, summary: `${r.prices.map((p) => `${p.id}: ₪${n(p.ils)} ($${n(p.usd)})${p.change24h != null ? ` ${p.change24h >= 0 ? '▲' : '▼'}${Math.abs(p.change24h)}% ${he(ctx) ? 'ב-24 שעות' : '24h'}` : ''}`).join('\n')}\n(${he(ctx) ? 'מקור' : 'source'}: coingecko.com)` };
  } });

  // ---------- phone push (ntfy) ----------
  def('ntfy.send', { risk: RISK.EXTERNAL, desc: 'Send a push notification to the owner\'s phone (ntfy)', input: { text: { type: 'string', required: true } }, run: async (a, ctx) => {
    const r = await I().ntfySend({ text: a.text, title: 'JARVIS' });
    return { data: r, summary: he(ctx) ? `נשלחה התראה לטלפון שלך (${r.id}).` : `Push sent to your phone (${r.id}).` };
  }, verify: (r) => !!r.data?.id });

  // ---------- calendar (iCal) ----------
  def('ical.sync', { risk: RISK.WRITE, desc: 'Sync the connected calendar into JARVIS', input: {}, run: async (a, ctx) => {
    const r = await I().icalSync();
    return { data: r, summary: he(ctx) ? `היומן סונכרן: ${r.events} אירועים ב-60 הימים הקרובים (${r.added} חדשים, ${r.updated} עודכנו, ${r.removed} הוסרו).` : `Calendar synced: ${r.detail}.` };
  }, verify: (r) => s.store.all('events', (e) => e.source === 'ical').length >= r.data.events });

  // ---------- GitHub ----------
  def('github.issues', { risk: RISK.READ, desc: 'My open GitHub issues', input: {}, run: async (a, ctx) => {
    const r = await I().githubIssues();
    return { data: r.issues, summary: r.issues.length ? r.issues.slice(0, 12).map((i) => `• ${i.repo}#${i.number} ${i.title}`).join('\n') : (he(ctx) ? 'אין issues פתוחים.' : 'No open issues.') };
  } });
  def('github.create_issue', { risk: RISK.EXTERNAL, desc: 'Create a GitHub issue', input: { title: { type: 'string', required: true }, repo: { type: 'string' } }, run: async (a, ctx) => {
    const r = await I().githubCreateIssue({ repo: a.repo, title: a.title, body: a.body });
    return { data: r, summary: he(ctx) ? `נפתח issue #${r.number} ב-${r.repo}: ${r.url}` : `Opened issue #${r.number} in ${r.repo}: ${r.url}` };
  }, verify: async (r) => (r.data?.number ? I().githubVerifyIssue(r.data.repo, r.data.number) : false) });

  def('airtable.list', { risk: RISK.READ, desc: 'List records in the connected Airtable table', input: {}, run: async (a, ctx) => {
    const r = await I().airtableList({ limit: 20 });
    const line = (x) => Object.entries(x.fields).filter(([, v]) => typeof v === 'string' || typeof v === 'number').slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(' · ');
    return { data: r.records, summary: r.records.length ? r.records.map((x, n) => `${n + 1}. ${line(x)}`).join('\n') : (he(ctx) ? 'הטבלה ריקה.' : 'The table is empty.') };
  } });

  def('airtable.create', { risk: RISK.EXTERNAL, desc: 'Add a record to the connected Airtable table', input: { text: { type: 'string', required: true } }, run: async (a, ctx) => {
    const r = await I().airtableCreate({ text: a.text });
    return { data: r, summary: he(ctx) ? `נוספה רשומה ל-Airtable: "${a.text}" (${r.id}).` : `Added to Airtable: "${a.text}" (${r.id}).` };
  }, verify: async (r) => (r.data?.id ? I().airtableVerify(r.data.id) : false) });
}
