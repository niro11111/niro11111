// Builds the prototypes: a fully interactive copy of the real web app backed by responses
// recorded from the real JARVIS server (no server needed to view it), plus watch/phone mockups.
//   node prototypes/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createServer } from '../server/index.js';
import { ModelRouter } from '../server/core/router.js';
import { DemoHomeAdapter } from '../server/home/smarthome.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'demo');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(here, '../web'), out, { recursive: true });

const fakeWeather = async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 24.3, weather_code: 1, wind_speed_10m: 12, relative_humidity_2m: 58 }, daily: { temperature_2m_max: [27], temperature_2m_min: [19] } }) });
const s = await createApp({ router: new ModelRouter(), home: new DemoHomeAdapter(), fetch: fakeWeather });
// a little realistic content
s.productivity.createTask({ title: 'להגיש דוח רבעוני', priority: 'high', due: new Date(Date.now() + 864e5).toISOString(), project: 'עבודה' });
s.productivity.createTask({ title: 'לקבוע תור לרופא שיניים' });
s.productivity.createTask({ title: 'Renew car insurance', project: 'Home' });
s.productivity.createEvent({ title: 'פגישת צוות', start: new Date(Date.now() + 3 * 36e5).toISOString() });
s.productivity.createEvent({ title: 'ארוחת ערב משפחתית', start: new Date(Date.now() + 30 * 36e5).toISOString() });
s.memory.add({ content: 'אני מעדיף תשובות קצרות', type: 'preference' });
s.memory.add({ content: 'נועה הולכת לחוג פסנתר בימי שלישי', type: 'person', workspace: 'family' });
s.memory.add({ content: 'The project deadline for JARVIS v1 is end of quarter', type: 'project', workspace: 'projects' });
s.automations.create({ name: 'בדיקת עסקה חדשה', trigger: { type: 'event', event: 'wealth.transaction_imported' }, steps: [{ type: 'tool', tool: 'wealth.analysis', saveAs: 'a' }, { type: 'condition', if: { path: 'a.calculations.anomalies.unusual.length', op: '>', value: 0 }, then: [{ type: 'notify', title: 'הוצאה חריגה זוהתה', priority: 'high' }] }] });
s.devices.register({ name: 'Apple Watch', kind: 'watchos' });
s.devices.register({ name: 'iPhone', kind: 'ios' });

const srv = createServer(s, 'demo');
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (p, o = {}) => (await fetch(base + p, { ...o, headers: { Authorization: 'Bearer demo', 'Content-Type': 'application/json' } })).json();

const PRESETS = ['תארגן לי את היום', 'כמה הוצאנו החודש?', 'תמצא הוצאות מיותרות', 'כבה את האורות למטה', 'תדליק אותם', 'תזכיר לי לשלם חשמל מחר ב-9', 'מה המשימות שלי', 'אילו תשלומים קרובים?', 'איך מתקדמים יעדי החיסכון?', 'הוסף חלב לרשימת הקניות',
  'organize my day', 'how much did we spend this month?', 'turn off the lights downstairs', 'which devices are offline?', 'show our total financial assets', 'transfer 500 to Dan', 'פתח את הדלת'];
const commands = {};
for (const text of PRESETS) {
  const t = await call('/api/command', { method: 'POST', body: JSON.stringify({ text, conversationId: 'demo' }) });
  commands[text] = t;
  if (t.state === 'AWAITING_APPROVAL') {
    const [ap] = (await call('/api/approvals')).filter((a) => a.id === t.approvalId);
    commands[text].approval = ap;
    commands[text].afterApprove = await call(`/api/approvals/${t.approvalId}`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) });
  }
}
// re-create one pending approval so the HUD shows the approval flow
await call('/api/command', { method: 'POST', body: JSON.stringify({ text: 'unlock the front door', conversationId: 'x' }) });
await call('/api/presence', { method: 'POST', body: JSON.stringify({ state: 'arrived_home' }) });

const GETS = ['/api/status', '/api/system/map', '/api/system/metrics', '/api/agents', '/api/tasks/exec', '/api/notifications', '/api/notifications?unread=1', '/api/wealth/overview', '/api/wealth/budgets', '/api/wealth/accounts', '/api/wealth/series?months=6',
  '/api/home/devices', '/api/approvals', '/api/proactive', '/api/context/weather', '/api/automations', '/api/automations/runs', '/api/memory', '/api/memory/meta', '/api/documents', '/api/tasks', '/api/shopping', '/api/reminders',
  '/api/devices', '/api/devices/capabilities', '/api/console', '/api/privacy', '/api/security/policy', '/api/security/audit', '/api/autonomy', '/api/voice/transcripts', '/api/settings/personality', '/api/watch/glance?lang=he', '/api/watch/glance?lang=en'];
const gets = {};
for (const p of GETS) gets[p] = await call(p);
gets['POST /api/wealth/analysis'] = await call('/api/wealth/analysis', { method: 'POST', body: '{}' });
gets['events'] = await call(`/api/events?from=${new Date(Date.now() - 864e5).toISOString()}`);
gets['nlPreview'] = await call('/api/automations/from-text', { method: 'POST', body: JSON.stringify({ text: 'כשאני מגיע הביתה: הדלק את האורות למטה; מה יש לי היום; אל תפתח את הדלת', preview: true }) });
gets['nlPreviewEn'] = await call('/api/automations/from-text', { method: 'POST', body: JSON.stringify({ text: 'When I arrive home: turn on the lights downstairs; organize my day; do not unlock doors', preview: true }) });
srv.close();

fs.writeFileSync(path.join(out, 'js/fixtures.js'), `// Recorded from the real JARVIS server by prototypes/build.mjs on ${new Date().toISOString()}\nexport const FIXTURES = ${JSON.stringify({ gets, commands, recordedAt: new Date().toISOString() })};\n`);
fs.copyFileSync(path.join(here, 'mock.js'), path.join(out, 'js/mock.js'));
fs.copyFileSync(path.join(here, 'devices.html'), path.join(out, 'devices.html'));
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="js/app.js"></script>', '<script type="module" src="js/mock.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(here, 'fixtures-watch.json'), JSON.stringify({ he: gets['/api/watch/glance?lang=he'], approvals: gets['/api/approvals'] }, null, 1));
console.log(`prototypes/demo built: ${Object.keys(gets).length} recorded endpoints, ${Object.keys(commands).length} recorded commands`);
