import { chromium, type Page } from '@playwright/test';
import path from 'node:path';
import { bundle } from '../global-setup.ts';
import { ensureRdt, rdtDir } from './rdt.ts';
import { median, p95 } from './stats.ts';

const spikesRoot = path.resolve(import.meta.dirname, '..');
const WARMUP = 10;
const ITERATIONS = 50;
const ports = { '18.3.1': 5118, '19.3.1': 5119 };

type Case = { name: string; extension?: string; args?: string[]; ready: (page: Page) => Promise<unknown> };

// Vite's React Refresh runtime creates a hook without checkDCE when no devtools hook exists.
const hookKind = (page: Page) =>
  page.evaluate(() => {
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return 'none';
    if (hook._isBippyHook) return 'bippy';
    if ('getFiberRoots' in hook) return 'rdt';
    return 'checkDCE' in hook ? 'bare' : 'react-refresh';
  });

const expectHook = async (page: Page, expected: string) => {
  const kind = await hookKind(page);
  if (kind !== expected) throw new Error(`expected ${expected} hook, found ${kind}`);
};

const cases: Case[] = [
  { name: 'no hook', ready: (page) => expectHook(page, 'react-refresh') },
  { name: 'bare hook', extension: 'hook-cost/bare', ready: (page) => expectHook(page, 'bare') },
  {
    name: 'bippy + traversal',
    extension: 'hook-cost/extension',
    ready: async (page) => {
      await expectHook(page, 'bippy');
      await page.evaluate(() => (window as any).__bench('one', 1));
      if (!(await page.evaluate(() => (window as any).__reactdxRendered))) throw new Error('bippy hook not counting');
    },
  },
  { name: 'RDT, DevTools closed', extension: rdtDir, ready: (page) => expectHook(page, 'rdt') },
  {
    name: 'RDT, DevTools open',
    extension: rdtDir,
    args: ['--auto-open-devtools-for-tabs'],
    ready: (page) =>
      page.waitForFunction(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__?.rendererInterfaces?.size > 0, null, {
        timeout: 20000,
      }),
  },
];

async function ensureServers() {
  for (const port of Object.values(ports)) {
    try {
      await fetch(`http://localhost:${port}/bench.html`);
    } catch {
      console.error(`No dev server on port ${port}. Start \`pnpm dev:18\` and \`pnpm dev:19\` first.`);
      process.exit(1);
    }
  }
}

async function measure(benchCase: Case, port: number) {
  const extension = benchCase.extension && path.resolve(spikesRoot, benchCase.extension);
  const extensionArgs = extension ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : [];
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [
      ...extensionArgs,
      ...(benchCase.args ?? []),
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    // RDT registers its hook script from its service worker, so the first load can beat it.
    for (let attempt = 1; ; attempt++) {
      await page.goto(`http://localhost:${port}/bench.html`);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="cell"]').length === 10000);
      try {
        await benchCase.ready(page);
        break;
      } catch (error) {
        if (attempt === 5) throw error;
        await page.waitForTimeout(1000);
      }
    }
    const results: Record<string, number[]> = {};
    for (const mode of ['all', 'one']) {
      await page.evaluate(([m, n]) => (window as any).__bench(m, n), [mode, WARMUP] as const);
      results[mode] = await page.evaluate(([m, n]) => (window as any).__bench(m, n), [mode, ITERATIONS] as const);
    }
    return results;
  } finally {
    await context.close();
  }
}

await ensureServers();
await ensureRdt();
await bundle('hook-cost/src/hook.js', 'hook-cost/extension/hook.js');

const row = (cells: string[]) => cells.map((cell, i) => (i < 3 ? cell.padEnd([7, 22, 5][i]) : cell.padStart(10))).join(' ');
console.log(row(['React', 'Case', 'Mode', 'median ms', 'p95 ms']));
for (const [version, port] of Object.entries(ports)) {
  for (const benchCase of cases) {
    const results = await measure(benchCase, port);
    for (const [mode, durations] of Object.entries(results)) {
      console.log(row([version, benchCase.name, mode, median(durations).toFixed(3), p95(durations).toFixed(3)]));
    }
  }
}
