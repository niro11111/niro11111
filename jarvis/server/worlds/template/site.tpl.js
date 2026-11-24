// Templates for the generated public website (raw strings: no backticks or placeholders inside).
// The page renders from /api/site and the public lists, so everything is editable in the admin.
// User data is written with textContent only. __X__ markers are replaced at generation time.
export const SITE_HTML = String.raw`<!doctype html>
<html lang="__LANG__" dir="__DIR__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ | __TAGLINE__</title>
<meta name="description" content="__DESC__">
<meta property="og:type" content="website">
<meta property="og:title" content="__TITLE__">
<meta property="og:description" content="__DESC__">
<meta name="theme-color" content="__BG__">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='__ACCENT_URL__'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/site/site.css">
<script type="application/ld+json">__JSONLD__</script>
<script type="module" src="/site/site.js"></script>
</head>
<body>
<a class="skip" href="#main">__SKIP__</a>
<header class="nav" id="top"><div class="wrap row"><a class="brand" href="#top" id="brand">__TITLE__</a><nav id="menu" aria-label="Menu"></nav><button id="cartBtn" class="cart hidden" type="button" aria-label="Cart">🛒 <b id="cartCount">0</b></button><button id="menuBtn" class="burger" type="button" aria-label="Menu" aria-expanded="false">☰</button></div></header>
<main id="main">
  <section class="hero"><div class="wrap"><p class="eyebrow" id="tagline">__TAGLINE__</p><h1 id="heroTitle">__TITLE__</h1><p class="lead" id="heroText"></p><div class="row cta"><a class="btn primary" id="ctaMain" href="#contact"></a><a class="btn ghost" href="#offer" id="ctaSecond"></a></div></div></section>
  <section class="features"><div class="wrap grid3" id="features"></div></section>
  <section id="offer"><div class="wrap"><h2 id="offerTitle"></h2><div class="grid3" id="offerList"></div><p class="muted small" id="offerEmpty" hidden></p></div></section>
  <section id="about" class="alt"><div class="wrap two"><div><h2 id="aboutTitle"></h2><p id="aboutText"></p></div><div class="facts" id="facts"></div></div></section>
  <section id="reviews" hidden><div class="wrap"><h2 id="reviewsTitle"></h2><div class="grid3" id="reviewList"></div></div></section>
  <section id="blog" hidden><div class="wrap"><h2 id="blogTitle"></h2><div class="grid3" id="postList"></div></div></section>
  <section id="faq" class="alt"><div class="wrap narrow"><h2 id="faqTitle"></h2><div id="faqList"></div></div></section>
  <section id="contact"><div class="wrap two"><div><h2 id="contactTitle"></h2><ul class="info" id="info"></ul></div>
    <form id="leadForm" class="card form" novalidate><label><span id="lName"></span><input name="name" required autocomplete="name"></label><label><span id="lEmail"></span><input name="email" type="email" required autocomplete="email"></label><label><span id="lPhone"></span><input name="phone" type="tel" autocomplete="tel"></label><label><span id="lMsg"></span><textarea name="message" rows="4" required></textarea></label><button class="btn primary" id="leadSend"></button><p class="msg" role="status" id="leadMsg"></p></form></div></section>
</main>
<footer><div class="wrap row"><span id="copy"></span><a href="/admin" class="muted small" id="adminLink"></a></div></footer>
<dialog id="dlg"><form method="dialog" class="x"><button aria-label="Close">✕</button></form><div id="dlgBody"></div></dialog>
<noscript><p class="wrap">This site needs JavaScript for the catalog, booking and contact form.</p></noscript>
</body>
</html>
`;

