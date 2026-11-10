// Digital World Engine - Stage 1 (Understand) and Stage 2 (Architect).
// Deterministic: a natural-language goal (Hebrew or English) becomes a product specification
// and an architecture. Nothing is invented: requirements come from the request or from a named,
// visible project template; anything else is listed as an assumption or a question.

const F = (name, type = 'string', extra = {}) => ({ name, type, required: false, ...extra });
const req = (f) => ({ ...f, required: true });

/** Project templates: the entities a type of system needs at minimum (shown to the user as the template, not as their requirements). */
export const TEMPLATES = {
  crm: { label: 'CRM', labelHe: 'מערכת CRM', entities: [
    { name: 'contacts', label: 'Contacts', labelHe: 'אנשי קשר', fields: [req(F('name')), F('email', 'email'), F('phone', 'phone'), F('company'), F('status', 'enum', { options: ['lead', 'prospect', 'customer', 'inactive'] }), F('notes', 'text')] },
    { name: 'deals', label: 'Deals', labelHe: 'עסקאות', fields: [req(F('title')), F('contact'), F('value', 'money'), F('stage', 'enum', { options: ['new', 'qualified', 'proposal', 'won', 'lost'] }), F('closeDate', 'date')] },
    { name: 'activities', label: 'Activities', labelHe: 'פעילויות', fields: [req(F('subject')), F('contact'), F('type', 'enum', { options: ['call', 'email', 'meeting', 'task'] }), F('due', 'date'), F('done', 'boolean')] }] },
  ecommerce: { label: 'E-commerce store', labelHe: 'חנות מקוונת', entities: [
    { name: 'products', label: 'Products', labelHe: 'מוצרים', fields: [req(F('name')), F('description', 'text'), req(F('price', 'money')), F('stock', 'number'), F('category'), F('active', 'boolean')] },
    { name: 'customers', label: 'Customers', labelHe: 'לקוחות', fields: [req(F('name')), req(F('email', 'email')), F('phone', 'phone'), F('address', 'text')] },
    { name: 'orders', label: 'Orders', labelHe: 'הזמנות', fields: [req(F('customer')), req(F('items', 'text')), req(F('total', 'money')), F('status', 'enum', { options: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] }), F('orderDate', 'date')] }] },
  booking: { label: 'Booking system', labelHe: 'מערכת הזמנת תורים', entities: [
    { name: 'services', label: 'Services', labelHe: 'שירותים', fields: [req(F('name')), F('durationMinutes', 'number'), F('price', 'money')] },
    { name: 'customers', label: 'Customers', labelHe: 'לקוחות', fields: [req(F('name')), F('phone', 'phone'), F('email', 'email')] },
    { name: 'bookings', label: 'Bookings', labelHe: 'תורים', fields: [req(F('customer')), req(F('service')), req(F('start', 'datetime')), F('status', 'enum', { options: ['requested', 'confirmed', 'completed', 'cancelled'] }), F('notes', 'text')] }] },
  projects: { label: 'Project management', labelHe: 'ניהול פרויקטים', entities: [
    { name: 'projects', label: 'Projects', labelHe: 'פרויקטים', fields: [req(F('name')), F('owner'), F('status', 'enum', { options: ['planned', 'active', 'on-hold', 'done'] }), F('due', 'date')] },
    { name: 'tasks', label: 'Tasks', labelHe: 'משימות', fields: [req(F('title')), F('project'), F('assignee'), F('priority', 'enum', { options: ['low', 'normal', 'high'] }), F('status', 'enum', { options: ['todo', 'doing', 'done'] }), F('due', 'date')] },
    { name: 'members', label: 'Team members', labelHe: 'חברי צוות', fields: [req(F('name')), F('email', 'email'), F('role')] }] },
  finance: { label: 'Personal finance', labelHe: 'ניהול כספים אישי', entities: [
    { name: 'accounts', label: 'Accounts', labelHe: 'חשבונות', fields: [req(F('name')), F('type', 'enum', { options: ['checking', 'savings', 'credit', 'investment'] }), F('balance', 'money')] },
    { name: 'transactions', label: 'Transactions', labelHe: 'תנועות', fields: [req(F('date', 'date')), req(F('description')), req(F('amount', 'money')), F('category'), F('account')] },
    { name: 'budgets', label: 'Budgets', labelHe: 'תקציבים', fields: [req(F('category')), req(F('monthlyLimit', 'money'))] }] },
  inventory: { label: 'Inventory', labelHe: 'ניהול מלאי', entities: [
    { name: 'items', label: 'Items', labelHe: 'פריטים', fields: [req(F('sku')), req(F('name')), F('quantity', 'number'), F('reorderLevel', 'number'), F('location')] },
    { name: 'suppliers', label: 'Suppliers', labelHe: 'ספקים', fields: [req(F('name')), F('email', 'email'), F('phone', 'phone')] },
    { name: 'movements', label: 'Stock movements', labelHe: 'תנועות מלאי', fields: [req(F('item')), req(F('quantity', 'number')), F('type', 'enum', { options: ['in', 'out', 'adjust'] }), F('date', 'date')] }] },
  support: { label: 'Customer support', labelHe: 'תמיכת לקוחות', entities: [
    { name: 'tickets', label: 'Tickets', labelHe: 'פניות', fields: [req(F('subject')), req(F('customerEmail', 'email')), F('description', 'text'), F('priority', 'enum', { options: ['low', 'normal', 'high', 'urgent'] }), F('status', 'enum', { options: ['open', 'pending', 'resolved', 'closed'] })] },
    { name: 'articles', label: 'Knowledge base', labelHe: 'מאגר ידע', fields: [req(F('title')), F('body', 'text'), F('published', 'boolean')] }] },
  website: { label: 'Company website', labelHe: 'אתר חברה', entities: [
    { name: 'pages', label: 'Pages', labelHe: 'עמודים', fields: [req(F('title')), req(F('slug')), F('body', 'text'), F('published', 'boolean')] },
    { name: 'leads', label: 'Contact requests', labelHe: 'פניות מהאתר', public: true, fields: [req(F('name')), req(F('email', 'email')), F('phone', 'phone'), req(F('message', 'text'))] }] },
  education: { label: 'Education platform', labelHe: 'פלטפורמת לימוד', entities: [
    { name: 'courses', label: 'Courses', labelHe: 'קורסים', fields: [req(F('title')), F('description', 'text'), F('price', 'money'), F('published', 'boolean')] },
    { name: 'students', label: 'Students', labelHe: 'תלמידים', fields: [req(F('name')), req(F('email', 'email'))] },
    { name: 'enrollments', label: 'Enrollments', labelHe: 'הרשמות', fields: [req(F('student')), req(F('course')), F('progress', 'number'), F('enrolledAt', 'date')] }] },
};
// A "digital business" is a composition: public website + leads, CRM, orders and support.
TEMPLATES.business = { label: 'Digital business', labelHe: 'עסק דיגיטלי', entities: [TEMPLATES.website.entities[1], TEMPLATES.crm.entities[0], TEMPLATES.crm.entities[1], TEMPLATES.ecommerce.entities[2], TEMPLATES.support.entities[0]] };

