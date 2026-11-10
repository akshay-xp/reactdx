import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'puppeteer';
import { startFixture } from '../fixtures/start.ts';
import { launchWithExtension, type BrowserName } from './launch.ts';

let browser: Browser;
before(async () => ({ browser } = await launchWithExtension(process.env.E2E_BROWSER as BrowserName)));
after(() => browser?.close());

for (const [script, port, renderers] of [
  ['fixture:18', 5218, 1],
  ['fixture:19', 5219, 1],
  ['fixture:next', 5220, 2], // the dev overlay brings its own production react-dom
  ['fixture:multi', 5221, 2],
] as const) {
  describe(script, () => {
    let stop: (() => void) | undefined;
    before(async () => (stop = await startFixture(script, port)));
    after(() => stop?.());

    test('React registers with our hook', async () => {
      const page = await browser.newPage();
      const messages: string[] = [];
      page.on('console', (message) => messages.push(message.text()));
      await page.goto(`http://localhost:${port}`);
      await page.waitForSelector('[data-testid=counter]');
      assert.equal(await page.evaluate(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size), renderers);
      assert.deepEqual(messages.filter((text) => text.includes('Download the React DevTools')), []);
      await page.close();
    });
  });
}
