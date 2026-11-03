// Conversation state shared by every screen.
import { api, esc, local, toast, $$, confirmDialog } from './api.js';
import { t } from './i18n.js';
import { setCoreState } from './core.js';
import { voice, speak, toggleListening } from './voice.js';

const messages = local.get('messages', []);
const conversationId = local.get('conversationId', null) ?? (() => { const id = `c_${Date.now().toString(36)}`; local.set('conversationId', id); return id; })();
export const chatEvents = new EventTarget();

function push(m) { messages.push(m); if (messages.length > 100) messages.shift(); local.set('messages', messages); renderChats(); }
export function clearChat() { messages.length = 0; local.set('messages', []); renderChats(); }

export function renderChats() {
  $$('.chat').forEach((box) => {
    box.innerHTML = messages.map((m) => `<div class="msg ${m.role}" dir="auto">${esc(m.text)}${m.meta ? `<span class="meta" dir="ltr">${esc(m.meta)}</span>` : ''}${m.approval ? `<div class="approval-card"><div class="small">${esc(m.approval.consequences ?? '')}</div><div class="row" style="margin-top:8px"><button class="btn ok sm" data-approve="${m.approval.id}">${t('approve')}</button><button class="btn danger sm" data-reject="${m.approval.id}">${t('reject')}</button></div></div>` : ''}</div>`).join('')
      || `<p class="empty">${esc(t('try_hint'))}</p>`;
    box.scrollTop = box.scrollHeight;
  });
}

export async function send(text, channel = 'text') {
  if (!String(text).trim()) return;
  push({ role: 'user', text });
  setCoreState('thinking');
  try {
    const task = await api('/api/command', { method: 'POST', body: { text, conversationId, channel } });
    await handleTask(task, channel);
  } catch (e) { setCoreState('error'); push({ role: 'jarvis', text: e.message }); }
}

async function handleTask(task, channel) {
  const steps = task.plan?.steps?.map((s) => `${s.agent}:${s.tool}${s.verified ? '✓' : s.status === 'proposed' ? '?' : ''}`).join(' → ') ?? '';
  let approval = null;
  if (task.state === 'AWAITING_APPROVAL') {
    const list = await api('/api/approvals').catch(() => []);
    approval = list.find((a) => a.id === task.approvalId) ?? { id: task.approvalId };
  }
  push({ role: 'jarvis', text: task.response ?? task.error ?? task.state, meta: `${task.state}${steps ? ` · ${steps}` : ''}`, approval });
  setCoreState(task.state === 'FAILED' ? 'error' : approval ? 'approval' : 'idle');
  if ((channel === 'voice' || local.get('speakAll', false)) && task.response) speak(task.response);
  chatEvents.dispatchEvent(new Event('task'));
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-approve],[data-reject]');
  if (!b) return;
  const id = b.dataset.approve ?? b.dataset.reject;
  const decision = b.dataset.approve ? 'approve' : 'reject';
  if (decision === 'approve' && !(await confirmDialog(t('confirm_approve'), { okText: t('approve') }))) return;
  try {
    setCoreState('executing');
    const task = await api(`/api/approvals/${id}`, { method: 'POST', body: { decision } });
    messages.forEach((m) => { if (m.approval?.id === id) delete m.approval; });
    await handleTask(task);
  } catch (err) { toast(err.message); setCoreState('error'); }
});

voice.onFinal = (txt) => send(txt, 'voice');
voice.onInterim = (txt) => $$('.interim').forEach((x) => { x.textContent = txt; });

export function chatPanel({ cls = 'tall', title = true } = {}) {
  const el = document.createElement('div');
  el.className = 'panel glass corner';
  el.innerHTML = `${title ? `<h2>${t('conversation')}</h2>` : ''}<div class="chat ${cls}" aria-live="polite"></div><div class="interim muted small" dir="auto"></div>
    <form class="composer"><button type="button" class="mic-btn" aria-label="${t('talk')}">🎙</button><label class="mic-btn att-btn" title="${t('attach_image')}" aria-label="${t('attach_image')}">📎<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><input dir="auto" aria-label="${t('ask_ph')}" placeholder="${t('ask_ph')}"><button class="btn primary">${t('send')}</button></form>`;
  el.querySelector('.mic-btn').onclick = () => toggleListening();
  el.querySelector('.att-btn input').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 5e6) return toast('5 MB max');
    const input = el.querySelector('form input:not([type=file])');
    const prompt = input.value.trim(); input.value = '';
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
    push({ role: 'user', text: `🖼 ${f.name}${prompt ? ` · ${prompt}` : ''}` });
    setCoreState('thinking');
    try {
      const r = await api('/api/input', { method: 'POST', body: { kind: 'image', mediaType: f.type, data, prompt } });
      push({ role: 'jarvis', text: r.response, meta: `vision · ${r.state}` });
      setCoreState(r.state === 'FAILED' ? 'error' : 'idle');
    } catch (err) { push({ role: 'jarvis', text: err.message }); setCoreState('error'); }
  };
  el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const i = el.querySelector('input'); send(i.value); i.value = ''; };
  return el;
}
