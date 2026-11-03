// JARVIS browser runtime: the complete JARVIS server (core, 18 agents, memory, Family Wealth OS,
// automations, scheduler...) running inside the page, with no backend.
//  - On claude.ai: data in the viewer's private database, Claude via the `sample` capability.
//  - Anywhere else (GitHub Pages, a file server): data in localStorage, Claude via the user's own
//    API key if they add one, browser microphone with the normal permission prompt.
import { Store } from '../../server/lib/store.js';
import { createApp, startScheduler } from '../../server/app.js';
import { createApi } from '../../server/api/routes.js';
import { ModelRouter } from '../../server/core/router.js';
import { DemoHomeAdapter, HomeAssistantAdapter } from '../../server/home/smarthome.js';
import { AnthropicProvider } from '../../server/providers/anthropic.js';
import { bus } from '../../server/lib/events.js';
import { SampleProvider, SAMPLE_TIERS } from './sample-provider.js';
import { LocalBackend, DbBackend, Persister } from './persist.js';

const SETTINGS_KEY = 'jarvis.local.settings';
const readSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); } catch { return {}; } };
const writeSettings = (v) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(v)); return true; } catch { return false; } };

async function use(name) {
  if (!window.claude?.use) return null;
  try { return await Promise.race([window.claude.use(name), new Promise((r) => setTimeout(() => r(null), 10000))]); } catch { return null; }
}

function setBoot(text) { const el = document.getElementById('bootMsg'); if (el) el.textContent = text; }

async function boot() {
  const inViewer = !!window.claude?.use;
  setBoot(inViewer ? 'מתחבר לאחסון ול-Claude…' : 'טוען את JARVIS…');
  const [db, user, sample, downloads, permissions] = inViewer
    ? await Promise.all([use('db'), use('user'), use('sample'), use('downloads'), use('permissions')]) : [];
  const uid = user ? await user.id().catch(() => null) : null;
  let backend = db && uid ? new DbBackend(db, uid) : new LocalBackend();
  let data = null;
  try { data = await backend.load(); } catch (e) {
    console.warn('JARVIS: could not load saved data', e);
    if (backend.kind === 'claude') { backend = new LocalBackend(); data = await backend.load().catch(() => null); }
  }

  const settings = readSettings();
  const store = new Store(null, { data: data ?? {} });

  // AI providers
  const providers = {}; let tiers;
  if (sample) {
    const limits = await sample.limits().catch(() => ({}));
    providers.claude = new SampleProvider(sample, limits);
    tiers = SAMPLE_TIERS;
  } else if (settings.anthropicKey) {
    providers.anthropic = new AnthropicProvider({ apiKey: settings.anthropicKey, browser: true });
  }
  const router = new ModelRouter({ providers, ...(tiers ? { tiers } : {}) });

  // Smart home: a Home Assistant the browser can reach (needs cors_allowed_origins in HA), else the demo home.
  let home;
  if (settings.haUrl && settings.haToken) home = new HomeAssistantAdapter(settings.haUrl, settings.haToken);
  else {
    home = new DemoHomeAdapter();
    const saved = store.getMeta('demoHome', null);
    if (saved) home.state = saved;
    const call = home.call.bind(home); const scene = home.scene.bind(home);
    home.call = async (...a) => { const r = await call(...a); store.setMeta('demoHome', home.state); return r; };
    home.scene = async (...a) => { const r = await scene(...a); store.setMeta('demoHome', home.state); return r; };
  }

  const s = await createApp({ store, router, home, seed: !data, fetch: globalThis.fetch.bind(globalThis) });
  const status = { state: 'saved', message: '' };
  const persister = new Persister(store, backend, (state, message = '') => {
    Object.assign(status, { state, message });
    dispatchEvent(new CustomEvent('jarvis:storage', { detail: { ...status, kind: backend.kind } }));
  });
  if (!data) persister.saveAll();
  const api = createApi(s, null, { trustOwner: true, rateLimit: 1e9 });
  startScheduler(s, { everyMs: 15000 });

  window.JARVIS_LOCAL = {
    mode: backend.kind, // 'claude' (claude.ai database) | 'browser' (localStorage)
    ai: sample ? 'claude' : settings.anthropicKey ? 'anthropic-key' : 'none',
    async api(path, { method = 'GET', body } = {}) {
      const r = await api.handle({ method, url: path, body });
      if (r.status >= 400) throw new Error(r.body?.error ?? `HTTP ${r.status}`);
      return r.body;
    },
    onEvent(fn) { bus.on('event', fn); return () => bus.off('event', fn); },
    storage: () => ({ ...status, kind: backend.kind }),
    flush: () => persister.flush(),
    settings: () => ({ ...readSettings(), anthropicKey: readSettings().anthropicKey ? '••••' : '' }),
    saveSettings(patch) { const next = { ...readSettings(), ...patch }; for (const k of Object.keys(next)) if (next[k] === '') delete next[k]; return writeSettings(next); },
    async exportFile(filename, text) {
      if (downloads) { try { await downloads.save({ filename, data: text }); return 'saved'; } catch (e) { return e?.code === 'declined' ? 'declined' : 'failed'; } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename; a.click(); return 'saved';
    },
    permissions,
    async wipe() { await backend.wipe(); store.data = {}; location.reload(); },
  };
  await import(new URL('./app.js', import.meta.url).href);
}

boot().catch((e) => { console.error(e); setBoot(`JARVIS could not start: ${e.message}`); });
