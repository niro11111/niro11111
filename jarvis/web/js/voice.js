// Voice for JARVIS: hearing (speech → text) and speaking (text → speech), with three backends
// chosen automatically per place:
//   * claude.ai     - Claude's own dictation (Anthropic speech-to-text) and Claude voices (tts)
//   * any browser   - the browser's SpeechRecognition + speechSynthesis (website, HTML file, server)
//   * none          - typing / the keyboard's own dictation
// Every failure becomes a specific, actionable message (see diagnose()). The microphone only runs
// after a user action and the MIC ON indicator is visible the whole time it is live.
import { local, toast, $$ } from './api.js';
import { t, getLang } from './i18n.js';
import { setCoreState, getCoreState, setWave } from './core.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const he = () => getLang() === 'he';
export const voice = {
  supported: !!SR, rec: null, live: false, conversation: false,
  lang: local.get('voiceLang', 'he-IL'), rate: local.get('voiceRate', 1), voiceName: local.get('voiceName', ''), bargeIn: local.get('bargeIn', true),
  muted: local.get('voiceMuted', false), claudeVoice: local.get('claudeVoice', 'buttery'),
  cap: { dictation: null, tts: null }, // claude.ai capabilities (resolved asynchronously; null elsewhere)
  speaking: false, lastError: null, lastSpoken: '', onFinal: null, onInterim: null, onWakeText: null,
};
export const backends = () => ({ stt: voice.cap.dictation ? 'claude' : SR ? 'browser' : 'none', tts: voice.cap.tts ? 'claude' : 'speechSynthesis' in window ? 'browser' : 'none' });

// ---------- claude.ai capabilities ----------
const inClaude = () => !!window.claude?.use;
const capsReady = (async () => {
  if (!inClaude()) return;
  const use = (n) => Promise.race([window.claude.use(n), new Promise((r) => setTimeout(() => r(null), 10000))]).catch(() => null);
  const [d, tt] = await Promise.all([use('dictation'), use('tts')]);
  voice.cap.dictation = d; voice.cap.tts = tt;
  d?.onPartial(({ text }) => voice.onInterim?.(text));
  d?.onFinal(({ text }) => {
    const txt = text.trim(); if (!txt) return;
    voice.onInterim?.('');
    if (voice.wakeDictation) voice.onWakeText?.(txt); // continuous listening: the wake word decides
    else { voice.onFinal?.(txt); if (!voice.conversation) d.stop().catch(() => {}); }
  });
  d?.onState(({ state, reason }) => {
    const on = state !== 'idle';
    voice.live = on; indicator(on);
    if (on && state === 'listening') setCoreState('listening');
    if (!on) {
      if (getCoreState() === 'listening') setCoreState('idle');
      if (voice.wakeDictation) { voice.wakeDictation = false; dispatchEvent(new CustomEvent('jarvis:wake-ended', { detail: { reason } })); }
      if (reason && !['stopped', 'viewer_stopped', 'hidden'].includes(reason)) explain('claude-stt', reason);
    }
  });
  tt?.onState(({ state, reason }) => {
    voice.speaking = state !== 'idle';
    if (state === 'speaking') setCoreState('speaking');
    if (state === 'idle') { if (getCoreState() === 'speaking') setCoreState('idle'); if (reason && !['completed', 'stopped', 'replaced', 'viewer_stopped', 'hidden'].includes(reason)) explain('claude-tts', reason); }
  });
  dispatchEvent(new Event('jarvis:voice-ready'));
})();