export const SITE_CSS = String.raw`:root{--bg:#0f172a;--accent:#0ea5e9;--text:#1e293b;--muted:#64748b;--line:#e2e8f0;--card:#fff;--soft:#f8fafc;--r:14px;font-family:system-ui,-apple-system,"Segoe UI",Rubik,Arial,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--text);background:#fff;line-height:1.6}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.hidden,[hidden]{display:none!important}
.skip{position:absolute;inset-inline-start:-999px}.skip:focus{inset-inline-start:12px;top:12px;background:#fff;padding:8px;z-index:9}
.nav{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);color:#fff}
.nav .row{min-height:64px;justify-content:space-between}.brand{color:#fff;font-weight:800;font-size:1.2rem;text-decoration:none}
#menu{display:flex;gap:18px}#menu a{color:#e2e8f0;text-decoration:none;font-weight:500}#menu a:hover{color:var(--accent)}
.burger{display:none;background:none;border:0;color:#fff;font-size:1.5rem}.cart{background:var(--accent);color:#fff;border:0;border-radius:999px;padding:6px 14px;font-weight:700;cursor:pointer}
.hero{background:radial-gradient(circle at 80% 0%,color-mix(in srgb,var(--accent) 45%,transparent),transparent 55%),var(--bg);color:#fff;padding:96px 0 88px}
.hero h1{font-size:clamp(2rem,5vw,3.4rem);line-height:1.15;margin:.2em 0}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.02em;margin:0}.lead{font-size:1.2rem;color:#cbd5e1;max-width:620px}
.cta{margin-top:28px}.btn{display:inline-block;padding:12px 22px;border-radius:999px;font-weight:700;text-decoration:none;border:2px solid transparent;cursor:pointer;font:inherit;font-weight:700}
.btn.primary{background:var(--accent);color:#fff}.btn.primary:hover{filter:brightness(1.08)}.btn.ghost{border-color:#ffffff55;color:#fff}.btn.small{padding:8px 16px;font-size:.92rem}
section{padding:72px 0}section h2{font-size:clamp(1.6rem,3vw,2.2rem);margin:0 0 28px}.alt{background:var(--soft)}
.grid3{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}.two{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}.narrow{max-width:760px}
.features{padding:0;margin-top:-40px}.feature,.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;box-shadow:0 8px 30px #0f172a12}
.feature h3{margin:.2em 0;font-size:1.1rem}.feature p{margin:0;color:var(--muted)}.feature .ic{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--accent) 16%,#fff);color:var(--accent);font-weight:800}
.item h3{margin:0 0 6px}.item p{color:var(--muted);margin:0 0 14px}.item .price{font-weight:800;font-size:1.2rem;color:var(--bg)}.item .meta{display:flex;justify-content:space-between;align-items:center;gap:8px}
.facts{display:grid;gap:12px}.fact{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:16px}
.quote{font-style:italic}.quote b{display:block;font-style:normal;margin-top:8px}
details{border-bottom:1px solid var(--line);padding:14px 0}summary{font-weight:700;cursor:pointer}details p{color:var(--muted);margin:8px 0 0}
.info{list-style:none;padding:0;margin:0;display:grid;gap:10px}.info a{color:var(--accent)}
.form label{display:grid;gap:4px;margin-bottom:12px;font-weight:600;font-size:.95rem}input,textarea,select{font:inherit;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;width:100%;background:#fff}
input:focus,textarea:focus,select:focus{outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent);border-color:var(--accent)}
.msg{min-height:1.4em;margin:10px 0 0}.msg.ok{color:#15803d}.msg.err{color:#b91c1c}.muted{color:var(--muted)}.small{font-size:.9rem}
footer{background:var(--bg);color:#cbd5e1;padding:28px 0}footer .row{justify-content:space-between}footer a{color:#94a3b8}
dialog{border:0;border-radius:18px;padding:24px;width:min(560px,94vw);max-height:90vh;box-shadow:0 30px 80px #0006}dialog::backdrop{background:#0f172a99}
dialog .x{position:absolute;inset-inline-end:12px;top:10px}dialog .x button{background:none;border:0;font-size:1.2rem;cursor:pointer}
.slots{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.slots button{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;font:inherit}.slots button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.line{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}.qty{display:flex;gap:6px;align-items:center}.qty button{width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer}
.total{font-weight:800;font-size:1.2rem;margin:12px 0}
@media (max-width:820px){.two{grid-template-columns:1fr}#menu{display:none;position:absolute;top:64px;inset-inline:0;flex-direction:column;background:var(--bg);padding:16px 20px}#menu.open{display:flex}.burger{display:block}.hero{padding:64px 0}section{padding:56px 0}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

export const SITE_JS = String.raw`// Generated public site. Renders from /api/site and the public lists; forms call the real API.
const $ = (s, el) => (el || document).querySelector(s);
const el = (tag, props, ...kids) => { const n = document.createElement(tag); Object.assign(n, props || {}); for (const k of kids) if (k != null) n.append(k); return n; };
let S = {}; let services = []; let products = []; const cart = load();
const he = () => S.lang === 'he';
const T = (en, h) => (he() ? h : en);
const money = (v) => new Intl.NumberFormat(he() ? 'he-IL' : 'en-US', { style: 'currency', currency: S.currency || 'ILS', maximumFractionDigits: 2 }).format(Number(v) || 0);
function load() { try { return JSON.parse(localStorage.getItem('site.cart') || '[]'); } catch { return []; } }
function save() { try { localStorage.setItem('site.cart', JSON.stringify(cart)); } catch {} renderCart(); }

