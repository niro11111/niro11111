// Digital World Engine - public website layer. For website / business / store / booking / course
// projects, the generated app also gets a complete public site: home (hero, services or products,
// why us, about, FAQ, contact), store with cart and checkout, online booking, blog, SEO (meta,
// Open Graph, JSON-LD, sitemap.xml, robots.txt), RTL/LTR, responsive, accessible.
// Content comes from the request + a per-business-type copy library, is written into the database
// as seed data, and is editable in the admin. Honesty rules: no invented customer reviews (the
// testimonials section stays hidden until the owner approves real ones), no invented phone numbers,
// addresses or prices presented as facts (prices are marked as starting suggestions to edit).

const KINDS = [
  ['barber', /barber|hair ?salon|haircut|מספרה|ספר(?:ית)?\b|תספורת/i],
  ['restaurant', /restaurant|cafe|coffee|bistro|pizza|מסעדה|בית קפה|קפה|פיצרי|בר\b/i],
  ['law', /law(?:yer| firm)|attorney|legal|עורך דין|עורכת דין|משרד עורכי|משפט/i],
  ['clinic', /clinic|dentist|dental|doctor|therap|physio|קליניק|מרפא|רופא|שיניים|טיפול|פיזיותרפ/i],
  ['fitness', /gym|fitness|yoga|pilates|personal trainer|studio|כושר|יוגה|פילאטיס|מאמן|סטודיו/i],
  ['realestate', /real estate|realtor|property|נדל"?ן|דירות|תיווך/i],
  ['tech', /software|saas|startup|app development|it services|tech|הייטק|תוכנה|סטארט|פיתוח אפליקציות/i],
  ['photo', /photograph|photo studio|צלם|צילום/i],
  ['shop', /store|shop|boutique|חנות|בוטיק/i],
  ['school', /course|academy|school|tutor|קורס|אקדמי|בית ספר|שיעורים/i],
];

// Per kind: [he, en] copy. Services carry a suggested starting price the owner edits.
const COPY = {
  barber: { palette: ['#1d1d1f', '#c8a04a'], he: { tagline: 'תספורת מדויקת, חוויה של פעם', hero: 'הסטייל שלך מתחיל כאן', heroText: 'ספרים מקצועיים, אווירה נעימה ותור בכמה קליקים.', about: 'אנחנו מספרה שכונתית שמאמינה בעבודה מדויקת, בזמנים מדויקים ובשירות אישי.', features: [['ספרים מנוסים', 'עבודה מקצועית בכל תספורת'], ['תור אונליין', 'בוחרים שעה ומגיעים'], ['היגיינה קפדנית', 'כלים מחוטאים בין כל לקוח']], services: [['תספורת גברים', 'תספורת קלאסית או מודרנית כולל עיצוב', 70, 30], ['עיצוב זקן', 'קיצוץ, עיצוב קווים וטיפוח', 50, 20], ['תספורת ילדים', 'עד גיל 12', 55, 25], ['תספורת + זקן', 'החבילה המלאה', 110, 45]], faq: [['צריך לקבוע תור מראש?', 'מומלץ. אפשר לקבוע כאן באתר, ונשתדל לקבל גם מזדמנים.'], ['כמה זמן לוקחת תספורת?', 'בדרך כלל 30 דקות.'], ['אילו אמצעי תשלום מקבלים?', 'מזומן, אשראי וביט.']] },
    en: { tagline: 'Precise cuts, classic experience', hero: 'Your style starts here', heroText: 'Professional barbers, a relaxed atmosphere and booking in a few clicks.', about: 'A neighborhood barbershop that believes in precise work, punctual appointments and personal service.', features: [['Experienced barbers', 'Professional work on every cut'], ['Online booking', 'Pick a time and come in'], ['Strict hygiene', 'Tools sanitized between clients']], services: [["Men's haircut", 'Classic or modern cut including styling', 25, 30], ['Beard trim', 'Trim, line-up and care', 18, 20], ["Kids' haircut", 'Up to age 12', 20, 25], ['Haircut + beard', 'The full package', 40, 45]], faq: [['Do I need an appointment?', 'Recommended: book here on the site. Walk-ins when possible.'], ['How long does a haircut take?', 'Usually 30 minutes.'], ['Which payments do you accept?', 'Cash and cards.']] } },
  restaurant: { palette: ['#2b1d16', '#e07a3f'], he: { tagline: 'אוכל טרי, אווירה ביתית', hero: 'בואו לאכול טוב', heroText: 'מנות טריות שמוכנות במקום, מחומרי גלם איכותיים.', about: 'המטבח שלנו מבשל כל יום מחדש, עם ירקות טריים וחומרי גלם שאנחנו בוחרים בעצמנו.', features: [['טרי כל יום', 'מבשלים בבוקר, מגישים בצהריים'], ['הזמנת שולחן', 'שומרים לכם מקום אונליין'], ['משלוחים ואיסוף', 'גם הביתה']], services: [['ארוחת בוקר', 'ביצים, סלט, לחם הבית ושתייה חמה', 62, 60], ['מנה עיקרית', 'מנת היום מהמטבח', 78, 60], ['קינוח', 'קינוח הבית', 38, 30]], faq: [['אפשר להזמין שולחן?', 'כן, כאן באתר.'], ['יש אפשרויות טבעוניות?', 'כן, שאלו אותנו על מנות היום.'], ['יש משלוחים?', 'כן, באזור הקרוב.']] },
    en: { tagline: 'Fresh food, homely feel', hero: 'Come eat well', heroText: 'Fresh dishes cooked on site from quality ingredients.', about: 'Our kitchen cooks from scratch every day with fresh produce we choose ourselves.', features: [['Fresh daily', 'Cooked in the morning, served at lunch'], ['Table booking', 'Reserve online'], ['Delivery & pickup', 'At home too']], services: [['Breakfast', 'Eggs, salad, house bread and a hot drink', 18, 60], ['Main course', "Today's dish from the kitchen", 22, 60], ['Dessert', 'House dessert', 9, 30]], faq: [['Can I book a table?', 'Yes, here on the site.'], ['Vegan options?', "Yes, ask about today's dishes."], ['Do you deliver?', 'Yes, nearby.']] } },
  law: { palette: ['#14213d', '#b08d57'], he: { tagline: 'ייעוץ משפטי ברור ואישי', hero: 'ליווי משפטי שאפשר לסמוך עליו', heroText: 'הסבר ברור, זמינות ומעקב צמוד בכל שלב.', about: 'המשרד מעניק ליווי משפטי אישי, בשפה ברורה ובשקיפות מלאה לגבי עלויות ולוחות זמנים.', features: [['שיחת היכרות', 'מבינים את המקרה לפני הכל'], ['שקיפות בעלויות', 'הצעת מחיר ברורה מראש'], ['זמינות', 'עדכונים שוטפים לאורך התיק']], services: [['פגישת ייעוץ', 'פגישה ראשונה לבחינת המקרה', 500, 60], ['עריכת חוזה', 'ניסוח ובדיקת הסכמים', 1500, 120], ['ליווי עסקה', 'ליווי מלא עד החתימה', 3000, 180]], faq: [['כמה עולה פגישת ייעוץ?', 'המחיר מופיע ברשימת השירותים; נעדכן מראש אם נדרש יותר.'], ['אפשר להיפגש בזום?', 'כן.'], ['המידע שלי חסוי?', 'כן, חל חיסיון עורך דין–לקוח.']] },
    en: { tagline: 'Clear, personal legal advice', hero: 'Legal guidance you can trust', heroText: 'Clear explanations, availability and close follow-up at every step.', about: 'The firm offers personal legal guidance in plain language, with full transparency on costs and timelines.', features: [['Intro call', 'We understand your case first'], ['Transparent fees', 'A clear quote up front'], ['Availability', 'Regular updates throughout']], services: [['Consultation', 'First meeting to review the case', 150, 60], ['Contract drafting', 'Drafting and reviewing agreements', 450, 120], ['Transaction support', 'Full support until signing', 900, 180]], faq: [['How much is a consultation?', 'See the services list; we tell you up front if more is needed.'], ['Can we meet online?', 'Yes.'], ['Is my information confidential?', 'Yes, attorney–client privilege applies.']] } },
  clinic: { palette: ['#0b3d4f', '#2bb3a3'], he: { tagline: 'טיפול מקצועי ביחס אישי', hero: 'הבריאות שלך בידיים טובות', heroText: 'צוות מקצועי, זמינות ותור אונליין.', about: 'הקליניקה מעניקה טיפול מקצועי ביחס אישי, עם הסבר ברור על כל שלב.', features: [['צוות מוסמך', 'אנשי מקצוע עם ניסיון'], ['תור אונליין', 'בוחרים מועד שנוח לכם'], ['יחס אישי', 'זמן אמיתי לכל מטופל']], services: [['בדיקה ראשונה', 'אבחון ותוכנית טיפול', 250, 45], ['טיפול', 'מפגש טיפול', 300, 45], ['מעקב', 'פגישת מעקב', 180, 30]], faq: [['צריך הפניה?', 'לרוב לא. אם צריך, נעדכן.'], ['אפשר לבטל תור?', 'כן, עד 24 שעות מראש.'], ['יש החזר מקופת חולים?', 'תלוי בביטוח שלכם; נשמח לתת קבלה מפורטת.']] },
    en: { tagline: 'Professional care, personal attention', hero: 'Your health in good hands', heroText: 'A professional team, availability and online booking.', about: 'The clinic provides professional care with personal attention and clear explanations at every step.', features: [['Certified team', 'Experienced professionals'], ['Online booking', 'Pick a time that suits you'], ['Personal care', 'Real time for every patient']], services: [['First assessment', 'Diagnosis and treatment plan', 80, 45], ['Treatment session', 'One session', 90, 45], ['Follow-up', 'Follow-up visit', 60, 30]], faq: [['Do I need a referral?', 'Usually not; we will tell you if you do.'], ['Can I cancel?', 'Yes, up to 24 hours before.'], ['Insurance?', 'Depends on your plan; we provide a detailed receipt.']] } },
  fitness: { palette: ['#111827', '#22c55e'], he: { tagline: 'אימון שמתאים לך', hero: 'מתחילים לזוז היום', heroText: 'אימונים בקבוצות קטנות ואימונים אישיים, לכל רמה.', about: 'סטודיו קטן עם יחס אישי: כל מתאמן מקבל תוכנית שמתאימה לו.', features: [['קבוצות קטנות', 'תשומת לב לכל מתאמן'], ['אימון אישי', 'תוכנית לפי מטרות'], ['כל הרמות', 'מתחילים ומתקדמים']], services: [['אימון ניסיון', 'אימון ראשון להיכרות', 0, 60], ['אימון קבוצתי', 'שיעור בקבוצה קטנה', 60, 60], ['אימון אישי', 'מאמן צמוד', 200, 60]], faq: [['צריך ניסיון קודם?', 'לא, מתאימים את האימון לרמה שלך.'], ['מה להביא?', 'בגדי ספורט, מים ומגבת.'], ['אפשר להקפיא מנוי?', 'כן, בתיאום מראש.']] },
    en: { tagline: 'Training that fits you', hero: 'Start moving today', heroText: 'Small-group and personal training for every level.', about: 'A small studio with personal attention: every member gets a plan that fits.', features: [['Small groups', 'Attention for everyone'], ['Personal training', 'A plan for your goals'], ['All levels', 'Beginners to advanced']], services: [['Trial session', 'First session to get to know us', 0, 60], ['Group class', 'Small-group class', 20, 60], ['Personal training', 'One-on-one coaching', 60, 60]], faq: [['Do I need experience?', 'No, training is adapted to your level.'], ['What to bring?', 'Sportswear, water and a towel.'], ['Can I pause my membership?', 'Yes, by arrangement.']] } },
  tech: { palette: ['#0f172a', '#6366f1'], he: { tagline: 'פתרונות דיגיטליים שעובדים', hero: 'בונים את המוצר הדיגיטלי שלכם', heroText: 'אפיון, פיתוח וליווי: אתרים, אפליקציות ומערכות.', about: 'צוות פיתוח שבונה מוצרים דיגיטליים מקצה לקצה, עם תקשורת שקופה ותוצאות מדידות.', features: [['מקצה לקצה', 'מאפיון ועד עלייה לאוויר'], ['שקיפות', 'עדכונים ודמואים שוטפים'], ['איכות', 'בדיקות אוטומטיות וקוד נקי']], services: [['אפיון מוצר', 'הגדרת דרישות ותוכנית עבודה', 3000, 0], ['פיתוח אתר', 'אתר מותאם עם מערכת ניהול', 12000, 0], ['פיתוח אפליקציה', 'אפליקציה לנייד ולווב', 30000, 0]], faq: [['כמה זמן לוקח פרויקט?', 'תלוי בהיקף; נותנים לוח זמנים אחרי האפיון.'], ['יש תמיכה אחרי העלייה?', 'כן, יש חבילות תחזוקה.'], ['איך מתחילים?', 'משאירים פרטים ונחזור לשיחת היכרות.']] },
    en: { tagline: 'Digital solutions that work', hero: 'We build your digital product', heroText: 'Discovery, development and support: websites, apps and systems.', about: 'A development team building digital products end to end, with transparent communication and measurable results.', features: [['End to end', 'From discovery to launch'], ['Transparency', 'Regular updates and demos'], ['Quality', 'Automated tests and clean code']], services: [['Product discovery', 'Requirements and a work plan', 900, 0], ['Website development', 'Custom site with a CMS', 3500, 0], ['App development', 'Mobile and web app', 9000, 0]], faq: [['How long does a project take?', 'Depends on scope; we give a timeline after discovery.'], ['Support after launch?', 'Yes, maintenance plans.'], ['How do we start?', 'Leave your details and we will call.']] } },
  generic: { palette: ['#0f172a', '#0ea5e9'], he: { tagline: 'שירות מקצועי ואישי', hero: 'ברוכים הבאים', heroText: 'כל מה שצריך לדעת עלינו, במקום אחד.', about: 'אנחנו עסק שמאמין בשירות אישי, באיכות ובשקיפות.', features: [['שירות אישי', 'זמינים בשבילכם'], ['איכות', 'מקפידים על כל פרט'], ['שקיפות', 'מחירים ותנאים ברורים']], services: [['שירות בסיסי', 'תיאור השירות — ערכו בממשק הניהול', 100, 60], ['שירות מורחב', 'תיאור השירות — ערכו בממשק הניהול', 200, 60], ['ייעוץ', 'שיחת ייעוץ', 150, 45]], faq: [['איך יוצרים קשר?', 'בטופס צור קשר שבתחתית העמוד.'], ['מה שעות הפעילות?', 'מופיעות בתחתית העמוד.']] },
    en: { tagline: 'Professional, personal service', hero: 'Welcome', heroText: 'Everything you need to know about us, in one place.', about: 'A business that believes in personal service, quality and transparency.', features: [['Personal service', 'Here for you'], ['Quality', 'Attention to detail'], ['Transparency', 'Clear prices and terms']], services: [['Basic service', 'Describe the service (edit in the admin)', 40, 60], ['Extended service', 'Describe the service (edit in the admin)', 80, 60], ['Consultation', 'A consultation call', 60, 45]], faq: [['How do I contact you?', 'Use the contact form at the bottom of the page.'], ['What are your hours?', 'Listed at the bottom of the page.']] } },
};
COPY.realestate = COPY.generic; COPY.photo = COPY.generic; COPY.shop = COPY.generic; COPY.school = COPY.generic;

const SITE_TYPES = new Set(['website', 'business', 'ecommerce', 'booking', 'education']);
export const wantsSite = (spec) => SITE_TYPES.has(spec.type) || /website|landing|web ?site|אתר|דף נחיתה/i.test(spec.request ?? '');

const pick = (re, t) => (t.match(re)?.[1] ?? '').trim() || null;

/** The public site's profile: from the request where given, otherwise from the business-type library. */
export function siteProfile(spec) {
  const t = spec.request ?? '';
  const he = spec.lang === 'he';
  const kind = KINDS.find(([, re]) => re.test(t))?.[0] ?? (spec.type === 'ecommerce' ? 'shop' : spec.type === 'education' ? 'school' : 'generic');
  const lib = (COPY[kind] ?? COPY.generic)[he ? 'he' : 'en'];
  const city = pick(/(?:\bin|ב)[-\s]?(תל אביב|ירושלים|חיפה|באר שבע|רמת גן|הרצליה|ראשון לציון|פתח תקווה|נתניה|אשדוד|חולון|רעננה|כפר סבא|מודיעין|[A-Z][a-z]+(?: [A-Z][a-z]+)?)/, t);
  const phone = pick(/(?:טלפון|phone|tel)[:\s]*([+0-9][0-9\s-]{7,15})/i, t);
  const email = pick(/([^\s@]+@[^\s@]+\.[a-z]{2,})/i, t);
  const commerce = spec.type === 'ecommerce' || kind === 'shop' ? 'store' : ['booking'].includes(spec.type) || ['barber', 'clinic', 'fitness', 'restaurant'].includes(kind) ? 'booking' : null;
  const name = spec.title;
  return {
    name, kind, lang: he ? 'he' : 'en', city,
    tagline: lib.tagline, heroTitle: lib.hero, heroText: city ? `${lib.heroText} ${he ? `ב${city}.` : `In ${city}.`}` : lib.heroText,
    about: lib.about, features: lib.features.map(([title, text]) => ({ title, text })), faq: lib.faq.map(([q, a]) => ({ q, a })),
    contact: { phone, email, address: city, hours: he ? 'א׳–ה׳ 09:00–19:00, ו׳ 09:00–13:00' : 'Sun–Thu 09:00–19:00, Fri 09:00–13:00' },
    palette: { bg: (COPY[kind] ?? COPY.generic).palette[0], accent: (COPY[kind] ?? COPY.generic).palette[1] },
    commerce, currency: he ? 'ILS' : 'USD',
    seedServices: lib.services.map(([n, d, price, minutes]) => ({ name: n, description: d, price, durationMinutes: minutes })),
    notes: [he ? 'המחירים הם הצעה התחלתית לפי סוג העסק: עדכנו אותם בממשק הניהול לפני פרסום.' : 'Prices are starting suggestions for this type of business: update them in the admin before publishing.',
      he ? 'אין ביקורות מומצאות: אזור ההמלצות יופיע רק אחרי שתאשרו המלצות אמיתיות בממשק הניהול.' : 'No invented reviews: the testimonials section appears only after you approve real ones in the admin.',
      ...(!phone && !email ? [he ? 'לא צוינו טלפון ואימייל: הוסיפו אותם בהגדרות האתר.' : 'No phone or e-mail was given: add them in the site settings.'] : [])],
  };
}

/** Entities the public site needs, added when the request's template does not have them. */
export function siteEntities(spec, profile) {
  const F = (name, type = 'string', extra = {}) => ({ name, type, required: false, ...extra });
  const R = (f) => ({ ...f, required: true });
  const have = new Set(spec.entities.map((e) => e.name));
  const add = [];
  if (profile.commerce !== 'store' && !have.has('services')) add.push({ name: 'services', label: 'Services', labelHe: 'שירותים', publicRead: 'active', fields: [R(F('name')), F('description', 'text'), F('price', 'money'), F('durationMinutes', 'number'), F('active', 'boolean')] });
  if (profile.commerce === 'store' && !have.has('products')) add.push({ name: 'products', label: 'Products', labelHe: 'מוצרים', fields: [R(F('name')), F('description', 'text'), R(F('price', 'money')), F('stock', 'number'), F('category'), F('active', 'boolean')] });
  if (profile.commerce === 'store' && !have.has('orders')) add.push({ name: 'orders', label: 'Orders', labelHe: 'הזמנות', fields: [R(F('customer')), R(F('items', 'text')), R(F('total', 'money')), F('status', 'enum', { options: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] }), F('orderDate', 'date')] });
  if (profile.commerce === 'booking' && !have.has('bookings')) add.push({ name: 'bookings', label: 'Bookings', labelHe: 'תורים', fields: [R(F('customer')), R(F('service')), R(F('start', 'datetime')), F('status', 'enum', { options: ['requested', 'confirmed', 'completed', 'cancelled'] }), F('notes', 'text')] });
  if (!have.has('leads')) add.push({ name: 'leads', label: 'Contact requests', labelHe: 'פניות מהאתר', public: true, fields: [R(F('name')), R(F('email', 'email')), F('phone', 'phone'), R(F('message', 'text'))] });
  if (!have.has('posts')) add.push({ name: 'posts', label: 'Blog posts', labelHe: 'פוסטים', fields: [R(F('title')), F('summary', 'text'), F('body', 'text'), F('published', 'boolean')] });
  if (!have.has('testimonials')) add.push({ name: 'testimonials', label: 'Testimonials', labelHe: 'המלצות', fields: [R(F('author')), R(F('quote', 'text')), F('approved', 'boolean')] });
  return add;
}

/** Which entities the public site may read, and the switch that must be on for a row to be public. */
export const PUBLIC_READ = { services: 'active', products: 'active', posts: 'published', testimonials: 'approved', courses: 'published', articles: 'published' };
