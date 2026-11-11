# E2E (`e2e/`)

One Puppeteer 25.17.0 suite that loads the built extension into a real browser and checks it against every fixture (`docs/fixtures.md`).

## Commands (from the repo root)

- `pnpm test:e2e --browser=chrome`
- `pnpm test:e2e --browser=firefox`
- `--fixture=18|19|next|multi|prod` runs one fixture's suite (plus the panel test); CI uses it per matrix cell.

`e2e/run.ts` parses the flags, builds only that browser (`pnpm --filter @reactdx/extension build:<browser>`), then runs `node --test e2e/extension.test.ts` with `E2E_BROWSER` (and `E2E_FIXTURE`) set. The flags can't go to `node --test` directly: Node rejects them as unknown options.

Both browsers run **headed** (DevTools, and so the devtools page, doesn't exist headless). Local runs open windows; CI needs a virtual display.

## Browsers

- Chrome for Testing 157.0.8103.50 (Puppeteer's pinned Chrome): `enableExtensions: [.output/chrome-mv3]`, `devtools: true`, `pipe: true`.
- Firefox `stable_159.0.1` (Puppeteer's pinned Firefox; Puppeteer drives only that build): `-devtools`, then `browser.installExtension(.output/firefox-mv3)` over WebDriver BiDi. `.puppeteerrc.cjs` sets `firefox.skipDownload: false` so `pnpm install` downloads it.

## What's checked

| Check                                                                       | Chrome                                                                      | Firefox        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| Hook installed before React, on every fixture                               | yes                                                                         | yes            |
| No "Download the React DevTools" console message                            | yes                                                                         | yes            |
| Devtools page's `panels.create` succeeds (`[reactdx] panel created` logged) | CDP session on the `devtools.html` target, `Runtime.enable` replays the log | Firefox stdout |
| `panel.html` renders `panel-root`                                           | yes                                                                         | no             |

- **Before-React signal:** React registers (`hook.inject`) with whichever `__REACT_DEVTOOLS_GLOBAL_HOOK__` exists when it loads, so `renderers.size` on our hook proves the `document_start` script won. Expected: 1 on `fixture:18` and `fixture:19`, 2 on `fixture:multi` (two React copies), 2 on `fixture:next` (the app's dev react-dom plus a production react-dom, `bundleType` 0, bundled by Next's dev overlay; relevant for M2 renderer handling).
- **Firefox stdout prefs:** `devtools.console.stdout.chrome` and `devtools.console.stdout.content` (both needed for the devtools page's log). Puppeteer always pipes Firefox's stdout.
- **Why Firefox doesn't render the panel:** BiDi refuses to navigate to `moz-extension://` (`unsupported operation`), and Firefox gives extension panels random tool ids (`webext-devtools-panel-<random>`), so the toolbox can't be switched to ours. Chrome covers the render.

## Coexisting with RDT (`e2e/coexist.test.ts`)

Per fixture, with the store RDT installed, each case asserts that RDT's backend attached (`rendererInterfaces.size` = renderers, `getFiberRoots` non-empty for every `react-dom` renderer), that ReactDX's record has the same renderers, and that a ReactDX commit listener fires on a click.

| Case                       | How the order is forced                                                                                                | Asserts order              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| ReactDX first, then RDT    | `page.evaluateOnNewDocument(preloadHook("first"))`: our bundled `installHook` runs before any page or extension script | ours on `Window.prototype` |
| RDT first, then ReactDX    | `preloadHook("after-rdt")`: waits (10 ms polls, up to 2 s) for RDT's own-property hook, then installs                  | RDT's on `window`          |
| The shipped build with RDT | real extension + RDT, whatever order the browser gives                                                                 | none                       |

- Orders are forced because the browsers don't vary them: under Puppeteer, Chrome 157 always installs RDT's hook first and Firefox 159 always ReactDX's, whatever the extension load order. M0 #4 saw ReactDX first in Chromium 158 under Playwright `--load-extension`, so real-world order isn't assumed.
- RDT registers its hook from its service worker, so a load can miss it; the test reloads until it's attached, up to 5 times.
- Renderers with RDT: 1 on `fixture:18`/`19`, 2 on `multi`, 3 on `next` (Next's Server Components client also registers, because RDT's hook has `supportsFlight`; `docs/page.md`).
- `e2e/preload.ts` bundles the preload scripts in memory with esbuild (a root devDependency).

## RDT, locked like a dependency (`e2e/rdt.ts`)

- `e2e/rdt.lock.json`: RDT `version`, Firefox's versioned AMO `url` and `sha256`, Chrome's `sha256`. The Chrome Web Store only serves the latest build, so Chrome is pinned by hash.
- `ensureRdt(browser)` returns `e2e/.rdt/<browser>-<version>/` (gitignored), unpacked. A cached folder means no network; otherwise it downloads, checks the hash and unzips.
- A store build that isn't the locked one throws `RDT from the <store> isn't the locked <version> (sha256 …); run pnpm rdt:update`, so a new RDT release never silently changes what's tested.
- `pnpm rdt:update` (`e2e/rdt-update.ts`): latest from AMO's API (checked against AMO's hash) and the Chrome Web Store; fails if their versions differ; rewrites the lock and fills the cache.
- CI caches `e2e/.rdt` on the lock's hash (`docs/ci.md`).
- `e2e/rdt.test.ts`: cached means offline; a wrong hash throws and caches nothing.

## Key files

- `e2e/run.ts`: flag parsing, per-browser build, test run.
- `e2e/launch.ts`: `launchWithExtension(name, extensions = [reactdxBuild(name)], { devtoolsTheme })` returns `{ browser, panelCreated() }`. `devtoolsTheme` (Chrome) writes DevTools' `ui-theme` into a temp profile's `Default/Preferences`.
- `openPanel(browser)` (Chrome): selects the ReactDX tab through DevTools' `InspectorView` and returns the panel frame. The panel needs `browser.devtools`, so it's only tested inside DevTools.
- `e2e/panel-text.ts`: `openPanelText(name, browser)` returns a reader for the panel's visible text, whitespace-normalized, in both browsers; `parseCopies(text)` and `until(read, check)`. Chrome walks the panel frame's text nodes. Firefox runs DevTools panels in an extension process Puppeteer can't reach, so chrome scope (`e2e/firefox.ts` `chromeEval`) selects the ReactDX tool through `gDevTools` (by `toolbox.getAdditionalTools()`, not the tab DOM: CI's narrow xvfb window moves the last tabs into an overflow menu) and reads the panel's accessibility tree, which Firefox mirrors into the parent process.
- `e2e/panel.test.ts`: per fixture, the panel lists each copy and a commit count that rises after a click, with DevTools opened after and before load; no React and production notices. Each test launches its own browser, so DevTools has one window.
- `e2e/agent.test.ts`: the agent is injected on development fixtures only.
- `e2e/forged.test.ts`: forged and malformed page messages (`docs/messages.md`).
- `e2e/plain.ts`: `plainPage()`, a page without React for the whole file.
- `e2e/reconnect.test.ts`: background stopped, navigation away and back, reload (`fixture:18`), and bfcache restore with and without the panel open (`fixture:multi`).
- `e2e/background.ts`: `stopBackground(name, browser)`. Chrome: CDP `ServiceWorker.stopAllWorkers` from a page session (the domain doesn't exist on the browser session), then waits for ReactDX's worker target to go. Firefox: chrome scope calls the extension's `terminateBackground()` and checks `backgroundState`.
- bfcache tests prove a real restore with a `pageshow` `persisted` listener. They use `fixture:multi` because Vite's dev pages hold an HMR WebSocket that keeps Firefox from caching them, and `history.back()` because a Firefox restore fires no `load` event for `page.goBack()` to wait on.
- `panelFor(name, url, order)` (`e2e/panel-text.ts`): launches with ReactDX and opens the panel before or after the page loads.
- `e2e/theme.test.ts`: the panel follows DevTools light and dark (Chrome; skipped in Firefox).
- `e2e/extension.test.ts`: ReactDX alone (hook on the prototype, record, panel).
- `e2e/toolbar.test.ts`: toolbar title (and icon in Firefox) on a non-React page and every fixture including `prod`; leaving a React page resets it; Chrome checks a non-React page sends the service worker nothing.
- `e2e/toolbar.ts`: `toolbar(name, browser, page)`. Chrome evaluates `chrome.action.getTitle` for the active tab in the service worker (`reactdxWorker(browser)`; without the `tabs` permission a URL query matches nothing; Chrome can't read icons back). Firefox launches with `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` and sends raw WebDriver BiDi over `browser.connection` in the browser's chrome scope, reading the action's per-tab data (`browserActionFor(extension).action.getContextData(tab)`): MV3 buttons sit in the extensions panel, whose nodes are built lazily.
- `e2e/coexist.test.ts`, `e2e/preload.ts`, `e2e/rdt.ts`, `e2e/rdt.lock.json`, `e2e/rdt-update.ts`.
- Test files run one at a time (`--test-concurrency=1`): they share fixture ports.
- `--test-timeout=120000` and `--test-force-exit` (`e2e/run.ts`): `node --test` prints failure details only at the end of the run, so a hung test or a file whose browser outlives its tests would otherwise run into CI's 15-minute job timeout with no details.
- CI timing: the Chrome DevTools page can take over 10 s to appear (`launchChrome` waits 30 s), and Next's server-rendered counter appears before React hydrates, so tests that need commits wait for ReactDX's record to see a root.
- `fixtures/start.ts`: `startFixture(script, port)`, shared with the fixture smoke test.

## Related

- `docs/extension.md`: the build under test.
- `docs/fixtures.md`: ports and test ids.
- `docs/unit-tests.md`: Vitest unit tests on React 18 and 19.
- `docs/ci.md`: the e2e matrix in CI.
