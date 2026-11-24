// In-browser backend for the prototype: answers the web app's API calls from responses
// recorded on the real JARVIS server. Commands that were not recorded get an honest
// "demo" reply instead of a made-up result.
import { FIXTURES } from './fixtures.js';

const F = FIXTURES;
const state = { approvals: [...F.gets['/api/approvals']], tasks: [...F.gets['/api/tasks']], shopping: [...F.gets['/api/shopping']], extraExec: [] };
const norm = (s) => String(s).trim().toLowerCase().replace(/[?!.״"']/g, '');
const pendingByApproval = {};
const delay = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 120));

function command(text) {
  const key = Object.keys(F.commands).find((k) => norm(k) === norm(text));
  if (key) {
    const t = structuredClone(F.commands[key]);
    if (t.approval) { state.approvals.push(t.approval); pendingByApproval[t.approval.id] = t.afterApprove; }
    state.extraExec.unshift({ ...t, steps: t.plan?.steps });
    return t;
  }
  const he = /[֐-׿]/.test(text);
  return { id: `demo_${Date.now()}`, objective: text, state: 'COMPLETED', response: he
    ? `זו גרסת הדגמה שמוקלטת מהשרת האמיתי, ולכן היא מכירה רק פקודות לדוגמה. נסו: ${Object.keys(F.commands).filter((k) => /[֐-׿]/.test(k)).slice(0, 5).join(' · ')}`
    : `This is a recorded demo of the real server, so it only knows sample commands. Try: ${Object.keys(F.commands).filter((k) => !/[֐-׿]/.test(k)).slice(0, 5).join(' · ')}`, plan: { steps: [] } };
}

window.JARVIS_MOCK = async (path, opts = {}) => {
  const method = opts.method ?? 'GET';
  const body = opts.body ? JSON.parse(opts.body) : {};
  const p = path.replace(/\?from=.*$/, '');
  if (method === 'POST' && p === '/api/command') return delay(command(body.text));
  if (method === 'POST' && p === '/api/home/command') return delay(command(body.text));
  if (method === 'POST' && /^\/api\/approvals\//.test(p)) {
    const id = p.split('/').pop();
    state.approvals = state.approvals.filter((a) => a.id !== id);
    const after = pendingByApproval[id];
    if (body.decision !== 'approve') return delay({ state: 'CANCELLED', response: 'בוטל. / Cancelled.', plan: { steps: [] } });
    return delay(after ?? { state: 'COMPLETED', response: 'אושר (הדגמה). / Approved (demo).', plan: { steps: [] } });
  }
  if (p === '/api/approvals') return delay(state.approvals);
  if (p === '/api/tasks/exec') return delay([...state.extraExec, ...F.gets['/api/tasks/exec']]);
  if (p === '/api/events') return delay(F.gets.events);
  if (method === 'POST' && p === '/api/wealth/analysis') return delay(F.gets['POST /api/wealth/analysis']);
  if (method === 'POST' && p === '/api/automations/from-text') return delay(/[֐-׿]/.test(body.text) ? F.gets.nlPreview : F.gets.nlPreviewEn);
  if (method === 'POST' && p === '/api/tasks') { const t = { id: `t${Date.now()}`, title: body.title, priority: body.priority ?? 'normal', due: body.due, done: false }; state.tasks.unshift(t); return delay(t); }
  if (p === '/api/tasks') return delay(state.tasks);
  if (method === 'POST' && p === '/api/shopping') { const x = { id: `s${Date.now()}`, item: body.item, done: false }; state.shopping.push(x); return delay(x); }
  if (p === '/api/shopping') return delay(state.shopping);
  if (method === 'GET' && F.gets[path] !== undefined) return delay(F.gets[path]);
  if (method === 'GET' && F.gets[p] !== undefined) return delay(F.gets[p]);
  if (method === 'GET' && p.startsWith('/api/memory/search')) return delay(F.gets['/api/memory'].slice(0, 3));
  if (method === 'GET' && p.startsWith('/api/models/route')) return delay({ model: 'local', reason: 'demo' });
  if (method !== 'GET') return delay({ ok: true, demo: true, note: 'Changes are not saved in the demo.' });
  throw new Error(`demo: ${path} not recorded`);
};

// Skip the token screen in the demo.
try { localStorage.setItem('jarvis.token', JSON.stringify('demo')); } catch { /* storage unavailable */ }
await import('./app.js');
// Prototype extras: a banner and a link to the watch / phone screens.
const bar = document.createElement('a');
bar.href = 'devices.html';
bar.textContent = '⌚ שעון · טלפון (אב־טיפוס) ←';
bar.style.cssText = 'display:block;margin:10px 12px 0;padding:8px 12px;border:1px solid rgba(255,191,60,.5);border-radius:10px;color:#ffbf3c;text-decoration:none;font-size:13px';
document.querySelector('.nav-foot')?.before(bar);
const tag = document.createElement('span');
tag.className = 'tag warn'; tag.textContent = 'DEMO · recorded';
document.querySelector('.top-right')?.prepend(tag);
