import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Property keys React's own builds read; minifiers can't rename them.
const REACT_MARKERS = [
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  '__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
];
const SCANNED = new Set(['.js', '.html', '.json', '.css']);

// Returns one `<file>: <rule>` line per invariant the built extension in `dir` breaks.
export function checkBundle(dir: string): string[] {
  const violations: string[] = [];
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!SCANNED.has(path.extname(file))) continue;
    const text = readFileSync(path.join(dir, file), 'utf8');
    const marker = REACT_MARKERS.find((name) => text.includes(name));
    if (marker) violations.push(`${file}: React (${marker})`);
  }
  return violations;
}
