// Deterministic intent understanding for Hebrew and English (mixed allowed).
// It turns one utterance into one or more steps {agent, tool, args}. Anything it does not
// recognise becomes an `llm.answer` step routed to a language model.
import { parseWhen, stripWhen } from '../productivity/timeparse.js';
import { unitOf } from '../tools/utility.js';
import { SMALLTALK } from '../brain/analyze.js';

const has = (t, ...res) => res.some((r) => r.test(t));

// split multi-step commands: "turn off the lights and then remind me..." / "... ואז ..."
export function splitClauses(text) {
  return text.split(/\s*(?:,?\s+and then\s+|;\s*|\s+then\s+|\s+ואז\s+|\s+ואחר כך\s+)\s*/i).map((s) => s.trim()).filter(Boolean);
}

export function parseClause(raw, convo = {}) {
  const text = raw.trim().replace(/^(hey\s+)?jarvis[,:]?\s*/i, '').replace(/^ג'?ארוויס[,:]?\s*/, '');
  const t = text.toLowerCase();
  let m;

  // --- conversation: greetings and thanks need no model and no tools ---
  if (SMALLTALK.test(text.trim())) return [{ agent: 'assistant', tool: 'chat.smalltalk', args: { text } }];
  // --- feedback on the previous answer (voice or text) ---
  if ((m = text.match(/^(?:jarvis,?\s*)?(?:that(?:'s| was| is)|this (?:is|was)|it(?:'s| was))\s+(wrong|incorrect|not right|not what i asked|too long|too short|great|perfect|exactly right|helpful)[\s.!]*$/i) ?? text.match(/^(?:זה|זו|התשובה)\s+(?:היה |הייתה |היתה )?(לא נכון|לא נכונה|שגוי|שגויה|לא מה שביקשתי|ארוך מדי|ארוכה מדי|קצר מדי|קצרה מדי|מצוין|מצוינת|מעולה|בדיוק מה שרציתי|עזר(?:ה)?)[\s.!]*$/))) {
    const w = m[1].toLowerCase();
    const positive = /great|perfect|exactly|helpful|מצוי|מעולה|בדיוק|עזר/.test(w);
    const category = positive ? null : /long|ארו[כך]/.test(w) ? 'too_long' : /short|קצר/.test(w) ? 'too_short' : /what i asked|ביקשתי/.test(w) ? 'misunderstood' : 'accuracy';
    return [{ agent: 'assistant', tool: 'learning.feedback', args: { rating: positive ? 1 : -1, note: text, ...(category ? { category } : {}) } }];
  }
  // --- bare commands: the brain will ask for the missing detail ---
  if (/^(?:remind me|תזכיר לי|תזכורת)[\s.!?]*$/i.test(text)) return [{ agent: 'assistant', tool: 'reminders.create', args: {} }];
  if (/^(?:add (?:a )?task|new task|הוסף משימה|תוסיף משימה|משימה חדשה)[\s.!?:]*$/i.test(text)) return [{ agent: 'assistant', tool: 'tasks.create', args: {} }];
  if (/^(?:take a note|note|רשום פתק|פתק|תרשום)[\s.!?:]*$/i.test(text)) return [{ agent: 'knowledge', tool: 'notes.add', args: {} }];
  if (/^(?:set a timer|start a timer|timer|טיימר|הפעל טיימר)[\s.!?]*$/i.test(text)) return [{ agent: 'assistant', tool: 'timer.start', args: {} }];
  // --- reminders first ("remind me to pay the bill" is not a payment) ---
  if ((m = text.match(/(?:remind me (?:to |that |about )?|תזכיר לי (?:ל|ש)?|תזכורת:?\s*)(.+)/i))) {
    const at = parseWhen(m[1]) ?? new Date(Date.now() + 36e5).toISOString();
    return [{ agent: 'assistant', tool: 'reminders.create', args: { text: stripWhen(m[1]) || m[1], at } }];
  }
  // --- watchers (before any domain rule: "alert me if <anything>" is a monitoring request) ---
  if (/^(?:תתריע|התרע|תודיע לי|תעדכן אותי|alert me|notify me|warn me|watch)(?:\s|$)[\s\S]*(?:אם|כש|כאשר|\bif\b|\bwhen\b)/i.test(text)) return [{ agent: 'executive', tool: 'brain.watch_create', args: { text } }];
  // --- memory ---
  if ((m = text.match(/^(?:remember(?: that)?|תזכור ש|תזכור כי|זכור ש)\s*(.+)/i))) {
    return [{ agent: 'knowledge', tool: 'memory.remember', args: { content: m[1], type: /prefer|אוהב|מעדיף/i.test(m[1]) ? 'preference' : 'knowledge', provenance: 'user_statement' } }];
  }
  if ((m = text.match(/(?:what do you (?:know|remember) about|מה אתה (?:יודע|זוכר) על)\s*(.+)/i))) {
    return [{ agent: 'knowledge', tool: 'memory.search', args: { query: m[1] } }];
  }
  // --- shopping list ---
  if ((m = text.match(/(?:add\s+(.+?)\s+to (?:the |my )?shopping list|(?:תוסיף|הוסף)\s+(.+?)\s+לרשימת (?:ה)?קניות)/i))) {
    return [{ agent: 'household', tool: 'shopping.add', args: { item: (m[1] ?? m[2]).trim() } }];
  }
  if (has(t, /shopping list|רשימת (ה)?קניות/)) return [{ agent: 'household', tool: 'shopping.list', args: {} }];
  // --- health (optional, consent-gated) ---
  if (has(t, /how did i sleep|my sleep|steps|heart rate|activity this week|איך ישנתי|כמה צעדים|שינה שלי|דופק|פעילות השבוע/)) {
    return [{ agent: 'health', tool: 'health.summary', args: {} }];
  }
  // --- documents ---
  if ((m = text.match(/(?:search (?:my )?documents for|in my documents|חפש במסמכים|במסמכים שלי)\s*(.+)/i))) {
    return [{ agent: 'knowledge', tool: 'documents.search', args: { query: m[1] } }];
  }
  // --- timers ---
  if ((m = t.match(/timer (?:for )?(\d+)\s*(?:min|minutes?)?|טיימר (?:ל-?|של )?(\d+)\s*(?:דקות|דקה|דק׳)?/))) {
    return [{ agent: 'assistant', tool: 'timer.start', args: { minutes: Number(m[1] ?? m[2]) } }];
  }
  // --- money records (the household's own books; never a payment) ---
  const AMT = String.raw`(\d+(?:[.,]\d+)?)\s*(?:₪|ש"ח|שח|שקלים|שקל|nis|ils|shekels?)?`;
  if ((m = text.match(new RegExp(String.raw`(?:i\s+)?(?:spent|paid)\s+` + AMT + String.raw`\s+(?:on|for)\s+(.+)`, 'i'))) || (m = text.match(new RegExp(String.raw`(?:הוצאתי|שילמתי)\s+` + AMT + String.raw`\s*(?:על|ב-?|עבור|ל)\s*(.+)`)))) {
    return [{ agent: 'finance', tool: 'wealth.record', args: { kind: 'expense', amount: Number(m[1].replace(',', '.')), description: m[2].trim() } }];
  }
  if ((m = text.match(new RegExp(String.raw`(?:i\s+)?(?:received|earned|got paid)\s+` + AMT + String.raw`\s*(?:from|for)?\s*(.*)`, 'i'))) || (m = text.match(new RegExp(String.raw`(?:קיבלתי|הרווחתי|נכנסו לי|נכנסו)\s+` + AMT + String.raw`\s*(?:מ-?|עבור|על)?\s*(.*)`)))) {
    return [{ agent: 'finance', tool: 'wealth.record', args: { kind: 'income', amount: Number(m[1].replace(',', '.')), description: (m[2] || (/[֐-׿]/.test(text) ? 'הכנסה' : 'income')).trim() } }];
  }
  if ((m = text.match(new RegExp(String.raw`(?:הפקדתי|הוספתי|חסכתי)\s+` + AMT + String.raw`\s+(?:ל|לקרן|ליעד|עבור)\s*(.+)`))) || (m = text.match(new RegExp(String.raw`(?:deposited|saved|put)\s+` + AMT + String.raw`\s+(?:to|into|toward|towards|for)\s+(.+)`, 'i')))) {
    return [{ agent: 'finance', tool: 'wealth.goal_contribute', args: { amount: Number(m[1].replace(',', '.')), goal: m[2].replace(/^(?:the|my)\s+/i, '').replace(/^ה/, '').trim() } }];
  }
  if ((m = text.match(/^(?:שילמתי את|שולם|paid the|i paid the)\s+(?:חשבון\s+)?(?:ה)?(.+?)(?:\s+bill)?\s*$/i))) {
    return [{ agent: 'household', tool: 'wealth.bill_paid', args: { name: m[1].trim() } }];
  }
  // --- notes & habits ---
  if ((m = text.match(/^(?:take a note|note|write down|רשום פתק|פתק|תרשום|רשום)[:\s]+(.+)/i))) return [{ agent: 'knowledge', tool: 'notes.add', args: { text: m[1] } }];
  if (has(t, /my notes|show (my )?notes|הפתקים שלי|הצג פתקים/)) return [{ agent: 'knowledge', tool: 'notes.list', args: {} }];
  if ((m = text.match(/^(?:i did|log habit|done:|סימנתי|עשיתי היום|עשיתי|סמן שעשיתי)\s+(.+?)(?:\s+(?:today|היום))?\s*$/i))) return [{ agent: 'health', tool: 'habit.log', args: { name: m[1].replace(/^(?:את\s+)?ה?/, '') } }];
  if (has(t, /\bhabits?\b|\bstreaks?\b|הרגלים|ההרגלים|רצף/)) return [{ agent: 'health', tool: 'habit.status', args: {} }];
  // --- calculator, dates, units ---
  if ((m = text.match(/(?:how many days (?:until|till|to)|days until|כמה ימים (?:עד|נשארו עד|נשארו ל)|כמה זמן עד)\s+(.+?)\??$/i))) return [{ agent: 'assistant', tool: 'date.until', args: { date: m[1] } }];
  if ((m = text.match(/^(?:convert\s+|המר\s+|כמה זה\s+)?(\d+(?:\.\d+)?)\s*([^\s\d?]+)\s+(?:to|in|into|ל-?|ב-?)\s*([^\s?]+)\s*\??$/i)) && unitOf(m[2]) && unitOf(m[3])) {
    return [{ agent: 'assistant', tool: 'convert.units', args: { value: Number(m[1]), from: m[2], to: m[3] } }];
  }
  if ((m = text.match(/^(?:calculate|compute|what is|what's|כמה זה|כמה יוצא|חשב|תחשב)\s+(.+?)\??$/i)) && /\d/.test(m[1]) && /[+\-*/^%×÷x]|of|מ-?\d|מתוך/.test(m[1]) && !/[a-z֐-׿]{3,}/i.test(m[1].replace(/of|מתוך/g, ''))) {
    return [{ agent: 'assistant', tool: 'calc.evaluate', args: { expression: m[1] } }];
  }
  if (/^[\d\s.+\-*/^()%×÷,]+=?\s*\??$/.test(text) && /\d\s*[+\-*/^×÷%]/.test(text)) return [{ agent: 'assistant', tool: 'calc.evaluate', args: { expression: text.replace(/[=?]/g, '') } }];
  // --- brain: deep thinking, watchers, decisions, goal odds ---
  if ((m = text.match(/^(?:חשוב לעומק|תחשוב לעומק|חשיבה עמוקה|think (?:deeply|hard)|deep think)[:\s,]+([\s\S]+)/i))) return [{ agent: 'executive', tool: 'llm.answer', args: { prompt: m[1], complexity: 'high', deep: true } }];
  if (has(t, /my watchers|watchers|הצופים שלי|ההתראות האוטומטיות/)) return [{ agent: 'executive', tool: 'brain.watch_list', args: {} }];
  if ((m = text.match(/^(?:תעזור לי להחליט|עזור לי להחליט|להחליט|החלטה|decide|help me decide|should i)[:\s]+([\s\S]+)/i)) || (m = text.match(/^(.+\s(?:או|vs\.?|versus|or)\s.+)\?\s*(?:מה עדיף|מה כדאי|which is better)\??$/i))) return [{ agent: 'executive', tool: 'ai.decide', args: { question: m[1] ?? text } }];
  if (has(t, /(?:what are )?(?:the )?odds|chance (?:of|to) reach|probability.*goal|מה הסיכוי|הסיכוי להגיע|סיכויים ל/) && has(t, /goal|יעד|חיסכון|קרן|save|saving/)) return [{ agent: 'finance', tool: 'wealth.goal_odds', args: {} }];
  // --- AI engines: custom agents, generator, app builder, council, plan & execute ---
  if ((m = text.match(/^@([\p{L}\p{N}_-]+)\s+([\s\S]+)/u))) return [{ agent: 'executive', tool: 'agents.invoke', args: { handle: m[1], message: m[2] } }];
  if ((m = text.match(/^(?:צור סוכן|תיצור סוכן|סוכן חדש|create (?:an? )?agent|new agent)[:\s]+([\s\S]+)/i))) return [{ agent: 'executive', tool: 'agents.create', args: { description: m[1] } }];
  if ((m = text.match(/^(?:מועצה|מועצת מומחים|תתייעץ(?: עם מומחים)?|התייעצות|council|ask the council)[:\s]+([\s\S]+)/i))) return [{ agent: 'executive', tool: 'ai.council', args: { question: m[1] } }];
  if ((m = text.match(/^(?:תכנן ובצע|בצע מטרה|מטרה|משימה מורכבת|מבצע|plan and (?:do|run|execute)|goal|mission)[:\s]+([\s\S]+)/i))) return [{ agent: 'executive', tool: 'mission.run', args: { goal: m[1] } }];
  if ((m = text.match(/^(?:בנה|תבנה|צור|תיצור|תכין)\s+(?:לי\s+)?(?:אפליקציה|אפליקציית|יישומון|כלי|מחשבון|משחק|דשבורד|טופס)([\s\S]*)/)) || (m = text.match(/^(?:build|make|create)\s+(?:me\s+)?(?:an?\s+)?(?:[\w-]+\s+){0,4}(?:app|tool|calculator|game|widget|dashboard|form|tracker)\b([\s\S]*)/i))) {
    return [{ agent: 'creative', tool: 'ai.build_app', args: { prompt: text } }];
  }
  const GEN = [[/טבלה|גיליון|אקסל|csv|spreadsheet|table/i, 'table'], [/מייל|אימייל|email|e-mail/i, 'email'], [/קובץ יומן|ics|לוח אירועים|calendar file|calendar/i, 'calendar'], [/תוכנית|תכנית|plan\b/i, 'plan'], [/קוד|סקריפט|פונקציה|code|script|function/i, 'code'], [/json/i, 'json']];
  if ((m = text.match(/^(?:צור|תיצור|תכין|הכן|כתוב|תכתוב|תנסח|נסח|ייצר|תייצר)\s+(?:לי\s+)?(מסמך|דוח|דו"ח|מכתב|מייל|אימייל|טבלה|גיליון|קובץ|תוכנית|תכנית|רשימה|קוד|סקריפט|json|סיכום|הצעה|חוזה)([\s\S]*)/i))
    || (m = text.match(/^(?:create|make|generate|write|draft)\s+(?:me\s+)?(?:an?\s+)?(document|report|letter|email|table|spreadsheet|csv|file|plan|list|code|script|json|summary|proposal|contract|calendar file)\b([\s\S]*)/i))) {
    const kind = GEN.find(([re]) => re.test(m[1] + (m[1] === 'קובץ' || m[1] === 'file' ? m[2] : '')))?.[1] ?? 'document';
    return [{ agent: kind === 'code' ? 'coding' : 'creative', tool: 'ai.generate', args: { kind, prompt: text } }];
  }
  // --- briefings ---
  if (has(t, /organi[sz]e my day|daily brief|my day|what'?s (on )?today|תארגן לי את היום|תדריך|מה יש לי היום|סדר יום/)) {
    return [{ agent: 'assistant', tool: 'briefing.daily', args: {} }];
  }
  if (has(t, /weekly (report|summary|brief)|דוח שבועי|סיכום שבועי/)) return [{ agent: 'assistant', tool: 'briefing.weekly', args: {} }];
  // --- tasks ---
  if ((m = text.match(/(?:add (?:a )?task|new task|create (?:a )?task|הוסף משימה|תוסיף משימה|תוסיפי משימה|משימה חדשה)[:\s]+(.+)/i))) {
    const due = parseWhen(m[1]);
    return [{ agent: 'assistant', tool: 'tasks.create', args: { title: stripWhen(m[1]), due, priority: /urgent|important|דחוף|חשוב/i.test(m[1]) ? 'high' : 'normal' } }];
  }
  if (has(t, /my tasks|open tasks|to-?do list|מה המשימות|המשימות שלי|רשימת משימות/)) return [{ agent: 'assistant', tool: 'tasks.list', args: {} }];
  if ((m = text.match(/(?:schedule|add (?:an )?(?:event|meeting)|קבע (?:פגישה|אירוע)|תקבע)\s+(.+)/i))) {
    const start = parseWhen(m[1]);
    if (start) return [{ agent: 'assistant', tool: 'calendar.create', args: { title: stripWhen(m[1]), start } }];
  }
  if (has(t, /family schedule|weekly family|לוח זמנים משפחתי|תכנון שבועי למשפחה/)) {
    return [{ agent: 'assistant', tool: 'calendar.list', args: { from: new Date().toISOString(), to: new Date(Date.now() + 7 * 864e5).toISOString() } },
      { agent: 'assistant', tool: 'tasks.list', args: {} }];
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
  if (has(t, /offline|not (connected|responding)|לא מחובר|מנותק/)) return [{ agent: 'smarthome', tool: 'home.devices', args: { offlineOnly: true } }];
  if ((m = t.match(/(?:activate|start|turn on)\s+(\w+)\s+(?:mode|scene)|(?:הפעל|תפעיל)\s+(?:את\s+)?מצב\s+(\S+)/))) {
    const word = m[1] ?? m[2];
    const map = { evening: 'evening', ערב: 'evening', night: 'night', לילה: 'night' };
    return [{ agent: 'smarthome', tool: 'home.scene', args: { sceneId: `scene.${map[word] ?? word}` } }];
  }
  if ((m = t.match(/(?:temperature|thermostat|ac|מזגן|טמפרטורה)\D*(\d{2})|(?:set|תכוון|כוון)\D*(\d{2})\s*(?:degrees|°|מעלות)/))) {
    return [{ agent: 'smarthome', tool: 'home.control', args: { query: 'climate', action: 'set_temperature', data: { temperature: Number(m[1] ?? m[2]) } } }];
  }
  const lightOff = has(t, /turn off|switch off|turn (it|them) off|lights? off|כבה|תכבה|לכבות/);
  const lightOn = has(t, /turn on|switch on|turn (it|them) on|lights? on|הדלק|תדליק|להדליק/);
  if ((lightOff || lightOn) && has(t, /light|lamp|אור|תאורה|מנורה|\bit\b|\bthem\b|אותו|אותם/)) {
    const pronoun = has(t, /\bit\b|\bthem\b|אותו|אותם/) && !has(t, /light|אור|תאורה/);
    return [{ agent: 'smarthome', tool: 'home.control', args: { query: pronoun ? null : text, useLast: pronoun, domain: 'light', action: lightOff ? 'turn_off' : 'turn_on' } }];
  }
  if (has(t, /unlock|open the (front )?door|פתח את הדלת|תפתח את הדלת/)) return [{ agent: 'smarthome', tool: 'home.control', args: { entityId: 'lock.front_door', action: 'unlock' } }];
  if (has(t, /lock the (front )?door|נעל את הדלת|תנעל/)) return [{ agent: 'smarthome', tool: 'home.control', args: { entityId: 'lock.front_door', action: 'lock' } }];
  if (has(t, /devices|home status|מצב הבית|המכשירים/)) return [{ agent: 'smarthome', tool: 'home.devices', args: {} }];

  // --- research ---
  if ((m = text.match(/https?:\/\/\S+/))) return [{ agent: 'browser', tool: 'research.fetch', args: { url: m[0] } }];
  if ((m = text.match(/^(?:research|look up|find out about|חקור|תחקור|תבדוק לי)\s+(.+)/i))) return [{ agent: 'research', tool: 'research.web', args: { query: m[1] } }];

  // --- computer ---
  if ((m = text.match(/^(?:open|launch|פתח|תפתח)\s+(?:the\s+)?(?:app\s+|אפליקציית\s+|את\s+)?(.+)/i)) && !/door|דלת/.test(t)) {
    return [{ agent: 'computer', tool: 'computer.open_app', args: { name: m[1].trim() } }];
  }
  if (has(t, /security (review|check|report)|בדיקת אבטחה|סקירת אבטחה/)) return [{ agent: 'security', tool: 'security.review', args: {} }];

  // --- fall through to the language model ---
  const agent = has(t, /code|bug|function|debug|קוד|באג/) ? 'coding'
    : has(t, /email|message|draft|מייל|הודעה|טיוטה/) ? 'communication'
    : has(t, /plan|project|break down|תכנן|פרויקט|פרק/) ? 'executive'
    : has(t, /write|poem|story|idea|presentation|כתוב|שיר|סיפור|רעיון|מצגת/) ? 'creative' : 'knowledge';
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
