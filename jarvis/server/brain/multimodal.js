// Multimodal processing pipeline. Each adapter: validate -> permission check -> extract ->
// structured output with a source reference. Unsupported formats say so explicitly.
import { detectLanguage } from './analyze.js';

function csvRows(text) {
  return String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).filter((c) => c !== '').map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()));
}

/** Deterministic statistics for tabular data (no model): types, numeric summaries, top values. */
export function analyzeTable(text, maxRows = 50000) {
  const rows = csvRows(text);
  if (rows.length < 2) throw Object.assign(new Error('a table needs a header row and at least one data row'), { status: 400 });
  const [header, ...data] = rows; const body = data.slice(0, maxRows);
  const columns = header.map((name, i) => {
    const vals = body.map((r) => r[i] ?? '').filter((v) => v !== '');
    const nums = vals.map((v) => Number(v.replace(/[₪$,%\s]/g, ''))).filter(Number.isFinite);
    if (vals.length && nums.length / vals.length >= 0.9) {
      const sorted = [...nums].sort((a, b) => a - b); const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length; const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
      const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
      const r = (x) => Math.round(x * 100) / 100;
      return { name, type: 'number', count: nums.length, sum: r(sum), mean: r(mean), sd: r(sd), min: sorted[0], median: q(0.5), max: sorted.at(-1) };
    }
    const freq = {}; for (const v of vals) freq[v] = (freq[v] ?? 0) + 1;
    return { name, type: 'text', count: vals.length, distinct: Object.keys(freq).length, top: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, n]) => ({ value, n })) };
  });
  return { rows: body.length, truncated: data.length > maxRows, columns };
}

export const ADAPTERS = {
  text: { validate: (b) => typeof b.text === 'string' && b.text.trim(), describe: 'natural language' },
  image: { validate: (b) => /^image\/(png|jpeg|webp|gif)$/.test(b.mediaType ?? '') && (b.data ?? '').length <= 7e6, describe: 'PNG, JPEG, WebP or GIF up to 5 MB' },
  document: { validate: (b) => b.name && b.text && /\.(txt|md|csv|json|html?)$/i.test(b.name), describe: 'text, Markdown, CSV, JSON or HTML' },
  data: { validate: (b) => typeof b.text === 'string' && b.text.includes(','), describe: 'CSV text' },
  audio: { validate: () => false, describe: 'not supported yet: needs a speech-to-text provider' },
  video: { validate: () => false, describe: 'not supported yet' },
};

export async function processInput(s, body, ctx) {
  const kind = body.kind;
  const adapter = ADAPTERS[kind];
  if (!adapter) throw Object.assign(new Error(`kind must be one of ${Object.keys(ADAPTERS).join(', ')}`), { status: 400 });
  const source = { kind, name: body.name ?? null, receivedAt: new Date().toISOString(), device: ctx.device ?? null };
  if (!adapter.validate(body)) return { kind, state: 'FAILED', supported: kind !== 'audio' && kind !== 'video', response: `Unsupported or invalid ${kind} input. Accepted: ${adapter.describe}.`, source };
  switch (kind) {
    case 'text': return { kind, source, lang: detectLanguage(body.text), ...(await s.core.handle(String(body.text), { householdId: ctx.householdId, conversationId: body.conversationId, deviceId: ctx.device })) };
    case 'image': {
      const lang = detectLanguage(body.prompt ?? '') === 'he' || s.personality.get().language === 'he' ? 'he' : 'en';
      try {
        const out = await s.tools['vision.describe'].run({ image: body.data, mediaType: body.mediaType, prompt: body.prompt }, { actor: ctx.actor, lang, channel: 'text' });
        s.audit.log(ctx.actor, 'tool.vision.describe', { bytes: body.data.length });
        return { kind, source, state: 'COMPLETED', response: out.summary };
      } catch (e) { return { kind, source, state: 'FAILED', response: e.message }; }
    }
    case 'document': { const { memoryIds, ...d } = s.documents.add({ name: body.name, text: body.text, workspace: body.workspace }); return { kind, source: { ...source, ref: d.id }, state: 'COMPLETED', document: d }; }
    case 'data': {
      const stats = analyzeTable(body.text);
      const rec = s.store.insert('datasets', { name: body.name ?? 'table.csv', rows: stats.rows, columns: stats.columns.map((c) => c.name), stats });
      return { kind, source: { ...source, ref: rec.id }, state: 'COMPLETED', stats, response: `${stats.rows} rows · ${stats.columns.map((c) => (c.type === 'number' ? `${c.name}: sum ${c.sum}, mean ${c.mean}` : `${c.name}: ${c.distinct} values`)).join(' · ')}` };
    }
    default: return { kind, state: 'FAILED', response: adapter.describe, source };
  }
}
