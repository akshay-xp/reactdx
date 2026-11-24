# Hook-cost benchmark (`bench/hook-cost/`)

Per-commit cost of a page-side hook on a 10,000-component tree, and page memory (below). Moved from `spikes/hook-cost` at `12bf178` (M0 #3); the M8 performance baseline. Playwright Chromium only.

## Command (from the repo root)

`pnpm bench:hook-cost`: installs Playwright's Chromium if missing, gets the locked RDT from `ensureRdt("chrome")` (`e2e/rdt.ts`, cached in `e2e/.rdt/`; `docs/e2e.md`), bundles `src/hook.js` into `extension/hook.js` (gitignored), starts `fixture:18` and `fixture:19`, prints the table, stops the fixtures. Windows open during the run (about 2 minutes).

## What it measures

- Page: `fixtures/vite/bench.html` (`src/bench.jsx`): 10,000 `Cell` components (under a `Bench` component since M3 #26). `window.__bench(mode, n)` times `n` commits with `performance.now()` around `flushSync`; `all` updates every cell, `one` updates the first.
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

## Page memory (`pnpm bench:memory`, `memory.ts`; M6 #71, 2026-11-24)

Builds the Chrome extension, then per React version and case, in a fresh headed context (`withBench`, `browser.ts`, shared with `run.ts`): the bench page, 10 warm-up commits of all cells, the page renderer's heap (`Runtime.getHeapUsage` after two `HeapProfiler.collectGarbage`), 50 more commits of all cells, the heap again. The page's heap only: RDT's frontend store and ReactDX's panel live in DevTools. About 5 minutes.

| Case                    | Setup                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| no devtools             | none                                                                                                    |
| RDT, DevTools closed    | RDT                                                                                                     |
| RDT, DevTools open      | RDT, `--auto-open-devtools-for-tabs`                                                                    |
| RDT, Profiler recording | same, then `startProfiling(true, false)` on each renderer interface (the record button with "why" on)   |
| ReactDX, panel closed   | the built extension (`apps/extension/.output/chrome-mv3`)                                               |
| ReactDX, panel open     | same, then the relay's `watch` posted on the page, as an open panel does: the tree and the recorder run |

```
React   Case                        loaded MB     after MB    growth MB
18.3.1  no devtools                      17.1         17.1          0.0
18.3.1  RDT, DevTools closed             22.4         22.8          0.4
18.3.1  RDT, DevTools open               21.9         21.0         -1.0
18.3.1  RDT, Profiler recording          46.5        163.3        116.7   (60 commits profiled)
18.3.1  ReactDX, panel closed            17.4         17.4          0.0
18.3.1  ReactDX, panel open              25.5         25.8          0.3   (4 commits recorded)
19.3.1  no devtools                      19.6         19.8          0.2
19.3.1  RDT, DevTools closed             25.1         25.5          0.4
19.3.1  RDT, DevTools open               24.8         23.6         -1.2
19.3.1  RDT, Profiler recording          49.4        165.9        116.5   (60 commits profiled)
19.3.1  ReactDX, panel closed            20.0         20.3          0.2
19.3.1  ReactDX, panel open              28.2         28.6          0.4   (4 commits recorded)
```

- Defaults against defaults: RDT with DevTools open (not profiling) costs about 4 to 5 MB of page heap; ReactDX with the panel open (recording) about 8 MB, reached during the warm-up and flat after (the record budget). RDT's Profiler grows about 2.3 MB per commit of 10,000 components, unbounded (an earlier 200-commit run reached 517 MB).
- "4 commits recorded" is the budget at work: a commit of 10,001 renders leaves room for one, so the panel is sent the newest only.

## Recording memory (M6 #71, 2026-11-24)

A scratch vitest file (not kept; jsdom, `NODE_OPTIONS=--expose-gc`, `--pool=forks`): 10,000 `Cell`s with a state hook and an effect on `tick`, 200 commits that render all of them, each walked by `tree.commit` like the agent's, heap after `gc()` with the recorder alive.

```
React  Recording                               Heap     Buffered records
19     none (tree only)                        102 MB   0
19     before #71 (100 commits, no record cap) 1113 MB  1,000,100
19     #71 (20,000 records, 1,000 commits)     119 MB   10,001 (1 commit) + 10,001 latest
18     none (tree only)                        101 MB   0
18     before #71                              1112 MB  1,000,100
18     #71                                     111 MB   10,001 + 10,001 latest
```

Recording now costs 10 to 17 MB over the tree alone, from about 1 GB. A record costs about 1 KB here (props, a state hook and an effect with deps); about 350 to 420 bytes with plain props.

## Key files

- `bench/hook-cost/run.ts`: cases, measurement, table.
- `e2e/rdt.ts`: the locked RDT download. `bench/hook-cost/stats.ts` (+ `stats.test.ts`).
- `fixtures/start.ts`: starts the fixture servers (always from the repo root).

## Related

- `docs/m0-findings.md` (#3), `docs/fixtures.md`
