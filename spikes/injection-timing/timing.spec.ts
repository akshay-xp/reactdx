import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test as extensionTest } from '../harness/e2e/fixtures';

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
