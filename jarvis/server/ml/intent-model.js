// Neural intent model: a hashed-feature MLP that maps free phrasing (Hebrew, English, mixed)
// to a READ-only JARVIS capability, or to "open question" (llm.answer).
//
// Training data is built locally from three sources, all labelled without a model:
//   1. a curated bilingual paraphrase corpus (below);
//   2. the deterministic parser itself (weak supervision: paraphrases it understands
//      are labelled with its answer; disagreements are resolved in favor of the parser);
//   3. the user's own history: completed single-step requests and approved learned phrases.
// The model is only ever used where the deterministic parser had no rule, only for read-only
// capabilities, and only when it is confident (probability and margin thresholds).
import { MLP, classificationReport, calibration } from './nn.js';
import { featurize, normalizeText, tokens } from './features.js';

const STOP = new Set(['what', 'how', 'show', 'the', 'are', 'my', 'our', 'is', 'do', 'did', 'for', 'and', 'you', 'can', 'please', 'now', 'מה', 'איך', 'של', 'שלי', 'שלנו', 'את', 'יש', 'לי', 'אני', 'זה', 'על', 'עם', 'בבקשה', 'עכשיו', 'תגיד', 'כמה', 'אילו', 'תראה', 'jarvis']);
// Support words are stored hashed (FNV-1a), so the model file contains no raw vocabulary.
const hashWord = (w) => { let h = 0x811c9dc5; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

export const ROUTABLE = ['briefing.daily', 'briefing.weekly', 'tasks.list', 'calendar.list', 'shopping.list', 'wealth.overview', 'wealth.analysis', 'wealth.bills', 'wealth.goals', 'wealth.goal_odds', 'home.devices', 'health.summary', 'notes.list', 'habit.status', 'brain.watch_list'];
export const OPEN = 'llm.answer';

export const CORPUS = {
  'briefing.daily': ['organize my day', "what's my day look like", 'what is on today', 'plan my day', 'brief me', 'give me my morning briefing', 'מה יש לי היום', 'תסדר לי את היום', 'סיכום של היום', 'מה התוכניות שלי להיום', 'תן לי תדריך', 'תדריך בוקר', 'איך נראה היום שלי'],
  'briefing.weekly': ['weekly summary', 'how was my week', 'summarize this week', 'week in review', 'סיכום שבועי', 'איך היה השבוע', 'תסכם לי את השבוע', 'מה היה השבוע'],
  'tasks.list': ['show my tasks', 'my to do list', 'what do i need to do', 'list my todos', 'open tasks', 'מה המשימות שלי', 'רשימת משימות', 'מה נשאר לי לעשות', 'מה עוד פתוח אצלי', 'אילו משימות יש לי'],
  'calendar.list': ['my calendar', 'what meetings do i have', 'show my schedule', 'upcoming events', 'any appointments', 'מה ביומן', 'אילו פגישות יש לי', 'מה הפגישות השבוע', 'מה האירועים הקרובים', 'תראה לי את היומן'],
  'shopping.list': ['shopping list', 'what do we need to buy', 'show groceries', 'grocery list', 'מה ברשימת הקניות', 'מה צריך לקנות', 'רשימת קניות', 'מה חסר בבית לקנות'],
  'wealth.overview': ['how are my finances', 'financial overview', 'money summary', "what's my financial situation", 'net worth', 'תמונת מצב כספית', 'מצב כספי', 'מה המצב הכספי שלי', 'איך אנחנו עומדים עם הכסף', 'סיכום כספי', 'מאזן כספי', 'כמה כסף יש לנו'],
  'wealth.analysis': ['how much did we spend this month', 'spending analysis', 'where does our money go', 'expenses this month', 'how much did we spend on food', 'what are our biggest expenses', 'כמה הוצאנו החודש', 'ניתוח הוצאות', 'על מה הלך הכסף', 'איפה אנחנו מוציאים הכי הרבה', 'ההוצאות החודש', 'כמה הוצאנו על אוכל', 'כמה כסף הלך על מסעדות', 'מה ההוצאות הגדולות שלנו'],
  'wealth.bills': ['upcoming bills', 'what bills are due', 'unpaid bills', 'what do i need to pay', 'חשבונות פתוחים', 'מה צריך לשלם השבוע', 'אילו חשבונות צריך לשלם', 'חשבונות שלא שולמו', 'מתי החשמל'],
  'wealth.goals': ['my savings goals', 'how are my goals', 'goal progress', 'מה היעדים שלי', 'איך היעדים', 'התקדמות היעדים', 'יעדי חיסכון'],
  'wealth.goal_odds': ['will we reach our goal', 'chance of reaching the savings goal', 'goal odds', 'מה הסיכוי שנגיע ליעד', 'נגיע ליעד החיסכון', 'סיכוי ליעד'],
  'home.devices': ['which lights are on', 'home status', 'is the door locked', 'device status', 'מה מצב הבית', 'מצב המכשירים', 'אילו אורות דולקים', 'הדלת נעולה', 'מה דלוק בבית'],
  'health.summary': ['how did i sleep', 'my health summary', 'steps today', 'sleep report', 'איך ישנתי', 'סיכום בריאות', 'כמה צעדים עשיתי', 'מצב הבריאות שלי'],
  'notes.list': ['show my notes', 'list notes', 'what did i write down', 'my notes', 'הפתקים שלי', 'מה רשמתי', 'תראה לי את הפתקים', 'רשימת פתקים'],
  'habit.status': ['my habits', 'habit streaks', 'how are my habits', 'איך ההרגלים שלי', 'רצף ההרגלים', 'מצב ההרגלים', 'ההרגלים שלי'],
  'brain.watch_list': ['what are you watching', 'my alerts', 'active watchers', 'על מה אתה מתריע', 'ההתראות שלי', 'אילו צופים פעילים'],
  [OPEN]: ['tell me about stars', 'who wrote hamlet', 'explain quantum physics', 'write a poem about the sea', 'how does photosynthesis work', 'why is the sky blue', 'recommend a movie', 'translate hello to french', 'what is the capital of japan', 'give me ideas for a birthday party',
    'ספר לי על כוכבים', 'מי כתב את המלט', 'מה ההבדל בין חתול לכלב', 'תמליץ לי על סרט', 'מה דעתך על בינה מלאכותית', 'למה השמיים כחולים', 'תכתוב לי שיר על הים', 'איך עובדת פוטוסינתזה', 'רעיונות למסיבת יום הולדת', 'מה בירת יפן', 'ספר לי בדיחה', 'מה זה בלוקצ׳יין',
    'who was napoleon', 'what is the meaning of life', 'how do i bake bread', 'how long does it take to fly to paris', 'what happened in world war two', 'summarize the history of rome', 'give me a recipe for pasta', 'what is machine learning', 'is coffee healthy', 'how far is the moon', 'help me write an email to my boss', 'what should i name my dog',
    'מי היה נפוליאון', 'מה משמעות החיים', 'איך מכינים לחם', 'כמה זמן טיסה לפריז', 'מה קרה במלחמת העולם השנייה', 'מה זה למידת מכונה', 'האם קפה בריא', 'כמה רחוק הירח', 'עזור לי לכתוב מייל לבוס', 'איך קוראים לכלב שלי כדאי', 'מתכון לפסטה', 'מי המציא את החשמל', 'איך לומדים לנגן בגיטרה', 'מה ההיסטוריה של ירושלים', 'הסבר לי מה זה אינפלציה', 'תן לי רעיון לטיול בצפון'],
};

const AUG_PREFIX = ['', '', 'jarvis ', 'ג׳ארוויס ', 'please ', 'בבקשה ', 'hey ', 'תגיד '];
const AUG_SUFFIX = ['', '', '?', ' please', ' בבקשה', ' עכשיו', ' now'];

/** Builds the labelled dataset. `parse` is the deterministic parser (weak labels). */
export function buildDataset(s, parse) {
  const examples = []; const sources = { corpus: 0, parser: 0, history: 0, aliases: 0, conflictsResolved: 0 };
  const push = (text, label, source) => { if (!text || !(label === OPEN || ROUTABLE.includes(label))) return; examples.push({ text, label, source }); sources[source]++; };
  for (const [label, list] of Object.entries(CORPUS)) for (const text of list) {
    const p = parse?.(text, {}) ?? [];
    const det = p.length === 1 ? p[0].tool : null;
    // The parser is authoritative where it has a rule: never train the model to disagree with it.
    if (det && det !== OPEN && det !== label && ROUTABLE.includes(det)) { push(text, det, 'parser'); sources.conflictsResolved++; } else push(text, label, 'corpus');
  }
  for (const t of s.store.all('tasks_exec', (x) => x.actor === 'user' && x.state === 'COMPLETED' && x.plan?.steps?.length === 1).slice(-500)) {
    const tool = t.plan.steps[0].tool;
    if (ROUTABLE.includes(tool) && !Object.keys(t.plan.steps[0].args ?? {}).filter((k) => !['memories', 'history'].includes(k)).length) push(t.objective, tool, 'history');
  }
  for (const a of s.store.getMeta('learnedAliases', [])) push(a.phrase, a.tool, 'aliases');
  // de-duplicate by normalized text (first label wins)
  const seen = new Set(); const uniq = [];
  for (const e of examples) { const k = normalizeText(e.text); if (!seen.has(k)) { seen.add(k); uniq.push(e); } }
  return { examples: uniq, sources };
}

function augment(examples, r, times = 3) {
  const out = [];
  for (const e of examples) {
    out.push(e);
    for (let i = 0; i < times; i++) {
      const words = e.text.split(' ');
      const kept = words.length > 2 && r() < 0.5 ? words.filter(() => r() > 0.15) : words;
      out.push({ ...e, text: `${AUG_PREFIX[Math.floor(r() * AUG_PREFIX.length)]}${kept.join(' ')}${AUG_SUFFIX[Math.floor(r() * AUG_SUFFIX.length)]}`, augmented: true });
    }
  }
  return out;
}

export function trainIntentModel(dataset, { dim = 2048, hidden = 64, epochs = 80, seed = 11 } = {}) {
  const labels = [...new Set(dataset.examples.map((e) => e.label))].sort();
  const lid = Object.fromEntries(labels.map((l, i) => [l, i]));
  // Deterministic held-out test set: every 5th original example per label (never augmented into training).
  const test = []; const trainBase = []; const perLabel = {};
  for (const e of dataset.examples) { perLabel[e.label] = (perLabel[e.label] ?? 0) + 1; (perLabel[e.label] % 5 === 0 ? test : trainBase).push(e); }
  let state = seed;
  const r = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 4294967296; };
  const train = augment(trainBase, r).map((e) => ({ x: featurize(e.text, dim), y: lid[e.label] }));
  const counts = labels.map((_, i) => train.filter((t) => t.y === i).length);
  const classWeights = counts.map((c) => (c ? Math.min(3, train.length / (labels.length * c)) : 1));
  const net = new MLP([dim, hidden, labels.length], { seed });
  const t0 = Date.now();
  const fit = net.fit(train, { epochs, lr: 0.01, batch: 16, dropout: 0.15, l2: 1e-4, valSplit: 0.12, patience: 8, seed, classWeights });
  const yTrue = []; const yPred = []; const probs = []; const correct = [];
  for (const e of test) { const p = net.predict(featurize(e.text, dim)); const k = p.indexOf(Math.max(...p)); yTrue.push(lid[e.label]); yPred.push(k); probs.push(p[k]); correct.push(k === lid[e.label]); }
  const report = classificationReport(yTrue, yPred, labels);
  // Safety metric: when the router WOULD act (confident + supported), how often is it right?
  const support0 = {};
  for (const e of trainBase) for (const w of tokens(e.text)) if (w.length > 2 && !STOP.has(w)) (support0[e.label] ??= new Set()).add(hashWord(w));
  const probe = { net, labels, config: { dim }, support: Object.fromEntries(Object.entries(support0).map(([k, v]) => [k, [...v]])) };
  let routed = 0; let routedOk = 0; let falseRoutes = 0;
  for (const e of test) { const d = decideRoute(probe, e.text); if (d.route) { routed++; if (d.label === e.label) routedOk++; else falseRoutes++; } }
  // Lexical support per class: content words seen in its training examples (guards against routing on noise).
  const support = {};
  for (const e of trainBase) for (const w of tokens(e.text)) if (w.length > 2 && !STOP.has(w)) (support[e.label] ??= new Set()).add(w);
  return {
    net, labels, support: Object.fromEntries(Object.entries(support).map(([k, v]) => [k, [...v].map(hashWord)])),
    metrics: { testAccuracy: report.accuracy, macroF1: report.macroF1, routedPrecision: routed ? +(routedOk / routed).toFixed(4) : null, routedCoverage: +(routed / Math.max(1, test.filter((e) => e.label !== OPEN).length)).toFixed(4), falseRoutes, routedCount: routed, valAccuracy: fit.history[fit.bestEpoch - 1]?.valAccuracy ?? null, perClass: report.perClass, confusion: report.confusion, calibration: calibration(probs, correct), trainSize: train.length, testSize: test.length, bestEpoch: fit.bestEpoch, trainMs: Date.now() - t0 },
    history: fit.history,
    config: { dim, hidden, epochs, seed, features: 'hashed word 1-2grams + char 3-grams, sub-linear TF, L2', architecture: `MLP ${dim}→${hidden} ReLU→${labels.length} softmax`, optimizer: 'Adam lr=0.01, L2 1e-4, dropout 0.15, early stopping' },
  };
}

