// Conversation state shared by every screen.
import { api, esc, local, toast, $$, confirmDialog, promptDialog } from './api.js';
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
    box.innerHTML = messages.map((m, i) => `<div class="msg ${m.role}" dir="auto">${m.role === 'jarvis' && m.text ? `<button class="say-btn" data-say="${i}" aria-label="${t('read_aloud')}" title="${t('read_aloud')}">🔊</button>` : ''}${esc(m.text)}${m.meta ?`<span class="meta" dir="ltr">${esc(m.meta)}</span>` : ''}${m.learned ? `<a class="tag info xs" href="#brain" style="margin-top:6px;display:inline-flex">🧠 ${t('learned_pill')}</a>` : ''}${m.taskId && m.role === 'jarvis' ? `<span class="fb row" style="margin-top:6px;gap:4px">${m.rated ? `<span class="xs muted">${m.rated > 0 ? '👍' : '👎'}</span>` : `<button class="btn sm" data-fb="1" data-tid="${m.taskId}" aria-label="good answer">👍</button><button class="btn sm" data-fb="-1" data-tid="${m.taskId}" aria-label="bad answer">👎</button>`}</span>` : ''}${m.outputs?.length ? `<div class="row" style="margin-top:8px">${m.outputs.map((o) => `<a class="btn sm" href="#ai">${o.type === 'app' ? '▶' : o.type === 'file' ? '📄' : '✦'} ${esc(o.title)} · ${t('open_studio')}</a>`).join('')}</div>` : ''}${m.approval ? `<div class="approval-card"><div class="small">${esc(m.approval.consequences ?? '')}</div><div class="row" style="margin-top:8px"><button class="btn ok sm" data-approve="${m.approval.id}">${t('approve')}</button><button class="btn danger sm" data-reject="${m.approval.id}">${t('reject')}</button></div></div>` : ''}</div>`).join('')
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
  // A rename / new wake word takes effect in the UI (brand, wake listener) immediately.
  if (task.state === 'COMPLETED' && task.plan?.tools?.some((x) => x === 'settings.rename' || x === 'settings.wake')) dispatchEvent(new Event('jarvis:persona'));
  const steps =task.plan?.steps?.map((s) => `${s.agent}:${s.tool}${s.verified ? '✓' : s.status === 'proposed' ? '?' : ''}`).join(' → ') ?? '';
  let approval = null;
  if (task.state === 'AWAITING_APPROVAL') {
    const list = await api('/api/approvals').catch(() => []);
    approval = list.find((a) => a.id === task.approvalId) ?? { id: task.approvalId };
  }
  push({ role: 'jarvis', text: task.response ?? task.error ?? task.state, meta: `${task.state}${task.analysis ? ` · ${task.analysis.kind} · ${task.analysis.strategy}` : ''}${steps ? ` · ${steps}` : ''}`, approval, outputs: task.outputs, taskId: task.id, learned: task.learned });
  if (local.get('dictation', false)) setTimeout(() => document.querySelector('.composer input[dir=auto]')?.focus(), 50);
  setCoreState(task.state === 'FAILED' ? 'error' : approval ? 'approval' : 'idle');
  // Answers are read aloud by default (🔇 in the top bar mutes; the setting "speak every answer" can limit it to voice requests).
  if ((channel === 'voice' || local.get('speakAll', true)) && task.response) speak(task.response);
  chatEvents.dispatchEvent(new Event('task'));
}

document.addEventListener('click', async (e) => {
  const say = e.target.closest('[data-say]');
  if (say) { const m = messages[Number(say.dataset.say)]; if (m?.text) speak(m.text, { force: true }); return; }
  const f = e.target.closest('[data-fb]');
  if (f) {
    const rating = Number(f.dataset.fb);
    const note = rating < 0 ? (await promptDialog(t('feedback_ph'), '')) ?? '' : '';
    try { await api('/api/brain/feedback', { method: 'POST', body: { taskId: f.dataset.tid, rating, note } }); messages.forEach((m) => { if (m.taskId === f.dataset.tid) m.rated = rating; }); local.set('messages', messages); renderChats(); toast(t('thanks')); }
    catch (err) { toast(err.message); }
    return;
  }
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
  el.innerHTML = `${title ? `<h2>${t('conversation')}</h2>` : ''}<div class="chat ${cls}" aria-live="polite"></div><div class="interim muted small" dir="auto"></div><p class="dict-hint xs muted hidden" style="margin:6px 0 0">${t('dictation_on')} ${t('dict_hint')}</p>
    <form class="composer"><button type="button" class="mic-btn" aria-label="${t('talk')}">🎙</button><button type="button" class="mic-btn dict-btn" aria-pressed="false" title="${t('dictation')}" aria-label="${t('dictation')}">⌨</button><label class="mic-btn att-btn" title="${t('attach_image')}" aria-label="${t('attach_image')}">📎<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><input dir="auto" aria-label="${t('ask_ph')}" placeholder="${t('ask_ph')}"><button class="btn primary">${t('send')}</button></form>`;
  el.querySelector('.mic-btn').onclick = () => toggleListening();
  // Dictation mode: the OS dictation (keyboard mic, Win+H, Fn Fn) types into the field and
  // JARVIS sends after a short pause, for a hands-free conversation where the browser mic is blocked.
  const dict = el.querySelector('.dict-btn'); const hint = el.querySelector('.dict-hint');
  const text = el.querySelector('form input:not([type=file])');
  const setDict = (on) => { local.set('dictation', on); dict.setAttribute('aria-pressed', String(on)); dict.classList.toggle('live', on); hint.classList.toggle('hidden', !on); if (on) text.focus(); };
  setDict(local.get('dictation', false));
  dict.onclick = () => setDict(!local.get('dictation', false));
  let pause;
  text.addEventListener('input', () => {
    if (!local.get('dictation', false)) return;
    clearTimeout(pause);
    pause = setTimeout(() => { if (text.value.trim().length > 1) el.querySelector('form').requestSubmit(); }, 1800);
  });
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
  el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const i = el.querySelector('input:not([type=file])'); send(i.value); i.value = ''; };
  return el;
}
