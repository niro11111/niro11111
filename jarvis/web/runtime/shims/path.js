export const dirname = (p) => String(p).replace(/\/[^/]*$/, '');
export const resolve = (...p) => p.join('/');
export const join = (...p) => p.join('/');
export const extname = (p) => (String(p).match(/\.[^./]+$/) ?? [''])[0];
export default { dirname, resolve, join, extname };
