// Privacy Center: what is stored, for how long, and who (which agent/domain) may read it.
import { now } from '../lib/store.js';

const DEFAULTS = { memoryEnabled: true, healthEnabled: false, storeTranscripts: true, voiceRetentionDays: 30, proactiveEnabled: true, financialAlertsOnWatch: true };

export class Privacy {
  constructor(store, audit) { this.store = store; this.audit = audit; }
  get() { return { ...DEFAULTS, ...this.store.getMeta('privacy', {}) }; }
  set(patch) {
    const next = { ...this.get() };
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in patch)) continue;
      if (k === 'voiceRetentionDays') { const n = Number(patch[k]); if (!Number.isInteger(n) || n < 0 || n > 3650) throw Object.assign(new Error('voiceRetentionDays must be 0-3650'), { status: 400 }); next[k] = n; }
      else next[k] = !!patch[k];
    }
    this.store.setMeta('privacy', next);
    this.audit.log('user', 'privacy.update', { fields: Object.keys(patch) });
    return next;
  }
  purgeVoice(at = Date.now()) {
    const days = this.get().voiceRetentionDays;
    let n = 0;
    for (const col of ['voice_transcripts', 'voice_notes']) {
      for (const x of this.store.all(col, (r) => at - Date.parse(r.createdAt) > days * 864e5)) { this.store.remove(col, x.id); n++; }
    }
    return n;
  }
  deleteVoice() {
    let n = 0;
    for (const col of ['voice_transcripts', 'voice_notes']) for (const x of this.store.all(col)) { this.store.remove(col, x.id); n++; }
    this.audit.log('user', 'privacy.delete_voice', { count: n });
    return n;
  }
  inventory() {
    const c = (col) => this.store.all(col).length;
    return { memories: c('memories'), documents: c('documents'), voiceTranscripts: c('voice_transcripts'), voiceNotes: c('voice_notes'), healthDays: c('health_days'),
      tasks: c('tasks'), reminders: c('reminders'), events: c('events'), transactions: c('transactions'), auditEvents: c('audit'), devices: c('devices') };
  }
  exportAll() {
    const pick = ['memories', 'documents', 'voice_transcripts', 'voice_notes', 'health_days', 'tasks', 'reminders', 'events', 'shopping', 'workflows', 'notifications'];
    return { exportedAt: now(), data: Object.fromEntries(pick.map((c) => [c, this.store.all(c).map(({ vector, tf, ...r }) => r)])) };
  }
}
