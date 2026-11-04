// Central notification engine: priorities, quiet hours, grouping, per-event preferences,
// delivery tracking. In-app + web/desktop (via SSE to clients) are built in; email/SMS/push
// go through pluggable channel senders that report "not_configured" until set up.
import { bus } from '../lib/events.js';
import { now } from '../lib/store.js';

const LEVEL = { low: 0, normal: 1, high: 2, critical: 3 };
const DEFAULT_PREFS = { quietHours: { start: '22:00', end: '07:00' }, minPriority: 'normal', muted: [], channels: ['in_app'] };

export class Notifications {
  constructor(store, senders = {}) { this.store = store; this.senders = senders; }
  prefs() { return { ...DEFAULT_PREFS, ...this.store.getMeta('notifyPrefs', {}) }; }
  setPrefs(p) { this.store.setMeta('notifyPrefs', { ...this.prefs(), ...p }); return this.prefs(); }

  inQuietHours(date = new Date()) {
    const { start, end } = this.prefs().quietHours ?? {};
    if (!start || !end) return false;
    const hm = date.toTimeString().slice(0, 5);
    return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
  }

  async send({ title, body = '', priority = 'normal', event = 'general', group = null, approvalId = null }, at = new Date()) {
    const p = this.prefs();
    let status = 'delivered';
    if (p.muted.includes(event)) status = 'suppressed_muted';
    else if (LEVEL[priority] < LEVEL[p.minPriority]) status = 'suppressed_priority';
    else if (this.inQuietHours(at) && LEVEL[priority] < LEVEL.critical) status = 'deferred_quiet_hours';

    // group: collapse into an existing unread notification of the same group
    if (group) {
      const g = this.store.all('notifications', (n) => n.group === group && !n.read).pop();
      if (g) return this.store.update('notifications', g.id, { count: (g.count ?? 1) + 1, body, at: now() });
    }
    const deliveries = [];
    if (status === 'delivered') {
      for (const ch of p.channels) {
        if (ch === 'in_app') { deliveries.push({ channel: ch, status: 'sent' }); continue; }
        const s = this.senders[ch];
        if (!s) { deliveries.push({ channel: ch, status: 'not_configured' }); continue; }
        try { await s({ title, body, priority }); deliveries.push({ channel: ch, status: 'sent' }); }
        catch (e) { deliveries.push({ channel: ch, status: 'failed', error: e.message }); }
      }
    }
    const rec = this.store.insert('notifications', { title, body, priority, event, group, approvalId, status, deliveries, read: false, count: 1, at: now() });
    if (status === 'delivered' && !this.store.silent) bus.emit('event', { type: 'notification', data: rec });
    return rec;
  }
  list({ unread = false } = {}) { return this.store.all('notifications', (n) => !unread || !n.read).slice(-100).reverse(); }
  markRead(id) { return this.store.update('notifications', id, { read: true }); }
  /** Deliver notifications deferred by quiet hours once they end. */
  flushDeferred(at = new Date()) {
    if (this.inQuietHours(at)) return 0;
    const d = this.store.all('notifications', (n) => n.status === 'deferred_quiet_hours');
    for (const n of d) { this.store.update('notifications', n.id, { status: 'delivered' }); if (!this.store.silent) bus.emit('event', { type: 'notification', data: n }); }
    return d.length;
  }
}
