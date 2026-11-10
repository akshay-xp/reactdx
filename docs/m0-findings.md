# M0 findings

Verdicts from the M0 experiments (milestone "M0: Prototypes and open questions"). The code lives in `spikes/`, is throwaway, and is only kept so results can be rerun.

Environment rule: React 18.3 and the latest 19.x, development builds; the latest stable Chrome and Firefox (Chrome only for page-side-only experiments); the Vite fixture by default, Next.js only for `_debugStack` and RSC.

## Template

### <Experiment> (#<issue>)
- **Question:** what this experiment answers.
- **Verdict:** go, no-go, or partial.
- **Evidence:** what was observed, with numbers where relevant.
- **Versions tested:** React, browser, and OS versions.
- **Steps to reproduce:** commands, run from `spikes/`.

## Harness (#1)

Shared setup for every experiment, in `spikes/harness/`.

| Command (from `spikes/`) | What it does |
|---|---|
| `pnpm dev:18` | Vite fixture on React 18.3.1, port 5118 |
| `pnpm dev:19` | Vite fixture on React 19.3.1, port 5119 |
| `pnpm dev:next` | Next.js 16 fixture (Server Component + client counter), port 5120 |
| `pnpm test` | Playwright smoke tests in Chromium; starts the dev servers |
| `pnpm ext:firefox` | Opens Firefox with the harness extension as a temporary add-on |

- `harness/extension/` is a bare MV3 extension: `hook.js` runs in the page's context at `document_start` on localhost. It installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` and logs `[reactdx] hook installed`, then `[reactdx] commit renderer=<id> container=<nodeName>` on every commit.
- Proof that the hook ran before React: React's development build prints "Download the React DevTools" when, at load, there's no hook or the hook lacks `checkDCE`. A real devtools hook (ours, bippy's, RDT's) has `checkDCE`. Vite's React Refresh hook, which it creates when no devtools hook exists, doesn't. All three fixtures print the message without the extension and don't print it with the extension.
- One Vite fixture serves both React versions. The Vite mode picks `react-18` or `react-19` through npm aliases, with a separate prebundle cache for each mode. A pnpm `peerDependencyRules` entry allows react-dom's `react` peer, because the alias rewrites it at runtime.
- Playwright can't load Firefox extensions, so Firefox is checked by hand.

