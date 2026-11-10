import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const spikesRoot = path.resolve(import.meta.dirname, '../..');

export const test = base.extend<{
  extensionPath: string;
  context: BrowserContext;
  consoleMessages: string[];
}>({
  extensionPath: ['harness/extension', { option: true }],
  context: async ({ extensionPath }, use) => {
    const extension = path.resolve(spikesRoot, extensionPath);
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