async function api(path, opts) {
  const o = opts || {};
  const r = await fetch(path, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.errors && data.errors.join('; ')) || (data && data.error) || ('HTTP ' + r.status));
  return data;
}
const pub = (name) => api('/api/public/' + name).then((r) => r.items).catch(() => []);

function nav() {
  const links = [['#offer', S.commerce === 'store' ? T('Shop', 'חנות') : T('Services', 'שירותים')], ['#about', T('About', 'אודות')], ['#faq', T('FAQ', 'שאלות')], ['#contact', T('Contact', 'צור קשר')]];
  const m = $('#menu'); m.replaceChildren(...links.map(([h, t]) => el('a', { href: h, textContent: t, onclick: () => m.classList.remove('open') })));
  $('#menuBtn').onclick = () => { const o = m.classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(o)); };
}

function hero() {
  $('#brand').textContent = S.name; $('#tagline').textContent = S.tagline || ''; $('#heroTitle').textContent = S.heroTitle || S.name; $('#heroText').textContent = S.heroText || '';
  const main = $('#ctaMain');
  if (S.commerce === 'booking') { main.textContent = T('Book online', 'קביעת תור אונליין'); main.href = '#offer'; main.onclick = (e) => { e.preventDefault(); openBooking(); }; }
  else if (S.commerce === 'store') { main.textContent = T('Shop now', 'לחנות'); main.href = '#offer'; }
  else { main.textContent = T('Contact us', 'צרו קשר'); main.href = '#contact'; }
  $('#ctaSecond').textContent = S.commerce === 'store' ? T('Contact', 'צור קשר') : T('What we offer', 'מה אנחנו מציעים'); $('#ctaSecond').href = S.commerce === 'store' ? '#contact' : '#offer';
  $('#features').replaceChildren(...(S.features || []).map((f, i) => el('div', { className: 'feature' }, el('span', { className: 'ic', textContent: String(i + 1) }), el('h3', { textContent: f.title }), el('p', { textContent: f.text }))));
}

function offer() {
  const store = S.commerce === 'store';
  $('#offerTitle').textContent = store ? T('Products', 'מוצרים') : T('Services & prices', 'שירותים ומחירים');
  const list = store ? products : services;
  $('#offerEmpty').hidden = list.length > 0; $('#offerEmpty').textContent = T('Coming soon.', 'בקרוב.');
  $('#offerList').replaceChildren(...list.map((x) => {
    const out = typeof x.stock === 'number' && x.stock <= 0;
    const btn = store ? el('button', { className: 'btn primary small', type: 'button', disabled: out, textContent: out ? T('Sold out', 'אזל') : T('Add to cart', 'הוספה לסל'), onclick: () => addToCart(x) })
      : S.commerce === 'booking' ? el('button', { className: 'btn primary small', type: 'button', textContent: T('Book', 'לקביעת תור'), onclick: () => openBooking(x.id) })
      : el('a', { className: 'btn primary small', href: '#contact', textContent: T('Ask about it', 'לפרטים') });
    const meta = [x.durationMinutes ? x.durationMinutes + ' ' + T('min', 'דק׳') : null, x.category || null].filter(Boolean).join(' · ');
    return el('article', { className: 'card item' }, el('h3', { textContent: x.name }), el('p', { textContent: x.description || '' }), meta ? el('p', { className: 'small', textContent: meta }) : null,
      el('div', { className: 'meta' }, el('span', { className: 'price', textContent: Number(x.price) > 0 ? money(x.price) : T('Free', 'חינם') }), btn));
  }));
}

