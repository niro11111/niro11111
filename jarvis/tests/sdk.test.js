import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { createServer } from '../server/index.js';
import { JarvisClient } from '../sdk/jarvis-client.js';

async function boot() {
  const s = await app();
  const srv = createServer(s, 'owner');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const { token } = s.devices.register({ name: 'Phone', kind: 'ios' });
  return { s, srv, base, token };
}

test('SDK: offline queue survives outages, retries with backoff, applies exactly once', async () => {
  const { s, srv, base, token } = await boot();
  try {
    let failures = 2;
    const flaky = async (...a) => { if (failures-- > 0) throw new TypeError('network down'); return fetch(...a); };
    const c = new JarvisClient({ baseUrl: base, token, fetch: flaky, maxRetries: 4 });
    await c.enqueue('task.create', { title: 'Buy bread' });
    await c.enqueue('shopping.add', { item: 'milk' });
    const r = await c.flush();
    assert.equal(r.sent, 2);
    assert.equal((await c.queue()).length, 0);
    // replaying the same ops (e.g. app killed before it saved the empty queue) changes nothing
    await c.saveQueue([{ opId: r.results[0].opId, type: 'task.create', payload: { title: 'Buy bread' } }]);
    const again = await c.flush();
    assert.equal(again.results[0].status, 'duplicate');
    assert.equal(s.productivity.listTasks().filter((x) => x.title === 'Buy bread').length, 1);
  } finally { srv.close(); }
});

test('SDK: pull builds a local replica from the change feed', async () => {
  const { s, srv, base, token } = await boot();
  try {
    const c = new JarvisClient({ baseUrl: base, token });
    await c.pull();
    s.productivity.createTask({ title: 'From desktop' });
    const p = await c.pull();
    assert.ok(p.applied >= 1);
    assert.ok((await c.local('tasks')).some((x) => x.title === 'From desktop'), 'task created on desktop appears on phone');
    const t = await c.command('מה המשימות שלי');
    assert.equal(t.state, 'COMPLETED');
  } finally { srv.close(); }
});
