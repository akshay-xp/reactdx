import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';

export type BrowserName = 'chrome' | 'firefox';

const output = path.resolve(import.meta.dirname, '../apps/extension/.output');

export async function launchWithExtension(name: BrowserName): Promise<{
  browser: Browser;
  panelCreated(): Promise<boolean>;
  panelUrl: string | null;
}> {
  if (name === 'firefox') throw new Error('not implemented');
  // DevTools pages only exist in a headed browser.
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    pipe: true,
    enableExtensions: [path.join(output, 'chrome-mv3')],
  });
  return {
    browser,
    panelCreated: () => Promise.reject(new Error('not implemented')),
    panelUrl: null,
  };
}
