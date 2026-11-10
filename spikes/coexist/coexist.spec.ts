import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../harness/e2e/fixtures';

// RDT registers its hook script from its service worker, so a load can miss it, especially under
// load. Its installer posts a handshake as soon as it runs, even when it then bails, so reload until
// that message arrives.
const gotoWithRdt = async (context: BrowserContext, page: Page, url: string) => {
  await context.addInitScript(() =>
    window.addEventListener('message', (event) => {
      if (event.data?.source === 'react-devtools-hook-installer') (window as any).__rdtRan = true;
    }),
  );
  for (let attempt = 1; ; attempt++) {
    await page.goto(url);
    if (await page.waitForFunction(() => (window as any).__rdtRan, null, { timeout: 2000 }).catch(() => null)) return;
    if (attempt === 5) throw new Error("RDT's hook script never ran");
  }
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

const coexist = (page: Page) => page.evaluate(() => (window as any).__reactdxCoexist);

const rdtWorking = (page: Page) =>
  page.evaluate(() => {
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const ids = [...(hook?.rendererInterfaces?.keys() ?? [])];
    const roots = ids.reduce((sum, id) => sum + hook.getFiberRoots(id).size, 0);
    return ids.length > 0 && roots > 0;
  });

const expectOurCommits = async (page: Page, consoleMessages: string[]) => {
  const counterRenders = () =>
    consoleMessages.filter((message) => message === '[reactdx:coexist] rendered Counter').length;
  await expect.poll(counterRenders).toBeGreaterThan(0);
  const before = counterRenders();
  await page.getByTestId('counter').click();
  await expect.poll(counterRenders).toBeGreaterThan(before);
};

const ports = [5118, 5119, 5120];

test.describe('ours first, with RDT', () => {
  test.use({ extensionPath: 'coexist/extension,hook-cost/rdt' });

  for (const port of ports) {
    test(`both receive commits on port ${port}`, async ({ context, page, consoleMessages }) => {
      await gotoWithRdt(context, page, `http://localhost:${port}`);
      expect((await coexist(page))?.order).toBe('first');
      await expect.poll(() => rdtWorking(page)).toBe(true);
      await expectOurCommits(page, consoleMessages);
    });
  }
});

test.describe('ours alone', () => {
  test.use({ extensionPath: 'coexist/extension' });

  for (const port of ports) {
    test(`ours receives commits before React loads on port ${port}`, async ({ page, consoleMessages }) => {
      await page.goto(`http://localhost:${port}`);
      expect((await coexist(page))?.order).toBe('first');
      await expectOurCommits(page, consoleMessages);
      expect(consoleMessages.join('\n')).not.toContain('Download the React DevTools');
    });
  }
});

test.describe('RDT first, ours late', () => {
  test.use({ extensionPath: 'coexist/extension-late,hook-cost/rdt' });

  for (const port of ports) {
    test(`ours attaches to RDT's hook and both receive commits on port ${port}`, async ({
      context,
      page,
      consoleMessages,
    }) => {
      await gotoWithRdt(context, page, `http://localhost:${port}`);
      await expect.poll(async () => (await coexist(page))?.order).toBe('late');
      expect((await coexist(page)).renderersAtInstall).toBe(0);
      await expect.poll(() => rdtWorking(page)).toBe(true);
      await expectOurCommits(page, consoleMessages);
    });
  }
});
