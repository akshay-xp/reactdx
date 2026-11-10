import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../harness/e2e/fixtures';

const timing = (page: Page) => page.evaluate(() => (window as any).__reactdxTiming);

test('extension asks for no site access', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'extension/manifest.json'), 'utf8'));
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
});

test.describe('with DevTools open', () => {
  test.use({ extensionPath: 'injected-script/extension', devtools: true });

  for (const port of [5118, 5119]) {
    test(`injected reload installs the hook before React on port ${port}`, async ({ page }) => {
      await page.goto(`http://localhost:${port}`);
      await expect.poll(async () => (await timing(page).catch(() => undefined))?.injected, { timeout: 10000 }).toBe(1);
      expect((await timing(page)).commits).toBeGreaterThan(0);
    });
  }
});
