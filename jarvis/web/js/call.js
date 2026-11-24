// Voice call with JARVIS: a hands-free conversation. JARVIS listens → you speak → he answers aloud
// → he listens again, by himself, until you hang up. You can interrupt him while he speaks (his own
// voice from the speakers is recognized and ignored). Space = push-to-talk, M = mute, Esc = hang up.
//
// Browser recognition (website, server, Chrome/Edge HTML file): fully hands-free.
// claude.ai: Claude dictation may only start from a click or key press, so after each answer the
// call waits for one tap or the Space key. This is a platform rule, and the screen says so.
import { esc, local } from './api.js';
import { getLang } from './i18n.js';
import { voice, startListening, stopListening, stopSpeaking, backends, saveVoicePrefs } from './voice.js';
import { send } from './chat.js';
import { wake } from './wakeui.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
const call = { active: false, phase: 'idle', micMuted: false, el: null, saved: null, restarts: [], lines: [], startedAt: 0, timer: 0 };
export const callState = call;

const PHASE = {
  listening: ['Listening…', 'מקשיב…'], thinking: ['Thinking…', 'חושב…'], speaking: ['Speaking (talk to interrupt)', 'מדבר (אפשר לקטוע)'],
  tap: ['Tap or hold Space to talk', 'הקישו או החזיקו רווח כדי לדבר'], paused: ['Microphone muted', 'המיקרופון מושתק'], error: ['Microphone problem', 'בעיה במיקרופון'], idle: ['', ''],
};
const handsFree = () => backends().stt === 'browser';

