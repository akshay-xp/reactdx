import { test, expect } from './fixtures';

for (const port of [5118, 5119, 5120]) {
  test(`hook is installed before React on port ${port}`, async ({ page, consoleMessages }) => {
    await page.goto(`http://localhost:${port}`);
    await expect.poll(() => consoleMessages).toContain('[reactdx] hook installed');
    expect(consoleMessages.join('\n')).not.toContain('Download the React DevTools');
  });
}
