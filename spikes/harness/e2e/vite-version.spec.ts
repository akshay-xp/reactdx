import { test, expect } from '@playwright/test';

for (const [port, version] of [
  [5118, '18.3.1'],
  [5119, '19.3.1'],
]) {
  test(`fixture on port ${port} shows React ${version}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}`);
    await expect(page.getByTestId('react-version')).toHaveText(version);
  });
}
