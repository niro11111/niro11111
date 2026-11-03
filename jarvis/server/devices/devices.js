// Device registry, per-device credentials, capability registry and synchronization.
// Every device gets its own revocable token, scoped by device kind. A watch can only reach
// the endpoints it needs and only receives minimal data.
import crypto from 'node:crypto';
import { now } from '../lib/store.js';

export const KINDS = ['web', 'desktop', 'ios', 'android', 'watchos', 'wearos', 'bridge'];

// What each client actually implements today. status: built (tested here) | source (code in repo,
// not compiled/tested in this environment) | planned. JARVIS never claims more than this.
export const CAPABILITIES = {
  web: { status: 'built', caps: ['chat', 'voice_stt_browser', 'tts_browser', 'notifications_browser', 'approvals', 'command_center', 'automation_studio', 'memory', 'wealth', 'smart_home', 'documents', 'image_input'] },
  desktop: { status: 'source', caps: ['web_ui', 'tray', 'global_shortcut', 'notifications_native'], note: 'Tauri shell in apps/desktop; uses desktop/bridge.js for OS actions' },
  bridge: { status: 'built', caps: ['open_app', 'open_url', 'list_dir', 'read_file', 'screenshot'] },
  ios: { status: 'source', caps: ['chat', 'approvals', 'glance', 'push_notifications', 'quick_actions'], note: 'Expo app in apps/mobile' },
  android: { status: 'source', caps: ['chat', 'approvals', 'glance', 'push_notifications', 'quick_actions'], note: 'Expo app in apps/mobile' },
  watchos: { status: 'source', caps: ['glance', 'quick_actions', 'dictation', 'approvals', 'complication', 'healthkit_summary'], note: 'SwiftUI app in apps/watchos' },
  wearos: { status: 'source', caps: ['glance', 'quick_actions', 'voice_input', 'approvals', 'tile', 'health_services_summary'], note: 'Compose app in apps/wearos' },
};

// API scopes per device kind. '*' = full API.
const SCOPES = {
  web: ['*'], desktop: ['*'], ios: ['*'],
  android: ['*'],
  watchos: ['watch', 'command', 'approvals', 'sync', 'health'],
  wearos: ['watch', 'command', 'approvals', 'sync', 'health'],
  bridge: ['bridge'],
};

// Collections each kind receives in sync. Watches get the minimum.
const SYNC_COLS = {
  watchos: new Set(['tasks', 'reminders', 'approvals', 'notifications', 'shopping']),
  wearos: new Set(['tasks', 'reminders', 'approvals', 'notifications', 'shopping']),
};

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export class Devices {
  constructor(store, audit) { this.store = store; this.audit = audit; }

  register({ name, kind, platformVersion = null }) {
    if (!KINDS.includes(kind)) throw Object.assign(new Error(`kind must be one of ${KINDS.join(', ')}`), { status: 400 });
    if (!name) throw Object.assign(new Error('name required'), { status: 400 });
    const token = `jd_${crypto.randomBytes(24).toString('hex')}`;
    const d = this.store.insert('devices', { name: String(name).slice(0, 60), kind, platformVersion, tokenHash: hash(token), scopes: SCOPES[kind], revoked: false, lastSeenAt: null, syncSeq: 0 });
    this.audit.log('user', 'device.register', { id: d.id, kind });
    return { device: this.public(d), token }; // the token is shown once and never stored in clear
  }

  authenticate(token) {
    if (!token?.startsWith('jd_')) return null;
    const h = hash(token);
    const d = this.store.all('devices', (x) => x.tokenHash === h)[0];
    if (!d || d.revoked) return null;
    d.lastSeenAt = now(); // not persisted on every request
    return d;
  }

  allowed(device, scope) { return device.scopes.includes('*') || device.scopes.includes(scope); }

  revoke(id) {
    const d = this.store.update('devices', id, { revoked: true, revokedAt: now() });
    if (d) this.audit.log('user', 'device.revoke', { id });
    return !!d;
  }

  list() { return this.store.all('devices').map((d) => this.public(d)); }
  public({ tokenHash, ...d }) { return { ...d, capability: CAPABILITIES[d.kind] }; }

  /** Changes since `seq`, filtered to what this device kind may receive. */
  pull(device, since = 0) {
    const cols = SYNC_COLS[device?.kind];
    const changes = this.store.changesSince(Number(since) || 0)
      .filter((c) => !cols || cols.has(c.col))
      .filter((c) => !(c.col === 'memories' && ['financial', 'health'].includes(c.rec?.domain)))
      .map((c) => (cols ? minimal(c) : c));
    return { seq: this.store.seq(), changes };
  }
}

