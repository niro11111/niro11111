export class EventEmitter {
  constructor() { this.l = new Map(); }
  setMaxListeners() { return this; }
  on(e, f) { (this.l.get(e) ?? this.l.set(e, new Set()).get(e)).add(f); return this; }
  off(e, f) { this.l.get(e)?.delete(f); return this; }
  emit(e, ...a) { for (const f of this.l.get(e) ?? []) { try { f(...a); } catch (err) { console.error(err); } } return true; }
}
export default { EventEmitter };
