// The JARVIS system map: CORE -> engines -> clients, each with live health.
import { CAPABILITIES } from '../devices/devices.js';

export async function systemMap(s) {
  const providers = s.router.status();
  const ai = providers.find((p) => !p.capabilities.local);
  const engines = [
    { id: 'memory', name: 'Memory Engine', nameHe: 'מנוע זיכרון', status: s.memory.enabled() ? 'online' : 'disabled', detail: `${s.store.all('memories').length} memories · hybrid search` },
    { id: 'voice', name: 'Voice Engine', nameHe: 'מנוע קול', status: 'online', detail: 'browser STT/TTS he-IL/en-US · server STT/TTS adapters pluggable' },
    { id: 'computer', name: 'Computer Engine', nameHe: 'מנוע מחשב', status: s.bridge.connected() ? 'online' : 'offline', detail: s.bridge.connected() ? `bridge on ${s.bridge.info?.platform}` : 'desktop bridge not running' },
    { id: 'agents', name: 'Agent Engine', nameHe: 'מנוע סוכנים', status: 'online', detail: `18 agents · autonomy level ${s.policy.autonomy()} · AI ${ai ? ai.provider : 'local only'}` },
    { id: 'security', name: 'Security Engine', nameHe: 'מנוע אבטחה', status: 'online', detail: `${s.store.all('approvals', (a) => a.status === 'pending').length} pending approvals · ${s.store.all('devices', (d) => !d.revoked).length} devices` },
    { id: 'ai', name: 'AI Engines', nameHe: 'מנועי AI', status: s.ai.available().ai ? 'online' : 'limited', detail: `${s.ai.list().filter((e) => e.status === 'online').length}/${s.ai.list().length} engines · generator, apps, council, planner, custom agents` },
    { id: 'automation', name: 'Automation Engine', nameHe: 'מנוע אוטומציה', status: 'online', detail: `${s.store.all('workflows', (w) => w.enabled).length} active workflows` },
  ];
  const clients = Object.entries(CAPABILITIES).map(([kind, c]) => ({ kind, status: c.status, caps: c.caps, note: c.note ?? null,
    connected: s.store.all('devices', (d) => d.kind === kind && !d.revoked).length }));
  return { core: { name: 'JARVIS CORE', role: 'reasoning, planning, memory and agent orchestration', ai: ai ? ai.provider : 'local' }, engines, clients };
}
