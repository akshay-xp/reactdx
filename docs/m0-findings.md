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
- Proof that the hook ran before React: React's development build prints "Download the React DevTools" only when it finds no hook while loading. All three fixtures print it without the extension and don't print it with the extension.
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
- **Verdict:** use, pinned to an exact version (`bippy@0.7.3`). Revisit after #3 (per-commit cost) and #4 (RDT coexistence). If either fails, fork the hook-install and traversal parts; MIT allows that under our GPL v3.
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
