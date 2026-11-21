// Typed brain events (contract v1). Every event has {type, v, at, ...payload}. They go out on the
// live bus (SSE / in-page) and into a capped log the Brain Center and evaluations can inspect.
import { bus } from '../lib/events.js';

export const EVENT_TYPES = {
  'request.received': ['taskId', 'kind', 'lang'],
  'mission.created': ['missionId', 'tasks'],
  'task.assigned': ['missionId', 'taskId', 'agent'],
  'agent.started': ['missionId', 'taskId', 'agent'],
  'tool.invoked': ['tool', 'risk', 'decision'],
  'approval.required': ['approvalId', 'tool'],
  'tool.completed': ['tool', 'ok'],
  'verification.completed': ['tool', 'verified'],
  'mission.completed': ['missionId', 'status'],
  'mission.failed': ['missionId', 'reason'],
};
const MAX = 300;

export function emitBrain(store, type, payload = {}) {
  if (!EVENT_TYPES[type]) throw new Error(`unknown brain event ${type}`);
  for (const k of EVENT_TYPES[type]) if (!(k in payload)) throw new Error(`event ${type} missing ${k}`);
  const ev = { type, v: 1, at: new Date().toISOString(), ...payload };
  const log = (store.data._brainEvents ??= []);
  log.push(ev); if (log.length > MAX) log.splice(0, log.length - MAX);
  if (!store.silent) bus.emit('event', { type: 'brain', data: ev });
  return ev;
}
export const brainEvents = (store, n = 100) => (store.data._brainEvents ?? []).slice(-n).reverse();