// ---------- messages that say exactly what to do ----------
const MSG = {
  'browser:not-allowed': { he: 'המיקרופון חסום לדף הזה. לחצו על סמל המנעול או המיקרופון בשורת הכתובת, בחרו "אפשר" למיקרופון ורעננו.', en: 'The microphone is blocked for this page. Click the lock/microphone icon in the address bar, allow the microphone and reload.' },
  'browser:not-allowed-file': { he: 'זיהוי הדיבור של הדפדפן לא קיבל גישה כשהקובץ נפתח מהמחשב (file://). פתרונות: פתחו את JARVIS ב-claude.ai (שם יש זיהוי דיבור של Claude), או הריצו את השרת (npm start) ופתחו http://127.0.0.1:7777.', en: 'Browser speech recognition was refused for a page opened from disk (file://). Open JARVIS in claude.ai (Claude dictation works there) or run the server (npm start) and open http://127.0.0.1:7777.' },
  'browser:service-not-allowed': { he: 'הדפדפן לא מאפשר זיהוי דיבור כאן. נסו Chrome או Edge מעודכנים, או את JARVIS ב-claude.ai.', en: 'This browser does not allow speech recognition here. Try a current Chrome or Edge, or JARVIS in claude.ai.' },
  'browser:network': { he: 'זיהוי הדיבור של Chrome/Edge עובר דרך האינטרנט, ואין חיבור. בדקו את החיבור ונסו שוב.', en: 'Chrome/Edge speech recognition needs the internet and there is no connection.' },
  'browser:audio-capture': { he: 'לא נמצא מיקרופון. חברו מיקרופון או בדקו שהוא לא תפוס באפליקציה אחרת.', en: 'No microphone found. Connect one or check it is not in use by another app.' },
  'browser:language-not-supported': { he: 'השפה שנבחרה לא נתמכת בזיהוי הדיבור של הדפדפן. בחרו שפה אחרת בהגדרות הקול.', en: 'The chosen language is not supported by the browser recognizer. Pick another in the voice settings.' },
  'browser:unsupported': { he: 'הדפדפן הזה (למשל Firefox) לא תומך בזיהוי דיבור. השתמשו ב-Chrome או Edge, או ב-JARVIS בתוך claude.ai.', en: 'This browser (e.g. Firefox) has no speech recognition. Use Chrome or Edge, or JARVIS inside claude.ai.' },
  'claude-stt:not_granted': { he: 'ההכתבה כבויה לדף הזה. הפעילו אותה בתפריט ההרשאות של ה-Artifact (או אפשרו מיקרופון בדפדפן).', en: 'Dictation is off for this page. Turn it on in the artifact Permissions menu (or allow the microphone in the browser).' },
  'claude-stt:unavailable': { he: 'ההכתבה של Claude לא זמינה כאן (נתמכת ב-Chrome/Edge ובאפליקציית הדסקטופ, לא ב-Safari/Firefox או באפליקציות המובייל).', en: 'Claude dictation is not available here (Chrome/Edge and the desktop app; not Safari/Firefox or the mobile apps).' },
  'claude-stt:rate_limited': { he: 'יותר מדי הכתבות במקביל. נסו שוב בעוד רגע.', en: 'Too many dictations at once. Try again shortly.' },
  'claude-stt:upstream_error': { he: 'המיקרופון או שירות הזיהוי נכשלו. נסו שוב.', en: 'The microphone or the speech service failed. Try again.' },
  'claude-stt:no_gesture': { he: 'לחצו על כפתור המיקרופון כדי להתחיל להקשיב.', en: 'Click the microphone button to start listening.' },
  'claude-tts:not_granted': { he: 'הקראה בקול כבויה לדף הזה. הפעילו אותה בתפריט ההרשאות של ה-Artifact.', en: 'Reading aloud is off for this page. Turn it on in the artifact Permissions menu.' },
  'claude-tts:unavailable': { he: 'הקול של Claude לא זמין כרגע. התשובות מוצגות בטקסט.', en: 'Claude voice is unavailable right now. Answers are shown as text.' },
  'claude-tts:rate_limited': { he: 'הגעתם למגבלת ההקראה לעכשיו. נסו שוב מאוחר יותר.', en: 'Reading-aloud limit reached for now. Try again later.' },
  'claude-tts:no_gesture': { he: 'כדי לשמוע, לחצו 🔊 ליד התשובה.', en: 'To hear it, click 🔊 next to the answer.' },
  'browser-tts:no-hebrew-voice': { he: 'אין במכשיר קול עברי, ולכן לא שומעים את התשובות בעברית. פתרון מהיר: Microsoft Edge (יש בו קולות עבריים מובנים), או התקנת קול עברי (Windows: הגדרות ← זמן ושפה ← דיבור ← הוספת קולות ← עברית), או JARVIS ב-claude.ai (קול של Claude).', en: 'No Hebrew voice is installed, so Hebrew answers are silent. Quick fix: Microsoft Edge (built-in Hebrew voices), install a Hebrew voice (Windows: Settings → Time & language → Speech → Add voices → Hebrew), or JARVIS in claude.ai (Claude voice).' },
  'browser-tts:none': { he: 'הדפדפן הזה לא יודע להקריא טקסט.', en: 'This browser cannot read text aloud.' },
};
const shown = new Set();
export function explain(kind, code, { force = false } = {}) {
  const key = `${kind}:${code}`;
  const m = MSG[key] ?? MSG[`${kind}:upstream_error`] ?? { he: `${kind}: ${code}`, en: `${kind}: ${code}` };
  voice.lastError = { key, text: he() ? m.he : m.en, at: Date.now() };
  dispatchEvent(new CustomEvent('jarvis:voice-error', { detail: voice.lastError }));
  if (force || !shown.has(key)) { shown.add(key); toast(voice.lastError.text, 'high'); }
}

