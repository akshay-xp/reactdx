import { test, expect } from '@playwright/test';

test('React 18 fixture shows its version', async ({ page }) => {
  await page.goto('http://localhost:5118');
  await expect(page.getByTestId('react-version')).toHaveText('18.3.1');
});
