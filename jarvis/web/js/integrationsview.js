// Integrations: real outside services. Each card saves settings to the JARVIS server, runs a real
// test call, and shows only what the service actually answered. Tokens are never shown back.
import { api, esc, toast, $, $$, confirmDialog } from './api.js';
import { getLang } from './i18n.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
const X = '/api/integrations/hub';
const ST = { connected: ['ok', 'מחובר', 'connected'], configured: ['info', 'מוגדר, לא נבדק', 'configured, not tested'], not_configured: ['', 'לא מוגדר', 'not set up'], failed: ['bad', 'נכשל', 'failed'] };
const tag = (s) => `<span class="tag xs ${ST[s]?.[0] ?? ''}">${esc(he() ? ST[s]?.[1] ?? s : ST[s]?.[2] ?? s)}</span>`;
const ICON = { make: '⟳', telegram: '✈', airtable: '▦', fx: '₪', wikipedia: 'W', news: '📰', weather: '☀', inbound: '⇩' };
const DESC = {
  make: ['Run your Make scenarios by voice ("run the scenario daily summary") and send data to Make webhooks.', 'הפעלת תרחישי Make בקול ("הפעל את התרחיש סיכום יומי") ושליחת נתונים ל-webhooks של Make.'],
  telegram: ['JARVIS sends messages and notifications to your own Telegram ("send to Telegram: buy milk").', 'ג׳ארוויס שולח הודעות והתראות לטלגרם שלך ("שלח לטלגרם: לקנות חלב").'],
  airtable: ['Read and add records in your Airtable table ("add to Airtable: fix the door").', 'קריאה והוספה של רשומות בטבלת Airtable ("הוסף ל-Airtable: לתקן את הדלת").'],
  fx: ['Live exchange rates ("how much is 100 dollars in shekels").', 'שערי מטבע עדכניים ("כמה זה 100 דולר בשקלים").'],
  wikipedia: ['Facts from Wikipedia with a link ("who was Ben-Gurion").', 'עובדות מוויקיפדיה עם קישור ("מי היה בן גוריון").'],
  news: ['Headlines from RSS feeds ("news", "ynet news").', 'כותרות מפידים של RSS ("חדשות", "חדשות ynet").'],
  weather: ['Current weather for your location ("what is the weather").', 'מזג האוויר הנוכחי במיקום שלך ("מה מזג האוויר").'],
  inbound: ['A private URL that Make (or any service) can call to notify you, add a task or a note.', 'כתובת פרטית ש-Make (או כל שירות) יכולים לקרוא לה כדי לשלוח לך התראה, להוסיף משימה או פתק.'],
};

function fields(c) {
  const g = c.config;
  const secret = (k, ph) => `<input name="${k}" type="password" autocomplete="off" dir="ltr" placeholder="${g[`${k}Set`] ? esc(g[`${k}Hint`]) + (g[`${k}FromEnv`] ? ' (env)' : '') : esc(ph)}">`;
  switch (c.id) {
    case 'make': return `<label>${L('Zone', 'אזור')}</label><input name="zone" dir="ltr" value="${esc(g.zone ?? 'eu1')}" placeholder="eu1">
      <label>${L('Team id', 'מזהה צוות')}</label><input name="teamId" dir="ltr" value="${esc(g.teamId ?? '')}" placeholder="${L('from the Make URL: /<team id>/scenarios', 'מכתובת Make: ‎/<team id>/scenarios')}">
      <label>${L('API token', 'טוקן API')}</label>${secret('apiToken', L('Profile → API access → Add token', 'פרופיל ← API access ← Add token'))}
      <label>${L('Webhooks', 'Webhooks')}</label><textarea name="webhooks" dir="ltr" rows="3" placeholder="name | https://hook.eu1.make.com/...">${esc((g.webhooks ?? []).map((w) => `${w.name} | ${w.url}`).join('\n'))}</textarea>`;
    case 'telegram': return `<label>${L('Bot token', 'טוקן בוט')}</label>${secret('botToken', '123456:ABC… (@BotFather → /newbot)')}
      <label>${L('Your chat', 'הצ׳אט שלך')}</label><div class="row"><input name="chatId" dir="ltr" class="grow" value="${esc(g.chatId ?? '')}" placeholder="${L('press Find after /start', 'לחצו "מצא" אחרי ‎/start')}"><button type="button" class="btn sm" data-act="find-chat">${L('Find my chat', 'מצא את הצ׳אט')}</button></div>
      <span></span><label class="row"><input name="forwardNotifications" type="checkbox" ${g.forwardNotifications ? 'checked' : ''}> ${L('Also send JARVIS notifications here', 'לשלוח לכאן גם את ההתראות של ג׳ארוויס')}</label>`;
    case 'airtable': return `<label>${L('Personal access token', 'טוקן גישה אישי')}</label>${secret('token', 'pat…  (airtable.com/create/tokens)')}
      <label>${L('Base id', 'מזהה בסיס')}</label><input name="baseId" dir="ltr" value="${esc(g.baseId ?? '')}" placeholder="app…">
      <label>${L('Table', 'טבלה')}</label><div class="row"><input name="table" dir="auto" class="grow" value="${esc(g.table ?? '')}" placeholder="${L('table name or id', 'שם או מזהה טבלה')}"><button type="button" class="btn sm" data-act="tables">${L('Load tables', 'טען טבלאות')}</button></div>`;
    case 'news': return `<label>${L('Feeds', 'פידים')}</label><textarea name="feeds" dir="ltr" rows="3">${esc((g.feeds ?? []).map((f) => `${f.name} | ${f.url}`).join('\n'))}</textarea>`;
    case 'inbound': return g.path ? `<label>URL</label><div><code class="xs" style="word-break:break-all">${esc(location.origin.startsWith('http') ? location.origin : 'https://<your-jarvis-host>')}${esc(g.path)}</code>
      <div class="xs muted" style="margin-top:4px">POST JSON: {"action":"notify|task|note","text":"…"} · ${L('Keep this URL private. Create a new one to revoke the old.', 'שמרו את הכתובת בסוד. יצירת כתובת חדשה מבטלת את הישנה.')}</div></div>` : '';
    default: return '';
  }
}

