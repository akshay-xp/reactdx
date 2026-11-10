import { test, expect } from '@playwright/test';

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
