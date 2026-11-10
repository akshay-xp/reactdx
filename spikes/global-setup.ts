import { build } from 'esbuild';

export const bundleHook = (spike: string) =>
  build({
    entryPoints: [`${spike}/src/hook.js`],
    bundle: true,
    format: 'iife',
    outfile: `${spike}/extension/hook.js`,
    logLevel: 'warning',
  });

export default async function globalSetup() {
  await Promise.all(['bippy', 'hook-cost'].map(bundleHook));
}
