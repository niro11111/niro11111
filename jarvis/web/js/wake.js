// Wake word ("Hey JARVIS" / "ג'ארוויס") - pure matching (tested in Node) + a browser controller.
//
// Matching is tolerant on purpose: speech recognition writes names in many ways ("ג'ארוויס",
// "גארוויס", "ג׳רביס", "jarvis", "jervis"). We normalize both sides, also compare a phonetic
// skeleton, and accept a small edit distance relative to the phrase length.
//
// Privacy: wake mode uses the browser's speech recognition, which in Chrome/Edge sends audio to
// the browser vendor's speech service while listening. The UI says so before it is turned on, a
// visible indicator stays on the whole time, and it stops when turned off or the tab is closed.

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export function normalizeSpeech(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[׳'`"״’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Hebrew letters → rough Latin sounds, so "ג'ארוויס" and "jarvis" can meet in the middle.
const HE2LAT = { 'א': 'a', 'ב': 'v', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'h', 'ט': 't', 'י': 'i', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n', 'ס': 's', 'ע': 'a', 'פ': 'f', 'צ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't' };
/** Phonetic skeleton: transliterate, merge similar sounds, drop vowels except the first letter. */
export function skeleton(word) {
  let w = normalizeSpeech(word).replace(/\s/g, '').replace(/[א-ת]/g, (c) => HE2LAT[c] ?? '');
  w = w.replace(/^j/, 'g').replace(/dj|dzh|zh|j/g, 'g').replace(/w|b/g, 'v').replace(/ph/g, 'f').replace(/c(?=[eiy])/g, 's').replace(/ck|c|q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/y/g, 'i').replace(/(.)\1+/g, '$1');
  return w ? w[0] + w.slice(1).replace(/[aeiouh]/g, '') : '';
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const KNOWN = { jarvis: ['jarvis', 'ג׳ארוויס', 'גארוויס', 'ג׳רוויס', 'ג׳ארביס', 'jervis', 'jarves'] };
/** Wake phrases for a name and an optional custom wake word (plus "hey/היי" forms). */
export function wakePhrases(name = 'JARVIS', custom = '') {
  const base = new Set();
  for (const p of [name, custom].map((x) => String(x ?? '').trim()).filter(Boolean)) {
    base.add(p);
    for (const v of KNOWN[normalizeSpeech(p).replace(/\s/g, '')] ?? []) base.add(v);
  }
  return [...base].map(normalizeSpeech).filter((p) => p.length >= 2);
}

function similar(a, b) {
  const x = a.replace(/\s/g, ''); const y = b.replace(/\s/g, '');
  if (x === y) return 0;
  // An inexact match must have about the same length ("jars" is 2 edits from "jarvis" but is another word).
  if (Math.abs(x.length - y.length) > Math.max(1, Math.round(y.length * 0.2))) return null;
  const tol = Math.max(1, Math.floor(y.length / 5)); // about one edit per five letters
  const d = levenshtein(x, y);
  if (d <= tol) return d / Math.max(1, y.length);
  // Phonetic path: only for words of similar length (so "מחשבון" ≠ "מחשב"), and an inexact
  // skeleton only when both skeletons have at least 4 sounds (so "jars" ≠ "jarvis").
  if (Math.abs(x.length - y.length) > Math.max(1, Math.round(y.length * 0.25))) return null;
  const sx = skeleton(a); const sy = skeleton(b);
  if (sx.length < 3 || sy.length < 3) return null;
  const ds = levenshtein(sx, sy);
  // Speech recognition mostly confuses the FIRST sound (J/CH/G/H): allow a difference only there.
  if (ds === 0 || (ds === 1 && sx.length >= 4 && sx.slice(1) === sy.slice(1))) return 0.3 + ds / 10;
  return null;
}

/**
 * Looks for a wake phrase near the start of the transcript (first 4 words, optionally after
 * "hey"/"היי"/"okay"). Returns the command that follows it, if any.
 * @returns {{matched:boolean, phrase?:string, score?:number, command?:string}}
 */
export function matchWake(transcript, phrases) {
  // Normalize word by word, keeping each word's original form: matching uses the normalized
  // words, but the command is returned exactly as spoken (Hebrew final letters, punctuation).
  const raw = String(transcript ?? '').trim().split(/\s+/).map((w) => ({ w, n: normalizeSpeech(w) })).filter((x) => x.n);
  const words = raw.map((x) => x.n.replace(/\s/g, ''));
  if (!words.length) return { matched: false };
  let best = null;
  for (const p of phrases) {
    const n = p.split(' ').length;
    for (let i = 0; i <= Math.min(3, words.length - 1); i++) {
      for (const len of new Set([n, n + 1, Math.max(1, n - 1)])) {
        if (i + len > words.length) continue;
        const s = similar(words.slice(i, i + len).join(' '), p);
        if (s !== null && (!best || s < best.score)) best = { phrase: p, score: s, end: i + len, start: i };
      }
    }
  }
  if (!best) return { matched: false };
  // Words before the name may only be a greeting.
  const before = words.slice(0, best.start);
  if (before.some((w) => !/^(hey|hi|ok|okay|היי|הי|אהלנ|יו|שלומ|נו|בוקר|טוב|ערב)$/.test(w))) return { matched: false };
  const command = raw.slice(best.end).map((x) => x.w).join(' ').replace(/^[\s,،:;.!?-]+/, '').trim();
  return { matched: true, phrase: best.phrase, score: +best.score.toFixed(3), command };
}

// ---------------- browser controller ----------------
/**
 * Continuous wake-word listening with the browser's speech recognition.
 * @param {{lang:string, phrases:()=>string[], onWake:()=>void, onCommand:(text:string)=>void, onState:(s:string)=>void, isBusy:()=>boolean}} o
 */
export function createWakeListener(o) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const st = { enabled: false, rec: null, awaitingCommand: 0, restarts: 0, lastError: null };
  const set = (s) => o.onState?.(s);
  function start() {
    if (!SR) { st.lastError = 'not-supported'; set('unsupported'); return false; }
    if (st.rec) return true;
    const rec = new SR();
    rec.lang = o.lang?.() ?? 'he-IL'; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 3;
    rec.onresult = (ev) => {
      if (o.isBusy?.()) return; // never react to JARVIS's own voice or to push-to-talk
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        const alts = [...ev.results[i]].map((a) => a.transcript);
        if (st.awaitingCommand && Date.now() < st.awaitingCommand) { st.awaitingCommand = 0; set('listening'); o.onCommand(alts[0]); continue; }
        for (const text of alts) {
          const m = matchWake(text, o.phrases());
          if (!m.matched) continue;
          if (m.command && m.command.length >= 2) { set('heard'); o.onCommand(m.command); }
          else { st.awaitingCommand = Date.now() + 8000; set('awake'); o.onWake?.(); }
          break;
        }
      }
    };
    rec.onerror = (ev) => { st.lastError = ev.error; if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(ev.error)) { st.enabled = false; set(`blocked:${ev.error}`); } };
    rec.onend = () => {
      st.rec = null;
      // Chrome ends continuous recognition after silence: restart while enabled (with backoff on errors).
      if (st.enabled) { const delay = Math.min(5000, 250 * 2 ** Math.min(4, st.restarts++)); setTimeout(() => { if (st.enabled) start(); }, delay); }
      else set('off');
    };
    rec.onstart = () => { st.restarts = 0; set(st.awaitingCommand ? 'awake' : 'listening'); };
    st.rec = rec;
    try { rec.start(); } catch { /* already running */ }
    return true;
  }
  return {
    state: st,
    enable() { st.enabled = true; return start(); },
    disable() { st.enabled = false; st.awaitingCommand = 0; try { st.rec?.stop(); } catch {} st.rec = null; set('off'); },
    pause() { try { st.rec?.abort(); } catch {} },
  };
}
