import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer, { type Browser, type Page } from 'puppeteer';

// Starts `pnpm <script>` and resolves once the port answers.
function startFixture(script: string, port: number) {
  const child = spawn('pnpm', [script], { detached: true, stdio: 'ignore' });
  let exited = false;
  const stop = () => {
    if (!exited) process.kill(-child.pid!, 'SIGTERM');
  };
  return new Promise<() => void>((resolve, reject) => {
    const deadline = Date.now() + 60_000;
    child.once('exit', (code) => {
      exited = true;
      reject(new Error(`server for ${script} exited with code ${code}`));
    });
    const poll = async () => {
      if (exited) return;
      try {
        await fetch(`http://localhost:${port}`);
        resolve(stop);
      } catch {
        if (Date.now() > deadline) return stop(), reject(new Error(`server for ${script} never answered on ${port}`));
        setTimeout(poll, 250);
      }
    };
    poll();
  });
}

let browser: Browser;
before(async () => (browser = await puppeteer.launch()));
after(() => browser.close());

const text = (page: Page, selector: string) => page.$eval(selector, (el) => el.textContent);

async function expectCounter(page: Page, scope: string) {
  const counter = `${scope} [data-testid=counter]`;
  assert.equal(await text(page, counter), 'Count: 0');
  await page.click(counter);
  await page.waitForFunction((s) => document.querySelector(s)?.textContent === 'Count: 1', {}, counter);
}

for (const [script, port, version] of [
  ['fixture:18', 5218, /^18\.3\./],
  ['fixture:19', 5219, /^19\./],
] as const) {
  describe(script, () => {
    let stop: (() => void) | undefined;
    before(async () => (stop = await startFixture(script, port)));
    after(() => stop?.());

    test('shows its React version and a working counter', async () => {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}`);
      await page.waitForSelector('[data-testid=react-version]');
      assert.match((await text(page, '[data-testid=react-version]'))!, version);
      await expectCounter(page, 'body');
      await page.close();
    });
  });
}
