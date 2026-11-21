// Smart Home Control Center. Adapters: Home Assistant (real, REST API) and a clearly
// labelled demo home used when no hub is configured. Matter/MQTT reach JARVIS through
// Home Assistant's integrations rather than raw device access.
export const SENSITIVE_DOMAINS = new Set(['lock', 'alarm_control_panel', 'cover.garage', 'camera']);

export function isSensitive(entityId, action) {
  const domain = entityId.split('.')[0];
  if (domain === 'lock' && action !== 'lock') return true;               // unlocking
  if (domain === 'alarm_control_panel' && /disarm/.test(action)) return true; // disarming
  if (domain === 'camera') return true;
  if (domain === 'cover' && /garage|gate/.test(entityId) && action === 'open') return true;
  return false;
}

export class HomeAssistantAdapter {
  constructor(url, token) { this.kind = 'home_assistant'; this.url = url.replace(/\/$/, ''); this.token = token; }
  async req(path, opts = {}) {
    const r = await fetch(`${this.url}${path}`, { ...opts, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`Home Assistant ${r.status}`);
    return r.json();
  }
  async devices() {
    const states = await this.req('/api/states');
    return states.filter((s) => /^(light|switch|climate|lock|sensor|binary_sensor|alarm_control_panel|cover|fan|media_player)\./.test(s.entity_id))
      .map((s) => ({ id: s.entity_id, name: s.attributes.friendly_name ?? s.entity_id, domain: s.entity_id.split('.')[0],
        state: s.state, area: s.attributes.area ?? null, online: s.state !== 'unavailable', attributes: s.attributes }));
  }
  async call(entityId, action, data = {}) {
    const domain = entityId.split('.')[0];
    await this.req(`/api/services/${domain}/${action}`, { method: 'POST', body: JSON.stringify({ entity_id: entityId, ...data }) });
    const s = await this.req(`/api/states/${entityId}`);
    return { id: entityId, state: s.state, attributes: s.attributes };
  }
  async scene(sceneId) { await this.req('/api/services/scene/turn_on', { method: 'POST', body: JSON.stringify({ entity_id: sceneId }) }); return { scene: sceneId }; }
}

export class DemoHomeAdapter {
  constructor() {
    this.kind = 'demo';
    this.state = [
      { id: 'light.living_room', name: 'Living room lights', domain: 'light', state: 'on', area: 'living room', floor: 'downstairs', online: true },
      { id: 'light.kitchen', name: 'Kitchen lights', domain: 'light', state: 'on', area: 'kitchen', floor: 'downstairs', online: true },
      { id: 'light.bedroom', name: 'Bedroom lights', domain: 'light', state: 'off', area: 'bedroom', floor: 'upstairs', online: true },
      { id: 'climate.living_room', name: 'Living room AC', domain: 'climate', state: 'cool', area: 'living room', floor: 'downstairs', online: true, attributes: { temperature: 24 } },
      { id: 'sensor.boiler', name: 'Water heater (dud shemesh)', domain: 'switch', state: 'off', area: 'roof', floor: 'upstairs', online: false },
      { id: 'lock.front_door', name: 'Front door', domain: 'lock', state: 'locked', area: 'entrance', floor: 'downstairs', online: true },
    ];
    this.scenes = { 'scene.evening': { 'light.living_room': 'on', 'light.kitchen': 'off', 'light.bedroom': 'on' },
      'scene.night': { 'light.living_room': 'off', 'light.kitchen': 'off', 'light.bedroom': 'off' } };
  }
  async devices() { return structuredClone(this.state); }
  async call(entityId, action, data = {}) {
    const d = this.state.find((x) => x.id === entityId);
    if (!d) throw new Error(`unknown device ${entityId}`);
    if (!d.online) throw new Error(`${d.name} is offline`);
    const map = { turn_on: 'on', turn_off: 'off', lock: 'locked', unlock: 'unlocked' };
    if (action === 'set_temperature') d.attributes = { ...d.attributes, temperature: data.temperature };
    else if (map[action]) d.state = map[action];
    else throw new Error(`unsupported action ${action}`);
    return structuredClone(d);
  }
  async scene(sceneId) {
    const sc = this.scenes[sceneId];
    if (!sc) throw new Error(`unknown scene ${sceneId}`);
    for (const [id, st] of Object.entries(sc)) await this.call(id, st === 'on' ? 'turn_on' : 'turn_off');
    return { scene: sceneId };
  }
}

export function createHomeAdapter() {
  if (process.env.HA_URL && process.env.HA_TOKEN) return new HomeAssistantAdapter(process.env.HA_URL, process.env.HA_TOKEN);
  return new DemoHomeAdapter();
}
