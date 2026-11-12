# Fixtures (`fixtures/`)

Test apps for every supported React setup. Each is a workspace package, so React is a dependency of fixtures only (enforced by `fixtures/fixtures.test.ts`).

## Commands (from the repo root)

| Command              | Port | App                                                                                             |
| -------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `pnpm fixture:18`    | 5218 | `fixtures/vite` on React 18.3.1                                                                 |
| `pnpm fixture:19`    | 5219 | `fixtures/vite` on React 19.3.1                                                                 |
| `pnpm fixture:next`  | 5220 | `fixtures/next`: Next 16.4.6 (Turbopack dev), React 19.3.1                                      |
| `pnpm fixture:multi` | 5221 | `fixtures/multi`: a React 18.3.1 root and a React 19.3.1 root on one page                       |
| `pnpm fixture:prod`  | 5222 | `fixtures/vite` production build (`vite build --mode 19`, then `vite preview`), React 19.3.1    |
| `pnpm test:fixtures` |      | Smoke test: starts each fixture, checks it in headless Chrome (Puppeteer 25.17.0, no extension) |

All but `fixture:prod` are development builds. `fixture:prod` builds into `fixtures/vite/dist-prod/` (gitignored); its smoke test checks React registers `bundleType` 0.

- `fixture:next`'s browser React is the canary Next bundles for the App Router (`19.3.0-canary-278794d7-20261002` with Next 16.4.6), not the app's react-dom 19.3.1. The page's `react-version` shows it too.

## Test ids (used by e2e)

- Every root renders `data-testid="react-version"` (text: `React.version`) and `data-testid="counter"` (text `Count: N`, +1 per click).
- On `fixtures/vite` and `fixtures/next`, `Counter` takes a `label` prop (`"Count"`, from `App` and `app/page.jsx`) and renders `{label}: {count}`, so the inspector e2e has a prop to show and a button whose `children` change on a click.
- `fixtures/next` also renders `data-testid="server"` from the Server Component (`app/page.jsx`); the counter and version come from the client component (`app/Counter.jsx`).
- `fixtures/multi` puts each root in `data-testid="root-18"` or `data-testid="root-19"`.

## Clicked

Every fixture's `Counter` renders a `Clicked` component (which renders nothing) on odd counts, so a click adds or removes one tree row without changing the page's text. The panel and reconnect e2e use it to prove the tree is live.

## Tree page

`fixtures/vite` also serves `/tree.html` (`src/tree.jsx`): one of each component kind (class, memo, forwardRef, lazy in Suspense, context provider and consumer, Profiler, an anonymous component, keyed items, Activity on React 19) inside StrictMode, plus wrappers the tree hides (fragments, text, DOM elements). It mirrors the unit `Kinds` app in `packages/page/test/tree.test.ts`; `e2e/panel.test.ts` checks the panel's names on `fixture:19`.

## Hooks page

`fixtures/vite` also serves `/hooks.html` (`src/hooks.jsx`): one `Hooks` component (`data-testid="hooks"`) calling every hook the inspector reads at its top level, inside `Theme` (`"dark"`), plus a `useCart` custom hook with a debug value. For hook names it assigns `const [one, setOne] = useState(1)`, `const box = useRef({ a: 1 })`, `const handle = useRef(null)` and `const cart = useCart()`, read in one `void [...]` (lint's unused-variable rule). React 19's own hooks run only on React 19 (`typeof use === "function"`, the same on every render), inline: a helper function would show as a custom hook. `e2e/inspector.test.ts` lists what each row shows.

## Bench page

`fixtures/vite` also serves `/bench.html` (`src/bench.jsx`): a `Bench` component over 10,000 `Cell` components (`data-testid="cell"`) and `window.__bench(mode, iterations)`, which times `flushSync` commits (`all` updates every cell, `one` the first) and returns the durations in ms. Used by `pnpm bench:hook-cost` (`docs/bench.md`) and `e2e/perf.test.ts`; checked by `pnpm test:fixtures`. Each `Cell` keeps its first render's setter (`setters[index] ??= setValue`): the inspector's shadow render calls `Cell` again with a stub dispatcher whose setter does nothing (M4 #38).

- `[data-testid=extra]` button: mounts or unmounts `Extra` (renders `[data-testid=extra-on]`) before the cells, for the panel's commit-latency test. The cells are built once at module level, so the toggle doesn't re-render them.

## How each fixture picks its React

- **`vite`:** npm aliases `react-18`/`react-dom-18` and `react-19`/`react-dom-19`. `vite.config.js` rewrites `react` and `react-dom` (and subpaths) by `--mode`, with a separate prebundle `cacheDir` per mode. `pnpm-workspace.yaml`'s `peerDependencyRules` allows react-dom's aliased `react` peer.
- **`multi`:** `serve.ts` bundles `src/root-18.jsx` and `src/root-19.jsx` separately with esbuild, each with its own `alias`, then serves them with `node:http`. Not Vite: one Vite alias set applies to the whole page, so two copies can't coexist. esbuild's alias also rewrites react-dom's internal `react` import and `react/jsx-dev-runtime`. `index.html` declares an empty icon so the page has no 404 console error.
- **`next`:** plain `react`/`react-dom` 19.3.1 dependencies. Next bundles its own React for the server.

## Notes

- `next dev` generates `fixtures/next/AGENTS.md`; it's gitignored.

## Related

- `fixtures/fixtures.test.ts`: smoke test. `fixtures/start.ts`: the `startFixture(script, port)` helper, shared with e2e.
- `docs/e2e.md`: the e2e suite that runs the extension on these fixtures.
- `docs/extension.md`: the extension that e2e loads into these pages.
- `docs/unit-tests.md`: Vitest unit tests on React 18 and 19.
- `docs/bench.md`: the benchmark that uses the bench page.
