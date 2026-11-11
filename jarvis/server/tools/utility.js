// Deterministic utilities: a safe arithmetic evaluator (no eval), date math and unit conversion.
// The language model never does arithmetic; these do.

/** Evaluates + - * / ^ % and parentheses. "15% of 340" / "15% מ-340" become 0.15*340. */
export function evaluate(expression) {
  let src = String(expression).toLowerCase()
    .replace(/[,]/g, '')
    .replace(/×|x(?=\s*\d)/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*(?:of|מ-?|מתוך)\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
  if (/[a-z\u0590-\u05FF]/i.test(src)) throw new Error('not a pure arithmetic expression');
  src = src.replace(/[^\d.+\-*/^()\s]/g, ' ');
  const tokens = src.match(/\d+(?:\.\d+)?|[+\-*/^()]/g);
  if (!tokens?.length) throw new Error('no arithmetic expression found');
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = () => {
    const t = next();
    if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('missing )'); return v; }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`unexpected "${t ?? 'end'}"`);
    return n;
  };
  const power = () => { const b = primary(); if (peek() === '^') { next(); return b ** power(); } return b; };
  const term = () => {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = next(); const r = power();
      if (op === '/' && r === 0) throw new Error('division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const value = expr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}"`);
  return Math.round(value * 1e10) / 1e10;
}

/** Parses 2027-01-01, 1.1.2027, 1/1, 1.1 (next occurrence). */
export function parseDate(text, base = new Date()) {
  const s = String(text).trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (m) {
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();
    let d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && d < new Date(base.getFullYear(), base.getMonth(), base.getDate())) { y++; d = new Date(y, Number(m[2]) - 1, Number(m[1])); }
    return d;
  }
  return null;
}

export function daysUntil(target, base = new Date()) {
  const a = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 864e5);
}

const UNITS = {
  km: ['length', 1000], m: ['length', 1], cm: ['length', 0.01], mi: ['length', 1609.344], ft: ['length', 0.3048], in: ['length', 0.0254],
  kg: ['mass', 1], g: ['mass', 0.001], lb: ['mass', 0.45359237], oz: ['mass', 0.028349523125],
  l: ['volume', 1], ml: ['volume', 0.001], gal: ['volume', 3.785411784],
  c: ['temp'], f: ['temp'],
};
const ALIASES = { 'ק"מ': 'km', קמ: 'km', קילומטר: 'km', kilometers: 'km', kilometer: 'km', מטר: 'm', meters: 'm', meter: 'm', 'ס"מ': 'cm', מייל: 'mi', miles: 'mi', mile: 'mi', feet: 'ft', foot: 'ft', רגל: 'ft', inch: 'in', inches: 'in', אינץ: 'in',
  'ק"ג': 'kg', קג: 'kg', קילו: 'kg', kilograms: 'kg', kilo: 'kg', גרם: 'g', grams: 'g', pounds: 'lb', pound: 'lb', lbs: 'lb', פאונד: 'lb', ounces: 'oz', ליטר: 'l', liters: 'l', liter: 'l', gallons: 'gal', gallon: 'gal', גלון: 'gal',
  celsius: 'c', צלזיוס: 'c', fahrenheit: 'f', פרנהייט: 'f', '°c': 'c', '°f': 'f' };
export const unitOf = (u) => { const k = String(u).toLowerCase().replace(/[.]/g, ''); return UNITS[k] ? k : ALIASES[k] ?? null; };

export function convert(value, from, to) {
  const a = unitOf(from); const b = unitOf(to);
  if (!a || !b) throw new Error(`unknown unit ${!a ? from : to}`);
  if (UNITS[a][0] !== UNITS[b][0]) throw new Error(`cannot convert ${UNITS[a][0]} to ${UNITS[b][0]}`);
  const v = Number(value);
  if (UNITS[a][0] === 'temp') return Math.round((a === b ? v : a === 'c' ? v * 9 / 5 + 32 : (v - 32) * 5 / 9) * 100) / 100;
  return Math.round(((v * UNITS[a][1]) / UNITS[b][1]) * 10000) / 10000;
}
