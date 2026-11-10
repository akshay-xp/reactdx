import { test, expect } from '../harness/e2e/fixtures';

test.use({ extensionPath: 'bippy/extension' });

for (const port of [5118, 5119, 5120]) {
  test(`bippy connects before React on port ${port}`, async ({ page, consoleMessages }) => {
    await page.goto(`http://localhost:${port}`);
    await expect.poll(() => consoleMessages).toContain('[reactdx:bippy] active');
    expect(consoleMessages.join('\n')).not.toContain('Download the React DevTools');
  });
}

for (const port of [5118, 5119, 5120]) {
  test(`bippy lists rendered components on port ${port}`, async ({ page, consoleMessages }) => {
    await page.goto(`http://localhost:${port}`);
    if (port !== 5120) {
      await expect.poll(() => consoleMessages).toContain('[reactdx:bippy] rendered App');
    }
    const counterRenders = () =>
      consoleMessages.filter((message) => message === '[reactdx:bippy] rendered Counter').length;
    await expect.poll(counterRenders).toBeGreaterThan(0);
    const before = counterRenders();
    await page.getByTestId('counter').click();
    await expect.poll(counterRenders).toBeGreaterThan(before);
  });
}

for (const port of [5118, 5119, 5120]) {
  test(`bippy renderer access edits hook state on port ${port}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}`);
    const counter = page.getByTestId('counter');
    await expect(counter).toHaveText('Count: 0');
    await page.evaluate(() => (window as any).__reactdxBippyEdit(5));
    await expect(counter).toHaveText('Count: 5');
  });
}
