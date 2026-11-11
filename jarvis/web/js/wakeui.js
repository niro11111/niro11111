// Assistant name + wake word in the UI: the brand shows the current name, the 👂 button turns
// wake mode on/off (with a one-time privacy notice), and a heard command goes to the chat as voice.
import { api, toast, $$, local, confirmDialog } from './api.js';
import { t, getLang } from './i18n.js';
import { setCoreState } from './core.js';
import { send } from './chat.js';
import { voice, startWakeDictation, stopWakeDictation, setMuted } from './voice.js';
import { createWakeListener, wakePhrases, matchWake } from './wake.js';

export const persona = { name: 'JARVIS', wakeWord: '' };
const he = () => getLang() === 'he';
const brandOf = (n) => (/^[A-Za-z]{2,10}$/.test(n) ? n.toUpperCase().split('').join('.') : n);
export const wakeWordOf = () => persona.wakeWord || persona.name;
export const testWake = (text) => matchWake(text, wakePhrases(persona.name, persona.wakeWord));

function chime(up = true) { // short audible cue
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = up ? 880 : 660; o.frequency.linearRampToValueAtTime(up ? 1320 : 990, ctx.currentTime + 0.12);
    g.gain.value = 0.06; g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.26); setTimeout(() => ctx.close(), 400);
  } catch { /* audio is optional */ }
}

function render(state) {
  const b = document.getElementById('wakeBtn'); if (!b) return;
  const on = wake.state.enabled;
  b.classList.toggle('live', on && !state.startsWith('blocked'));
  b.classList.toggle('awake', state === 'awake');
  b.setAttribute('aria-pressed', String(on));
  const label = document.getElementById('wakeLabel');
  if (label) label.textContent = state === 'awake' ? (he() ? 'כן?' : 'Yes?') : on ? `"${wakeWordOf()}"` : '';
  b.title = state.startsWith('blocked') ? (he() ? 'המיקרופון חסום כאן' : 'Microphone blocked here')
    : on ? (he() ? `מאזין למילה "${wakeWordOf()}". לחצו לכיבוי` : `Listening for "${wakeWordOf()}". Click to turn off`) : (he() ? `הפעלת מילת השכמה ("${wakeWordOf()}")` : `Turn on the wake word ("${wakeWordOf()}")`);
}

export const wake = createWakeListener({
  lang: () => voice.lang,
  phrases: () => wakePhrases(persona.name, persona.wakeWord),
  onWake: () => { chime(); setCoreState('listening'); },
  onCommand: (txt) => { chime(false); send(txt, 'voice'); },
  onState: (st) => {
    render(st);
    if (st.startsWith('blocked')) { local.set('wakeEnabled', false); toast(he() ? 'המיקרופון חסום כאן (למשל בתוך claude.ai). השתמשו באתר, באפליקציה או בגרסת המחשב.' : 'The microphone is blocked here (e.g. inside claude.ai). Use the website, the app or the desktop version.'); }
    if (st === 'unsupported') toast(t('no_stt'));
  },
  isBusy: () => voice.live || voice.speaking || (window.speechSynthesis?.speaking ?? false),
});

// ---------- claude.ai: wake word through Claude dictation ----------
// Dictation must start straight from the click, so this path has no extra dialog (the platform asks
// for consent itself). While it listens, Claude's voice cannot speak: answers appear as text, with 🔊.
const claudeWake = { on: false, awaitingUntil: 0 };
voice.onWakeText = (txt) => {
  if (claudeWake.awaitingUntil > Date.now()) { claudeWake.awaitingUntil = 0; render('listening'); chime(false); send(txt, 'voice'); return; }
  const m = matchWake(txt, wakePhrases(persona.name, persona.wakeWord));
  if (!m.matched) return;
  if (m.command && m.command.length >= 2) { chime(false); render('heard'); send(m.command, 'voice'); }
  else { claudeWake.awaitingUntil = Date.now() + 8000; chime(); render('awake'); setCoreState('listening'); }
};
addEventListener('jarvis:wake-ended', () => { claudeWake.on = false; wake.state.enabled = false; render('off'); });
function toggleClaudeWake() {
  if (claudeWake.on) { stopWakeDictation(); claudeWake.on = false; wake.state.enabled = false; render('off'); return; }
  if (startWakeDictation()) { claudeWake.on = true; wake.state.enabled = true; render('listening'); toast(he() ? `מאזין ל"${wakeWordOf()}". כאן התשובות מוצגות בטקסט; לחצו 🔊 ליד תשובה כדי לשמוע אותה.` : `Listening for "${wakeWordOf()}". Here answers are shown as text; click 🔊 next to one to hear it.`); }
}

function renderMute() { const b = document.getElementById('muteBtn'); if (!b) return; b.textContent = voice.muted ? '🔇' : '🔊'; b.setAttribute('aria-pressed', String(voice.muted)); b.title = voice.muted ? (he() ? 'ההקראה מושתקת. לחצו להפעלה' : 'Reading aloud is muted. Click to unmute') : (he() ? 'התשובות מוקראות בקול. לחצו להשתקה' : 'Answers are read aloud. Click to mute'); }

export function applyPersona() {
  $$('.brandmark').forEach((b) => { b.textContent = brandOf(persona.name); });
  document.documentElement.dataset.assistant = persona.name;
  render(wake.state.enabled ? 'listening' : 'off');
}
export async function loadPersona() { try { Object.assign(persona, await api('/api/settings/personality')); } catch { /* not signed in yet */ } applyPersona(); }

export async function toggleWake() {
  if (wake.state.enabled) { wake.disable(); local.set('wakeEnabled', false); return false; }
  if (!local.get('wakeConsent', false)) {
    const ok = await confirmDialog(he()
      ? `במצב מילת השכמה המיקרופון פתוח כל עוד הדף פתוח, ו-${persona.name} מגיב כשאומרים "${wakeWordOf()}" (למשל: "${wakeWordOf()}, מה יש לי היום?"). הזיהוי נעשה על ידי הדפדפן: ב-Chrome וב-Edge הקול נשלח לשירות הזיהוי של הדפדפן. אפשר לכבות בכל רגע בכפתור 👂.`
      : `Wake mode keeps the microphone open while this page is open, and ${persona.name} answers when you say "${wakeWordOf()}" (e.g. "${wakeWordOf()}, what's on today?"). Recognition is done by the browser: Chrome and Edge send audio to their speech service. Turn it off any time with 👂.`, { okText: he() ? 'הפעל' : 'Enable' });
    if (!ok) return false;
    local.set('wakeConsent', true);
  }
  const started = wake.enable();
  if (started) local.set('wakeEnabled', true);
  return started;
}

export function initWake() {
  // Claude dictation needs the click itself: decide synchronously, before anything is awaited.
  document.getElementById('wakeBtn')?.addEventListener('click', () => (voice.cap.dictation ? toggleClaudeWake() : toggleWake()));
  document.getElementById('muteBtn')?.addEventListener('click', () => { setMuted(!voice.muted); renderMute(); });
  renderMute();
  addEventListener('jarvis:persona', loadPersona);
  loadPersona().then(() => { if (local.get('wakeEnabled', false) && local.get('wakeConsent', false)) wake.enable(); });
}