/** Routing decision with explicit guards. Returns {route, label, prob, margin, reason}. */
export function decideRoute(model, text, { threshold = 0.85, margin = 0.5 } = {}) {
  const top = predictIntent(model, text, 2);
  const [a, b] = top;
  const m = a.prob - (b?.prob ?? 0);
  const words = tokens(text).filter((w) => w.length > 2 && !STOP.has(w)).map(hashWord);
  const supported = a.label !== OPEN && words.some((w) => (model.support?.[a.label] ?? []).includes(w));
  const route = a.label !== OPEN && ROUTABLE.includes(a.label) && a.prob >= threshold && m >= margin && supported;
  const reason = a.label === OPEN ? 'predicted an open question' : a.prob < threshold ? `confidence ${a.prob} below ${threshold}` : m < margin ? `margin ${m.toFixed(2)} below ${margin}` : !supported ? 'no content word shared with the training examples of this capability' : 'confident, supported, read-only';
  return { route, label: a.label, prob: a.prob, margin: +m.toFixed(4), top, reason };
}

export function predictIntent(model, text, k = 3) {
  const net = model.net ?? MLP.fromJSON(model.weights);
  const p = net.predict(featurize(text, model.config.dim));
  return p.map((prob, i) => ({ label: model.labels[i], prob: +prob.toFixed(4) })).sort((a, b) => b.prob - a.prob).slice(0, k);
}
