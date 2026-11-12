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

- **Reloads (up to 5 loads):** when RDT missed the load, and when React hasn't committed a development root within 20 s. On CI, Next's dev page sometimes never hydrates with RDT installed (no errors, no pending requests; the server-rendered counter shows anyway). A control run on the same runner (PR #23) hydrated 6 of 8 loads with RDT alone and 8 of 8 with ReactDX's hook added, so it's RDT plus `next dev` on a slow machine, not ReactDX. Never seen locally.

## RDT, locked like a dependency (`e2e/rdt.ts`)

- `e2e/rdt.lock.json`: RDT `version`, Firefox's versioned AMO `url` and `sha256`, Chrome's `sha256`. The Chrome Web Store only serves the latest build, so Chrome is pinned by hash.
- `ensureRdt(browser)` returns `e2e/.rdt/<browser>-<version>/` (gitignored), unpacked. A cached folder means no network; otherwise it downloads, checks the hash and unzips.
- A store build that isn't the locked one throws `RDT from the <store> isn't the locked <version> (sha256 …); run pnpm rdt:update`, so a new RDT release never silently changes what's tested.
- `pnpm rdt:update` (`e2e/rdt-update.ts`): latest from AMO's API (checked against AMO's hash) and the Chrome Web Store; fails if their versions differ; rewrites the lock and fills the cache.
- CI caches `e2e/.rdt` on the lock's hash (`docs/ci.md`).
- `e2e/rdt.test.ts`: cached means offline; a wrong hash throws and caches nothing.

## Key files

- `e2e/run.ts`: flag parsing, per-browser build, test run.
- `e2e/launch.ts`: `launchWithExtension(name, extensions = [reactdxBuild(name)], { devtoolsTheme, devtools })` returns `{ browser, panelCreated() }`. `devtoolsTheme` (Chrome) writes DevTools' `ui-theme` into a temp profile's `Default/Preferences`. `devtools: false` (Chrome) launches with DevTools closed: every other test has DevTools open on every tab from the start, so "DevTools opened after load" elsewhere never means DevTools was closed while the page loaded.
- `openPanel(browser)` (Chrome): selects the ReactDX tab through DevTools' `InspectorView` and returns the panel frame. The panel needs `browser.devtools`, so it's only tested inside DevTools.
- `e2e/panel-text.ts`: `openPanelText(name, browser)` returns a reader for the panel's visible text, whitespace-normalized, in both browsers; `parseCopies(text)` (each copy's heading, root commit counts, and the component `names` listed under its roots; a copy ends at any other `React ` heading, even a forged one it can't parse) and `until(read, check)`. Chrome walks the panel frame's text nodes. Firefox runs DevTools panels in an extension process Puppeteer can't reach, so chrome scope (`e2e/firefox.ts` `chromeEval`) selects the ReactDX tool through `gDevTools` (by `toolbox.getAdditionalTools()`, not the tab DOM: CI's narrow xvfb window moves the last tabs into an overflow menu) and reads the panel's accessibility tree, which Firefox mirrors into the parent process. The reader's `end()` presses End on each tree, because a tree only renders the rows in view and Next's is taller than the panel (its app components are last). Chrome focuses `[data-testid=tree]` and presses the key. Firefox focuses each tree's accessible (`takeFocus()`) and sends a trusted key from the parent's `nsITextInputProcessor`. `e2e/panel.test.ts` calls it before every read.
  - `hover(name)` puts the pointer on the tree row with that name; `leave()` moves it onto the toolbar's search box (off the trees). Chrome uses Puppeteer's mouse in the panel frame; CDP's synthetic moves out of the frame fire no leave events inside it, hence the search box. Firefox sends `windowUtils.sendNativeMouseEvent` at the accessible's screen bounds (`sendMouseEvent` is gone from current Firefox), which moves the real pointer on a desktop run.
  - `close()` closes DevTools: Chrome closes the DevTools page, Firefox calls `gDevTools.closeToolboxForTab`.
  - `press(name)` clicks the button with that name (its text, or its `aria-label` for an icon button), `pressed(name)` reads its `aria-pressed`, `selected()` is the selected row's name. Chrome reads the frame's DOM. Firefox: `doAction(0)` on the `PUSHBUTTON`/`TOGGLE_BUTTON` accessible, its `STATE_PRESSED`, and the first text leaf of the `OUTLINEITEM` with `STATE_SELECTED`.
  - `select(name)` clicks the tree row with that name: Chrome clicks the row element; Firefox runs the row accessible's `doAction(0)` (a native click lands by screen position, which can lag behind a tree that just scrolled).
  - The reader leaves out the inspector pane, so `parseCopies` sees only the trees; `inspector()` reads only the inspector. Chrome skips or walks `[data-testid=inspector]`; Firefox skips or walks the landmark accessible named "Inspector".
  - In Firefox every action goes through `onAccessible(match, action)`: find the first accessible a JS expression over `node` accepts, run `action` on it.
- `e2e/panel.test.ts`: per fixture, the panel lists each copy, a commit count that rises after a click, and each development root's component names (exactly `App`, `Counter` on Vite; `Counter` among Next's own components), with a click adding `Clicked`, with DevTools opened after and before load; production copies list no names; no React and production notices; `/tree.html` shows every kind by name, with `memo`/`forwardRef`/`lazy` badges and `key="a"` keys as their own words (`fixture:19`); "Show DOM elements" adds `p` and `button` rows and hides them again (`fixture:18`). The toolbar's text comes before the first copy heading, so `parseCopies` ignores it. Each test launches its own browser, so DevTools has one window.
- `e2e/perf.test.ts` (Chrome, `fixture:19` `/bench.html`, 10,000 `Cell`s; Firefox's panel is out of Puppeteer's reach): each test loads the bench, then opens the panel (`openPanel`). Times print as `t.diagnostic`. Inspector (M4 #38): clicking `Cell key="0"`'s row shows `State: 0` in the inspector within 100 ms, timed in the panel from the click (`selectCell`; 8 to 17 ms locally); with it selected, toggling Extra (Bench re-renders, the cells bail out) posts no `inspected` message within 300 ms, while `__bench("one", 1)` (a commit to that Cell) posts one and shows `State: 1`.
  - First rows within 500 ms of subscribe: the panel's own `reactdx:subscribe` and `reactdx:rows` marks.
  - The bench button's `Extra` row within 100 ms of the agent posting its batch: `Date.now()` in a page `message` listener and a panel `MutationObserver` (the two `performance` clocks have different origins). The page's 100 ms flush isn't counted.
  - Scrolling top to bottom by `clientHeight` per two frames: under 100 node rows in the DOM at every step, last row `Cell key="9999"`, no `longtask` over 50 ms. The observer must first catch a planted 80 ms task in its own `setTimeout` (one in the task that registered the observer isn't reported).
  - End and Home (real key presses on the focused tree) select the last and first rows and scroll them into the DOM.
- `e2e/highlight.test.ts` (`fixture:18`, both browsers): hovering the Counter row draws exactly one overlay whose box is within 1 px of the counter button's rect, labelled `Counter`; leaving the trees removes it; every page element's computed style is unchanged with it shown; closing DevTools removes it. The overlay's shadow root is closed, so a preload wraps `Element.prototype.attachShadow` and keeps the roots (the agent runs in the page's world, as any page script could). `e2e/shadows.ts` holds it: `overlayPage(name, url)` (preload, page, panel, tree listed), `overlays(page)`, `waitForOverlays(page, count)`, `styles(page)`.
- `e2e/picker.test.ts` (`fixture:18`, both browsers): with the picker on, clicking the counter selects the `Counter` row, the count stays `Count: 0`, and the picker turns off; Escape with the overlay shown removes it, turns the picker off and selects nothing.
- `e2e/inspector.test.ts` (fixtures 18, 19, next; both browsers): selecting `Counter` shows `label: "Count"` and `State: 0`, and a page click makes it `State: 1` without reselecting; with DOM elements shown, selecting `button` shows `children: ["Count", ": ", 1]`, and another click changes it to `2`. `Counter`'s Rendered by shows `App` (18, 19), and pressing it selects and inspects `App`; on Next it shows the `Page` Server Component. The header shows `Counter`'s source, `Counter.jsx:13` (18, 19) or `Counter.jsx:15` (next). On 18 and 19, `/hooks.html`'s `Hooks` shows its Context section (`Theme: "dark"`) and a row per hook type of that version (`HOOKS`, `HOOKS_19`) and the `useCart` group: proof that grouping works with both browsers' stack formats. On 19 (both browsers), Hook names: off by default (`State: 0`); pressed, `Counter` shows `State(count): 0` and `/hooks.html` shows `State(one): 1`, `Ref(box): {a: 1}`, `Ref(handle)`, `useCart(cart): "2 items"`; after `panel.close()` and a new tab's DevTools, the toggle is still pressed and `State(count): 0` shows. Chrome also listens to the DevTools page's requests: the `hook-names` chunk is requested only after the press (a module loads once, so that proves it wasn't loaded before; Resource Timing doesn't list extension chunks). `selectListed(panel, name)` (`e2e/panel-text.ts`, used by the inspector and editor tests) presses End, waits for the tree to list a component, selects it, and selects again (up to 3 times) if the inspector's header doesn't show it within 2 s: a new document's first watch can reset the tree just after the click. Chrome's `select` also finds the row again (up to 3 tries) when Puppeteer reports it detached: the tree re-renders its visible rows as batches arrive.
- `e2e/editor.test.ts` (fixtures 18, 19, next, multi; Chrome only, Firefox's panel is out of Puppeteer's reach): `LAUNCH_EDITOR` (Vite) and `REACT_EDITOR` (Next) name `e2e/editor/code`, a stub that appends its arguments to `$REACTDX_EDITOR_LOG` (named `code`, both servers pass it `file:line:column`). Pressing "Open in editor" on `Counter` makes the log hold `fixtures/vite/src/Counter.jsx:13:7` or `fixtures/next/app/Counter.jsx:15:7`; on multi (a static server, 404 for both) the panel's `copy` event carries the row's full location and "Copied" shows. The click is Puppeteer's (trusted): copying needs a user gesture. `panel.frame` is the Chrome panel's document.
- Node 24's runner hangs on a file with `before`/`after` hooks and no tests (out of memory after 30 s): files whose fixture list can be empty (`--fixture=multi`, Firefox) register their hooks only when it isn't.
- `e2e/agent.test.ts`: the agent is injected on development fixtures only.
- `e2e/forged.test.ts`: forged and malformed page messages and tree batches, and forged agent commands (`docs/messages.md`). The forged tree goes last with a seq the agent won't follow, so only the panel's resync brings the real tree back (a planted no-resync store fails it). A second test (M4 #38, both browsers) selects `Counter`, posts a valid-shaped `inspected` for its id with `<img onerror>` props (shown as text; Chrome: no `img` in the panel), then malformed `inspected`/`expanded` messages carrying `DROPPED` (bad value type, 1,001-char string, 101-entry page, 201 hooks, 9-deep groups, `source` or hook `site` with line 0, string `objectId`, 101 items) and bad `inspect`/`expand` commands: the forged view stays and `DROPPED` never shows. A valid-shaped forged `inspect` command moves the agent's selection (a page changes only its own panel's view); selecting again brings live data back (`State: 1` after a click).
- `e2e/plain.ts`: `plainPage()`, a page without React for the whole file.
- `e2e/reconnect.test.ts`: background stopped, navigation away and back, reload (`fixture:18`), and bfcache restore with and without the panel open (`fixture:multi`). Each checks the tree lists `Counter` and a click toggles `Clicked`.
- `e2e/background.ts`: `stopBackground(name, browser)`. Chrome: CDP `ServiceWorker.stopAllWorkers` from a page session (the domain doesn't exist on the browser session), then waits for ReactDX's worker target to go. Firefox: chrome scope calls the extension's `terminateBackground()` and checks `backgroundState`.
- bfcache tests prove a real restore with a `pageshow` `persisted` listener. They use `fixture:multi` because Vite's dev pages hold an HMR WebSocket that keeps Firefox from caching them, and `history.back()` because a Firefox restore fires no `load` event for `page.goBack()` to wait on.
- `panelFor(name, url, order)` (`e2e/panel-text.ts`): launches with ReactDX and opens the panel before or after the page loads.
- `e2e/theme.test.ts`: the panel follows DevTools light and dark (Chrome; skipped in Firefox).
- `e2e/extension.test.ts`: ReactDX alone (hook on the prototype, record, panel).
- `e2e/installed.test.ts` (`fixture:18`, both browsers): launches with no extensions (Chrome: `enableExtensions: true`, DevTools closed), loads the page, then `browser.installExtension(reactdxBuild(name))`. The toolbar title becomes "ReactDX: reload this page to check for React", DevTools (opened by CDP `Target.openDevTools` in Chrome; Firefox's toolbox is already open) shows the reload prompt, and "Reload page" brings the tree.
- `e2e/prerender.test.ts` (Chrome, `fixture:19`, DevTools closed): speculation rules prerender `/`, a click swaps it in (`activationStart > 0` proves it); the toolbar then says `ReactDX: React 19.3.1`, the agent is injected, and DevTools opened afterwards (CDP `Target.openDevTools`, then waiting for ReactDX's `devtools.html` target) lists `Counter`. Fails without the relay's prerender hold.
- `e2e/toolbar.test.ts`: toolbar title (and icon in Firefox) on a non-React page and every fixture including `prod`; leaving a React page resets it; Chrome checks a non-React page sends the service worker nothing.
- `e2e/toolbar.ts`: `toolbar(name, browser, page)`. Chrome evaluates `chrome.action.getTitle` for the active tab in the service worker (`reactdxWorker(browser)`; without the `tabs` permission a URL query matches nothing; Chrome can't read icons back). Firefox launches with `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` and sends raw WebDriver BiDi over `browser.connection` in the browser's chrome scope, reading the action's per-tab data (`browserActionFor(extension).action.getContextData(tab)`): MV3 buttons sit in the extensions panel, whose nodes are built lazily.
- `e2e/coexist.test.ts`, `e2e/preload.ts`, `e2e/rdt.ts`, `e2e/rdt.lock.json`, `e2e/rdt-update.ts`.
- Test files run one at a time (`--test-concurrency=1`): they share fixture ports.
- `--test-timeout=120000` and `--test-force-exit` (`e2e/run.ts`): `node --test` prints failure details only at the end of the run, so a hung test or a file whose browser outlives its tests would otherwise run into CI's 15-minute job timeout with no details.
- CI timing: the Chrome DevTools page can take over 10 s to appear (`launchChrome` waits 30 s), and Next's server-rendered counter appears before React hydrates, so tests that need commits wait for ReactDX's record to see a root.
- `fixtures/start.ts`: `startFixture(script, port)`, shared with the fixture smoke test. It first waits (up to 30 s) for the port to free: the previous file's server may still be stopping (`stop()` only signals), and would answer for the new one while Next moved to another port.

## Related

- `docs/extension.md`: the build under test.
- `docs/fixtures.md`: ports and test ids.
- `docs/unit-tests.md`: Vitest unit tests on React 18 and 19.
- `docs/ci.md`: the e2e matrix in CI.
