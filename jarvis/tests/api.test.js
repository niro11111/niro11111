import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { createServer } from '../server/index.js';

test('HTTP API: auth required, command, wealth endpoints, approvals', async () => {
  const s = await app();
  const srv = createServer(s, 'secret');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (p, o = {}) => fetch(base + p, { ...o, headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) });
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    for (const p of ['overview', 'accounts', 'transactions', 'budgets', 'goals', 'assets', 'liabilities', 'insights', 'reports']) {
      assert.equal((await call(`/api/wealth/${p}`)).status, 200, p);
    }
    assert.equal((await call('/api/wealth/analysis', { method: 'POST', body: {} })).status, 200);
    const d = new Date(); const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1); const pm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const rec = await (await call(`/api/wealth/recommendations?month=${pm}`, { method: 'POST', body: { cuts: { dining: 50 } } })).json();
    assert.ok(rec.simulation.monthlySaving > 0);
    const t = await (await call('/api/command', { method: 'POST', body: { text: 'unlock the front door' } })).json();
    assert.equal(t.state, 'AWAITING_APPROVAL');
    const ap = await (await call('/api/approvals')).json();
    assert.equal(ap.length, 1);
    const done = await (await call(`/api/approvals/${ap[0].id}`, { method: 'POST', body: { decision: 'reject' } })).json();
    assert.equal(done.state, 'CANCELLED');
    assert.equal((await call('/api/nope')).status, 404);
    const imp = await call('/api/wealth/import', { method: 'POST', body: { transactions: [{ date: '2026-11-02', description: 'x', amount: 12.5 }] } });
    assert.equal(imp.status, 400, 'non-integer money rejected');
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/../server/index.js`)).status, 404);
  } finally { srv.close(); }
});
