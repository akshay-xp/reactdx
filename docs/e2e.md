# E2E (`e2e/`)

One Puppeteer 25.17.0 suite that loads the built extension into a real browser and checks it against every fixture (`docs/fixtures.md`).

## Commands (from the repo root)

- `pnpm test:e2e --browser=chrome`
- `pnpm test:e2e --browser=firefox`
- `--fixture=18|19|next|multi` runs one fixture's suite (plus the panel test); CI uses it per matrix cell.

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

## Key files

- `e2e/run.ts`: flag parsing, per-browser build, test run.
- `e2e/launch.ts`: `launchWithExtension(name)` returns `{ browser, panelCreated(), panelUrl }` (`panelUrl` is `null` in Firefox).
- `e2e/extension.test.ts`: the suite.
- `fixtures/start.ts`: `startFixture(script, port)`, shared with the fixture smoke test.

## Related

- `docs/extension.md`: the build under test.
- `docs/fixtures.md`: ports and test ids.
- `docs/unit-tests.md`: Vitest unit tests on React 18 and 19.
- `docs/ci.md`: the e2e matrix in CI.
