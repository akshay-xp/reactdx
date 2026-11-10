import { test, expect } from '@playwright/test';

for (const port of [5118, 5119]) {
  test(`bench page renders 10k cells on port ${port}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}/bench.html`);
    await expect(page.getByTestId('cell')).toHaveCount(10000);
  });
}