function setPhase(p, note = '') {
  call.phase = p;
  if (!call.el) return;
  call.el.dataset.phase = p;
  call.el.querySelector('.call-phase').textContent = L(...PHASE[p]);
  call.el.querySelector('.call-note').textContent = note;
  call.el.querySelector('.call-mute').setAttribute('aria-pressed', String(call.micMuted));
  call.el.querySelector('.call-mute').textContent = call.micMuted ? '🎙✕' : '🎙';
}
function addLine(who, text) {
  call.lines.push({ who, text }); if (call.lines.length > 6) call.lines.shift();
  const box = call.el?.querySelector('.call-log'); if (!box) return;
  box.innerHTML = call.lines.map((l) => `<div class="cl ${l.who}" dir="auto"><b>${l.who === 'you' ? L('You', 'את/ה') : 'JARVIS'}</b> ${esc(l.text.length > 220 ? `${l.text.slice(0, 220)}…` : l.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

/** Listen now. Called from a click/key (claude.ai needs that) or automatically (browser). */
function listen() {
  if (!call.active || call.micMuted || voice.live) return;
  setPhase('listening');
  startListening();
}
function listenSoon() {
  if (!call.active) return;
  if (call.micMuted) { setPhase('paused'); return; }
  if (!handsFree()) { setPhase('tap'); return; }
  // Restart guard: a microphone that ends instantly over and over is not going to work.
  const now = Date.now(); call.restarts = call.restarts.filter((x) => now - x < 8000); call.restarts.push(now);
  if (call.restarts.length > 6) { setPhase('error', L('The microphone keeps stopping. Check the permission and the selected microphone (Settings → Hearing & Voice).', 'המיקרופון נעצר שוב ושוב. בדקו את ההרשאה ואת המיקרופון שנבחר (הגדרות ← שמיעה וקול).')); return; }
  setTimeout(listen, 250);
}

// ---------- events from voice and chat ----------
const on = {
  final: (txt) => {
    if (!call.active) return;
    addLine('you', txt); setPhase('thinking');
    send(txt, 'voice');
  },
  interim: (txt) => { const el = call.el?.querySelector('.call-live'); if (el) el.textContent = txt; },
  answered: (e) => {
    if (!call.active) return;
    if (e.detail.text) addLine('jarvis', e.detail.text);
    if (e.detail.approval) { setPhase(handsFree() ? 'tap' : 'tap', L('Waiting for your approval in the chat.', 'ממתין לאישור שלך בצ׳אט.')); return; }
    if (e.detail.spoken) { setPhase('speaking'); if (voice.bargeIn && handsFree() && !call.micMuted) setTimeout(() => { if (voice.speaking) startListening(); }, 400); }
    else listenSoon();
  },
  speechEnd: () => { if (call.active && call.phase !== 'thinking') { if (voice.live && handsFree()) setPhase('listening'); else listenSoon(); } },
  listenEnded: () => { if (call.active && call.phase === 'listening') listenSoon(); },
  listenFailed: (e) => { if (call.active) setPhase('error', voice.lastError?.text ?? e.detail?.code ?? ''); },
  key: (e) => {
    if (!call.active) return;
    if (e.key === 'Escape') { e.preventDefault(); endCall(); return; }
    if (e.target.closest?.('input, textarea')) return;
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (voice.speaking) stopSpeaking(); if (!voice.live) { call.ptt = true; listen(); } }
    if (e.key === 'm' || e.key === 'M' || e.key === 'מ') toggleMic();
  },
  keyup: (e) => { if (call.active && e.code === 'Space' && call.ptt) { call.ptt = false; e.preventDefault(); if (!handsFree() || voice.silenceMs > 0) stopListening(); } },
};

function toggleMic() {
  call.micMuted = !call.micMuted;
  if (call.micMuted) { stopListening(); setPhase('paused'); } else listen();
}

/** Start a call. MUST run straight from the click/key (Claude dictation and some browsers require it). */
export function startCall() {
  if (call.active) return;
  call.active = true; call.lines = []; call.restarts = []; call.micMuted = false; call.startedAt = Date.now();
  // During a call: send what was heard at once, keep a natural pause length, read answers aloud.
  // Only one recognizer can run: the wake-word listener pauses during the call.
  call.wakeWasOn = !!wake.state.enabled && !voice.cap.dictation; if (call.wakeWasOn) wake.disable();
  call.saved = { onFinal: voice.onFinal, onInterim: voice.onInterim, autoSend: voice.autoSend, conversation: voice.conversation, muted: voice.muted };
  voice.onFinal = on.final; voice.onInterim = on.interim; voice.autoSend = true; voice.conversation = false; voice.call = true; voice.muted = false;
  if (!voice.silenceMs) { voice.silenceMs = 1200; saveVoicePrefs(); }
  const el = document.createElement('div');
  el.className = 'call-overlay'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', L('Voice call with JARVIS', 'שיחה קולית עם ג׳ארוויס'));
  el.innerHTML = `<div class="call-card glass">
    <div class="call-top"><span class="call-dot"></span><b>${L('Call with JARVIS', 'שיחה עם ג׳ארוויס')}</b><span class="call-time xs muted">00:00</span></div>
    <button class="call-orb" aria-label="${L('Talk', 'דבר')}"><span></span><span></span><span></span></button>
    <div class="call-phase" aria-live="polite"></div>
    <div class="call-live muted" dir="auto"></div>
    <div class="call-note xs"></div>
    <div class="call-log"></div>
    <div class="call-ctrl"><button class="call-mute btn" aria-pressed="false" title="M">🎙</button><button class="call-end btn danger" title="Esc">✆ ${L('Hang up', 'נתק')}</button></div>
    <div class="xs muted">${handsFree() ? L('Just talk. Space: push-to-talk · M: mute · Esc: hang up', 'פשוט מדברים. רווח: לחיצה לדיבור · M: השתקה · Esc: ניתוק') : L('In claude.ai each turn starts with a tap or the Space key (a platform rule). Hold Space while you talk.', 'ב-claude.ai כל תור מתחיל בהקשה או במקש רווח (כלל של הפלטפורמה). החזיקו רווח בזמן שאתם מדברים.')}</div>
  </div>`;
  document.body.append(el); call.el = el;
  el.querySelector('.call-orb').onclick = () => { if (voice.speaking) stopSpeaking(); if (voice.live) stopListening(); else { call.micMuted = false; listen(); } };
  el.querySelector('.call-mute').onclick = toggleMic;
  el.querySelector('.call-end').onclick = endCall;
  addEventListener('jarvis:answered', on.answered); addEventListener('jarvis:speech-end', on.speechEnd);
  addEventListener('jarvis:listen-ended', on.listenEnded); addEventListener('jarvis:listen-failed', on.listenFailed);
  addEventListener('keydown', on.key, true); addEventListener('keyup', on.keyup, true);
  call.timer = setInterval(() => { const s = Math.floor((Date.now() - call.startedAt) / 1000); const t = el.querySelector('.call-time'); if (t) t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  listen(); // first listen happens inside the click: allowed everywhere
  if (!voice.live && !handsFree() && !voice.cap.dictation) setPhase('error', L('This browser cannot recognize speech. Use Chrome or Edge, or JARVIS in claude.ai.', 'הדפדפן הזה לא מזהה דיבור. השתמשו ב-Chrome או Edge, או ב-JARVIS בתוך claude.ai.'));
  local.set('callsStarted', local.get('callsStarted', 0) + 1);
}

export function endCall() {
  if (!call.active) return;
  call.active = false; voice.call = false;
  stopListening(); stopSpeaking();
  Object.assign(voice, { onFinal: call.saved.onFinal, onInterim: call.saved.onInterim, autoSend: call.saved.autoSend, conversation: call.saved.conversation, muted: call.saved.muted });
  removeEventListener('jarvis:answered', on.answered); removeEventListener('jarvis:speech-end', on.speechEnd);
  removeEventListener('jarvis:listen-ended', on.listenEnded); removeEventListener('jarvis:listen-failed', on.listenFailed);
  removeEventListener('keydown', on.key, true); removeEventListener('keyup', on.keyup, true);
  clearInterval(call.timer); call.el?.remove(); call.el = null; call.phase = 'idle';
  if (call.wakeWasOn) setTimeout(() => wake.enable(), 400);
}
export const toggleCall = () => (call.active ? endCall() : startCall());