const TYPE_RULES = [
  ['business', /(?:online|digital|internet) business|start(?:up)? (?:a )?business|עסק (?:דיגיטלי|אונליין|מקוון|באינטרנט)|עסק שלם/i],
  ['crm', /\bcrm\b|customer relationship|ניהול (?:לקוחות|קשרי לקוחות)|מערכת לקוחות/i],
  ['booking', /booking|appointment|reservation|scheduling system|תורים|זימון|הזמנת (?:מקום|שולחן|תור)/i],
  ['ecommerce', /e-?commerce|online (?:store|shop)|web ?shop|e-?shop|\b(?:sell|selling)\b|\bstore\b|חנות|מסחר/i],
  ['projects', /project management|task management|kanban|ניהול (?:פרויקטים|משימות)/i],
  ['finance', /personal finance|budget|expense track|ניהול (?:כספים|תקציב|הוצאות)|כספים אישי/i],
  ['inventory', /inventory|stock management|warehouse|מלאי|מחסן/i],
  ['support', /customer support|help ?desk|ticket|תמיכ|פניות/i],
  ['education', /course|e-?learning|education|lms|קורס|לימוד|הדרכה/i],
  ['website', /website|landing page|web ?site|homepage|אתר|דף נחיתה/i],
];

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'world';
const camel = (s) => String(s).trim().replace(/[^\p{L}\p{N}]+(.)?/gu, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase());

