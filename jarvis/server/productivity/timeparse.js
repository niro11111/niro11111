// Small Hebrew/English natural time parser for reminders and events.
// Returns an ISO string or null. `base` is injectable for tests.
export function parseWhen(text, base = new Date()) {
  const t = text.toLowerCase();
  const d = new Date(base);
  let m;
  if ((m = t.match(/(?:in|בעוד)\s+(\d+)\s*(minutes?|mins?|דקות|דקה|hours?|שעות|שעה|days?|ימים|יום)/))) {
    const n = Number(m[1]); const u = m[2];
    const ms = /^(h|ש)/.test(u) ? 36e5 : /^(d|י)/.test(u) ? 864e5 : 6e4;
    return new Date(d.getTime() + n * ms).toISOString();
  }
  let dayShift = 0;
  if (/tomorrow|מחר/.test(t)) dayShift = 1;
  m = t.match(/(?:at|ב-?|בשעה)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m || dayShift) {
    d.setDate(d.getDate() + dayShift);
    if (m) {
      let h = Number(m[1]); const min = Number(m[2] ?? 0);
      if (m[3] === 'pm' && h < 12) h += 12;
      if (m[3] === 'am' && h === 12) h = 0;
      d.setHours(h, min, 0, 0);
      if (!dayShift && d <= base) d.setDate(d.getDate() + 1);
    } else d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  return null;
}

/** Removes the time expression so "pay electricity tomorrow at 9" -> "pay electricity". */
export function stripWhen(text) {
  return text.replace(/(?:in|בעוד)\s+\d+\s*\S+/i, '')
    .replace(/\b(tomorrow)\b|מחר/i, '')
    .replace(/(?:\bat\b|בשעה|ב-)\s*\d{1,2}(?::\d{2})?\s*(am|pm)?/i, '')
    .replace(/\s+/g, ' ').trim();
}