// ---------- microphone level meter (browser path only) ----------
let stream = null; let raf = 0; let audioCtx = null;
function indicator(on) {
  document.getElementById('micIndicator')?.classList.toggle('hidden', !on);
  $$('.mic-btn:not(.dict-btn):not(.att-btn), .talk-btn').forEach((b) => b.classList.toggle('live', on));
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

// ---------- hearing ----------
/** Start listening. MUST be called straight from a click/key press (Claude dictation requires it). */
export function startListening() {
  if (voice.live) return;
  if (voice.speaking) stopSpeaking();
  const d = voice.cap.dictation;
  if (d) {
    voice.wakeDictation = false;
    d.start().catch((e) => { if (e?.code && e.code !== 'stopped') explain('claude-stt', e.code); });
    return;
  }
  if (!SR) { explain('browser', 'unsupported', { force: true }); return; }
  const rec = new SR();
  rec.lang = voice.lang; rec.interimResults = true; rec.continuous = false;
  rec.onstart = () => { voice.live = true; indicator(true); setCoreState('listening'); startMeter(); };
  rec.onresult = (ev) => {
    const r = ev.results[ev.results.length - 1];
    const txt = r[0].transcript;
    voice.onInterim?.(txt);
    if (voice.speaking && voice.bargeIn) stopSpeaking(); // the user interrupted JARVIS
    if (r.isFinal) { voice.onInterim?.(''); voice.onFinal?.(txt); }
  };
  rec.onerror = (ev) => {
    if (['no-speech', 'aborted'].includes(ev.error)) return;
    const code = ev.error === 'not-allowed' && location.protocol === 'file:' ? 'not-allowed-file' : ev.error;
    explain('browser', code, { force: true });
  };
  rec.onend = () => { voice.live = false; indicator(false); stopMeter(); if (getCoreState() === 'listening') setCoreState('idle'); };
  voice.rec = rec;
  try { rec.start(); } catch { /* already started */ }
}
export function stopListening() { voice.cap.dictation?.stop().catch(() => {}); try { voice.rec?.stop(); } catch {} }
export function stopAll() { voice.conversation = false; stopListening(); stopSpeaking(); stopMeter(); }
export function toggleListening() { voice.live ? stopListening() : startListening(); }

/** claude.ai continuous listening for the wake word (called from the 👂 click). */
export function startWakeDictation() {
  const d = voice.cap.dictation; if (!d) return false;
  voice.wakeDictation = true;
  d.start().catch((e) => { voice.wakeDictation = false; if (e?.code && e.code !== 'stopped') explain('claude-stt', e.code, { force: true }); dispatchEvent(new CustomEvent('jarvis:wake-ended', { detail: { reason: e?.code } })); });
  return true;
}
export function stopWakeDictation() { voice.wakeDictation = false; voice.cap.dictation?.stop().catch(() => {}); }

// ---------- speaking ----------
const isHebrew = (s) => /[֐-׿]/.test(s);
export function cleanForSpeech(text) {
  return String(text ?? '').replace(/[‎‏]/g, '').replace(/```[\s\S]*?```/g, ' ').replace(/[•*#_>`|]/g, ' ')
    .replace(/https?:\/\/\S+/g, '').replace(/\s*\n+\s*/g, '. ').replace(/\s{2,}/g, ' ').replace(/(\.\s*){2,}/g, '. ').trim();
}
/** Splits text into sentence chunks of at most `max` characters (Chrome stops long utterances). */
export function chunkText(text, max = 180) {
  const parts = cleanForSpeech(text).split(/(?<=[.!?。؟])\s+/);
  const out = []; let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length <= max) { cur = (cur + ' ' + p).trim(); continue; }
    if (cur) out.push(cur);
    if (p.length <= max) { cur = p; continue; }
    let rest = p; while (rest.length > max) { const cut = rest.lastIndexOf(' ', max) > 40 ? rest.lastIndexOf(' ', max) : max; out.push(rest.slice(0, cut)); rest = rest.slice(cut).trim(); }
    cur = rest;
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

let voicesCache = [];
function loadVoices() { voicesCache = window.speechSynthesis?.getVoices() ?? []; return voicesCache; }
export function voicesReady() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (loadVoices().length) return Promise.resolve(voicesCache);
  return new Promise((r) => { const done = () => r(loadVoices()); speechSynthesis.addEventListener?.('voiceschanged', done, { once: true }); setTimeout(done, 1500); });
}
/** Best installed voice for a language: the user's choice, then neural/online voices, then any. */
export function pickVoice(lang, voices = voicesCache, preferred = voice.voiceName) {
  const base = lang.slice(0, 2).toLowerCase();
  const same = voices.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base) || (base === 'he' && /^iw/i.test(v.lang || '')));
  return same.find((v) => v.name === preferred) ?? same.find((v) => /natural|online|neural|google|premium|enhanced/i.test(v.name)) ?? same[0] ?? null;
}
let keepAlive = 0;
function speakBrowser(text) {
  const synth = window.speechSynthesis; if (!synth) { explain('browser-tts', 'none'); return; }
  synth.cancel();
  const lang = isHebrew(text) ? 'he-IL' : 'en-US';
  const v = pickVoice(lang);
  if (!v && lang === 'he-IL' && voicesCache.length) explain('browser-tts', 'no-hebrew-voice', { force: !shown.has('browser-tts:no-hebrew-voice') });
  const chunks = chunkText(text);
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = v?.lang ?? lang; if (v) u.voice = v; u.rate = voice.rate;
    let tick = 0;
    if (i === 0) u.onstart = () => { voice.speaking = true; setCoreState('speaking'); };
    u.onboundary = () => { tick++; setWave(Array.from({ length: 32 }, (_, k) => 0.25 + 0.6 * Math.abs(Math.sin(k * 0.7 + tick)))); };
    if (i === chunks.length - 1) u.onend = () => { voice.speaking = false; clearInterval(keepAlive); setWave(null); if (getCoreState() === 'speaking') setCoreState('idle'); if (voice.conversation) startListening(); };
    u.onerror = (e) => { if (!['interrupted', 'canceled'].includes(e.error)) { voice.speaking = false; voice.lastError = { key: `browser-tts:${e.error}`, text: e.error }; } };
    synth.speak(u);
  });
  // Chrome stops speaking long readings after ~15 s unless nudged.
  clearInterval(keepAlive);
  keepAlive = setInterval(() => { if (!synth.speaking) { clearInterval(keepAlive); return; } if (/Chrome/.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent)) { synth.pause(); synth.resume(); } }, 10000);
}
async function speakClaude(text) {
  const tt = voice.cap.tts;
  // Claude voice cannot speak while dictation listens; push-to-talk dictation is stopped first.
  if (voice.live && !voice.wakeDictation) await voice.cap.dictation?.stop().catch(() => {});
  const clean = cleanForSpeech(text);
  const lines = []; let cur = '';
  for (const s of clean.split(/(?<=[.!?])\s+/)) { if ((cur + ' ' + s).length > 1800) { if (cur) lines.push(cur); cur = s.slice(0, 1800); } else cur = `${cur} ${s}`.trim(); }
  if (cur) lines.push(cur);
  const language = isHebrew(clean) ? 'he' : 'en';
  try { await tt.speak(lines.slice(0, 100).map((x) => ({ text: x })), { voice: voice.claudeVoice, rate: voice.rate, language }); }
  catch (e) { if (e?.code && !['stopped'].includes(e.code)) explain('claude-tts', e.code === 'busy' ? 'no_gesture' : e.code); }
}
/** Speak a reply (respects mute). */
export function speak(text, { force = false } = {}) {
  if (!text || (voice.muted && !force)) return;
  voice.lastSpoken = text;
  if (voice.cap.tts) return speakClaude(text);
  return speakBrowser(text);
}
export function stopSpeaking() { try { voice.cap.tts?.stop().catch(() => {}); } catch {} window.speechSynthesis?.cancel(); clearInterval(keepAlive); voice.speaking = false; }
export function setMuted(m) { voice.muted = !!m; local.set('voiceMuted', voice.muted); if (m) stopSpeaking(); dispatchEvent(new Event('jarvis:voice-mute')); }

