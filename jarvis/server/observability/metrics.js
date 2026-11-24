// Operational metrics for the Developer Console. Metadata only, never personal content.
import os from 'node:os';

// Approximate list prices (USD per million tokens) for cost estimates.
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], local: [0, 0] };

export class Metrics {
  constructor(store) { this.store = store; this.calls = []; this.requests = []; this.startedAt = Date.now(); }
  modelCall(c) {
    const [pi, po] = PRICES[c.model] ?? [0, 0];
    this.calls.push({ ...c, at: Date.now(), costUsd: (c.inputTokens * pi + c.outputTokens * po) / 1e6 });
    if (this.calls.length > 2000) this.calls.shift();
  }
  request(path, status, ms) { this.requests.push({ path: path.replace(/[a-z]+_[0-9a-f]{8,}/g, ':id'), status, ms, at: Date.now() }); if (this.requests.length > 5000) this.requests.shift(); }

  system() {
    const mem = process.memoryUsage();
    const cpus = os.cpus().length || 1;
    const tasks = this.store.all('tasks_exec').slice(-200);
    const finished = tasks.filter((t) => ['COMPLETED', 'FAILED'].includes(t.state));
    const recentCalls = this.calls.filter((c) => Date.now() - c.at < 3600e3);
    return {
      cpuLoadPct: Math.min(100, Math.round((os.loadavg()[0] / cpus) * 100)),
      memoryPct: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      processMemoryMb: Math.round(mem.rss / 1048576),
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      aiLatencyMs: recentCalls.length ? Math.round(recentCalls.reduce((a, c) => a + c.latencyMs, 0) / recentCalls.length) : null,
      taskSuccessPct: finished.length ? Math.round((finished.filter((t) => t.state === 'COMPLETED').length * 100) / finished.length) : null,
      avgTaskMs: finished.length ? Math.round(finished.reduce((a, t) => a + (t.durationMs ?? 0), 0) / finished.length) : null,
    };
  }

  console() {
    const byModel = {};
    for (const c of this.calls) {
      const m = (byModel[c.model] ??= { model: c.model, provider: c.provider, calls: 0, errors: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
      m.calls++; if (!c.ok) m.errors++; m.latencyMs += c.latencyMs; m.inputTokens += c.inputTokens; m.outputTokens += c.outputTokens; m.costUsd += c.costUsd;
    }
    const routes = {};
    for (const r of this.requests) { const k = r.path; const x = (routes[k] ??= { path: k, count: 0, errors: 0, ms: 0 }); x.count++; if (r.status >= 400) x.errors++; x.ms += r.ms; }
    return {
      models: Object.values(byModel).map((m) => ({ ...m, avgLatencyMs: Math.round(m.latencyMs / m.calls), costUsd: +m.costUsd.toFixed(4) })),
      api: Object.values(routes).map((r) => ({ ...r, avgMs: Math.round(r.ms / r.count) })).sort((a, b) => b.count - a.count).slice(0, 25),
      failedTasks: this.store.all('tasks_exec', (t) => t.state === 'FAILED').slice(-20).reverse().map((t) => ({ id: t.id, at: t.finishedAt ?? t.createdAt, error: t.error, tools: t.plan?.tools ?? [] })),
      system: this.system(),
    };
  }
}
