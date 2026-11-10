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
    await page.getByTestId('counter').click({ timeout: 3000 });
    await expect.poll(() => consoleMessages).toContain('[reactdx:bippy] rendered Counter');
  });
}