function guessFieldType(name) {
  const n = name.toLowerCase();
  if (/mail|מייל|דוא"?ל/.test(n)) return 'email';
  if (/phone|tel|טלפון|נייד/.test(n)) return 'phone';
  if (/price|amount|cost|total|salary|מחיר|סכום|עלות/.test(n)) return 'money';
  if (/date|due|deadline|תאריך|יום/.test(n)) return 'date';
  if (/count|qty|quantity|age|number|כמות|גיל|מספר/.test(n)) return 'number';
  if (/description|notes|body|message|תיאור|הערות|הודעה/.test(n)) return 'text';
  if (/^(is|has)[A-Z]|active|done|פעיל/.test(name)) return 'boolean';
  return 'string';
}

/** Parses explicit entities: "contacts (name, email, phone)" / "לקוחות (שם, טלפון)". */
function explicitEntities(text) {
  const out = [];
  for (const m of text.matchAll(/([\p{L}][\p{L}\p{N} _-]{1,30})\s*\(([^)]{2,300})\)/gu)) {
    const STOPW = new Set(['with', 'and', 'of', 'the', 'a', 'an', 'for', 'system', 'build', 'create', 'me', 'עם', 'של', 'מערכת', 'גם']);
    const words = m[1].trim().split(/\s+/).map((w) => w.replace(/^ו(?=[\u05D0-\u05EA]{2,})/, ''));
    const kept = []; for (const w of words.reverse()) { if (STOPW.has(w.toLowerCase())) break; kept.unshift(w); if (kept.length === 2) break; }
    const name = kept.join(' ') || words[0];
    const fields = m[2].split(/[,،;]|\s+ו(?=\S)|\band\b/).map((x) => x.trim()).filter(Boolean).slice(0, 25).map((f, i) => ({ name: camel(f) || `field${i + 1}`, label: f, type: guessFieldType(f), required: i === 0 }));
    if (fields.length) out.push({ name: camel(name) || `entity${out.length + 1}`, label: name, labelHe: name, fields, explicit: true });
  }
  return out;
}