### Firefox check
- **Verdict:** go. The extension loads as a temporary add-on, and the hook is installed before React on all three fixtures.
- **Evidence:** on each port, `[reactdx] hook installed` is the first console message, "Download the React DevTools" never appears, and `[reactdx] commit ...` follows. Localhost host access was granted to the temporary add-on with no prompt.
- **Surprise:** in Next.js dev, the page has two renderers. Renderer 1 renders into `#document` (the app). Renderer 2 renders into `NEXTJS-PORTAL`, the dev overlay, which runs its own React copy. Multiple-copy handling (and #9) has to tell app roots apart from framework tooling roots.
- **Versions tested:** Firefox 159.0.1, Chrome 156.0.8078.80 (Playwright Chromium 158 for `pnpm test`), macOS 26.5, React 18.3.1 / 19.3.1, Next.js 16.4.6, web-ext 10.8.0.
- **Steps to reproduce:** start `pnpm dev:18`, `pnpm dev:19`, `pnpm dev:next`, then by hand run `pnpm ext:firefox` and open the console on each port. Without opening a window, this prints page console messages to stdout:
  `pnpm exec web-ext run --source-dir harness/extension --firefox /Applications/Firefox.app/Contents/MacOS/firefox --start-url http://localhost:5118 --verbose --no-reload --arg=--headless --pref devtools.console.stdout.content=true`

## bippy (#2)
- **Question:** should ReactDX build on bippy, fork parts of it, or replace it?
- **Verdict (final, after #3 and #4):** fork parts. Don't depend on the `bippy` package. Vendor the fiber helpers we use (`traverseRenderedFibers`, `isCompositeFiber`, `getDisplayName`, renderer access) from bippy's source into ReactDX, with MIT attribution. Write our own hook install (see #4).
  - **Why:** #3 passed, since the tree walk is cheap. #4 failed for bippy's hook install: with both installed, it stops RDT from attaching. And bippy's main entry installs that hook as a side effect of being imported (`index.ts` does `import "./install-hook-only"`). The helpers live in `dist/core.js`, which has no unconditional install but only exports minified names (`x`, `m`, `i` in 0.7.3). So depending on the package means either the RDT conflict or imports that break on every release.
  - **Worth trying upstream:** a side-effect-free entry point in bippy (for example `bippy/core` with named exports). If that lands, depending on bippy becomes an option again.
- **Original verdict (#2):** use, pinned to `bippy@0.7.3`, and revisit after #3 and #4.
- **Evidence:**
  - **Maintenance:** last push 2026-11-04, with commits every month in 2026 (7 to 33 a month). aidenybai wrote 610 of about 627 commits, so it has one maintainer. It's pre-1.0 (0.7.x), so breaking changes are possible. 1.4k stars, 38 open issues.
  - **Hook install:** `instrument({ onActive, onCommitFiberRoot })` connects before React on React 18.3, React 19.3, and Next.js, in Chromium and Firefox. The "Download the React DevTools" message never appears.
  - **Coexistence (code review only; #4 tests it):** if a hook already exists, bippy patches it in place. If not, it installs its own hook behind a getter/setter, so a hook assigned later (such as RDT's) gets its renderers merged in instead of replacing bippy's. `isRealReactDevtools` detects RDT through `getFiberRoots`.
  - **Traversal:** `traverseRenderedFibers` plus `isCompositeFiber` and `getDisplayName` list the components rendered in each commit, including update renders. A mutation check confirmed the test catches broken update traversal.
  - **Diffing:** not provided. There are no helpers for comparing props, state, or context. We write that ourselves, which is fine, since it's our core DX logic anyway.
  - **Editing:** `getRenderer(fiber).overrideHookState(fiber, 0, [], 5)` changes the counter to `Count: 5` on all three fixtures, in Chromium (Playwright test) and in Firefox's engine (Playwright Firefox with the bundled hook loaded as an init script). The renderer type also exposes `overrideProps`, `overrideContext`, `scheduleUpdate`, `setSuspenseHandler`, and `setErrorHandler`.
  - **Overhead:** the bundled hook is 24,677 B minified and 8,188 B gzipped, compared with 378 B / 283 B for our hand-written harness hook. Importing four functions still pulls in most of bippy's core. That's acceptable for a page script, but worth trimming if we fork. Per-commit cost is measured in #3.
- **Side findings, for #9 and M7:**
  - In Next.js, the Server Components (`Page`, `RootLayout`) **don't appear as fibers**. The client tree only has the client components plus about 50 Next.js framework components (`AppRouter`, `LayoutRouter`, the error and redirect boundaries, `SegmentViewNode` ...).
  - The dev overlay renderer's components have minified names (`b`, `l_`, `eY`). The tree view will need filtering for framework internals and tooling roots.
- **Versions tested:** bippy 0.7.3, React 18.3.1 / 19.3.1, Next.js 16.4.6, Playwright Chromium 158 and Firefox 159.0, Firefox 159.0.1 (web-ext), macOS 26.5.
- **Steps to reproduce (from `spikes/`):**
  - `pnpm exec playwright test bippy`: the global setup bundles `bippy/src/hook.js` into `bippy/extension/hook.js`.
  - Firefox extension run: the headless `web-ext run` command from the Harness section, with `--source-dir bippy/extension`.
  - Firefox editing: launch Playwright `firefox`, call `page.addInitScript({ path: 'bippy/extension/hook.js' })`, open each port, run `window.__reactdxBippyEdit(5)`, and expect `Count: 5`.
  - Size: `pnpm exec esbuild bippy/src/hook.js --bundle --format=iife --minify | gzip -9c | wc -c`

## Per-commit hook cost (#3)
- **Question:** does connecting to React and walking the rendered tree on every commit keep page-side cost small on a ~10k component tree?
- **Verdict:** go. bippy plus a traversal walk adds **0.3 ms** to the median of a one-component commit (2.0 to 2.3 ms on React 18.3, 2.1 to 2.4 ms on React 19.3), which is under the 1 ms rule. For a commit that re-renders all 10k components it adds about 1 ms (6 to 9%). A bare connected hook costs nothing measurable.
- **Evidence:** second run of `pnpm bench:hook-cost`; the first run agreed within about 0.5 ms on medians. 50 measured commits after 10 warmup, per row:
  ```
  React   Case                   Mode   median ms     p95 ms
  18.3.1  no hook                all       13.850     14.900
  18.3.1  no hook                one        2.000      2.100
  18.3.1  bare hook              all       13.900     15.000
  18.3.1  bare hook              one        2.000      2.100
  18.3.1  bippy + traversal      all       14.700     16.100
  18.3.1  bippy + traversal      one        2.300      2.500
  18.3.1  RDT, DevTools closed   all       33.100     40.700
  18.3.1  RDT, DevTools closed   one       20.200     36.200
  18.3.1  RDT, DevTools open     all       34.000     47.800
  18.3.1  RDT, DevTools open     one       21.000     42.400
  19.3.1  no hook                all       15.000     16.600
  19.3.1  no hook                one        2.100      2.200
  19.3.1  bare hook              all       15.050     16.700
  19.3.1  bare hook              one        2.100      2.300
  19.3.1  bippy + traversal      all       16.300     17.900
  19.3.1  bippy + traversal      one        2.400      2.700
  19.3.1  RDT, DevTools closed   all       35.300     52.100
  19.3.1  RDT, DevTools closed   one       20.650     38.700
  19.3.1  RDT, DevTools open     all       38.500     51.900
  19.3.1  RDT, DevTools open     one       21.700     35.200
  ```
  - **RDT adds about 18 to 19 ms to every commit**, even one that re-renders a single component (2.0 to 20.2 ms), and its p95 reaches about twice its own median (for example 20.2 vs 36.2 ms), so commits also become less predictable. That's 10x a one-component commit on a 10k tree.
  - **RDT's cost doesn't depend on DevTools being open.** RDT 8.0.0 loads its backend (`hook.rendererInterfaces.size === 1`) with DevTools closed. That corrects the plan's reading of its code: `inject-backend-manager` isn't sent only from the devtools page. Having RDT installed costs the same as having it open.
  - **bippy's extra 0.3 ms on one-component commits** suggests the walk does some work in proportion to tree size, not only for what rendered. It's small, but worth watching once our traversal does real work (diffing, serializing).
- **Method notes:**
  - "No hook" isn't hook-free in Vite dev: `@react-refresh` creates its own hook, and when a devtools hook exists it wraps that hook's `onCommitFiberRoot`. Its cost is in every row, so the differences between rows are what to read.
  - Timing is `performance.now()` around `flushSync`, which includes the synchronous `onCommitFiberRoot` call. Resolution is 0.1 ms, because the page isn't cross-origin isolated.
  - Every case runs in a headed window with background throttling disabled, so the DevTools-open case (which needs a window) is comparable to the rest.
  - The runner checks each hook's identity before measuring: React Refresh only, bare, `_isBippyHook`, or RDT (`getFiberRoots`, with `rendererInterfaces` populated for the DevTools-open case). RDT registers its hook from its service worker, so the first load on a fresh profile can miss it; the runner reloads up to 5 times.
- **Versions tested:** React 18.3.1 / 19.3.1 (development builds), Vite 8.3.7, Playwright Chromium 158.0.8127.18, RDT 8.0.0 (Chrome Web Store), bippy 0.7.3, macOS 26.5, Apple M5 (10 cores).
- **Steps to reproduce (from `spikes/`):** start `pnpm dev:18` and `pnpm dev:19`, then run `pnpm bench:hook-cost`. The first run downloads RDT into `hook-cost/rdt/` (gitignored). Windows open during the run.

## Sharing the hook with RDT (#4)
- **Question:** can ReactDX's hook and RDT's hook both receive commits, whichever installs first, in Chrome and Firefox?
- **Verdict:** go, with our own installer. bippy's install breaks RDT.
- **Root cause of the conflict:** RDT 8.0.0's `installHook.js` checks `window.hasOwnProperty('__REACT_DEVTOOLS_GLOBAL_HOOK__')` twice: once as an outer guard and once inside its installer. If either is `true`, it doesn't install, and it then calls `.on('renderer', ...)` on whatever hook is there. bippy defines its hook as `window`'s own property and overrides `hasOwnProperty` to answer `false` once, which only gets past the first check. RDT's backend never attaches (`rendererInterfaces` is `undefined`), while bippy keeps working.
- **Approach (`spikes/coexist/src/install.js`):**
  - **If a hook is already `window`'s own property** (RDT got there first): wrap its `onCommitFiberRoot` in place (`attachTo`).
  - **Otherwise:** put our hook on `Window.prototype` as a configurable getter. React reads the global through the prototype chain and finds ours. RDT's `hasOwnProperty` checks don't see it, so RDT installs normally on `window` and shadows ours. A wrapper around `Object.defineProperty` notices when that happens and calls `attachTo` on RDT's hook, before React connects.
  - Either way, React connects to exactly one hook, and our listener runs after the original `onCommitFiberRoot`.
- **Evidence:**

  | Order | Chromium 158 (Playwright) | Firefox 159.0.1 (web-ext) |
  |---|---|---|
  | RDT alone (control) | RDT attaches | not run (covered by the rows below) |
  | bippy + RDT | **RDT broken**, bippy works | not run |
  | Ours alone | works, installed before React | not run (only the simpler #1 harness hook was tested alone) |
  | Ours first + RDT | both work | both work |
  | RDT first + ours | both work, `renderersAtInstall === 0` | both work |

  - **Chromium:** 0 failures in 220 runs of the coexist tests (`--repeat-each 20 --workers 6`) on React 18.3, 19.3, and Next.js.
  - **"RDT works" means** `hook.rendererInterfaces.size > 0` and `getFiberRoots(id).size > 0`. **"Ours works" means** our `rendered Counter` count goes up after a click.
- **Side findings:**
  - **RDT's own startup race:** RDT registers its hook script from its service worker, so a page load can miss it. Under parallel load, this failed 3 of 30 times even with RDT alone. A reliable signal that RDT's script ran is its `react-devtools-hook-installer` handshake message, which it posts even when it later bails. The tests reload until that message appears.
  - **Chrome's order:** our static `document_start` content script always runs before RDT's runtime-registered one, whatever the `--load-extension` order. So "ours first" is the real-world order in Chrome, and "RDT first" needs a test-only delay (`coexist/src/late.js`).
- **Risks to handle in M2:**
  - The `Object.defineProperty` wrapper is visible to the page and stays in place forever. It should restore itself once React has connected, or after the first hook attaches.
  - A hook defined by plain assignment (not `defineProperty`) on `window` won't be noticed. RDT 8 uses `defineProperty`, so this only matters for other tools.
  - If RDT installs after React has connected, for example when it's enabled with the page already open, nothing reaches RDT until a reload. That's RDT's normal behavior anyway.
- **Versions tested:** RDT 8.0.0 (Chrome Web Store and AMO), bippy 0.7.3, React 18.3.1 / 19.3.1, Next.js 16.4.6, Playwright Chromium 158.0.8127.18, Firefox 159.0.1, macOS 26.5.
- **Steps to reproduce (from `spikes/`):** `pnpm exec playwright test coexist`. The global setup downloads RDT and bundles `coexist/src/first.js` and `coexist/src/late.js`. Firefox: see below.

### Firefox check
- **Result:** both orders work. RDT's backend attaches with fiber roots, and ReactDX receives commits on all three fixtures.
- **Evidence:** the raw status lines, logged on `load` + 1 s:
  ```
  ours first, port 5118: order=first rdtAttached=true rdtRoots=1 commits=1
  ours first, port 5119: order=first rdtAttached=true rdtRoots=1 commits=1
  ours first, port 5120: order=first rdtAttached=true rdtRoots=2 commits=11
  RDT first, port 5118:  order=late  rdtAttached=true rdtRoots=1 commits=1
  RDT first, port 5119:  order=late  rdtAttached=true rdtRoots=1 commits=1
  RDT first, port 5120:  order=late  rdtAttached=true rdtRoots=2 commits=10
  ```
  `commits >= 1` on the Vite ports means we attached before React's first commit. Next.js has 2 roots (app + dev overlay) and more commits.
- **Firefox timing differs from Chrome:** RDT's hook script runs after a `setTimeout(0)` scheduled from our `document_start` script, so a single-tick delay still left ours first. The test-only "RDT first" variant (`coexist/src/late.js`) therefore polls until RDT's hook is on `window` (every 10 ms, up to about 2 s) before installing.
- **Versions tested:** Firefox 159.0.1 (headless), RDT 8.0.0 for Firefox (MV3, `@react-devtools`, from AMO), macOS 26.5.
- **Steps to reproduce (from `spikes/`):**
  1. Download `https://addons.mozilla.org/firefox/downloads/latest/react-devtools/latest.xpi` to `coexist/rdt-firefox/rdt.xpi` (gitignored).
  2. Make a profile folder with `extensions/@react-devtools.xpi` (a copy of that file) and a `user.js` with `user_pref("extensions.autoDisableScopes", 0);` and `user_pref("extensions.enabledScopes", 15);`.
  3. Bundle the hooks (`pnpm exec playwright test coexist` runs the global setup) and start the three dev servers.
  4. Run `pnpm exec web-ext run --source-dir coexist/extension --firefox /Applications/Firefox.app/Contents/MacOS/firefox --firefox-profile <profile> --start-url http://localhost:<port> --verbose --no-reload --arg=--headless --pref devtools.console.stdout.content=true`, then the same with `coexist/extension-late`.
  5. Read the `[reactdx:coexist] status` line.

## Injection timing (#5)
- **Question:** does a MAIN world content script at `document_start` install the hook before React, for a normal load, a hard reload, a bfcache restore, and a script registered with `scripting.registerContentScripts`?
- **Verdict:** go for **static `content_scripts`**: before React in every tested scenario on both browsers. **Partial for registered scripts:** before React once the registration has settled, but **flaky on the first load after a browser restart in Chromium** (55 to 75% missed).
- **Signal:** React only calls `inject` on a hook that exists when it loads. `injected === 1` means before React. A random `loadId` set at install tells a fresh load from a bfcache restore.
- **Results:**

  | Scenario | Chromium 158 | Firefox 159.0.1 |
  |---|---|---|
  | Normal load (static) | before | before |
  | Hard reload (static; CDP `ignoreCache` / `location.reload(true)`) | before | before |
  | bfcache restore (static) | same hook kept, still gets commits | same hook kept, still gets commits (preview only) |
  | Registered, after the registration has settled | before | before |
  | Registered, after a browser restart (registration persisted) | before, once restored | not tested (web-ext) |
  | Registered, **first load right after install** | **missed 20/20** | before (web-ext waits for install) |
  | Registered, **first load right after restart** | **flaky: missed 11/20 and 15/20** | not tested |
  | Static, first load right after install / restart | before 20/20 / 20/20 | not measured |

  `pnpm timing:race`, two runs:
  ```
  static     first load after install  before React 20/20, after React 0/20, missed 0/20
  static     first load after restart  before React 20/20, after React 0/20, missed 0/20
  registered first load after install  before React 0/20, after React 0/20, missed 20/20
  registered first load after restart  before React 9/20, after React 0/20, missed 11/20
  ```
  ```
  static     first load after install  before React 20/20, after React 0/20, missed 0/20
  static     first load after restart  before React 20/20, after React 0/20, missed 0/20
  registered first load after install  before React 0/20, after React 0/20, missed 20/20
  registered first load after restart  before React 5/20, after React 0/20, missed 15/20
  ```
- **What a miss looks like:** always "no hook at all", never a late hook. A static or registered script either runs before React or doesn't run for that load.
- **bfcache:** content scripts don't re-run on a restore and don't need to. The cached page keeps the same hook object, still connected, and still receiving commits. Chromium 158 bfcaches even the Vite dev-server page (HMR WebSocket open); Firefox doesn't, and does a full reload instead, which is also before React.
- **What this means for M2 (permissions):**
  - Localhost uses a **static** `content_scripts` entry: reliable everywhere.
  - Per-site opt-in through `registerContentScripts` is fine right after the user enables a site, since the page is reloaded anyway. But **after a browser restart, the first page on that site misses the hook more than half the time in Chromium.** M2 needs to detect "React present but our hook missing" and offer "reload to connect", or else put opted-in sites in static `content_scripts` with Chrome's site-access controls.
  - **Decided (2026-11-10):** a static `content_scripts` entry on all sites, the same install warning as RDT. A reload prompt is DX friction we won't ship, and all-site access leaves room for production-build support. See `docs/overview.md`.
- **Test gotchas:**
  - Playwright launches Chromium with `--disable-back-forward-cache`; the `bfcache` fixture option removes it.
  - `page.goBack()` hangs on a bfcache restore unless it's given `waitUntil: 'commit'`, because no `load` event fires.
  - Firefox MV3 needs `background.scripts`, as it has no `service_worker`.
- **Versions tested:** React 18.3.1 / 19.3.1 (dev builds), Vite 8.3.7, Playwright Chromium 158.0.8127.18, Firefox 159.0.1, macOS 26.5.
- **Steps to reproduce (from `spikes/`):** `pnpm exec playwright test timing` (starts the dev and preview servers); start `pnpm dev:18`, then run `pnpm timing:race`; Firefox: see below.

### Firefox check
- **Result:**
  - **Normal load and hard reload:** before React, on both the preview (5128) and the dev server (5118), for both the static and the registered variant.
  - **bfcache restore:** works on the preview; the dev server is never bfcached in Firefox.
- **Evidence:** raw output from `web-ext run` on `/?sequence`. The page goes through a normal load, then `location.reload(true)` (Firefox's force reload), then `/other.html?back`, which calls `history.back()`, then a click on the restored page. Each `status` line is printed 500 ms after a `pageshow`.
  - static, preview 5128:
    ```
    [reactdx:timing] step=normal-load
    [reactdx:timing] status loadId=tied3m1dsm injected=1 commits=1 persisted=false
    [reactdx:timing] step=hard-reload
    [reactdx:timing] status loadId=hb0eqc6c3c injected=1 commits=1 persisted=false
    [reactdx:timing] status loadId=aastscfq8h injected=0 commits=0 persisted=false
    [reactdx:timing] step=bfcache-restore
    [reactdx:timing] status loadId=hb0eqc6c3c injected=1 commits=2 persisted=true
    ```
  - static, dev server 5118:
    ```
    [reactdx:timing] step=normal-load
    [reactdx:timing] status loadId=qdsfie6u83r injected=1 commits=1 persisted=false
    [reactdx:timing] step=hard-reload
    [reactdx:timing] status loadId=jbjxwucdi7 injected=1 commits=1 persisted=false
    [reactdx:timing] step=back
    [reactdx:timing] step=back-without-bfcache
    [reactdx:timing] status loadId=a5x8wukx2dk injected=1 commits=1 persisted=false
    ```
  - registered, preview 5128:
    ```
    [reactdx:timing] step=normal-load
    [reactdx:timing] status loadId=avfxoh0l0e injected=1 commits=1 persisted=false
    [reactdx:timing] step=hard-reload
    [reactdx:timing] status loadId=rldiosb5zog injected=1 commits=1 persisted=false
    [reactdx:timing] status loadId=rlwfsy5g0n injected=0 commits=0 persisted=false
    [reactdx:timing] step=bfcache-restore
    [reactdx:timing] status loadId=rldiosb5zog injected=1 commits=2 persisted=true
    ```
  - registered, dev server 5118:
    ```
    [reactdx:timing] step=normal-load
    [reactdx:timing] status loadId=nat0oxqgdip injected=1 commits=1 persisted=false
    [reactdx:timing] step=hard-reload
    [reactdx:timing] status loadId=ylnpwddsios injected=1 commits=1 persisted=false
    [reactdx:timing] step=back
    [reactdx:timing] step=back-without-bfcache
    [reactdx:timing] status loadId=6nwm9yplmy6 injected=1 commits=1 persisted=false
    ```
- **Reading it:**
  - The `injected=0 commits=0` line is `other.html`, which has no React.
  - On the preview, the bfcache restore brings back the **same `loadId`** as the page before leaving, and the click adds a commit (`commits=2`).
  - On the dev server, going back is a full reload (`persisted=false`, new `loadId`). Firefox won't bfcache a page with Vite's HMR WebSocket open; Chromium does (see the results above).
- **Limits:**
  - The registered variant's first load counted as before React here. But web-ext only opens the start URL once the temporary add-on has finished installing, so this isn't the "navigate immediately after install" race that `pnpm timing:race` measures in Chromium.
  - The first load after a Firefox restart wasn't tested, because web-ext removes temporary add-ons on exit.
- **Versions tested:** Firefox 159.0.1 (headless), macOS 26.5, React 18.3.1 (dev build in preview, dev server).
- **Steps to reproduce (from `spikes/`):** start `pnpm dev:18` and `pnpm preview:18`, then run `pnpm exec web-ext run --source-dir injection-timing/<static|registered> --firefox /Applications/Firefox.app/Contents/MacOS/firefox --start-url "http://localhost:<5128|5118>/?sequence" --verbose --no-reload --arg=--headless --pref devtools.console.stdout.content=true`. The global setup (or `copyTimingHook()`) must have copied `hook.js` into both variant folders first.

## inspectedWindow.reload injectedScript (#6)
- **Question:** can ReactDX get its hook in before React with **no host permissions**, using `devtools.inspectedWindow.reload({ injectedScript })`, and what happens on a full navigation?
- **Verdict:**
  - **No-go as the default.** It works mechanically on both browsers, but the DX costs below are worse than the all-sites install warning we chose (see #5).
  - **Possible later** as an opt-in "no site access" mode for users who refuse that warning. It's not v1 scope.
- **Mechanism (`spikes/injected-script/extension/`):** the manifest has only a `devtools_page`. On load and on each `devtools.network.onNavigated`, the DevTools page checks with `inspectedWindow.eval` whether the hook is present. If it isn't, it calls `inspectedWindow.reload({ injectedScript: hook source })`. The injected script runs before the page's own scripts.
- **Results:**

  | | Chromium 158 | Firefox 159.0.1 |
  |---|---|---|
  | Hook before React after the injected reload | yes (`injected === 1`) | yes |
  | After a full navigation | hook gone; reconnecting takes exactly 1 extra load (5/5 runs) | same |
  | Needs DevTools open | yes (`devtools_page` only runs then) | yes |

- **DX costs:**
  - **Opening DevTools reloads the page.** The app's current state is lost at exactly the moment the developer wants to inspect it.
  - **Every full navigation loads twice.** That means double requests and double side effects, and a navigation that came from a POST may be re-submitted. SPA navigations aren't affected.
  - **Nothing works while DevTools is closed,** so there's no toolbar "React detected" state, unlike a content script.
- **Trap found:**
  - Our own injected reload fires `onNavigated`, and `inspectedWindow.eval` at that moment reports no hook. Re-checking there reloaded in a loop: about 115 reloads in under 3 s.
  - The fix is to skip the navigation we caused. Any future use of this API needs the same guard.
- **Versions tested:** Playwright Chromium 158.0.8127.18 (headed, `--auto-open-devtools-for-tabs`), Firefox 159.0.1 (headed), React 18.3.1 / 19.3.1 dev servers, macOS 26.5.
- **Steps to reproduce (from `spikes/`):** `pnpm exec playwright test injected` (opens browser windows); Firefox: see below.

### Firefox check
- **Result:** works the same as Chromium. With no host permissions, the injected reload installs the hook before React. Every full navigation arrives without the hook and costs one extra load to reconnect.
- **Evidence:** start URL `http://localhost:5118/?go=5119`. The fixture redirects to 5119 two seconds after load, which gives a full navigation. Real extension, page console via `devtools.console.stdout.content`:
  ```
  console.info: "%cDownload the React DevTools ... (5118, first load: no hook)
  console.log: "[reactdx:timing] status loadId=cc8hu1fpijf injected=1 commits=1 persisted=false   (5118 after injected reload)
  console.info: "%cDownload the React DevTools ... (5119 after full navigation: no hook)
  console.log: "[reactdx:timing] status loadId=oi8osoiynyq injected=1 commits=1 persisted=false   (5119 after injected reload)
  ```
  An instrumented copy of the DevTools page (logging into the page through `inspectedWindow.eval`) confirmed the sequence: `connect hasHook=false`, then `reloading with injectedScript`, then `onNavigated`, then `skip own reload`.
- **Setup gotchas:**
  - web-ext's `--devtools` opens DevTools for the **add-on**, not the page, so the `devtools_page` never loads. Firefox's own `-devtools` flag (`--arg=-devtools`) opens the page's toolbox.
  - DevTools doesn't open in headless Firefox (`TypeError: can't access property "setDebugTargetData", this.component is undefined`), so this check runs headed.
- **Versions tested:** Firefox 159.0.1 (headed), React 18.3.1 / 19.3.1 dev servers, macOS 26.5.
- **Steps to reproduce (from `spikes/`):** start `pnpm dev:18` and `pnpm dev:19`; copy the hook in (the global setup or `copyTimingHook()`); then run `pnpm exec web-ext run --source-dir injected-script/extension --firefox /Applications/Firefox.app/Contents/MacOS/firefox --arg=-devtools --start-url "http://localhost:5118/?go=5119" --verbose --no-reload --pref devtools.console.stdout.content=true`.

## Value format for the panel (#7)
- **Question:** what format should props, state, and hook values travel to the panel in, so that large, cyclic, or exotic values stay fast and lossless and are loaded only when the user expands them?
- **Verdict:** go. Carry `spikes/value-format/serialize.ts` into M4 as the starting point, with the gaps below fixed.
- **Constraints:**
  - **JSON-safe output.** Extension messaging is JSON, which turns `NaN`, `Infinity`, and `-0` into `null` and drops `undefined` and `bigint`. Every descriptor survives `JSON.parse(JSON.stringify(x))` unchanged (tested).
  - **No app code runs while inspecting.** Properties are read through `Object.getOwnPropertyDescriptors`, and accessors are reported as `getter`, never called (tested with a throwing getter).
- **Protocol:**
  - `createInspector()` returns `{ serialize(value), expand(id, offset = 0) }`.
  - It keeps every object it has described in a `WeakMap` (object to id) and a `Map` (id to object). The same object always gets the same id.
  - Anything deeper than the depth limit comes back as `ref`, and `expand(id)` serializes it as a new root. A collection with more than one page has `nextOffset`, and `expand(id, nextOffset)` returns the next page.
- **Descriptors:**

  | Value | Descriptor |
  |---|---|
  | JSON-safe primitive (finite number except `-0`, string ≤ 1,000 chars, boolean, `null`) | the value itself |
  | `undefined` | `{ type: 'undefined' }` |
  | `NaN`, `±Infinity`, `-0` | `{ type: 'number', value: 'NaN' }` and so on |
  | `bigint` | `{ type: 'bigint', value: '10' }` |
  | long string | `{ type: 'string', preview: <first 1,000>, length }` |
  | function | `{ type: 'function', name }` |
  | symbol | `{ type: 'symbol', description }` |
  | object / class instance | `{ type: 'object', className, id, size, props }` (`className: null` for a null prototype) |
  | accessor property | `{ type: 'getter' }` |
  | array | `{ type: 'array', id, length, items, nextOffset? }` |
  | `Map` | `{ type: 'map', id, size, entries: [[key, value]], nextOffset? }` |
  | `Set` | `{ type: 'set', id, size, values, nextOffset? }` |
  | past the depth limit | `{ type: 'ref', id, preview: { type, className/size/length } }` |
  | cycle | `{ type: 'ref', id: <ancestor id>, circular: true }` |
  | React element (18 `react.element`, 19 `react.transitional.element`) | `{ type: 'react-element', name, key }` |
  | `Date` / `RegExp` / `Error` / `Promise` | `{ type: 'date', iso }` / `{ type: 'regexp', source, flags }` / `{ type: 'error', name, message }` / `{ type: 'promise' }` |
  | DOM `Element` / other `Node` | `{ type: 'element', tag, id, className }` / `{ type: 'node', nodeName }` |

- **Limits:**
  - **`MAX_DEPTH = 2`:** a component's props plus one level inside each prop arrive at once, which is what an inspector shows before the user clicks. Anything deeper is one `expand` away.
  - **`PAGE = 100`:** collection entries per message. Pages are taken by iterating, so a 10k Map isn't copied to send 100 entries.
  - **`MAX_STRING = 1000`:** characters of a string preview. The full length is always reported.
- **Measurements (Node 24.14.1, Apple M5, median of 50):**
  - first page of a 10k-object array: 9,139 B of JSON, 0.056 ms;
  - first page of a 10k-entry Map: 9,627 B, 0.053 ms;
  - an object nested 50 levels deep: 223 B, 0.002 ms;
  - `{ ref: { current: <button> } }` in Chromium: under 1 KB, under 5 ms (asserted).
- **Gaps to fix in M4:**
  - **Typed arrays and other huge non-plain objects:** a `Uint8Array(1_000_000)` is read as an object with a million own properties, which is slow. It needs its own paged descriptor, and `ArrayBuffer`, `DataView`, `WeakMap`, and `WeakSet` need summaries.
  - **Proxies can't be detected.** Reading `$$typeof` and own-property descriptors runs `get`, `ownKeys`, and `getOwnPropertyDescriptor` traps.
  - **Memory:** the id-to-object `Map` holds strong references to everything ever described. It needs a `release()` when the panel moves to another component or commit.
  - **Dropped details:** symbol-keyed properties and extra (non-index) properties on arrays are dropped. Sparse array holes show as `undefined`.
- **Steps to reproduce (from `spikes/`):** `pnpm exec playwright test serialize`. The DOM test bundles `serialize.ts` in memory with esbuild and runs it in Chromium.
