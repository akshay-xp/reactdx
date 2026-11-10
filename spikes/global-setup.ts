import { build } from 'esbuild';

export default async function globalSetup() {
  await build({
    entryPoints: ['bippy/src/hook.js'],
    bundle: true,
    format: 'iife',
    outfile: 'bippy/extension/hook.js',
    logLevel: 'warning',
  });
}