export function saveVoicePrefs() { local.set('voiceLang', voice.lang); local.set('voiceRate', voice.rate); local.set('voiceName', voice.voiceName); local.set('bargeIn', voice.bargeIn); local.set('claudeVoice', voice.claudeVoice); }

// ---------- diagnostics ----------
export async function diagnose() {
  await Promise.race([capsReady, new Promise((r) => setTimeout(r, 2500))]);
  const vs = await voicesReady();
  let mic = 'unknown';
  try { mic = (await navigator.permissions?.query({ name: 'microphone' }))?.state ?? 'unknown'; } catch { /* not queryable */ }
  const b = backends();
  const heVoices = vs.filter((v) => /^(he|iw)/i.test(v.lang || '')).map((v) => v.name);
  const browser = /Edg\//.test(navigator.userAgent) ? 'Edge' : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : /Firefox\//.test(navigator.userAgent) ? 'Firefox' : /Safari\//.test(navigator.userAgent) ? 'Safari' : 'other';
  const place = inClaude() ? 'claude.ai' : location.protocol === 'file:' ? 'file' : /^(localhost|127\.)/.test(location.hostname) ? 'local server' : 'website';
  const issues = [];
  if (b.stt === 'none') issues.push(MSG['browser:unsupported']);
  if (b.stt === 'browser' && mic === 'denied') issues.push(MSG['browser:not-allowed']);
  if (b.stt === 'browser' && place === 'file') issues.push({ he: 'נפתח מקובץ במחשב: אם המיקרופון לא עובד, הריצו את השרת או השתמשו ב-claude.ai.', en: 'Opened from a file: if the microphone fails, run the server or use claude.ai.' });
  if (b.tts === 'browser' && !heVoices.length) issues.push(MSG['browser-tts:no-hebrew-voice']);
  if (voice.muted) issues.push({ he: 'ההקראה מושתקת (🔇 בסרגל העליון).', en: 'Reading aloud is muted (🔇 in the top bar).' });
  if (inClaude() && !voice.cap.dictation) issues.push(MSG['claude-stt:unavailable']);
  return { place, browser, secure: window.isSecureContext, stt: b.stt, tts: b.tts, micPermission: mic, voices: vs.length, hebrewVoices: heVoices, chosenVoice: pickVoice(voice.lang)?.name ?? null, muted: voice.muted, lastError: voice.lastError, issues: issues.map((x) => (he() ? x.he : x.en)) };
}

window.addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'Space') { e.preventDefault(); toggleListening(); }
  if (e.key === 'Escape' && (voice.live || voice.speaking)) { stopAll(); setCoreState('idle'); }
});