const card = (c) => `<div class="c6 panel glass corner integ" data-id="${c.id}">
  <h2><span class="ic">${ICON[c.id] ?? '•'}</span> ${esc(c.name)} <span class="right">${tag(c.status)}</span></h2>
  <p class="small">${esc(DESC[c.id]?.[he() ? 1 : 0] ?? '')}</p>
  ${c.last ? `<p class="xs ${c.last.ok ? 'ok' : 'err'}">${c.last.ok ? '✓' : '✕'} ${esc(c.last.detail)} <span class="muted">· ${esc(String(c.last.at).slice(0, 16).replace('T', ' '))}</span></p>` : ''}
  <form class="kv small">${fields(c)}</form>
  <div class="row" style="margin-top:8px;flex-wrap:wrap">
    ${c.fields.length ? `<button class="btn primary sm" data-act="save">${L('Save', 'שמור')}</button>` : ''}
    ${c.id === 'inbound' ? `<button class="btn sm" data-act="inbound">${c.config.path ? L('New URL', 'כתובת חדשה') : L('Create URL', 'צור כתובת')}</button>` : `<button class="btn sm" data-act="test">${L('Test now', 'בדוק עכשיו')}</button>`}
    ${c.id === 'telegram' ? `<button class="btn sm" data-act="tg-send">${L('Send test message', 'שלח הודעת בדיקה')}</button>` : ''}
    ${c.id === 'make' ? `<button class="btn sm" data-act="scenarios">${L('My scenarios', 'התרחישים שלי')}</button>${(c.config.webhooks ?? []).map((w) => `<button class="btn sm" data-act="hook" data-name="${esc(w.name)}">⇢ ${esc(w.name)}</button>`).join('')}` : ''}
    ${c.id === 'airtable' ? `<button class="btn sm" data-act="records">${L('Show records', 'הצג רשומות')}</button>` : ''}
    ${!c.keyless && c.status !== 'not_configured' ? `<button class="btn sm" data-act="disconnect">${L('Disconnect', 'נתק')}</button>` : ''}
  </div>
  <div class="out small" style="margin-top:8px"></div>
  <details class="xs muted" style="margin-top:6px"><summary>${L('How to set up', 'איך מגדירים')}</summary>${esc(c.docs)}</details>
</div>`;

const pairs = (txt) => String(txt ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, ...b] = l.split('|'); return b.length ? { name: a.trim(), url: b.join('|').trim() } : { name: 'webhook', url: a.trim() }; });

