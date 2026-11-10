import { chromium, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTimingHook } from '../global-setup.ts';

const RUNS = 20;
const URL = 'http://localhost:5118';

const launch = (variant: string, userDataDir: string) => {
  const extension = path.resolve(import.meta.dirname, variant);
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
};

const classify = async (page: Page) => {
  await page.goto(URL);
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => (window as any).__reactdxTiming);
  if (!state) return 'missed';
  return state.injected === 1 ? 'before' : 'after';
};

// Lets the extension finish installing (and registering) before the restart.
const settle = async (variant: string, userDataDir: string) => {
  const context = await launch(variant, userDataDir);
  const page = context.pages()[0] ?? (await context.newPage());
  for (let i = 0; i < 20 && (await classify(page)) !== 'before'; i++);
  await context.close();
};

async function firstLoad(variant: string, afterRestart: boolean) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'reactdx-race-'));
  try {
    if (afterRestart) await settle(variant, userDataDir);
    const context = await launch(variant, userDataDir);
    const page = context.pages()[0] ?? (await context.newPage());
    const result = await classify(page);
    await context.close();
    return result;
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

try {
  await fetch(URL);
} catch {
  console.error('No dev server on port 5118. Start `pnpm dev:18` first.');
  process.exit(1);
}
copyTimingHook();

for (const variant of ['static', 'registered']) {
  for (const afterRestart of [false, true]) {
    const counts = { before: 0, after: 0, missed: 0 };
    for (let i = 0; i < RUNS; i++) counts[await firstLoad(variant, afterRestart)]++;
    const scenario = afterRestart ? 'first load after restart' : 'first load after install';
    console.log(
      `${variant.padEnd(10)} ${scenario.padEnd(25)} before React ${counts.before}/${RUNS}, after React ${counts.after}/${RUNS}, missed ${counts.missed}/${RUNS}`,
    );
  }
}
