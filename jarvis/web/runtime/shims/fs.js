// The browser runtime keeps data through web/runtime/persist.js, never the file system.
const no = () => { throw new Error('no file system in the browser'); };
export const existsSync = () => false;
export const readFileSync = no, writeFileSync = no, mkdirSync = no, renameSync = no;
export default { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync };
