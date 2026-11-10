import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const spikesRoot = path.resolve(import.meta.dirname, '../..');

export const test = base.extend<{
  extensionPath: string;
  bfcache: boolean;
  devtools: boolean;
  context: BrowserContext;
  consoleMessages: string[];
}>({
  extensionPath: ['harness/extension', { option: true }],
  bfcache: [false, { option: true }],
  devtools: [false, { option: true }],
  context: async ({ extensionPath, bfcache, devtools }, use) => {
    const extensions = extensionPath
      .split(',')
      .map((extension) => path.resolve(spikesRoot, extension))
      .join(',');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // A devtools_page only runs while DevTools is open, which needs a headed window.
      headless: !devtools,
      args: [
        `--disable-extensions-except=${extensions}`,
        `--load-extension=${extensions}`,
        ...(devtools ? ['--auto-open-devtools-for-tabs'] : []),
      ],
      // Playwright disables the back/forward cache by default.
      ignoreDefaultArgs: bfcache ? ['--disable-back-forward-cache'] : [],
    });
    await use(context);
    await context.close();
  },
  consoleMessages: async ({ page }, use) => {
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    await use(messages);
  },
});

export { expect } from '@playwright/test';
