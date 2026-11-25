# M7 spike findings

Two spikes before the M7 spec (2026-11-25): what React exposes about Server Components and Suspense waits, and what on-page outlines cost. Template as in `docs/m0-findings.md`.

## Server Components and await info (spike 1)

- **Question:** on React 19 under Next 16, what can a devtools hook read about Server Components and about what a Suspense boundary waits on, while it waits and after?
- **Verdict:** go, with one limit. Server Components, their props, owners, call sites and every await (name, start, end, call site) are readable once their content arrives. While a boundary still shows its fallback, we know which Server Component it waits for and since when, but not the await inside it.
- **Setup:** a throwaway route in `fixtures/next` (deleted after): `Shop` renders three `<Suspense>`s around async Server Components `ProductDetails` (`getProduct`, 300 ms), `Reviews` (`getReviews`, 1.2 s, with a nested `<Suspense>` around `Recommendations`, `getRecommendations`, 800 ms) and a client `CartCount` that `use()`s a promise the server passed (`getCart`, 1.5 s). A minimal devtools hook (`onCommitFiberRoot`) recorded every commit, in a direct load and in a client navigation (`next/link`).
- **React version:** Next's app router runs its own React, `19.3.0-canary-278794d7-20261002` (`next/dist/compiled/react-dom`), not the fixture's `react@19.3.1`. The fields below are from that build; re-check them on each Next release.
- **Server Components (`fiber._debugInfo`):** the first host or client fiber a Server Component rendered carries a `ReactComponentInfo`: `{ name, env: "Server", key, owner: { name, env }, props, stack, debugStack, debugTask }`, between `{ time }` entries. `owner` chains Server Components (`Recommendations` → `Reviews` → `Shop`). `props` are the server-side props (`{ id: "p-12" }`). Server Components have no fibers of their own (as in M0 #4): the tree needs virtual rows built from these entries.
- **Awaits (`awaited`):** after the component info, one entry per await: `{ awaited: { name, start, end, env, owner, stack, value }, owner, stack }`. `awaited.name` is the innermost awaited function (`sleep` here; a `fetch` in real apps). The entry's own `stack` starts at the app's await site: `getReviews` then `Reviews` (frames `[name, file, line, col]` into `.next/server` chunks). Name an await by the entry's first frame. Times are on the client's `performance.now()` clock.
- **Waterfalls are measurable:** `Recommendations` awaited from 2959 to 3760 ms, starting 1 ms after `Reviews`' await ended (2958 ms). Comparing an await's `start` with the ends of the awaits above it detects a waterfall without guessing.
- **The RSC stream itself:** route-level fibers also carry `{ awaited: { name: "rsc stream", start, end, byteSize } }`: the payload's size and time per navigation (42.6 KB for this page's load, 4 KB for the shell).
- **While waiting (fallback shown):**
  - The boundary (tag 13) has `memoizedState` set, an empty `_debugInfo`, `updateQueue` null, and its promises only in `stateNode`, a `WeakSet` (as in M0 #9). The hidden Offscreen child holds just the fallback: the suspended component was never committed.
  - But `boundary.memoizedProps.children` is the unresolved RSC reference: a `react.lazy` whose `_payload` has `status: "pending"` and `_debugInfo` with the Server Component's info (name, owner, props, the `time` it started). So: "waiting on `Reviews` (server) for 1.2s" is readable live; "on `getReviews`" only once it arrives.
  - In a direct load the streamed boundaries are `dehydrated` (`memoizedState.dehydrated` set) until their HTML arrives; in a navigation they show `fallback`. Both flip to content in the commit that delivers them.
- **Server promises used on the client (`use()`):** the using fiber's `dependencies._debugThenableState.thenables` keeps each thenable, with `_debugInfo` holding the server-side await (`sleep`, owner `Shop`, start and end). React also gives client-made promises an `awaited` entry (`name`: the promise's `displayName` or `"Promise"`, end set on settle; `trackUsedThenable`).
- **What this means for the M7 designs:**
  - Server rows, server badges, props from the server, "Rendered at": available.
  - Suspense, live: the boundary, how long it has waited, and the Server Component it waits on. The await's name appears when the content arrives (the Updates feed and history have it; the live Inspector sentence says "waiting on `Reviews` (server)").
  - Waterfall grouping: available from await times.
  - Props size: estimate from the client props (JSON length); the `rsc stream` `byteSize` gives the real payload per navigation.
- **Not tested:** a non-Next RSC setup, React 18 (no RSC; M0 #9 covers its Suspense via `markComponentSuspended`), Vite client-only `use()` and `lazy()` while pending, `fetch` naming, server actions, and Firefox.

## On-page outline cost (spike 2)

- **Question:** what does keeping outlines on the page in step with it cost: reading component rectangles and moving boxes on scroll and after commits?
- **Verdict:** go, if outlines read one rectangle per component (its top host nodes, not every descendant), cap the count, and never read layout inside the commit hook.
- **Setup:** `fixture:19` `/bench.html` (10,000 cells), Chrome headless 1280×800. N components (10, 100, 1,000), each either one host node or all of its cells (10,000 nodes in total). Boxes in a fixed, closed-shadow-root overlay like `packages/page/src/overlay.ts`, moved by `transform`. Timed: one update with layout clean, one right after a commit (`__bench("one", 1)`), and 60 scroll frames updating in `requestAnimationFrame`. Long tasks observed during scrolling.
- **Evidence (ms per update, 1x CPU / 4x throttle):**

  | Components  | Read per component | Clean                      | After commit                | Scroll median | Scroll max |
  | ----------- | ------------------ | -------------------------- | --------------------------- | ------------- | ---------- |
  | 10          | one host node      | 0.1 / 0.5                  | 6.6 / 25.5                  | 0.1 / 0.0     | 0.3 / 0.3  |
  | 100         | one host node      | 0.8 / 0.4                  | 13.8 / 21.2                 | 0.4 / 0.1     | 0.6 / 0.9  |
  | 1,000       | one host node      | 3.1 / 3.7                  | 17.7 / 33.5                 | 3.0 / 1.7     | 3.9 / 11.0 |
  | 10 to 1,000 | all 10,000 nodes   | 9.4 to 10.7 / 10.6 to 11.8 | 15.3 to 18.2 / 28.4 to 34.9 | 4.5 / 10      | 5.7 / 12.5 |

- **Reading:**
  - One rectangle per component is cheap up to about 100 (under 1 ms a frame, even throttled). Reading every descendant costs 4.5 to 10 ms a frame on a large page: too much while scrolling.
  - "After commit" is mostly the page's own layout of 10,000 nodes, forced early by the read: reading in the commit hook would add that to React's commit. Measure on the next animation frame, after the browser has laid out.
  - No long tasks from scrolling at 1x; at 4x one long task per run, during the commit's forced layout, not the scroll frames.
- **Rules for M7:** a component's box is the union of its top host nodes; update on the next frame after a commit, on resize, and on scroll (a capture listener, once per frame), not in a constant loop; cap outlines (about 100) and say how many more there are. A Next page has tens of client islands and a few boundaries, well inside this.
- **Not tested:** Firefox, scroll containers other than the window, `ResizeObserver` for layout shifts without a commit, and paint cost of many overlapping boxes.
