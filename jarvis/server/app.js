// Wires every service together. Used by the HTTP server and by tests.
import { Store } from './lib/store.js';
import { Audit } from './security/audit.js';
import { Policy } from './security/policy.js';
import { Memory } from './memory/memory.js';
import { WealthService } from './wealth/service.js';
import { createHomeAdapter } from './home/smarthome.js';
import { Productivity } from './productivity/productivity.js';
import { Notifications } from './notify/notifications.js';
import { BridgeBroker } from './tools/bridge.js';
import { buildTools } from './tools/index.js';
import { ModelRouter } from './core/router.js';
import { Core } from './core/orchestrator.js';
import { Automations } from './automation/engine.js';
import { seedDemo } from './lib/seed.js';
import { Documents } from './documents/documents.js';
import { Personality } from './core/personality.js';
import { Health } from './health/health.js';
import { Devices } from './devices/devices.js';
import { Metrics } from './observability/metrics.js';
import { Weather } from './context/weather.js';
import { Privacy } from './privacy/privacy.js';
import { expoPushSender } from './notify/expo-push.js';
import { AIEngines } from './ai/engines.js';
import { Learning } from './brain/learning.js';
import { Watchers } from './brain/watchers.js';
import { Missions } from './brain/missions.js';
import { Capabilities } from './brain/capabilities.js';
import { AGENTS } from './agents/registry.js';
import { LearningEngine } from './learn/engine.js';

export async function createApp(opts = {}) {
  const { file = null, router = null, home = null, seed = true } = opts;
  const store = opts.store ?? new Store(file);
  if (seed) seedDemo(store);
  const householdId = 'hh_demo';
  const audit = new Audit(store);
  const s = {
    store, audit, householdId,
    policy: new Policy(store),
    memory: new Memory(store, audit),
    wealth: new WealthService(store, audit),
    home: home ?? createHomeAdapter(),
    productivity: new Productivity(store),
    notifications: new Notifications(store, { push: expoPushSender(store, opts.fetch) }),
    bridge: new BridgeBroker(),
    router: router ?? await ModelRouter.fromEnv(),
  };
  s.documents = new Documents(store, s.memory, audit);
  s.personality = new Personality(store);
  s.health = new Health(store, audit);
  s.devices = new Devices(store, audit);
  s.metrics = new Metrics(store);
  s.weather = new Weather(store, opts.fetch);
  s.privacy = new Privacy(store, audit);
  s.router.onCall = (c) => s.metrics.modelCall(c);
  s.tools = buildTools(s);
  s.core = new Core(s);
  s.ai = new AIEngines(s);
  s.learning = new Learning(s);
  s.core.learning = s.learning; // CORE was built before these services existed
  s.missions = new Missions(s);
  s.core.onApprovalDecided = (id) => s.missions.onApprovalDecided(id);
  s.capabilities = new Capabilities(s);
  s.agentsFor = (tool) => AGENTS.filter((a) => a.tools.includes(tool)).map((a) => a.id);
  s.capabilities.restore();
  s.router.setPreferences?.(store.getMeta('modelPrefs', {}));
  s.learn = new LearningEngine(s);
  s.core.learn = s.learn;
  s.watchers = new Watchers(s);
  s.automations = new Automations({ ...s, ctx: { householdId, actor: 'automation' } });
  return s;
}

/** Background loop: reminders, deferred notifications, scheduled workflows, proactive scan. */
export function startScheduler(s, { everyMs = 30_000 } = {}) {
  let lastProactive = 0; let lastWatch = 0; let lastLearn = Date.now();
  const tick = async () => {
    try {
      for (const r of s.productivity.dueReminders()) {
        await s.notifications.send({ title: 'Reminder', body: r.text, priority: 'high', event: 'reminder' });
        s.productivity.markFired(r.id);
      }
      s.notifications.flushDeferred();
      s.core.expireApprovals();
      s.privacy.purgeVoice();
      s.memory.purgeExpired();
      await s.automations.tick();
      if (Date.now() - lastWatch > 5 * 60e3) { lastWatch = Date.now(); await s.watchers.tick(); }
      await s.missions.tick();
      if (Date.now() - lastLearn > 60 * 60e3) { lastLearn = Date.now(); await s.learn.cycle(); }
      const prefs = s.store.getMeta('proactive', {});
      if (s.privacy.get().proactiveEnabled && Date.now() - lastProactive > 60 * 60e3) {
        lastProactive = Date.now();
        const { scan } = await import('./proactive/engine.js');
        const items = await scan({ ...s, ctx: { householdId: s.householdId, actor: 'proactive' }, prefs });
        for (const it of items.slice(0, 3)) await s.notifications.send({ title: it.title, priority: it.score > 0.8 ? 'high' : 'normal', event: `proactive:${it.kind}`, group: `proactive:${it.kind}:${it.ref ?? it.title}` });
      }
    } catch (e) { console.error('[scheduler]', e.message); }
  };
  const h = setInterval(tick, everyMs);
  h.unref?.();
  return () => clearInterval(h);
}
