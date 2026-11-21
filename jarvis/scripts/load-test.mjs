// Load test: concurrent mixed requests against the real API router (in-memory store, no model).
//   node scripts/load-test.mjs [requests=600] [concurrency=20]
import { createApp } from '../server/app.js';
import { createApi } from '../server/api/routes.js';
import { ModelRouter } from '../server/core/router.js';
import { DemoHomeAdapter } from '../server/home/smarthome.js';

const N = Number(process.argv[2] ?? 600); const C = Number(process.argv[3] ?? 20);
const s = await createApp({ router: new ModelRouter(), home: new DemoHomeAdapter() });
const api = createApi(s, 'tok', { rateLimit: 1e9 });
const MIX = [
  ['POST', '/api/command', { text: 'organize my day' }], ['POST', '/api/command', { text: 'כמה הוצאנו החודש?' }], ['POST', '/api/command', { text: 'add task load test' }],
  ['POST', '/api/command', { text: '0.1+0.2' }], ['GET', '/api/tasks'], ['POST', '/api/wealth/analysis', {}], ['GET', '/api/v1/learning/performance?days=7'],
  ['GET', '/api/knowledge/graph'], ['POST', '/api/ml/predict', null], ['GET', '/api/v1/brain/capabilities?q=shopping'],
];
await s.ml.trainIntent('user');
const lat = []; let errors = 0; let i = 0;
const t0 = Date.now();
async function worker() {
  while (i < N) {
    const [method, url, body] = MIX[i++ % MIX.length];
    const b = url === '/api/ml/predict' ? { text: 'what bills are due this week' } : body;
    const t = performance.now();
    const r = await api.handle({ method, url, authorization: 'Bearer tok', body: b ? JSON.stringify(b) : '' });
    lat.push(performance.now() - t); if (r.status >= 400) errors++;
  }
}
await Promise.all(Array.from({ length: C }, worker));
const secs = (Date.now() - t0) / 1000; lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1);
const out = { requests: N, concurrency: C, seconds: +secs.toFixed(2), rps: Math.round(N / secs), p50ms: +q(0.5), p95ms: +q(0.95), p99ms: +q(0.99), errors, memoryMb: Math.round(process.memoryUsage().rss / 1048576) };
console.log(JSON.stringify(out, null, 2));
if (errors) process.exit(1);
