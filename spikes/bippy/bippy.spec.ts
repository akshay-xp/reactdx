import { test, expect } from '../harness/e2e/fixtures';

test.use({ extensionPath: 'bippy/extension' });

for (const port of [5118, 5119, 5120]) {
  test(`bippy connects before React on port ${port}`, async ({ page, consoleMessages }) => {
    await page.goto(`http://localhost:${port}`);
    await expect.poll(() => consoleMessages).toContain('[reactdx:bippy] active');
    expect(consoleMessages.join('\n')).not.toContain('Download the React DevTools');
  });
}
