# Hook-cost benchmark (`bench/hook-cost/`)

Per-commit cost of a page-side hook on a 10,000-component tree. Moved from `spikes/hook-cost` at `12bf178` (M0 #3); the M8 performance baseline. Playwright Chromium only.

## Command (from the repo root)

`pnpm bench:hook-cost`: installs Playwright's Chromium if missing, downloads RDT into `bench/hook-cost/rdt/` if missing (gitignored), bundles `src/hook.js` into `extension/hook.js` (gitignored), starts `fixture:18` and `fixture:19`, prints the table, stops the fixtures. Windows open during the run (about 2 minutes).

## What it measures

- Page: `fixtures/vite/bench.html` (`src/bench.jsx`): 10,000 `Cell` components. `window.__bench(mode, n)` times `n` commits with `performance.now()` around `flushSync`; `all` updates every cell, `one` updates the first.
- Per case and mode: 10 warmup commits, then 50 measured; median and nearest-rank p95 (`stats.ts`).
- Cases, each in a fresh headed persistent context with background throttling off:

| Case                 | Extension                                                         | Ready when                              |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| no hook              | none                                                              | only React Refresh's hook               |
| bare hook            | `bare/`: renderers map, `checkDCE`, no-op commit callbacks        | hook has `checkDCE`                     |
| bippy + traversal    | `extension/`: bippy 0.7.3 `instrument` + `traverseRenderedFibers` | `_isBippyHook`, and it counted a render |
| RDT, DevTools closed | RDT from the Chrome Web Store                                     | hook has `getFiberRoots`                |
| RDT, DevTools open   | same, `--auto-open-devtools-for-tabs`                             | `rendererInterfaces.size > 0`           |

## Method notes (from M0 #3)

- "No hook" isn't hook-free in Vite dev: React Refresh creates a hook, and wraps an existing devtools hook's `onCommitFiberRoot`. Read the differences between rows.
- Timer resolution is 0.1 ms (the page isn't cross-origin isolated).
- RDT registers its hook from its service worker, so the first load on a fresh profile can miss it; the runner reloads up to 5 times.
- The M0 `bare/` hook is kept as is (identical to `installHook` today) so rows match M0. M8 can add a row for the built ReactDX extension once the hook does real work.

## Baseline (M1 #16, 2026-11-11)

React 18.3.1 / 19.3.1 (development), Vite 8.3.7, Playwright 1.65.0 Chromium 158.0.8127.18, RDT 8.0.0, bippy 0.7.3, macOS 26.5, Apple M5 (10 cores).

```
React   Case                   Mode   median ms     p95 ms
18.3.1  no hook                all       13.800     15.400
18.3.1  no hook                one        2.000      2.100
18.3.1  bare hook              all       13.800     14.900
18.3.1  bare hook              one        2.000      2.200
18.3.1  bippy + traversal      all       14.900     15.700
18.3.1  bippy + traversal      one        2.300      2.500
18.3.1  RDT, DevTools closed   all       32.750     41.800
18.3.1  RDT, DevTools closed   one       20.050     35.400
18.3.1  RDT, DevTools open     all       33.750     45.000
18.3.1  RDT, DevTools open     one       21.000     25.900
19.3.1  no hook                all       15.100     17.000
19.3.1  no hook                one        2.100      2.300
19.3.1  bare hook              all       15.200     17.000
19.3.1  bare hook              one        2.100      2.300
19.3.1  bippy + traversal      all       16.100     18.000
19.3.1  bippy + traversal      one        2.400      2.700
19.3.1  RDT, DevTools closed   all       35.150     55.100
19.3.1  RDT, DevTools closed   one       20.400     32.700
19.3.1  RDT, DevTools open     all       38.400     56.200
19.3.1  RDT, DevTools open     one       21.600     26.500
```

Matches M0 #3 (`docs/m0-findings.md`) within about 0.5 ms on medians: bippy + traversal adds 0.3 ms to a one-component commit, the bare hook costs nothing measurable, RDT adds about 18 ms to every commit whether DevTools is open or not.

## Key files

- `bench/hook-cost/run.ts`: cases, measurement, table.
- `bench/hook-cost/rdt.ts`: RDT download. `bench/hook-cost/stats.ts` (+ `stats.test.ts`).
- `fixtures/start.ts`: starts the fixture servers (always from the repo root).

## Related

- `docs/m0-findings.md` (#3), `docs/fixtures.md`
