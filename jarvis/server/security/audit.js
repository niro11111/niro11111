// Append-only audit log. Every tool execution, approval, denial and data access lands here.
import { now } from '../lib/store.js';
import { bus } from '../lib/events.js';

export class Audit {
  constructor(store) { this.store = store; }
  log(actor, action, detail = {}, outcome = 'ok') {
    const rec = this.store.insert('audit', { at: now(), actor, action, detail, outcome });
    if (!this.store.silent) bus.emit('event', { type: 'audit', data: rec });
    return rec;
  }
  list(limit = 200) { return this.store.all('audit').slice(-limit).reverse(); }
}
