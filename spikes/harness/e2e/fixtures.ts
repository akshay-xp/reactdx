import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const extension = path.resolve(import.meta.dirname, '../extension');

export const test = base.extend<{ context: BrowserContext; consoleMessages: string[] }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
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
