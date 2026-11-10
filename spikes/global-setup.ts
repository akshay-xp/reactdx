import { build } from 'esbuild';
import { copyFileSync, existsSync } from 'node:fs';
import { ensureRdt } from './hook-cost/rdt.ts';

export const bundle = (entry: string, outfile: string) =>
  build({ entryPoints: [entry], bundle: true, format: 'iife', outfile, logLevel: 'warning' });

const hooks = {
  'bippy/src/hook.js': 'bippy/extension/hook.js',
  'hook-cost/src/hook.js': 'hook-cost/extension/hook.js',
  'coexist/src/first.js': 'coexist/extension/hook.js',
  'coexist/src/late.js': 'coexist/extension-late/hook.js',
};

// Extensions can't load files from outside their own folder, so each variant gets a copy.
export const copyTimingHook = () => {
  for (const variant of ['static', 'registered']) {
    if (existsSync(`injection-timing/${variant}`)) {
      copyFileSync('injection-timing/hook.js', `injection-timing/${variant}/hook.js`);
    }
  }
};

export default async function globalSetup() {
  copyTimingHook();
  await Promise.all([
    ensureRdt(),
    ...Object.entries(hooks)
      .filter(([entry]) => existsSync(entry))
      .map(([entry, outfile]) => bundle(entry, outfile)),
  ]);
}
