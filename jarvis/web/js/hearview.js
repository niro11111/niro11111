// Settings → Hearing & voice. Everything that decides whether JARVIS hears you and how he answers,
// in one place, with live checks: a real microphone level meter, a real recognition test that
// shows exactly what was heard (and the recognizer's confidence), and a real speaker test.
import { esc, toast, $, $$, local } from './api.js';
import { getLang } from './i18n.js';
import { voice, saveVoicePrefs, startListening, stopListening, speak, diagnose, listMics, micLevel, voicesReady, backends } from './voice.js';
import { setWakeSensitivity } from './wake.js';
import { wake, wakeWordOf, toggleWake, testWake } from './wakeui.js';

const he = () => getLang() === 'he';
const L = (en, h) => (he() ? h : en);
let meter = null;
const stopMeter = () => { meter?.stop(); meter = null; };
addEventListener('hashchange', stopMeter);

const LANGS = [['he-IL', 'עברית'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar-IL', 'العربية'], ['ru-RU', 'Русский'], ['fr-FR', 'Français'], ['es-ES', 'Español']];
setWakeSensitivity(local.get('wakeSensitivity', 'normal'));

export async function hearView(v) {
  const b = backends();
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(cur) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  v.innerHTML = `<div class="grid">
  <div class="c6 col">
    <div class="panel glass corner"><h2>🎙 ${L('Microphone: does JARVIS hear you?', 'מיקרופון: האם ג׳ארוויס שומע אותך?')}</h2>
      <div class="kv small"><label for="hMic">${L('Microphone', 'מיקרופון')}</label><div class="row"><select id="hMic" class="grow"><option value="">${L('System default', 'ברירת המחדל של המערכת')}</option></select><button id="hMicOn" class="btn sm">▶ ${L('Start meter', 'הפעל מד')}</button></div></div>
      <div class="meter" aria-label="${L('Input level', 'עוצמת קלט')}"><i id="hLevel"></i><b id="hLevelTxt" class="xs"></b></div>
      <p id="hMicNote" class="xs muted">${L('Speak normally: the bar should jump into the green. If it stays empty, the wrong microphone is selected, it is muted, or the browser has no permission.', 'דברו רגיל: הפס צריך לקפוץ לירוק. אם הוא נשאר ריק — נבחר מיקרופון לא נכון, הוא מושתק, או שאין לדפדפן הרשאה.')}</p>
      <p class="xs muted">${b.stt === 'browser' ? L('Note: Chrome/Edge recognition always uses the browser\'s default microphone. To change it: Chrome → Settings → Privacy → Site settings → Microphone (or the camera/mic icon in the address bar).', 'שימו לב: זיהוי הדיבור של Chrome/Edge משתמש תמיד במיקרופון ברירת המחדל של הדפדפן. לשינוי: Chrome ← הגדרות ← פרטיות ← הגדרות אתר ← מיקרופון (או סמל המצלמה/מיקרופון בשורת הכתובת).') : b.stt === 'claude' ? L('In claude.ai, Claude dictation uses the microphone chosen in the browser/app.', 'ב-claude.ai ההכתבה של Claude משתמשת במיקרופון שנבחר בדפדפן/באפליקציה.') : ''}</p>
    </div>
    <div class="panel glass corner"><h2>👂 ${L('Recognition test', 'בדיקת זיהוי דיבור')}</h2>
      <p class="xs muted">${L('Press, say a full sentence (also with a short pause in the middle), and see exactly what JARVIS understood. Nothing is sent.', 'לחצו, אמרו משפט מלא (גם עם הפסקה קצרה באמצע), ותראו בדיוק מה ג׳ארוויס הבין. שום דבר לא נשלח.')}</p>
      <div class="row"><button id="hTest" class="btn primary">🎙 ${L('Test hearing', 'בדיקת שמיעה')}</button><span id="hTestSt" class="tag xs"></span></div>
      <div id="hHeard" class="heard" dir="auto"></div>
    </div>
    <div class="panel glass corner"><h2>🩺 ${L('What is active here', 'מה פעיל כאן')}</h2><div id="hDiag" class="small">…</div></div>
  </div>
  <div class="c6 col">
    <div class="panel glass corner"><h2>⚙ ${L('How JARVIS listens', 'איך ג׳ארוויס מקשיב')}</h2>
      <div class="kv small">
        <label for="hLang">${L('Language you speak', 'השפה שבה אתם מדברים')}</label>${sel('hLang', LANGS, voice.lang)}
        <label for="hSil">${L('End of sentence after a pause of', 'סוף משפט אחרי הפסקה של')}</label><div class="row">${sel('hSil', [[0, L('first pause (fast)', 'ההפסקה הראשונה (מהיר)')], [900, '0.9 s'], [1400, L('1.4 s (recommended)', '1.4 שנ׳ (מומלץ)')], [2000, '2 s'], [3000, L('3 s (slow speakers)', '3 שנ׳ (לדיבור איטי)')]], voice.silenceMs)}</div>
        <label for="hSend">${L('After hearing', 'אחרי שהוא שומע')}</label>${sel('hSend', [['auto', L('send at once', 'לשלוח מיד')], ['review', L('put the text in the box for me to check', 'לשים בתיבה כדי שאבדוק לפני שליחה')]], voice.autoSend ? 'auto' : 'review')}
        <span></span><label class="row"><input id="hConv" type="checkbox" ${local.get('convMode', true) ? 'checked' : ''}> ${L('Conversation mode: after answering, keep listening for my next sentence', 'מצב שיחה: אחרי תשובה, להמשיך להקשיב למשפט הבא שלי')}</label>
        <span></span><label class="row"><input id="hBarge" type="checkbox" ${voice.bargeIn ? 'checked' : ''}> ${L('I can interrupt JARVIS while he speaks', 'אפשר לקטוע את ג׳ארוויס כשהוא מדבר')}</label>
        <span class="muted">${L('Shortcuts', 'קיצורים')}</span><span class="xs">Alt+Space ${L('talk / stop', 'דבר / עצור')} · Esc ${L('stop everything', 'עצור הכל')}</span>
      </div>
    </div>
    <div class="panel glass corner"><h2>🗣 ${L('Wake word', 'מילת השכמה')}</h2>
      <div class="kv small">
        <span class="muted">${L('Say', 'אומרים')}</span><b>"${esc(wakeWordOf())}, …"</b>
        <span class="muted">${L('State', 'מצב')}</span><div class="row"><span class="tag xs ${wake.state.enabled ? 'ok' : ''}">${wake.state.enabled ? L('listening', 'מאזין') : L('off', 'כבוי')}</span><button id="hWake" class="btn sm">${wake.state.enabled ? L('Turn off', 'כבה') : L('Turn on', 'הפעל')}</button></div>
        <label for="hSens">${L('Sensitivity', 'רגישות')}</label>${sel('hSens', [['strict', L('strict (fewer false wake-ups)', 'מחמירה (פחות התעוררויות שווא)')], ['normal', L('normal', 'רגילה')], ['loose', L('loose (wakes even when heard imperfectly)', 'מקלה (מתעורר גם כשהשם נשמע לא מדויק)')]], local.get('wakeSensitivity', 'normal'))}
        <label for="hWakeTry">${L('Try a sentence', 'נסו משפט')}</label><div class="row"><input id="hWakeTry" class="grow" dir="auto" placeholder="${esc(wakeWordOf())}, ${L('what is on today?', 'מה יש לי היום?')}"><span id="hWakeOut" class="xs"></span></div>
      </div>
      <p class="xs muted">${L('The name and the wake word are changed in Preferences, or by saying "from now on your name is …".', 'את השם ומילת ההשכמה משנים בהגדרות, או באמירה "מעכשיו קוראים לך …".')}</p>
    </div>
    <div class="panel glass corner"><h2>🔊 ${L('How JARVIS answers', 'איך ג׳ארוויס עונה')}</h2>
      <div class="kv small">
        <span></span><label class="row"><input id="hSpeakAll" type="checkbox" ${local.get('speakAll', true) ? 'checked' : ''}> ${L('Read every answer aloud', 'להקריא כל תשובה בקול')}</label>
        <label for="hVoice">${L('Voice', 'קול')}</label><select id="hVoice"></select>
        <label for="hRate">${L('Speed', 'מהירות')}</label><input id="hRate" type="range" min="0.6" max="1.6" step="0.05" value="${voice.rate}">
        <label for="hPitch">${L('Pitch', 'גובה')}</label><input id="hPitch" type="range" min="0.5" max="1.5" step="0.05" value="${voice.pitch}">
        <label for="hVol">${L('Volume', 'עוצמה')}</label><input id="hVol" type="range" min="0.2" max="1" step="0.05" value="${voice.volume}">
      </div>
      <div class="row" style="margin-top:8px"><button id="hSay" class="btn">🔊 ${L('Test the voice', 'בדיקת קול')}</button></div>
    </div>
  </div></div>`;

  // ---------- microphone ----------
  const fillMics = async () => { const mics = await listMics(); $('#hMic').innerHTML = `<option value="">${L('System default', 'ברירת המחדל של המערכת')}</option>${mics.map((m) => `<option value="${esc(m.id)}" ${m.id === voice.micId ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}`; };
  fillMics();
  const runMeter = async () => {
    stopMeter();
    let peak = 0; let heardAt = 0;
    try {
      meter = await micLevel($('#hMic').value, (lvl) => {
        const bar = $('#hLevel'); if (!bar) { stopMeter(); return; }
        peak = Math.max(lvl, peak * 0.96);
        bar.style.width = `${Math.round(lvl * 100)}%`; bar.className = lvl > 0.12 ? 'ok' : lvl > 0.04 ? 'warn' : '';
        if (lvl > 0.12) heardAt = Date.now();
        $('#hLevelTxt').textContent = Date.now() - heardAt < 800 ? L('✓ hearing you', '✓ שומע אותך') : peak < 0.02 ? L('silence', 'שקט') : '';
      });
      $('#hMicOn').textContent = `■ ${L('Stop meter', 'עצור מד')}`; $('#hMicOn').onclick = () => { stopMeter(); $('#hMicOn').textContent = `▶ ${L('Start meter', 'הפעל מד')}`; $('#hMicOn').onclick = runMeter; $('#hLevel').style.width = '0'; };
      $('#hMicNote').textContent = `${L('Active', 'פעיל')}: ${meter.label || L('microphone', 'מיקרופון')}${meter.settings.sampleRate ? ` · ${meter.settings.sampleRate} Hz` : ''}`;
      fillMics();
    } catch (e) {
      $('#hMicNote').innerHTML = `<span class="err">✕ ${esc(e.name === 'NotAllowedError' ? L('The microphone is blocked for this page. Allow it from the icon in the address bar (in claude.ai: the artifact\'s Permissions menu) and try again.', 'המיקרופון חסום לדף הזה. אפשרו אותו מהסמל בשורת הכתובת (ב-claude.ai: תפריט ההרשאות של ה-Artifact) ונסו שוב.') : e.name === 'NotFoundError' ? L('No microphone was found.', 'לא נמצא מיקרופון.') : e.name === 'NotReadableError' ? L('The microphone is in use by another app.', 'המיקרופון תפוס על ידי אפליקציה אחרת.') : e.message)}</span>`;
    }
  };
  $('#hMicOn').onclick = runMeter;
  $('#hMic').onchange = (e) => { voice.micId = e.target.value; saveVoicePrefs(); if (meter) runMeter(); };

  // ---------- recognition test ----------
  $('#hTest').onclick = () => {
    stopMeter();
    $('#hTestSt').textContent = L('listening…', 'מקשיב…'); $('#hTestSt').className = 'tag xs info'; $('#hHeard').textContent = '';
    const prev = voice.onFinal; const prevI = voice.onInterim; const t0 = Date.now();
    const restore = () => { voice.testing = false; voice.onFinal = prev; voice.onInterim = prevI; };
    voice.testing = true;
    voice.onInterim = (x) => { if (x && $('#hHeard')) $('#hHeard').innerHTML = `<span class="muted">${esc(x)}</span>`; };
    voice.onFinal = (x) => {
      restore(); stopListening();
      const conf = voice.lastConfidence;
      if (!$('#hHeard')) return;
      $('#hTestSt').textContent = L('heard', 'נשמע'); $('#hTestSt').className = 'tag xs ok';
      $('#hHeard').innerHTML = `<b>${esc(x)}</b><div class="xs muted">${((Date.now() - t0) / 1000).toFixed(1)} s${conf ? ` · ${L('confidence', 'ביטחון')} ${Math.round(conf * 100)}%` : ''} · ${esc(voice.lang)}</div>${conf && conf < 0.6 ? `<div class="xs warn">${L('Low confidence: speak closer to the mic, reduce background noise, or check the language.', 'ביטחון נמוך: דברו קרוב יותר למיקרופון, הפחיתו רעש רקע, או בדקו שהשפה נכונה.')}</div>` : ''}`;
    };
    startListening(); // straight from the click: Claude dictation requires it
    setTimeout(() => { if (voice.onFinal !== prev) { restore(); if ($('#hTestSt')?.textContent === L('listening…', 'מקשיב…')) { $('#hTestSt').textContent = L('nothing heard', 'לא נשמע כלום'); $('#hTestSt').className = 'tag xs warn'; } } }, 20000);
  };
  const onErr = (e) => { if ($('#hHeard')) { $('#hHeard').innerHTML = `<span class="err">✕ ${esc(e.detail.text)}</span>`; $('#hTestSt').textContent = L('failed', 'נכשל'); $('#hTestSt').className = 'tag xs bad'; } };
  addEventListener('jarvis:voice-error', onErr); addEventListener('hashchange', () => removeEventListener('jarvis:voice-error', onErr), { once: true });

  // ---------- diagnostics ----------
  const label = { claude: 'Claude (claude.ai)', browser: L('the browser', 'הדפדפן'), none: L('not available', 'לא זמין') };
  diagnose().then((d) => {
    if (!$('#hDiag')) return;
    $('#hDiag').innerHTML = `<div class="kv xs"><span class="muted">${L('Place', 'מקום')}</span><span>${esc(d.place)} · ${esc(d.browser)}</span>
      <span class="muted">${L('Hearing', 'שמיעה')}</span><span class="tag xs ${d.stt === 'none' ? 'bad' : 'ok'}">${esc(label[d.stt])}</span>
      <span class="muted">${L('Speaking', 'דיבור')}</span><span><span class="tag xs ${d.tts === 'none' ? 'bad' : 'ok'}">${esc(label[d.tts])}</span>${d.tts === 'browser' ? ` · ${esc(d.chosenVoice ?? L('no matching voice', 'אין קול מתאים'))}` : ''}</span>
      <span class="muted">${L('Microphone permission', 'הרשאת מיקרופון')}</span><span>${esc(d.micPermission)}</span>
      ${d.tts === 'browser' ? `<span class="muted">${L('Hebrew voices', 'קולות עבריים')}</span><span>${d.hebrewVoices.length ? esc(d.hebrewVoices.join(', ')) : `<span class="tag bad xs">${L('none', 'אין')}</span>`}</span>` : ''}</div>
      ${d.issues.length ? `<ul class="list">${d.issues.map((x) => `<li class="xs warn">⚠ ${esc(x)}</li>`).join('')}</ul>` : `<p class="xs ok">✓ ${L('Hearing and speaking are ready.', 'השמיעה והדיבור מוכנים.')}</p>`}`;
  });

  // ---------- listening settings ----------
  $('#hLang').onchange = (e) => { voice.lang = e.target.value; saveVoicePrefs(); toast(L('Saved', 'נשמר')); };
  $('#hSil').onchange = (e) => { voice.silenceMs = Number(e.target.value); saveVoicePrefs(); };
  $('#hSend').onchange = (e) => { voice.autoSend = e.target.value === 'auto'; saveVoicePrefs(); };
  $('#hConv').onchange = (e) => local.set('convMode', e.target.checked);
  $('#hBarge').onchange = (e) => { voice.bargeIn = e.target.checked; saveVoicePrefs(); };

  // ---------- wake word ----------
  $('#hWake').onclick = async () => { await toggleWake(); hearView(v); };
  $('#hSens').onchange = (e) => { local.set('wakeSensitivity', e.target.value); setWakeSensitivity(e.target.value); $('#hWakeTry').dispatchEvent(new Event('input')); };
  $('#hWakeTry').oninput = (e) => {
    const x = e.target.value.trim(); if (!x) { $('#hWakeOut').textContent = ''; return; }
    const m = testWake(x);
    $('#hWakeOut').innerHTML = m.matched ? `<span class="ok">✓ ${L('wakes', 'יתעורר')}</span>${m.command ? ` → <b>${esc(m.command)}</b>` : ''}` : `<span class="muted">✕ ${L('does not wake', 'לא יתעורר')}</span>`;
  };

  // ---------- answering ----------
  const vs = await voicesReady();
  if (!$('#hVoice')) return;
  if (b.tts === 'claude') $('#hVoice').innerHTML = ['buttery', 'airy', 'glassy', 'rounded'].map((x) => `<option ${x === voice.claudeVoice ? 'selected' : ''}>${x}</option>`).join('');
  else $('#hVoice').innerHTML = `<option value="">${L('Best available', 'הטוב ביותר שיש')}</option>${vs.filter((x) => /^(he|iw|en)/i.test(x.lang)).map((x) => `<option value="${esc(x.name)}" ${x.name === voice.voiceName ? 'selected' : ''}>${esc(x.name)} (${esc(x.lang)})</option>`).join('')}`;
  $('#hVoice').onchange = (e) => { if (b.tts === 'claude') voice.claudeVoice = e.target.value; else voice.voiceName = e.target.value; saveVoicePrefs(); };
  $('#hRate').oninput = (e) => { voice.rate = Number(e.target.value); saveVoicePrefs(); };
  $('#hPitch').oninput = (e) => { voice.pitch = Number(e.target.value); saveVoicePrefs(); };
  $('#hVol').oninput = (e) => { voice.volume = Number(e.target.value); saveVoicePrefs(); };
  $('#hSpeakAll').onchange = (e) => local.set('speakAll', e.target.checked);
  $('#hSay').onclick = () => speak(L('Hello, this is how I sound with these settings.', 'שלום, ככה אני נשמע עם ההגדרות האלה.'), { force: true });
}
