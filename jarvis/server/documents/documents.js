// Document & knowledge intelligence: chunk, index (semantic), search, delete.
// Text formats are parsed here; binary formats (PDF/DOCX/XLSX/images+OCR) are converted to
// text by an extraction service before reaching this module (see docs/ARCHITECTURE.md).
import { scanUntrusted } from '../security/untrusted.js';
import { htmlToText } from '../tools/research.js';

export function chunk(text, size = 900, overlap = 120) {
  const out = []; const clean = text.replace(/\r/g, '').trim();
  for (let i = 0; i < clean.length; i += size - overlap) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return out;
}

export function toText(name, raw) {
  if (/\.html?$/i.test(name)) return htmlToText(raw);
  if (/\.json$/i.test(name)) { try { return JSON.stringify(JSON.parse(raw), null, 1); } catch { return raw; } }
  if (/\.csv$/i.test(name)) {
    const [head, ...rows] = raw.trim().split(/\r?\n/);
    const cols = head.split(',');
    return rows.map((r) => r.split(',').map((v, i) => `${cols[i] ?? `col${i}`}: ${v}`).join('; ')).join('\n');
  }
  return raw;
}

export class Documents {
  constructor(store, memory, audit) { Object.assign(this, { store, memory, audit }); }
  add({ name, text, workspace = 'documents' }) {
    if (!name || !text) throw Object.assign(new Error('name and text required'), { status: 400 });
    if (!/\.(txt|md|csv|json|html?)$/i.test(name)) throw Object.assign(new Error('unsupported type here: convert PDF/DOCX/XLSX with the extraction service first'), { status: 415 });
    const body = toText(name, String(text));
    const parts = chunk(body);
    const doc = this.store.insert('documents', { name, workspace, chunks: parts.length, chars: body.length, flagged: scanUntrusted(body).suspicious, memoryIds: [] });
    doc.memoryIds = parts.map((p, i) => this.memory.add({ content: p, type: 'knowledge', provenance: 'user_statement', workspace, tags: [`doc:${doc.id}`, name, `part ${i + 1}`], source: 'user' }).id);
    this.store.update('documents', doc.id, { memoryIds: doc.memoryIds });
    this.audit.log('user', 'document.add', { id: doc.id, name, chunks: parts.length });
    return doc;
  }
  list() { return this.store.all('documents'); }
  search(q, k = 8) {
    return this.memory.search(q, { k: 50, minScore: 0.08 }).filter((m) => m.tags?.some((t) => t.startsWith('doc:'))).slice(0, k);
  }
  delete(id) {
    const d = this.store.get('documents', id);
    if (!d) return false;
    for (const m of d.memoryIds) this.memory.delete(m);
    this.store.remove('documents', id);
    return true;
  }
}
