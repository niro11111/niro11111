// Voice: browser speech recognition (he-IL / en-US), speech synthesis, push-to-talk,
// barge-in, and a live mic-level visualisation. The microphone only runs after a user
// action and the MIC ON indicator is visible the whole time it is live.
import { local, toast, $$ } from './api.js';
import { t } from './i18n.js';
import { setCoreState, getCoreState, setWave } from './core.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voice = { supported: !!SR, rec: null, live: false, conversation: false, lang: local.get('voiceLang', 'he-IL'), rate: local.get('voiceRate', 1), voiceName: local.get('voiceName', ''), bargeIn: local.get('bargeIn', true), onFinal: null, onInterim: null };
let stream = null; let raf = 0; let audioCtx = null;

function indicator(on) {
  document.getElementById('micIndicator')?.classList.toggle('hidden', !on);
  $$('.mic-btn, .talk-btn').forEach((b) => b.classList.toggle('live', on));
}

async function startMeter() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const an = audioCtx.createAnalyser(); an.fftSize = 128;
    audioCtx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const loop = () => { an.getByteFrequencyData(buf); setWave(Array.from(buf.slice(2, 34), (x) => x / 255)); raf = requestAnimationFrame(loop); };
    loop();
  } catch { /* meter is optional; recognition still works */ }
}
function stopMeter() { cancelAnimationFrame(raf); stream?.getTracks().forEach((tr) => tr.stop()); stream = null; audioCtx?.close().catch(() => {}); audioCtx = null; setWave(null); }

export function startListening() {
  if (!SR) { toast(t('no_stt')); return; }
  if (voice.live) return;
  const rec = new SR();
  rec.lang = voice.lang; rec.interimResults = true; rec.continuous = false;
  rec.onstart = () => { voice.live = true; indicator(true); setCoreState('listening'); startMeter(); };
  rec.onresult = (ev) => {
    const r = ev.results[ev.results.length - 1];
    const txt = r[0].transcript;
    voice.onInterim?.(txt);
    if (speechSynthesis.speaking && voice.bargeIn) speechSynthesis.cancel(); // user interrupted JARVIS
    if (r.isFinal) { voice.onInterim?.(''); voice.onFinal?.(txt); }
  };
  rec.onerror = (ev) => { if (!['no-speech', 'aborted'].includes(ev.error)) toast(`Microphone: ${ev.error}`); };
  rec.onend = () => { voice.live = false; indicator(false); stopMeter(); if (getCoreState() === 'listening') setCoreState('idle'); };
  voice.rec = rec;
  try { rec.start(); } catch { /* already started */ }
}
export function stopAll() { voice.conversation = false; voice.rec?.stop(); speechSynthesis.cancel(); stopMeter(); }
export function toggleListening() { voice.live ? voice.rec?.stop() : startListening(); }

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const clean = text.replace(/[‎‏]/g, '').replace(/[•*#]/g, '').slice(0, 1400);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = /[֐-׿]/.test(clean) ? 'he-IL' : 'en-US';
  u.rate = voice.rate;
  const v = speechSynthesis.getVoices().find((x) => x.name === voice.voiceName && x.lang.slice(0, 2) === u.lang.slice(0, 2));
  if (v) u.voice = v;
  let tick = 0;
  u.onstart = () => setCoreState('speaking');
  u.onboundary = () => { tick++; setWave(Array.from({ length: 32 }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.7 + tick)))); };
  u.onend = () => { if (getCoreState() === 'speaking') setCoreState('idle'); if (voice.conversation) startListening(); };
  speechSynthesis.speak(u);
  if (voice.conversation && voice.bargeIn) setTimeout(startListening, 500);
}

export function saveVoicePrefs() { local.set('voiceLang', voice.lang); local.set('voiceRate', voice.rate); local.set('voiceName', voice.voiceName); local.set('bargeIn', voice.bargeIn); }

window.addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'Space') { e.preventDefault(); toggleListening(); }
  if (e.key === 'Escape') { stopAll(); setCoreState('idle'); }
});
