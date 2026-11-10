import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test as extensionTest } from '../harness/e2e/fixtures';
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const [port, version] of [
  [5128, '18.3.1'],
  [5129, '19.3.1'],
] as const) {
  test(`preview on port ${port} serves dev React ${version} without HMR`, async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    await page.goto(`http://localhost:${port}`);
    await expect(page.getByTestId('react-version')).toHaveText(version);
    await expect.poll(() => messages.join('\n')).toContain('Download the React DevTools');
    expect(messages.join('\n')).not.toContain('[vite] connecting');
  });
}

const timing = (page: Page) => page.evaluate(() => (window as any).__reactdxTiming);

const expectBeforeReact = async (page: Page) => {
  await expect.poll(async () => (await timing(page))?.commits ?? 0).toBeGreaterThan(0);
  const state = await timing(page);
  expect(state.injected).toBe(1);
  expect(typeof state.loadId).toBe('string');
  return state;
};

extensionTest.describe('static content script', () => {
  extensionTest.use({ extensionPath: 'injection-timing/static' });

  for (const port of [5118, 5119, 5128, 5129]) {
    extensionTest(`installs before React on a normal load on port ${port}`, async ({ page }) => {
      await page.goto(`http://localhost:${port}`);
      await expectBeforeReact(page);
    });
  }

  for (const port of [5118, 5128]) {
    extensionTest(`installs before React after a hard reload on port ${port}`, async ({ context, page }) => {
      await page.goto(`http://localhost:${port}`);
      const before = await expectBeforeReact(page);
      const cdp = await context.newCDPSession(page);
      await Promise.all([page.waitForEvent('load'), cdp.send('Page.reload', { ignoreCache: true })]);
      const after = await expectBeforeReact(page);
      expect(after.loadId).not.toBe(before.loadId);
    });
  }
});

extensionTest.describe('static content script, bfcache enabled', () => {
  extensionTest.use({ extensionPath: 'injection-timing/static', bfcache: true });

  const leaveAndReturn = async (page: Page, port: number) => {
    await page.goto(`http://localhost:${port}`);
    const before = await expectBeforeReact(page);
    await page.goto(`http://localhost:${port}/other.html`);
    // A bfcache restore fires pageshow but no load event, which goBack waits for by default.
    await page.goBack({ waitUntil: 'commit' });
    return before;
  };

  for (const port of [5128, 5129]) {
    extensionTest(`same hook keeps receiving commits after a bfcache restore on port ${port}`, async ({ page }) => {
      const before = await leaveAndReturn(page, port);
      await expect.poll(async () => (await timing(page)).persisted).toBe(true);
      const restored = await timing(page);
      expect(restored.loadId).toBe(before.loadId);
      await page.getByTestId('counter').click();
      await expect.poll(async () => (await timing(page)).commits).toBeGreaterThan(restored.commits);
    });
  }

  extensionTest('records whether the dev server page is restored from bfcache', async ({ page }) => {
    const before = await leaveAndReturn(page, 5118);
    await page.waitForTimeout(500);
    const after = await timing(page);
    console.log(`[dev server bfcache] persisted=${after.persisted} sameLoad=${after.loadId === before.loadId} injected=${after.injected}`);
  });
});

test.describe('registered content script', () => {
  const extension = path.resolve(import.meta.dirname, 'registered');
  const launch = (userDataDir: string) =>
    chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
  const registered = async (context: Awaited<ReturnType<typeof launch>>) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() => worker.evaluate(async () => (await (globalThis as any).chrome.scripting.getRegisteredContentScripts()).length))
      .toBe(1);
  };

  test('installs before React once registered, and again after a restart', async () => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'reactdx-timing-'));
    try {
      let context = await launch(userDataDir);
      await registered(context);
      let page = context.pages()[0] ?? (await context.newPage());
      await test.step('load after registration', async () => {
        await page.goto('http://localhost:5118');
        await expectBeforeReact(page);
      });
      await context.close();

      context = await launch(userDataDir);
      page = context.pages()[0] ?? (await context.newPage());
      // The very first load after a restart can beat Chrome restoring the registration
      // (measured by `pnpm timing:race`), so this checks the registration survived.
      await registered(context);
      await test.step('load after restart', async () => {
        await page.goto('http://localhost:5118');
        await expectBeforeReact(page);
      });
      await context.close();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