/** Stage 1: request → specification (or a clarification question). */
export function understand(text, { lang } = {}) {
  const t = String(text ?? '').trim();
  if (t.length < 4) throw Object.assign(new Error('describe what to build'), { status: 400 });
  const he = lang ? lang === 'he' : /[֐-׿]/.test(t);
  const type = TYPE_RULES.find(([, re]) => re.test(t))?.[0] ?? null;
  const ents = explicitEntities(t);
  const name = t.match(/\b(?:called|named)\s+["'“]?([^"'”,.]{2,40})["'”]?/i)?.[1]?.trim()
    ?? t.match(/for (?:my )?(?:company|business)\s+["'“]?([A-Z][^"'”,.]{1,40})["'”]?/)?.[1]?.trim()
    ?? t.match(/(?:בשם|שנקרא|שנקראת)\s+["'“]?([^"'”,.]{2,40})["'”]?/)?.[1]?.trim() ?? null;
  const audience = t.match(/(?:for|aimed at|targeting)\s+((?:small|local|young|busy|independent)[^,.]{2,60})/i)?.[1] ?? t.match(/(?:עבור|ל)(בעלי [^,.]{2,40}|לקוחות [^,.]{2,40}|משפחות[^,.]{0,40})/)?.[1] ?? null;
  const budget = t.match(/budget (?:of )?([$₪€]?\s?\d[\d,.]*\s?(?:k|K|USD|ILS|₪|\$)?)|תקציב (?:של )?(\d[\d,.]*\s?(?:₪|ש"ח|שקל)?)/i);
  const integrations = [...new Set([...(t.match(/\b(stripe|paypal|gmail|google calendar|slack|whatsapp|github|twilio|sendgrid|shopify)\b/gi) ?? [])].map((x) => x.toLowerCase()))];
  if (!type && !ents.length) {
    return { status: 'needs-input', question: he ? 'איזה סוג מערכת לבנות? למשל: CRM, חנות מקוונת, מערכת תורים, ניהול פרויקטים, ניהול מלאי, תמיכת לקוחות, אתר חברה, או רשימת ישויות ושדות, כמו: לקוחות (שם, טלפון, אימייל)' : 'What kind of system should I build? E.g. CRM, online store, booking, project management, inventory, support desk, company website, or list entities and fields like: customers (name, phone, email)', request: t };
  }
  const tpl = type ? TEMPLATES[type] : null;
  // Explicit entities always win; template entities fill in only what was not specified.
  const entities = [...ents, ...(tpl?.entities ?? []).filter((e) => !ents.some((x) => x.name === e.name))].map((e) => ({ ...e, fields: e.fields.map((f) => ({ ...f })) }));
  const title = name ?? (tpl ? (he ? tpl.labelHe : tpl.label) : (he ? 'מערכת חדשה' : 'New system'));
  const assumptions = [];
  if (tpl && !ents.length) assumptions.push(he ? `המבנה מבוסס על תבנית "${tpl.labelHe}" כי לא פורטו ישויות. אפשר לשנות.` : `The data model uses the "${tpl.label}" template because no entities were specified. You can change it.`);
  if (!audience) assumptions.push(he ? 'קהל היעד לא צוין.' : 'No target audience was specified.');
  assumptions.push(he ? 'משתמש מנהל אחד עם אסימון גישה; ניתן להוסיף משתמשים בהמשך.' : 'One admin user with an access token; more users can be added later.');
  return {
    status: 'specified', request: t, lang: he ? 'he' : 'en', type: type ?? 'custom', templateLabel: tpl ? (he ? tpl.labelHe : tpl.label) : null,
    title, slug: slug(title), audience, budget: budget ? (budget[1] ?? budget[2]).trim() : null, integrations, entities,
    publicEntities: entities.filter((e) => e.public).map((e) => e.name),
    requirements: [
      ...entities.map((e) => (he ? `ניהול ${e.labelHe ?? e.label}: יצירה, צפייה, חיפוש, עדכון ומחיקה` : `Manage ${e.label}: create, view, search, update, delete`)),
      he ? 'אימות קלט בשרת ובדפדפן, הודעות שגיאה ברורות' : 'Input validation on server and client, clear error messages',
      he ? 'ממשק רספונסיבי' : 'Responsive interface',
      he ? 'בדיקות אוטומטיות לכל ה-API' : 'Automated tests for the whole API',
    ],
    assumptions,
    openQuestions: integrations.length ? [he ? `לחיבור ${integrations.join(', ')} צריך פרטי גישה (לא יוזנו פרטים מזויפים).` : `Connecting ${integrations.join(', ')} needs credentials (no fake credentials are ever used).`] : [],
  };
}

const TYPE_DB = { string: 'TEXT', text: 'TEXT', email: 'TEXT (validated e-mail)', phone: 'TEXT (validated phone)', number: 'NUMBER', money: 'NUMBER (2 decimals)', date: 'DATE (YYYY-MM-DD)', datetime: 'DATETIME (ISO 8601)', boolean: 'BOOLEAN', enum: 'TEXT (one of options)' };

/** Stage 2: specification → architecture document (what the generator will build, and how it is tested and deployed). */
export function architect(spec) {
  const api = [{ method: 'GET', path: '/api/health', auth: 'public', purpose: 'liveness + version' }, { method: 'GET', path: '/api/metrics', auth: 'admin', purpose: 'request/error counters, uptime' }];
  for (const e of spec.entities) {
    api.push({ method: 'GET', path: `/api/${e.name}`, auth: 'admin', purpose: `list/search ${e.label}` });
    api.push({ method: 'POST', path: `/api/${e.name}`, auth: e.public ? 'public' : 'admin', purpose: `create ${e.label}` });
    api.push({ method: 'GET', path: `/api/${e.name}/:id`, auth: 'admin', purpose: 'read one' });
    api.push({ method: 'PUT', path: `/api/${e.name}/:id`, auth: 'admin', purpose: 'update' });
    api.push({ method: 'DELETE', path: `/api/${e.name}/:id`, auth: 'admin', purpose: 'delete' });
  }
  return {
    style: 'Single Node.js service (no third-party dependencies) serving a REST API and a static web UI',
    components: [
      { name: 'server.js', role: 'HTTP server, routing, validation, auth, security headers, JSON persistence with atomic writes' },
      { name: 'schema.json', role: 'single source of truth for entities and fields, used by server and UI' },
      { name: 'public/', role: 'responsive web UI: navigation per entity, search, create/edit forms with validation, delete, error states' },
      { name: 'tests/', role: 'node:test suite that starts the real server and exercises every endpoint' },
      { name: 'Dockerfile', role: 'container image definition for deployment' },
    ],
    database: spec.entities.map((e) => ({ table: e.name, columns: [{ name: 'id', type: 'TEXT PK' }, ...e.fields.map((f) => ({ name: f.name, type: TYPE_DB[f.type] ?? 'TEXT', required: !!f.required, options: f.options })), { name: 'createdAt', type: 'DATETIME' }, { name: 'updatedAt', type: 'DATETIME' }], indexes: ['id (primary)', ...e.fields.filter((f) => f.required).slice(0, 2).map((f) => `${f.name} (search)`)] })),
    storage: 'JSON file per app instance (data/db.json, atomic rename); swap-ready behind one module',
    roles: [{ role: 'admin', how: 'APP_TOKEN bearer token (set in the environment, never in code)', can: 'everything' }, { role: 'public', can: spec.publicEntities.length ? `create ${spec.publicEntities.join(', ')} only; read health` : 'read health only' }],
    api,
    security: ['Server-side validation of every field (type, required, enum, length ≤ 5,000)', 'Body size limit 100 KB', 'Bearer token for admin operations; constant-time comparison', 'Security headers: CSP (self only), X-Content-Type-Options, frame-ancestors none, referrer policy', 'Binds 127.0.0.1 by default; no secrets in source; .env.example lists required variables', 'HTML escaping in the UI (no innerHTML of user data)'],
    deployment: [{ target: 'local-preview', how: 'JARVIS starts the app on a free local port and health-checks it' }, { target: 'docker', how: 'docker build/run from the generated Dockerfile (needs Docker on the host)' }, { target: 'cloud', how: 'needs a configured hosting provider and credentials' }],
    testing: ['node --check on every source file (build)', 'node:test API suite against the real server (unit/integration)', 'post-build verification: start the built app, call health, UI and a create/list round-trip over HTTP'],
  };
}
