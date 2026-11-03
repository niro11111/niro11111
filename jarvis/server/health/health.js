// Optional, consent-gated health & wellness data (from HealthKit / Wear OS Health Services
// via the watch or phone app). Stored separately from memory, never sent to a language model,
// and never interpreted medically: JARVIS summarises trends only.
import { now } from '../lib/store.js';

const FIELDS = ['steps', 'activeMinutes', 'restingHeartRate', 'sleepMinutes', 'exerciseSessions'];

export class Health {
  constructor(store, audit) { this.store = store; this.audit = audit; }
  enabled() { return this.store.getMeta('privacy', {}).healthEnabled === true; }
  guard() { if (!this.enabled()) throw Object.assign(new Error('health data is disabled; enable it in the Privacy Center'), { status: 403, code: 'health_off' }); }

  ingest(days, source = 'unknown') {
    this.guard();
    let n = 0;
    for (const d of days ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '')) throw Object.assign(new Error('each day needs date YYYY-MM-DD'), { status: 400 });
      const clean = { date: d.date, source };
      for (const f of FIELDS) if (Number.isFinite(d[f]) && d[f] >= 0) clean[f] = Math.round(d[f]);
      const existing = this.store.all('health_days', (x) => x.date === d.date)[0];
      if (existing) this.store.update('health_days', existing.id, clean); else this.store.insert('health_days', clean);
      n++;
    }
    this.audit.log(`device:${source}`, 'health.ingest', { days: n });
    return { ingested: n };
  }

  summary(today = new Date().toISOString().slice(0, 10)) {
    this.guard();
    const t0 = Date.parse(today);
    const inRange = (a, b) => this.store.all('health_days', (x) => { const d = (t0 - Date.parse(x.date)) / 864e5; return d >= a && d < b; });
    const last = inRange(0, 7); const prev = inRange(7, 14);
    const avg = (l, f) => { const v = l.map((x) => x[f]).filter(Number.isFinite); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const s = { days: last.length, steps: avg(last, 'steps'), prevSteps: avg(prev, 'steps'), sleepMinutes: avg(last, 'sleepMinutes'), restingHeartRate: avg(last, 'restingHeartRate'), activeMinutes: avg(last, 'activeMinutes') };
    s.stepsChangePct = s.steps != null && s.prevSteps ? Math.round(((s.steps - s.prevSteps) * 100) / s.prevSteps) : null;
    s.generatedAt = now();
    s.disclaimer = 'Trend summary only. Not medical advice or diagnosis.';
    return s;
  }

  deleteAll() { const l = this.store.all('health_days'); for (const x of l) this.store.remove('health_days', x.id); return l.length; }
}
