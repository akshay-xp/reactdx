# Fixtures (`fixtures/`)

Test apps for every supported React setup. Each is a workspace package, so React is a dependency of fixtures only (enforced by `fixtures/fixtures.test.ts`).

## Commands (from the repo root)

| Command | Port | App |
|---|---|---|
| `pnpm fixture:18` | 5218 | `fixtures/vite` on React 18.3.1 |
| `pnpm fixture:19` | 5219 | `fixtures/vite` on React 19.3.1 |
| `pnpm fixture:next` | 5220 | `fixtures/next`: Next 16.4.6 (Turbopack dev), React 19.3.1 |
| `pnpm fixture:multi` | 5221 | `fixtures/multi`: a React 18.3.1 root and a React 19.3.1 root on one page |
| `pnpm test:fixtures` | | Smoke test: starts each fixture, checks it in headless Chrome (Puppeteer 25.17.0, no extension) |

All are development builds.

## Test ids (used by e2e)
- Every root renders `data-testid="react-version"` (text: `React.version`) and `data-testid="counter"` (text `Count: N`, +1 per click).
- `fixtures/next` also renders `data-testid="server"` from the Server Component (`app/page.jsx`); the counter and version come from the client component (`app/Counter.jsx`).
- `fixtures/multi` puts each root in `data-testid="root-18"` or `data-testid="root-19"`.

## How each fixture picks its React
- **`vite`:** npm aliases `react-18`/`react-dom-18` and `react-19`/`react-dom-19`. `vite.config.js` rewrites `react` and `react-dom` (and subpaths) by `--mode`, with a separate prebundle `cacheDir` per mode. `pnpm-workspace.yaml`'s `peerDependencyRules` allows react-dom's aliased `react` peer.
- **`multi`:** `serve.ts` bundles `src/root-18.jsx` and `src/root-19.jsx` separately with esbuild, each with its own `alias`, then serves them with `node:http`. Not Vite: one Vite alias set applies to the whole page, so two copies can't coexist. esbuild's alias also rewrites react-dom's internal `react` import and `react/jsx-dev-runtime`. `index.html` declares an empty icon so the page has no 404 console error.
- **`next`:** plain `react`/`react-dom` 19.3.1 dependencies. Next bundles its own React for the server.

## Notes
- `next dev` generates `fixtures/next/AGENTS.md`; it's gitignored.
- Ports differ from the M0 `spikes/` servers (5118-5129) until #16 deletes `spikes/`.

## Related
- `fixtures/fixtures.test.ts`: smoke test and the `startFixture(script, port)` helper.
- `docs/extension.md`: the extension that e2e loads into these pages.
