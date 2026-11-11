// Desktop bridge broker. Browser code cannot touch the OS, so a separate desktop process
// (desktop/bridge.js, or the Tauri app) long-polls this broker, executes commands within
// its own local allow-list, and posts results back. JARVIS only ever sees the results.
import { newId } from '../lib/store.js';

export class BridgeBroker {
  constructor() { this.queue = []; this.waiting = new Map(); this.lastSeen = null; this.info = null; }
  connected() { return this.lastSeen && Date.now() - this.lastSeen < 30_000; }
  heartbeat(info) { this.lastSeen = Date.now(); if (info) this.info = info; }
  send(command, args, timeoutMs = 20_000) {
    if (!this.connected()) return Promise.reject(new Error('Desktop bridge is not connected. Start it with: node desktop/bridge.js'));
    const id = newId('cmd');
    this.queue.push({ id, command, args });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`desktop command ${command} timed out`)); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
    });
  }
  take() { this.heartbeat(); return this.queue.splice(0); }
  result(id, { ok, result, error }) {
    const w = this.waiting.get(id);
    if (!w) return false;
    clearTimeout(w.timer); this.waiting.delete(id);
    ok ? w.resolve(result) : w.reject(new Error(error ?? 'desktop command failed'));
    return true;
  }
}
