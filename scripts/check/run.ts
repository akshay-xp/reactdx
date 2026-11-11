import path from 'node:path';
import { checkBundle } from './bundles.ts';

const output = path.resolve(import.meta.dirname, '../../apps/extension/.output');
const violations = ['chrome-mv3', 'firefox-mv3'].flatMap((target) =>
  checkBundle(path.join(output, target)).map((violation) => `${target}: ${violation}`),
);
for (const violation of violations) console.log(violation);
process.exit(violations.length ? 1 : 0);