function about() {
  $('#aboutTitle').textContent = T('About us', 'אודותינו'); $('#aboutText').textContent = S.about || '';
  const c = S.contact || {};
  $('#facts').replaceChildren(...[[T('Hours', 'שעות פעילות'), c.hours], [T('Where', 'איפה'), c.address]].filter((x) => x[1]).map(([k, v]) => el('div', { className: 'fact' }, el('b', { textContent: k }), el('div', { textContent: v }))));
}
function reviews(list) {
  if (!list.length) return; // real, approved testimonials only
  $('#reviews').hidden = false; $('#reviewsTitle').textContent = T('What clients say', 'מה הלקוחות אומרים');
  $('#reviewList').replaceChildren(...list.map((r) => el('blockquote', { className: 'card quote' }, el('span', { textContent: '“' + r.quote + '”' }), el('b', { textContent: r.author }))));
}
function blog(list) {
  if (!list.length) return;
  $('#blog').hidden = false; $('#blogTitle').textContent = T('Blog', 'בלוג');
  $('#postList').replaceChildren(...list.map((p) => el('article', { className: 'card item' }, el('h3', { textContent: p.title }), el('p', { textContent: p.summary || '' }), el('button', { className: 'btn primary small', type: 'button', textContent: T('Read', 'לקריאה'), onclick: () => openPost(p) }))));
  const q = new URLSearchParams(location.search).get('post'); const p = q && list.find((x) => x.id === q); if (p) openPost(p);
}
function openPost(p) { dialog(el('article', {}, el('h2', { textContent: p.title }), ...String(p.body || p.summary || '').split(/\n{2,}/).map((t) => el('p', { textContent: t })))); }
function faq() {
  $('#faqTitle').textContent = T('Frequently asked questions', 'שאלות נפוצות');
  $('#faqList').replaceChildren(...(S.faq || []).map((f) => el('details', {}, el('summary', { textContent: f.q }), el('p', { textContent: f.a }))));
  if (!(S.faq || []).length) $('#faq').hidden = true;
}
function contact() {
  $('#contactTitle').textContent = T('Get in touch', 'דברו איתנו');
  const c = S.contact || {};
  $('#info').replaceChildren(...[c.phone && ['📞', c.phone, 'tel:' + c.phone.replace(/[^+0-9]/g, '')], c.email && ['✉', c.email, 'mailto:' + c.email], c.address && ['📍', c.address, null], c.hours && ['🕘', c.hours, null]].filter(Boolean)
    .map(([i, t, h]) => el('li', {}, i + ' ', h ? el('a', { href: h, textContent: t }) : t)));
  $('#lName').textContent = T('Name', 'שם'); $('#lEmail').textContent = T('E-mail', 'אימייל'); $('#lPhone').textContent = T('Phone (optional)', 'טלפון (לא חובה)'); $('#lMsg').textContent = T('Message', 'הודעה'); $('#leadSend').textContent = T('Send', 'שליחה');
  const f = $('#leadForm');
  f.onsubmit = async (e) => {
    e.preventDefault(); const m = $('#leadMsg');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const body = Object.fromEntries(new FormData(f)); if (!body.phone) delete body.phone;
    $('#leadSend').disabled = true;
    try { await api('/api/leads', { method: 'POST', body }); f.reset(); m.className = 'msg ok'; m.textContent = T('Thanks! We will get back to you soon.', 'תודה! נחזור אליכם בהקדם.'); }
    catch (err) { m.className = 'msg err'; m.textContent = err.message; }
    finally { $('#leadSend').disabled = false; }
  };
}

