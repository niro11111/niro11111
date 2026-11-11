import { createApp } from '../server/app.js';
import { ModelRouter } from '../server/core/router.js';
import { DemoHomeAdapter } from '../server/home/smarthome.js';

/** Fresh in-memory app with the offline router and demo home. */
export async function app(opts = {}) {
  return createApp({ file: null, router: opts.router ?? new ModelRouter(), home: new DemoHomeAdapter(), seed: opts.seed ?? true });
}
export const ask = (s, text, o = {}) => s.core.handle(text, { householdId: s.householdId, conversationId: 't', ...o });
