// The browser build runs Development Lab code in a Web Worker (server/learn/isolate.js); node:vm is never used here.
export function createContext() { throw new Error('node:vm is not available in the browser'); }
export class Script { constructor() { throw new Error('node:vm is not available in the browser'); } }
export default { createContext, Script };