export async function integrationsView(v) {
  const list = await api(X);
  const ok = list.filter((c) => c.status === 'connected').length;
  v.innerHTML = `<div class="panel glass corner" style="margin-bottom:14px"><h2>🔌 ${L('Real integrations', 'התממשקויות אמיתיות')} <span class="right xs">${ok}/${list.length} ${L('connected', 'מחוברים')}</span></h2>
    <p class="small">${L('Every status here comes from a real call to the service. Tokens are kept on the JARVIS server and never shown again. Messages go only to your own Telegram chat; Make and Airtable actions are logged in the audit trail.', 'כל סטטוס כאן מגיע מקריאה אמיתית לשירות. הטוקנים נשמרים בשרת של ג׳ארוויס ולא מוצגים שוב. הודעות נשלחות רק לצ׳אט הטלגרם שלך; פעולות Make ו-Airtable נרשמות ביומן הביקורת.')}</p>
    <p class="xs muted">${L('Outside calls need the JARVIS server (npm start) or a browser that allows them. Inside claude.ai or a file opened from disk the sandbox may block them; the card then shows the exact error.', 'קריאות החוצה דורשות את השרת של ג׳ארוויס (npm start) או דפדפן שמאפשר אותן. בתוך claude.ai או בקובץ שנפתח מהמחשב ייתכן שהן ייחסמו; הכרטיס יציג אז את השגיאה המדויקת.')}</p></div>
    <div class="grid">${list.map(card).join('')}</div>`;

  $$('.integ', v).forEach((el) => {
    const id = el.dataset.id; const out = el.querySelector('.out'); const form = el.querySelector('form');
    const show = (html, cls = '') => { out.innerHTML = `<div class="${cls}">${html}</div>`; };
    const run = async (fn, okMsg) => { show('…'); try { const r = await fn(); if (okMsg) show(okMsg(r), 'ok'); return r; } catch (e) { show(`✕ ${esc(e.message)}`, 'err'); return null; } };
    const body = () => {
      const f = Object.fromEntries(new FormData(form));
      if (id === 'make') f.webhooks = pairs(f.webhooks);
      if (id === 'news') f.feeds = pairs(f.feeds);
      if (id === 'telegram') f.forwardNotifications = !!form.forwardNotifications?.checked;
      for (const k of ['apiToken', 'botToken', 'token']) if (k in f && f[k] === '') delete f[k]; // empty = keep the saved one
      return f;
    };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'save') { const r = await run(() => api(`${X}/${id}`, { method: 'PUT', body: body() })); if (r) { toast(L('Saved. Testing…', 'נשמר. בודק…')); await run(() => api(`${X}/${id}/test`, { method: 'POST' })); integrationsView(v); } }
      if (act === 'test') { await run(() => api(`${X}/${id}/test`, { method: 'POST' }), (r) => `✓ ${esc(r.detail)}`); setTimeout(() => integrationsView(v), 1200); }
      if (act === 'disconnect' && await confirmDialog(L('Remove the saved settings and token?', 'למחוק את ההגדרות והטוקן השמורים?'))) { await api(`${X}/${id}`, { method: 'DELETE' }); integrationsView(v); }
      if (act === 'find-chat') { await run(() => api(`${X}/${id}`, { method: 'PUT', body: body() })); const r = await run(() => api(`${X}/telegram/find-chat`, { method: 'POST' }), (x) => `✓ ${L('Chat found', 'נמצא צ׳אט')}: ${esc(x.name)} (${esc(x.chatId)})`); if (r) setTimeout(() => integrationsView(v), 1200); }
      if (act === 'tg-send') await run(() => api(`${X}/telegram/send`, { method: 'POST', body: { text: L('✅ JARVIS is connected to your Telegram.', '✅ ג׳ארוויס מחובר לטלגרם שלך.') } }), (r) => `✓ ${L('Delivered, message', 'נמסרה, הודעה')} ${esc(r.messageId)}`);
      if (act === 'scenarios') await run(() => api(`${X}/make/scenarios`), (r) => (r.scenarios.length ? `<ul class="list">${r.scenarios.map((s) => `<li>${esc(s.name)} <span class="muted">#${esc(s.id)} · ${s.active ? L('active', 'פעיל') : L('off', 'כבוי')}</span> <button class="btn xs" data-act="run" data-sid="${esc(s.id)}">▶ ${L('Run', 'הרץ')}</button></li>`).join('')}</ul>` : L('No scenarios in this team.', 'אין תרחישים בצוות הזה.')));
      if (act === 'run' && await confirmDialog(L('Run this Make scenario now? It does whatever the scenario does (e.g. sends email).', 'להריץ את תרחיש ה-Make עכשיו? הוא יבצע את מה שהתרחיש עושה (למשל שליחת מייל).'))) await run(() => api(`${X}/make/run`, { method: 'POST', body: { scenario: b.dataset.sid } }), (r) => `✓ ${esc(r.detail)}`);
      if (act === 'hook' && await confirmDialog(L('Send a test call to this webhook? Your scenario will run.', 'לשלוח קריאת בדיקה ל-webhook? התרחיש שלך ירוץ.'))) await run(() => api(`${X}/make/webhook`, { method: 'POST', body: { name: b.dataset.name, text: 'test from JARVIS', test: true } }), (r) => `✓ ${esc(r.detail)}`);
      if (act === 'tables') { await run(() => api(`${X}/${id}`, { method: 'PUT', body: body() })); await run(() => api(`${X}/airtable/tables`), (r) => r.map((tb) => `<button class="btn xs" data-act="pick" data-t="${esc(tb.name)}">${esc(tb.name)}</button>`).join(' ')); }
      if (act === 'pick') { form.table.value = b.dataset.t; show(L('Table selected. Press Save.', 'נבחרה טבלה. לחצו שמור.')); }
      if (act === 'records') await run(() => api(`${X}/airtable/records`), (r) => (r.records.length ? `<ul class="list">${r.records.slice(0, 10).map((x) => `<li>${esc(Object.values(x.fields).filter((y) => typeof y !== 'object').slice(0, 3).join(' · '))}</li>`).join('')}</ul>` : L('The table is empty.', 'הטבלה ריקה.')));
      if (act === 'inbound') { await run(() => api(`${X}/inbound/create`, { method: 'POST' })); integrationsView(v); }
    });
  });
}
