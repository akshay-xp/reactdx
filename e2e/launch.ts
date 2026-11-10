import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';

export type BrowserName = 'chrome' | 'firefox';

const PANEL_CREATED = '[reactdx] panel created';
const output = path.resolve(import.meta.dirname, '../apps/extension/.output');

// DevTools pages only exist in a headed browser, so both launch headed with DevTools open.
export function launchWithExtension(name: BrowserName): Promise<{
  browser: Browser;
  panelCreated(): Promise<boolean>;
  panelUrl: string | null;
}> {
  return name === 'chrome' ? launchChrome() : launchFirefox();
}

async function launchChrome() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    pipe: true,
    enableExtensions: [path.join(output, 'chrome-mv3')],
  });
  const devtools = await browser.waitForTarget((target) => target.url().endsWith('/devtools.html'), { timeout: 10_000 });
  return {
    browser,
    async panelCreated() {
      const session = await devtools.createCDPSession();
      const logs: string[] = [];
      session.on('Runtime.consoleAPICalled', (event) => logs.push(...event.args.map((arg) => String(arg.value))));
      // Enabling the Runtime domain replays messages logged before we attached.
      await session.send('Runtime.enable');
      return poll(() => logs.includes(PANEL_CREATED), 2_000);
    },
    panelUrl: new URL('/panel.html', devtools.url()).href,
  };
}

async function launchFirefox() {
  const browser = await puppeteer.launch({
    browser: 'firefox',
    headless: false,
    args: ['-devtools'],
    // The devtools page's console is only reachable as Firefox's stdout.
    extraPrefsFirefox: { 'devtools.console.stdout.chrome': true, 'devtools.console.stdout.content': true },
  });
  let stdout = '';
  browser.process()!.stdout!.on('data', (chunk) => (stdout += chunk));
  await browser.installExtension(path.join(output, 'firefox-mv3'));
  return {
    browser,
    panelCreated: () => poll(() => stdout.includes(PANEL_CREATED), 10_000),
    // BiDi refuses to navigate to moz-extension:// URLs.
    panelUrl: null,
  };
}

async function poll(check: () => boolean, timeout: number) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}
