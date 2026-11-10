import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const spikesRoot = path.resolve(import.meta.dirname, '../..');

export const test = base.extend<{
  extensionPath: string;
  bfcache: boolean;
  context: BrowserContext;
  consoleMessages: string[];
}>({
  extensionPath: ['harness/extension', { option: true }],
  bfcache: [false, { option: true }],
  context: async ({ extensionPath, bfcache }, use) => {
    const extensions = extensionPath
      .split(',')
      .map((extension) => path.resolve(spikesRoot, extension))
      .join(',');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensions}`, `--load-extension=${extensions}`],
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
