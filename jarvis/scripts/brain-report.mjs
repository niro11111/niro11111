// Writes docs/BRAIN_COVERAGE.md from the live coverage registry (server/brain/coverage.js).
import fs from 'node:fs';
import { coverageMarkdown } from '../server/brain/coverage.js';
fs.writeFileSync(new URL('../docs/BRAIN_COVERAGE.md', import.meta.url), coverageMarkdown());
console.log('docs/BRAIN_COVERAGE.md written');
