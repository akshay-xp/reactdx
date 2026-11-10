import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../harness/e2e/fixtures';

// RDT registers its hook script from its service worker, so the first load can miss it.
const gotoWithRdt = async (context: BrowserContext, page: Page, url: string) => {
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
  await page.goto(url);
  await page.reload();
};

const rdtState = (page: Page) =>
  page.evaluate(() => {
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    return { bippy: !!hook?._isBippyHook, rendererInterfaces: hook?.rendererInterfaces?.size };
  });

test.describe('RDT alone', () => {
  test.use({ extensionPath: 'hook-cost/rdt' });

  test('RDT backend attaches', async ({ context, page }) => {
    await gotoWithRdt(context, page, 'http://localhost:5118');
    await expect.poll(() => rdtState(page)).toEqual({ bippy: false, rendererInterfaces: 1 });
  });
});

test.describe('bippy with RDT', () => {
  test.use({ extensionPath: 'bippy/extension,hook-cost/rdt' });

  test('bippy hook wins and RDT backend never attaches', async ({ context, page, consoleMessages }) => {
    await gotoWithRdt(context, page, 'http://localhost:5118');
    const counterRenders = () =>
      consoleMessages.filter((message) => message === '[reactdx:bippy] rendered Counter').length;
    await expect.poll(counterRenders).toBeGreaterThan(0);
    expect(await rdtState(page)).toEqual({ bippy: true, rendererInterfaces: undefined });
  });
});
