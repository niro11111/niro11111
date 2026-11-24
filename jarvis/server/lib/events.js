// In-process event bus. The HTTP layer forwards events to clients over SSE.
import { EventEmitter } from 'node:events';
export const bus = new EventEmitter();
bus.setMaxListeners(100);