/** Watch payloads: only the fields a glance needs. */
function minimal(c) {
  if (!c.rec) return c;
  const pick = { tasks: ['id', 'title', 'done', 'due', 'priority'], reminders: ['id', 'text', 'at', 'fired'], approvals: ['id', 'summary', 'risk', 'status', 'expiresAt'],
    notifications: ['id', 'title', 'priority', 'read', 'at'], shopping: ['id', 'item', 'done'] }[c.col];
  return { ...c, rec: Object.fromEntries((pick ?? Object.keys(c.rec)).map((k) => [k, c.rec[k]])) };
}

/**
 * Applies a batch of offline operations from a device. Each op carries a client-generated
 * opId, so retries and duplicate deliveries are applied exactly once. Conflicts on updates
 * are resolved last-writer-wins by clientTime; a stale write is reported, not applied.
 */
export async function applyOps(s, device, ops = []) {
  const results = [];
  for (const op of ops.slice(0, 100)) {
    if (!op?.opId || !op.type) { results.push({ opId: op?.opId ?? null, status: 'invalid' }); continue; }
    const seen = s.store.all('sync_ops', (x) => x.opId === op.opId && x.deviceId === device.id)[0];
    if (seen) { results.push({ opId: op.opId, status: 'duplicate', result: seen.result }); continue; }
    let result;
    try {
      result = await applyOne(s, device, op);
    } catch (e) { result = { status: 'error', error: e.message }; }
    s.store.insert('sync_ops', { opId: op.opId, deviceId: device.id, type: op.type, result, at: now() });
    results.push({ opId: op.opId, ...result });
  }
  return { results, seq: s.store.seq() };
}

async function applyOne(s, device, op) {
  const p = op.payload ?? {};
  switch (op.type) {
    case 'task.create': return { status: 'applied', id: s.productivity.createTask({ title: p.title, due: p.due ?? null, priority: p.priority ?? 'normal' }).id };
    case 'task.complete': {
      const t = s.store.get('tasks', p.id);
      if (!t) return { status: 'error', error: 'task not found' };
      if (t.done) return { status: 'applied', id: t.id };
      if (t.updatedAt && op.clientTime && Date.parse(op.clientTime) < Date.parse(t.updatedAt)) return { status: 'conflict', server: { title: t.title, updatedAt: t.updatedAt } };
      s.productivity.completeTask(p.id); return { status: 'applied', id: p.id };
    }
    case 'reminder.create': return { status: 'applied', id: s.productivity.createReminder({ text: p.text, at: p.at }).id };
    case 'shopping.add': return { status: 'applied', id: s.store.insert('shopping', { item: String(p.item).slice(0, 200), done: false }).id };
    case 'shopping.toggle': { const x = s.store.get('shopping', p.id); if (!x) return { status: 'error', error: 'not found' }; s.store.update('shopping', x.id, { done: !x.done }); return { status: 'applied', id: x.id }; }
    case 'command': {
      const t = await s.core.handle(String(p.text ?? ''), { householdId: s.householdId, channel: device.kind.startsWith('wear') || device.kind === 'watchos' ? 'watch' : 'text', conversationId: `dev:${device.id}`, deviceId: device.id });
      return { status: 'applied', taskId: t.id, state: t.state, response: t.response };
    }
    default: return { status: 'invalid', error: `unknown op ${op.type}` };
  }
}
