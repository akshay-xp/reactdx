# Invariant checks (`scripts/check/`)

`pnpm check` enforces the invariants the permissions decision and the store listing rely on: the content script runs on every site, the Firefox manifest declares no data collection, and ReactDX promises nothing leaves the browser.

## Commands (from the repo root)

- `pnpm check`: `pnpm lint && pnpm typecheck && pnpm build && node scripts/check/run.ts`. Stops at the first failure.
- `pnpm test:check`: `node --test "scripts/check/*.test.ts"`. Each rule's planted-violation tests, plus clean runs of the real build, typecheck and lint. Part of `pnpm test`.

## Bundle rules (`scripts/check/bundles.ts`)

`checkBundle(dir)` scans every `.js`, `.html`, `.json` and `.css` file under a built extension and returns `<file>: <rule>` lines. `run.ts` runs it on `apps/extension/.output/chrome-mv3` and `firefox-mv3`, prefixes the target, exits 1 on any.

| Rule         | Match                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| React        | any React internals key (below)                                                                      |
| dynamic code | `eval(`, `Function(` (covers `new Function(`)                                                        |
| remote URL   | `http(s)://` or `ws(s)://`, except `http://www.w3.org/` (XML namespaces: Solid ships the MathML one) |
| network API  | `fetch`, `importScripts`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`                 |
| hook size    | `content-scripts/hook.js` over `MAX_HOOK_BYTES` (2,048); the only home of the budget                 |

- **React markers:** `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` (react/react-dom 18), `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` (react 19), `__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` (react-dom 19). Property keys, so minifiers keep them; present in dev and production builds. They are React internals (MIT) and may be renamed: the tests plant real React files from `test-env/*`, so a rename fails `pnpm test:check` when `test-env` is upgraded.
- **Network APIs are banned outright**, not just to non-extension origins: a static scan can't tell where a call goes, and nothing ships one. A feature that needs one (e.g. open-in-editor against the dev server) adds an explicit allowlist here and documents it.
- **modulepreload polyfill:** WXT's polyfill chunk called `fetch` on preload links. `apps/extension/wxt.config.ts` sets `build.modulePreload.polyfill: false`; Chrome and Firefox 128+ preload natively (e2e passes in both without it).

## TypeScript (`pnpm typecheck`)

- TypeScript 7.0.2: `tsc -p . && tsc -p packages/panel && tsc -p apps/extension`.
- Root `tsconfig.json`: SnapQL's strict options, `types: ["node"]` (TypeScript 7 defaults `types` to `[]`). Covers `packages/page`, `e2e`, `scripts`, `fixtures/*.ts`, `fixtures/multi/serve.ts`, `vitest.config.ts`.
- `packages/panel/tsconfig.json` adds `jsx: preserve`, `jsxImportSource: solid-js`. Not in the root: Next (Turbopack) and esbuild read the nearest `tsconfig.json`, and compiled the React fixtures against `solid-js/jsx-dev-runtime`.
- `apps/extension/tsconfig.json` extends WXT's generated `.wxt/tsconfig.json` (created by `postinstall: wxt prepare`), adds the Solid JSX options and node types.
- `@types/react` and `@types/react-dom` are root devDependencies for `packages/page/test/commit.test.ts`.

## Lint and format (`pnpm lint`)

- Biome 2.6.6: `biome check --error-on-warnings` (lint, format, import order; warnings fail).
- `biome.json` copies SnapQL's style: 2-space indent, double quotes, semicolons as needed. Markdown is formatted too.
- `files.includes` excludes `spikes` until #16 deletes it, and `pnpm-lock.yaml`.
- Fix locally with `pnpm exec biome check --write`.

## Key files

- `scripts/check/bundles.ts`, `scripts/check/run.ts`
- `scripts/check/bundles.test.ts`: planted violations per rule; clean real build.
- `scripts/check/repo.test.ts`: typecheck and lint pass clean and fail on a planted `packages/page/src/planted.ts`.
- `tsconfig.json`, `packages/panel/tsconfig.json`, `apps/extension/tsconfig.json`, `biome.json`

## Related

- `docs/extension.md`: the build being checked.
- `docs/overview.md`: the permissions decision behind these invariants.