function dialog(node) { $('#dlgBody').replaceChildren(node); const d = $('#dlg'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
function field(labelText, input) { return el('label', { className: 'fl' }, el('span', { textContent: labelText }), input); }

// ---------- store ----------
function addToCart(p) { const l = cart.find((x) => x.id === p.id); if (l) l.qty = Math.min(99, l.qty + 1); else cart.push({ id: p.id, qty: 1 }); save(); }
function renderCart() {
  const b = $('#cartBtn'); if (S.commerce !== 'store') return;
  b.classList.remove('hidden'); $('#cartCount').textContent = String(cart.reduce((a, x) => a + x.qty, 0));
  b.onclick = openCart;
}
function openCart() {
  const lines = cart.map((l) => ({ ...l, p: products.find((p) => p.id === l.id) })).filter((l) => l.p);
  const box = el('div', { className: 'form' }, el('h2', { textContent: T('Your cart', 'סל הקניות') }));
  if (!lines.length) { box.append(el('p', { className: 'muted', textContent: T('The cart is empty.', 'הסל ריק.') })); return dialog(box); }
  for (const l of lines) box.append(el('div', { className: 'line' }, el('span', { textContent: l.p.name }), el('span', { className: 'qty' },
    el('button', { type: 'button', textContent: '−', ariaLabel: '-', onclick: () => { l.qty > 1 ? cart.find((x) => x.id === l.id).qty-- : cart.splice(cart.findIndex((x) => x.id === l.id), 1); save(); openCart(); } }),
    el('b', { textContent: String(l.qty) }),
    el('button', { type: 'button', textContent: '+', ariaLabel: '+', onclick: () => { cart.find((x) => x.id === l.id).qty++; save(); openCart(); } })), el('span', { textContent: money(l.p.price * l.qty) })));
  box.append(el('p', { className: 'total', textContent: T('Total', 'סה״כ') + ': ' + money(lines.reduce((a, l) => a + l.p.price * l.qty, 0)) }));
  const f = el('form', { noValidate: true });
  const name = el('input', { name: 'name', required: true, autocomplete: 'name' }); const email = el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' });
  const phone = el('input', { name: 'phone', type: 'tel', autocomplete: 'tel' }); const addr = el('textarea', { name: 'address', rows: 2, required: true, autocomplete: 'street-address' });
  const msg = el('p', { className: 'msg', role: 'status' });
  f.append(field(T('Name', 'שם'), name), field(T('E-mail', 'אימייל'), email), field(T('Phone', 'טלפון'), phone), field(T('Shipping address', 'כתובת למשלוח'), addr), el('button', { className: 'btn primary', textContent: T('Place order', 'ביצוע הזמנה') }), msg);
  f.onsubmit = async (e) => {
    e.preventDefault(); if (!f.checkValidity()) { f.reportValidity(); return; }
    try {
      const r = await api('/api/checkout', { method: 'POST', body: { customer: { name: name.value, email: email.value, phone: phone.value || undefined, address: addr.value }, items: cart.map((x) => ({ id: x.id, qty: x.qty })) } });
      cart.length = 0; save(); products = await pub('products'); offer();
      dialog(el('div', {}, el('h2', { textContent: T('Order received ✓', 'ההזמנה התקבלה ✓') }), el('p', { textContent: T('Order number', 'מספר הזמנה') + ': ' + r.orderId.slice(0, 8) }), el('p', { className: 'total', textContent: T('Total', 'סה״כ') + ': ' + money(r.total) }), el('p', { className: 'muted small', textContent: T('We will contact you to arrange payment and delivery.', 'ניצור קשר לתיאום תשלום ומשלוח.') })));
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  };
  box.append(f); dialog(box);
}

// ---------- booking ----------
async function openBooking(serviceId) {
  const box = el('div', { className: 'form' }, el('h2', { textContent: T('Book an appointment', 'קביעת תור') }));
  const sel = el('select', { name: 'service' }, ...services.map((s) => el('option', { value: s.id, textContent: s.name + (s.durationMinutes ? ' · ' + s.durationMinutes + ' ' + T('min', 'דק׳') : '') + (Number(s.price) > 0 ? ' · ' + money(s.price) : '') })));
  if (serviceId) sel.value = serviceId;
  const today = new Date(); const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const date = el('input', { type: 'date', min: iso(today), value: iso(today), required: true });
  const slots = el('div', { className: 'slots', role: 'group' }); let chosen = null;
  const name = el('input', { name: 'name', required: true, autocomplete: 'name' }); const phone = el('input', { name: 'phone', type: 'tel', required: true, autocomplete: 'tel' }); const email = el('input', { name: 'email', type: 'email', autocomplete: 'email' });
  const msg = el('p', { className: 'msg', role: 'status' });
  async function loadSlots() {
    slots.replaceChildren(el('span', { className: 'muted', textContent: '…' })); chosen = null;
    const svc = services.find((s) => s.id === sel.value); const dur = (svc && Number(svc.durationMinutes)) || 30;
    const day = new Date(date.value + 'T00:00:00'); const from = new Date(day); from.setHours(9); const to = new Date(day); to.setHours(19);
    let taken = [];
    try { taken = (await api('/api/busy?from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString()))).busy.map((b) => [Date.parse(b.start), Date.parse(b.end)]); } catch {}
    const out = [];
    for (let t = from.getTime(); t + dur * 60000 <= to.getTime(); t += 30 * 60000) {
      if (t < Date.now() + 30 * 60000) continue;
      if (taken.some(([a, b]) => t < b && t + dur * 60000 > a)) continue;
      out.push(t);
    }
    slots.replaceChildren(...(out.length ? out.map((t) => el('button', { type: 'button', textContent: new Date(t).toLocaleTimeString(he() ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), onclick: (e) => { chosen = t; for (const b of slots.children) b.setAttribute('aria-pressed', 'false'); e.target.setAttribute('aria-pressed', 'true'); } })) : [el('span', { className: 'muted', textContent: T('No free times on this day.', 'אין שעות פנויות ביום הזה.') })]));
  }
  sel.onchange = loadSlots; date.onchange = loadSlots;
  const f = el('form', { noValidate: true });
  f.append(field(T('Service', 'שירות'), sel), field(T('Date', 'תאריך'), date), el('div', {}, el('b', { className: 'small', textContent: T('Free times', 'שעות פנויות') }), slots), field(T('Name', 'שם'), name), field(T('Phone', 'טלפון'), phone), field(T('E-mail (optional)', 'אימייל (לא חובה)'), email), el('button', { className: 'btn primary', textContent: T('Confirm', 'אישור התור') }), msg);
  f.onsubmit = async (e) => {
    e.preventDefault(); if (!f.checkValidity()) { f.reportValidity(); return; }
    if (!chosen) { msg.className = 'msg err'; msg.textContent = T('Choose a time.', 'בחרו שעה.'); return; }
    try {
      const r = await api('/api/book', { method: 'POST', body: { serviceId: sel.value, start: new Date(chosen).toISOString(), name: name.value, phone: phone.value, email: email.value || undefined } });
      dialog(el('div', {}, el('h2', { textContent: T('Booked ✓', 'התור נקבע ✓') }), el('p', { textContent: r.service + ' · ' + new Date(r.start).toLocaleString(he() ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) }), el('p', { className: 'muted small', textContent: T('We will confirm by phone.', 'נאשר איתכם בטלפון.') })));
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; if (/taken|תפוס/.test(err.message)) loadSlots(); }
  };
  box.append(f); dialog(box); loadSlots();
}

async function boot() {
  S = await api('/api/site');
  const r = document.documentElement.style; if (S.palette) { r.setProperty('--bg', S.palette.bg); r.setProperty('--accent', S.palette.accent); }
  [services, products] = await Promise.all([pub('services'), pub('products')]);
  nav(); hero(); offer(); about(); faq(); contact(); renderCart();
  const [rv, posts] = await Promise.all([pub('testimonials'), pub('posts')]); reviews(rv); blog(posts);
  $('#copy').textContent = '© ' + new Date().getFullYear() + ' ' + S.name; $('#adminLink').textContent = T('Admin', 'ניהול');
}
boot().catch((e) => { document.body.prepend(el('p', { className: 'msg err wrap', textContent: 'Failed to load: ' + e.message })); });
`;

// Tests for the public site (written into tests/site.test.js of website projects).
export const SITE_TESTS = String.raw`// Generated by the JARVIS Digital World Engine: the public website, over HTTP against the real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, schema } from '../server.js';

const TOKEN = 'site-token-' + Math.random().toString(36).slice(2);
let base; let app; let dir;
const call = async (method, p, body, auth = false) => {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + TOKEN;
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, body: json, text, headers: r.headers };
};
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-test-'));
  app = createApp({ dataDir: dir, token: TOKEN });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(() => { app.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('home page: SEO tags, structured data, site assets; admin at /admin', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /<meta name="description" content="[^"]{20,}">/);
  assert.match(r.text, /property="og:title"/);
  const ld = JSON.parse(r.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.name, schema.site.name);
  assert.equal((await call('GET', '/site/site.js')).status, 200);
  assert.equal((await call('GET', '/site/site.css')).status, 200);
  assert.match((await call('GET', '/admin')).text, /id="nav"/);
});

test('robots.txt and sitemap.xml', async () => {
  const rb = await call('GET', '/robots.txt'); assert.match(rb.text, /Disallow: \/admin/); assert.match(rb.text, /Sitemap: http/);
  const sm = await call('GET', '/sitemap.xml'); assert.match(sm.headers.get('content-type'), /xml/); assert.match(sm.text, /<urlset/);
});

test('site settings: public read, admin-only edit', async () => {
  const s = await call('GET', '/api/site'); assert.equal(s.status, 200); assert.equal(s.body.name, schema.site.name);
  assert.equal((await call('PUT', '/api/site', { tagline: 'x' })).status, 401);
  const u = await call('PUT', '/api/site', { tagline: 'New tagline', contact: { phone: '03-1234567' } }, true);
  assert.equal(u.status, 200); assert.equal(u.body.tagline, 'New tagline'); assert.equal(u.body.contact.phone, '03-1234567');
});

test('public lists show only active / published / approved rows; starter content is there', async () => {
  for (const [name, flag] of Object.entries(schema.publicRead)) {
    const hidden = await call('POST', '/api/' + name, { ...Object.fromEntries(schema.entities.find((e) => e.name === name).fields.filter((f) => f.required).map((f) => [f.name, f.type === 'money' || f.type === 'number' ? 1 : 'hidden ' + name])), [flag]: false }, true);
    assert.equal(hidden.status, 201, JSON.stringify(hidden.body));
    const pub = await call('GET', '/api/public/' + name);
    assert.equal(pub.status, 200);
    assert.ok(!pub.body.items.some((x) => x.id === hidden.body.id), name + ': unpublished row is public');
  }
  if (schema.publicRead.testimonials) assert.equal((await call('GET', '/api/public/testimonials')).body.items.length, 0, 'no invented testimonials');
  assert.equal((await call('GET', '/api/public/leads')).status, 404, 'contact requests are never public');
});

test('contact form: saved, validated, not readable without the token', async () => {
  assert.equal((await call('POST', '/api/leads', { name: 'Dana', email: 'not-an-email', message: 'hi' })).status, 400);
  const ok = await call('POST', '/api/leads', { name: 'Dana', email: 'dana@example.com', message: 'Hello' });
  assert.equal(ok.status, 201);
  assert.equal((await call('GET', '/api/leads')).status, 401);
  assert.ok((await call('GET', '/api/leads', null, true)).body.items.some((x) => x.email === 'dana@example.com'));
});

test('store or booking flow', async () => {
  if (schema.site.commerce === 'store') {
    const p = (await call('GET', '/api/public/products')).body.items[0];
    const r = await call('POST', '/api/checkout', { customer: { name: 'Dana', email: 'dana@example.com' }, items: [{ id: p.id, qty: 2, price: 0.01 }] });
    assert.equal(r.status, 201); assert.equal(r.body.total, Math.round(p.price * 200) / 100, 'the server computes the price; the browser cannot change it');
    const after = (await call('GET', '/api/products/' + p.id, null, true)).body;
    if (typeof p.stock === 'number') assert.equal(after.stock, p.stock - 2);
    assert.equal((await call('POST', '/api/checkout', { customer: { name: 'Dana', email: 'dana@example.com' }, items: [{ id: p.id, qty: 999 }] })).status >= 400, true);
    assert.equal((await call('POST', '/api/checkout', { customer: { name: 'Dana', email: 'bad' }, items: [{ id: p.id, qty: 1 }] })).status, 400);
  } else if (schema.site.commerce === 'booking') {
    const s = (await call('GET', '/api/public/services')).body.items[0];
    const at = new Date(Date.now() + 3 * 864e5); at.setMinutes(0, 0, 0);
    const b = await call('POST', '/api/book', { serviceId: s.id, start: at.toISOString(), name: 'Dana', phone: '050-1234567' });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal((await call('POST', '/api/book', { serviceId: s.id, start: at.toISOString(), name: 'Avi', phone: '050-7654321' })).status, 409, 'double booking refused');
    assert.equal((await call('POST', '/api/book', { serviceId: s.id, start: new Date(Date.now() - 864e5).toISOString(), name: 'Avi', phone: '050-7654321' })).status, 400, 'past time refused');
    const busy = await call('GET', '/api/busy?from=' + encodeURIComponent(new Date(at - 36e5).toISOString()) + '&to=' + encodeURIComponent(new Date(+at + 36e5).toISOString()));
    assert.equal(busy.body.busy.length, 1);
  }
});
`;
