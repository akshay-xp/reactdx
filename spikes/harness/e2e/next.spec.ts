import { test, expect } from '@playwright/test';

test('Next fixture renders a server and a client component', async ({ page }) => {
  await page.goto('http://localhost:5120');
  await expect(page.getByTestId('server')).toHaveText('Rendered on the server');
  const counter = page.getByTestId('counter');
  await expect(counter).toHaveText('Count: 0');
  await counter.click();
  await expect(counter).toHaveText('Count: 1');
});
