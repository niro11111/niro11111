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
