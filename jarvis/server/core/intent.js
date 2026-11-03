// Deterministic intent understanding for Hebrew and English (mixed allowed).
// It turns one utterance into one or more steps {agent, tool, args}. Anything it does not
// recognise becomes an `llm.answer` step routed to a language model.
import { parseWhen, stripWhen } from '../productivity/timeparse.js';

const has = (t, ...res) => res.some((r) => r.test(t));

// split multi-step commands: "turn off the lights and then remind me..." / "... ואז ..."
export function splitClauses(text) {
  return text.split(/\s*(?:,?\s+and then\s+|;\s*|\s+then\s+|\s+ואז\s+|\s+ואחר כך\s+)\s*/i).map((s) => s.trim()).filter(Boolean);
}

export function parseClause(raw, convo = {}) {
  const text = raw.trim().replace(/^(hey\s+)?jarvis[,:]?\s*/i, '').replace(/^ג'?ארוויס[,:]?\s*/, '');
  const t = text.toLowerCase();
  let m;

  // --- reminders first ("remind me to pay the bill" is not a payment) ---
  if ((m = text.match(/(?:remind me (?:to |that |about )?|תזכיר לי (?:ל|ש)?|תזכורת:?\s*)(.+)/i))) {
    const at = parseWhen(m[1]) ?? new Date(Date.now() + 36e5).toISOString();
    return [{ agent: 'executive', tool: 'reminders.create', args: { text: stripWhen(m[1]) || m[1], at } }];
  }
  // --- memory ---
  if ((m = text.match(/^(?:remember(?: that)?|תזכור ש|תזכור כי|זכור ש)\s*(.+)/i))) {
    return [{ agent: 'knowledge', tool: 'memory.remember', args: { content: m[1], type: /prefer|אוהב|מעדיף/i.test(m[1]) ? 'preference' : 'knowledge', provenance: 'user_statement' } }];
  }
  if ((m = text.match(/(?:what do you (?:know|remember) about|מה אתה (?:יודע|זוכר) על)\s*(.+)/i))) {
    return [{ agent: 'knowledge', tool: 'memory.search', args: { query: m[1] } }];
  }
  // --- briefings ---
  if (has(t, /organi[sz]e my day|daily brief|my day|what'?s (on )?today|תארגן לי את היום|תדריך|מה יש לי היום|סדר יום/)) {
    return [{ agent: 'executive', tool: 'briefing.daily', args: {} }];
  }
  if (has(t, /weekly (report|summary|brief)|דוח שבועי|סיכום שבועי/)) return [{ agent: 'executive', tool: 'briefing.weekly', args: {} }];
  // --- tasks ---
  if ((m = text.match(/(?:add (?:a )?task|new task|create (?:a )?task|הוסף משימה|משימה חדשה)[:\s]+(.+)/i))) {
    const due = parseWhen(m[1]);
    return [{ agent: 'executive', tool: 'tasks.create', args: { title: stripWhen(m[1]), due, priority: /urgent|important|דחוף|חשוב/i.test(m[1]) ? 'high' : 'normal' } }];
  }
  if (has(t, /my tasks|open tasks|to-?do list|מה המשימות|המשימות שלי|רשימת משימות/)) return [{ agent: 'executive', tool: 'tasks.list', args: {} }];
  if ((m = text.match(/(?:schedule|add (?:an )?(?:event|meeting)|קבע (?:פגישה|אירוע)|תקבע)\s+(.+)/i))) {
    const start = parseWhen(m[1]);
    if (start) return [{ agent: 'executive', tool: 'calendar.create', args: { title: stripWhen(m[1]), start } }];
  }
  if (has(t, /family schedule|weekly family|לוח זמנים משפחתי|תכנון שבועי למשפחה/)) {
    return [{ agent: 'executive', tool: 'calendar.list', args: { from: new Date().toISOString(), to: new Date(Date.now() + 7 * 864e5).toISOString() } },
      { agent: 'executive', tool: 'tasks.list', args: {} }];
  }

  // --- finance: money movement is detected and routed to the guard ---
  if (has(t, /\b(transfer|wire|send) (money|funds|\d)|\b(buy|purchase)\b|\binvest\b|cancel (my )?(insurance|policy|fund)|העבר (כסף|\d)|תעביר|תקנה|השקע|בטל (את )?(הביטוח|הפוליסה|הקרן)/)) {
    const action = /invest|השקע/.test(t) ? 'invest' : /buy|purchase|תקנה/.test(t) ? 'purchase' : /cancel|בטל/.test(t) ? 'cancel_product' : 'transfer';
    return [{ agent: 'finance', tool: 'wealth.transfer', args: { action, request: text } }];
  }
  if (has(t, /financial report|monthly report|דוח כספי|דו"ח כספי|דוח חודשי/)) return [{ agent: 'finance', tool: 'wealth.report', args: {} }];
  if (has(t, /compare (our |my )?spending|vs\.? (last|previous) month|השווה (את )?ההוצאות|לעומת החודש הקודם/)) return [{ agent: 'finance', tool: 'wealth.analysis', args: { focus: 'compare' } }];
  if (has(t, /unnecessary|save more|savings opportunit|can we (potentially )?save|increase (my |our )?(monthly )?savings|הוצאות מיותרות|לחסוך|להגדיל (את )?החיסכון/)) return [{ agent: 'finance', tool: 'wealth.analysis', args: { focus: 'savings' } }];
  if (has(t, /savings goals?|progress(ing)? toward|יעדי (ה)?חיסכון|היעדים/)) return [{ agent: 'finance', tool: 'wealth.goals', args: {} }];
  if (has(t, /upcoming (payments|bills)|bills? (due|to pay)|payments? (require|need)|חשבונות|תשלומים קרובים|תשלומים/)) return [{ agent: 'finance', tool: 'wealth.bills', args: {} }];
  if (has(t, /net worth|total (financial )?assets|wealth overview|שווי (נקי|כולל)|סך הנכסים|הנכסים שלנו/)) return [{ agent: 'finance', tool: 'wealth.overview', args: {} }];
  if (has(t, /how much did (we|i) spend|spent this month|check my finances|what needs attention|כמה הוצאנו|כמה הוצאתי|המצב הכלכלי|הכספים שלי/)) return [{ agent: 'finance', tool: 'wealth.analysis', args: { focus: 'spend' } }];

  // --- smart home ---
  if (has(t, /offline|not (connected|responding)|לא מחובר|מנותק/)) return [{ agent: 'home', tool: 'home.devices', args: { offlineOnly: true } }];
  if ((m = t.match(/(?:activate|start|turn on)\s+(\w+)\s+(?:mode|scene)|(?:הפעל|תפעיל)\s+(?:את\s+)?מצב\s+(\S+)/))) {
    const word = m[1] ?? m[2];
    const map = { evening: 'evening', ערב: 'evening', night: 'night', לילה: 'night' };
    return [{ agent: 'home', tool: 'home.scene', args: { sceneId: `scene.${map[word] ?? word}` } }];
  }
  if ((m = t.match(/(?:temperature|thermostat|ac|מזגן|טמפרטורה)\D*(\d{2})|(?:set|תכוון|כוון)\D*(\d{2})\s*(?:degrees|°|מעלות)/))) {
    return [{ agent: 'home', tool: 'home.control', args: { query: 'climate', action: 'set_temperature', data: { temperature: Number(m[1] ?? m[2]) } } }];
  }
  const lightOff = has(t, /turn off|switch off|turn (it|them) off|lights? off|כבה|תכבה|לכבות/);
  const lightOn = has(t, /turn on|switch on|turn (it|them) on|lights? on|הדלק|תדליק|להדליק/);
  if ((lightOff || lightOn) && has(t, /light|lamp|אור|תאורה|מנורה|\bit\b|\bthem\b|אותו|אותם/)) {
    const pronoun = has(t, /\bit\b|\bthem\b|אותו|אותם/) && !has(t, /light|אור|תאורה/);
    return [{ agent: 'home', tool: 'home.control', args: { query: pronoun ? null : text, useLast: pronoun, domain: 'light', action: lightOff ? 'turn_off' : 'turn_on' } }];
  }
  if (has(t, /unlock|open the (front )?door|פתח את הדלת|תפתח את הדלת/)) return [{ agent: 'home', tool: 'home.control', args: { entityId: 'lock.front_door', action: 'unlock' } }];
  if (has(t, /lock the (front )?door|נעל את הדלת|תנעל/)) return [{ agent: 'home', tool: 'home.control', args: { entityId: 'lock.front_door', action: 'lock' } }];
  if (has(t, /devices|home status|מצב הבית|המכשירים/)) return [{ agent: 'home', tool: 'home.devices', args: {} }];

  // --- research ---
  if ((m = text.match(/https?:\/\/\S+/))) return [{ agent: 'research', tool: 'research.fetch', args: { url: m[0] } }];
  if ((m = text.match(/^(?:research|look up|find out about|חקור|תחקור|תבדוק לי)\s+(.+)/i))) return [{ agent: 'research', tool: 'research.web', args: { query: m[1] } }];

  // --- computer ---
  if ((m = text.match(/^(?:open|launch|פתח|תפתח)\s+(?:the\s+)?(?:app\s+|אפליקציית\s+|את\s+)?(.+)/i)) && !/door|דלת/.test(t)) {
    return [{ agent: 'computer', tool: 'computer.open_app', args: { name: m[1].trim() } }];
  }
  if (has(t, /security (review|check|report)|בדיקת אבטחה|סקירת אבטחה/)) return [{ agent: 'security', tool: 'security.review', args: {} }];

  // --- fall through to the language model ---
  const agent = has(t, /code|bug|function|debug|קוד|באג/) ? 'coding'
    : has(t, /email|message|draft|מייל|הודעה|טיוטה/) ? 'communication'
    : has(t, /plan|project|break down|תכנן|פרויקט|פרק/) ? 'planning' : 'knowledge';
  const complexity = text.length > 280 || has(t, /analy[sz]e|compare|strategy|best solution|נתח|אסטרטגיה|הפתרון הטוב/) ? 'high' : text.length < 40 ? 'low' : 'medium';
  return [{ agent, tool: 'llm.answer', args: { prompt: text, complexity } }];
}

export function parse(text, convo = {}) {
  // corrections: "no, 22" / "לא, 22 מעלות" adjusts the previous numeric argument
  const corr = text.match(/^(?:no|actually|i meant|לא|בעצם|התכוונתי)[,\s]+.*?(\d{1,3})/i);
  if (corr && convo.lastSteps?.some((s) => s.args?.data?.temperature !== undefined)) {
    return convo.lastSteps.map((s) => (s.args?.data?.temperature !== undefined
      ? { ...s, args: { ...s.args, data: { ...s.args.data, temperature: Number(corr[1]) } } } : s));
  }
  return splitClauses(text).flatMap((c) => parseClause(c, convo));
}
