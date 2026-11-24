const heap = () => globalThis.performance?.memory;
export const cpus = () => Array.from({ length: globalThis.navigator?.hardwareConcurrency ?? 1 });
export const loadavg = () => [0, 0, 0];
export const totalmem = () => heap()?.jsHeapSizeLimit ?? 1;
export const freemem = () => { const m = heap(); return m ? m.jsHeapSizeLimit - m.usedJSHeapSize : 1; };
export default { cpus, loadavg, totalmem, freemem };
